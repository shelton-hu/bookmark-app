"""Runtime identity, update comparison and failure isolation; no real network."""
from concurrent.futures import ThreadPoolExecutor
import json
from unittest.mock import Mock

import httpx
import pytest
from fastapi.testclient import TestClient

from backend import version
from .test_backend import app, client


BUILD = {'version': 'v0.0.9', 'revision': 'a' * 40, 'repository': 'example/bookmark-app'}


def checker(app, monkeypatch, latest='v0.0.10'):
    service = version.VersionCheck(BUILD)
    app.state.version_check = service
    fetch = Mock(return_value=latest)
    monkeypatch.setattr(version, 'fetch_latest', fetch)
    return service, fetch


def test_version_requires_session_and_never_accepts_extension_token(client, app, monkeypatch):
    _, fetch = checker(app, monkeypatch)
    token = client.post('/api/tokens', json={'name': 'extension'}).json()['token']
    with TestClient(app) as anonymous:
        for headers in [{}, {'Authorization': 'Bearer ' + token}]:
            response = anonymous.get('/api/version?check=true', headers=headers)
            assert response.status_code == 401
            assert response.headers['cache-control'] == 'no-store'
    fetch.assert_not_called()


def test_current_version_is_immutable_build_identity_and_read_does_not_call_out(client, app, monkeypatch):
    _, fetch = checker(app, monkeypatch)
    monkeypatch.setenv('APP_VERSION', 'v99.0.0')
    response = client.get('/api/version')
    assert response.headers['cache-control'] == 'no-store'
    assert response.json() == {**BUILD, 'status': 'unchecked', 'latest_version': None,
                               'checked_at': None, 'error': None, 'release_url': None}
    fetch.assert_not_called()


@pytest.mark.parametrize('latest,status', [('v0.0.10', 'update_available'), ('v0.0.9', 'latest'), ('v0.0.8', 'ahead')])
def test_numeric_version_comparison_and_no_store(client, app, monkeypatch, latest, status):
    _, fetch = checker(app, monkeypatch, latest)
    response = client.get('/api/version?check=true')
    data = response.json()
    assert data['status'] == status and data['latest_version'] == latest
    assert data['release_url'] == f'https://github.com/example/bookmark-app/tree/{latest}'
    assert data['checked_at'] and response.headers['cache-control'] == 'no-store'
    fetch.assert_called_once_with('example/bookmark-app')


def test_success_ttl_manual_cooldown_and_expired_result_never_claims_latest(client, app, monkeypatch):
    clock = [1000.0]
    monkeypatch.setattr(version.time, 'monotonic', lambda: clock[0])
    _, fetch = checker(app, monkeypatch, 'v0.0.9')
    assert client.get('/api/version?check=true').json()['status'] == 'latest'
    client.get('/api/version?check=true&force=true')
    assert fetch.call_count == 1
    clock[0] += 61
    client.get('/api/version?check=true&force=true')
    assert fetch.call_count == 2
    clock[0] += version.SUCCESS_TTL + 1
    assert client.get('/api/version').json()['status'] == 'unknown'
    assert fetch.call_count == 2
    assert client.get('/api/version?check=true').json()['status'] == 'latest'
    assert fetch.call_count == 3


def test_failed_check_retains_only_historical_version_and_can_retry(client, app, monkeypatch):
    clock = [1000.0]
    monkeypatch.setattr(version.time, 'monotonic', lambda: clock[0])
    _, fetch = checker(app, monkeypatch, 'v0.0.9')
    client.get('/api/version?check=true')
    clock[0] += 61
    fetch.side_effect = httpx.ConnectError('private network detail must not be returned')
    data = client.get('/api/version?check=true&force=true').json()
    assert data['status'] == 'unknown' and data['latest_version'] == 'v0.0.9'
    assert 'private network' not in json.dumps(data)
    client.get('/api/version?check=true')
    assert fetch.call_count == 2
    clock[0] += version.ERROR_TTL + 1
    fetch.side_effect = None
    assert client.get('/api/version?check=true').json()['status'] == 'latest'
    assert fetch.call_count == 3


def test_concurrent_checks_share_one_request(app, monkeypatch):
    service, fetch = checker(app, monkeypatch)
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(lambda _: service.read(check=True, force=True), range(8)))
    assert all(row['status'] == 'update_available' for row in results)
    fetch.assert_called_once()


@pytest.mark.parametrize('build,disabled,status', [({}, False, 'development'),
    ({**BUILD, 'repository': ''}, False, 'disabled'),
    ({**BUILD, 'repository': '../private/host'}, False, 'disabled'),
    ({**BUILD, 'version': 'latest'}, False, 'development'), (BUILD, True, 'disabled')])
def test_disabled_invalid_source_and_development_never_contact_network(monkeypatch, build, disabled, status):
    monkeypatch.setenv('CHECK_UPDATES', 'false' if disabled else 'true')
    fetch = Mock()
    monkeypatch.setattr(version, 'fetch_latest', fetch)
    assert version.VersionCheck(build).read(check=True, force=True)['status'] == status
    fetch.assert_not_called()


def github_transport(monkeypatch, data=None, status=200, content=None):
    actual = httpx.Client
    requests = []
    def respond(request):
        requests.append(request)
        return httpx.Response(status, json=data) if content is None else httpx.Response(status, content=content)
    monkeypatch.setattr(version.httpx, 'Client', lambda **kwargs: actual(transport=httpx.MockTransport(respond), **kwargs))
    return requests


def test_github_request_is_public_only_and_ignores_nonstable_tags(monkeypatch):
    requests = github_transport(monkeypatch, [{'ref': 'refs/tags/' + value} for value in
        ['v0.0.9', 'v0.0.10', 'v1.0.0-beta', 'latest', 'v01.0.0', 'v0.1.0']])
    assert version.fetch_latest(BUILD['repository']) == 'v0.1.0'
    request = requests[0]
    assert str(request.url) == 'https://api.github.com/repos/example/bookmark-app/git/matching-refs/tags/v'
    assert not request.content and 'authorization' not in request.headers and 'cookie' not in request.headers


@pytest.mark.parametrize('data,status,content', [([], 200, None), ({'ref': 'v1.0.0'}, 200, None),
    (['malformed'], 200, None), (None, 403, None), (None, 429, None),
    (None, 302, None), (None, 200, b'not json'), (None, 200, b'x' * (1024 * 1024 + 1))])
def test_empty_invalid_rate_limited_redirect_or_oversized_response_is_unknown(monkeypatch, data, status, content):
    github_transport(monkeypatch, data, status, content)
    result = version.VersionCheck(BUILD).read(check=True)
    assert result['status'] == 'unknown' and result['error'] and result['latest_version'] is None
