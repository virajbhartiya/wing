/* Reproducible full uBlock Origin qualification. Uses disposable profiles only. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {spawnSync} = require('node:child_process');
const {extractExtensionZip} = require('../src/zip-extract.cjs');
const source = 'https://github.com/gorhill/uBlock/releases/download/1.75.0/uBlock0_1.75.0.chromium.zip';
const sha256 = '393cf95709d1074d4022970e9014e434395c53a822387f1e25f43be97cf4b582';

(async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'wing-full-ubo-'));
  try {
    const response = await fetch(source,{signal:AbortSignal.timeout(60000)});
    if (!response.ok) throw Error(`Download failed: ${response.status}`);
    const archive = Buffer.from(await response.arrayBuffer());
    if (createHash('sha256').update(archive).digest('hex') !== sha256) throw Error('uBlock Origin checksum mismatch');
    const zip = path.join(temporary, 'ubo.zip');
    fs.writeFileSync(zip, archive);
    const destination = path.join(temporary, 'extension');
    await extractExtensionZip(zip, destination);
    const extension = path.join(destination, 'uBlock0.chromium');
    const manifest = JSON.parse(fs.readFileSync(path.join(extension, 'manifest.json'), 'utf8'));
    const report = {at:new Date().toISOString(), source, sha256, version:manifest.version,
      manifestVersion:manifest.manifest_version,
      scope:'Official, unmodified full uBlock Origin through Wing ExtensionManager on Electron; isolated test profiles',
      method:'Process-local DNS maps all hostnames to 127.0.0.1 and disables proxy use. An authored local fixture loads a known advertising host and a control host. No user profile, system DNS, or extension source changes.',
      scenarios:[]};
    for (const enabled of [false, true]) {
      const output = path.join(temporary, `${enabled}.json`);
      const result = spawnSync(require('electron'), [path.join(__dirname, 'full-ubo-engine-fixture.cjs')], {
        cwd:path.resolve(__dirname, '..'), encoding:'utf8', timeout:45000,
        env:{...process.env, WING_UBO_PROFILE:path.join(temporary, `profile-${enabled}`), WING_UBO_EXTENSION:extension,
          WING_UBO_ENABLED:String(enabled), WING_UBO_REPORT:output},
      });
      const scenario = fs.existsSync(output) ? JSON.parse(fs.readFileSync(output, 'utf8')) : {enabled,error:result.error?.message || 'Fixture exited without a report'};
      scenario.exitCode = result.status;
      scenario.stderr = result.stderr?.slice(-12000) || '';
      report.scenarios.push(scenario);
    }
    const [control, loaded] = report.scenarios;
    report.passed = control.results?.ad === 'loaded' && control.results?.control === 'loaded' &&
      loaded.results?.ad === 'blocked' && loaded.results?.control === 'loaded' && !loaded.loadError;
    report.result = report.passed ? 'network-fixture-passed-cookie-filtering-unqualified' : 'unsupported';
    report.cookieBannerFiltering = 'Not qualified; network blocking is a prerequisite';
    fs.writeFileSync(path.resolve(__dirname, '../docs/full-ubo-electron-qualification.json'), JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify(report,null,2));
    process.exitCode = report.passed ? 0 : 1;
  } finally {
    fs.rmSync(temporary,{recursive:true,force:true});
  }
})().catch(error => { console.error(error); process.exitCode=1; });
