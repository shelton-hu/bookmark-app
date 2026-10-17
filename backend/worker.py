"""Durable per-bookmark tasks and atomic embedding-index publication."""
import concurrent.futures
import json
import threading
import time
from datetime import datetime, timedelta, timezone
from .store import now
from . import services


def text_for(bookmark, send_excerpt=True):
    fields = ('title', 'description', 'summary', 'notes') + (('excerpt',) if send_excerpt else ())
    return '\n'.join(bookmark.get(k) or '' for k in fields)


def safe_error(error):
    # Provider bodies, request URLs and arbitrary exception text can contain keys.
    if isinstance(error, services.httpx.HTTPStatusError):
        return f'Model or fetch HTTP error ({error.response.status_code})'
    if isinstance(error, (KeyError, TypeError, json.JSONDecodeError)):
        return 'Invalid model response'
    trusted = {'Model is not configured', 'Invalid model base URL',
               'Invalid embedding vector', 'Zero embedding vector',
               'Invalid classification path', 'Invalid classification tags',
               'Invalid classification summary', 'Invalid classification reason',
               'Invalid assistant response', 'Semantic index is not built',
               'Query embedding dimension mismatch', 'Invalid preview',
               'AI folder depth exceeds 3', 'Invalid URL',
               'Only HTTP(S) URLs without credentials are supported',
               'Fetch blocked: destination is not a public IP address',
               'Fetch requires HTML or plain text', 'Page exceeds 2 MB limit',
               'Too many redirects'}
    if isinstance(error, ValueError) and str(error) in trusted:
        return str(error)
    return 'Model or fetch request failed'


class Worker:
    def __init__(self, store):
        self.store = store
        self.stop_event = threading.Event()
        self.thread = None

    def start(self):
        self.thread = threading.Thread(target=self.loop, daemon=True, name='bookmark-worker')
        self.thread.start()

    def stop(self):
        self.stop_event.set()
        if self.thread:
            self.thread.join(timeout=50)

    def loop(self):
        with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
            futures = set()
            while not self.stop_event.is_set():
                futures = {f for f in futures if not f.done()}
                capacity = self.store.settings()['concurrency'] - len(futures)
                for _ in range(max(0, capacity)):
                    task = self.claim()
                    if not task:
                        break
                    futures.add(pool.submit(self.process, task))
                self.finalize()
                cutoff = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
                with self.store.transaction() as db:
                    expired = [row['id'] for row in db.execute('SELECT id FROM bookmarks WHERE deleted_at<?', (cutoff,))]
                    self.store.purge_trashed(db, expired)
                self.stop_event.wait(0.25)

    def claim(self):
        with self.store.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute("SELECT tasks.*,jobs.kind,jobs.force,jobs.config FROM tasks JOIN jobs ON jobs.id=tasks.job_id WHERE tasks.status='queued' AND jobs.status IN ('queued','running') ORDER BY tasks.id LIMIT 1").fetchone()
            if not row:
                return None
            db.execute("UPDATE tasks SET status='running',attempts=attempts+1 WHERE id=?", (row['id'],))
            db.execute("UPDATE jobs SET status='running' WHERE id=?", (row['job_id'],))
            return dict(row)

    def process(self, task):
        store = self.store
        bookmark = None
        try:
            bookmark = store.bookmark(task['bookmark_id'])
            if bookmark and not bookmark['deleted_at']:
                config = json.loads(task['config'])
                if task['kind'] == 'classify' and (task['force'] or not bookmark['manual_classification']):
                    result = services.classify(config['classification'], bookmark, store.rows('SELECT * FROM folders'), config['send_excerpt'])
                    with store.transaction() as db:
                        # Recheck after network call: concurrent manual edits win.
                        current = db.execute('SELECT manual_classification,deleted_at,updated_at,folder_id,preserve_import_folder FROM bookmarks WHERE id=?', (bookmark['id'],)).fetchone()
                        if current and not current['deleted_at'] and current['updated_at'] == bookmark['updated_at'] and (task['force'] or not current['manual_classification']):
                            parent = None
                            protected_import = current['preserve_import_folder'] and not task['force']
                            for name in ([] if protected_import else result['path']):
                                folder = db.execute('SELECT id FROM folders WHERE name=? AND parent_id IS ?', (name, parent)).fetchone()
                                parent = folder['id'] if folder else db.execute('INSERT INTO folders(name,parent_id) VALUES(?,?)', (name, parent)).lastrowid
                            if protected_import:
                                parent = current['folder_id']
                            db.execute("UPDATE bookmarks SET folder_id=?,tags=?,summary=?,classification_status='done',manual_classification=0,error=NULL,updated_at=? WHERE id=?", (parent, json.dumps(result['tags']), result['summary'], now(), bookmark['id']))
                            store.invalidate_index(bookmark['id'])
                elif task['kind'] == 'fetch':
                    result = services.fetch_page(bookmark['url'])
                    with store.transaction() as db:
                        changed = db.execute('UPDATE bookmarks SET title=?,description=?,excerpt=?,updated_at=? WHERE id=? AND deleted_at IS NULL AND updated_at=?', (result['title'] or bookmark['title'], result['description'], result['excerpt'], now(), bookmark['id'], bookmark['updated_at'])).rowcount
                        if changed:
                            store.invalidate_index(bookmark['id'])
                elif task['kind'] == 'reindex':
                    vector = services.embed(config['embedding'], text_for(bookmark, config['send_excerpt']))
                    with store.transaction() as db:
                        if db.execute('SELECT 1 FROM bookmarks WHERE id=? AND deleted_at IS NULL AND updated_at=?', (bookmark['id'], bookmark['updated_at'])).fetchone():
                            db.execute('INSERT OR REPLACE INTO staged(job_id,bookmark_id,vector,revision) VALUES(?,?,?,?)', (task['job_id'], bookmark['id'], json.dumps(vector), bookmark['updated_at']))
            store.execute("UPDATE tasks SET status='completed',error=NULL WHERE id=? AND status='running'", (task['id'],))
        except Exception as exc:
            error = safe_error(exc)
            retry = task['attempts'] + 1 < 3
            store.execute("UPDATE tasks SET status=?,error=? WHERE id=? AND status='running'", ('queued' if retry else 'failed', error, task['id']))
            if not retry and task['kind'] == 'classify' and bookmark:
                store.execute("UPDATE bookmarks SET classification_status='failed',error=? WHERE id=? AND manual_classification=0 AND deleted_at IS NULL AND updated_at=?", (error, task['bookmark_id'], bookmark['updated_at']))
        self.finalize()

    def finalize(self):
        store = self.store
        with store.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            for job in db.execute("SELECT * FROM jobs WHERE status IN ('queued','running')").fetchall():
                counts = {r['status']: r['n'] for r in db.execute('SELECT status,count(*) n FROM tasks WHERE job_id=? GROUP BY status', (job['id'],))}
                completed, failed = counts.get('completed', 0), counts.get('failed', 0)
                db.execute('UPDATE jobs SET completed=?,failed=? WHERE id=?', (completed, failed, job['id']))
                if counts.get('queued', 0) or counts.get('running', 0):
                    continue
                error = None
                if failed:
                    error = db.execute("SELECT error FROM tasks WHERE job_id=? AND status='failed' LIMIT 1", (job['id'],)).fetchone()['error']
                elif job['kind'] == 'reindex':
                    staged = db.execute('SELECT * FROM staged WHERE job_id=?', (job['id'],)).fetchall()
                    dims = {len(json.loads(r['vector'])) for r in staged}
                    active_revisions = {r['id']: r['updated_at'] for r in db.execute('SELECT id,updated_at FROM bookmarks WHERE deleted_at IS NULL')}
                    staged_revisions = {r['bookmark_id']: r['revision'] for r in staged}
                    if active_revisions != staged_revisions:
                        failed, error = 1, 'Bookmarks changed during rebuild; previous index retained'
                    elif len(dims) > 1:
                        failed, error = 1, 'Embedding dimension mismatch; previous index retained'
                    else:
                        config = json.loads(job['config'])['embedding']
                        db.execute('DELETE FROM embeddings')
                        db.executemany('INSERT INTO embeddings VALUES(?,?,?)', [(r['bookmark_id'], r['vector'], config['model']) for r in staged])
                        settings = json.loads(db.execute('SELECT value FROM config WHERE id=1').fetchone()['value'])
                        settings['index_status'] = {'rebuild_needed': settings['embedding'] != config, 'active_model': config['model'], 'dimension': next(iter(dims), None), 'active_config': config}
                        db.execute('UPDATE config SET value=? WHERE id=1', (json.dumps(settings),))
                db.execute('UPDATE jobs SET status=?,failed=?,error=? WHERE id=?', ('failed' if failed else 'completed', failed, error, job['id']))
                db.execute('DELETE FROM staged WHERE job_id=?', (job['id'],))
