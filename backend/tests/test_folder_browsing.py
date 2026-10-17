"""Folder browsing uses isolated databases and never starts a model worker."""
import pytest
from .test_backend import app, client, save


@pytest.fixture
def hierarchy(client):
    def folder(name, parent=None):
        response = client.post('/api/folders', json={'name': name, 'parent_id': parent})
        assert response.status_code == 200, response.text
        return response.json()['id']

    root = folder('Root')
    child = folder('Child', root)
    grandchild = folder('Grandchild', child)
    sibling = folder('Sibling', root)
    neighbor = folder('Neighbor')
    empty = folder('Empty', root)
    folders = dict(root=root, child=child, grandchild=grandchild,
                   sibling=sibling, neighbor=neighbor, empty=empty)
    bookmarks = {
        name: save(client, f'https://example.com/{name}', title=title,
                   folder_id=folders.get(name), tags=['reading'])
        for name, title in [('root', 'Other'), ('child', 'Needle child'),
                            ('grandchild', 'Needle deep'), ('sibling', 'Other'),
                            ('neighbor', 'Needle outside'), ('unfiled', 'Needle unfiled')]
    }
    bookmarks['trash'] = save(client, 'https://example.com/trash',
                              title='Needle trash', folder_id=grandchild)
    assert client.delete(f"/api/bookmarks/{bookmarks['trash']['id']}").status_code == 200
    return folders, bookmarks


def browse(client, **params):
    response = client.get('/api/bookmarks', params=params)
    assert response.status_code == 200, response.text
    result = response.json()
    assert result['total'] == len(result['items'])
    return {bookmark['id'] for bookmark in result['items']}


def counts(client):
    response = client.get('/api/folders')
    assert response.status_code == 200, response.text
    assert all(type(folder['bookmark_count']) is int for folder in response.json())
    return {folder['id']: folder['bookmark_count'] for folder in response.json()}


def test_folder_filter_default_remains_exact(client, hierarchy):
    folders, bookmarks = hierarchy
    expected = {bookmarks['root']['id']}
    assert browse(client, folder_id=folders['root']) == expected
    assert browse(client, folder_id=folders['root'], include_children=False) == expected
    assert browse(client, folder_id=999999) == set()
    assert browse(client, folder_id=999999, include_children=True) == set()
    assert browse(client, include_children=True) == browse(client)


def test_folder_filter_includes_all_descendants(client, hierarchy):
    folders, bookmarks = hierarchy
    assert browse(client, folder_id=folders['root'], include_children=True) == {
        bookmarks[name]['id'] for name in ('root', 'child', 'grandchild', 'sibling')
    }
    assert browse(client, folder_id=folders['child'], include_children=True) == {
        bookmarks[name]['id'] for name in ('child', 'grandchild')
    }
    assert browse(client, folder_id=folders['empty'], include_children=True) == set()


def test_descendant_filter_intersects_search_tags_and_trash(client, hierarchy):
    folders, bookmarks = hierarchy
    params = {'folder_id': folders['root'], 'include_children': True, 'q': 'needle'}
    assert browse(client, **params) == {bookmarks[name]['id'] for name in ('child', 'grandchild')}
    assert browse(client, **params, tag='missing') == set()
    assert browse(client, **params, trash=True) == {bookmarks['trash']['id']}
    assert browse(client, folder_id=folders['root'], trash=True) == set()
    assert counts(client) == {folders[name]: count for name, count in
                              [('root', 4), ('child', 2), ('grandchild', 1),
                               ('sibling', 1), ('neighbor', 1), ('empty', 0)]}


def test_folder_counts_update_after_delete_and_restore(client, hierarchy):
    folders, bookmarks = hierarchy
    before = counts(client)
    identifier = bookmarks['grandchild']['id']
    assert client.delete(f'/api/bookmarks/{identifier}').status_code == 200
    after = counts(client)
    for name in ('root', 'child', 'grandchild'):
        assert after[folders[name]] == before[folders[name]] - 1
    for name in ('neighbor', 'sibling', 'empty'):
        assert after[folders[name]] == before[folders[name]]
    assert client.post(f'/api/bookmarks/{identifier}/restore').status_code == 200
    assert counts(client) == before


def test_pending_list_follows_folder_assignment_instead_of_model_status(client, app):
    folder = client.post('/api/folders', json={'name': 'Collected'}).json()['id']
    unfiled = set()
    for status in ('pending', 'done', 'failed'):
        for folder_id in (None, folder):
            bookmark = save(client, f'https://example.com/{status}/{folder_id}', folder_id=folder_id)
            app.state.store.execute('UPDATE bookmarks SET classification_status=? WHERE id=?', (status, bookmark['id']))
            if folder_id is None:
                unfiled.add(bookmark['id'])
    assert browse(client, pending=True) == unfiled
    assert browse(client, pending=True, folder_id=folder, include_children=True) == set()
    identifier = next(iter(unfiled))
    assert client.delete(f'/api/bookmarks/{identifier}').status_code == 200
    assert browse(client, pending=True) == unfiled - {identifier}
    assert browse(client, pending=True, trash=True) == {identifier}


def test_manual_folder_assignment_finishes_filing_on_create_and_edit(client):
    folder = client.post('/api/folders', json={'name': 'Collected'}).json()['id']
    filed = save(client, 'https://example.com/filed', folder_id=folder)
    assert filed['manual_classification'] and filed['classification_status'] == 'done'
    unfiled = save(client, 'https://example.com/unfiled')
    assert browse(client, pending=True) == {unfiled['id']}
    response = client.patch(f"/api/bookmarks/{unfiled['id']}", json={'folder_id': folder})
    assert response.status_code == 200
    assert response.json()['classification_status'] == 'done'
    assert browse(client, pending=True) == set()
    assert client.patch(f"/api/bookmarks/{unfiled['id']}", json={'folder_id': None}).status_code == 200
    assert browse(client, pending=True) == {unfiled['id']}


def test_folder_browsing_tolerates_existing_cycles(client, app, hierarchy):
    folders, bookmarks = hierarchy
    # Simulate legacy/corrupt data; normal folder mutation APIs reject cycles.
    app.state.store.execute('UPDATE folders SET parent_id=? WHERE id=?',
                            (folders['grandchild'], folders['root']))
    expected = {bookmarks[name]['id'] for name in ('root', 'child', 'grandchild', 'sibling')}
    for name in ('root', 'child', 'grandchild'):
        assert browse(client, folder_id=folders[name], include_children=True) == expected
        assert counts(client)[folders[name]] == 4
    assert counts(client)[folders['neighbor']] == 1
