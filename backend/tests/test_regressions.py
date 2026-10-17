"""Regression coverage for security and atomic publication boundaries."""
import json
import pytest
import threading
from datetime import datetime, timedelta, timezone
from fastapi.testclient import TestClient
from backend.main import create_app
from backend import services
from .test_backend import app, client, save, configured, drain


@pytest.mark.parametrize('trashed', [False, True])
def test_bearer_duplicate_does_not_read_existing_private_data(client,app,trashed):
    bookmark = save(client,notes='private note',excerpt='private text',title='private renamed title')
    if trashed:
        client.delete(f"/api/bookmarks/{bookmark['id']}")
    token = client.post('/api/tokens',json={'name':'save only'}).json()['token']
    with TestClient(app) as extension:
        response = extension.post('/api/bookmarks',headers={'Authorization':'Bearer '+token},json={'url':bookmark['url']})
        assert response.status_code == 200
        result = response.json()
        assert result == {'bookmark': {'id': result['bookmark']['id'], 'url': bookmark['url']}, 'duplicate': not trashed}
        assert (result['bookmark']['id'] != bookmark['id']) == trashed
        assert 'private' not in response.text


def test_partial_reindex_rejected_and_edit_during_embedding_fails_publication(client,app,monkeypatch):
    a = save(client,'https://example.org/a',title='Original')
    b = save(client,'https://example.org/b',title='Other')
    configured(client)
    assert client.post('/api/jobs',json={'kind':'reindex','bookmark_ids':[a['id']]}).status_code == 422
    monkeypatch.setattr(services,'embed',lambda *a:[1,0])
    client.post('/api/jobs',json={'kind':'reindex'})
    drain(app)
    before = app.state.store.rows('SELECT * FROM embeddings WHERE bookmark_id=?',(b['id'],))
    def embedding(*args):
        if 'Original' in args[1]:
            client.patch(f"/api/bookmarks/{a['id']}",json={'title':'Newer'})
        return [1,0]
    monkeypatch.setattr(services,'embed',embedding)
    client.post('/api/jobs',json={'kind':'reindex'})
    drain(app)
    job = client.get('/api/jobs').json()[0]
    assert job['status']=='failed' and 'changed during rebuild' in job['error']
    assert client.get('/api/settings').json()['index_status']['rebuild_needed']
    assert app.state.store.rows('SELECT * FROM embeddings WHERE bookmark_id=?',(b['id'],)) == before


def test_invalid_backup_settings_and_write_failures_rollback(client,app,monkeypatch):
    source = {'schema_version':1,'folders':[{'id':100,'name':'Restored','parent_id':None}], 'bookmarks':[{'url':'https://example.org/new','title':'New','folder_id':100}], 'settings':{'concurrency':0}}
    response = client.post('/api/import/json',files={'file':('b.json',json.dumps(source).encode())})
    assert response.status_code == 422
    assert not client.get('/api/folders').json()
    assert client.get('/api/bookmarks').json()['total']==0
    source['settings'] = {'concurrency':2}
    # A late operational failure must roll back already-created folders/bookmarks.
    original = app.state.store.set_settings
    def fail(settings):
        raise RuntimeError('disk unavailable')
    monkeypatch.setattr(app.state.store,'set_settings',fail)
    with pytest.raises(RuntimeError,match='disk unavailable'):
        client.post('/api/import/json',files={'file':('b.json',json.dumps(source).encode())})
    monkeypatch.setattr(app.state.store,'set_settings',original)
    assert not client.get('/api/folders').json()
    assert client.get('/api/bookmarks').json()['total']==0


def test_html_export_notes_restore(client,app,tmp_path):
    save(client,notes='First & special <notes>')
    save(client,'https://example.org/second',notes='Second note')
    content = client.get('/api/export/html').content
    target = create_app(tmp_path/'html-restored',start_worker=False)
    with TestClient(target) as restored:
        restored.post('/api/auth/setup',json={'username':'owner','password':'safe-password'})
        response = restored.post('/api/import/html',files={'file':('export.html',content)},data={'mode':'preserve'})
        assert response.status_code==200,response.text
        rows = restored.get('/api/bookmarks').json()['items']
        assert {row['notes'] for row in rows} == {'First & special <notes>','Second note'}


def test_new_save_marks_active_index_rebuild_needed(client,app,monkeypatch):
    save(client)
    configured(client)
    monkeypatch.setattr(services,'embed',lambda *args:[1,0])
    client.post('/api/jobs',json={'kind':'reindex'})
    drain(app)
    assert client.get('/api/settings').json()['index_status']['rebuild_needed'] is False
    save(client,'https://example.org/new')
    assert client.get('/api/settings').json()['index_status']['rebuild_needed'] is True


def test_actual_threaded_worker_concurrency_and_retention(client,app,monkeypatch):
    configured(client)
    reached = threading.Event()
    release = threading.Event()
    finished = threading.Event()
    lock = threading.Lock()
    state = {'active':0,'maximum':0,'finished':0}
    def classify(*args,**kwargs):
        with lock:
            state['active'] += 1
            state['maximum'] = max(state['maximum'],state['active'])
            if state['active'] == 2:
                reached.set()
        release.wait(4)
        with lock:
            state['active'] -= 1
            state['finished'] += 1
            if state['finished'] == 5:
                finished.set()
        return {'path':['Processed'],'tags':['done'],'summary':'summary'}
    monkeypatch.setattr(services,'classify',classify)
    for index in range(5):
        save(client,f'https://example.org/thread-{index}')
    old = save(client,'https://example.org/old-trash',tags=['manual'])
    cutoff = (datetime.now(timezone.utc)-timedelta(days=31)).isoformat()
    app.state.store.execute('UPDATE bookmarks SET deleted_at=? WHERE id=?',(cutoff,old['id']))
    worker = app.state.worker
    worker.start()
    try:
        assert reached.wait(4), 'Worker did not run two tasks concurrently'
        assert state['maximum'] == 2
        release.set()
        assert finished.wait(5), 'Worker did not complete all tasks'
    finally:
        release.set()
        worker.stop()
    assert state['maximum'] == 2
    assert app.state.store.bookmark(old['id']) is None
    assert all(job['status']=='completed' for job in client.get('/api/jobs').json())
