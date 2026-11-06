"""Qualification gates for staging the persistent-profile Chromium application."""
import json
from pathlib import Path
from chromium_artifact import digest

ROOT = Path(__file__).resolve().parent.parent


def host_inputs(root=ROOT):
    paths = [p for folder in ('src', 'native/chromium') for p in (root / folder).rglob('*')
             if p.is_file() and p.suffix in {'.cjs', '.js', '.mm', '.h', '.swift', '.html', '.css', '.json'}
             and p.name != 'preload.bundle.cjs']
    paths += [root / name for name in ('scripts/build-chromium-preview.py',
              'scripts/chromium_distribution.py', 'package.json', 'native/node-import-sources.json', 'native/ublock-sources.json')]
    return {str(p.relative_to(root)): digest(p) for p in sorted(paths)}


def qualification_report(arch):
    return 'docs/chromium-preview-qualification.json' if arch == 'arm64' else f'docs/chromium-preview-qualification-{arch}.json'


def verify_qualification(report, receipt, inputs):
    if not receipt or receipt.get('kind') != 'wing-source':
        raise RuntimeError('Persistent-profile builds require the Wing source engine.')
    if not report.get('passed') or report.get('engine') != receipt:
        raise RuntimeError('This exact source engine has not passed native qualification.')
    if report.get('hostInputs') != inputs:
        raise RuntimeError('Host inputs changed since qualification; rebuild and qualify the preview.')
    scenarios = report.get('scenarios', [])
    if {row.get('phase') for row in scenarios} != {'initial', 'restart'} or not all(
        row.get('passed') and row.get('exitCode') == 0 and row.get('sourceProfilePreserved')
        and row.get('privateWorkspaceFile') for row in scenarios
    ):
        raise RuntimeError('Initial/restart profile qualification is incomplete.')
