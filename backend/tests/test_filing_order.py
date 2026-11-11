"""Refiled bookmarks follow the destination's existing books in every list view."""
import sqlite3

import pytest

from backend import services
from backend.bookmark_query import read_bookmarks
from backend.main import create_app
from .test_backend import app, client, configured, drain, save
from .test_folder_ai import apply as ai_apply, preview as ai_preview, response
from .test_folder_move import apply as migrate, preview as move_preview
from .test_ordering import folder, ids, move


@pytest.mark.parametrize('ordered', [False, True])
@pytest.mark.parametrize('destination', ['folder', 'inbox'])
def test_edit_appends_to_destination_and_preserves_other_positions(client, app, ordered, destination):
    source = folder(client, 'Source')
    target = folder(client, 'Target') if destination == 'folder' else None
    child = folder(client, 'Child', target) if target else None
    first = save(client, 'https://example.com/first', folder_id=target)
    nested = save(client, 'https://example.com/nested', folder_id=child)
    other = save(client, 'https://example.com/other', folder_id=source)
    incoming = save(client, 'https://example.com/incoming', folder_id=source, notes='Keep note', tags=['keep'])
    if ordered:
        assert move(client, first['id'], nested['id']).status_code == 200
    before_order = ids(client)
    before = app.state.store.rows('SELECT * FROM bookmarks ORDER BY id')
    result = client.patch(f"/api/bookmarks/{incoming['id']}", json={'folder_id': target})
    assert result.status_code == 200, result.text
    expected = [i for i in before_order if i != incoming['id']] + [incoming['id']]
    assert ids(client) == expected
    scope = {'folder_id': target, 'include_children': True} if target else {'pending': True}
    assert ids(client, **scope) == [i for i in expected if i != other['id']]
    assert [b['id'] for b in client.get('/api/bookmarks', params=scope).json()['items']] == ids(client, **scope)
    pages = [client.get('/api/bookmarks', params={**scope, 'view': 'summary', 'page': n, 'page_size': 2}).json() for n in [1, 2]]
    assert [b['id'] for page in pages for b in page['items']] == ids(client, **scope)
    for row in before:
        if row['id'] != incoming['id']:
            assert app.state.store.one('SELECT * FROM bookmarks WHERE id=?', (row['id'],)) == row
    assert result.json()['notes'] == 'Keep note' and result.json()['tags'] == ['keep']
    reopened = create_app(app.state.store.path.parent, start_worker=False)
    assert [b['id'] for b in read_bookmarks(reopened.state.store)['items']] == expected


def test_editing_in_place_does_not_reset_a_saved_position(client, app):
    target = folder(client, 'Target')
    one = save(client, 'https://example.com/one', folder_id=target)
    two = save(client, 'https://example.com/two', folder_id=target)
    move(client, one['id'], two['id'])
    before = ids(client)
    position = app.state.store.bookmark(one['id'])['sort_order']
    for payload in [{'title': 'Renamed'}, {'notes': 'Edited'}, {'folder_id': target, 'tags': ['new']}]:
        assert client.patch(f"/api/bookmarks/{one['id']}", json=payload).status_code == 200
        assert ids(client) == before
        assert app.state.store.bookmark(one['id'])['sort_order'] == position


@pytest.mark.parametrize('target_inside_source', [False, True])
def test_subtree_migration_appends_in_current_order_and_skips_existing_destination(client, app, target_inside_source):
    source = folder(client, 'Source')
    child = folder(client, 'Child', source)
    target = folder(client, 'Target', source if target_inside_source else None)
    existing = save(client, 'https://example.com/existing', folder_id=target)
    one = save(client, 'https://example.com/one', folder_id=source)
    two = save(client, 'https://example.com/two', folder_id=child)
    trash = save(client, 'https://example.com/trash', folder_id=source)
    client.delete(f"/api/bookmarks/{trash['id']}")
    move(client, one['id'], two['id'])
    moved = [one['id'], two['id']]
    before = {row['id']: row for row in app.state.store.rows('SELECT * FROM bookmarks')}
    tree = app.state.store.rows('SELECT * FROM folders ORDER BY id')
    plan, _ = move_preview(client, source, target)
    assert migrate(client, plan).json()['moved'] == 2
    assert ids(client, folder_id=target) == [existing['id'], *moved]
    for book in [existing, trash]:
        assert app.state.store.one('SELECT * FROM bookmarks WHERE id=?', (book['id'],)) == before[book['id']]
    assert app.state.store.rows('SELECT * FROM folders ORDER BY id') == tree


def test_pending_archive_files_only_selected_books_in_their_current_order(client, app):
    target = folder(client, 'Target')
    existing = save(client, 'https://example.com/existing', folder_id=target)
    one = save(client, 'https://example.com/one', notes='Keep note', tags=['keep'])
    two = save(client, 'https://example.com/two')
    other = save(client, 'https://example.com/other')
    incoming = [identifier for identifier in ids(client, pending=True) if identifier != other['id']]

    result = client.post('/api/bookmarks/archive-pending', json={
        'folder_id': target, 'bookmark_ids': [one['id'], two['id'], one['id']],
    })

    assert result.json() == {'moved': 2}
    assert ids(client, pending=True) == [other['id']]
    assert ids(client, folder_id=target) == [existing['id'], *incoming]
    for identifier in incoming:
        filed = app.state.store.bookmark(identifier)
        assert filed['manual_classification'] and filed['classification_status'] == 'done'
    filed = app.state.store.bookmark(one['id'])
    assert filed['notes'] == 'Keep note' and filed['tags'] == ['keep']


@pytest.mark.parametrize('change', ['archived', 'deleted'])
def test_pending_archive_rejects_a_stale_selection_as_one_batch(client, app, change):
    target = folder(client, 'Target')
    one = save(client, 'https://example.com/one')
    two = save(client, 'https://example.com/two')
    if change == 'archived':
        other = folder(client, 'Other')
        assert client.patch(f"/api/bookmarks/{two['id']}", json={'folder_id': other}).status_code == 200
    else:
        assert client.delete(f"/api/bookmarks/{two['id']}").status_code == 200
    before = app.state.store.rows('SELECT * FROM bookmarks ORDER BY id')

    result = client.post('/api/bookmarks/archive-pending', json={
        'folder_id': target, 'bookmark_ids': [one['id'], two['id']],
    })

    assert result.status_code == 409
    assert app.state.store.rows('SELECT * FROM bookmarks ORDER BY id') == before


@pytest.mark.parametrize('operation', ['edit', 'migrate', 'pending'])
def test_position_failure_rolls_back_filing_and_order_together(client, app, operation):
    source = folder(client, 'Source')
    target = folder(client, 'Target')
    save(client, 'https://example.com/existing', folder_id=target)
    incoming = save(client, folder_id=None if operation == 'pending' else source)
    plan, _ = move_preview(client, source, target)
    store = app.state.store
    before = store.rows('SELECT * FROM bookmarks ORDER BY id')
    config = store.settings()
    store.execute(f'''CREATE TRIGGER reject_position BEFORE UPDATE OF sort_order ON bookmarks
        WHEN NEW.id={incoming['id']} BEGIN SELECT RAISE(ABORT,'position failure'); END''')
    with pytest.raises(sqlite3.IntegrityError, match='position failure'):
        if operation == 'edit':
            client.patch(f"/api/bookmarks/{incoming['id']}", json={'folder_id': target})
        elif operation == 'migrate':
            migrate(client, plan)
        else:
            client.post('/api/bookmarks/archive-pending', json={'folder_id': target, 'bookmark_ids': [incoming['id']]})
    assert store.rows('SELECT * FROM bookmarks ORDER BY id') == before
    assert store.settings() == config


@pytest.mark.parametrize('same_folder', [False, True])
def test_background_classification_appends_only_when_folder_changes(client, app, monkeypatch, same_folder):
    target = folder(client, 'Target')
    save(client, 'https://example.com/existing', folder_id=target)
    incoming = save(client, folder_id=target) if same_folder else save(client)
    app.state.store.execute('UPDATE bookmarks SET manual_classification=0 WHERE id=?', (incoming['id'],))
    before = ids(client)
    configured(client)
    monkeypatch.setattr(services, 'classify', lambda *args: {'path': ['Target'], 'tags': [], 'summary': 'Summary'})
    assert client.post('/api/jobs', json={'kind': 'classify', 'bookmark_ids': [incoming['id']]}).status_code == 200
    drain(app)
    assert ids(client) == (before if same_folder else [*before[1:], incoming['id']])
    assert app.state.store.bookmark(incoming['id'])['folder_id'] == target


def test_reviewed_ai_moves_append_as_a_group_in_saved_order(client, app, monkeypatch):
    root = folder(client, 'Root')
    source = folder(client, 'Source', root)
    target = folder(client, 'Target', root)
    existing = save(client, 'https://example.com/existing', folder_id=target)
    incoming = [save(client, f'https://example.com/incoming/{i}', folder_id=source) for i in range(3)]
    for book in incoming:
        app.state.store.execute('UPDATE bookmarks SET manual_classification=0 WHERE id=?', (book['id'],))
    chosen = [incoming[1]['id'], incoming[0]['id']]
    before = ids(client)
    monkeypatch.setattr(services, 'model_request', lambda *args: response({'bookmarks': [
        {'bookmark_id': book['id'], 'path': ['Target']} for book in incoming]}))
    plan = ai_preview(client, root, move_bookmarks=True)
    result = ai_apply(client, plan, [f'move:{i}' for i in chosen])
    assert result.status_code == 200 and result.json()['bookmarks_moved'] == 2
    assert ids(client, folder_id=target) == [existing['id'], *[i for i in before if i in chosen]]
    assert ids(client, folder_id=source) == [incoming[2]['id']]
    after = ids(client)
    assert ai_apply(client, plan, [f'move:{i}' for i in chosen]).json() == result.json()
    assert ids(client) == after


def test_legacy_folder_merge_appends_active_books_and_preserves_trash_order(client, app, monkeypatch):
    source = folder(client, 'Source')
    target = folder(client, 'Target')
    existing = save(client, 'https://example.com/existing', folder_id=target)
    incoming = save(client, folder_id=source)
    trash = save(client, 'https://example.com/trash', folder_id=source)
    client.delete(f"/api/bookmarks/{trash['id']}")
    configured(client)
    monkeypatch.setattr(services, 'model_request', lambda *args: response({
        'changes': [{'folder_id': source, 'merge_into': target}]}))
    plan = client.post('/api/folders/organize-preview').json()
    assert client.post('/api/folders/organize-apply', json={'preview_id': plan['preview_id']}).status_code == 200
    assert ids(client, folder_id=target) == [existing['id'], incoming['id']]
    assert app.state.store.bookmark(trash['id'])['sort_order'] == trash['sort_order']
