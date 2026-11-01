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
from chromium_distribution import host_inputs, verify_qualification

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
    args = parser.parse_args()
    inputs = host_inputs()
    if not args.source_receipt:
        # The vendored prebuilt engine is Chromium 155; the host is written against the pinned source engine.
        raise SystemExit('Pass --source-receipt from a compiled source engine (see README)')
    source_receipt = verify_receipt(args.source_receipt) if args.source_receipt else None
    if args.production:
        report = json.loads((ROOT / 'docs/chromium-preview-qualification.json').read_text())
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
    output = ROOT / ('native/build/chromium-production' if args.production else 'native/build/chromium-preview')
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
        node_archive = verified_asset(NODE_IMPORT['url'], NODE_IMPORT['sha256'], vendor / 'node-import.tar.xz')
        helper = resources / 'import-helper'
        helper.mkdir()
        node_prefix = f"node-v{NODE_IMPORT['version']}-darwin-arm64"
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
        shutil.copy2(ROOT / 'native/chromium/protection-ready.js', resources / 'protection-ready.js')
        shutil.copytree(ROOT / 'native/chromium/reader', resources / 'reader', dirs_exist_ok=True)
        ubo_archive = verified_asset(UBO['url'], UBO['sha256'], vendor / 'uBlock0_1.75.0.chromium.zip')
        cookies = verified_asset(UBO['cookieURL'], UBO['cookieSHA256'], vendor / 'easylist-cookies.txt')
        with zipfile.ZipFile(ubo_archive) as source:
            for name in source.namelist():
                if Path(name).is_absolute() or '..' in Path(name).parts:
                    raise RuntimeError('Unsafe extension archive path')
            source.extractall(resources)
        ubo = resources / 'uBlock0.chromium'
        manifest = json.loads((ubo / 'manifest.json').read_text())
        manifest['key'] = UBO['componentKey']
        # Component extensions cannot resolve the optional enterprise schema as
        # a packaged Chrome resource. Filtering code and permissions are intact.
        manifest.pop('storage', None)
        (ubo / 'manifest.json').write_text(json.dumps(manifest, indent=2)+'\n')
        assets = json.loads((ubo / 'assets/assets.json').read_text())
        cookie_path = 'assets/thirdparties/easylist-cookies.txt'
        (ubo / cookie_path).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(cookies, ubo / cookie_path)
        assets['fanboy-cookiemonster']['contentURL'].insert(0, cookie_path)
        assets['fanboy-cookiemonster']['off'] = False
        (ubo / 'assets/assets.json').write_text(json.dumps(assets, indent=2)+'\n')
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
        run('xcrun', 'clang++', '-std=c++20', '-O2', '-arch', 'arm64', '-mmacosx-version-min=14.0', '-fobjc-arc',
            '-I'+str(header.parent), str(ROOT / 'native/chromium/main.mm'), str(ROOT / 'native/chromium/ImportProcess.mm'), str(ROOT / 'native/chromium/MiniWindow.mm'), str(ROOT / 'native/chromium/ExtensionPanel.mm'), str(ROOT / 'native/chromium/ExtensionSidebar.mm'), str(ROOT / 'native/chromium/DeviceChooser.mm'), str(ROOT / 'native/chromium/PromptPopover.mm'), str(ROOT / 'native/chromium/PrivateWindow.mm'), str(binary), '-framework', 'AppKit',
            '-o', str(macos / product))
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
                 'CFBundleName':product, 'WingQualificationOnly':not args.production, 'CFBundlePackageType':'APPL', 'CFBundleVersion':'1',
                 'CFBundleShortVersionString':json.loads((ROOT / 'package.json').read_text())['version'], 'LSMinimumSystemVersion':'14.0', 'NSHighResolutionCapable':True,
                 'NSSupportsAutomaticGraphicsSwitching':True,
                 'NSCameraUsageDescription':'Wing lets websites use your camera only after you allow access.',
                 'NSMicrophoneUsageDescription':'Wing lets websites use your microphone only after you allow access.',
                 'NSBluetoothAlwaysUsageDescription':'Wing lets you connect a Bluetooth device to a website you choose.'}
        if args.production:
            plist['CFBundleURLTypes'] = [{'CFBundleURLName':'Web links', 'CFBundleTypeRole':'Viewer', 'CFBundleURLSchemes':['http','https']}]
            plist['LSApplicationCategoryType'] = 'public.app-category.productivity'
        (contents / 'Info.plist').write_bytes(plistlib.dumps(plist))
        run('codesign', '--force', '--sign', '-', str(helper / 'node'))
        entitlements = stage / 'entitlements.plist'
        entitlements.write_bytes(plistlib.dumps({'com.apple.security.cs.allow-jit':True, 'com.apple.security.cs.disable-library-validation':True}))
        for item in (framework / 'Versions/Current/Libraries').glob('*.dylib'):
            run('codesign', '--force', '--timestamp=none', '--options', 'runtime', '--sign', '-', str(item))
        for item in (framework / 'Versions/Current/Helpers').iterdir():
            if item.is_file() or item.suffix == '.app':
                run('codesign', '--force', '--timestamp=none', '--options', 'runtime', '--sign', '-', '--entitlements', str(entitlements), str(item))
        for item in [framework, app]:
            run('codesign', '--force', '--timestamp=none', '--options', 'runtime', '--sign', '-', '--entitlements', str(entitlements), str(item))
        run('codesign', '--verify', '--deep', '--strict', str(app))
        if host_inputs() != inputs:
            raise RuntimeError('Host inputs changed during packaging; rebuild from a stable source tree.')
        # Keep every existing preview intact; each successful build has its own path.
        destination = Path(tempfile.mkdtemp(prefix='build-', dir=output)) / app.name
        shutil.move(app, destination)
        (output / 'latest.json').write_text(json.dumps({'app':str(destination), 'qualificationOnly':not args.production, 'engineKind':engine_receipt['kind']}, indent=2)+'\n')
        print(f'Built {product} staging artifact: {destination}')


if __name__ == '__main__':
    main()
