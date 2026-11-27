import importlib.util
import json
import pathlib
import plistlib
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

spec = importlib.util.spec_from_file_location(
    'release_native', pathlib.Path(__file__).parents[1] / 'scripts/release-native.py')
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class NextTag(unittest.TestCase):
    def test_counts_up_within_a_version(self):
        tags = ['v0.2.0-native.1', 'v0.2.0-native.10', 'v0.1.0-native.99', 'other']
        self.assertEqual(release.next_tag('0.2.0', tags), 'v0.2.0-native.11')

    def test_starts_at_one(self):
        self.assertEqual(release.next_tag('0.3.0', ['v0.2.0-native.4']), 'v0.3.0-native.1')


class NotarizedRelease(unittest.TestCase):
    identity = 'Developer ID Application: Wing Fixture (FIXTURE123)'
    profile = 'wing-notary-fixture'

    def test_notarization_requires_apple_signing_before_building(self):
        with mock.patch('sys.argv', ['release-native.py', '--notarize', '--allow-dirty']), \
             mock.patch.dict('os.environ', {
                 'WING_CHROMIUM_BUILD': 'fixture',
                 'WING_SIGN_IDENTITY': 'Wing Release Signing',
                 'WING_NOTARY_PROFILE': 'fixture',
             }, clear=True), mock.patch.object(release, 'run') as run:
            with self.assertRaisesRegex(SystemExit, 'Developer ID Application'):
                release.main()
            run.assert_not_called()

    def test_unavailable_identity_does_not_contact_the_notary_service(self):
        with mock.patch.dict('os.environ', {
            'WING_SIGN_IDENTITY': self.identity,
            'WING_NOTARY_PROFILE': self.profile,
        }), mock.patch.object(release, 'run') as run:
            run.return_value.stdout = '1) AAAAAAAAAA "Developer ID Application: Another Team (FIXTURE123)"'
            with self.assertRaisesRegex(SystemExit, 'not available'):
                release.notarization_credentials()
            run.assert_called_once_with('security', 'find-identity', '-v', '-p', 'codesigning', capture_output=True)

    def test_invalid_notary_profile_is_rejected_during_preflight(self):
        with mock.patch.dict('os.environ', {
            'WING_SIGN_IDENTITY': self.identity,
            'WING_NOTARY_PROFILE': self.profile,
        }), mock.patch.object(release, 'run') as run:
            run.side_effect = [
                subprocess.CompletedProcess([], 0, stdout=f'1) AAAAAAAAAA "{self.identity}"'),
                subprocess.CalledProcessError(1, 'notarytool'),
            ]
            with self.assertRaisesRegex(SystemExit, 'Could not authenticate'):
                release.notarization_credentials()
            self.assertEqual(run.call_args.args[:3], ('xcrun', 'notarytool', 'history'))

    def test_notarization_packages_the_stapled_app_before_submitting_the_dmg(self):
        with tempfile.TemporaryDirectory() as temp, mock.patch.object(release, 'run') as run:
            directory = pathlib.Path(temp)
            app = directory / 'Wing.app'
            archive = directory / 'Wing.zip'
            image = directory / 'Wing.dmg'

            def command(*args, **_):
                if args[:3] == ('ditto', '-c', '-k'):
                    args[-1].touch()
                return subprocess.CompletedProcess([], 0, stdout=json.dumps({'status': 'Accepted'}))

            run.side_effect = command
            release.package_app(app, archive, image, (self.identity, self.profile))
            commands = [call.args for call in run.call_args_list]
            submission = archive.with_name('Wing-notary-submission.zip')
            steps = [
                ('xcrun', 'notarytool', 'submit', submission),
                ('xcrun', 'stapler', 'staple', app),
                ('xcrun', 'stapler', 'validate', app),
                ('ditto', '-c', '-k', '--sequesterRsrc', '--keepParent', app, archive),
                ('ditto', '-x', '-k', archive),
                ('codesign', '--sign', self.identity, '--timestamp', '--identifier', 'org.wingbrowser.Wing.DMG', image),
                ('xcrun', 'notarytool', 'submit', image),
                ('xcrun', 'stapler', 'staple', image),
                ('xcrun', 'stapler', 'validate', image),
            ]
            positions = [next(i for i, call in enumerate(commands) if call[:len(step)] == step)
                         for step in steps]
            self.assertEqual(positions, sorted(positions))
            self.assertFalse(submission.exists())

    def test_rejected_notary_submission_stops_packaging(self):
        with tempfile.TemporaryDirectory() as temp, mock.patch.object(release, 'run') as run:
            directory = pathlib.Path(temp)
            run.return_value.stdout = json.dumps({'status': 'Invalid', 'id': 'fixture-submission'})
            with self.assertRaisesRegex(SystemExit, 'fixture-submission'):
                release.package_app(directory / 'Wing.app', directory / 'Wing.zip',
                                    directory / 'Wing.dmg', (self.identity, self.profile))
            self.assertEqual(run.call_count, 2)
            self.assertEqual(run.call_args.args[:3], ('xcrun', 'notarytool', 'submit'))

    def test_failed_verified_package_keeps_the_previous_dist(self):
        with tempfile.TemporaryDirectory() as temp, mock.patch.object(release, 'ROOT', pathlib.Path(temp)):
            dist = release.ROOT / 'dist'
            dist.mkdir()
            previous = dist / 'previous.dmg'
            previous.write_bytes(b'previous release')
            with mock.patch.object(release, 'package_app', side_effect=SystemExit('Rejected DMG')):
                with self.assertRaisesRegex(SystemExit, 'Rejected DMG'):
                    release.package_release({'arm64': release.ROOT / 'Wing.app'},
                                            'v0.2.0-native.1', (self.identity, self.profile))
            self.assertEqual(list(dist.iterdir()), [previous])
            self.assertEqual(previous.read_bytes(), b'previous release')


class ReleaseSigning(unittest.TestCase):
    def test_developer_id_timestamps_and_hardens_all_native_targets(self):
        scripts = pathlib.Path(__file__).resolve().parents[1] / 'scripts'
        spec = importlib.util.spec_from_file_location('build_preview', scripts / 'build-chromium-preview.py')
        build = importlib.util.module_from_spec(spec)
        with mock.patch.object(sys, 'path', [str(scripts), *sys.path]):
            spec.loader.exec_module(build)

        with tempfile.TemporaryDirectory() as temp, mock.patch.object(build, 'run') as run:
            stage = pathlib.Path(temp)
            app = stage / 'Wing.app'
            framework = app / 'Contents/Frameworks/Chromium Framework.framework'
            sparkle = app / 'Contents/Frameworks/Sparkle.framework'
            libraries = framework / 'Versions/Current/Libraries'
            helpers = framework / 'Versions/Current/Helpers'
            libraries.mkdir(parents=True)
            helpers.mkdir(parents=True)
            (libraries / 'fixture.dylib').touch()
            (helpers / 'fixture.app').mkdir()
            build.sign_app(app, stage, framework, sparkle, NotarizedRelease.identity)
            commands = [call.args for call in run.call_args_list]
            signatures = commands[:-1]
            self.assertEqual(len(signatures), 9)
            for signature in signatures:
                self.assertEqual(signature[2:7], ('--timestamp', '--options', 'runtime',
                                                 '--sign', NotarizedRelease.identity))
            self.assertEqual(pathlib.Path(signatures[0][-1]).name, 'node')
            self.assertEqual(pathlib.Path(signatures[-1][-1]), app)
            self.assertEqual(commands[-1], ('codesign', '--verify', '--deep', '--strict', str(app)))
            self.assertEqual(plistlib.loads((stage / 'node-entitlements.plist').read_bytes()),
                             {'com.apple.security.cs.allow-jit': True})


class PublishPreflight(unittest.TestCase):
    def test_checks_sparkle_before_publishing_and_reuses_verified_artifacts(self):
        with tempfile.TemporaryDirectory() as folder:
            root = pathlib.Path(folder)
            (root / 'package.json').write_text('{"version":"0.2.0"}')
            for relative, body in [
                ('native/chromium/cloud.json', '{"domain":"updates.example"}'),
                ('native/build/chromium-production/latest.json', '{"app":"Wing.app"}'),
            ]:
                file = root / relative
                file.parent.mkdir(parents=True, exist_ok=True)
                file.write_text(body)
            dist = root / 'dist'
            effects = mock.Mock()
            publisher = effects.publisher
            publisher.prepare_uploads.side_effect = SystemExit('Sparkle signature rejected')
            publisher.publish.side_effect = SystemExit('Sparkle signature rejected')
            archive = dist / 'Wing-arm64.zip'
            with mock.patch.object(release, 'ROOT', root), \
                 mock.patch('sys.argv', ['release-native.py', '--publish', '--notes', 'notes.md']), \
                 mock.patch.dict('os.environ', {'WING_CHROMIUM_BUILD': 'fixture'}, clear=True), \
                 mock.patch.dict(sys.modules, {'publish_updates': publisher}), \
                 mock.patch.object(release, 'run', effects.run), \
                 mock.patch.object(release, 'output', return_value=''), \
                 mock.patch.object(release, 'qualify'), \
                 mock.patch.object(release, 'package_release',
                                   return_value=(dist, [archive])):
                with self.assertRaisesRegex(SystemExit, 'Sparkle signature rejected'):
                    release.main()
                self.assertFalse(any(call.args[:2] == ('git', 'push') or
                                     call.args[:3] == ('gh', 'release', 'create')
                                     for call in effects.run.call_args_list))
                publisher.upload_prepared.assert_not_called()

                effects.reset_mock()
                uploads = mock.sentinel.verified_uploads
                publisher.prepare_uploads.side_effect = None
                publisher.prepare_uploads.return_value = uploads
                release.main()

            publication = [
                call for call in effects.mock_calls
                if call[0].startswith('publisher.') or
                call.args[:2] == ('git', 'push') or call.args[:3] == ('gh', 'release', 'create')
            ]
            self.assertEqual(len(publication), 4)
            self.assertEqual(publication[0], mock.call.publisher.prepare_uploads('v0.2.0-native.1', [archive], notes=pathlib.Path('notes.md')))
            self.assertEqual(publication[1], mock.call.run('git', 'push', 'origin', 'HEAD'))
            self.assertEqual(publication[2].args[:3], ('gh', 'release', 'create'))
            self.assertEqual(publication[3], mock.call.publisher.upload_prepared(uploads))


if __name__ == '__main__':
    unittest.main()
