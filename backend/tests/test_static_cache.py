"""Versioned artwork survives reloads while entry HTML still discovers new builds."""
import pytest
from fastapi.testclient import TestClient

from backend import main
from .test_backend import app


@pytest.fixture
def static_client(tmp_path, monkeypatch, app):
    project = tmp_path / 'project'
    root = project / 'web' / 'dist'
    files = {
        'index.html': '<html>current build</html>',
        'assets/index-Ab12_cd3.js': 'console.log("current");',
        'spirits/rain-restored-v3.png': 'original artwork',
        'spirits/rain-restored-v4.png': 'updated artwork',
        'clow-deck/rain.webp': 'original card',
        'clow-scene/clow-circle.svg': '<svg/>',
    }
    for path, contents in files.items():
        target = root / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(contents)
    monkeypatch.setattr(main, '__file__', str(project / 'backend' / 'main.py'))
    with TestClient(app) as client:
        yield client


@pytest.mark.parametrize('path', ['/spirits/rain-restored-v3.png', '/assets/index-Ab12_cd3.js'])
def test_immutable_assets_and_conditional_reads(static_client, path):
    response = static_client.get(path)
    assert response.status_code == 200
    assert response.headers['cache-control'] == 'public, max-age=31536000, immutable'
    cached = static_client.get(path, headers={'If-None-Match': response.headers['etag']})
    assert cached.status_code == 304
    assert cached.content == b''
    assert cached.headers['cache-control'] == response.headers['cache-control']


@pytest.mark.parametrize('path', ['/', '/index.html', '/library', '/clow-deck/rain.webp', '/clow-scene/clow-circle.svg'])
def test_unversioned_files_revalidate_without_transferring_unchanged_content(static_client, path):
    response = static_client.get(path)
    assert response.status_code == 200
    assert response.headers['cache-control'] == 'no-cache'
    assert static_client.get(path, headers={'If-None-Match': response.headers['etag']}).status_code == 304


def test_changed_html_and_new_artwork_version_are_not_hidden_by_cache(static_client, tmp_path):
    first = static_client.get('/')
    (tmp_path / 'project/web/dist/index.html').write_text('<html>new build with new asset URLs</html>')
    changed = static_client.get('/', headers={'If-None-Match': first.headers['etag']})
    assert changed.status_code == 200 and 'new build' in changed.text
    old = static_client.get('/spirits/rain-restored-v3.png')
    new = static_client.get('/spirits/rain-restored-v4.png', headers={'If-None-Match': old.headers['etag']})
    assert new.status_code == 200 and new.text == 'updated artwork'


@pytest.mark.parametrize('path', ['/spirits/missing-restored-v1.png', '/assets/index-abcdefgh.js', '/clow-deck/missing.webp'])
def test_missing_assets_never_cache_the_spa_html(static_client, path):
    response = static_client.get(path)
    assert response.status_code == 404
    assert response.headers['cache-control'] == 'no-store'
    assert 'current build' not in response.text
