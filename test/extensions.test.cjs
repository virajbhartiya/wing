const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {ExtensionManager} = require('../src/extensions.cjs');
const key = Buffer.from('test-public-key').toString('base64');
const id = require('node:crypto').createHash('sha256').update(Buffer.from(key,'base64')).digest('hex').slice(0,32).replace(/[0-9a-f]/g,n=>String.fromCharCode(97+parseInt(n,16)));
async function fixture(t) {
 const directory = await fs.mkdtemp(path.join(os.tmpdir(),'wing-extensions-unit-'));
 t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const extensionPath=path.join(directory,'extension');await fs.mkdir(extensionPath);
 await fs.writeFile(path.join(extensionPath,'manifest.json'),JSON.stringify({name:'Probe',manifest_version:3}));
 const sessions=new Map(), adapters=[];
 class Adapter {constructor(options){this.options=options;adapters.push(this)}addTab(){}selectTab(){}removeTab(){}}
 const getSession=profile=>{
  if(!sessions.has(profile)){
   const loaded=new Map();sessions.set(profile,{registerPreloadScript(){},extensions:{
    loadExtension:async target=>{const ext={id,name:'Probe',version:'1',manifest:{manifest_version:3},path:target};loaded.set(id,ext);return ext},
    removeExtension:id=>loaded.delete(id),getAllExtensions:()=>[...loaded.values()],
   }});
  }return sessions.get(profile);
 };
 const registryPath=path.join(directory,'registry.json');
 const options={registryPath,getSession,Adapter};
 return {manager:new ExtensionManager(options),options,extensionPath,getSession,adapters,registryPath};
}
test('extension installation is profile-scoped and restored on the next startup',async t=>{
 const f=await fixture(t);await f.manager.install('personal',f.extensionPath);
 assert.equal(f.manager.list('personal').extensions.length,1);assert.equal(f.manager.list('work').extensions.length,0);
 const registry=JSON.parse(await fs.readFile(f.registryPath,'utf8'));assert.equal(registry.profiles.personal[0].id,id);
 f.getSession('personal').extensions.removeExtension(id);
 const next=new ExtensionManager(f.options);await next.restore('personal');assert.equal(next.list('personal').extensions.length,1);
 await next.uninstall('personal',id);assert.equal(next.list('personal').extensions.length,0);
 assert.deepEqual(JSON.parse(await fs.readFile(f.registryPath,'utf8')).profiles.personal,[]);
});
test('failed registry write unloads a newly installed extension',async t=>{
 const f=await fixture(t);f.manager.writeRegistry=async()=>{throw Error('disk full')};
 await assert.rejects(f.manager.install('personal',f.extensionPath),/disk full/);
 assert.equal(f.manager.list('personal').extensions.length,0);
});
test('corrupt registry is preserved rather than silently overwritten',async t=>{
 const f=await fixture(t);await fs.writeFile(f.registryPath,'corrupt');
 await assert.rejects(f.manager.install('personal',f.extensionPath));
 assert.equal(await fs.readFile(f.registryPath,'utf8'),'corrupt');
 assert.equal(f.manager.list('personal').extensions.length,0);
});
test('adapter creation is once per profile and hooks retain profile identity',async t=>{
 const f=await fixture(t);let received;
 f.manager.options.createTab=(profile,details)=>{received={profile,details}};
 const first=f.manager.configure('personal');assert.equal(f.manager.configure('personal'),first);
 f.manager.configure('work');assert.equal(f.adapters.length,2);
 first.options.createTab({url:'https://example.com'});assert.equal(received.profile,'personal');
 assert.equal(first.options.license,'GPL-3.0');
});

test('duplicate extension identity is rejected before load can replace its installed files',async t=>{
 const f=await fixture(t);
 await fs.writeFile(path.join(f.extensionPath,'manifest.json'),JSON.stringify({name:'Probe',manifest_version:3,key}));
 await f.manager.install('personal',f.extensionPath);
 const second=f.extensionPath+'-copy';await fs.mkdir(second);
 await fs.writeFile(path.join(second,'manifest.json'),JSON.stringify({name:'Imposter',manifest_version:3,key}));
 await assert.rejects(f.manager.install('personal',second),/already installed/);
 assert.equal(f.getSession('personal').extensions.getAllExtensions()[0].path,await fs.realpath(f.extensionPath));
});
