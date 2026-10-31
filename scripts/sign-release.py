#!/usr/bin/env python3
"""Sign and optionally notarize a staged Wing build. Fails before mutation without a distribution identity."""
import argparse,json,os,pathlib,plistlib,subprocess
from release_config import validate
ROOT=pathlib.Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser();parser.add_argument('--app',type=pathlib.Path,default=ROOT/'release/Wing.app');parser.add_argument('--notarize',action='store_true');args=parser.parse_args()
identity=os.environ.get('WING_SIGNING_IDENTITY','')
if not identity.startswith('Developer ID Application:'):
    raise SystemExit('Release signing requires WING_SIGNING_IDENTITY selecting a Developer ID Application certificate. Apple Development is not a distribution identity.')
profile=os.environ.get('WING_NOTARY_PROFILE','')
if args.notarize and not profile:raise SystemExit('WING_NOTARY_PROFILE must name an existing notarytool keychain profile.')
config=ROOT/'release-config.json'
if not config.exists():raise SystemExit('A validated release-config.json with an HTTPS feed and Sparkle public key is required.')
expected=validate(json.loads(config.read_text()))
with (args.app/'Contents/Info.plist').open('rb') as stream:info=plistlib.load(stream)
if any(info.get(k)!=v for k,v in expected.items()):raise SystemExit('Rebuild with the current release configuration before signing.')
identities=subprocess.check_output(['security','find-identity','-v','-p','codesigning'],text=True)
if identity not in identities:raise SystemExit('The selected distribution identity is not available.')
def run(*command):subprocess.run([str(x) for x in command],check=True)
def sign(target,entitlements=None,runtime=False,preserve=False):
    command=['codesign','--force','--sign',identity,'--timestamp']
    if runtime:command+=['--options','runtime']
    if entitlements:command+=['--entitlements',str(ROOT/'native/entitlements'/entitlements)]
    elif preserve:command+=['--preserve-metadata=entitlements']
    run(*command,target)
frameworks=args.app/'Contents/Frameworks'
# Mach-O inventories include nonstandard library locations. Never traverse symlink aliases twice.
for path in sorted(frameworks.rglob('*'),key=lambda p:len(p.parts),reverse=True):
    if not path.is_file() or path.is_symlink():continue
    description=subprocess.check_output(['file','-b',str(path)],text=True)
    if 'Mach-O' in description:sign(path,runtime='executable' in description,preserve=True)
for path in sorted(frameworks.rglob('*'),key=lambda p:len(p.parts),reverse=True):
    if path.is_symlink() or not path.is_dir() or path.suffix not in {'.app','.xpc','.framework'}:continue
    if path.name.startswith('Wing Helper'):
        sign(path,'jit.plist' if any(role in path.name for role in ['(Renderer)','(GPU)']) else 'helper.plist',True)
    else:sign(path,runtime=path.suffix!='.framework',preserve=True)
sign(args.app,'app.plist',True)
run('codesign','--verify','--deep','--strict','--verbose=2',args.app)
if args.notarize:
    archive=ROOT/'release/Wing-notarization.zip'
    run('ditto','-c','-k','--sequesterRsrc','--keepParent',args.app,archive)
    submitted=json.loads(subprocess.check_output(['xcrun','notarytool','submit',str(archive),'--keychain-profile',profile,'--wait','--output-format','json'],text=True))
    (ROOT/'release/notarization-result.json').write_text(json.dumps(submitted,indent=2)+'\n')
    if submitted.get('status')!='Accepted':raise SystemExit('Notarization was not accepted; no release artifact will be issued.')
    run('xcrun','stapler','staple',args.app);run('xcrun','stapler','validate',args.app)
    run('spctl','--assess','--type','execute','--verbose=2',args.app)
    run('ditto','-c','-k','--sequesterRsrc','--keepParent',args.app,ROOT/'release/Wing-0.2.0-macos-arm64.zip')
    print('Signed, notarized and stapled archive created. Publishing is a separate step.')
