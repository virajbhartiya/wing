#!/usr/bin/env python3
"""Read-only security maintenance check against CEF's official build index."""
import json,pathlib,sys,urllib.request
root=pathlib.Path(__file__).resolve().parents[1]
locked=json.loads((root/'native/cef-lock.json').read_text())
with urllib.request.urlopen('https://cef-builds.spotifycdn.com/index.json',timeout=30) as response:index=json.load(response)
stable=[v for v in index['macosarm64']['versions'] if v.get('channel')=='stable']
if not stable:raise SystemExit('The official index returned no stable macOS arm64 build.')
latest=stable[0]
report={'pinned':locked['version'],'latestStable':latest['cef_version'],'updateAvailable':latest['cef_version']!=locked['version']}
print(json.dumps(report,indent=2))
if report['updateAvailable']:sys.exit(2)
