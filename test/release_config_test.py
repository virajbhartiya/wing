import base64
import importlib.util
import pathlib
import unittest
spec=importlib.util.spec_from_file_location('release_config',pathlib.Path(__file__).resolve().parents[1]/'scripts/release_config.py')
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
class ConfigurationTests(unittest.TestCase):
    def test_rejects_missing_and_insecure_feeds(self):
        for url in ['', 'http://updates.wing.invalid/feed.xml','https://example.com/feed.xml','https://secret@updates.wing.invalid/feed.xml']:
            with self.assertRaises(ValueError):module.validate({'feedURL':url,'publicEDKey':base64.b64encode(bytes(32)).decode()})
    def test_requires_ed25519_key(self):
        for key in ['', 'not base64',base64.b64encode(bytes(31)).decode()]:
            with self.assertRaises(ValueError):module.validate({'feedURL':'https://updates.wing.invalid/feed.xml','publicEDKey':key})
    def test_requires_verification_before_extraction_and_signed_feed(self):
        result=module.validate({'feedURL':'https://updates.wing.invalid/feed.xml','publicEDKey':base64.b64encode(bytes(32)).decode()})
        self.assertTrue(result['SUVerifyUpdateBeforeExtraction'])
        self.assertTrue(result['SURequireSignedFeed'])
if __name__=='__main__':unittest.main()
