import json
import socket
from contextlib import contextmanager
import pytest
from backend import services
from .test_backend import client, app, save, configured, drain


def test_preserve_import_folder_classify_and_force(client,app,monkeypatch):
    body = b'<DL><DT><H3>Original</H3><DL><DT><A HREF="https://example.com/import">Imported</A></DL></DL>'
    assert client.post('/api/import/html',files={'file':('b.html',body)},data={'mode':'preserve'}).json()['imported'] == 1
    b = client.get('/api/bookmarks').json()['items'][0]
    original = b['folder_id']
    assert b['preserve_import_folder']
    configured(client)
    monkeypatch.setattr(services,'classify',lambda *a,**kw:{'path':['AI'],'tags':['new'],'summary':'summary'})
    client.post('/api/jobs',json={'kind':'classify'})
    drain(app)
    updated = app.state.store.bookmark(b['id'])
    assert updated['folder_id'] == original and updated['tags'] == ['new'] and updated['summary'] == 'summary'
    assert len(client.get('/api/folders').json()) == 1
    client.post('/api/jobs',json={'kind':'classify','bookmark_ids':[b['id']],'force':True})
    drain(app)
    assert app.state.store.bookmark(b['id'])['folder_id'] != original


def test_folder_merge_preview_validation_and_confirmation(client,app,monkeypatch):
    source = client.post('/api/folders',json={'name':'Source'}).json()['id']
    target = client.post('/api/folders',json={'name':'Target'}).json()['id']
    child = client.post('/api/folders',json={'name':'Child','parent_id':source}).json()['id']
    b = save(client,folder_id=source,tags=['manual'])
    configured(client)
    def reply(changes):
        return {'choices':[{'message':{'content':json.dumps({'changes':changes,'description':'Merge duplicates'})}}]}
    monkeypatch.setattr(services,'model_request',lambda *a,**kw:reply([{'folder_id':source,'merge_into':target}]))
    preview = client.post('/api/folders/organize-preview').json()
    assert app.state.store.bookmark(b['id'])['folder_id'] == source
    assert client.post('/api/folders/organize-apply',json={'preview_id':preview['preview_id']}).status_code == 200
    updated = app.state.store.bookmark(b['id'])
    assert updated['folder_id'] == target and updated['manual_classification']
    folders = client.get('/api/folders').json()
    assert all(f['id'] != source for f in folders)
    assert next(f for f in folders if f['id']==child)['parent_id'] == target
    monkeypatch.setattr(services,'model_request',lambda *a,**kw:reply([{'folder_id':target,'merge_into':child}]))
    assert client.post('/api/folders/organize-preview').status_code == 422


def test_forced_classification_cannot_overwrite_newer_manual_edit(client,app,monkeypatch):
    b = save(client,tags=['before'])
    configured(client)
    def classify(*a,**kw):
        client.patch(f"/api/bookmarks/{b['id']}",json={'tags':['newer']})
        return {'path':['AI'],'tags':['obsolete'],'summary':'old'}
    monkeypatch.setattr(services,'classify',classify)
    client.post('/api/jobs',json={'kind':'classify','bookmark_ids':[b['id']],'force':True})
    drain(app)
    assert app.state.store.bookmark(b['id'])['tags'] == ['newer']


def test_public_fetch_pins_ip_extracts_text_and_redirect_rechecks(monkeypatch):
    def addresses(host,*a,**kw):
        ip = '127.0.0.1' if host == 'private.example' else '93.184.216.34'
        return [(socket.AF_INET,socket.SOCK_STREAM,0,'',(ip,443))]
    monkeypatch.setattr(socket,'getaddrinfo',addresses)
    seen = []
    class Reply:
        status_code = 200
        encoding = 'utf-8'
        headers = {'content-type':'text/html'}
        def raise_for_status(self):
            pass
        def iter_bytes(self):
            yield b'<html><title>Title</title><meta name="description" content="Description"><script>evil instructions</script><p>Content</p></html>'
    class Client:
        def __init__(self,**kw):
            assert kw['trust_env'] is False
        def __enter__(self):
            return self
        def __exit__(self,*args):
            pass
        @contextmanager
        def stream(self,method,url,**kwargs):
            seen.append((url,kwargs))
            yield Reply()
    monkeypatch.setattr(services.httpx,'Client',Client)
    result = services.fetch_page('https://public.example/page')
    assert result['title']=='Title' and result['description']=='Description' and 'evil' not in result['excerpt']
    assert seen[0][0] == 'https://93.184.216.34/page'
    assert seen[0][1]['headers']['Host']=='public.example'
    Reply.status_code = 302
    Reply.headers = {'location':'http://private.example/secret'}
    with pytest.raises(ValueError,match='public IP'):
        services.fetch_page('https://public.example/page')
    Reply.status_code = 200
    Reply.headers = {'content-type':'text/html'}
    Reply.iter_bytes = lambda self: iter([b'x'*2_000_001])
    with pytest.raises(ValueError,match='2 MB'):
        services.fetch_page('https://public.example/page')


@pytest.mark.parametrize('vector',[[],[float('nan')],[0,0],['text'],[True]])
def test_embedding_validation(monkeypatch,vector):
    monkeypatch.setattr(services,'model_request',lambda *a,**kw:{'data':[{'embedding':vector}]})
    with pytest.raises(ValueError):
        services.embed({'model':'configured','api_key':'mock'},'text')


def test_classification_rejects_excess_depth_and_sends_full_paths(monkeypatch):
    captured = []
    def model(config,endpoint,payload):
        captured.append(payload)
        return {'choices':[{'message':{'content':json.dumps({'path':['A','B','C','D'],'tags':[]})}}]}
    monkeypatch.setattr(services,'model_request',model)
    with pytest.raises(ValueError,match='path'):
        services.classify({'prompt':''},{'excerpt':'secret'},[{'id':1,'name':'A','parent_id':None},{'id':2,'name':'B','parent_id':1}],False)
    payload = json.loads(captured[0]['messages'][1]['content'])
    assert payload['existing_folders'][1]['path']==['A','B']
    assert 'excerpt' not in payload['bookmark']
