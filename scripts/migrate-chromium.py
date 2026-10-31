"""Compile, package and qualify the Wing source engine as one resumable pipeline.

A successful run is an engine migration qualification, not release approval.
The installed Electron browser and user profiles are never replaced.
"""
import datetime
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent
BUILD = ROOT.parent / (ROOT.name + '-chromium-build')
STATUS = ROOT / 'docs/chromium-migration-build-status.json'


def status(stage, state, **details):
    payload = {'stage': stage, 'state': state,
               'updatedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
               **details}
    temporary = STATUS.with_suffix('.tmp')
    temporary.write_text(json.dumps(payload, indent=2) + '\n')
    temporary.replace(STATUS)


def main():
    stages = []
    if not (BUILD / '.wing-source-synced').exists():
        stages.append(('sync', [sys.executable, 'scripts/prepare-chromium.py', '--sync']))
    if not (BUILD / '.wing-patches-applied').exists():
        stages.append(('patch', [sys.executable, 'scripts/build-chromium.py', 'patch']))
    stages.extend([
        ('configure', [sys.executable, 'scripts/build-chromium.py', 'configure']),
        ('compile', [sys.executable, 'scripts/build-chromium.py', 'compile', '--jobs', '2']),
        ('package', [sys.executable, 'scripts/build-chromium-preview.py', '--source-receipt', str(BUILD / 'wing-build-receipt.json')]),
        ('qualify', [sys.executable, 'scripts/test-chromium-preview.py']),
        ('stage-production', [sys.executable, 'scripts/build-chromium-preview.py', '--production', '--source-receipt', str(BUILD / 'wing-build-receipt.json')]),
    ])
    for name, command in stages:
        status(name, 'running')
        try:
            subprocess.run(command, cwd=ROOT, check=True)
        except subprocess.CalledProcessError as error:
            status(name, 'failed', exitCode=error.returncode)
            return error.returncode
        except KeyboardInterrupt:
            status(name, 'interrupted')
            return 130
    status('stage-production', 'passed', releaseReady=False,
           productionAppReceipt='native/build/chromium-production/latest.json',
           report='docs/chromium-preview-qualification.json')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
