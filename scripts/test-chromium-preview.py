"""Exercise Wing's migrated UI and native host using only disposable profiles."""
import argparse
import http.server
import json
import os
from pathlib import Path
import signal
import sqlite3
import hashlib
import base64
import subprocess
import tempfile
import threading
import time
from chromium_distribution import qualification_report

ROOT = Path(__file__).resolve().parent.parent
# The suite opens several independently protected profiles and browser services.
# Per-operation deadlines still detect hangs; this bounds the whole scenario.
SCENARIO_TIMEOUT_SECONDS = 300


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--arch', choices=['arm64', 'x64'], default='arm64')
    args = parser.parse_args()
    previews = 'native/build/chromium-preview' + ('' if args.arch == 'arm64' else '-' + args.arch)
    latest = json.loads((ROOT / previews / 'latest.json').read_text())
    executable = Path(latest['app']) / 'Contents/MacOS/Wing Chromium Preview'
    class Handler(http.server.BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass
        def do_GET(self):
            if self.path == '/download':
                body = b'Wing download fixture'
                mime = 'application/octet-stream'
            elif self.path in ['/ad.svg', '/safe.svg']:
                body = b'<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="green"/></svg>'
                mime = 'image/svg+xml'
            else:
                body = (f'<!doctype html><title>Fixture {self.path}</title><h1>Wing native fixture</h1><input aria-label="Draft"><div id="cookie-banner">Cookie notice</div>'
                        f'<script>window.fixture={{}};for(const [key,host,file] of [["ad","doubleclick.net","ad.svg"],["control","wing-safe.invalid","safe.svg"]]){{const image=new Image();image.onload=()=>fixture[key]="loaded";image.onerror=()=>fixture[key]="blocked";image.src="http://"+host+":{self.server.server_port}/"+file;}}</script>').encode()
                mime = 'text/html'
            self.send_response(200)
            self.send_header('Content-Type', mime)
            if self.path == '/download':
                self.send_header('Content-Disposition', 'attachment; filename=wing-fixture.txt')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            try:
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):
                pass
    scenarios = []
    with tempfile.TemporaryDirectory(prefix='wing-chromium-ui-') as temporary, http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler) as server:
        threading.Thread(target=server.serve_forever, daemon=True).start()
        temporary = Path(temporary)
        base = f'http://wing-fixture.invalid:{server.server_port}'
        downloads = temporary / 'downloads'
        downloads.mkdir()
        profile_defaults = temporary / 'profile/Wing-default'
        profile_defaults.mkdir(parents=True)
        (profile_defaults / 'Preferences').write_text(json.dumps({'download':{'default_directory':str(downloads), 'prompt_for_download':False}}))
        import_base = temporary / 'import-source'
        source_profile = import_base / 'Google/Chrome/Default'
        source_profile.mkdir(parents=True)
        (source_profile / 'Preferences').write_text('{}')
        (source_profile / 'Bookmarks').write_text(json.dumps({'roots':{'bookmark_bar':{'name':'Imported research','children':[{'name':'Imported fixture','url':base+'/imported'}]}}}))
        with sqlite3.connect(source_profile / 'Cookies') as db:
            db.execute('CREATE TABLE meta(key TEXT,value TEXT)')
            db.execute("INSERT INTO meta VALUES('version','24')")
            db.execute('CREATE TABLE cookies(host_key TEXT,name TEXT,path TEXT,value TEXT,encrypted_value BLOB,is_secure INTEGER,is_httponly INTEGER,samesite INTEGER,has_expires INTEGER,expires_utc INTEGER,top_frame_site_key TEXT)')
            db.execute('INSERT INTO cookies VALUES(?,?,?,?,?,?,?,?,?,?,?)',('wing-fixture.invalid','imported-session','/','fixture-account',b'',0,0,1,0,0,''))
        extension = temporary / 'extension-fixture'
        extension.mkdir()
        key = subprocess.run(['openssl', 'genrsa', '2048'], capture_output=True, check=True).stdout
        public = subprocess.run(['openssl', 'rsa', '-pubout', '-outform', 'DER'], input=key, capture_output=True, check=True).stdout
        (extension / 'manifest.json').write_text(json.dumps({
            'manifest_version':3, 'name':'Wing side panel fixture', 'version':'1.0',
            'key':base64.b64encode(public).decode(), 'permissions':['sidePanel'],
            'side_panel':{'default_path':'panel.html'}}))
        (extension / 'panel.html').write_text('<!doctype html><title>Wing extension side panel fixture</title><h1>Extension panel</h1><input aria-label="Panel draft">')
        legacy = import_base / 'Wing'
        legacy_partition = legacy / 'Partitions/wing-default'
        legacy_partition.mkdir(parents=True)
        script_source = """const M=require('./src/model.cjs'); const s=M.initialState();
const space=s.spaces.find(s=>s.profileId==='default');
const a=M.newTab(space.id,process.argv[1]+'/legacy-a',{kind:'pinned',folderId:'legacy-child'});
const b=M.newTab(space.id,process.argv[1]+'/legacy-b',{kind:'pinned',folderId:'legacy-child'});
s.tabs=[a,b];s.activeTabId=a.id;s.activeSpaceId=space.id;
s.folders=[{id:'legacy-parent',spaceId:space.id,name:'Legacy research',collapsed:false},
{id:'legacy-child',spaceId:space.id,name:'Legacy reading',parentId:'legacy-parent',collapsed:true}];
s.splits=[{id:'legacy-pair',title:'Legacy pair',tabIds:[a.id,b.id],weights:[0.4,0.6],orientation:'vertical'}];
s.archive=[{...M.newTab(space.id,process.argv[1]+'/legacy-archived'),archivedAt:Date.now()}];
process.stdout.write(JSON.stringify(s));"""
        legacy_state = subprocess.check_output(['node', '-e', script_source, base], cwd=ROOT)
        (legacy / 'workspace.json').write_bytes(legacy_state)
        (legacy / 'password-vault').mkdir()
        vault_source = """const c=require('node:crypto').createCipheriv('aes-128-cbc',Buffer.alloc(16,7),Buffer.alloc(16,32));
const plain=JSON.stringify({version:1,entries:[{origin:'https://wing-fixture.invalid',username:'legacy-fixture-user',password:'legacy-fixture-password'}]});
process.stdout.write(Buffer.concat([Buffer.from('v10'),c.update(plain),c.final()]));"""
        (legacy / 'password-vault/default.vault').write_bytes(subprocess.check_output(['node','-e',vault_source]))
        with sqlite3.connect(source_profile / 'Cookies') as source_db, sqlite3.connect(legacy_partition / 'Cookies') as target_db:
            source_db.backup(target_db)
            target_db.execute("UPDATE cookies SET name='legacy-session',value='legacy-fixture-account'")
        source_hashes = {str(path.relative_to(import_base)):hashlib.sha256(path.read_bytes()).hexdigest()
                         for path in import_base.rglob('*') if path.is_file()}
        try:
            for phase in ['initial', 'restart']:
                report = temporary / f'{phase}.json'
                script = temporary / f'{phase}.js'
                script.write_text('const WING_TEST='+json.dumps({'phase':phase, 'base':base, 'downloads':str(downloads), 'sourceEngine':latest.get('engineKind') == 'wing-source'})+';\n'+(ROOT / 'native/chromium/qualification.js').read_text())
                env = {**os.environ, 'WING_CHROMIUM_TEST_PROFILE':str(temporary / 'profile'),
                       'WING_IMPORT_TEST_BASE':str(import_base), 'WING_CHROMIUM_TEST_EXTENSION':str(extension), 'WING_IMPORT_TEST_KEY':base64.b64encode(bytes([7])*16).decode(), 'WING_CHROMIUM_TEST_SCRIPT':str(script), 'WING_CHROMIUM_TEST_REPORT':str(report)}
                # Other windows covering this one would otherwise make Chromium hide its pages.
                child = subprocess.Popen([str(executable), '--disable-backgrounding-occluded-windows', '--disable-background-networking', '--enable-logging=stderr', '--host-resolver-rules=MAP * 127.0.0.1', '--no-proxy-server'], env=env,
                                         stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
                timed_out = False
                started = time.monotonic()
                try:
                    stdout, stderr = child.communicate(timeout=SCENARIO_TIMEOUT_SECONDS)
                except subprocess.TimeoutExpired:
                    timed_out = True
                    os.killpg(child.pid, signal.SIGTERM)
                    try:
                        stdout, stderr = child.communicate(timeout=5)
                    except subprocess.TimeoutExpired:
                        os.killpg(child.pid, signal.SIGKILL)
                        stdout, stderr = child.communicate()
                value = json.loads(report.read_text()) if report.exists() else {'passed':False, 'error':f'Qualification exceeded {SCENARIO_TIMEOUT_SECONDS} seconds' if timed_out else 'Host produced no report'}
                if isinstance(value, str):
                    value = json.loads(value)
                result = {**value, 'phase':phase, 'exitCode':child.returncode, 'elapsedSeconds':round(time.monotonic() - started, 2), 'stderr':stderr.decode(errors='replace')[-12000:]}
                result['passed'] = result.get('passed', False) and child.returncode == 0 and not timed_out
                workspace_file = temporary / 'profile/wing-workspace.json'
                result['privateWorkspaceFile'] = workspace_file.exists() and workspace_file.stat().st_mode & 0o077 == 0
                result['sourceProfilePreserved'] = all(hashlib.sha256((import_base / name).read_bytes()).hexdigest() == digest for name, digest in source_hashes.items())
                if latest.get('engineKind') == 'wing-source' and result.get('passed'):
                    imported_id = result.get('legacyPasswordProfileId') or (scenarios[0].get('legacyPasswordProfileId') if scenarios else None)
                    if not imported_id or not all(c.isalnum() or c == '-' for c in imported_id):
                        result['passwordStorePersisted'] = False
                    else:
                        login_file = temporary / 'profile' / ('Wing-' + imported_id) / 'Login Data'
                        try:
                            with sqlite3.connect(login_file.as_uri()+'?mode=ro', uri=True) as db:
                                row = db.execute("SELECT username_value,password_value FROM logins WHERE signon_realm=?", ('https://wing-fixture.invalid/',)).fetchone()
                            result['passwordStorePersisted'] = bool(row and row[0] == 'legacy-fixture-user' and row[1] and b'legacy-fixture-password' not in row[1])
                        except sqlite3.Error:
                            result['passwordStorePersisted'] = False
                    result['passed'] = result['passed'] and result['passwordStorePersisted']
                result['passed'] = result['passed'] and result['privateWorkspaceFile'] and result['sourceProfilePreserved']
                scenarios.append(result)
                print(json.dumps(result, indent=2), flush=True)
                if not result['passed']:
                    break
        finally:
            server.shutdown()
    output = {'engine':json.loads((Path(latest['app']) / 'Contents/Resources/engine-provenance.json').read_text()),
              'hostInputs':json.loads((Path(latest['app']) / 'Contents/Resources/host-inputs.json').read_text()),
              'hostSHA256':hashlib.sha256(executable.read_bytes()).hexdigest(),
              'passed':len(scenarios)==2 and all(s['passed'] for s in scenarios), 'scenarios':scenarios,
              'scope':'Wing interface on the native Chromium host, isolated loopback profiles; not feature-complete or release qualification.'}
    (ROOT / qualification_report(args.arch)).write_text(json.dumps(output, indent=2)+'\n')
    return 0 if output['passed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
