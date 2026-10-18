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
    expected = {'folders_deleted': 2, 'bookmarks_affected': 2, 'children_reparented': 2,
                'active_bookmarks_affected': 1, 'trashed_bookmarks_affected': 1,
                'descendant_bookmarks_preserved': 1}
    assert preview.status_code == 200
    counts = preview.json()
    snapshot = counts.pop('snapshot')
    assert counts == expected and len(snapshot) == 64
    assert len(client.get('/api/folders').json()) == 5
    assert app.state.store.bookmark(normal['id'])['folder_id'] == parent
    result = client.post('/api/folders/bulk-delete', json={**payload, 'snapshot': snapshot})
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


def test_management_counts_distinguish_direct_books_from_descendants_and_exclude_trash(client):
    root = folder(client, 'Root')
    child = folder(client, 'Child', root)
    empty = folder(client, 'Empty')
    save(client, 'https://example.com/root', folder_id=root)
    save(client, 'https://example.com/child', folder_id=child)
    removed = save(client, 'https://example.com/trash', folder_id=root)
    client.delete(f"/api/bookmarks/{removed['id']}")
    save(client, 'https://example.com/unfiled')
    rows = {row['id']: row for row in client.get('/api/folders').json()}
    assert (rows[root]['bookmark_count'], rows[root]['direct_bookmark_count']) == (2, 1)
    assert (rows[child]['bookmark_count'], rows[child]['direct_bookmark_count']) == (1, 1)
    assert (rows[empty]['bookmark_count'], rows[empty]['direct_bookmark_count']) == (0, 0)
    preview = client.post('/api/folders/delete-preview', json={'folder_ids': [root]}).json()
    assert preview['active_bookmarks_affected'] == 1 and preview['trashed_bookmarks_affected'] == 1
    assert preview['descendant_bookmarks_preserved'] == 1


@pytest.mark.parametrize('change', ['new_direct', 'new_descendant', 'renamed', 'reparented', 'same_count_replacement'])
def test_stale_confirmation_rejects_without_partial_deletion(client, app, change):
    root = folder(client, 'Root')
    child = folder(client, 'Child', root)
    other = folder(client, 'Other')
    original = save(client, 'https://example.com/one', folder_id=root)
    replacement = save(client, 'https://example.com/two', folder_id=other)
    payload = {'folder_ids': [root]}
    preview = client.post('/api/folders/delete-preview', json=payload).json()
    if change == 'new_direct':
        save(client, 'https://example.com/new', folder_id=root)
    elif change == 'new_descendant':
        save(client, 'https://example.com/new-child', folder_id=child)
    elif change == 'renamed':
        client.patch(f'/api/folders/{root}', json={'name': 'Changed name'})
    elif change == 'reparented':
        client.patch(f'/api/folders/{child}', json={'parent_id': other})
    else:
        client.patch(f"/api/bookmarks/{original['id']}", json={'folder_id': other})
        client.patch(f"/api/bookmarks/{replacement['id']}", json={'folder_id': root})
    before_books = app.state.store.rows('SELECT * FROM bookmarks ORDER BY id')
    before_folders = app.state.store.rows('SELECT * FROM folders ORDER BY id')
    response = client.post('/api/folders/bulk-delete', json={**payload, 'snapshot': preview['snapshot']})
    assert response.status_code == 409 and '重新核对' in response.json()['detail']
    assert app.state.store.rows('SELECT * FROM bookmarks ORDER BY id') == before_books
    assert app.state.store.rows('SELECT * FROM folders ORDER BY id') == before_folders


def test_rechecking_updated_scope_allows_delete_while_unrelated_changes_do_not_block(client, app):
    root = folder(client, 'Root')
    other = folder(client, 'Other')
    old = client.post('/api/folders/delete-preview', json={'folder_ids': [root]}).json()
    kept = save(client, 'https://example.com/new', folder_id=root)
    fresh = client.post('/api/folders/delete-preview', json={'folder_ids': [root]}).json()
    assert fresh['snapshot'] != old['snapshot'] and fresh['active_bookmarks_affected'] == 1
    save(client, 'https://example.com/unrelated', folder_id=other)
    response = client.post('/api/folders/bulk-delete', json={'folder_ids': [root], 'snapshot': fresh['snapshot']})
    assert response.status_code == 200
    assert app.state.store.bookmark(kept['id'])['folder_id'] is None
    assert client.get('/api/bookmarks').json()['total'] == 2


@pytest.mark.parametrize('snapshot', ['', 'not-a-snapshot', 'f' * 63, True])
def test_malformed_snapshot_never_deletes(client, snapshot):
    identifier = folder(client, 'Kept')
    assert client.post('/api/folders/bulk-delete', json={'folder_ids': [identifier], 'snapshot': snapshot}).status_code == 422
    assert len(client.get('/api/folders').json()) == 1
