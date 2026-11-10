#!/usr/bin/env python3
"""Publish a built release to Wing's update channel (infra/wing-cloud.yaml).

  python3 scripts/publish_updates.py v0.2.0-native.10 dist/Wing-0.2.0-native.10-arm64.zip ...

Each zip is signed with the Sparkle key in the login Keychain (account "wing"),
uploaded with its DMG beside it, and put at the top of its architecture's
appcast. The DMG is also copied to /Wing-<arch>.dmg, a stable download link.
"""
import email.utils, json, pathlib, plistlib, re, subprocess, sys, tempfile, time, zipfile
import xml.etree.ElementTree as ET

ROOT = pathlib.Path(__file__).resolve().parents[1]
CLOUD = json.loads((ROOT / 'native/chromium/cloud.json').read_text())
STACK, REGION = 'wing-cloud', 'ap-south-1'
REPO = 'virajbhartiya/wing'
SPARKLE_NS = 'http://www.andymatuschak.org/xml-namespaces/sparkle'
KEEP = 10
ET.register_namespace('sparkle', SPARKLE_NS)


def aws(*args, capture=True):
    return subprocess.run(['aws', *args, '--region', REGION], check=True, text=True,
                          capture_output=capture).stdout


def stack_outputs():
    stacks = json.loads(aws('cloudformation', 'describe-stacks', '--stack-name', STACK))
    return {o['OutputKey']: o['OutputValue'] for o in stacks['Stacks'][0]['Outputs']}


def sign(archive):
    tool = ROOT / f"native/vendor/sparkle/{CLOUD['sparkle']['version']}/bin/sign_update"
    if not tool.exists():
        raise SystemExit(f'Missing {tool}; build once so the pinned Sparkle is unpacked.')
    out = subprocess.run([str(tool), '--account', 'wing', str(archive)], check=True, text=True,
                         capture_output=True).stdout
    return dict(re.findall(r'sparkle:(\w+)="([^"]+)"', out)) | dict(re.findall(r'(length)="(\d+)"', out))


def bundle_info(archive):
    with zipfile.ZipFile(archive) as z:
        name = next(n for n in z.namelist() if re.fullmatch(r'[^/]+\.app/Contents/Info\.plist', n))
        return plistlib.loads(z.read(name))


def item(tag, arch, archive, signature, info, domain):
    sp = lambda name: f'{{{SPARKLE_NS}}}{name}'
    node = ET.Element('item')
    ET.SubElement(node, 'title').text = f'Wing {tag[1:]}'
    ET.SubElement(node, 'pubDate').text = email.utils.formatdate(time.time(), usegmt=True)
    ET.SubElement(node, sp('version')).text = str(info['CFBundleVersion'])
    ET.SubElement(node, sp('shortVersionString')).text = tag[1:]
    ET.SubElement(node, sp('minimumSystemVersion')).text = info.get('LSMinimumSystemVersion', '14.0')
    ET.SubElement(node, sp('releaseNotesLink')).text = f'https://github.com/{REPO}/releases/tag/{tag}'
    ET.SubElement(node, 'enclosure', {
        'url': f'https://{domain}/releases/{tag}/{archive.name}',
        'length': signature['length'],
        'type': 'application/octet-stream',
        sp('edSignature'): signature['edSignature'],
    })
    return node


def appcast(existing, new_item):
    if existing:
        rss = ET.fromstring(existing)
    else:
        rss = ET.Element('rss', {'version': '2.0'})
        channel = ET.SubElement(rss, 'channel')
        ET.SubElement(channel, 'title').text = 'Wing'
        ET.SubElement(channel, 'link').text = f'https://github.com/{REPO}'
    channel = rss.find('channel')
    items = [i for i in channel.findall('item')
             if i.findtext(f'{{{SPARKLE_NS}}}version') != new_item.findtext(f'{{{SPARKLE_NS}}}version')]
    for old in channel.findall('item'):
        channel.remove(old)
    for kept in [new_item, *items][:KEEP]:
        channel.append(kept)
    ET.indent(rss)
    return b'<?xml version="1.0" encoding="utf-8"?>\n' + ET.tostring(rss, encoding='utf-8')


def publish(tag, archives):
    outputs = stack_outputs()
    bucket, domain = outputs['UpdatesBucket'], outputs['Domain']
    if CLOUD['domain'] != domain:
        raise SystemExit(f"native/chromium/cloud.json domain is {CLOUD['domain']!r}, the stack serves {domain}.")
    invalidate = []
    for archive in map(pathlib.Path, archives):
        arch = re.search(r'-(arm64|x64)\.zip$', archive.name).group(1)
        info = bundle_info(archive)
        if info.get('SUFeedURL') != f'https://{domain}/appcast-{arch}.xml':
            raise SystemExit(f'{archive.name} was not built with this update feed.')
        signature = sign(archive)
        image = archive.with_suffix('.dmg')
        for path in [archive, image]:
            aws('s3', 'cp', str(path), f's3://{bucket}/releases/{tag}/{path.name}', '--only-show-errors', capture=False)
        aws('s3', 'cp', str(image), f's3://{bucket}/Wing-{arch}.dmg', '--only-show-errors',
            '--content-disposition', f'attachment; filename="Wing-{arch}.dmg"', capture=False)
        key = f'appcast-{arch}.xml'
        try:
            existing = aws('s3', 'cp', f's3://{bucket}/{key}', '-')
        except subprocess.CalledProcessError:
            existing = ''
        with tempfile.NamedTemporaryFile(suffix='.xml') as feed:
            feed.write(appcast(existing, item(tag, arch, archive, signature, info, domain)))
            feed.flush()
            aws('s3', 'cp', feed.name, f's3://{bucket}/{key}', '--content-type', 'application/rss+xml',
                '--cache-control', 'no-cache', '--only-show-errors', capture=False)
        invalidate.append(f'/Wing-{arch}.dmg')
        print(f'Published {archive.name} to https://{domain}/{key}')
    aws('cloudfront', 'create-invalidation', '--distribution-id', outputs['DistributionId'],
        '--paths', *invalidate)


if __name__ == '__main__':
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)
    publish(sys.argv[1], sys.argv[2:])
