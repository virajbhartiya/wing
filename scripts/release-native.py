#!/usr/bin/env python3
"""Build, qualify and package a Wing release, then optionally publish it.

  python3 scripts/release-native.py            build dist/ only
  python3 scripts/release-native.py --publish  also create the next GitHub release

Requires WING_CHROMIUM_BUILD. Stops at the first failure and refuses a dirty tree,
so a published build always matches a pushed commit.
"""
import argparse, hashlib, json, os, pathlib, re, shutil, subprocess, tempfile

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
        shutil.copytree(app, pathlib.Path(stage) / 'Wing.app', symlinks=True)
        (pathlib.Path(stage) / 'Applications').symlink_to('/Applications')
        destination.unlink(missing_ok=True)
        run('hdiutil', 'create', '-quiet', '-volname', 'Wing', '-srcfolder', stage, '-format', 'UDZO', destination)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--publish', action='store_true')
    parser.add_argument('--notes', type=pathlib.Path, help='Markdown release notes')
    parser.add_argument('--allow-dirty', action='store_true', help='build only; never with --publish')
    args = parser.parse_args()
    if args.publish and (args.allow_dirty or not args.notes):
        raise SystemExit('--publish needs --notes and a clean tree.')
    build = os.environ.get('WING_CHROMIUM_BUILD')
    if not build:
        raise SystemExit('Set WING_CHROMIUM_BUILD to the Chromium build directory.')
    if output('git', 'status', '--porcelain') and not args.allow_dirty:
        raise SystemExit('Commit your changes first.')
    run('npm', 'test')
    run('npm', 'run', 'check')
    run('python3', 'scripts/build-chromium-preview.py', '--source-receipt', f'{build}/wing-build-receipt.json')
    run('python3', 'scripts/test-chromium-preview.py')
    run('npm', 'run', 'build:chromium-production')
    app = pathlib.Path(json.loads((ROOT / 'native/build/chromium-production/latest.json').read_text())['app'])
    version = json.loads((ROOT / 'package.json').read_text())['version']
    tags = output('git', 'tag', '--list').split()
    tag = next_tag(version, tags)
    dist = ROOT / 'dist'
    shutil.rmtree(dist, ignore_errors=True)
    dist.mkdir()
    name = f'Wing-{tag[1:]}-arm64'
    archive, image = dist / f'{name}.zip', dist / f'{name}.dmg'
    run('ditto', '-c', '-k', '--sequesterRsrc', '--keepParent', app, archive)
    make_dmg(app, image)
    sums = ''.join(f'{sha256(path)}  {path.name}\n' for path in (archive, image))
    (dist / 'SHA256SUMS').write_text(sums)
    print(sums)
    if not args.publish:
        print(f'Built {tag} in {dist}; not published.')
        return
    run('git', 'push', 'origin', 'HEAD')
    run('gh', 'release', 'create', tag, archive, image, dist / 'SHA256SUMS', '--repo', REPO, '--target',
        output('git', 'rev-parse', 'HEAD'), '--title', f'Wing {tag[1:]}', '--notes-file', args.notes, '--latest')


if __name__ == '__main__':
    main()
