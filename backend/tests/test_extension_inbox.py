"""Extension captures wait for explicit filing even when AI is configured."""
import json

import pytest
from fastapi.testclient import TestClient

from backend import services
from .test_backend import app, client, save, configured, drain


@pytest.fixture
def extension(client, app):
    token = client.post('/api/tokens', json={'name': 'Inbox capture test'}).json()['token']
    with TestClient(app) as ext:
        ext.headers.update({'Authorization': 'Bearer ' + token, 'Origin': 'chrome-extension://inbox-test'})
        yield ext


def capture(extension, url='https://example.com/new-capture', **extra):
    response = extension.post('/api/bookmarks', json={'url': url, 'title': 'Collected page', **extra})
    assert response.status_code == 200, response.text
    return response.json()


@pytest.mark.parametrize('ai_configured', [False, True])
def test_new_capture_stays_unfiled_without_jobs_or_model_calls(extension, client, app, monkeypatch, ai_configured):
    if ai_configured:
        configured(client)
    calls = []
    monkeypatch.setattr(services, 'model_request', lambda *a, **kw: calls.append(a))
    result = capture(extension, description='Keep description', excerpt='Keep excerpt')
    bookmark = app.state.store.bookmark(result['bookmark']['id'])
    assert result == {'bookmark': {'id': bookmark['id'], 'url': bookmark['url']}, 'duplicate': False}
    assert bookmark['folder_id'] is None and bookmark['classification_status'] == 'pending'
    assert not bookmark['manual_classification']
    assert bookmark['description'] == 'Keep description' and bookmark['excerpt'] == 'Keep excerpt'
    drain(app)
    assert not calls and client.get('/api/jobs').json() == []
    assert app.state.store.bookmark(bookmark['id']) == bookmark
    assert client.get('/api/bookmarks?pending=true&view=ids').json()['ids'] == [bookmark['id']]
    assert client.get('/api/bookmarks').json()['total'] == 1


def test_existing_duplicate_keeps_original_folder_content_and_never_requeues(extension, client, app):
    configured(client)
    folder = client.post('/api/folders', json={'name': 'Filed'}).json()['id']
    original = save(client, 'https://example.com/filed', folder_id=folder, tags=['mine'], notes='Keep notes')
    result = capture(extension, 'https://example.com/filed#again', notes='Overwrite')
    assert result['duplicate'] and result['bookmark']['id'] == original['id']
    assert app.state.store.bookmark(original['id']) == original
    assert client.get('/api/bookmarks?pending=true').json()['total'] == 0
    assert client.get('/api/jobs').json() == []


def test_duplicate_retry_is_idempotent_and_cannot_undo_manual_filing(extension, client, app):
    configured(client)
    first = capture(extension)
    identifier = first['bookmark']['id']
    assert capture(extension)['duplicate']
    folder = client.post('/api/folders', json={'name': 'Reading'}).json()['id']
    filed = client.patch(f'/api/bookmarks/{identifier}', json={'folder_id': folder}).json()
    assert capture(extension)['duplicate']
    assert app.state.store.bookmark(identifier) == filed
    assert client.get('/api/bookmarks').json()['total'] == 1
    assert client.get('/api/bookmarks?pending=true').json()['total'] == 0
    assert client.get('/api/jobs').json() == []


def test_explicit_ai_job_files_capture_and_removes_it_from_inbox(extension, client, app, monkeypatch):
    configured(client)
    identifier = capture(extension)['bookmark']['id']
    assert client.get('/api/jobs').json() == []
    monkeypatch.setattr(services, 'model_request', lambda *a, **kw: {'choices': [{'message': {
        'content': json.dumps({'path': ['Reading'], 'tags': ['learn'], 'summary': 'A useful page'})}}]})
    job = client.post('/api/jobs', json={'kind': 'classify', 'bookmark_ids': [identifier]}).json()
    assert job['total'] == 1
    drain(app)
    bookmark = app.state.store.bookmark(identifier)
    assert bookmark['folder_id'] is not None and bookmark['classification_status'] == 'done'
    assert client.get('/api/bookmarks?pending=true').json()['total'] == 0
    assert client.get('/api/bookmarks').json()['total'] == 1


def test_recollecting_a_trashed_url_creates_one_new_inbox_capture(extension, client, app):
    configured(client)
    original = capture(extension)['bookmark']['id']
    client.delete(f'/api/bookmarks/{original}')
    fresh = capture(extension)
    assert not fresh['duplicate'] and fresh['bookmark']['id'] != original
    assert client.get('/api/bookmarks?pending=true').json()['total'] == 1
    assert client.get('/api/bookmarks?trash=true').json()['total'] == 1
    assert client.get('/api/jobs').json() == []


def test_browser_session_save_retains_existing_auto_classification_behavior(client, app):
    configured(client)
    bookmark = save(client, 'https://example.com/browser-session')
    assert client.get('/api/jobs').json()[0]['total'] == 1
    assert app.state.store.rows('SELECT bookmark_id FROM tasks') == [{'bookmark_id': bookmark['id']}]
