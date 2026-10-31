#!/usr/bin/env python3
"""Read-only security maintenance check of the pinned engine against Chrome stable."""
import json,pathlib,sys,urllib.request
root=pathlib.Path(__file__).resolve().parents[1]
pinned=json.loads((root/'native/chromium-sources.json').read_text())['chromium']['version']
url='https://versionhistory.googleapis.com/v1/chrome/platforms/mac_arm64/channels/stable/versions?pageSize=1'
with urllib.request.urlopen(url,timeout=30) as response:latest=json.load(response)['versions'][0]['version']
parts=lambda version:tuple(int(part) for part in version.split('.'))
report={'pinned':pinned,'latestStable':latest,'updateAvailable':parts(pinned)<parts(latest)}
print(json.dumps(report,indent=2))
if report['updateAvailable']:sys.exit(2)
