"""AI suggestions use synthetic data and mocked providers, never real bookmarks."""
import json

import pytest
from fastapi.testclient import TestClient

from .test_backend import app, client, save, configured
from .test_folder_bulk_delete import folder
from backend import services

PREFIX = '/api/folders/ai-organize-'


def response(data):
    return {'choices': [{'message': {'content': json.dumps(data)}}]}


def setup(client, app):
    root = folder(client, '工作')
    child = folder(client, '常用工具', root)
    outside = folder(client, '个人')
    bookmark = save(client, 'https://example.com/tool', title='工具 - 首页', folder_id=child, notes='Keep notes', tags=['keep'])
    app.state.store.execute('UPDATE bookmarks SET manual_classification=0 WHERE id=?', (bookmark['id'],))
    return root, child, outside, bookmark


def preview(client, root, **options):
    result = client.post(PREFIX + 'preview', json={'folder_id': root, **options})
    assert result.status_code == 200, result.text
    return result.json()


def apply(client, plan, selected=None):
    return client.post(PREFIX + 'apply', json={'preview_id': plan['preview_id'],
        'selected': selected if selected is not None else [item['id'] for item in plan['items']]})


def test_scope_privacy_preview_and_independent_field_selection(client, app, monkeypatch):
    root, child, outside, bookmark = setup(client, app)
    save(client, 'https://example.com/outside', folder_id=outside, notes='OUTSIDE SECRET')
    trash = save(client, 'https://example.com/trash', folder_id=child, notes='TRASH SECRET')
    client.delete(f"/api/bookmarks/{trash['id']}")
    configured(client)
    client.put('/api/settings', json={'send_excerpt': False})
    def model(config, endpoint, payload):
        context = json.loads(payload['messages'][1]['content'])
        assert context['root_path'] == ['工作']
        assert {f['folder_id'] for f in context['folders']} == {root, child}
        assert [b['bookmark_id'] for b in context['bookmarks']] == [bookmark['id']]
        assert 'excerpt' not in context['bookmarks'][0]
        assert 'OUTSIDE SECRET' not in json.dumps(context) and 'TRASH SECRET' not in json.dumps(context)
        return response({'folders': [{'folder_id': child, 'name': '开发工具'}],
                         'bookmarks': [{'bookmark_id': bookmark['id'], 'title': '工具 · 控制台', 'path': ['新目录']}]})
    monkeypatch.setattr(services, 'model_request', model)
    store = app.state.store
    original = store.bookmark(bookmark['id'])
    before = store.rows('SELECT * FROM bookmarks ORDER BY id')
    tree = store.rows('SELECT * FROM folders ORDER BY id')
    plan = preview(client, root, move_bookmarks=True)
    assert plan['bookmarks_count'] == 1 and plan['folders_count'] == 1
    assert len(plan['items']) == 3
    assert store.rows('SELECT * FROM bookmarks ORDER BY id') == before
    assert store.rows('SELECT * FROM folders ORDER BY id') == tree
    result = apply(client, plan, [f"title:{bookmark['id']}"])
    assert result.status_code == 200 and result.json()['bookmarks_renamed'] == 1
    updated = store.bookmark(bookmark['id'])
    assert updated['title'] == '工具 · 控制台' and updated['folder_id'] == child
    assert store.rows('SELECT * FROM folders ORDER BY id') == tree
    for key in set(updated) - {'title', 'updated_at'}:
        assert updated[key] == original[key]
    assert apply(client, plan, [f"title:{bookmark['id']}"]).json() == result.json()
    assert apply(client, plan).status_code == 409


@pytest.mark.parametrize('protection', ['manual_classification', 'preserve_import_folder'])
def test_protected_assignment_stays_but_title_can_be_explicitly_renamed(client, app, monkeypatch, protection):
    root, child, _, bookmark = setup(client, app)
    app.state.store.execute(f'UPDATE bookmarks SET {protection}=1 WHERE id=?', (bookmark['id'],))
    monkeypatch.setattr(services, 'model_request', lambda *args: response({'bookmarks': [
        {'bookmark_id': bookmark['id'], 'title': '工具 · 文档', 'path': ['新目录']}]}))
    plan = preview(client, root, move_bookmarks=True)
    assert plan['protected_count'] == 1 and [item['kind'] for item in plan['items']] == ['title']
    assert apply(client, plan).status_code == 200
    assert app.state.store.bookmark(bookmark['id'])['folder_id'] == child
    assert app.state.store.bookmark(bookmark['id'])['title'] == '工具 · 文档'


def test_stable_target_ids_survive_deselected_directory_rename(client, app, monkeypatch):
    root, child, _, bookmark = setup(client, app)
    target = folder(client, '文档', root)
    app.state.store.execute('INSERT INTO embeddings VALUES(?,?,?)', (bookmark['id'], '[1,0]', 'test'))
    monkeypatch.setattr(services, 'model_request', lambda *args: response({
        'folders': [{'folder_id': target, 'name': '技术文档'}],
        'bookmarks': [{'bookmark_id': bookmark['id'], 'path': ['文档']}]}))
    plan = preview(client, root, move_bookmarks=True)
    assert apply(client, plan, [f"move:{bookmark['id']}"]).status_code == 200
    updated = app.state.store.bookmark(bookmark['id'])
    assert updated['folder_id'] == target and updated['manual_classification']
    assert app.state.store.one('SELECT name FROM folders WHERE id=?', (target,))['name'] == '文档'
    assert app.state.store.one('SELECT * FROM embeddings WHERE bookmark_id=?', (bookmark['id'],))


def test_create_scoped_new_paths_only_when_moves_selected(client, app, monkeypatch):
    root, _, outside, bookmark = setup(client, app)
    monkeypatch.setattr(services, 'model_request', lambda *args: response({
        'bookmarks': [{'bookmark_id': bookmark['id'], 'path': ['文档', '接口']}]}))
    plan = preview(client, root, move_bookmarks=True)
    assert apply(client, plan).json() == {'folders_renamed': 0, 'bookmarks_renamed': 0, 'bookmarks_moved': 1, 'folders_created': 2}
    updated = app.state.store.bookmark(bookmark['id'])
    leaf = app.state.store.one('SELECT * FROM folders WHERE id=?', (updated['folder_id'],))
    parent = app.state.store.one('SELECT * FROM folders WHERE id=?', (leaf['parent_id'],))
    assert leaf['name'] == '接口' and parent['name'] == '文档' and parent['parent_id'] == root


@pytest.mark.parametrize('change', ['edit', 'move', 'add', 'trash', 'rename', 'reparent', 'delete_root'])
def test_stale_preview_has_no_partial_effects(client, app, monkeypatch, change):
    root, child, outside, bookmark = setup(client, app)
    monkeypatch.setattr(services, 'model_request', lambda *args: response({
        'folders': [{'folder_id': child, 'name': '开发工具'}],
        'bookmarks': [{'bookmark_id': bookmark['id'], 'title': '工具'}]}))
    plan = preview(client, root)
    if change == 'edit':
        client.patch(f"/api/bookmarks/{bookmark['id']}", json={'notes': 'concurrent edit'})
    elif change == 'move':
        client.patch(f"/api/bookmarks/{bookmark['id']}", json={'folder_id': outside})
    elif change == 'add':
        save(client, 'https://example.com/new', folder_id=child)
    elif change == 'trash':
        client.delete(f"/api/bookmarks/{bookmark['id']}")
    elif change == 'rename':
        client.patch(f'/api/folders/{child}', json={'name': '新名字'})
    elif change == 'reparent':
        client.patch(f'/api/folders/{child}', json={'parent_id': outside})
    else:
        client.delete(f'/api/folders/{root}')
    store = app.state.store
    before = {table: store.rows('SELECT * FROM ' + table + ' ORDER BY id') for table in ['folders', 'bookmarks']}
    assert apply(client, plan).status_code == 409
    assert {table: store.rows('SELECT * FROM ' + table + ' ORDER BY id') for table in before} == before


@pytest.mark.parametrize('kind', ['root', 'outside', 'bad_id', 'parent', 'disabled_title', 'disabled_move', 'traversal', 'depth', 'duplicate'])
def test_untrusted_model_proposals_rejected(client, app, monkeypatch, kind):
    root, child, outside, bookmark = setup(client, app)
    data = {'folders': [], 'bookmarks': []}
    options = {'move_bookmarks': True}
    if kind in ('root', 'outside', 'parent'):
        data['folders'] = [{'folder_id': root if kind == 'root' else outside if kind == 'outside' else child, 'name': '名称'}]
        if kind == 'parent':
            data['folders'][0]['parent_id'] = outside
    elif kind == 'bad_id':
        data['bookmarks'] = [{'bookmark_id': 99999, 'title': 'other'}]
    else:
        item = {'bookmark_id': bookmark['id']}
        if kind == 'disabled_title':
            options['rename_bookmarks'] = False
            item['title'] = 'new'
        else:
            item['path'] = ['..'] if kind == 'traversal' else ['一', '二', '三'] if kind == 'depth' else []
        if kind == 'disabled_move':
            options['move_bookmarks'] = False
        data['bookmarks'] = [item, item] if kind == 'duplicate' else [item]
    monkeypatch.setattr(services, 'model_request', lambda *args: response(data))
    before = app.state.store.rows('SELECT * FROM bookmarks')
    result = client.post(PREFIX + 'preview', json={'folder_id': root, **options})
    assert result.status_code == 502, result.text
    assert app.state.store.rows('SELECT * FROM bookmarks') == before
    assert not app.state.store.rows('SELECT * FROM folder_ai_previews')


def test_batching_covers_all_pages_direct_scope_and_no_invented_ids(client, app, monkeypatch):
    root, _, _, bookmark = setup(client, app)
    ids = [save(client, f'https://example.com/direct/{i}', folder_id=root)['id'] for i in range(24)]
    calls = []
    def model(config, endpoint, payload):
        content = json.loads(payload['messages'][1]['content'])
        calls.append(content)
        return response({'bookmarks': [{'bookmark_id': b['bookmark_id'], 'title': f"资料 {b['bookmark_id']}"} for b in content['bookmarks']]})
    monkeypatch.setattr(services, 'model_request', model)
    plan = preview(client, root, include_children=False, rename_folders=False)
    assert plan['folders_count'] == 0 and plan['bookmarks_count'] == 24
    assert len(calls) == 2
    assert {b['bookmark_id'] for call in calls for b in call['bookmarks']} == set(ids)
    assert bookmark['id'] not in {item['entity_id'] for item in plan['items']}
    assert apply(client, plan).json()['bookmarks_renamed'] == 24


def test_generation_concurrent_edit_is_rejected(client, app, monkeypatch):
    root, _, _, bookmark = setup(client, app)
    def model(*args):
        app.state.store.execute('UPDATE bookmarks SET notes=? WHERE id=?', ('changed during model call', bookmark['id']))
        return response({'bookmarks': [{'bookmark_id': bookmark['id'], 'title': '新标题'}]})
    monkeypatch.setattr(services, 'model_request', model)
    result = client.post(PREFIX + 'preview', json={'folder_id': root})
    assert result.status_code == 409
    assert not app.state.store.rows('SELECT * FROM folder_ai_previews')


def test_directory_only_request_is_bounded_and_never_sends_other_branches(client, app, monkeypatch):
    root, child, _, bookmark = setup(client, app)
    for i in range(25):
        save(client, f'https://example.com/rename-only/{i}', folder_id=child)
    calls = []
    def model(config, endpoint, payload):
        context = json.loads(payload['messages'][1]['content'])
        calls.append(context)
        return response({'folders': [{'folder_id': child, 'name': '开发工具'}]})
    monkeypatch.setattr(services, 'model_request', model)
    before = app.state.store.rows('SELECT * FROM bookmarks ORDER BY id')
    plan = preview(client, root, rename_bookmarks=False)
    assert len(calls) == 1 and len(calls[0]['bookmarks']) == 20
    assert apply(client, plan).json()['folders_renamed'] == 1
    assert app.state.store.rows('SELECT * FROM bookmarks ORDER BY id') == before


def test_later_batch_failure_never_stores_or_applies_earlier_suggestions(client, app, monkeypatch):
    root, child, _, bookmark = setup(client, app)
    for i in range(21):
        save(client, f'https://example.com/failure/{i}', folder_id=child)
    calls = []
    def model(config, endpoint, payload):
        context = json.loads(payload['messages'][1]['content'])
        calls.append(context)
        if len(calls) == 2:
            raise RuntimeError('provider failure')
        return response({'bookmarks': [{'bookmark_id': b['bookmark_id'], 'title': 'new title'} for b in context['bookmarks']]})
    monkeypatch.setattr(services, 'model_request', model)
    before = app.state.store.rows('SELECT * FROM bookmarks ORDER BY id')
    assert client.post(PREFIX + 'preview', json={'folder_id': root}).status_code == 502
    assert len(calls) == 2 and not app.state.store.rows('SELECT * FROM folder_ai_previews')
    assert app.state.store.rows('SELECT * FROM bookmarks ORDER BY id') == before


def test_collision_and_expiry_and_tampered_selection_are_atomic(client, app, monkeypatch):
    root, child, _, bookmark = setup(client, app)
    folder(client, '已有名称', root)
    monkeypatch.setattr(services, 'model_request', lambda *args: response({
        'folders': [{'folder_id': child, 'name': '已有名称'}],
        'bookmarks': [{'bookmark_id': bookmark['id'], 'title': '不能部分写入'}]}))
    plan = preview(client, root)
    assert apply(client, plan).status_code == 422
    assert app.state.store.bookmark(bookmark['id'])['title'] == bookmark['title']
    assert apply(client, plan, ['title:999']).status_code == 422
    assert apply(client, plan, [f"title:{bookmark['id']}"] * 2).status_code == 422
    app.state.store.execute('UPDATE folder_ai_previews SET expires_at=?', ('2000-01-01',))
    assert apply(client, plan).status_code == 409


def test_session_only_csrf_no_provider_error_leak(client, app, monkeypatch):
    root, *_ = setup(client, app)
    token = client.post('/api/tokens', json={'name': 'capture only'}).json()['token']
    with TestClient(app) as outsider:
        assert outsider.post(PREFIX + 'preview', json={'folder_id': root}).status_code == 401
        assert outsider.post(PREFIX + 'preview', json={'folder_id': root}, headers={'Authorization': 'Bearer ' + token}).status_code == 401
        assert outsider.post(PREFIX + 'apply', json={'preview_id': 'a' * 32, 'selected': ['title:1']}).status_code == 401
    assert client.post(PREFIX + 'preview', json={'folder_id': root}, headers={'Origin': 'https://evil.example'}).status_code == 403
    def fail(*args):
        raise RuntimeError('Bearer SECRET with private internal hostname')
    monkeypatch.setattr(services, 'model_request', fail)
    error = client.post(PREFIX + 'preview', json={'folder_id': root})
    assert error.status_code == 502 and 'SECRET' not in error.text
    assert client.post(PREFIX + 'preview', json={'folder_id': True}).status_code == 422
    assert client.post(PREFIX + 'preview', json={'folder_id': root, 'rename_folders': False, 'rename_bookmarks': False}).status_code == 422
