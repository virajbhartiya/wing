"""Apply Wing-owned identity after upstream engine patches, before GN generation."""
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parent.parent
IDENTITY = json.loads((ROOT / "native/wing-engine-identity.json").read_text())


def apply_identity(source, team_id=""):
    if team_id and not re.fullmatch(r"[A-Z0-9]{10}", team_id):
        raise ValueError("WING_DEVELOPER_TEAM_ID must be a ten-character Apple team ID.")
    keychain = source / "components/os_crypt/common/keychain_password_mac.mm"
    text = keychain.read_text()
    for field, previous, replacement in [
        ("kDefaultServiceName", "Ardia Safe Storage", IDENTITY["safeStorageService"]),
        ("kDefaultAccountName", "Ardia", IDENTITY["safeStorageAccount"]),
    ]:
        old = f'const char {field}[] = "{previous}";'
        new = f'const char {field}[] = "{replacement}";'
        if new in text:
            continue
        if text.count(old) != 1:
            raise RuntimeError(f"Unexpected upstream keychain identity: {field}")
        text = text.replace(old, new)
    keychain.write_text(text)
    apply_product_name(source)
    upstream = (source / "chrome/app/theme/ardia/BRANDING").read_text()
    fields = dict(line.split("=", 1) for line in upstream.splitlines() if "=" in line)
    fields.update(MAC_BUNDLE_ID=IDENTITY["bundleId"], MAC_TEAM_ID=team_id)
    branding = source / "chrome/app/theme/wing/BRANDING"
    branding.parent.mkdir(parents=True, exist_ok=True)
    branding.write_text("".join(f"{key}={value}\n" for key, value in fields.items()))


def apply_product_name(source):
    # The Web Store label, engine UI strings and keychain alerts are user visible.
    for relative, previous, replacement in [
        ("components/extstore_fixups/chrome-webstore.js", "CHROME_NAME_REGEX, 'Ardia'", "CHROME_NAME_REGEX, 'Wing'"),
        ("ardia/core/ac_strings.cc", 'kTo = u"Ardia"', 'kTo = u"Wing"'),
    ]:
        path = source / relative
        text = path.read_text()
        if replacement in text:
            continue
        if text.count(previous) != 1:
            raise RuntimeError(f"Unexpected upstream product name: {relative}")
        path.write_text(text.replace(previous, replacement))
    alerts = source / "ardia/core/ac_safe_storage.mm"
    lines = alerts.read_text().splitlines(keepends=True)
    alerts.write_text("".join(
        line.replace("Ardia Safe Storage", IDENTITY["safeStorageService"]).replace("Ardia", "Wing")
        if '@"' in line and "Ardia" in line else line for line in lines))


def configure_args(path):
    overrides = {
        "branding_file_path": '"//chrome/app/theme/wing/BRANDING"',
        "alternate_cdm_storage_id_key": json.dumps(IDENTITY["cdmStorageIdKey"]),
        "enable_rlz": "false",
        # Chromium's Windows/macOS storage-ID implementation requires RLZ
        # machine identification. Keep it disabled with RLZ; library CDMs
        # remain enabled, but hardware-bound DRM needs separate qualification.
        "enable_cdm_storage_id": "false",
    }
    lines = path.read_text().splitlines()
    result = [line for line in lines if line.split("=", 1)[0].strip() not in overrides]
    result.extend(f"{name}={value}" for name, value in overrides.items())
    path.write_text("\n".join(result) + "\n")


def keep_devtools_overrides(path):
    # Chromium resets emulation and network overrides when the session detaches,
    # so a tab that set one keeps its session until the tab closes.
    text = path.read_text()
    if "keep_attached_" in text:
        return
    edits = [
        ("    EndAheadBlank(&GetWebContents());\n",
         "    EndAheadBlank(&GetWebContents());\n"
         "    if (method.starts_with(\"Emulation.\") || method.starts_with(\"Network.\")) {\n"
         "      keep_attached_ = true;\n"
         "    }\n"),
        ("    if (generation != generation_ || !pending_.empty() || !host_) {\n",
         "    if (keep_attached_ || generation != generation_ || !pending_.empty() || !host_) {\n"),
        ("  int generation_ = 0;\n", "  int generation_ = 0;\n  bool keep_attached_ = false;\n"),
    ]
    for anchor, replacement in edits:
        if text.count(anchor) != 1:
            raise RuntimeError("DevTools session anchor changed")
        text = text.replace(anchor, replacement)
    path.write_text(text)


def apply_host_api(source):
    keep_devtools_overrides(source / "ardia/core/ac_devtools_call.mm")
    api = source / "ardia/core/ardiacore_api.mm"
    if not api.exists():
        api = source / "ardia/core/ardiacore_profile.mm"
    header = source / "ardia/core/public/ArdiaCore.h"
    implementation = '''- (BOOL)setDownloadDirectory:(NSString*)directory {
  if (!_profile || !directory.length) return NO;
  base::FilePath path(base::SysNSStringToUTF8(directory));
  PrefService* prefs = _profile->GetPrefs();
  if (!path.IsAbsolute() || !base::DirectoryExists(path) ||
      prefs->IsManagedPreference(prefs::kDownloadDefaultDirectory)) return NO;
  prefs->SetFilePath(prefs::kDownloadDefaultDirectory, path);
  return prefs->GetFilePath(prefs::kDownloadDefaultDirectory) == path;
}

'''
    text = api.read_text()
    imports = ['base/files/file_util.h', 'base/strings/sys_string_conversions.h', 'chrome/common/pref_names.h', 'components/prefs/pref_service.h', 'chrome/browser/password_manager/factories/profile_password_store_factory.h', 'components/password_manager/core/browser/password_store/stored_credential.h', 'content/public/browser/storage_partition.h', 'services/network/public/mojom/cookie_manager.mojom.h']
    for name in reversed(imports):
        include = f'#include "{name}"\n'
        if include not in text:
            text = include + text
    implementation += (ROOT / 'native/chromium/wing-profile-api.inc').read_text() + "\n"
    anchor = "- (NSNumber*)boolPreference:(NSString*)name {"
    if anchor not in text:
        anchor = "\n@end\n"
        if not text.endswith(anchor) and anchor not in text[-200:]:
            raise RuntimeError("Native profile API anchor changed")
        tail = text.rindex(anchor) + 1
        begin = text.find("- (BOOL)setDownloadDirectory:")
        text = text[:begin if begin >= 0 else tail] + implementation + text[tail:]
    elif text.count(anchor) != 1:
        raise RuntimeError("Native profile API anchor changed")
    elif "- (BOOL)setDownloadDirectory:" in text:
        begin = text.index("- (BOOL)setDownloadDirectory:")
        end = text.index(anchor, begin)
        text = text[:begin] + implementation + text[end:]
    else:
        text = text.replace(anchor, implementation + anchor)
    api.write_text(text)
    declaration = "- (BOOL)setDownloadDirectory:(NSString*)directory;"
    text = header.read_text()
    if declaration not in text:
        anchor = "@interface ArdiaCoreProfile : NSObject\n"
        if text.count(anchor) != 1:
            raise RuntimeError("Native profile API header anchor changed")
        header.write_text(text.replace(anchor, anchor + declaration + "\n"))

    text = header.read_text()
    if "- (void)importLogins:" not in text:
        text = text.replace(declaration, declaration + '\n- (void)flushCookiesWithCompletion:(void (^)(void))completion;\n- (void)importLogins:(NSArray<NSDictionary*>*)entries completion:(void (^)(NSInteger count, NSString* _Nullable error))completion;')
        header.write_text(text)
