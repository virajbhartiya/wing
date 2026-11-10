import pathlib, sys, unittest
import xml.etree.ElementTree as ET

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

    def test_keeps_only_recent_releases(self):
        feed = b''
        for build in range(P.KEEP + 3):
            feed = P.appcast(feed.decode(), entry(build))
        self.assertEqual(len(ET.fromstring(feed).findall('channel/item')), P.KEEP)


if __name__ == '__main__':
    unittest.main()
