"""Smart import confirmation boundaries; isolated databases and no model network."""
import json
import pytest
from fastapi.testclient import TestClient
from .test_backend import app, client, save
from backend import importing


def preview(client, source, mode='preserve'):
    return client.post('/api/import/preview', files={'file': ('source.json', json.dumps(source).encode())}, data={'mode': mode})


def tree():
    return [{'type': 'folder', 'id': 1, 'title': '学习', 'children': [
        {'type': 'folder', 'id': 2, 'title': '编程', 'children': [
            {'type': 'bookmark', 'title': 'Python', 'url': 'https://example.org/python', 'tags': ['语言']},
            {'type': 'bookmark', 'title': '重复', 'url': 'https://example.org/python?utm_source=test'},
            {'type': 'bookmark', 'title': '无效', 'url': 'javascript:alert(1)'}]},
        {'type': 'folder', 'id': 3, 'title': '空目录', 'children': []}]}]


def test_preview_no_library_changes_commit_preserves_empty_folders_and_is_idempotent(client, app):
    before = client.get('/api/settings').json()
    response = preview(client, tree())
    assert response.status_code == 200, response.text
    data = response.json()
    assert data['counts'] == {'total': 3, 'importable': 1, 'duplicates': 1, 'invalid': 1, 'folders': 3}
    assert data['method'] == 'local'
    assert client.get('/api/bookmarks').json()['total'] == 0
    assert client.get('/api/folders').json() == []
    result = client.post('/api/import/commit', json={'preview_id': data['preview_id']})
    assert result.status_code == 200, result.text
    assert result.json() == {'imported': 1, 'duplicates': 1, 'folders_created': 3, 'invalid': 1}
    assert client.post('/api/import/commit', json={'preview_id': data['preview_id']}).json() == result.json()
    bookmark = client.get('/api/bookmarks').json()['items'][0]
    assert bookmark['title'] == 'Python' and bookmark['tags'] == ['语言']
    assert bookmark['source_folder'] == '学习/编程' and bookmark['preserve_import_folder']
    assert len(client.get('/api/folders').json()) == 3
    assert client.get('/api/jobs').json() == []
    # Imported file does not overwrite settings.
    assert client.get('/api/settings').json()['classification'] == before['classification']
    row = app.state.store.one('SELECT * FROM import_previews WHERE id=?', (data['preview_id'],))
    assert 'example.org' not in row['payload']


def test_reorganize_preserves_source_only_and_trash_does_not_block_import(client):
    bookmark = save(client, 'https://example.org/python', title='Already owned')
    client.delete('/api/bookmarks/' + str(bookmark['id']))
    source = tree()
    source[0]['children'][0]['children'].append({'type': 'bookmark', 'title': 'New', 'url': 'https://example.org/new'})
    response = preview(client, source, 'reorganize')
    assert response.status_code == 200, response.text
    data = response.json()
    assert data['counts']['duplicates'] == 1 and data['counts']['importable'] == 2
    assert data['items'][0]['status'] == 'new'
    result = client.post('/api/import/commit', json={'preview_id': data['preview_id']}).json()
    assert result['imported'] == 2 and result['folders_created'] == 0
    assert client.get('/api/folders').json() == []
    rows = client.get('/api/bookmarks').json()['items']
    assert len(rows) == 2 and all(row['folder_id'] is None for row in rows)
    assert all(row['source_folder'] == '学习/编程' and not row['preserve_import_folder'] for row in rows)
    assert client.get('/api/bookmarks?trash=true').json()['total'] == 1


def test_commit_rechecks_duplicates_and_does_not_replace_original_title(client):
    data = preview(client, [{'url': 'https://example.org/race', 'title': 'Imported'}]).json()
    save(client, 'https://example.org/race', title='Created since preview')
    result = client.post('/api/import/commit', json={'preview_id': data['preview_id']}).json()
    assert result['imported'] == 0 and result['duplicates'] == 1
    assert client.get('/api/bookmarks').json()['items'][0]['title'] == 'Created since preview'


def test_commit_rollback_on_late_write_failure_then_retry(client, app, monkeypatch):
    data = preview(client, tree()).json()
    original = app.state.store.execute
    def fail(query, params=()):
        if query.startswith('INSERT INTO bookmarks'):
            raise RuntimeError('simulated disk failure')
        return original(query, params)
    monkeypatch.setattr(app.state.store, 'execute', fail)
    with pytest.raises(RuntimeError, match='simulated disk failure'):
        client.post('/api/import/commit', json={'preview_id': data['preview_id']})
    assert client.get('/api/folders').json() == []
    assert client.get('/api/bookmarks').json()['total'] == 0
    assert app.state.store.one('SELECT result FROM import_previews WHERE id=?', (data['preview_id'],))['result'] is None
    monkeypatch.setattr(app.state.store, 'execute', original)
    assert client.post('/api/import/commit', json={'preview_id': data['preview_id']}).json()['imported'] == 1


def test_expiration_client_cannot_replace_urls_and_wrong_preview_kind(client, app):
    data = preview(client, [{'url': 'https://example.org/valid'}]).json()
    assert client.post('/api/import/commit', json={'preview_id': data['preview_id'], 'bookmarks': [{'url': 'https://evil.example/'}]}).status_code == 422
    app.state.store.execute('UPDATE import_previews SET expires_at=? WHERE id=?', ('2000-01-01', data['preview_id']))
    assert client.post('/api/import/commit', json={'preview_id': data['preview_id']}).status_code == 410
    assert client.post('/api/import/commit', json={'preview_id': 'not-a-preview'}).status_code == 410
    assert client.post('/api/folders/organize-apply', json={'preview_id': data['preview_id']}).status_code == 404
    assert client.get('/api/bookmarks').json()['total'] == 0


def test_auth_origin_validation_and_upload_limits(client, app):
    source = json.dumps(tree()).encode()
    with TestClient(app) as outsider:
        assert outsider.post('/api/import/preview', files={'file': ('a.json', source)}).status_code == 401
        assert outsider.post('/api/import/commit', json={'preview_id': 'anything'}).status_code == 401
        token = client.post('/api/tokens', json={'name': 'save-only'}).json()['token']
        assert outsider.post('/api/import/preview', files={'file': ('a.json', source)}, headers={'Authorization': 'Bearer ' + token}).status_code == 401
    assert client.post('/api/import/preview', files={'file': ('a.json', source)}, headers={'Origin': 'https://evil.example'}).status_code == 403
    assert preview(client, tree(), 'bad-mode').status_code == 422
    assert client.post('/api/import/preview', files={'file': ('a.txt', b'x' * 10_000_001)}).status_code == 413


def test_preview_caps_display_not_complete_import(client):
    source = [{'url': f'https://example.org/import/{i}', 'title': f'Item {i}'} for i in range(125)]
    data = preview(client, source).json()
    assert data['counts']['total'] == 125 and len(data['items']) == 100 and data['has_more']
    assert client.post('/api/import/commit', json={'preview_id': data['preview_id']}).json()['imported'] == 125
    assert client.get('/api/bookmarks').json()['total'] == 125


def test_preview_invalid_count_is_complete_beyond_display_cap(client):
    source = [{'title': f'Invalid {i}', 'url': 'javascript:alert(1)'} for i in range(125)]
    source.append({'url': 'https://example.org/valid', 'tags': [' tool ']})
    data = preview(client, source).json()
    assert data['counts'] == {'total': 126, 'importable': 1, 'duplicates': 0, 'invalid': 125, 'folders': 0}
    assert len(data['rejected']) == 50 and data['has_more']
    response = client.post('/api/import/commit', json={'preview_id': data['preview_id']})
    assert response.status_code == 200, response.text
    assert response.json()['invalid'] == 125
    assert client.get('/api/bookmarks').json()['items'][0]['tags'] == ['tool']


def test_invalid_unicode_diagnostics_remain_readable_json(client):
    data = preview(client, [{'url': 'https://example.org/unicode', 'title': '\ud800'}])
    assert data.status_code == 200, data.text
    assert data.json()['counts']['invalid'] == 1
    assert data.json()['rejected'][0]['title'] == '?'


def test_csv_unknown_columns_model_opt_in_and_local_known_columns(client, monkeypatch):
    assert client.put('/api/settings', json={'classification': {'model': 'mock', 'api_key': 'fixture-only'}}).status_code == 200
    calls = []
    def model(config, endpoint, payload):
        calls.append(payload)
        return {'choices': [{'message': {'content': json.dumps({'mapping': {
            'url': 'destination', 'title': 'caption', 'path': 'group'}})}}]}
    monkeypatch.setattr(importing.services, 'model_request', model)
    raw = 'destination,caption,group\nhttps://example.org/a,资料,工作/参考\nhttps://example.org/b,工具,工作/参考\n'.encode()
    local = client.post('/api/import/preview', files={'file': ('source.csv', raw)}).json()
    assert local['counts']['importable'] == 0 and local['warnings'] and not calls
    response = client.post('/api/import/preview', files={'file': ('source.csv', raw)}, data={'use_model': 'true'})
    assert response.status_code == 200, response.text
    data = response.json()
    assert data['counts']['importable'] == 2 and data['method'] == 'model' and calls
    assert data['items'][0]['path'] == ['工作', '参考']
    assert client.post('/api/import/commit', json={'preview_id': data['preview_id']}).json()['imported'] == 2
    calls.clear()
    response = client.post('/api/import/preview', files={'file': ('no-extension', b'title,url\nKnown,https://example.org/known\n')}, data={'use_model': 'true'})
    assert response.status_code == 200 and response.json()['method'] == 'local' and not calls


def test_local_never_calls_model_and_model_failure_leaves_no_preview(client, app, monkeypatch):
    def model(*args):
        raise AssertionError('must not call provider')
    monkeypatch.setattr(importing.services, 'model_request', model)
    assert preview(client, tree()).status_code == 200
    def fail(*args):
        raise ValueError('模型返回不完整，请重试。')
    monkeypatch.setattr(importing, 'parse_file', fail)
    before = len(app.state.store.rows('SELECT id FROM import_previews'))
    response = preview(client, tree())
    assert response.status_code == 422 and '不完整' in response.json()['detail']
    assert len(app.state.store.rows('SELECT id FROM import_previews')) == before
    assert client.get('/api/folders').json() == []
