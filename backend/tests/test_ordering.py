"""Display ordering never changes filing, content revisions, jobs, or trash."""
import json
import sqlite3

import pytest
from fastapi.testclient import TestClient

from backend.main import create_app
from backend.store import Store
from backend.bookmark_query import read_bookmarks
from .test_backend import app, client, save
from .test_bookmark_queries import seed


def ids(client, **params):
    response = client.get('/api/bookmarks', params={'view': 'ids', **params})
    assert response.status_code == 200, response.text
    return response.json()['ids']


def move(client, identifier, target, placement='before'):
    return client.post('/api/bookmarks/reorder', json={
        'bookmark_id': identifier, 'target_id': target, 'placement': placement})


def folder(client, name, parent=None):
    return client.post('/api/folders', json={'name': name, 'parent_id': parent}).json()['id']


def without_order(rows):
    return [{key: value for key, value in row.items() if key != 'sort_order'} for row in rows]


def test_bookmark_order_is_shared_by_pages_scopes_and_legacy_views(client, app):
    root = folder(client, 'Root')
    child = folder(client, 'Child', root)
    seed(app, 45, child)
    initial = ids(client)
    last, first = initial[-1], initial[0]
    assert move(client, last, first).status_code == 200
    expected = [last, *initial[:-1]]
    assert ids(client) == expected
    assert ids(client, folder_id=root, include_children=True) == expected
    assert ids(client, q='bookmark', tag='阅读') == expected
    full = client.get('/api/bookmarks').json()['items']
    assert [row['id'] for row in full] == expected
    pages = [client.get('/api/bookmarks', params={'view': 'summary', 'page': page, 'include_ids': True}).json() for page in (1, 2, 3)]
    assert [row['id'] for page in pages for row in page['items']] == expected
    assert all(page['ids'] == expected for page in pages)
    assert move(client, last, initial[-2], 'after').status_code == 200
    assert ids(client) == initial
    reopened = create_app(app.state.store.path.parent, start_worker=False)
    assert [row['id'] for row in read_bookmarks(reopened.state.store)['items']] == initial


def test_sorting_preserves_content_revisions_jobs_embeddings_and_filing(client, app):
    collected = folder(client, 'Collected')
    one = save(client, 'https://example.com/one', folder_id=collected, title='First', notes='Private note', tags=['tag'])
    two = save(client, 'https://example.com/two', title='Second')
    app.state.store.execute('INSERT INTO embeddings VALUES(?,?,?)', (one['id'], '[1,0]', 'model'))
    books = without_order(app.state.store.rows('SELECT * FROM bookmarks ORDER BY id'))
    jobs = app.state.store.rows('SELECT * FROM jobs')
    config = app.state.store.settings()
    assert move(client, two['id'], one['id']).status_code == 200
    assert without_order(app.state.store.rows('SELECT * FROM bookmarks ORDER BY id')) == books
    assert app.state.store.rows('SELECT * FROM jobs') == jobs
    assert app.state.store.settings() == config
    assert app.state.store.rows('SELECT * FROM embeddings') == [{'bookmark_id': one['id'], 'vector': '[1,0]', 'model': 'model'}]
    assert ids(client, pending=True) == [two['id']]


def test_new_bookmarks_lead_and_duplicate_collection_does_not_reset_order(client, app):
    seed(app, 3)
    initial = ids(client)
    move(client, initial[-1], initial[0])
    ordered = ids(client)
    latest = save(client, 'https://example.com/new')
    assert ids(client) == [latest['id'], *ordered]
    duplicate = client.post('/api/bookmarks', json={'url': latest['url']}).json()
    assert duplicate['duplicate'] and ids(client) == [latest['id'], *ordered]
    assert move(client, latest['id'], ordered[-1], 'after').status_code == 200
    assert ids(client) == [*ordered, latest['id']]


def test_trash_is_excluded_and_stale_drag_has_zero_writes(client, app):
    seed(app, 4)
    initial = ids(client)
    client.delete(f'/api/bookmarks/{initial[-1]}')
    before = app.state.store.rows('SELECT * FROM bookmarks ORDER BY id')
    for identifier, target in [(initial[-1], initial[0]), (initial[0], initial[-1]), (99999, initial[0])]:
        assert move(client, identifier, target).status_code == 409
        assert app.state.store.rows('SELECT * FROM bookmarks ORDER BY id') == before
    assert move(client, initial[2], initial[0]).status_code == 200
    assert ids(client, trash=True) == [initial[-1]]


def test_mid_write_failure_rolls_back_the_entire_bookmark_order(client, app):
    seed(app, 4)
    initial = ids(client)
    before = app.state.store.rows('SELECT * FROM bookmarks ORDER BY id')
    app.state.store.execute(f'''CREATE TRIGGER fail_display_order BEFORE UPDATE OF sort_order ON bookmarks
        WHEN NEW.id={initial[1]} BEGIN SELECT RAISE(ABORT,'synthetic failure'); END''')
    with pytest.raises(sqlite3.IntegrityError, match='synthetic failure'):
        move(client, initial[-1], initial[0])
    assert app.state.store.rows('SELECT * FROM bookmarks ORDER BY id') == before
    assert ids(client) == initial


@pytest.mark.parametrize('body', [
    {'bookmark_id': True, 'target_id': 2, 'placement': 'before'},
    {'bookmark_id': '1', 'target_id': 2, 'placement': 'after'},
    {'bookmark_id': 0, 'target_id': 2, 'placement': 'before'},
    {'bookmark_id': 1, 'target_id': 2, 'placement': 'sideways'},
])
def test_invalid_bookmark_reorder_is_rejected(client, body):
    assert client.post('/api/bookmarks/reorder', json=body).status_code == 422


def test_semantic_score_still_wins_over_manual_display_order(client, app):
    seed(app, 2)
    first, second = ids(client)
    with app.state.store.connect() as db:
        db.executemany('INSERT INTO embeddings VALUES(?,?,?)', [(first, '[0,1]', 'model'), (second, '[1,0]', 'model')])
    assert move(client, first, second).status_code == 200
    result = read_bookmarks(app.state.store, vector=[1, 0])
    assert [row['id'] for row in result['items']] == [second, first]


def test_folders_sort_only_siblings_and_keep_subtrees_and_counts(client, app):
    one, two, three = [folder(client, name) for name in ('One', 'Two', 'Three')]
    child = folder(client, 'Child', one)
    save(client, folder_id=child)
    initial = without_order(app.state.store.rows('SELECT * FROM folders ORDER BY id'))
    response = client.post('/api/folders/reorder', json={'parent_id': None, 'folder_ids': [three, one, two]})
    assert response.status_code == 200
    rows = {row['id']: row for row in client.get('/api/folders').json()}
    assert [rows[i]['sort_order'] for i in (three, one, two)] == [0, 1, 2]
    assert rows[child]['parent_id'] == one and rows[one]['bookmark_count'] == 1
    assert without_order(app.state.store.rows('SELECT * FROM folders ORDER BY id')) == initial
    # A rename preserves its manual position; an explicit parent change appends it to its new siblings.
    assert client.patch(f'/api/folders/{three}', json={'name': 'Renamed'}).json()['sort_order'] == 0
    moved = client.patch(f'/api/folders/{three}', json={'parent_id': one}).json()
    assert moved['parent_id'] == one and moved['sort_order'] is None


def test_folder_reorder_rejects_missing_new_or_cross_parent_entries_atomically(client, app):
    one, two = folder(client, 'One'), folder(client, 'Two')
    child = folder(client, 'Child', one)
    before = app.state.store.rows('SELECT * FROM folders ORDER BY id')
    for data, status in [
        ({'folder_ids': [one, one]}, 422),
        ({'folder_ids': [one]}, 409),
        ({'folder_ids': [one, child]}, 409),
        ({'parent_id': one, 'folder_ids': [child, two]}, 409),
        ({'parent_id': '1', 'folder_ids': [child]}, 422),
    ]:
        assert client.post('/api/folders/reorder', json=data).status_code == status
        assert app.state.store.rows('SELECT * FROM folders ORDER BY id') == before
    third = folder(client, 'Third')
    assert client.post('/api/folders/reorder', json={'folder_ids': [two, one]}).status_code == 409
    assert client.post('/api/folders/reorder', json={'folder_ids': [third, two, one]}).status_code == 200


def test_ordering_endpoints_require_session_and_origin_checks(client, app):
    body = {'bookmark_id': 1, 'target_id': 2, 'placement': 'before'}
    with TestClient(app) as anonymous:
        assert anonymous.post('/api/bookmarks/reorder', json=body).status_code == 401
        assert anonymous.post('/api/folders/reorder', json={'folder_ids': [1]}).status_code == 401
    assert client.post('/api/bookmarks/reorder', json=body, headers={'Origin': 'https://evil.example'}).status_code == 403
    token = client.post('/api/tokens', json={'name': 'extension'}).json()['token']
    with TestClient(app) as extension:
        assert extension.post('/api/bookmarks/reorder', json=body, headers={'Authorization': 'Bearer ' + token}).status_code == 401


def test_backup_round_trip_preserves_manual_positions_and_legacy_backups(client, app, tmp_path):
    roots = [folder(client, name) for name in ('One', 'Two')]
    seed(app, 3, roots[0])
    before = ids(client)
    move(client, before[-1], before[0])
    client.post('/api/folders/reorder', json={'folder_ids': roots[::-1]})
    backup = client.get('/api/export/json').json()
    target = create_app(tmp_path / 'restored', start_worker=False)
    with TestClient(target) as restored:
        restored.post('/api/auth/setup', json={'username': 'restored', 'password': 'safe-password'})
        assert restored.post('/api/import/json', files={'file': ('backup.json', json.dumps(backup))}).status_code == 200
        assert [row['url'] for row in restored.get('/api/bookmarks').json()['items']] == [row['url'] for row in client.get('/api/bookmarks').json()['items']]
        assert {row['name']: row['sort_order'] for row in restored.get('/api/folders').json()} == {'Two': 0, 'One': 1}
    for rows in (backup['folders'], backup['bookmarks']):
        for row in rows:
            row.pop('sort_order', None)
    assert client.post('/api/import/json', files={'file': ('legacy.json', json.dumps(backup))}).status_code == 200
    backup['bookmarks'][0]['sort_order'] = True
    assert client.post('/api/import/json', files={'file': ('bad.json', json.dumps(backup))}).status_code == 422


def test_legacy_database_migration_adds_nullable_positions_without_changing_data(tmp_path):
    directory = tmp_path / 'legacy'
    directory.mkdir()
    with sqlite3.connect(directory / 'bookmarks.sqlite3') as db:
        db.execute('CREATE TABLE folders(id INTEGER PRIMARY KEY,name TEXT NOT NULL,parent_id INTEGER)')
        db.execute("INSERT INTO folders VALUES(1,'Legacy',NULL)")
    store = Store(directory)
    assert store.rows('SELECT * FROM folders') == [{'id': 1, 'name': 'Legacy', 'parent_id': None, 'sort_order': None}]
    assert Store(directory).rows('SELECT * FROM folders') == store.rows('SELECT * FROM folders')
