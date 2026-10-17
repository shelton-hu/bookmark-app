"""Trash management uses isolated databases and never deletes live user data."""
import pytest
from fastapi.testclient import TestClient
from .test_backend import app, client, save
from backend import services


def trash(client, url, **kwargs):
    row = save(client, url, **kwargs)
    assert client.post('/api/jobs', json={'kind': 'fetch', 'bookmark_ids': [row['id']]}).status_code == 200
    assert client.delete(f"/api/bookmarks/{row['id']}").status_code == 200
    return row


def preview(client, **scope):
    response = client.post('/api/trash/delete-preview', json=scope)
    assert response.status_code == 200, response.text
    return {**scope, 'snapshot': response.json()['snapshot']}


def test_purge_selected_cleans_related_data_and_preserves_active_and_other_trash(client, app):
    active = save(client, 'https://example.org/active')
    first = trash(client, 'https://example.org/first')
    other = trash(client, 'https://example.org/other')
    store = app.state.store
    for b in [active, first, other]:
        store.execute('INSERT INTO embeddings VALUES(?,?,?)', (b['id'], '[1,2]', 'test'))
        store.execute('INSERT INTO staged VALUES(?,?,?,?)', (999, b['id'], '[1,2]', b['updated_at']))
    tasks = store.rows('SELECT * FROM tasks WHERE bookmark_id=?', (first['id'],))
    assert tasks
    body = preview(client, bookmark_ids=[first['id'], first['id']])
    assert client.post('/api/trash/delete', json=body).json() == {'deleted': 1}
    assert store.bookmark(first['id']) is None
    assert store.bookmark(active['id']) and store.bookmark(other['id'])
    for table in ('embeddings', 'staged'):
        assert {r['bookmark_id'] for r in store.rows('SELECT * FROM '+table)} == {active['id'], other['id']}
    for task in tasks:
        history = store.one('SELECT * FROM tasks WHERE id=?', (task['id'],))
        assert history['status'] == 'completed' and history['bookmark_id'] is None
    # Retained task history keeps job totals meaningful and cannot restart deleted work.
    assert client.post('/api/trash/delete', json=body).status_code == 409
    assert store.bookmark(active['id'])


@pytest.mark.parametrize('body', [{}, {'all': False}, {'all': 'true'}, {'all': True, 'bookmark_ids': [1]}, {'bookmark_ids': []}, {'bookmark_ids': [True]}, {'bookmark_ids': [0]}, {'bookmark_ids': ['1']}])
def test_ambiguous_or_invalid_scopes_rejected(client, body):
    assert client.post('/api/trash/delete-preview', json=body).status_code == 422


def test_mixed_active_missing_or_changed_selection_is_atomic(client, app):
    active = save(client, 'https://example.org/active')
    old = trash(client, 'https://example.org/trash')
    for identifier in (active['id'], 999999):
        assert client.post('/api/trash/delete-preview', json={'bookmark_ids': [old['id'], identifier]}).status_code == 409
        assert client.post('/api/trash/restore', json={'bookmark_ids': [old['id'], identifier]}).status_code == 409
        assert app.state.store.bookmark(old['id'])['deleted_at']
    body = preview(client, bookmark_ids=[old['id']])
    client.post(f"/api/bookmarks/{old['id']}/restore")
    assert client.post('/api/trash/delete', json=body).status_code == 409
    assert app.state.store.bookmark(old['id'])['deleted_at'] is None


def test_clear_all_is_global_and_requires_unchanged_preview(client, app):
    active = save(client, 'https://example.org/keep')
    first = trash(client, 'https://example.org/one')
    body = preview(client, all=True)
    second = trash(client, 'https://example.org/two')
    assert client.post('/api/trash/delete', json=body).status_code == 409
    assert app.state.store.bookmark(first['id']) and app.state.store.bookmark(second['id'])
    # A same-count replacement also invalidates the preview.
    body = preview(client, all=True)
    client.post(f"/api/bookmarks/{first['id']}/restore")
    client.delete(f"/api/bookmarks/{active['id']}")
    assert client.post('/api/trash/delete', json=body).status_code == 409
    body = preview(client, all=True)
    assert client.post('/api/trash/delete', json=body).json() == {'deleted': 2}
    assert app.state.store.bookmark(first['id'])['deleted_at'] is None
    assert client.get('/api/bookmarks?trash=true').json()['total'] == 0
    assert client.post('/api/trash/delete', json=preview(client, all=True)).json() == {'deleted': 0}


def test_restore_conflicts_preserve_archive_and_successes_keep_metadata(client, app):
    folder = client.post('/api/folders', json={'name': 'Original'}).json()
    one = trash(client, 'https://example.org/same', folder_id=folder['id'], notes='first')
    two = trash(client, 'https://example.org/same', notes='second')
    blocked = trash(client, 'https://example.org/blocked', notes='archived')
    active = save(client, blocked['url'], title='keep active')
    result = client.post('/api/trash/restore', json={'bookmark_ids': [two['id'], one['id'], blocked['id'], one['id']]}).json()
    assert result == {'restored': [one['id']], 'conflicts': [two['id'], blocked['id']]}
    assert app.state.store.bookmark(one['id'])['folder_id'] == folder['id']
    assert app.state.store.bookmark(one['id'])['notes'] == 'first'
    assert app.state.store.bookmark(two['id'])['deleted_at']
    assert app.state.store.bookmark(blocked['id'])['notes'] == 'archived'
    assert app.state.store.bookmark(active['id'])['title'] == 'keep active'


def test_purge_rolls_back_related_deletes_on_failure(client, app):
    old = trash(client, 'https://example.org/rollback')
    store = app.state.store
    store.execute('INSERT INTO embeddings VALUES(?,?,?)', (old['id'], '[1,2]', 'test'))
    store.execute("CREATE TRIGGER fail_purge BEFORE DELETE ON bookmarks BEGIN SELECT RAISE(ABORT, 'test rollback'); END")
    body = preview(client, all=True)
    with pytest.raises(Exception, match='test rollback'):
        client.post('/api/trash/delete', json=body)
    assert store.bookmark(old['id'])['deleted_at']
    assert store.rows('SELECT * FROM embeddings')
    assert any(t['status'] == 'queued' for t in store.rows('SELECT * FROM tasks'))


@pytest.mark.parametrize('kind', ['fetch', 'reindex', 'classify'])
def test_inflight_worker_cannot_recreate_deleted_payload_or_modify_reused_id(client, app, monkeypatch, kind):
    old = save(client, 'https://example.org/inflight', tags=['manual'])
    store = app.state.store
    # Only our explicit job should be claimed.
    store.execute("UPDATE tasks SET status='completed'")
    store.execute("UPDATE jobs SET status='completed'")
    job = client.post('/api/jobs', json={'kind': kind, 'force': True, **({} if kind == 'reindex' else {'bookmark_ids': [old['id']]})}).json()
    task = app.state.worker.claim()
    assert task['job_id'] == job['id']
    replacement = []
    def during_network(*args):
        client.delete(f"/api/bookmarks/{old['id']}")
        assert client.post('/api/trash/delete', json=preview(client, all=True)).status_code == 200
        replacement.append(save(client, 'https://example.org/replacement', title='Keep me', tags=['manual']))
        if kind == 'fetch': return {'title': 'Stale response', 'description': '', 'excerpt': ''}
        if kind == 'classify': return {'path': ['Wrong'], 'tags': ['stale'], 'summary': 'Stale response'}
        return [1, 0]
    monkeypatch.setattr(services, {'fetch': 'fetch_page', 'reindex': 'embed', 'classify': 'classify'}[kind], during_network)
    app.state.worker.process(task)
    fresh = store.bookmark(replacement[0]['id'])
    assert fresh['title'] == 'Keep me' and fresh['tags'] == ['manual']
    assert not store.rows('SELECT * FROM staged')
    assert not store.rows("SELECT * FROM folders WHERE name='Wrong'")
    assert store.one('SELECT status FROM tasks WHERE id=?', (task['id'],))['status'] == 'completed'


def test_trash_mutations_require_session_and_do_not_accept_extension_token(client, app):
    token = client.post('/api/tokens', json={'name': 'test'}).json()['token']
    with TestClient(app) as anonymous:
        for path, body in [('delete-preview', {'all': True}), ('delete', {'all': True, 'snapshot': '0'*64}), ('restore', {'bookmark_ids': [1]})]:
            assert anonymous.post('/api/trash/'+path, json=body).status_code == 401
            assert anonymous.post('/api/trash/'+path, json=body, headers={'Authorization': 'Bearer '+token}).status_code == 401
