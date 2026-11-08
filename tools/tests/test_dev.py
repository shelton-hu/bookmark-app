"""The local launcher grants browser sessions without changing normal auth."""
import pytest
from fastapi.testclient import TestClient
from tools.dev import create_preview


@pytest.fixture
def preview(tmp_path, monkeypatch):
    monkeypatch.setenv('DATA_DIR', str(tmp_path / 'default'))
    return create_preview(tmp_path / 'preview', start_worker=False)


def local_client(app, **kwargs):
    return TestClient(app, base_url='http://127.0.0.1:8000', client=('127.0.0.1', 12345), **kwargs)


def test_new_browser_enters_without_credentials(preview):
    with local_client(preview) as client:
        assert client.get('/api/bookmarks').status_code == 401
        response = client.get('/')
        assert 'httponly' in response.headers['set-cookie'].lower()
        assert 'samesite=strict' in response.headers['set-cookie'].lower()
        assert response.headers['cache-control'] == 'no-store'
        assert client.get('/api/auth/status').json() == {'initialized': True, 'authenticated': True}
        assert client.get('/api/auth/me').json() == {'username': '本地预览'}
        assert client.get('/api/bookmarks').status_code == 200
        assert client.post('/api/folders', json={'name': '本地目录'}).status_code == 200
        assert client.post('/api/folders', headers={'Origin': 'https://other.example'},
                           json={'name': '跨站请求'}).status_code == 403


def test_refresh_reuses_session_and_recovers_after_logout(preview):
    with local_client(preview) as client:
        client.get('/')
        token = client.cookies.get('bookmark_session')
        assert 'set-cookie' not in client.get('/').headers
        assert client.cookies.get('bookmark_session') == token
        client.post('/api/auth/logout')
        assert client.get('/api/auth/me').status_code == 401
        client.get('/')
        assert client.cookies.get('bookmark_session') != token
        assert client.get('/api/auth/me').status_code == 200


@pytest.mark.parametrize(('base_url', 'peer', 'headers'), [
    ('http://127.0.0.1:8000', '192.168.1.2', {}),
    ('http://127.0.0.1:8000', '192.168.1.2', {'X-Forwarded-For': '127.0.0.1'}),
    ('http://other.example:8000', '127.0.0.1', {}),
])
def test_preview_rejects_nonlocal_peer_or_host(preview, base_url, peer, headers):
    with TestClient(preview, base_url=base_url, client=(peer, 12345)) as client:
        response = client.get('/', headers=headers)
        assert response.status_code == 403
        assert 'set-cookie' not in response.headers
        assert client.get('/api/auth/status', headers=headers).status_code == 403


def test_existing_preview_account_is_preserved(preview):
    store = preview.state.store
    before = store.one('SELECT * FROM account')
    second = create_preview(store.path.parent, start_worker=False)
    assert second.state.store.one('SELECT * FROM account') == before


def test_normal_app_still_requires_login(preview, tmp_path):
    from backend.main import create_app
    normal = create_app(tmp_path / 'normal', start_worker=False)
    with local_client(normal) as client:
        assert 'set-cookie' not in client.get('/').headers
        assert client.get('/api/auth/status').json() == {'initialized': False, 'authenticated': False}
        assert client.get('/api/bookmarks').status_code == 401
