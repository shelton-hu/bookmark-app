"""Immutable image identity and a bounded, anonymous public-release check."""
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import threading
import time

import httpx


STABLE = re.compile(r'v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\Z')
REPOSITORY = re.compile(r'[A-Za-z0-9][A-Za-z0-9-]{0,38}/[A-Za-z0-9_][A-Za-z0-9_.-]{0,99}\Z')
SUCCESS_TTL = 6 * 3600
ERROR_TTL = 5 * 60
MIN_INTERVAL = 60


def parts(value):
    match = STABLE.fullmatch(value) if isinstance(value, str) and len(value) <= 128 else None
    return tuple(map(int, match.groups())) if match else None


def build_info():
    try:
        data = json.loads(Path(__file__).with_name('_build.json').read_text())
        if not isinstance(data, dict):
            return {}
        return data
    except (OSError, ValueError):
        return {}


def fetch_latest(repository):
    # Repository is validated before use. No redirects, auth, cookies or user data.
    url = f'https://api.github.com/repos/{repository}/git/matching-refs/tags/v'
    with httpx.Client(timeout=httpx.Timeout(5, connect=3), follow_redirects=False, trust_env=False) as client:
        with client.stream('GET', url, headers={'Accept': 'application/vnd.github+json',
                                               'User-Agent': 'bookmark-app-update-check',
                                               'X-GitHub-Api-Version': '2022-11-28'}) as response:
            response.raise_for_status()
            body = bytearray()
            for chunk in response.iter_bytes():
                body.extend(chunk)
                if len(body) > 1024 * 1024:
                    raise ValueError('Release response too large')
    data = json.loads(body)
    if not isinstance(data, list) or any(not isinstance(row, dict) for row in data):
        raise ValueError('Invalid release response')
    versions = [row['ref'][10:] for row in data
                if isinstance(row.get('ref'), str) and row['ref'].startswith('refs/tags/')
                and parts(row['ref'][10:])]
    if not versions:
        raise ValueError('No stable releases')
    return max(versions, key=parts)


class VersionCheck:
    def __init__(self, build=None):
        data = build_info() if build is None else build
        self.version = data.get('version') if parts(data.get('version')) else 'development'
        revision = data.get('revision', '')
        self.revision = revision if isinstance(revision, str) and re.fullmatch(r'[a-f0-9]{40}', revision) else None
        repository = data.get('repository', '')
        self.repository = repository if isinstance(repository, str) and REPOSITORY.fullmatch(repository) else None
        self.enabled = os.environ.get('CHECK_UPDATES', 'true').lower() not in ('false', '0', 'no', 'off')
        self.lock = threading.Lock()
        self.last_attempt = None
        self.checked_at = None
        self.latest_version = None
        self.error = None
        self.succeeded = False

    def read(self, check=False, force=False):
        with self.lock:
            status = 'development' if self.version == 'development' else 'disabled' if not self.enabled or not self.repository else None
            now = time.monotonic()
            ttl = SUCCESS_TTL if self.succeeded else ERROR_TTL
            age = now - self.last_attempt if self.last_attempt is not None else float('inf')
            if status is None and check and age >= (MIN_INTERVAL if force else ttl):
                self.last_attempt = now
                self.checked_at = datetime.now(timezone.utc).isoformat()
                try:
                    self.latest_version = fetch_latest(self.repository)
                    self.succeeded, self.error = True, None
                except (httpx.HTTPError, ValueError, OSError):
                    self.succeeded, self.error = False, '暂时无法检查更新，请稍后重试。'
                age = 0
                ttl = SUCCESS_TTL if self.succeeded else ERROR_TTL
            if status is None:
                if self.last_attempt is None:
                    status = 'unchecked'
                elif not self.succeeded or age >= ttl:
                    status = 'unknown'
                else:
                    current, latest = parts(self.version), parts(self.latest_version)
                    status = 'update_available' if current < latest else 'ahead' if current > latest else 'latest'
            return {'version': self.version, 'revision': self.revision, 'repository': self.repository,
                    'status': status, 'latest_version': self.latest_version, 'checked_at': self.checked_at,
                    'error': self.error,
                    'release_url': f'https://github.com/{self.repository}/tree/{self.latest_version}'
                    if self.repository and self.latest_version else None}
