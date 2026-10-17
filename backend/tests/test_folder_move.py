"""Whole-folder bookmark migration is scoped, previewed and atomic."""
import pytest
from fastapi.testclient import TestClient

from .test_backend import app, client, save, configured
from .test_folder_bulk_delete import folder
from backend import services


def preview(client, source, target, **extra):
    payload = {'source_folder_id': source, 'target_folder_id': target, **extra}
    response = client.post('/api/folders/move-bookmarks-preview', json=payload)
    assert response.status_code == 200, response.text
    return payload | {'snapshot': response.json()['snapshot']}, response.json()


def apply(client, payload):
    return client.post('/api/folders/move-bookmarks', json=payload)


def test_default_subtree_move_preserves_content_tree_trash_and_embeddings(client, app):
    source = folder(client, 'Source')
    child = folder(client, 'Child', source)
    target = folder(client, 'Target')
    direct = save(client, 'https://example.com/direct', folder_id=source, title='Keep title', notes='Keep notes', tags=['keep'])
    nested = save(client, 'https://example.com/nested', folder_id=child)
    untouched = save(client, 'https://example.com/target', folder_id=target)
    trash = save(client, 'https://example.com/trash', folder_id=child)
    client.delete(f"/api/bookmarks/{trash['id']}")
    store = app.state.store
    store.execute("UPDATE bookmarks SET manual_classification=0,classification_status='failed',error='old error' WHERE id=?", (nested['id'],))
    store.execute('INSERT INTO embeddings VALUES(?,?,?)', (direct['id'], '[1,0]', 'example-model'))
    tree = store.rows('SELECT * FROM folders ORDER BY id')
    before = {b['id']: store.bookmark(b['id']) for b in [direct, nested, untouched, trash]}
    payload, result = preview(client, source, target)
    assert result['bookmarks_to_move'] == 2 and result['folders_included'] == 2
    assert store.bookmark(direct['id']) == before[direct['id']]
    moved = apply(client, payload)
    assert moved.status_code == 200 and moved.json() == {'moved': 2, 'already_in_target': 0, 'folders_included': 2}
    for bookmark in [direct, nested]:
        after = store.bookmark(bookmark['id'])
        assert after['folder_id'] == target and after['manual_classification']
        assert after['classification_status'] == 'done' and after['error'] is None
        for key in set(after) - {'folder_id', 'manual_classification', 'classification_status', 'error', 'updated_at'}:
            assert after[key] == before[bookmark['id']][key], key
    assert store.bookmark(untouched['id']) == before[untouched['id']]
    assert store.bookmark(trash['id']) == before[trash['id']]
    assert store.rows('SELECT * FROM folders ORDER BY id') == tree
    assert store.one('SELECT vector FROM embeddings WHERE bookmark_id=?', (direct['id'],))['vector'] == '[1,0]'
    counts = {f['id']: f['bookmark_count'] for f in client.get('/api/folders').json()}
    assert counts == {source: 0, child: 0, target: 3}


def test_direct_scope_and_empty_directory(client, app):
    source = folder(client, 'Source')
    child = folder(client, 'Child', source)
    target = folder(client, 'Target')
    direct = save(client, 'https://example.com/direct', folder_id=source)
    nested = save(client, 'https://example.com/nested', folder_id=child)
    payload, counts = preview(client, source, target, include_children=False)
    assert counts['bookmarks_to_move'] == 1 and counts['folders_included'] == 1
    assert apply(client, payload).json()['moved'] == 1
    assert app.state.store.bookmark(direct['id'])['folder_id'] == target
    assert app.state.store.bookmark(nested['id']) == nested
    payload, counts = preview(client, source, target, include_children=False)
    assert counts['bookmarks_to_move'] == 0
    assert apply(client, payload).json()['moved'] == 0


def test_migration_covers_the_entire_folder_beyond_the_first_list_page(client):
    source = folder(client, 'More than one page')
    target = folder(client, 'Destination')
    ids = [save(client, f'https://example.com/page/{i}', folder_id=source)['id'] for i in range(25)]
    first_page = client.get(f'/api/bookmarks?folder_id={source}&view=summary&page=1&page_size=20').json()
    assert first_page['total'] == 25 and len(first_page['items']) == 20
    payload, counts = preview(client, source, target)
    assert counts['bookmarks_to_move'] == 25
    assert apply(client, payload).json()['moved'] == 25
    assert client.get(f'/api/bookmarks?folder_id={source}').json()['total'] == 0
    assert set(client.get(f'/api/bookmarks?folder_id={target}&view=ids').json()['ids']) == set(ids)


def test_target_inside_source_is_skipped_and_never_reparents_folders(client, app):
    source = folder(client, 'Parent')
    target = folder(client, 'Destination child', source)
    leaf = folder(client, 'Leaf', target)
    direct = save(client, 'https://example.com/parent', folder_id=source)
    already = save(client, 'https://example.com/already', folder_id=target)
    nested = save(client, 'https://example.com/leaf', folder_id=leaf)
    payload, counts = preview(client, source, target)
    assert counts['bookmarks_to_move'] == 2 and counts['already_in_target'] == 1
    assert apply(client, payload).json()['moved'] == 2
    assert app.state.store.bookmark(already['id']) == already
    assert all(app.state.store.bookmark(b['id'])['folder_id'] == target for b in [direct, nested])
    assert app.state.store.one('SELECT parent_id FROM folders WHERE id=?', (target,))['parent_id'] == source


@pytest.mark.parametrize('change', ['add', 'edit', 'delete', 'target', 'child'])
def test_changed_preview_rejects_whole_move(client, app, change):
    source = folder(client, 'Source')
    target = folder(client, 'Target')
    bookmark = save(client, folder_id=source)
    payload, _ = preview(client, source, target)
    if change == 'add':
        save(client, 'https://example.com/added-after-preview', folder_id=source)
    elif change == 'edit':
        client.patch(f"/api/bookmarks/{bookmark['id']}", json={'notes': 'Edited after preview'})
    elif change == 'delete':
        client.delete(f"/api/bookmarks/{bookmark['id']}")
    elif change == 'target':
        client.patch(f'/api/folders/{target}', json={'name': 'Renamed target'})
    else:
        folder(client, 'New child', source)
    before = app.state.store.rows('SELECT * FROM bookmarks ORDER BY id')
    assert apply(client, payload).status_code == 409
    assert app.state.store.rows('SELECT * FROM bookmarks ORDER BY id') == before


def test_invalid_sources_targets_and_strict_payloads_do_not_move(client, app):
    source = folder(client, 'Source')
    target = folder(client, 'Target')
    bookmark = save(client, folder_id=source)
    cases = [({'source_folder_id': source, 'target_folder_id': source}, 422),
             ({'source_folder_id': 99999, 'target_folder_id': target}, 404),
             ({'source_folder_id': source, 'target_folder_id': 99999}, 404),
             ({'source_folder_id': True, 'target_folder_id': target}, 422),
             ({'source_folder_id': str(source), 'target_folder_id': target}, 422),
             ({'source_folder_id': source, 'target_folder_id': 0}, 422),
             ({'source_folder_id': source, 'target_folder_id': target, 'include_children': 'false'}, 422)]
    for payload, status in cases:
        assert client.post('/api/folders/move-bookmarks-preview', json=payload).status_code == status
    payload, _ = preview(client, source, target)
    assert apply(client, payload | {'snapshot': 'a' * 64}).status_code == 409
    assert app.state.store.bookmark(bookmark['id']) == bookmark


def test_atomic_rollback_and_authentication(client, app, monkeypatch):
    source = folder(client, 'Source')
    target = folder(client, 'Target')
    bookmark = save(client, folder_id=source)
    payload, _ = preview(client, source, target)
    token = client.post('/api/tokens', json={'name': 'extension'}).json()['token']
    with TestClient(app) as outsider:
        for route in ['move-bookmarks-preview', 'move-bookmarks']:
            url = '/api/folders/' + route
            body = payload if route == 'move-bookmarks' else {k: v for k, v in payload.items() if k != 'snapshot'}
            assert outsider.post(url, json=body).status_code == 401
            assert outsider.post(url, json=body, headers={'Authorization': 'Bearer ' + token}).status_code == 401
            assert client.post(url, json=body, headers={'Origin': 'https://evil.example'}).status_code == 403
    original = app.state.store.execute
    def fail(query, params=()):
        result = original(query, params)
        if query.startswith('UPDATE bookmarks SET folder_id='):
            raise RuntimeError('simulated migration failure')
        return result
    monkeypatch.setattr(app.state.store, 'execute', fail)
    with pytest.raises(RuntimeError, match='simulated migration failure'):
        apply(client, payload)
    assert app.state.store.bookmark(bookmark['id']) == bookmark


def test_inflight_ai_classification_does_not_undo_manual_migration(client, app, monkeypatch):
    source = folder(client, 'Source')
    target = folder(client, 'Target')
    bookmark = save(client, folder_id=source)
    configured(client)
    job = client.post('/api/jobs', json={'kind': 'classify', 'bookmark_ids': [bookmark['id']], 'force': True})
    assert job.status_code == 200
    def classify(*args):
        payload, _ = preview(client, source, target)
        assert apply(client, payload).status_code == 200
        return {'path': ['AI choice'], 'tags': ['AI tag'], 'summary': 'AI summary'}
    monkeypatch.setattr(services, 'classify', classify)
    app.state.worker.process(app.state.worker.claim())
    after = app.state.store.bookmark(bookmark['id'])
    assert after['folder_id'] == target and after['manual_classification']
    assert after['tags'] == bookmark['tags'] and after['summary'] == bookmark['summary']
