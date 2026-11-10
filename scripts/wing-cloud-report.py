#!/usr/bin/env python3
"""What Wing's cloud has heard lately: crash groups and daily update checks.

  python3 scripts/wing-cloud-report.py            last 7 days
  python3 scripts/wing-cloud-report.py --days 30
  python3 scripts/wing-cloud-report.py --crash KEY  print one crash's stack

Update checks come from the CloudFront logs of appcast requests; Sparkle's
user agent carries the installed version. Distinct IPs per day approximate
active installs and are never stored anywhere else.
"""
import argparse, collections, datetime, gzip, json, pathlib, subprocess, sys, tempfile

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from publish_updates import REGION, stack_outputs


def aws(*args):
    return subprocess.run(['aws', *args, '--region', REGION], check=True, text=True, capture_output=True).stdout


def ips_frames(report, count=6):
    lines = report.split('\n', 1)
    header, body = json.loads(lines[0]), json.loads(lines[1])
    images = body.get('usedImages', [])
    thread = next((t for t in body.get('threads', []) if t.get('triggered')), {})
    # An uncaught exception's own stack says more than AppKit's crash handler.
    raw = body.get('lastExceptionBacktrace') or thread.get('frames', [])
    skip = ('__exceptionPreprocess', 'objc_exception_throw', '_crashOnException', 'reportException')
    raw = [f for f in raw if not any(s in (f.get('symbol') or '') for s in skip)]
    frames = [f"{images[f['imageIndex']].get('name', '?') if f.get('imageIndex', -1) < len(images) else '?'} "
              f"{f.get('symbol') or hex(f.get('imageOffset', 0))}" for f in raw[:count]]
    exception = body.get('exception', {})
    return header, f"{exception.get('type', '?')} {exception.get('signal', '')}".strip(), frames


def crashes(bucket, days):
    start = datetime.date.today() - datetime.timedelta(days=days)
    groups = collections.defaultdict(list)
    for offset in range(days + 1):
        day = start + datetime.timedelta(days=offset)
        listing = aws('s3api', 'list-objects-v2', '--bucket', bucket, '--prefix', f'crashes/{day:%Y/%m/%d}/',
                      '--query', 'Contents[].Key', '--output', 'json')
        for key in json.loads(listing) or []:
            data = json.loads(aws('s3', 'cp', f's3://{bucket}/{key}', '-'))
            try:
                header, kind, frames = ips_frames(data['report'], 3)
            except (ValueError, KeyError, IndexError):
                continue
            # Skip the crash machinery frames to group by where Wing went wrong.
            useful = [f for f in frames if not f.split(' ')[0] in ('libsystem_kernel.dylib', 'libsystem_c.dylib')]
            groups[(header.get('name', '?'), kind, useful[0] if useful else '?')].append((key, data.get('version'), data.get('build')))
    print(f'Crashes since {start}: {sum(map(len, groups.values()))}')
    for (process, kind, frame), hits in sorted(groups.items(), key=lambda g: -len(g[1])):
        builds = sorted({b for _, _, b in hits if b})
        print(f'  {len(hits):4}  {process}  {kind}  at {frame}  (builds {", ".join(builds)})\n        e.g. {hits[0][0]}')


def update_checks(bucket, days):
    start = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=days)
    daily = collections.defaultdict(set)
    versions = collections.defaultdict(set)
    with tempfile.TemporaryDirectory() as folder:
        aws('s3', 'sync', f's3://{bucket}/cloudfront/', folder, '--exclude', '*',
            *sum([['--include', f'*.{(start + datetime.timedelta(days=d)):%Y-%m-%d}-*'] for d in range(days + 1)], []))
        for log in pathlib.Path(folder).glob('*.gz'):
            for line in gzip.open(log, 'rt'):
                if line.startswith('#'):
                    continue
                f = line.rstrip('\n').split('\t')
                if len(f) < 11 or not f[7].startswith('/appcast-'):
                    continue
                agent = f[10].replace('%20', ' ')
                version = agent.split(' ')[0] if agent.startswith('Wing') else agent[:40]
                daily[f[0]].add(f[4])
                versions[version].add(f[4])
    print(f'Update checks since {start:%Y-%m-%d} (distinct IPs per day):')
    for day in sorted(daily):
        print(f'  {day}  {len(daily[day])}')
    print('By installed version:')
    for version, ips in sorted(versions.items(), key=lambda v: -len(v[1])):
        print(f'  {len(ips):5}  {version}')


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--days', type=int, default=7)
    parser.add_argument('--crash', help='an S3 key from the crash list')
    args = parser.parse_args()
    outputs = stack_outputs()
    if args.crash:
        data = json.loads(aws('s3', 'cp', f"s3://{outputs['CrashBucket']}/{args.crash}", '-'))
        header, kind, frames = ips_frames(data['report'], 40)
        print(f"{header.get('name')} {data.get('version')} ({data.get('build')}, {data.get('arch')}) on {data.get('os')}: {kind}")
        print('\n'.join('  ' + f for f in frames))
        return
    crashes(outputs['CrashBucket'], args.days)
    print()
    update_checks(outputs['LogsBucket'], args.days)


if __name__ == '__main__':
    main()
