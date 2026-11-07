"""Build an isolated Wing UI migration preview against the qualified framework.

The preview requires an explicit disposable profile and uses a mock keychain.
It is not distributed or installed as the user's Wing browser.
"""
import argparse
import hashlib
import base64
import json
from pathlib import Path
import plistlib
import shutil
import subprocess
import tarfile
import tempfile
import urllib.request
import zipfile
from chromium_artifact import verify_receipt
from chromium_distribution import host_inputs, qualification_report, verify_qualification

ROOT = Path(__file__).resolve().parent.parent
PINS = json.loads((ROOT / 'docs/ardiacore-provenance.json').read_text())
UBO = json.loads((ROOT / 'native/ublock-sources.json').read_text())
NODE_IMPORT = json.loads((ROOT / 'native/node-import-sources.json').read_text())


def verified_asset(url, digest, destination):
    if not destination.exists() or hashlib.sha256(destination.read_bytes()).hexdigest() != digest:
        with urllib.request.urlopen(url, timeout=60) as response:
            body = response.read()
        if hashlib.sha256(body).hexdigest() != digest:
            raise RuntimeError(f'Asset checksum mismatch: {url}')
        destination.write_bytes(body)
    return destination


def run(*args):
    subprocess.run(args, cwd=ROOT, check=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-receipt', type=Path, help='Use a completed Wing source framework build')
    parser.add_argument("--production", action="store_true", help="Stage a qualified persistent-profile app; does not install it")
    parser.add_argument('--arch', choices=['arm64', 'x64'], default='arm64')
    # Rosetta cannot qualify the x64 engine; vouch for the host code with the
    # arm64 qualification of the same inputs instead, and say so in the release.
    parser.add_argument('--untested-intel', action='store_true', help='x64 production without x64 qualification')
    args = parser.parse_args()
    if args.untested_intel and not (args.production and args.arch == 'x64'):
        raise SystemExit('--untested-intel only applies to an x64 production build.')
    inputs = host_inputs()
    if not args.source_receipt:
        # The vendored prebuilt engine is Chromium 155; the host is written against the pinned source engine.
        raise SystemExit('Pass --source-receipt from a compiled source engine (see README)')
    source_receipt = verify_receipt(args.source_receipt) if args.source_receipt else None
    if args.untested_intel:
        report = json.loads((ROOT / qualification_report('arm64')).read_text())
        if not report.get('passed') or report.get('hostInputs') != inputs:
            raise SystemExit('The arm64 build of this exact host code must pass qualification first.')
        print('Warning: building an x64 app that has not been qualified on Intel.', flush=True)
    elif args.production:
        report = json.loads((ROOT / qualification_report(args.arch)).read_text())
        verify_qualification(report, source_receipt, inputs)
    product = 'Wing' if args.production else 'Wing Chromium Preview'
    vendor = ROOT / 'native/vendor/ardiacore' 
    archive = vendor / 'ArdiaCore-6b96c16ab2cc.tar.xz'
    header = vendor / 'ArdiaCore.h'
    if source_receipt:
        header = Path(source_receipt['header'])
    for file, digest in ([] if source_receipt else [(archive, PINS['engineSHA256']), (header, PINS['headerSHA256'])]):
        if not file.exists() or hashlib.sha256(file.read_bytes()).hexdigest() != digest:
            raise RuntimeError(f'Qualified engine input missing or checksum mismatch: {file}')
    output = ROOT / (('native/build/chromium-production' if args.production else 'native/build/chromium-preview') + ('' if args.arch == 'arm64' else '-' + args.arch))
    output.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='stage-', dir=output) as stage:
        stage = Path(stage)
        app = stage / (product + '.app')
        contents = app / 'Contents'
        macos = contents / 'MacOS'
        frameworks = contents / 'Frameworks'
        resources = contents / 'Resources'
        for directory in [macos, frameworks, resources]:
            directory.mkdir(parents=True)
        shutil.copytree(ROOT / 'native/chromium/services', resources / 'WingServices')
        node = NODE_IMPORT if args.arch == 'arm64' else NODE_IMPORT['builds'][args.arch]
        node_archive = verified_asset(node['url'], node['sha256'], vendor / ('node-import.tar.xz' if args.arch == 'arm64' else f'node-import-{args.arch}.tar.xz'))
        helper = resources / 'import-helper'
        helper.mkdir()
        node_prefix = f"node-v{NODE_IMPORT['version']}-darwin-{args.arch}"
        with tarfile.open(node_archive) as archive_file:
            for member_name, destination in [('bin/node', 'node'), ('LICENSE', 'NODE-LICENSE')]:
                member = archive_file.extractfile(node_prefix + '/' + member_name)
                if member is None:
                    raise RuntimeError('Importer runtime archive is missing a required file')
                (helper / destination).write_bytes(member.read())
        (helper / 'node').chmod(0o755)
        for name in ['chromium-import-helper.cjs', 'profile-import.cjs', 'browser-formats.cjs', 'profile-reader.cjs', 'import-controller.cjs', 'wing-profile-migration.cjs', 'model.cjs', 'splits.cjs', 'themes.cjs']:
            shutil.copy2(ROOT / 'src' / name, helper / name)
        (helper / 'provenance.json').write_text(json.dumps(NODE_IMPORT, indent=2)+'\n')
        shutil.copytree(ROOT / 'native/chromium/reader', resources / 'reader', dirs_exist_ok=True)
        ubo_archive = verified_asset(UBO['url'], UBO['sha256'], vendor / f"uBOLite_{UBO['version']}.chromium.zip")
        ubo = resources / 'uBOLite.chromium'
        with zipfile.ZipFile(ubo_archive) as source:
            for name in source.namelist():
                if Path(name).is_absolute() or '..' in Path(name).parts:
                    raise RuntimeError('Unsafe extension archive path')
            source.extractall(ubo)
        manifest = json.loads((ubo / 'manifest.json').read_text())
        manifest['key'] = UBO['componentKey']
        # Component extensions cannot resolve the optional enterprise schema as
        # a packaged Chrome resource. Filtering code and permissions are intact.
        manifest.pop('storage', None)
        # Cookie notices are hidden by default, as they were with full uBlock.
        for ruleset in manifest['declarative_net_request']['rule_resources']:
            if ruleset['id'] in UBO['enableRulesets']:
                ruleset['enabled'] = True
        (ubo / 'manifest.json').write_text(json.dumps(manifest, indent=2)+'\n')
        details = json.loads((ubo / 'rulesets/ruleset-details.json').read_text())
        for ruleset in details:
            if ruleset['id'] in UBO['enableRulesets']:
                ruleset['enabled'] = True
        (ubo / 'rulesets/ruleset-details.json').write_text(json.dumps(details, indent=1)+'\n')
        (resources / 'ublock-provenance.json').write_text(json.dumps(UBO, indent=2)+'\n')
        if source_receipt:
            shutil.copytree(source_receipt['framework'], frameworks / 'Chromium Framework.framework', symlinks=True)
        else:
            with tarfile.open(archive) as source:
                source.extractall(frameworks, filter='data')
        engine_receipt = source_receipt or {'kind': 'upstream-prebuilt', **PINS}
        (resources / 'host-inputs.json').write_text(json.dumps(inputs, indent=2)+'\n')
        (resources / 'engine-provenance.json').write_text(json.dumps(engine_receipt, indent=2)+'\n')
        framework = frameworks / 'Chromium Framework.framework'
        binary = framework / 'Versions/Current/Chromium Framework'
        run('xcrun', 'clang++', '-std=c++20', '-O2', '-arch', {'arm64': 'arm64', 'x64': 'x86_64'}[args.arch], '-mmacosx-version-min=14.0', '-fobjc-arc',
            '-I'+str(header.parent), str(ROOT / 'native/chromium/main.mm'), str(ROOT / 'native/chromium/ImportProcess.mm'), str(ROOT / 'native/chromium/MiniWindow.mm'), str(ROOT / 'native/chromium/ExtensionPanel.mm'), str(ROOT / 'native/chromium/ExtensionSidebar.mm'), str(ROOT / 'native/chromium/DeviceChooser.mm'), str(ROOT / 'native/chromium/PromptPopover.mm'), str(ROOT / 'native/chromium/CastPicker.mm'), str(ROOT / 'native/chromium/WebKitPage.mm'), str(binary), '-framework', 'AppKit', '-framework', 'WebKit',
            '-o', str(macos / product))
        # Page summaries use Apple's on-device model; the host only runs this on macOS 26.
        run('xcrun', 'swiftc', '-O', '-target', {'arm64': 'arm64', 'x64': 'x86_64'}[args.arch]+'-apple-macos26.0',
            str(ROOT / 'native/chromium/Summarize.swift'), '-o', str(macos / 'wing-summarize'))
        shutil.copytree(ROOT / 'assets/icons', resources / 'assets/icons')
        shell = resources / 'shell'
        shell.mkdir()
        for name in ['index.html', 'renderer.js', 'features.js', 'capture.js', 'recent-tabs-ui.js', 'design-system.css', 'styles.css']:
            shutil.copy2(ROOT / 'src' / name, shell / name)
        html = (shell / 'index.html').read_text().replace('<script src="renderer.js">', '<script src="chromium-preload.js"></script>\n    <script src="renderer.js">')
        (shell / 'index.html').write_text(html)
        # CSS masks fetched through file:// have opaque origins in Chromium.
        # Embed Wing's existing local vector asset; do not relax file isolation.
        mask = 'data:image/svg+xml;base64,' + base64.b64encode((ROOT / 'assets/wing-mark.svg').read_bytes()).decode()
        css = (shell / 'styles.css').read_text().replace('../assets/wing-mark.svg', mask)
        (shell / 'styles.css').write_text(css)
        run(str(ROOT / 'node_modules/.bin/esbuild'), 'src/chromium-preload.cjs', '--bundle', '--platform=browser',
            '--alias:node:crypto=./src/chromium-crypto.cjs', '--outfile='+str(shell / 'chromium-preload.js'))
        for name in ['LICENSE', 'LICENSE-MIT', 'THIRD_PARTY_NOTICES.md']:
            shutil.copy2(ROOT / name, resources / name)
        plist = {'CFBundleExecutable':product, 'CFBundleIdentifier':'org.wingbrowser.Wing' if args.production else 'org.wingbrowser.ChromiumPreview',
                 'CFBundleName':product, 'WingQualificationOnly':not args.production, 'CFBundlePackageType':'APPL', 'CFBundleVersion':subprocess.check_output(['git','rev-list','--count','HEAD'],cwd=ROOT,text=True).strip(),
                 'CFBundleShortVersionString':json.loads((ROOT / 'package.json').read_text())['version'], 'LSMinimumSystemVersion':'14.0', 'NSHighResolutionCapable':True,
                 'NSSupportsAutomaticGraphicsSwitching':True,
                 'NSCameraUsageDescription':'Wing lets websites use your camera only after you allow access.',
                 'NSMicrophoneUsageDescription':'Wing lets websites use your microphone only after you allow access.',
                 'NSBluetoothAlwaysUsageDescription':'Wing lets you connect a Bluetooth device to a website you choose.',
                 'NSLocationUsageDescription':'Wing shares your location with a website only after you allow it.',
                 'NSLocationWhenInUseUsageDescription':'Wing shares your location with a website only after you allow it.',
                 # Cast finds Chromecasts and TVs on the local network.
                 'NSLocalNetworkUsageDescription':'Wing looks for Chromecasts and TVs on your network when you cast a tab.',
                 'NSBonjourServices':['_googlecast._tcp']}
        if args.production:
            plist['CFBundleURLTypes'] = [{'CFBundleURLName':'Web links', 'CFBundleTypeRole':'Viewer', 'CFBundleURLSchemes':['http','https','wingbrowser']}]
            plist['LSApplicationCategoryType'] = 'public.app-category.productivity'
        shutil.copy2(ROOT / 'assets/wing.icns', resources / 'wing.icns')
        (resources / 'bin').mkdir(exist_ok=True)
        shutil.copy2(ROOT / 'scripts/wing-cli.sh', resources / 'bin/wing')
        plist['CFBundleIconFile'] = 'wing'
        (contents / 'Info.plist').write_bytes(plistlib.dumps(plist))
        run('codesign', '--force', '--sign', '-', str(helper / 'node'))
        entitlements = stage / 'entitlements.plist'
        entitlements.write_bytes(plistlib.dumps({'com.apple.security.cs.allow-jit':True, 'com.apple.security.cs.disable-library-validation':True}))
        for item in (framework / 'Versions/Current/Libraries').glob('*.dylib'):
            run('codesign', '--force', '--timestamp=none', '--options', 'runtime', '--sign', '-', str(item))
        for item in (framework / 'Versions/Current/Helpers').iterdir():
            if item.is_file() or item.suffix == '.app':
                run('codesign', '--force', '--timestamp=none', '--options', 'runtime', '--sign', '-', '--entitlements', str(entitlements), str(item))
        run('codesign', '--force', '--timestamp=none', '--options', 'runtime', '--sign', '-', '--entitlements', str(entitlements), str(framework))
        # The hardened runtime silently denies devices the app does not declare,
        # so websites could never reach the camera, microphone or location.
        app_entitlements = stage / 'app-entitlements.plist'
        app_entitlements.write_bytes(plistlib.dumps({
            'com.apple.security.cs.allow-jit':True, 'com.apple.security.cs.disable-library-validation':True,
            'com.apple.security.device.audio-input':True, 'com.apple.security.device.camera':True,
            'com.apple.security.device.bluetooth':True, 'com.apple.security.device.usb':True,
            'com.apple.security.personal-information.location':True, 'com.apple.security.print':True}))
        run('codesign', '--force', '--timestamp=none', '--options', 'runtime', '--sign', '-', str(macos / 'wing-summarize'))
        run('codesign', '--force', '--timestamp=none', '--options', 'runtime', '--sign', '-', '--entitlements', str(app_entitlements), str(app))
        run('codesign', '--verify', '--deep', '--strict', str(app))
        if host_inputs() != inputs:
            raise RuntimeError('Host inputs changed during packaging; rebuild from a stable source tree.')
        # Keep every existing preview intact; each successful build has its own path.
        # Spotlight skips a .noindex folder, so builds don't show up as more Wings.
        destination = Path(tempfile.mkdtemp(prefix='build-', suffix='.noindex', dir=output)) / app.name
        shutil.move(app, destination)
        (output / 'latest.json').write_text(json.dumps({'app':str(destination), 'qualificationOnly':not args.production, 'engineKind':engine_receipt['kind']}, indent=2)+'\n')
        print(f'Built {product} staging artifact: {destination}')


if __name__ == '__main__':
    main()
