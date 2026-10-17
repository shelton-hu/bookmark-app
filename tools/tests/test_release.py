"""Release numbering, isolation and failure paths without registry writes."""
from contextlib import ExitStack, redirect_stdout
import io
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from tools import release as publisher


IMAGE = 'registry.example.test/team/bookmark-app'
DIGEST = 'sha256:' + 'a' * 64


def index(tag='v0.0.6', platforms=('amd64', 'arm64')):
    return {'digest': DIGEST, 'annotations': {publisher.ANNOTATION: tag},
            'manifests': [{'platform': {'os': 'linux', 'architecture': arch}} for arch in platforms]}


class VersionTests(unittest.TestCase):
    def test_semver_arithmetic_and_explicit_bumps(self):
        self.assertEqual(publisher.next_version('v0.0.9'), 'v0.0.10')
        self.assertEqual(publisher.next_version('v1.9.99', 'minor'), 'v1.10.0')
        self.assertEqual(publisher.next_version('v1.9.99', 'major'), 'v2.0.0')
        for bad in ['1.2.3', 'v01.2.3', 'v1.2', 'latest', 'v1.2.3; echo private']:
            with self.assertRaises(publisher.ReleaseError):
                publisher.version_parts(bad)
        with self.assertRaises(publisher.ReleaseError):
            publisher.next_version('v1.2.3', 'unknown')

    def test_remote_latest_wins_over_older_local_state_and_used_tags_are_skipped(self):
        def remote(ref):
            if ref.endswith(':latest'):
                return index('v0.0.10')
            return index() if ref.endswith(':v0.0.11') else None
        with patch.object(publisher, 'manifest', side_effect=remote):
            self.assertEqual(publisher.choose_version(IMAGE, 'v0.0.5'), ('v0.0.10', 'v0.0.12'))

    def test_no_overwrite_downgrade_or_unversioned_latest_guess(self):
        with patch.object(publisher, 'manifest', return_value=index('v0.0.5')):
            for tag in ['v0.0.4', 'v0.0.5', 'v0.0.6']:
                with self.assertRaises(publisher.ReleaseError):
                    publisher.choose_version(IMAGE, 'v0.0.5', explicit=tag)
        with patch.object(publisher, 'manifest', return_value={'digest': DIGEST}):
            with self.assertRaises(publisher.ReleaseError):
                publisher.choose_version(IMAGE)

    def test_authentication_and_network_errors_are_not_missing_tags(self):
        for message in ['unauthorized: authentication required', 'lookup registry: no such host', 'i/o timeout']:
            with patch.object(publisher.subprocess, 'run', return_value=subprocess.CompletedProcess([], 1, b'', message.encode())):
                with self.assertRaises(publisher.ReleaseError):
                    publisher.manifest(IMAGE + ':latest')
        with patch.object(publisher.subprocess, 'run', return_value=subprocess.CompletedProcess([], 1, b'', b'ERROR: image: not found\n')):
            self.assertIsNone(publisher.manifest(IMAGE + ':missing'))

    def test_remote_digest_and_annotations_come_from_the_exact_manifest_bytes(self):
        raw = json.dumps({'schemaVersion': 2, 'annotations': {publisher.ANNOTATION: 'v0.0.6'}, 'manifests': []}).encode()
        with patch.object(publisher.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, raw, b'')):
            result = publisher.manifest(IMAGE + ':v0.0.6')
        self.assertEqual(result['digest'], 'sha256:' + hashlib.sha256(raw).hexdigest())
        self.assertEqual(result['annotations'][publisher.ANNOTATION], 'v0.0.6')

    def test_registry_and_architecture_validation(self):
        self.assertEqual(publisher.configuration({'IMAGE': IMAGE, 'REGISTRY': 'registry.example.test'})[1], ['linux/amd64', 'linux/arm64'])
        for values in [{'IMAGE': 'ghcr.io/your-github-username/bookmark-app'},
                       {'IMAGE': IMAGE, 'REGISTRY': 'wrong.example.test'},
                       {'IMAGE': IMAGE + ':v1.0.0'},
                       {'IMAGE': IMAGE, 'PLATFORMS': 'linux/amd64,linux/amd64'}]:
            with self.assertRaises(publisher.ReleaseError):
                publisher.configuration(values)


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        subprocess.run(['git', 'init', '-q', str(self.root)], check=True)
        (self.root / '.gitignore').write_text('.release/\n.env.release\ndata/\n')
        (self.root / 'source.txt').write_text('public source\n')
        self.git('add', '.')
        self.git('-c', 'user.name=Release Test', '-c', 'user.email=release@example.test', 'commit', '-qm', 'fixture')
        self.state = self.root / '.release/state.json'
        self.contexts = ExitStack()
        self.addCleanup(self.contexts.close)
        self.output = self.contexts.enter_context(redirect_stdout(io.StringIO()))
        self.contexts.enter_context(patch.dict(os.environ, {'IMAGE': IMAGE, 'REGISTRY': 'registry.example.test',
                                                 'PLATFORMS': 'linux/amd64,linux/arm64', 'BUMP': '', 'TAG': ''}))

    def git(self, *args):
        return subprocess.check_output(['git', *args], cwd=self.root, text=True).strip()

    def seed(self):
        self.state.parent.mkdir(exist_ok=True)
        publisher.write_records(self.state, {IMAGE: {'version': 'v0.0.5', 'digest': DIGEST}})

    def test_dry_run_leaves_no_state_context_or_upload(self):
        with patch.object(publisher, 'manifest', return_value=None), patch.object(publisher, 'export_source') as export:
            publisher.release(self.root, dry_run=True)
        self.assertFalse(self.state.parent.exists())
        export.assert_not_called()
        self.assertIn('v0.0.0 → v0.0.1', self.output.getvalue())

    def test_source_snapshot_excludes_credentials_and_runtime_data(self):
        (self.root / '.env.release').write_text('IMAGE=private-local-placeholder\n')
        (self.root / 'data').mkdir()
        (self.root / 'data/bookmarks.sqlite3').write_text('synthetic runtime payload')
        destination = self.root / '.release/source'
        destination.mkdir(parents=True)
        publisher.export_source(self.root, self.git('rev-parse', 'HEAD'), destination)
        self.assertEqual((destination / 'source.txt').read_text(), 'public source\n')
        self.assertFalse((destination / '.env.release').exists())
        self.assertFalse((destination / 'data').exists())

    def test_uncommitted_code_stops_before_registry_writes(self):
        (self.root / 'source.txt').write_text('new uncommitted work')
        with patch.object(publisher, 'manifest') as remote, self.assertRaises(publisher.ReleaseError):
            publisher.release(self.root)
        remote.assert_not_called()
        self.assertFalse(self.state.exists())

    def test_build_failure_preserves_previous_success_and_never_promotes_latest(self):
        self.seed()
        before = self.state.read_bytes()
        with patch.object(publisher, 'choose_version', return_value=('v0.0.5', 'v0.0.6')), \
             patch.object(publisher, 'export_source'), \
             patch.object(publisher, 'execute', side_effect=subprocess.CalledProcessError(1, 'make')) as execute:
            with self.assertRaises(subprocess.CalledProcessError):
                publisher.release(self.root)
        self.assertEqual(self.state.read_bytes(), before)
        self.assertEqual(execute.call_count, 1)

    def test_architecture_failure_preserves_state_and_does_not_update_latest(self):
        self.seed()
        before = self.state.read_bytes()
        with patch.object(publisher, 'choose_version', return_value=('v0.0.5', 'v0.0.6')), \
             patch.object(publisher, 'export_source'), patch.object(publisher, 'execute') as execute, \
             patch.object(publisher, 'manifest', return_value=index(platforms=('arm64',))):
            with self.assertRaises(publisher.ReleaseError):
                publisher.release(self.root)
        self.assertEqual(self.state.read_bytes(), before)
        self.assertEqual(execute.call_count, 1)

    def test_verified_version_and_latest_are_recorded_atomically(self):
        self.seed()
        with patch.object(publisher, 'choose_version', return_value=('v0.0.5', 'v0.0.6')), \
             patch.object(publisher, 'export_source'), patch.object(publisher, 'execute') as execute, \
             patch.object(publisher, 'manifest', return_value=index()):
            publisher.release(self.root)
        recorded = json.loads(self.state.read_text())[IMAGE]
        self.assertEqual(recorded['version'], 'v0.0.6')
        self.assertEqual(recorded['digest'], DIGEST)
        self.assertEqual(recorded['revision'], self.git('rev-parse', 'HEAD'))
        self.assertEqual(execute.call_args_list[-1].args[0][-1], IMAGE + '@' + DIGEST)

    def test_latest_failure_does_not_write_a_success_record(self):
        self.seed()
        before = self.state.read_bytes()
        wrong = index(); wrong['digest'] = 'sha256:' + 'b' * 64
        with patch.object(publisher, 'choose_version', return_value=('v0.0.5', 'v0.0.6')), \
             patch.object(publisher, 'export_source'), patch.object(publisher, 'execute'), \
             patch.object(publisher, 'manifest', side_effect=[index(), wrong]):
            with self.assertRaises(publisher.ReleaseError):
                publisher.release(self.root)
        self.assertEqual(self.state.read_bytes(), before)

    def test_local_lock_prevents_two_publishers_reserving_the_same_version(self):
        with publisher.release_lock(self.state.parent):
            with self.assertRaises(publisher.ReleaseError):
                with publisher.release_lock(self.state.parent):
                    self.fail('Second publisher acquired the release lock')


if __name__ == '__main__':
    unittest.main()
