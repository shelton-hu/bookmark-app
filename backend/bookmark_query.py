"""Read bookmark scopes in one SQLite snapshot without per-bookmark queries."""
import json
import math
import threading
import time
from collections import OrderedDict

from .store import decode_bookmark


SUMMARY_COLUMNS = ('id', 'url', 'title', 'folder_id', 'tags', 'source_folder',
                   'classification_status', 'manual_classification', 'deleted_at',
                   'created_at', 'updated_at', 'preserve_import_folder')
ORDER = 'b.created_at DESC,b.id'


class QueryVectors:
    """Short-lived per-search vectors avoid another model call when turning a page."""
    def __init__(self):
        self.entries = OrderedDict()
        self.lock = threading.Lock()

    def get(self, key, load):
        with self.lock:
            cached = self.entries.get(key)
            if cached is not None and cached[0] > time.monotonic():
                self.entries.move_to_end(key)
                return cached[1]
            self.entries.pop(key, None)
        # Never hold the cache lock while waiting for an external model.
        vector = load()
        with self.lock:
            self.entries[key] = (time.monotonic() + 120, vector)
            self.entries.move_to_end(key)
            while len(self.entries) > 32:
                self.entries.popitem(last=False)
        return vector


def read_bookmarks(store, *, q='', folder_id=None, include_children=False,
                   tag=None, trash=False, pending=False, vector=None,
                   view='full', page=None, page_size=20, include_ids=False):
    clauses = ['b.deleted_at IS ' + ('NOT NULL' if trash else 'NULL')]
    params = []
    if folder_id is not None:
        if include_children:
            # UNION terminates even for legacy directory cycles.
            clauses.append('''b.folder_id IN (
                WITH RECURSIVE scope(id) AS (
                    SELECT ? UNION SELECT f.id FROM folders f JOIN scope ON f.parent_id=scope.id
                ) SELECT id FROM scope)''')
        else:
            clauses.append('b.folder_id=?')
        params.append(folder_id)
    if tag:
        clauses.append('EXISTS (SELECT 1 FROM json_each(b.tags) WHERE value=?)')
        params.append(tag)
    if pending:
        clauses.append('b.folder_id IS NULL')
    if q and vector is None:
        clauses.append('bookmark_contains(?,b.url,b.title,b.description,b.excerpt,b.summary,b.notes,b.tags)')
        params.append(q.casefold())
    where = ' AND '.join(clauses)
    ids = None
    total = None
    warning = None
    with store.connect() as db:
        # Count, selection IDs and page contents must describe the same snapshot.
        db.execute('BEGIN')
        if vector is not None:
            norm = math.sqrt(sum(value * value for value in vector))
            if not norm:
                raise ValueError('Zero embedding vector')
            ranked = []
            missing = False
            rows = db.execute(f'''SELECT b.id,e.vector FROM bookmarks b
                LEFT JOIN embeddings e ON e.bookmark_id=b.id WHERE {where} ORDER BY {ORDER}''', params)
            for row in rows:
                other = json.loads(row['vector']) if row['vector'] is not None else None
                missing |= other is None
                score = -2
                if other is not None and len(other) == len(vector):
                    other_norm = math.sqrt(sum(value * value for value in other))
                    if not other_norm:
                        raise ValueError('Zero embedding vector')
                    score = sum(a * b for a, b in zip(vector, other)) / (norm * other_norm)
                ranked.append((row['id'], score))
            ranked.sort(key=lambda item: item[1], reverse=True)
            ids = [identifier for identifier, _ in ranked]
            if missing:
                warning = 'Some bookmarks are not indexed; rebuild the semantic index.'
        elif include_ids or view == 'ids':
            ids = [row['id'] for row in db.execute(f'SELECT b.id FROM bookmarks b WHERE {where} ORDER BY {ORDER}', params)]
        if ids is not None:
            total = len(ids)
        elif page is not None:
            total = db.execute(f'SELECT COUNT(*) FROM bookmarks b WHERE {where}', params).fetchone()[0]
        result = {}
        offset = 0
        if page is not None:
            page = min(page, max(1, (total + page_size - 1) // page_size))
            offset = (page - 1) * page_size
            result.update(page=page, page_size=page_size)
        if view == 'ids':
            result.update(items=[], ids=ids, total=total)
        else:
            columns = 'b.*' if view == 'full' else ','.join('b.' + name for name in SUMMARY_COLUMNS)
            if ids is not None:
                selected = ids if page is None else ids[offset:offset + page_size]
                rows = db.execute(f'''SELECT {columns} FROM bookmarks b
                    JOIN json_each(?) wanted ON b.id=wanted.value ORDER BY CAST(wanted.key AS INTEGER)''',
                    (json.dumps(selected),))
            else:
                pagination = '' if page is None else ' LIMIT ? OFFSET ?'
                page_params = params if page is None else [*params, page_size, offset]
                rows = db.execute(f'SELECT {columns} FROM bookmarks b WHERE {where} ORDER BY {ORDER}' + pagination, page_params)
            items = [decode_bookmark(row) for row in rows]
            if view == 'summary':
                for item in items:
                    item['details_loaded'] = False
            result.update(items=items, total=total if total is not None else len(items))
            if include_ids:
                result['ids'] = ids
        if warning:
            result['warning'] = warning
        return result
