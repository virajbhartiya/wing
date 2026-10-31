#!/usr/bin/env python3
"""Reproducible Apple Silicon build using the pinned official CEF distribution."""
import hashlib
import json
import os
import pathlib
import plistlib
import shutil
import subprocess
import tarfile
import urllib.request
import tempfile
from release_config import validate

ROOT = pathlib.Path(__file__).resolve().parents[1]
NATIVE = ROOT / 'native'
LOCK = json.loads((NATIVE / 'cef-lock.json').read_text())
VENDOR = NATIVE / 'vendor'
VENDOR.mkdir(exist_ok=True)
sparkle_lock = json.loads((NATIVE / 'sparkle-lock.json').read_text())
sparkle_archive = VENDOR / ('Sparkle-' + sparkle_lock['version'] + '.tar.xz')
if not sparkle_archive.exists():
    urllib.request.urlretrieve(sparkle_lock['url'], sparkle_archive)
if hashlib.sha256(sparkle_archive.read_bytes()).hexdigest() != sparkle_lock['sha256']:
    raise SystemExit('Sparkle checksum mismatch')
sparkle = VENDOR / 'sparkle'
if not sparkle.exists():
    sparkle.mkdir()
    with tarfile.open(sparkle_archive) as bundle:
        bundle.extractall(sparkle, filter='data')
release_config = ROOT / 'release-config.json'
update_config = validate(json.loads(release_config.read_text())) if release_config.exists() else {}
archive = VENDOR / LOCK['file']['name']
if not archive.exists():
    temporary = archive.with_suffix('.download')
    print('Downloading pinned CEF from the official build host…', flush=True)
    urllib.request.urlretrieve('https://cef-builds.spotifycdn.com/' + archive.name, temporary)
    temporary.rename(archive)
if archive.stat().st_size != LOCK['file']['size']:
    raise SystemExit('CEF archive length mismatch; remove the incomplete archive and retry.')
# Verify both upstream digest and the independently recorded SHA-256 lock.
for algorithm, expected in [('sha1', LOCK['file']['sha1']), ('sha256', LOCK['file']['sha256'])]:
    digest = hashlib.new(algorithm)
    with archive.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    if digest.hexdigest() != expected:
        raise SystemExit(f'CEF {algorithm} checksum mismatch; refusing to extract.')
folder = VENDOR / archive.name.removesuffix('.tar.bz2')
if not folder.exists():
    print('Extracting CEF…', flush=True)
    with tarfile.open(archive) as bundle:
        bundle.extractall(VENDOR, filter='data')
link = VENDOR / 'cef'
if not link.exists():
    link.symlink_to(folder.name, target_is_directory=True)
build = NATIVE / 'wing-build'
subprocess.run(['cmake', '-S', str(NATIVE), '-B', str(build), '-DCMAKE_BUILD_TYPE=Release',
    '-DPROJECT_ARCH=arm64', '-DUSE_SANDBOX=ON', '-DCMAKE_C_COMPILER=/usr/bin/clang',
    '-DCMAKE_CXX_COMPILER=/usr/bin/clang++'], check=True)
subprocess.run(['cmake', '--build', str(build), '--target', 'Wing', '-j', os.environ.get('WING_BUILD_JOBS', '1')], check=True)
app = build / 'host/Release/Wing.app'
# Assets must refresh even when no C++ file required recompilation.
shutil.copytree(NATIVE / 'extension', app / 'Contents/Resources/wing-extension', dirs_exist_ok=True)
shutil.copy(ROOT / 'assets/wing.icns', app / 'Contents/Resources/cefsimple.icns')
licenses = app / 'Contents/Resources/Licenses'
licenses.mkdir(exist_ok=True)
shutil.copy(VENDOR / 'cef/LICENSE.txt', licenses / 'CEF-BSD.txt')
shutil.copy(VENDOR / 'cef/CREDITS.html', licenses / 'Chromium-Credits.html')
shutil.copy(ROOT / 'LICENSE-MIT', licenses / 'Wing-MIT.txt')
shutil.copy(sparkle / 'LICENSE', licenses / 'Sparkle.txt')
framework = app / 'Contents/Frameworks/Sparkle.framework'
if framework.exists():
    shutil.rmtree(framework)
shutil.copytree(sparkle / 'Sparkle.framework', framework, symlinks=True)
release_root = ROOT / 'release'
release_root.mkdir(exist_ok=True)
staging = pathlib.Path(tempfile.mkdtemp(prefix='.wing-build-',dir=release_root))
release = staging / 'Wing.app'
try:
    shutil.copytree(app, release, symlinks=True)
    info_path = release / 'Contents/Info.plist'
    with info_path.open('rb') as stream:
        info = plistlib.load(stream)
    info.update(CFBundleIdentifier='org.wingbrowser.Wing.native', CFBundleShortVersionString='0.2.0', CFBundleVersion='2')
    info.update(update_config)
    with info_path.open('wb') as stream:
        plistlib.dump(info, stream)
    destination = release_root / 'Wing Native.app'
    previous = staging / 'previous.app'
    if destination.exists():
        destination.rename(previous)
    try:
        release.rename(destination)
    except BaseException:
        if previous.exists():
            previous.rename(destination)
        raise
    if previous.exists():
        backup_root=release_root / 'previous-builds'
        backup_root.mkdir(exist_ok=True)
        previous.rename(backup_root / (staging.name + '.app'))
finally:
    shutil.rmtree(staging)
print(f'Built native diagnostic browser: {destination}')
if not update_config:
    print('Local build: update feed is not configured; distribution gate remains closed.')
