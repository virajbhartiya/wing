const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {execFileSync} = require('node:child_process');
const os = require('node:os');
const path = require('node:path');
// Exercise the host's actual startup policy without loading the Chromium framework.
test('native engine lab exposes the incomplete Views shell only by explicit opt-in', () => {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wing-shell-policy-'));
 try {
  const header=path.resolve('native/host/shell_policy.h');
  assert(fs.existsSync(header), 'Native engine lab must declare its experimental shell policy');
  fs.writeFileSync(path.join(dir,'test.cc'), `#include "${header}"\n#include <cassert>\nint main(){assert(!wing::UseCustomShell(false,false));assert(wing::UseCustomShell(true,false));assert(!wing::UseCustomShell(true,true));assert(!wing::UseCustomShell(false,true));}\n`);
  execFileSync('clang++',['-std=c++17',path.join(dir,'test.cc'),'-o',path.join(dir,'test')]);
  execFileSync(path.join(dir,'test'));
 } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
