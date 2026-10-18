"""SQLite persistence; each operation uses a short independent transaction."""
import json
import os
import sqlite3
import threading
from contextlib import contextmanager
from pathlib import Path
from datetime import datetime, timezone


def now():
    return datetime.now(timezone.utc).isoformat()


def bookmark_contains(needle, *values):
    # Preserve the existing Unicode substring search, including decoded JSON tags.
    text = [str(value or '') for value in values[:-1]]
    text.append(str(json.loads(values[-1] or '[]')))
    return needle in ' '.join(text).casefold()


def decode_bookmark(row):
    if row is None:
        return None
    row = dict(row)
    row['tags'] = json.loads(row['tags'])
    row['manual_classification'] = bool(row['manual_classification'])
    row['preserve_import_folder'] = bool(row['preserve_import_folder'])
    return row


DEFAULT_SETTINGS = {
    'classification': {'base_url': 'https://api.openai.com/v1', 'model': '', 'api_key': '', 'prompt': ''},
    'embedding': {'base_url': 'https://api.openai.com/v1', 'model': '', 'api_key': ''},
    'concurrency': 2, 'send_excerpt': True,
    'index_status': {'rebuild_needed': True, 'active_model': None, 'dimension': None},
}


class Store:
    def __init__(self, directory=None):
        self.local = threading.local()
        directory = Path(directory or os.environ.get('DATA_DIR', './data'))
        directory.mkdir(parents=True, exist_ok=True)
        os.chmod(directory, 0o700)
        self.path = directory / 'bookmarks.sqlite3'
        with self.connect() as db:
            db.executescript('''
            PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS account(id INTEGER PRIMARY KEY CHECK(id=1),username TEXT,password TEXT);
            CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY,expires TEXT);
            CREATE TABLE IF NOT EXISTS tokens(id INTEGER PRIMARY KEY,name TEXT,hash TEXT UNIQUE,created_at TEXT);
            CREATE TABLE IF NOT EXISTS folders(id INTEGER PRIMARY KEY,name TEXT NOT NULL,parent_id INTEGER REFERENCES folders(id));
            CREATE TABLE IF NOT EXISTS bookmarks(id INTEGER PRIMARY KEY,url TEXT NOT NULL,title TEXT,description TEXT,excerpt TEXT,summary TEXT,notes TEXT,folder_id INTEGER REFERENCES folders(id),tags TEXT,source_folder TEXT,classification_status TEXT,manual_classification INTEGER,deleted_at TEXT,created_at TEXT,updated_at TEXT,error TEXT);
            CREATE TABLE IF NOT EXISTS config(id INTEGER PRIMARY KEY CHECK(id=1),value TEXT);
            CREATE TABLE IF NOT EXISTS jobs(id INTEGER PRIMARY KEY,kind TEXT,status TEXT,total INTEGER,completed INTEGER DEFAULT 0,failed INTEGER DEFAULT 0,error TEXT,created_at TEXT,force INTEGER DEFAULT 0,config TEXT);
            CREATE TABLE IF NOT EXISTS tasks(id INTEGER PRIMARY KEY,job_id INTEGER REFERENCES jobs(id) ON DELETE CASCADE,bookmark_id INTEGER,status TEXT DEFAULT 'queued',attempts INTEGER DEFAULT 0,error TEXT,UNIQUE(job_id,bookmark_id));
            CREATE TABLE IF NOT EXISTS embeddings(bookmark_id INTEGER PRIMARY KEY,vector TEXT,model TEXT);
            CREATE TABLE IF NOT EXISTS staged(job_id INTEGER,bookmark_id INTEGER,vector TEXT,PRIMARY KEY(job_id,bookmark_id));
            CREATE TABLE IF NOT EXISTS previews(id TEXT PRIMARY KEY,changes TEXT,created_at TEXT);
            CREATE TABLE IF NOT EXISTS import_previews(id TEXT PRIMARY KEY,payload TEXT NOT NULL,expires_at TEXT NOT NULL,result TEXT);
            CREATE TABLE IF NOT EXISTS folder_ai_previews(id TEXT PRIMARY KEY,payload TEXT NOT NULL,expires_at TEXT NOT NULL,result TEXT);
            ''')
            staged_columns = {r['name'] for r in db.execute('PRAGMA table_info(staged)')}
            if 'revision' not in staged_columns:
                db.execute('ALTER TABLE staged ADD COLUMN revision TEXT')
            columns = {r['name'] for r in db.execute('PRAGMA table_info(bookmarks)')}
            if 'preserve_import_folder' not in columns:
                db.execute('ALTER TABLE bookmarks ADD COLUMN preserve_import_folder INTEGER DEFAULT 0')
            # Older databases have an inline UNIQUE(url), which also blocks trash URLs.
            legacy_url_unique = any(
                index['unique'] and not index['partial'] and
                [row['name'] for row in db.execute('PRAGMA index_info("' + index['name'].replace('"', '""') + '")')] == ['url']
                for index in db.execute('PRAGMA index_list(bookmarks)')
            )
            if legacy_url_unique:
                if not db.in_transaction:
                    db.execute('BEGIN IMMEDIATE')
                db.execute('''CREATE TABLE bookmarks_separated(id INTEGER PRIMARY KEY,url TEXT NOT NULL,title TEXT,description TEXT,excerpt TEXT,summary TEXT,notes TEXT,folder_id INTEGER REFERENCES folders(id),tags TEXT,source_folder TEXT,classification_status TEXT,manual_classification INTEGER,deleted_at TEXT,created_at TEXT,updated_at TEXT,error TEXT,preserve_import_folder INTEGER DEFAULT 0,sort_order INTEGER)''')
                names = ','.join('"' + row['name'].replace('"', '""') + '"' for row in db.execute('PRAGMA table_info(bookmarks)'))
                db.execute(f'INSERT INTO bookmarks_separated({names}) SELECT {names} FROM bookmarks')
                db.execute('DROP TABLE bookmarks')
                db.execute('ALTER TABLE bookmarks_separated RENAME TO bookmarks')
            # Nullable positions preserve legacy ordering until the first drag.
            for table in ('bookmarks', 'folders'):
                if 'sort_order' not in {r['name'] for r in db.execute('PRAGMA table_info(' + table + ')')}:
                    db.execute('ALTER TABLE ' + table + ' ADD COLUMN sort_order INTEGER')
            db.execute('CREATE INDEX IF NOT EXISTS bookmarks_manual_order ON bookmarks((sort_order IS NOT NULL),sort_order,created_at DESC,id) WHERE deleted_at IS NULL')
            db.execute('CREATE INDEX IF NOT EXISTS bookmarks_folder_manual_order ON bookmarks(folder_id,(sort_order IS NOT NULL),sort_order,created_at DESC,id) WHERE deleted_at IS NULL')
            db.execute('CREATE UNIQUE INDEX IF NOT EXISTS bookmarks_active_url ON bookmarks(url) WHERE deleted_at IS NULL')
            db.execute('CREATE INDEX IF NOT EXISTS bookmarks_active_order ON bookmarks(created_at DESC,id) WHERE deleted_at IS NULL')
            db.execute('CREATE INDEX IF NOT EXISTS bookmarks_active_folder_order ON bookmarks(folder_id,created_at DESC,id) WHERE deleted_at IS NULL')
            db.execute('CREATE INDEX IF NOT EXISTS bookmarks_trash_order ON bookmarks(created_at DESC,id) WHERE deleted_at IS NOT NULL')
            db.execute('CREATE INDEX IF NOT EXISTS folders_parent ON folders(parent_id)')
            db.execute('INSERT OR IGNORE INTO config VALUES(1,?)', (json.dumps(DEFAULT_SETTINGS),))
            db.execute("UPDATE tasks SET status='queued' WHERE status='running'")
            db.execute("UPDATE jobs SET status='queued' WHERE status='running'")
        os.chmod(self.path, 0o600)

    @contextmanager
    def connect(self):
        current = getattr(self.local, 'db', None)
        if current is not None:
            yield current
            return
        db = sqlite3.connect(self.path, timeout=30)
        db.row_factory = sqlite3.Row
        db.create_function('bookmark_contains', 8, bookmark_contains, deterministic=True)
        db.execute('PRAGMA foreign_keys=ON')
        try:
            with db:
                yield db
        finally:
            db.close()

    @contextmanager
    def transaction(self):
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            self.local.db = db
            try:
                yield db
            finally:
                self.local.db = None

    def rows(self, query, params=()):
        with self.connect() as db:
            return [dict(r) for r in db.execute(query, params)]

    def one(self, query, params=()):
        rows = self.rows(query, params)
        return rows[0] if rows else None

    def execute(self, query, params=()):
        with self.connect() as db:
            return db.execute(query, params).lastrowid

    def settings(self):
        return json.loads(self.one('SELECT value FROM config WHERE id=1')['value'])

    def set_settings(self, settings):
        self.execute('UPDATE config SET value=? WHERE id=1', (json.dumps(settings),))

    def invalidate_index(self, identifier=None):
        with self.connect() as db:
            if not getattr(self.local, 'db', None):
                db.execute('BEGIN IMMEDIATE')
            if identifier is not None:
                db.execute('DELETE FROM embeddings WHERE bookmark_id=?', (identifier,))
            settings = json.loads(db.execute('SELECT value FROM config WHERE id=1').fetchone()['value'])
            settings['index_status']['rebuild_needed'] = True
            db.execute('UPDATE config SET value=? WHERE id=1', (json.dumps(settings),))

    def purge_trashed(self, db, identifiers):
        """Caller holds a write transaction; keep task history/counts, discard payloads."""
        for identifier in identifiers:
            if not db.execute('SELECT 1 FROM bookmarks WHERE id=? AND deleted_at IS NOT NULL', (identifier,)).fetchone():
                raise ValueError('Only trashed bookmarks can be purged')
            db.execute('DELETE FROM embeddings WHERE bookmark_id=?', (identifier,))
            db.execute('DELETE FROM staged WHERE bookmark_id=?', (identifier,))
            db.execute("UPDATE tasks SET bookmark_id=NULL,status='completed',error='Bookmark permanently deleted' WHERE bookmark_id=?", (identifier,))
            db.execute('DELETE FROM bookmarks WHERE id=? AND deleted_at IS NOT NULL', (identifier,))

    def bookmark(self, identifier):
        return decode_bookmark(self.one('SELECT * FROM bookmarks WHERE id=?', (identifier,)))
