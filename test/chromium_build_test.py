import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest import mock


def script(name):
    file = Path(__file__).resolve().parent.parent / "scripts" / name
    spec = importlib.util.spec_from_file_location(name.replace("-", "_"), file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class ChromiumSourceSafety(unittest.TestCase):
    def test_dirty_checkout_is_preserved_without_running_mutations(self):
        prepare = script("prepare-chromium.py")
        with tempfile.TemporaryDirectory() as directory:
            prepare.BUILD = Path(directory)
            (prepare.BUILD / "helium/.git").mkdir(parents=True)
            with mock.patch.object(prepare, "git_value", side_effect=[prepare.PINS["helium"]["url"], " M patch"]), mock.patch.object(prepare, "run") as run:
                with self.assertRaisesRegex(RuntimeError, "Preserving local changes"):
                    prepare.checkout("helium")
                run.assert_not_called()

    def test_existing_unowned_directory_is_not_adopted(self):
        prepare = script("prepare-chromium.py")
        with tempfile.TemporaryDirectory() as directory:
            prepare.BUILD = Path(directory).resolve()
            user_file = prepare.BUILD / "keep.txt"
            user_file.write_text("existing work")
            with mock.patch("sys.argv", ["prepare-chromium.py"]), mock.patch.object(prepare.platform, "system", return_value="Darwin"), mock.patch.object(prepare.platform, "machine", return_value="arm64"):
                with self.assertRaisesRegex(RuntimeError, "ownership marker"):
                    prepare.main()
            self.assertEqual(user_file.read_text(), "existing work")
            self.assertFalse((prepare.BUILD / ".wing-source-root").exists())

    def test_omitted_gitlink_stub_is_removed_but_contents_are_preserved(self):
        build = script("build-chromium.py")
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory)
            omitted = source / "third_party/search_engines_data/resources_internal"
            omitted.mkdir(parents=True)
            build.omit_search_data_stub(source)
            self.assertFalse(omitted.exists())
            omitted.mkdir()
            (omitted / "data").write_text("preserve")
            with self.assertRaisesRegex(RuntimeError, "preserve"):
                build.omit_search_data_stub(source)
            self.assertEqual((omitted / "data").read_text(), "preserve")

    def test_engine_identity_is_owned_and_idempotent(self):
        build = script("build-chromium.py")
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory)
            keychain = source / "components/os_crypt/common/keychain_password_mac.mm"
            keychain.parent.mkdir(parents=True)
            keychain.write_text('const char kDefaultServiceName[] = "Ardia Safe Storage";\nconst char kDefaultAccountName[] = "Ardia";\n')
            branding = source / "chrome/app/theme/ardia/BRANDING"
            branding.parent.mkdir(parents=True)
            branding.write_text("PRODUCT_FULLNAME=Chromium\nMAC_BUNDLE_ID=com.ardia.browser\nMAC_TEAM_ID=UPSTREAMID\n")
            store_script = source / "components/extstore_fixups/chrome-webstore.js"
            store_script.parent.mkdir(parents=True)
            store_script.write_text("label.replace(CHROME_NAME_REGEX, 'Ardia');\n")
            strings = source / "ardia/core/ac_strings.cc"
            strings.parent.mkdir(parents=True)
            strings.write_text('constexpr auto kTo = u"Ardia";\n')
            alerts = source / "ardia/core/ac_safe_storage.mm"
            alerts.write_text('NSString *message = @"Open Ardia Safe Storage in Ardia";\n')
            owned = source / "chrome/app/theme/wing/BRANDING"

            build.apply_identity(source)
            outputs = [keychain, store_script, strings, alerts, owned]
            first = [path.read_text() for path in outputs]
            build.apply_identity(source)
            self.assertEqual([path.read_text() for path in outputs], first)
            self.assertIn('"Wing Safe Storage"', keychain.read_text())
            self.assertIn('kDefaultAccountName[] = "Wing"', keychain.read_text())
            self.assertIn("CHROME_NAME_REGEX, 'Wing'", store_script.read_text())
            self.assertIn('kTo = u"Wing"', strings.read_text())
            self.assertIn('@"Open Wing Safe Storage in Wing"', alerts.read_text())
            self.assertIn("MAC_BUNDLE_ID=org.wingbrowser.Wing", owned.read_text())
            self.assertNotIn("UPSTREAMID", owned.read_text())
            self.assertIn("com.ardia.browser", branding.read_text())

    def test_privacy_configuration_disables_rlz_dependent_cdm_identifier(self):
        identity = script("chromium_identity.py")
        with tempfile.TemporaryDirectory() as directory:
            args = Path(directory) / "args.gn"
            args.write_text("enable_rlz=true\nenable_cdm_storage_id=true\nenable_library_cdms=true\n")
            identity.configure_args(args)
            first = args.read_text()
            self.assertIn("enable_rlz=false\n", first)
            self.assertIn("enable_cdm_storage_id=false\n", first)
            self.assertNotIn("enable_cdm_storage_id=true", first)
            self.assertIn("enable_library_cdms=true\n", first)
            identity.configure_args(args)
            self.assertEqual(args.read_text(), first)

    def test_host_api_patch_refreshes_generated_implementation(self):
        identity = script("chromium_identity.py")
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            identity.ROOT = root
            fragment = root / "native/chromium/wing-profile-api.inc"
            fragment.parent.mkdir(parents=True)
            fragment.write_text("- (void)importLogins:(id)entries {}\n")
            api = root / "ardia/core/ardiacore_api.mm"
            api.parent.mkdir(parents=True)
            api.write_text("- (NSNumber*)boolPreference:(NSString*)name { return nil; }\n")
            devtools = api.with_name("ac_devtools_call.mm")
            devtools.write_text(
                "    EndAheadBlank(&GetWebContents());\n"
                "    if (generation != generation_ || !pending_.empty() || !host_) {\n"
                "  int generation_ = 0;\n"
            )
            header = root / "ardia/core/public/ArdiaCore.h"
            header.parent.mkdir(parents=True)
            header.write_text(
                "@interface ArdiaCoreProfile : NSObject\n"
                "- (nullable NSNumber*)boolPreference:(NSString*)name;\n"
                "@end\n"
            )

            identity.apply_host_api(root)
            outputs = [api, devtools, header]
            first = [path.read_text() for path in outputs]
            identity.apply_host_api(root)
            self.assertEqual([path.read_text() for path in outputs], first)
            self.assertIn('method.starts_with("Emulation.") || method.starts_with("Network.")', devtools.read_text())
            self.assertIn("if (keep_attached_ || generation", devtools.read_text())
            self.assertIn("- (BOOL)setDownloadDirectory:(NSString*)directory;", header.read_text())
            self.assertIn("- (void)importLogins:", header.read_text())
            fragment.write_text("- (void)importLogins:(id)entries { /* revised */ }\n")
            identity.apply_host_api(root)
            self.assertIn("/* revised */", api.read_text())
            self.assertEqual(api.read_text().count("- (BOOL)setDownloadDirectory:"), 1)

    def test_source_receipt_rejects_modified_framework_and_inputs(self):
        artifact = script("chromium_artifact.py")
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            artifact.ROOT = root
            artifact.INPUTS = ["identity.json"]
            (root / "identity.json").write_text("Wing")
            binary = root / "out/Release_GN_arm64/Chromium Framework.framework/Versions/Current/Chromium Framework"
            binary.parent.mkdir(parents=True)
            binary.write_bytes(b"compiled framework")
            header = root / "ardia/core/public/ArdiaCore.h"
            header.parent.mkdir(parents=True)
            header.write_text("header")
            receipt = root / "receipt.json"
            artifact.write_receipt(root, receipt)
            self.assertEqual(artifact.verify_receipt(receipt)["kind"], "wing-source")
            binary.write_bytes(b"different framework")
            with self.assertRaisesRegex(RuntimeError, "changed after compilation"):
                artifact.verify_receipt(receipt)
            binary.write_bytes(b"compiled framework")
            (root / "identity.json").write_text("another browser")
            with self.assertRaisesRegex(RuntimeError, "stale"):
                artifact.verify_receipt(receipt)

    def test_compile_requires_completed_pinned_sync(self):
        build = script("build-chromium.py")
        with tempfile.TemporaryDirectory() as directory:
            build.BUILD = Path(directory).resolve()
            (build.BUILD / ".wing-source-root").touch()
            with mock.patch("sys.argv", ["build-chromium.py", "compile"]), mock.patch.object(build, "run") as run:
                with self.assertRaisesRegex(RuntimeError, "sync/hooks have not completed"):
                    build.main()
                run.assert_not_called()


if __name__ == "__main__":
    unittest.main()
