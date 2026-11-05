"""Receipts bind a successfully built framework to its header and Wing inputs."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
INPUTS = ['native/chromium-sources.json', 'native/wing-engine-identity.json',
          'native/chromium/wing-profile-api.inc', 'scripts/chromium_identity.py']


def digest(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def write_receipt(source, destination, arch='arm64'):
    framework = source / f'out/Release_GN_{arch}/Chromium Framework.framework'
    header = source / 'ardia/core/public/ArdiaCore.h'
    receipt = {'kind': 'wing-source', 'framework': str(framework), 'header': str(header),
               'binarySHA256': digest(framework / 'Versions/Current/Chromium Framework'),
               'headerSHA256': digest(header),
               'inputs': {name: digest(ROOT / name) for name in INPUTS}}
    temporary = destination.with_suffix('.tmp')
    temporary.write_text(json.dumps(receipt, indent=2) + '\n')
    temporary.replace(destination)
    return receipt


def verify_receipt(path):
    receipt = json.loads(Path(path).read_text())
    if receipt.get('kind') != 'wing-source':
        raise RuntimeError('Expected a completed Wing source build receipt.')
    for name in INPUTS:
        if receipt.get('inputs', {}).get(name) != digest(ROOT / name):
            raise RuntimeError(f'Source build is stale: {name}')
    framework, header = Path(receipt['framework']), Path(receipt['header'])
    if digest(framework / 'Versions/Current/Chromium Framework') != receipt['binarySHA256'] or digest(header) != receipt['headerSHA256']:
        raise RuntimeError('Source framework or header changed after compilation.')
    return receipt
