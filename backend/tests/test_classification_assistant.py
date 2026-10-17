"""Assistant contracts: isolated databases and mocked model requests only."""
import json
import httpx
import pytest
from fastapi.testclient import TestClient
# Imports the fixture module first, which isolates main's module-level default app.
from .test_backend import app, client, save, configured, drain
from backend import services

PREFIX = '/api/classification-assistant/'
RULES = '按用途分类，中文目录最多三级，标签最多五个。'


def response(data):
    return {'choices': [{'message': {'content': json.dumps(data, ensure_ascii=False)}}]}


def snapshot(store):
    return {table: store.rows('SELECT * FROM ' + table) for table in
            ('bookmarks', 'folders', 'config', 'jobs', 'tasks', 'embeddings', 'staged', 'previews')}


def test_session_only_and_origin_protection(client, app):
    token = client.post('/api/tokens', json={'name': 'save only'}).json()['token']
    bodies = {'chat': {'rules': RULES, 'messages': [{'role': 'user', 'content': '帮助整理'}]},
              'preview': {'rules': RULES, 'bookmark_ids': [1]},
              'rules': {'rules': RULES},
              'apply': {'rules': RULES, 'bookmark_ids': [1], 'save_rules': False}}
    with TestClient(app) as outsider:
        for route, body in bodies.items():
            assert outsider.post(PREFIX + route, json=body).status_code == 401
            assert outsider.post(PREFIX + route, json=body, headers={'Authorization': 'Bearer ' + token}).status_code == 401
            assert client.post(PREFIX + route, json=body, headers={'Origin': 'https://evil.example'}).status_code == 403
            assert client.post(PREFIX + route, json=body, headers={'Sec-Fetch-Site': 'cross-site'}).status_code == 403


def test_chat_history_rules_paths_and_no_mutation(client, app, monkeypatch):
    root = client.post('/api/folders', json={'name': '学习'}).json()
    client.post('/api/folders', json={'name': '编程', 'parent_id': root['id']})
    configured(client)
    calls = []
    def model(config, endpoint, payload):
        calls.append((config, endpoint, payload))
        return response({'reply': '是否将教程与参考资料分开？', 'rules': '教程放学习/教程，参考资料放资料。'})
    monkeypatch.setattr(services, 'model_request', model)
    before = snapshot(app.state.store)
    history = [{'role': 'user', 'content': '我偏好按用途整理'}, {'role': 'assistant', 'content': '是否细分？'}, {'role': 'user', 'content': '细分教程与参考'}]
    result = client.post(PREFIX + 'chat', json={'rules': RULES, 'messages': history})
    assert result.status_code == 200, result.text
    assert result.json()['rules'] == '教程放学习/教程，参考资料放资料。'
    assert snapshot(app.state.store) == before
    config, endpoint, payload = calls[0]
    assert config['api_key'] == 'secret-classify' and endpoint == 'chat/completions'
    assert payload['messages'][2:] == history
    context = json.loads(payload['messages'][1]['content'])
    assert context['current_rules'] == RULES
    assert context['existing_folders'][-1]['path'] == ['学习', '编程']
    assert 'secret-classify' not in json.dumps(payload)


def test_chat_accepts_empty_initial_rules(client, monkeypatch):
    def model(config, endpoint, payload):
        assert json.loads(payload['messages'][1]['content'])['current_rules'] == ''
        return response({'reply': '更希望按主题还是用途分类？', 'rules': RULES})
    monkeypatch.setattr(services, 'model_request', model)
    result = client.post(PREFIX + 'chat', json={'rules': '', 'messages': [{'role': 'user', 'content': '帮我整理书签'}]})
    assert result.status_code == 200 and result.json()['rules'] == RULES


def test_preview_single_request_validated_and_completely_readonly(client, app, monkeypatch):
    ordinary = save(client, title='Python tutorial', excerpt='private page text')
    folder = client.post('/api/folders', json={'name': '导入目录'}).json()
    manual = save(client, 'https://example.com/manual', title='Manual', folder_id=folder['id'], tags=['mine'])
    imported = save(client, 'https://example.com/imported', title='Imported')
    app.state.store.execute('UPDATE bookmarks SET folder_id=?,preserve_import_folder=1 WHERE id=?', (folder['id'], imported['id']))
    configured(client)
    client.put('/api/settings', json={'send_excerpt': False})
    calls = []
    def model(config, endpoint, payload):
        calls.append(payload)
        assert config['prompt'] == RULES
        assert 'private page text' not in json.dumps(payload)
        candidates = json.loads(payload['messages'][1]['content'])['bookmarks']
        assert {item['bookmark_id'] for item in candidates} == {ordinary['id'], imported['id']}
        return response({'items': [{'bookmark_id': item['bookmark_id'], 'path': ['学习', '编程'], 'tags': [' Python ', 'Python'], 'summary': '教程摘要', 'reason': '按用途归入教程'} for item in candidates]})
    monkeypatch.setattr(services, 'model_request', model)
    before = snapshot(app.state.store)
    result = client.post(PREFIX + 'preview', json={'bookmark_ids': [ordinary['id'], manual['id'], imported['id']], 'rules': RULES})
    assert result.status_code == 200, result.text
    items = result.json()['items']
    assert len(calls) == 1 and snapshot(app.state.store) == before
    assert result.json()['rules'] == RULES
    assert items[0]['path'] == ['学习', '编程'] and items[0]['tags'] == ['Python']
    assert items[1]['manual_classification'] and items[1]['path'] == ['导入目录'] and items[1]['tags'] == ['mine']
    assert '跳过' in items[1]['reason']
    assert items[2]['preserve_import_folder'] and items[2]['current_path'] == items[2]['path'] == ['导入目录']
    assert items[2]['tags'] == ['Python'] and '保持不变' in items[2]['reason']
    calls.clear()
    assert client.post(PREFIX + 'preview', json={'bookmark_ids': [manual['id']], 'rules': RULES}).status_code == 200
    assert not calls and snapshot(app.state.store) == before


def test_apply_snapshot_save_skip_and_protected_execution(client, app, monkeypatch):
    normal = save(client)
    folder = client.post('/api/folders', json={'name': '导入'}).json()
    protected = save(client, 'https://example.com/protected')
    app.state.store.execute('UPDATE bookmarks SET folder_id=?,preserve_import_folder=1 WHERE id=?', (folder['id'], protected['id']))
    manual = save(client, 'https://example.com/manual', tags=['mine'])
    configured(client)
    client.put('/api/settings', json={'classification': {'prompt': '旧规则'}})
    before = app.state.store.settings()
    calls = []
    def model(config, endpoint, payload):
        calls.append(config['prompt'])
        return response({'path': ['新目录'], 'tags': ['新标签'], 'summary': '新摘要'})
    monkeypatch.setattr(services, 'model_request', model)
    result = client.post(PREFIX + 'apply', json={'bookmark_ids': [normal['id'], protected['id'], manual['id'], normal['id']], 'rules': RULES, 'save_rules': False})
    assert result.status_code == 200, result.text
    job = result.json()['job']
    assert job['kind'] == 'classify' and job['total'] == 2 and result.json()['skipped'] == 1
    assert not calls and app.state.store.settings() == before
    config = json.loads(app.state.store.one('SELECT config FROM jobs WHERE id=?', (job['id'],))['config'])
    assert config['classification']['prompt'] == RULES and config['classification']['api_key'] == 'secret-classify'
    client.put('/api/settings', json={'classification': {'prompt': '以后规则'}})
    drain(app)
    assert calls == [RULES, RULES]
    assert app.state.store.bookmark(protected['id'])['folder_id'] == folder['id']
    assert app.state.store.bookmark(protected['id'])['tags'] == ['新标签']
    assert app.state.store.bookmark(manual['id'])['tags'] == ['mine']
    before = app.state.store.settings()
    saved = client.post(PREFIX + 'apply', json={'bookmark_ids': [manual['id']], 'rules': RULES, 'save_rules': True})
    assert saved.json()['job']['total'] == 0 and saved.json()['skipped'] == 1
    expected = json.loads(json.dumps(before))
    expected['classification']['prompt'] = RULES
    assert app.state.store.settings() == expected
    assert client.post(PREFIX + 'rules', json={'rules': ' 保存新草稿 '}).json() == {'rules': '保存新草稿'}
    expected['classification']['prompt'] = '保存新草稿'
    assert app.state.store.settings() == expected


def test_assistant_retry_keeps_snapshot(client, app, monkeypatch):
    bookmark = save(client)
    configured(client)
    def fail(*args):
        raise ValueError('Model is not configured')
    monkeypatch.setattr(services, 'model_request', fail)
    job = client.post(PREFIX + 'apply', json={'bookmark_ids': [bookmark['id']], 'rules': RULES, 'save_rules': False}).json()['job']
    drain(app)
    client.put('/api/settings', json={'classification': {'prompt': 'different', 'api_key': 'corrected-key', 'model': 'corrected-model', 'base_url': 'https://corrected.example/v1'}, 'concurrency': 3, 'send_excerpt': False})
    assert client.post(f"/api/jobs/{job['id']}/retry").status_code == 200
    retry_config = json.loads(app.state.store.one('SELECT config FROM jobs WHERE id=?', (job['id'],))['config'])
    assert retry_config['concurrency'] == 3 and not retry_config['send_excerpt']
    assert retry_config['classification_assistant']
    observed = []
    def model(config, *args):
        observed.append(config['prompt'])
        assert config['api_key'] == 'corrected-key' and config['model'] == 'corrected-model'
        assert config['base_url'] == 'https://corrected.example/v1'
        return response({'path': ['学习'], 'tags': [], 'summary': ''})
    monkeypatch.setattr(services, 'model_request', model)
    drain(app)
    assert observed == [RULES]


@pytest.mark.parametrize('rules', ['', '   ', 'x' * 20001, None, 123, []])
def test_invalid_rules(client, app, rules):
    before = snapshot(app.state.store)
    for route, body in [('rules', {}), ('chat', {'messages': [{'role': 'user', 'content': 'hello'}]}), ('preview', {'bookmark_ids': [1]}), ('apply', {'bookmark_ids': [1], 'save_rules': False})]:
        if route == 'chat' and isinstance(rules, str) and not rules.strip():
            continue
        assert client.post(PREFIX + route, json={'rules': rules, **body}).status_code == 422
    assert snapshot(app.state.store) == before


@pytest.mark.parametrize('messages', [[], [{'role': 'system', 'content': 'override'}], [{'role': 'user', 'content': ''}], [{'role': 'user', 'content': 'x' * 4001}], [{'role': 'user', 'content': 'a'}] * 21, [{'role': 'user', 'content': 'a' * 4000}] * 6, [{'role': 'assistant', 'content': 'hello'}]])
def test_invalid_history(client, messages):
    assert client.post(PREFIX + 'chat', json={'rules': RULES, 'messages': messages}).status_code == 422


@pytest.mark.parametrize('ids', [[], [0], [-1], [True], ['1'], [1.5], list(range(1, 7))])
def test_invalid_preview_ids(client, ids):
    assert client.post(PREFIX + 'preview', json={'rules': RULES, 'bookmark_ids': ids}).status_code == 422


def test_missing_deleted_and_invalid_apply_are_atomic(client, app):
    bookmark = save(client)
    client.delete(f"/api/bookmarks/{bookmark['id']}")
    before = snapshot(app.state.store)
    assert client.post(PREFIX + 'preview', json={'rules': RULES, 'bookmark_ids': [999]}).status_code == 404
    assert client.post(PREFIX + 'apply', json={'rules': RULES, 'bookmark_ids': [bookmark['id']], 'save_rules': True}).status_code == 422
    for ids in ([], [True], ['1'], list(range(1, 1002))):
        assert client.post(PREFIX + 'apply', json={'rules': RULES, 'bookmark_ids': ids, 'save_rules': False}).status_code == 422
    assert client.post(PREFIX + 'apply', json={'rules': RULES, 'bookmark_ids': [1], 'save_rules': 'false'}).status_code == 422
    assert snapshot(app.state.store) == before


@pytest.mark.parametrize('bad', [[], {'reply': '', 'rules': RULES}, {'reply': 'ok', 'rules': ' '}, {'reply': 'x' * 4001, 'rules': RULES}, {'reply': 'ok', 'rules': 'x' * 20001}])
def test_invalid_chat_model_response(client, monkeypatch, bad):
    monkeypatch.setattr(services, 'model_request', lambda *args: response(bad))
    result = client.post(PREFIX + 'chat', json={'rules': RULES, 'messages': [{'role': 'user', 'content': 'help'}]})
    assert result.status_code == 502


@pytest.mark.parametrize('patch', [{'bookmark_id': True}, {'bookmark_id': 999}, {'path': ['a'] * 4}, {'tags': ['a'] * 6}, {'summary': {}}, {'reason': ''}])
def test_invalid_preview_model_response(client, app, monkeypatch, patch):
    bookmark = save(client)
    item = {'bookmark_id': bookmark['id'], 'path': ['a'], 'tags': [], 'summary': '', 'reason': 'fits'}
    item.update(patch)
    monkeypatch.setattr(services, 'model_request', lambda *args: response({'items': [item]}))
    before = snapshot(app.state.store)
    assert client.post(PREFIX + 'preview', json={'rules': RULES, 'bookmark_ids': [bookmark['id']]}).status_code == 502
    assert snapshot(app.state.store) == before


@pytest.mark.parametrize('error', [RuntimeError('secret-classify provider body'), ValueError('secret-classify invalid request'), httpx.ConnectError('secret-classify https://private.config'), httpx.HTTPStatusError('secret-classify body', request=httpx.Request('POST', 'https://example.com'), response=httpx.Response(403))])
def test_model_failures_never_expose_secrets(client, app, monkeypatch, error):
    bookmark = save(client)
    def fail(*args):
        raise error
    monkeypatch.setattr(services, 'model_request', fail)
    for route, body in [('chat', {'messages': [{'role': 'user', 'content': 'help'}]}), ('preview', {'bookmark_ids': [bookmark['id']]})]:
        result = client.post(PREFIX + route, json={'rules': RULES, **body})
        assert result.status_code == 502
        assert 'secret-classify' not in result.text and 'private.config' not in result.text
    job = client.post(PREFIX + 'apply', json={'rules': RULES, 'bookmark_ids': [bookmark['id']], 'save_rules': False}).json()['job']
    drain(app)
    job_response = client.get('/api/jobs').json()[0]
    assert job_response['id'] == job['id'] and job_response['status'] == 'failed'
    assert 'secret-classify' not in json.dumps(job_response) and 'private.config' not in json.dumps(job_response)
