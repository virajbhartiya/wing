import importlib.util, pathlib, unittest

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


if __name__ == '__main__':
    unittest.main()
