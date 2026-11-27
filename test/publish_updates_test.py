import base64, pathlib, sys, tempfile, unittest
import xml.etree.ElementTree as ET
from unittest import mock

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'scripts'))
import publish_updates as P

NS = {'sparkle': P.SPARKLE_NS}


def entry(build):
    return P.item(f'v0.2.0-native.{build}', 'arm64', pathlib.Path(f'Wing-{build}-arm64.zip'),
                  {'edSignature': 'c2ln', 'length': '42'}, {'CFBundleVersion': str(build)}, 'updates.example')


class AppcastTest(unittest.TestCase):
    def test_new_release_goes_first_and_replaces_a_republished_build(self):
        feed = P.appcast('', entry(1))
        feed = P.appcast(feed.decode(), entry(2))
        feed = P.appcast(feed.decode(), entry(2))
        items = ET.fromstring(feed).findall('channel/item')
        self.assertEqual([i.findtext('sparkle:version', namespaces=NS) for i in items], ['2', '1'])
        enclosure = items[0].find('enclosure')
        self.assertEqual(enclosure.get('url'), 'https://updates.example/releases/v0.2.0-native.2/Wing-2-arm64.zip')
        self.assertEqual(enclosure.get(f'{{{P.SPARKLE_NS}}}edSignature'), 'c2ln')

    def test_release_notes_link_points_at_wings_notes_page(self):
        args = ('v0.2.0-native.30', 'arm64', pathlib.Path('Wing-30-arm64.zip'),
                {'edSignature': 'c2ln', 'length': '42'}, {'CFBundleVersion': '30'}, 'updates.example')
        link = lambda node: node.findtext('sparkle:releaseNotesLink', namespaces=NS)
        self.assertEqual(link(P.item(*args, notes=True)),
                         'https://updates.example/releases/v0.2.0-native.30/notes.html')
        self.assertIn('github.com', link(P.item(*args)))

    def test_keeps_only_recent_releases(self):
        feed = b''
        for build in range(P.KEEP + 3):
            feed = P.appcast(feed.decode(), entry(build))
        self.assertEqual(len(ET.fromstring(feed).findall('channel/item')), P.KEEP)

    def test_never_publishes_an_update_with_a_different_embedded_public_key(self):
        domain = P.CLOUD['domain']
        information = {
            'SUFeedURL': f'https://{domain}/appcast-arm64.xml',
            'SUPublicEDKey': 'different-update-key',
            'CFBundleVersion': '200',
        }
        with mock.patch.object(P, 'stack_outputs', return_value={
            'UpdatesBucket': 'fixture-bucket', 'Domain': domain,
        }), mock.patch.object(P, 'bundle_info', return_value=information), \
             mock.patch.object(P, 'sign') as sign, mock.patch.object(P, 'store') as store:
            with self.assertRaisesRegex(SystemExit, 'public key'):
                P.publish('v0.2.0-native.20', ['Wing-0.2.0-native.20-arm64.zip'])
            sign.assert_not_called()
            store.assert_not_called()

    def test_preflights_every_architecture_before_uploading(self):
        domain = P.CLOUD['domain']
        outputs = {
            'UpdatesBucket': 'fixture-bucket', 'Domain': domain, 'DistributionId': 'fixture',
        }
        metadata = [
            {
                'SUFeedURL': f'https://{domain}/appcast-{arch}.xml',
                'SUPublicEDKey': P.CLOUD['publicEDKey'],
                'CFBundleVersion': '200',
            }
            for arch in ['arm64', 'x64']
        ]
        signature = base64.b64encode(bytes(64)).decode()
        with tempfile.TemporaryDirectory() as directory:
            archives = [pathlib.Path(directory) / f'Wing-200-{arch}.zip' for arch in ['arm64', 'x64']]
            for path in archives:
                path.write_bytes(b'archive')
                path.with_suffix('.dmg').write_bytes(b'image')
            with mock.patch.object(P, 'stack_outputs', return_value=outputs), \
                 mock.patch.object(P, 'bundle_info', side_effect=metadata), \
                 mock.patch.object(P, 'sign', side_effect=[
                     {'edSignature': signature, 'length': '7'},
                     {'edSignature': signature, 'length': '6'},
                 ]), mock.patch.object(P, 'verify_signature') as verify, \
                 mock.patch.object(P, 'store') as store, \
                 mock.patch.object(P, 'aws', return_value='') as aws:
                with self.assertRaisesRegex(SystemExit, r'x64\.zip.*length'):
                    P.publish('v0.2.0-native.20', archives)
                verify.assert_called_once_with(archives[0], signature, P.CLOUD['publicEDKey'])
                store.assert_not_called()
                aws.assert_not_called()

    @unittest.skipUnless(sys.platform == 'darwin', 'Sparkle archive publishing requires macOS')
    def test_verifies_archive_bytes_with_ed25519(self):
        # RFC 8032 test vector for an empty message.
        public_key = base64.b64encode(bytes.fromhex(
            'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a',
        )).decode()
        signature = base64.b64encode(bytes.fromhex(
            'e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e06522490155'
            '5fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b',
        )).decode()
        with tempfile.TemporaryDirectory() as directory:
            archive = pathlib.Path(directory) / 'fixture.zip'
            archive.touch()
            P.verify_signature(archive, signature, public_key)
            with self.assertRaisesRegex(SystemExit, 'does not match'):
                P.verify_signature(archive, signature, P.CLOUD['publicEDKey'])
            archive.write_bytes(b'changed')
            with self.assertRaisesRegex(SystemExit, 'does not match'):
                P.verify_signature(archive, signature, public_key)


if __name__ == '__main__':
    unittest.main()
