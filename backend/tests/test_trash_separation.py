"""Active URL uniqueness must never let trash block a new collection."""
import sqlite3
import pytest
from fastapi.testclient import TestClient
from backend.main import create_app
from backend.store import Store
from .test_backend import app, client, save


def test_repeated_save_delete_restore_and_backup_roundtrip(client, app, tmp_path):
    old = save(client, 'https://example.org/separate', title='Old', notes='archived note')
    client.delete(f"/api/bookmarks/{old['id']}")
    snapshot = app.state.store.bookmark(old['id'])
    new = save(client, old['url'], title='New')
    assert new['id'] != old['id'] and new['title'] == 'New'
    assert app.state.store.bookmark(old['id']) == snapshot
    assert client.post(f"/api/bookmarks/{old['id']}/restore").status_code == 409
    assert app.state.store.bookmark(old['id']) == snapshot
    client.delete(f"/api/bookmarks/{new['id']}")
    third = save(client, old['url'], title='Third')
    assert third['id'] not in (old['id'], new['id'])
    assert client.get('/api/bookmarks').json()['total'] == 1
    assert client.get('/api/bookmarks?trash=true').json()['total'] == 2
    # Multiple archived versions and one active version of the same URL survive backup restore.
    exported = client.get('/api/export/json').content
    target = create_app(tmp_path / 'restored', start_worker=False)
    with TestClient(target) as restored:
        restored.post('/api/auth/setup', json={'username': 'owner', 'password': 'safe-password'})
        result = restored.post('/api/import/json', files={'file': ('backup.json', exported)})
        assert result.status_code == 200, result.text
        assert result.json() == {'imported': 3, 'duplicates': 0}
        assert restored.get('/api/bookmarks').json()['total'] == 1
        assert restored.get('/api/bookmarks?trash=true').json()['total'] == 2
        assert restored.post('/api/import/json', files={'file': ('backup.json', exported)}).json() == {'imported': 0, 'duplicates': 3}


def test_legacy_html_import_does_not_restore_or_mutate_trash(client, app):
    old = save(client, 'https://example.org/html', title='Old')
    client.delete(f"/api/bookmarks/{old['id']}")
    before = app.state.store.bookmark(old['id'])
    body = b'<DL><DT><A HREF="https://example.org/html">Fresh</A></DL>'
    result = client.post('/api/import/html', files={'file': ('bookmarks.html', body)}, data={'mode': 'preserve'})
    assert result.status_code == 200 and result.json()['imported'] == 1
    assert app.state.store.bookmark(old['id']) == before
    assert client.get('/api/bookmarks').json()['items'][0]['title'] == 'Fresh'
    assert client.post('/api/import/html', files={'file': ('bookmarks.html', body)}).json()['duplicates'] == 1


def test_migrate_legacy_inline_unique_preserves_ids_and_related_records(client, app):
    folder = client.post('/api/folders', json={'name': 'Keep'}).json()
    active = save(client, 'https://example.org/active', folder_id=folder['id'], tags=['kept'])
    trash = save(client, 'https://example.org/trash', title='Archived')
    client.delete(f"/api/bookmarks/{trash['id']}")
    app.state.store.execute('INSERT INTO embeddings VALUES(?,?,?)', (active['id'], '[1,2]', 'model'))
    job = client.post('/api/jobs', json={'kind': 'fetch', 'bookmark_ids': [active['id']]}).json()
    # Recreate the actual old inline UNIQUE schema, retaining all values and linked IDs.
    with sqlite3.connect(app.state.store.path) as db:
        schema = db.execute("SELECT sql FROM sqlite_master WHERE name='bookmarks'").fetchone()[0]
        schema = schema.replace('CREATE TABLE bookmarks', 'CREATE TABLE bookmarks_legacy', 1).replace('url TEXT NOT NULL', 'url TEXT UNIQUE NOT NULL')
        db.execute(schema)
        db.execute('INSERT INTO bookmarks_legacy SELECT * FROM bookmarks')
        db.execute('DROP TABLE bookmarks')
        db.execute('ALTER TABLE bookmarks_legacy RENAME TO bookmarks')
        before = db.execute('SELECT * FROM bookmarks ORDER BY id').fetchall()
    store = Store(app.state.store.path.parent)
    with sqlite3.connect(store.path) as db:
        assert db.execute('SELECT * FROM bookmarks ORDER BY id').fetchall() == before
        assert db.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
        assert db.execute('PRAGMA foreign_key_check').fetchall() == []
        with pytest.raises(sqlite3.IntegrityError):
            db.execute('INSERT INTO bookmarks(url) VALUES(?)', (active['url'],))
        db.execute('INSERT INTO bookmarks(url) VALUES(?)', (trash['url'],))
    assert store.one('SELECT bookmark_id FROM embeddings')['bookmark_id'] == active['id']
    assert store.one('SELECT bookmark_id FROM tasks WHERE job_id=?', (job['id'],))['bookmark_id'] == active['id']
    assert store.bookmark(trash['id'])['deleted_at']
    # Restart is idempotent and retains the new active copy.
    Store(store.path.parent)
    assert store.one('SELECT COUNT(*) AS n FROM bookmarks')['n'] == 3
