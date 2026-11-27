#!/usr/bin/env python3
"""Render Wing's release notes as the page the update dialog shows.

  python3 scripts/release_notes.py preview v0.2.0-native.21 out.html
  python3 scripts/release_notes.py backfill v0.2.0-native.19 v0.2.0-native.20 ...

The page leads with this release's "What's new" and lists a few earlier
releases below, since people often skip an update or two. Download links
and GitHub-only sections are left out: the dialog already offers the update.
`backfill` uploads pages for releases that are already out and points their
appcast entries at them.
"""
import datetime, html, json, pathlib, re, subprocess, sys

REPO = 'virajbhartiya/wing'
EARLIER = 4


def gh_release(tag):
    raw = subprocess.run(['gh', 'release', 'view', tag, '--repo', REPO, '--json', 'body,publishedAt'],
                         check=True, text=True, capture_output=True).stdout
    data = json.loads(raw)
    return data['body'], data['publishedAt']


def earlier_tags(tag, limit=EARLIER):
    raw = subprocess.run(['gh', 'release', 'list', '--repo', REPO, '--limit', '40', '--json', 'tagName'],
                         check=True, text=True, capture_output=True).stdout
    tags = [r['tagName'] for r in json.loads(raw)]
    return tags[tags.index(tag) + 1:][:limit] if tag in tags else tags[:limit]


def sections(markdown):
    """Split markdown into (heading, lines). Text before any heading has heading ''."""
    out, heading, lines = [], '', []
    for line in markdown.replace('\r\n', '\n').split('\n'):
        match = re.match(r'#{1,3}\s+(.*)', line)
        if match:
            out.append((heading, lines))
            heading, lines = match.group(1).strip(), []
        else:
            lines.append(line)
    out.append((heading, lines))
    return out


def bullets(lines):
    items, current = [], None
    for line in lines:
        match = re.match(r'\s*[-*]\s+(.*)', line)
        if match:
            current = match.group(1).strip()
            items.append(current)
        elif current is not None and line.startswith('  ') and line.strip():
            items[-1] += ' ' + line.strip()
    return items


def highlights(markdown):
    """What's new and known gaps from a release body, in either of the shapes
    Wing's notes have taken: under a "What's new" heading, or as a bare list."""
    parts = sections(markdown)
    news = next((lines for head, lines in parts if re.match(r"what.s new", head, re.I)), None)
    if news is None:
        news = parts[0][1]
    gaps = next((lines for head, lines in parts if re.match(r'known (gaps|issues|limitations)', head, re.I)), [])
    return bullets(news), bullets(gaps)


def inline(text):
    text = html.escape(text, quote=False)
    text = re.sub(r'`([^`]+)`', r'<code>\1</code>', text)
    text = re.sub(r'\*\*([^*]+)\*\*', r'<strong>\1</strong>', text)
    text = re.sub(r'\[([^\]]+)\]\((https?://[^)\s]+)\)',
                  lambda m: f'<a href="{html.escape(m.group(2))}">{m.group(1)}</a>', text)
    return text


def item_html(text, brief=False):
    # "**Title.** Body" reads as a headline with a line of detail under it.
    # Bold mid-sentence ("**View → Translate** translates…") stays inline.
    match = re.match(r'\*\*(.+?[.!?:])\*\*\s*(.*)', text)
    if match:
        title, body = match.group(1).rstrip(), match.group(2)
        if brief:
            return f'<li><span class="title">{inline(title)}</span></li>'
        return (f'<li><span class="title">{inline(title)}</span>'
                + (f'<span class="body">{inline(body)}</span>' if body else '') + '</li>')
    return f'<li><span class="body plain">{inline(text)}</span></li>'


def when(stamp):
    try:
        day = datetime.datetime.fromisoformat(stamp.replace('Z', '+00:00'))
    except ValueError:
        return ''
    return f'{day:%B} {day.day}, {day.year}'


STYLE = '''
:root{color-scheme:light dark;--ink:#16161a;--muted:#6e6e76;--faint:#a0a0a8;--line:rgba(0,0,0,.08);--fill:rgba(0,0,0,.035);--bg:#fff}
@media (prefers-color-scheme:dark){:root{--ink:#f2f2f4;--muted:#a2a2aa;--faint:#6c6c74;--line:rgba(255,255,255,.1);--fill:rgba(255,255,255,.05);--bg:#1e1e20}}
*{box-sizing:border-box}
html,body{margin:0;background:var(--bg);color:var(--ink)}
body{font:13px/1.5 -apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",sans-serif;padding:22px 24px 28px;-webkit-font-smoothing:antialiased}
header{display:flex;align-items:center;gap:12px;margin-bottom:18px}
.mark{width:34px;height:34px;border-radius:9px;background:var(--ink);display:grid;place-items:center;flex:none}
.mark svg{width:20px;height:20px;fill:var(--bg)}
.eyebrow{font-size:10.5px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
h1{font-size:17px;line-height:1.25;font-weight:650;margin:1px 0 0;letter-spacing:-.01em}
h1 .date{font-weight:400;color:var(--faint);font-size:12px;margin-left:6px;letter-spacing:0}
ul{list-style:none;margin:0;padding:0}
.news li{position:relative;padding:10px 12px 10px 30px;border-radius:10px;background:var(--fill);margin-bottom:6px}
.news li::before{content:"";position:absolute;left:13px;top:17px;width:6px;height:6px;border-radius:50%;background:var(--ink)}
.title{display:block;font-weight:600}
.body{display:block;color:var(--muted)}
.body.plain{color:var(--ink)}
code{font:11.5px ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--fill);padding:1px 4px;border-radius:4px}
a{color:inherit;text-decoration:underline;text-decoration-color:var(--faint);text-underline-offset:2px}
h2{font-size:10.5px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:24px 0 8px}
details{margin-top:18px;border-top:1px solid var(--line);padding-top:12px}
summary{cursor:default;color:var(--muted);font-size:12px;list-style:none}
summary::-webkit-details-marker{display:none}
summary::before{content:"›";display:inline-block;width:12px;transition:transform .15s}
details[open] summary::before{transform:rotate(90deg)}
.gaps li,.older li{color:var(--muted);padding:3px 0 3px 14px;position:relative}
.gaps li::before,.older li::before{content:"–";position:absolute;left:0;color:var(--faint)}
.older .title{display:inline;font-weight:500;color:var(--ink)}
.older .body{display:inline;color:var(--muted)}
.older .body.plain{color:var(--ink)}
.news strong,.older strong{font-weight:600}
.release{margin-bottom:14px}
.release h3{font-size:12px;font-weight:600;margin:0 0 4px}
.release h3 span{font-weight:400;color:var(--faint);margin-left:6px}
'''

WING_MARK = ('<svg viewBox="212 230 608 550" aria-hidden="true">'
             '<path d="M262 730C330 500 500 340 770 280C730 520 540 700 262 730Z"/></svg>')


def render(tag, markdown, published, earlier=()):
    news, gaps = highlights(markdown)
    version = tag.lstrip('v')
    parts = [
        '<!doctype html><html lang="en"><head><meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width,initial-scale=1">',
        f'<title>What’s new in Wing {html.escape(version)}</title><style>{STYLE}</style></head><body>',
        f'<header><div class="mark">{WING_MARK}</div><div><div class="eyebrow">What’s new</div>',
        f'<h1>Wing {html.escape(version)}<span class="date">{html.escape(when(published))}</span></h1></div></header>',
        '<ul class="news">' + ''.join(map(item_html, news or ['Fixes and improvements.'])) + '</ul>',
    ]
    if gaps:
        parts.append('<details><summary>Known limitations</summary><ul class="gaps">'
                     + ''.join(map(item_html, gaps)) + '</ul></details>')
    older = [(t, highlights(body)[0], stamp) for t, body, stamp in earlier]
    older = [(t, items, stamp) for t, items, stamp in older if items]
    if older:
        parts.append('<h2>Earlier updates</h2><div class="older">')
        for t, items, stamp in older:
            parts.append(f'<div class="release"><h3>{html.escape(t.lstrip("v"))}<span>{html.escape(when(stamp))}</span></h3>'
                         '<ul>' + ''.join(item_html(i, brief=True) for i in items) + '</ul></div>')
        parts.append('</div>')
    parts.append('</body></html>')
    return '\n'.join(parts)


def render_release(tag, markdown=None, published=None):
    """The page for `tag`, using GitHub for anything not passed in."""
    if markdown is None:
        markdown, published = gh_release(tag)
    published = published or datetime.datetime.now(datetime.timezone.utc).isoformat()
    try:
        earlier = [(t, *gh_release(t)) for t in earlier_tags(tag)]
    except (subprocess.CalledProcessError, OSError, ValueError):
        earlier = []  # The page still says what's new without the history.
    return render(tag, markdown, published, earlier)


def notes_key(tag):
    return f'releases/{tag}/notes.html'


def upload_page(bucket, tag, page):
    from publish_updates import aws
    import tempfile
    with tempfile.NamedTemporaryFile('w', suffix='.html', encoding='utf-8') as out:
        out.write(page)
        out.flush()
        aws('s3', 'cp', out.name, f's3://{bucket}/{notes_key(tag)}', '--content-type',
            'text/html; charset=utf-8', '--cache-control', 'no-cache', '--only-show-errors', capture=False)


def backfill(tags):
    """Upload notes pages for published releases and repoint their appcast entries."""
    from publish_updates import aws, stack_outputs, SPARKLE_NS
    import tempfile
    import xml.etree.ElementTree as ET
    outputs = stack_outputs()
    bucket, domain = outputs['UpdatesBucket'], outputs['Domain']
    for tag in tags:
        upload_page(bucket, tag, render_release(tag))
        print(f'Uploaded https://{domain}/{notes_key(tag)}')
    wanted = {t.lstrip('v') for t in tags}
    for arch in ('arm64', 'x64'):
        key = f'appcast-{arch}.xml'
        rss = ET.fromstring(aws('s3', 'cp', f's3://{bucket}/{key}', '-'))
        changed = 0
        for node in rss.iter('item'):
            version = node.findtext(f'{{{SPARKLE_NS}}}shortVersionString')
            link = node.find(f'{{{SPARKLE_NS}}}releaseNotesLink')
            if version in wanted and link is not None:
                link.text = f'https://{domain}/{notes_key("v" + version)}'
                changed += 1
        if not changed:
            continue
        ET.indent(rss)
        with tempfile.NamedTemporaryFile(suffix='.xml') as feed:
            feed.write(b'<?xml version="1.0" encoding="utf-8"?>\n' + ET.tostring(rss, encoding='utf-8'))
            feed.flush()
            aws('s3', 'cp', feed.name, f's3://{bucket}/{key}', '--content-type', 'application/rss+xml',
                '--cache-control', 'no-cache', '--only-show-errors', capture=False)
        print(f'{key}: {changed} release notes link(s) now point at Wing’s notes pages')


if __name__ == '__main__':
    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
    if len(sys.argv) == 4 and sys.argv[1] == 'preview':
        pathlib.Path(sys.argv[3]).write_text(render_release(sys.argv[2]), encoding='utf-8')
    elif len(sys.argv) > 2 and sys.argv[1] == 'backfill':
        backfill(sys.argv[2:])
    else:
        raise SystemExit(__doc__)
