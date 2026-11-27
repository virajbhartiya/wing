#!/usr/bin/env python3
"""Publish a built release to Wing's update channel (infra/wing-cloud.yaml).

  python3 scripts/publish_updates.py v0.2.0-native.10 dist/Wing-0.2.0-native.10-arm64.zip ...

Each zip is signed with the Sparkle key in the login Keychain (account "wing"),
uploaded with its DMG beside it, and put at the top of its architecture's
appcast. The DMG is also copied to /Wing-<arch>.dmg, a stable download link.
"""
import base64, email.utils, json, pathlib, plistlib, re, subprocess, sys, tempfile, time, zipfile
import xml.etree.ElementTree as ET

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from release_notes import notes_key, render_release

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


def verify_signature(archive, signature, public_key):
    checked = subprocess.run(
        ['/usr/bin/swift', str(ROOT / 'scripts/verify-sparkle-signature.swift'),
         str(archive), public_key, signature],
        capture_output=True, text=True,
    )
    if checked.returncode:
        raise SystemExit(f'{archive.name}: Sparkle signature verification failed. {checked.stderr.strip()}')


def item(tag, arch, archive, signature, info, domain, notes=False):
    sp = lambda name: f'{{{SPARKLE_NS}}}{name}'
    node = ET.Element('item')
    ET.SubElement(node, 'title').text = f'Wing {tag[1:]}'
    ET.SubElement(node, 'pubDate').text = email.utils.formatdate(time.time(), usegmt=True)
    ET.SubElement(node, sp('version')).text = str(info['CFBundleVersion'])
    ET.SubElement(node, sp('shortVersionString')).text = tag[1:]
    ET.SubElement(node, sp('minimumSystemVersion')).text = info.get('LSMinimumSystemVersion', '14.0')
    # The update dialog shows Wing's own notes page; GitHub is the fallback.
    ET.SubElement(node, sp('releaseNotesLink')).text = (
        f'https://{domain}/{notes_key(tag)}' if notes else f'https://github.com/{REPO}/releases/tag/{tag}')
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


def stored_size(bucket, key):
    try:
        return json.loads(aws('s3api', 'head-object', '--bucket', bucket, '--key', key))['ContentLength']
    except subprocess.CalledProcessError:
        return None


def store(bucket, key, size, command, skip_present=True):
    """Run an S3 copy until the object is there whole. Large uploads have
    dropped mid-way and have reported success with nothing stored."""
    if skip_present and stored_size(bucket, key) == size:
        print(f'{key}: already stored')
        return
    for attempt in range(1, 4):
        try:
            aws(*command, '--only-show-errors', capture=False)
        except subprocess.CalledProcessError:
            pass
        stored = stored_size(bucket, key)
        if stored == size:
            return
        print(f'{key}: stored {stored} bytes, expected {size}; retrying ({attempt}/3)')
    raise SystemExit(f'{key} did not upload whole after 3 attempts.')


def prepare_uploads(tag, archives, notes=None):
    """Validate every artifact and build its appcast entry before publishing.
    `notes` is the Markdown release notes; it becomes the update dialog's page."""
    page = render_release(tag, pathlib.Path(notes).read_text(encoding='utf-8')) if notes else None
    outputs = stack_outputs()
    bucket, domain = outputs['UpdatesBucket'], outputs['Domain']
    if CLOUD['domain'] != domain:
        raise SystemExit(f"native/chromium/cloud.json domain is {CLOUD['domain']!r}, the stack serves {domain}.")
    prepared = []
    for archive in map(pathlib.Path, archives):
        match = re.search(r'-(arm64|x64)\.zip$', archive.name)
        if not match:
            raise SystemExit(f'{archive.name} must end in -arm64.zip or -x64.zip.')
        arch = match.group(1)
        info = bundle_info(archive)
        if info.get('SUFeedURL') != f'https://{domain}/appcast-{arch}.xml':
            raise SystemExit(f'{archive.name} was not built with this update feed.')
        public_key = CLOUD['publicEDKey']
        if info.get('SUPublicEDKey') != public_key:
            raise SystemExit(f'{archive.name} was not built with the configured update public key.')
        image = archive.with_suffix('.dmg')
        archive_size, image_size = archive.stat().st_size, image.stat().st_size
        signature = sign(archive)
        if signature.get('length') != str(archive_size):
            raise SystemExit(f'{archive.name}: Sparkle signature length metadata does not match the archive.')
        try:
            raw_signature = base64.b64decode(signature.get('edSignature', ''), validate=True)
        except ValueError:
            raw_signature = b''
        if len(raw_signature) != 64:
            raise SystemExit(f'{archive.name}: Sparkle did not return a valid Ed25519 signature.')
        verify_signature(archive, signature['edSignature'], public_key)
        prepared.append((arch, archive, archive_size, image, image_size,
                         item(tag, arch, archive, signature, info, domain, notes=page is not None)))
    return tag, bucket, domain, outputs['DistributionId'], prepared, page


def upload_prepared(uploads):
    tag, bucket, domain, distribution, prepared, page = uploads
    invalidate = []
    if page is not None:
        # Before any appcast points at it.
        with tempfile.NamedTemporaryFile('w', suffix='.html', encoding='utf-8') as out:
            out.write(page)
            out.flush()
            aws('s3', 'cp', out.name, f's3://{bucket}/{notes_key(tag)}', '--content-type',
                'text/html; charset=utf-8', '--cache-control', 'no-cache', '--only-show-errors', capture=False)
    for arch, archive, archive_size, image, image_size, update in prepared:
        for path, size in [(archive, archive_size), (image, image_size)]:
            key = f'releases/{tag}/{path.name}'
            store(bucket, key, size, ['s3', 'cp', str(path), f's3://{bucket}/{key}'])
        # The stable link is a server-side copy, so a dropped connection costs little.
        store(bucket, f'Wing-{arch}.dmg', image_size,
              ['s3', 'cp', f's3://{bucket}/releases/{tag}/{image.name}', f's3://{bucket}/Wing-{arch}.dmg',
               '--metadata-directive', 'REPLACE', '--content-type', 'application/x-apple-diskimage',
               '--content-disposition', f'attachment; filename="Wing-{arch}.dmg"'], skip_present=False)
        key = f'appcast-{arch}.xml'
        try:
            existing = aws('s3', 'cp', f's3://{bucket}/{key}', '-')
        except subprocess.CalledProcessError:
            existing = ''
        with tempfile.NamedTemporaryFile(suffix='.xml') as feed:
            feed.write(appcast(existing, update))
            feed.flush()
            aws('s3', 'cp', feed.name, f's3://{bucket}/{key}', '--content-type', 'application/rss+xml',
                '--cache-control', 'no-cache', '--only-show-errors', capture=False)
        invalidate.append(f'/Wing-{arch}.dmg')
        print(f'Published {archive.name} to https://{domain}/{key}')
    aws('cloudfront', 'create-invalidation', '--distribution-id', distribution,
        '--paths', *invalidate)


def publish(tag, archives, notes=None):
    upload_prepared(prepare_uploads(tag, archives, notes))


if __name__ == '__main__':
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)
    publish(sys.argv[1], sys.argv[2:])
