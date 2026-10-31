"""Watch an existing source-build pipeline without changing or restarting it."""
import argparse
import json
from pathlib import Path
import re
import shutil
import subprocess
import time

ROOT = Path(__file__).resolve().parent.parent
STATUS = ROOT / 'docs/chromium-migration-build-status.json'
PROGRESS = re.compile(r'\[(\d+)/(\d+)\]\s+((?:\d+h)?(?:\d+m)?[\d.]+s)\s+[SF-]\s+(.+)')


def latest_progress(log):
    try:
        with log.open('rb') as stream:
            stream.seek(max(0, log.stat().st_size - 65536))
            lines = stream.read().decode(errors='replace').splitlines()
        for line in reversed(lines):
            match = PROGRESS.match(line)
            if match:
                completed, total, elapsed, step = match.groups()
                return {'completed': int(completed), 'total': int(total),
                        'elapsed': elapsed, 'step': step}
    except OSError:
        pass
    return None


def outcome(status, alive):
    state = status.get('state')
    if state == 'failed':
        return 'failed', f"Wing build failed during {status.get('stage', 'an unknown stage')}."
    if state == 'interrupted':
        return 'interrupted', 'Wing build was interrupted.'
    if state == 'passed':
        return 'passed', 'Wing source build, qualification and production staging finished. Release signing is separate.'
    if not alive:
        return 'stopped', 'Wing build process exited without a terminal status. Check the build log.'
    return None


def notify(message):
    # Pass text as data, never interpolate log content into AppleScript source.
    try:
        result = subprocess.run(['osascript', '-e',
            'on run argv\ndisplay notification (item 1 of argv) with title "Wing build"\nend run',
            message], capture_output=True, text=True, timeout=10)
        return {'requested': result.returncode == 0, 'error': result.stderr.strip()}
    except (OSError, subprocess.TimeoutExpired) as error:
        return {'requested': False, 'error': str(error)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pipeline-pid', type=int, required=True)
    parser.add_argument('--log', type=Path, default=Path('/tmp/wing-chromium-migration.log'))
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if args.pipeline_pid <= 1:
        parser.error('Expected the running migration pipeline PID.')
    # Bind to this process instance so a reused PID cannot keep the watcher alive.
    def process_identity():
        return subprocess.run(['ps', '-p', str(args.pipeline_pid), '-o', 'lstart=', '-o', 'command='],
                              capture_output=True, text=True, timeout=5).stdout.strip()
    identity = process_identity()
    if 'scripts/migrate-chromium.py' not in identity:
        parser.error('PID does not identify the source migration pipeline.')
    last_stage = None
    warned_disk = False
    while True:
        alive = process_identity() == identity
        try:
            status = json.loads(STATUS.read_text())
        except (OSError, json.JSONDecodeError):
            status = {}
        free = shutil.disk_usage(ROOT).free / 2**30
        result = {'checkedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
                  'pipelinePID': args.pipeline_pid, 'pipelineAlive': alive,
                  'status': status, 'progress': latest_progress(args.log),
                  'freeGiB': round(free, 2)}
        finished = outcome(status, alive)
        stage = status.get('stage')
        if finished:
            result['outcome'] = finished[0]
            result['notification'] = notify(finished[1])
        elif stage != last_stage and stage in {'package', 'qualify', 'stage-production'}:
            result['notification'] = notify(f'Wing build reached {stage}.')
        elif free < 18 and not warned_disk:
            result['notification'] = notify(f'Wing build has {free:.1f} GiB free. The pipeline stops below its 15 GiB reserve.')
            warned_disk = True
        temporary = args.output.with_suffix('.tmp')
        temporary.write_text(json.dumps(result, indent=2) + '\n')
        temporary.replace(args.output)
        print(json.dumps(result), flush=True)
        if finished:
            return 0 if finished[0] == 'passed' else 1
        last_stage = stage
        time.sleep(30)


if __name__ == '__main__':
    raise SystemExit(main())
