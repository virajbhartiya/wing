#!/usr/bin/env python3
"""Build, qualify and package a Wing release, then optionally publish it.

  python3 scripts/release-native.py            build dist/ only
  python3 scripts/release-native.py --publish  also create the next GitHub release
  add --notarize for a Developer ID signed and notarized release
  add --intel to also build, qualify (under Rosetta) and ship the x64 app

Requires WING_CHROMIUM_BUILD. Stops at the first failure and refuses a dirty tree,
so a published build always matches a pushed commit.
"""
import argparse, hashlib, json, os, pathlib, re, subprocess, tempfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
REPO = 'virajbhartiya/wing'


def run(*command, **options):
    print('+', ' '.join(str(part) for part in command), flush=True)
    return subprocess.run([str(part) for part in command], cwd=ROOT, check=True, text=True, **options)


def output(*command):
    return run(*command, capture_output=True).stdout.strip()


def next_tag(version, tags):
    prefix = f'v{version}-native.'
    numbers = [int(tag[len(prefix):]) for tag in tags if re.fullmatch(re.escape(prefix) + r'\d+', tag)]
    return f'{prefix}{max(numbers, default=0) + 1}'


def sha256(path):
    digest = hashlib.sha256()
    with path.open('rb') as file:
        for block in iter(lambda: file.read(1 << 20), b''):
            digest.update(block)
    return digest.hexdigest()


def make_dmg(app, destination):
    with tempfile.TemporaryDirectory(prefix='wing-dmg-') as stage:
        # Preserve the app's resource forks, extended attributes and stapled ticket.
        run('ditto', app, pathlib.Path(stage) / 'Wing.app')
        (pathlib.Path(stage) / 'Applications').symlink_to('/Applications')
        run('hdiutil', 'create', '-quiet', '-volname', 'Wing', '-srcfolder', stage, '-format', 'UDZO', destination)


def notarization_credentials():
    identity = os.environ.get('WING_SIGN_IDENTITY', '')
    if not identity.startswith('Developer ID Application:'):
        raise SystemExit('--notarize requires WING_SIGN_IDENTITY set to the full Developer ID Application identity.')
    profile = os.environ.get('WING_NOTARY_PROFILE', '')
    if not profile.strip():
        raise SystemExit('--notarize requires WING_NOTARY_PROFILE set to a notarytool keychain profile.')
    identities = output('security', 'find-identity', '-v', '-p', 'codesigning')
    available = re.findall(r'^\s*\d+\)\s+[0-9A-Fa-f]+\s+"([^"]+)"', identities, flags=re.MULTILINE)
    if identity not in available:
        raise SystemExit('The selected Developer ID Application identity and private key are not available.')
    try:
        # History authenticates the profile without uploading any software.
        run('xcrun', 'notarytool', 'history', '--keychain-profile', profile,
            '--output-format', 'json', capture_output=True, timeout=30)
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
        raise SystemExit('Could not authenticate WING_NOTARY_PROFILE with Apple notarization.') from None
    return identity, profile


def submit_for_notarization(path, profile):
    result = json.loads(output('xcrun', 'notarytool', 'submit', path, '--keychain-profile',
                               profile, '--wait', '--timeout', '30m', '--output-format', 'json'))
    if result.get('status') != 'Accepted':
        raise SystemExit(f'Notarization of {path.name} returned {result.get("status", "no status")}. '
                         f'Check the notary log for submission {result.get("id", "unknown")}.')


def staple(path):
    run('xcrun', 'stapler', 'staple', path)
    run('xcrun', 'stapler', 'validate', path)


def make_zip(app, destination):
    run('ditto', '-c', '-k', '--sequesterRsrc', '--keepParent', app, destination)


def package_app(app, archive, image, credentials):
    if credentials:
        identity, profile = credentials
        submission = archive.with_name(f'{archive.stem}-notary-submission.zip')
        make_zip(app, submission)
        submit_for_notarization(submission, profile)
        submission.unlink()
        staple(app)
        run('codesign', '--verify', '--deep', '--strict', app)
        run('spctl', '--assess', '--type', 'execute', app)

    make_zip(app, archive)
    make_dmg(app, image)
    if credentials:
        # Verify the ZIP restores the signed, stapled app that Sparkle will install.
        with tempfile.TemporaryDirectory(prefix='wing-verify-zip-') as directory:
            run('ditto', '-x', '-k', archive, directory)
            unpacked = pathlib.Path(directory) / app.name
            run('codesign', '--verify', '--deep', '--strict', unpacked)
            run('xcrun', 'stapler', 'validate', unpacked)
        run('codesign', '--sign', identity, '--timestamp', '--identifier', 'org.wingbrowser.Wing.DMG', image)
        submit_for_notarization(image, profile)
        staple(image)
        run('codesign', '--verify', '--strict', image)
        run('spctl', '--assess', '--type', 'open', '--context', 'context:primary-signature', image)
        run('hdiutil', 'verify', '-quiet', image)


def package_release(apps, tag, credentials):
    dist = ROOT / 'dist'
    with tempfile.TemporaryDirectory(prefix='.wing-release-', dir=ROOT) as staging:
        stage = pathlib.Path(staging)
        candidate = stage / dist.name
        candidate.mkdir()
        assets = []
        for arch, app in apps.items():
            name = f'Wing-{tag[1:]}-{arch}'
            archive, image = candidate / f'{name}.zip', candidate / f'{name}.dmg'
            package_app(app, archive, image, credentials)
            assets += [archive, image]
        sums = ''.join(f'{sha256(path)}  {path.name}\n' for path in assets)
        (candidate / 'SHA256SUMS').write_text(sums)
        # Leave the last completed release intact until all new artifacts pass.
        previous = stage / 'previous-dist'
        if dist.exists():
            dist.rename(previous)
        try:
            candidate.rename(dist)
        except BaseException:
            if previous.exists() and not dist.exists():
                previous.rename(dist)
            raise
    print(sums)
    return dist, [dist / path.name for path in assets]


def qualify(*extra):
    # The engine qualification is sensitive to a busy Mac (startup and teardown
    # watchdogs); a real regression fails every attempt.
    for attempt in range(3):
        if subprocess.run(['python3', 'scripts/test-chromium-preview.py', *extra], cwd=ROOT).returncode == 0:
            return
        print(f'Qualification attempt {attempt + 1} failed.', flush=True)
    raise SystemExit('Qualification failed three times.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--publish', action='store_true')
    parser.add_argument('--notarize', action='store_true',
                        help='notarize using WING_SIGN_IDENTITY and WING_NOTARY_PROFILE')
    parser.add_argument('--notes', type=pathlib.Path, help='Markdown release notes')
    parser.add_argument('--allow-dirty', action='store_true', help='build only; never with --publish')
    parser.add_argument('--intel', action='store_true', help='also ship an Intel (x64) build')
    # Under Rosetta the x64 engine starts too slowly for the qualification
    # watchdogs; only an Intel Mac can qualify it.
    parser.add_argument('--intel-untested', action='store_true',
                        help='skip x64 qualification; say so in the release notes')
    args = parser.parse_args()
    if args.publish and (args.allow_dirty or not args.notes):
        raise SystemExit('--publish needs --notes and a clean tree.')
    build = os.environ.get('WING_CHROMIUM_BUILD')
    if not build:
        raise SystemExit('Set WING_CHROMIUM_BUILD to the Chromium build directory.')
    credentials = notarization_credentials() if args.notarize else None
    if output('git', 'status', '--porcelain') and not args.allow_dirty:
        raise SystemExit('Commit your changes first.')
    run('npm', 'test')
    run('npm', 'run', 'check')
    run('npm', 'run', 'check:release')
    run('python3', 'scripts/build-chromium-preview.py', '--source-receipt', f'{build}/wing-build-receipt.json')
    qualify()
    run('npm', 'run', 'build:chromium-production')
    apps = {'arm64': pathlib.Path(json.loads((ROOT / 'native/build/chromium-production/latest.json').read_text())['app'])}
    if args.intel:
        receipt = f'{build}/wing-build-receipt-x64.json'
        run('python3', 'scripts/build-chromium-preview.py', '--arch', 'x64', '--source-receipt', receipt)
        if not args.intel_untested:
            qualify('--arch', 'x64')
        run('python3', 'scripts/build-chromium-preview.py', '--production', '--arch', 'x64', '--source-receipt', receipt,
            *(['--untested-intel'] if args.intel_untested else []))
        apps['x64'] = pathlib.Path(json.loads((ROOT / 'native/build/chromium-production-x64/latest.json').read_text())['app'])
    version = json.loads((ROOT / 'package.json').read_text())['version']
    # A release can exist on GitHub without its tag having been fetched here.
    tags = output('git', 'tag', '--list').split() + output(
        'gh', 'release', 'list', '--repo', REPO, '--limit', '200', '--json', 'tagName', '--jq', '.[].tagName').split()
    tag = next_tag(version, tags)
    dist, assets = package_release(apps, tag, credentials)
    if not args.publish:
        print(f'Built {tag} in {dist}; not published.')
        return
    # Reject mismatched Sparkle artifacts before publishing them anywhere.
    updates = None
    if json.loads((ROOT / 'native/chromium/cloud.json').read_text())['domain']:
        from publish_updates import prepare_uploads, upload_prepared
        updates = prepare_uploads(tag, [path for path in assets if path.suffix == '.zip'], notes=args.notes)
    run('git', 'push', 'origin', 'HEAD')
    run('gh', 'release', 'create', tag, *assets, dist / 'SHA256SUMS', '--repo', REPO, '--target',
        output('git', 'rev-parse', 'HEAD'), '--title', f'Wing {tag[1:]}', '--notes-file', args.notes, '--latest')
    # Installed copies update themselves from Wing's own appcast.
    if updates is not None:
        upload_prepared(updates)


if __name__ == '__main__':
    main()
