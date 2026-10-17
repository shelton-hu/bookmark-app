"""Bulk folder deletion preserves bookmarks and surviving subtrees atomically."""
import pytest
from fastapi.testclient import TestClient
from .test_backend import app, client, save


def folder(client, name, parent=None):
    response = client.post('/api/folders', json={'name': name, 'parent_id': parent})
    assert response.status_code == 200, response.text
    return response.json()['id']


def test_nested_selection_preserves_books_trash_and_nearest_surviving_ancestor(client, app):
    root = folder(client, 'Root')
    parent = folder(client, 'Selected parent', root)
    child = folder(client, 'Selected child', parent)
    survivor = folder(client, 'Surviving grandchild', child)
    sibling = folder(client, 'Surviving sibling', parent)
    normal = save(client, 'https://example.org/parent', folder_id=parent)
    trashed = save(client, 'https://example.org/child', folder_id=child)
    untouched = save(client, 'https://example.org/survivor', folder_id=survivor)
    client.delete(f"/api/bookmarks/{trashed['id']}")
    before = app.state.store.bookmark(trashed['id'])
    payload = {'folder_ids': [child, parent, child]}
    preview = client.post('/api/folders/delete-preview', json=payload)
    expected = {'folders_deleted': 2, 'bookmarks_affected': 2, 'children_reparented': 2}
    assert preview.status_code == 200 and preview.json() == expected
    assert len(client.get('/api/folders').json()) == 5
    assert app.state.store.bookmark(normal['id'])['folder_id'] == parent
    result = client.post('/api/folders/bulk-delete', json=payload)
    assert result.status_code == 200 and result.json() == expected
    tree = {row['id']: row for row in client.get('/api/folders').json()}
    assert set(tree) == {root, survivor, sibling}
    assert tree[survivor]['parent_id'] == root and tree[sibling]['parent_id'] == root
    assert app.state.store.bookmark(normal['id'])['folder_id'] is None
    assert app.state.store.bookmark(normal['id'])['classification_status'] == 'pending'
    after = app.state.store.bookmark(trashed['id'])
    assert after['folder_id'] is None and after['deleted_at'] == before['deleted_at']
    assert app.state.store.bookmark(untouched['id']) == untouched
    assert client.get('/api/bookmarks').json()['total'] == 2
    assert client.get('/api/bookmarks?trash=true').json()['total'] == 1


def test_root_and_all_folders_delete_without_dangling_parents(client, app):
    root = folder(client, 'Root')
    child = folder(client, 'Child', root)
    leaf = folder(client, 'Leaf', child)
    b = save(client, folder_id=leaf)
    assert client.post('/api/folders/bulk-delete', json={'folder_ids': [root, child]}).json()['children_reparented'] == 1
    assert client.get('/api/folders').json()[0]['parent_id'] is None
    result = client.post('/api/folders/bulk-delete', json={'folder_ids': [leaf]})
    assert result.json()['bookmarks_affected'] == 1
    assert client.get('/api/folders').json() == []
    assert app.state.store.bookmark(b['id'])['folder_id'] is None
    assert client.get('/api/bookmarks').json()['total'] == 1


@pytest.mark.parametrize('route', ['delete-preview', 'bulk-delete'])
def test_missing_folder_rejects_entire_selection(client, route):
    identifier = folder(client, 'Kept')
    save(client, folder_id=identifier)
    response = client.post('/api/folders/' + route, json={'folder_ids': [identifier, 999999]})
    assert response.status_code == 404
    assert len(client.get('/api/folders').json()) == 1
    assert client.get('/api/bookmarks').json()['items'][0]['folder_id'] == identifier


@pytest.mark.parametrize('ids', [[], [True], ['1'], [0], [-1], [1.1]])
def test_strict_selection_validation(client, ids):
    for route in ('delete-preview', 'bulk-delete'):
        assert client.post('/api/folders/' + route, json={'folder_ids': ids}).status_code == 422


def test_atomic_rollback_after_bookmark_and_parent_updates(client, app, monkeypatch):
    root = folder(client, 'Root')
    child = folder(client, 'Child', root)
    bookmark = save(client, folder_id=root)
    original = app.state.store.execute
    def fail(query, params=()):
        if query.startswith('DELETE FROM folders'):
            raise RuntimeError('simulated folder delete failure')
        return original(query, params)
    monkeypatch.setattr(app.state.store, 'execute', fail)
    with pytest.raises(RuntimeError, match='simulated folder delete failure'):
        client.post('/api/folders/bulk-delete', json={'folder_ids': [root]})
    assert app.state.store.bookmark(bookmark['id']) == bookmark
    tree = {row['id']: row for row in client.get('/api/folders').json()}
    assert tree[child]['parent_id'] == root and len(tree) == 2


def test_session_auth_and_same_origin_required(client, app):
    identifier = folder(client, 'Protected')
    token = client.post('/api/tokens', json={'name': 'extension'}).json()['token']
    with TestClient(app) as outsider:
        for route in ('delete-preview', 'bulk-delete'):
            url = '/api/folders/' + route
            payload = {'folder_ids': [identifier]}
            assert outsider.post(url, json=payload).status_code == 401
            assert outsider.post(url, json=payload, headers={'Authorization': 'Bearer ' + token}).status_code == 401
            assert client.post(url, json=payload, headers={'Origin': 'https://evil.example'}).status_code == 403
    assert len(client.get('/api/folders').json()) == 1
