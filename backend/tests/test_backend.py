"""All tests create isolated data directories; no real account/model/network data."""
import json
import os
import socket
import tempfile
from pathlib import Path
import pytest
from fastapi.testclient import TestClient

# main's default app is isolated too; importing never touches a real DATA_DIR.
_default_data = tempfile.TemporaryDirectory(prefix='bookmark-test-default-')
os.environ['DATA_DIR'] = _default_data.name
from backend.main import create_app
from backend.store import Store
from backend import services


@pytest.fixture
def app(tmp_path):
    return create_app(tmp_path / 'db', start_worker=False)


@pytest.fixture
def client(app):
    with TestClient(app) as client:
        assert client.post('/api/auth/setup', json={'username':'owner','password':'safe-password'}).status_code == 200
        yield client


def save(client, url='https://example.com/page', **kwargs):
    response = client.post('/api/bookmarks',json={'url':url, **kwargs})
    assert response.status_code == 200, response.text
    return response.json()['bookmark']


def configured(client):
    response = client.put('/api/settings',json={'classification':{'model':'chat','api_key':'secret-classify'},'embedding':{'model':'embed','api_key':'secret-embed'}})
    assert response.status_code == 200


def drain(app, maximum=100):
    worker = app.state.worker
    for _ in range(maximum):
        task = worker.claim()
        if not task:
            worker.finalize()
            return
        worker.process(task)
    pytest.fail('Queue did not terminate')


def test_setup_auth_logout_cookie_security(app):
    with TestClient(app) as c:
        assert c.get('/api/auth/status').json() == {'initialized':False,'authenticated':False}
        assert c.get('/api/bookmarks').status_code == 401
        response = c.post('/api/auth/setup',json={'username':'owner','password':'safe-password'})
        cookie = response.headers['set-cookie'].lower()
        assert 'httponly' in cookie and 'samesite=strict' in cookie and 'secure' not in cookie
        assert c.post('/api/auth/setup',json={'username':'second','password':'safe-password'}).status_code == 409
        assert c.get('/api/auth/me').json() == {'username':'owner'}
        assert c.post('/api/bookmarks',headers={'Origin':'https://evil.example'},json={'url':'https://example.org'}).status_code == 403
        token = c.cookies.get('bookmark_session')
        c.post('/api/auth/logout')
        c.cookies.set('bookmark_session',token)
        assert c.get('/api/auth/me').status_code == 401
        assert c.post('/api/auth/login',json={'username':'owner','password':'wrong-pass'}).status_code == 401
        assert c.post('/api/auth/login',json={'username':'owner','password':'safe-password'}).status_code == 200


def test_tokens_scoped_revoked_and_hashed(client,app):
    token = client.post('/api/tokens',json={'name':'extension'}).json()
    assert 'token' not in client.get('/api/tokens').json()[0]
    assert token['token'] not in app.state.store.rows('SELECT * FROM tokens')[0]['hash']
    with TestClient(app) as ext:
        headers = {'Authorization':'Bearer '+token['token'],'Origin':'chrome-extension://extension'}
        assert ext.get('/api/connection',headers=headers).status_code == 200
        assert ext.get('/api/bookmarks',headers=headers).status_code == 401
        assert ext.get('/api/settings',headers=headers).status_code == 401
        assert ext.post('/api/bookmarks',headers=headers,json={'url':'https://example.com'}).status_code == 200
        client.delete('/api/tokens/'+str(token['id']))
        assert ext.post('/api/bookmarks',headers={'Authorization':headers['Authorization']},json={'url':'https://example.com/new'}).status_code == 401


def test_url_dedup_metadata_trash_refresh(client,app):
    b = save(client,'HTTPS://EXAMPLE.com:443/page#first',title='Original',excerpt='old')
    duplicate = client.post('/api/bookmarks',json={'url':'https://example.com/page?utm_source=mail&fbclid=abc#g','title':'Overwrite'}).json()
    assert duplicate['duplicate'] and duplicate['bookmark']['title'] == 'Original'
    app.state.store.execute('INSERT INTO embeddings VALUES(?,?,?)',(b['id'],'[1,2]','old'))
    changed = client.post(f"/api/bookmarks/{b['id']}/refresh",json={'title':'Updated','description':'new','excerpt':'fresh'}).json()
    assert changed['title'] == 'Updated'
    assert not app.state.store.rows('SELECT * FROM embeddings')
    client.delete(f"/api/bookmarks/{b['id']}")
    assert client.get('/api/bookmarks').json()['total'] == 0
    assert client.get('/api/bookmarks?trash=true').json()['total'] == 1
    fresh = client.post('/api/bookmarks',json={'url':b['url']}).json()
    assert not fresh['duplicate'] and fresh['bookmark']['id'] != b['id']
    assert client.post(f"/api/bookmarks/{b['id']}/restore").status_code == 409
    assert client.get('/api/bookmarks?trash=true').json()['total'] == 1
    client.delete(f"/api/bookmarks/{fresh['bookmark']['id']}")
    assert client.post(f"/api/bookmarks/{b['id']}/restore").status_code == 200
    assert client.get('/api/bookmarks').json()['total'] == 1
    assert client.post('/api/bookmarks',json={'url':'javascript:alert(1)'}).status_code == 422


def test_classification_manual_protection_and_paths(client,app,monkeypatch):
    folder = client.post('/api/folders',json={'name':'Reading'}).json()
    b = save(client)
    configured(client)
    monkeypatch.setattr(services,'model_request',lambda *args,**kwargs: {'choices':[{'message':{'content':json.dumps({'path':['Reading','Science'],'tags':['science'],'summary':'Useful'})}}]})
    client.patch(f"/api/bookmarks/{b['id']}",json={'folder_id':folder['id'],'tags':['mine']})
    job = client.post('/api/jobs',json={'kind':'classify','bookmark_ids':[b['id']]}).json()
    assert job['total'] == 0
    drain(app)
    assert app.state.store.bookmark(b['id'])['tags'] == ['mine']
    client.post('/api/jobs',json={'kind':'classify','bookmark_ids':[b['id']],'force':True})
    drain(app)
    result = app.state.store.bookmark(b['id'])
    assert result['tags'] == ['science'] and result['summary'] == 'Useful'
    assert len(client.get('/api/folders').json()) == 2
    assert not result['manual_classification']
    # Model failures leave data saved and finish after bounded retries.
    monkeypatch.setattr(services,'model_request',lambda *a,**kw: (_ for _ in ()).throw(ValueError('model offline')))
    new = save(client,'https://example.com/failure')
    drain(app)
    assert app.state.store.bookmark(new['id'])['classification_status'] == 'failed'
    failed = client.get('/api/jobs').json()[0]
    assert failed['status'] == 'failed'
    assert app.state.store.rows('SELECT attempts FROM tasks WHERE job_id=?',(failed['id'],))[0]['attempts'] == 3


def test_manual_edit_during_model_call_wins(client,app,monkeypatch):
    b = save(client)
    configured(client)
    def classify(*args,**kwargs):
        client.patch(f"/api/bookmarks/{b['id']}",json={'tags':['manual']})
        return {'path':['AI'],'tags':['ai'],'summary':'AI'}
    monkeypatch.setattr(services,'classify',classify)
    client.post('/api/jobs',json={'kind':'classify','bookmark_ids':[b['id']]})
    drain(app)
    assert app.state.store.bookmark(b['id'])['tags'] == ['manual']
    assert not client.get('/api/folders').json()


def test_worker_pause_resume_restart_and_retry(client,app,monkeypatch):
    b = save(client)
    configured(client)
    job = client.post('/api/jobs',json={'kind':'fetch','bookmark_ids':[b['id']]}).json()
    assert client.post(f"/api/jobs/{job['id']}/pause").json()['status'] == 'paused'
    assert app.state.worker.claim() is None
    client.post(f"/api/jobs/{job['id']}/resume")
    task = app.state.worker.claim()
    assert task
    restarted = Store(app.state.store.path.parent)
    assert restarted.one('SELECT status FROM tasks WHERE id=?',(task['id'],))['status'] == 'queued'
    monkeypatch.setattr(services,'fetch_page',lambda url: {'title':'Fetched','description':'desc','excerpt':'body'})
    drain(app)
    assert client.get('/api/jobs').json()[0]['status'] == 'completed'
    assert app.state.store.bookmark(b['id'])['excerpt'] == 'body'
    monkeypatch.setattr(services,'fetch_page',lambda url: (_ for _ in ()).throw(ValueError('offline')))
    job = client.post('/api/jobs',json={'kind':'fetch','bookmark_ids':[b['id']]}).json()
    drain(app)
    assert client.get('/api/jobs').json()[0]['status'] == 'failed'
    monkeypatch.setattr(services,'fetch_page',lambda url: {'title':'Retry','description':'','excerpt':'retry'})
    assert client.post(f"/api/jobs/{job['id']}/retry").json()['status'] == 'queued'
    drain(app)
    assert app.state.store.bookmark(b['id'])['title'] == 'Retry'


def test_reindex_atomic_publication_search_failures_privacy(client,app,monkeypatch):
    a = save(client,'https://example.com/a',title='Alpha',description='Description',excerpt='private excerpt')
    b = save(client,'https://example.com/b',title='Beta')
    configured(client)
    client.put('/api/settings',json={'send_excerpt':False})
    calls = []
    def model(config,endpoint,payload):
        calls.append(payload['input'])
        return {'data':[{'embedding':[1.,0.] if 'Alpha' in payload['input'] else [0.,1.]}]}
    monkeypatch.setattr(services,'model_request',model)
    client.post('/api/jobs',json={'kind':'reindex'})
    drain(app)
    assert 'Description' in calls[0] and all('private excerpt' not in text for text in calls)
    before = app.state.store.rows('SELECT * FROM embeddings ORDER BY bookmark_id')
    assert len(before) == 2
    calls.clear()
    result = client.get('/api/bookmarks',params={'q':'Alpha','mode':'semantic'}).json()
    assert result['items'][0]['id'] == a['id'] and len(calls) == 1
    client.put('/api/settings',json={'embedding':{'model':'new'}})
    assert client.get('/api/settings').json()['index_status']['rebuild_needed']
    monkeypatch.setattr(services,'model_request',lambda *a,**kw: (_ for _ in ()).throw(ValueError('model down')))
    client.post('/api/jobs',json={'kind':'reindex'})
    drain(app)
    assert app.state.store.rows('SELECT * FROM embeddings ORDER BY bookmark_id') == before
    assert client.get('/api/jobs').json()[0]['status'] == 'failed'
    result = client.get('/api/bookmarks',params={'q':'Alpha','mode':'semantic'}).json()
    assert result['total'] == 1 and 'warning' in result
    counter = iter([[1,2],[1,2,3]])
    monkeypatch.setattr(services,'embed',lambda *args:next(counter))
    client.post('/api/jobs',json={'kind':'reindex'})
    drain(app)
    assert 'dimension' in client.get('/api/jobs').json()[0]['error'].lower()
    assert app.state.store.rows('SELECT * FROM embeddings ORDER BY bookmark_id') == before


def test_settings_and_backup_never_export_secrets(client,app,tmp_path):
    configured(client)
    token = client.post('/api/tokens',json={'name':'private'}).json()['token']
    client.put('/api/settings',json={'classification':{'model':'next'}})
    assert app.state.store.settings()['classification']['api_key'] == 'secret-classify'
    assert 'api_key' not in json.dumps(client.get('/api/settings').json())
    root = client.post('/api/folders',json={'name':'Root'}).json()
    child = client.post('/api/folders',json={'name':'Child','parent_id':root['id']}).json()
    active = save(client,folder_id=child['id'],tags=['manual'],notes='note')
    trash = save(client,'https://example.com/trash')
    client.delete(f"/api/bookmarks/{trash['id']}")
    exported = client.get('/api/export/json')
    assert len(exported.json()['bookmarks']) == 2
    assert all(secret not in exported.text for secret in ('secret-classify','secret-embed',token,'safe-password','api_key'))
    target = create_app(tmp_path/'restore',start_worker=False)
    with TestClient(target) as restored:
        restored.post('/api/auth/setup',json={'username':'restored','password':'safe-password'})
        result = restored.post('/api/import/json',files={'file':('backup.json',exported.content,'application/json')})
        assert result.status_code == 200,result.text
        assert result.json() == {'imported':2,'duplicates':0}
        assert restored.get('/api/bookmarks?trash=true').json()['total'] == 1
        assert restored.get('/api/bookmarks').json()['items'][0]['manual_classification']
        assert len(restored.get('/api/folders').json()) == 2
        assert not restored.get('/api/jobs').json()
        assert not restored.get('/api/settings').json()['classification']['has_key']
        assert restored.post('/api/import/json',files={'file':('backup.json',exported.content)}).json()['duplicates'] == 2
    assert client.put('/api/settings',json={'classification':{'api_key':''}}).json()['classification']['has_key'] is False
    assert client.put('/api/settings',json={'concurrency':6}).status_code == 422


def test_html_hierarchy_import_export_no_queue(client,app):
    configured(client)
    body = b'<!DOCTYPE NETSCAPE-Bookmark-file-1><DL><p><DT><H3>Root</H3><DL><p><DT><H3>Child</H3><DL><p><DT><A HREF="https://example.com/deep">Deep</A></DL><p></DL><p><DT><A HREF="https://example.com/top">Top</A></DL><p>'
    result = client.post('/api/import/html',files={'file':('bookmarks.html',body)},data={'mode':'preserve'})
    assert result.status_code == 200,result.text
    assert result.json()['imported'] == 2
    bookmarks = client.get('/api/bookmarks').json()['items']
    deep = next(b for b in bookmarks if b['title'] == 'Deep')
    assert deep['source_folder'] == 'Root/Child'
    assert deep['folder_id'] is not None
    assert not client.get('/api/jobs').json()
    exported = client.get('/api/export/html').text
    assert '<H3>Child</H3>' in exported and 'Deep' in exported
    assert client.post('/api/import/html',files={'file':('bookmarks.html',body)},data={'mode':'reorganize'}).json()['duplicates'] == 2


def test_folders_cycle_delete_and_preview_apply(client,app,monkeypatch):
    root = client.post('/api/folders',json={'name':'Root'}).json()
    child = client.post('/api/folders',json={'name':'Child','parent_id':root['id']}).json()
    assert client.patch(f"/api/folders/{root['id']}",json={'parent_id':child['id']}).status_code == 422
    configured(client)
    monkeypatch.setattr(services,'model_request',lambda *a,**kw: {'choices':[{'message':{'content':json.dumps({'changes':[{'folder_id':child['id'],'name':'Renamed','parent_id':None}],'description':'simplify'})}}]})
    preview = client.post('/api/folders/organize-preview').json()
    assert next(f for f in client.get('/api/folders').json() if f['id']==child['id'])['name'] == 'Child'
    assert client.post('/api/folders/organize-apply',json={'preview_id':preview['preview_id']}).status_code == 200
    assert next(f for f in client.get('/api/folders').json() if f['id']==child['id'])['name'] == 'Renamed'
    assert client.post('/api/folders/organize-apply',json={'preview_id':preview['preview_id']}).status_code == 404
    b = save(client,folder_id=root['id'])
    client.delete(f"/api/folders/{root['id']}")
    bookmark = app.state.store.bookmark(b['id'])
    assert bookmark['folder_id'] is None and bookmark['classification_status']=='pending'
    assert not any(f['parent_id']==root['id'] for f in client.get('/api/folders').json())


@pytest.mark.parametrize('address',['127.0.0.1','10.0.0.1','169.254.169.254','::1','fc00::1','224.0.0.1'])
def test_fetch_rejects_private_dns(monkeypatch,address):
    monkeypatch.setattr(socket,'getaddrinfo',lambda *a,**kw:[(socket.AF_INET,socket.SOCK_STREAM,0,'',(address,80))])
    with pytest.raises(ValueError,match='public IP'):
        services.fetch_page('https://evil.example')


def test_model_validation_and_missing_configuration():
    with pytest.raises(ValueError,match='not configured'):
        services.embed({'model':'','api_key':''},'test')
    for url in ('file:///etc/passwd','http://user:pass@example.com','https:///broken'):
        with pytest.raises(ValueError):
            services.normalize_url(url)
