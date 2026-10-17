"""Scoped, bounded list reads use synthetic data and no model/network worker."""
import json
from contextlib import contextmanager

import pytest
from fastapi.testclient import TestClient

from backend import services
from .test_backend import app, client, save


def seed(app, count, folder_id=None):
    with app.state.store.connect() as db:
        start = db.execute('SELECT COALESCE(MAX(id),0) FROM bookmarks').fetchone()[0]
        db.executemany('''INSERT INTO bookmarks
            (url,title,description,excerpt,summary,notes,folder_id,tags,source_folder,
             classification_status,manual_classification,deleted_at,created_at,updated_at)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)''', [
            (f'https://example.com/benchmark/{i}', f'Bookmark {i}', 'Description',
             'Synthetic body ' * 200, 'Summary', 'Notes', folder_id,
             json.dumps(['阅读', 'Exact']), '', 'pending', 0, None,
             '2026-10-17T00:00:00Z', '2026-10-17T00:00:00Z') for i in range(start, start + count)
        ])


def test_pages_cover_all_results_and_clamp_after_deletion(client, app):
    seed(app, 45)
    pages = [client.get('/api/bookmarks', params={
        'page': page, 'page_size': 20, 'view': 'summary', 'include_ids': True,
    }).json() for page in (1, 2, 3)]
    assert [len(page['items']) for page in pages] == [20, 20, 5]
    assert all(page['total'] == 45 for page in pages)
    ids = [item['id'] for page in pages for item in page['items']]
    assert len(set(ids)) == 45
    assert all(page['ids'] == ids for page in pages)
    for identifier in ids[40:]:
        client.delete(f'/api/bookmarks/{identifier}')
    last = client.get('/api/bookmarks?page=3&page_size=20&view=summary').json()
    assert (last['page'], last['total'], len(last['items'])) == (2, 40, 20)
    empty = client.get('/api/bookmarks?page=100&folder_id=99999&include_children=true').json()
    assert (empty['page'], empty['total'], empty['items']) == (1, 0, [])


def test_summary_omits_heavy_fields_and_detail_preserves_complete_record(client, app):
    seed(app, 1)
    complete = client.get('/api/bookmarks').json()['items'][0]
    summary = client.get('/api/bookmarks?view=summary').json()['items'][0]
    assert summary['details_loaded'] is False
    assert not {'description', 'excerpt', 'summary', 'notes', 'error'} & summary.keys()
    assert summary['tags'] == ['阅读', 'Exact']
    assert type(summary['manual_classification']) is bool
    assert type(summary['preserve_import_folder']) is bool
    identifier = complete['id']
    assert client.get(f'/api/bookmarks/{identifier}').json() == complete
    client.delete(f'/api/bookmarks/{identifier}')
    assert client.get(f'/api/bookmarks/{identifier}').json()['deleted_at']
    assert client.get('/api/bookmarks/999999').status_code == 404
    with TestClient(app) as anonymous:
        assert anonymous.get(f'/api/bookmarks/{identifier}').status_code == 401
        assert anonymous.get('/api/bookmarks?view=ids').status_code == 401
    token = client.post('/api/tokens', json={'name': 'test'}).json()['token']
    with TestClient(app) as extension:
        assert extension.get(f'/api/bookmarks/{identifier}', headers={'Authorization': 'Bearer ' + token}).status_code == 401


@pytest.mark.parametrize('query', ['page=0', 'page=-1', 'page=abc', 'page_size=0', 'page_size=101', 'view=unknown'])
def test_invalid_page_parameters_are_rejected(client, query):
    assert client.get('/api/bookmarks?' + query).status_code == 422


def test_scoped_pages_ids_and_counts_agree_with_descendants_tags_and_trash(client, app):
    root = client.post('/api/folders', json={'name': 'Root'}).json()['id']
    child = client.post('/api/folders', json={'name': 'Child', 'parent_id': root}).json()['id']
    seed(app, 25, child)
    outside = save(client, 'https://example.com/outside', title='Bookmark outside', tags=['阅读'])
    rows = client.get('/api/bookmarks?folder_id=' + str(child)).json()['items']
    trashed = rows[0]['id']
    client.delete(f'/api/bookmarks/{trashed}')
    params = dict(folder_id=root, include_children=True, tag='阅读', q='bookmark',
                  view='summary', page=2, page_size=10, include_ids=True)
    result = client.get('/api/bookmarks', params=params).json()
    assert (result['total'], len(result['items'])) == (24, 10)
    assert outside['id'] not in result['ids'] and trashed not in result['ids']
    assert result['ids'][10:20] == [item['id'] for item in result['items']]
    trash = client.get('/api/bookmarks', params={**params, 'trash': True}).json()
    assert (trash['page'], trash['total'], trash['ids']) == (1, 1, [trashed])
    assert client.get('/api/bookmarks', params={**params, 'pending': True}).json()['total'] == 0
    # Legacy cycles must terminate and keep the same scope.
    app.state.store.execute('UPDATE folders SET parent_id=? WHERE id=?', (child, root))
    assert client.get('/api/bookmarks', params=params).json()['ids'] == result['ids']


def test_keyword_search_retains_unicode_casefold_literal_substrings_and_decoded_tags(client):
    first = save(client, 'https://example.com/one', title='Straße 100%_done', tags=['阅读资料'])
    second = save(client, 'https://example.com/two', excerpt='正文中的独有关键词', notes='Note phrase')
    def ids(q, **kwargs):
        return client.get('/api/bookmarks', params={'q': q, 'view': 'ids', **kwargs}).json()['ids']
    for q in ('STRASSE', '100%_', '阅读资料'):
        assert ids(q) == [first['id']]
    for q in ('独有关键词', 'NOTE PHRASE'):
        assert ids(q) == [second['id']]
    assert ids("%' OR 1=1 --") == []
    assert ids('', tag='阅读资料') == [first['id']]
    assert ids('', tag='阅读') == []


def test_read_query_count_does_not_grow_with_bookmark_count(client, app, monkeypatch):
    original = app.state.store.connect
    statements = []
    @contextmanager
    def observed():
        with original() as db:
            db.set_trace_callback(statements.append)
            try:
                yield db
            finally:
                db.set_trace_callback(None)
    monkeypatch.setattr(app.state.store, 'connect', observed)
    for count in (10, 500):
        seed(app, count)
        for params in ({}, {'page': 1, 'view': 'summary'},
                       {'page': 2, 'view': 'summary', 'include_ids': True, 'q': 'body'}):
            statements.clear()
            result = client.get('/api/bookmarks', params=params)
            assert result.status_code == 200
            reads = [sql for sql in statements if sql.lstrip().upper().startswith('SELECT')]
            assert len(reads) <= 4, reads[:10]


def test_semantic_pagination_ranks_before_slicing_and_fallback_keeps_filters(client, app, monkeypatch):
    low = save(client, 'https://example.com/low', title='Needle low')
    high = save(client, 'https://example.com/high', title='Needle high')
    missing = save(client, 'https://example.com/missing', title='Other')
    cfg = app.state.store.settings()
    cfg['index_status'].update(active_config={'model': 'synthetic', 'api_key': 'test'}, dimension=2)
    app.state.store.set_settings(cfg)
    app.state.store.execute('INSERT INTO embeddings VALUES(?,?,?)', (low['id'], '[0,1]', 'synthetic'))
    app.state.store.execute('INSERT INTO embeddings VALUES(?,?,?)', (high['id'], '[1,0]', 'synthetic'))
    calls = []
    def embed(*args):
        calls.append(args)
        return [1, 0]
    monkeypatch.setattr(services, 'embed', embed)
    result = client.get('/api/bookmarks?q=Needle&mode=semantic&page=1&page_size=1&view=summary&include_ids=true').json()
    assert len(calls) == 1
    assert result['ids'] == [high['id'], low['id'], missing['id']]
    assert [item['id'] for item in result['items']] == [high['id']]
    assert result['total'] == 3 and 'not indexed' in result['warning']
    monkeypatch.setattr(services, 'embed', lambda *args: (_ for _ in ()).throw(ValueError('model down')))
    fallback = client.get('/api/bookmarks?q=Needle&mode=semantic&page=10&page_size=1&view=summary&include_ids=true').json()
    assert fallback['total'] == 2 and fallback['page'] == 2
    assert set(fallback['ids']) == {low['id'], high['id']}
    assert 'using keyword search' in fallback['warning']


def test_semantic_page_turn_reuses_vector_but_new_search_and_configuration_do_not(client, app, monkeypatch):
    seed(app, 3)
    cfg = app.state.store.settings()
    cfg['index_status'].update(active_config={'model': 'first', 'api_key': 'test'}, dimension=2)
    app.state.store.set_settings(cfg)
    calls = []
    def embed(config, q):
        calls.append((config['model'], q))
        return [1, 0]
    monkeypatch.setattr(services, 'embed', embed)
    params = dict(q='synthetic', mode='semantic', view='summary', page_size=1, search_id='search-one')
    for page in (1, 2, 3):
        assert client.get('/api/bookmarks', params={**params, 'page': page}).status_code == 200
    assert calls == [('first', 'synthetic')]
    client.get('/api/bookmarks', params={**params, 'search_id': 'search-two'})
    assert len(calls) == 2
    cfg['index_status']['active_config']['model'] = 'second'
    app.state.store.set_settings(cfg)
    client.get('/api/bookmarks', params=params)
    assert calls[-1] == ('second', 'synthetic') and len(calls) == 3
