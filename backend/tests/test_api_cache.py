"""Private API reads and mutation results must not survive in HTTP caches."""
import pytest
from fastapi.testclient import TestClient

from .test_backend import app, client, save


def uncacheable(response, status=200):
    assert response.status_code == status
    assert 'no-store' in response.headers.get('cache-control', '').lower()


@pytest.mark.parametrize('path,status', [
    ('/api/health', 200),
    ('/api/auth/status', 200),
    ('/api/auth/me', 401),
    ('/api/bookmarks', 401),
    ('/api/missing-endpoint', 404),
])
def test_public_and_anonymous_api_responses_cannot_be_cached(app, path, status):
    with TestClient(app) as anonymous:
        uncacheable(anonymous.get(path), status)


def test_authenticated_lists_and_errors_cannot_be_cached(client):
    uncacheable(client.get('/api/bookmarks?view=summary&page=1'))
    uncacheable(client.get('/api/bookmarks/999999'), 404)
    uncacheable(client.get('/api/bookmarks?page=0'), 422)
    uncacheable(client.delete('/api/bookmarks/999999', headers={'Origin': 'https://evil.example'}), 403)


def test_same_list_url_reflects_delete_and_restore_without_stored_responses(client):
    bookmark = save(client, 'https://example.com/synthetic-schedule', title='Example schedule')
    url = '/api/bookmarks?q=schedule&view=summary&page=1&page_size=20&include_ids=true'
    before = client.get(url)
    uncacheable(before)
    assert before.json()['ids'] == [bookmark['id']]
    uncacheable(client.delete(f"/api/bookmarks/{bookmark['id']}"))
    after = client.get(url)
    uncacheable(after)
    assert after.json()['items'] == []
    assert after.json()['total'] == 0
    assert after.json()['ids'] == []
    trash = client.get(url + '&trash=true')
    uncacheable(trash)
    assert trash.json()['ids'] == [bookmark['id']]
    uncacheable(client.post(f"/api/bookmarks/{bookmark['id']}/restore"))
    restored = client.get(url)
    uncacheable(restored)
    assert restored.json()['ids'] == [bookmark['id']]
