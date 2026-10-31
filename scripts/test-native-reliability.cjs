const http=require('node:http'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..'),temporary=fs.mkdtempSync(path.join(os.tmpdir(),'wing-reliability-'));
const extension=path.join(temporary,'fixture');fs.cpSync(path.join(root,'native/extension'),extension,{recursive:true});
fs.cpSync(path.join(root,'test/extensions/reliability-probe'),extension,{recursive:true});
const reports=[];let pending,child,timeout;
const server=http.createServer((req,res)=>{
 if(req.url==='/report'){
  let body='';req.on('data',c=>body+=c);req.on('end',()=>{
   const report=JSON.parse(body);reports.push(report);console.log(JSON.stringify(report));
   res.end(pending.crash?'crash':'close');pending.report=report;
   if(pending.crash)child.kill('SIGKILL');
  });return;
 }
 res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Wing reliability fixture</title><h1>Isolated native browser verification</h1><p>Only loopback fixtures and disposable profiles are used.</p>');
});
function run(profile,stage,crash=false){return new Promise((resolve,reject)=>{
 pending={resolve,reject,crash};
 child=spawn(path.join(root,'native/wing-build/host/Release/Wing.app/Contents/MacOS/Wing'),[`--cache-path=${path.join(temporary,profile)}`,`--load-extension=${extension}`,`--url=http://127.0.0.1:${server.address().port}/probe?stage=${stage}&profile=${profile}`],{stdio:['ignore','ignore','pipe']});
 child.stderr.on('data',c=>fs.appendFileSync(path.join(temporary,'engine.log'),c));
 child.on('error',reject);
 child.on('exit',(code,signal)=>{clearTimeout(timeout);const report=pending.report;if(!report||report.error||(!crash&&code!==0))reject(Error(report?.error||`Engine exited ${code}/${signal} without a passing report`));else resolve(report)});
 timeout=setTimeout(()=>{child.kill('SIGKILL');reject(Error('Native test timed out'))},90000);
});}
function check(value,message){if(!value)throw Error(message)}
server.listen(0,'127.0.0.1',async()=>{
 try{
  const seed=await run('A','seed');check(seed.priorMarker===null&&seed.previousCookie==='','Fresh A profile was not empty');
  const restore=await run('A','restore');check(restore.priorMarker==='A'&&restore.previousCookie.includes('wing_profile=A'),'A did not persist cookies and extension storage');
  check(restore.restoredTabs===3&&restore.restoredWindows===2&&restore.pinned===1&&restore.split===2&&restore.duplicateSpaces.join(',')==='personal,work'&&restore.sourcePreserved,'Recovery fidelity failed');
  const other=await run('B','seed');check(other.priorMarker===null&&other.previousCookie==='','Profile B leaked profile A data');
  await run('A','read',true);
  const afterCrash=await run('A','read');check(afterCrash.priorMarker==='A'&&afterCrash.previousCookie.includes('wing_profile=A'),'Previously committed profile data lost after forced termination');
  const result={at:new Date().toISOString(),passed:5,checks:['clean profile','graceful restart persistence','two-window recovery with duplicate URLs, Spaces, pins and split','cookie and extension storage isolation','committed data after forced termination'],reports};
  fs.writeFileSync(path.join(root,'docs/native-reliability.json'),JSON.stringify(result,null,2));console.log('Native reliability: 5 checks passed');
  fs.rmSync(temporary,{recursive:true,force:true});
 }catch(error){console.error(error);console.error('Diagnostic profile retained at '+temporary);process.exitCode=1;}
 finally{clearTimeout(timeout);server.close();}
});
