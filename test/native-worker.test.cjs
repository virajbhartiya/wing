const test=require('node:test'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');const path=require('node:path');
async function harness(failWrites=false, configure=()=>{}){
 const {initialWorkspace}=await import('../native/extension/workspace.js');const state=initialWorkspace();
 const tabs=[{id:1,windowId:1,index:0,url:'https://example.com/',title:'Example',active:true}];state.assignments[1]='personal';configure(state);
 let stored={workspace:state},listener;const calls=[];const event={addListener(){}};
 global.chrome={runtime:{id:'test',getURL:p=>'chrome-extension://test/'+p,onMessage:{addListener:fn=>listener=fn},onInstalled:event,onStartup:event},
 storage:{local:{get:async()=>structuredClone(stored),set:async value=>{calls.push('persist');if(failWrites)throw Error('QUOTA_BYTES quota exceeded');stored={...stored,...structuredClone(value)}}},session:{get:async()=>({runStarted:1}),set:async()=>{}}},
 tabs:{query:async()=>structuredClone(tabs),remove:async id=>{calls.push('close');tabs.splice(tabs.findIndex(t=>t.id===id),1)},onRemoved:event,onCreated:event,onUpdated:event},alarms:{onAlarm:event},sidePanel:{}};
 await import(pathToFileURL(path.resolve('native/extension/worker.js')).href+'?test='+crypto.randomUUID());
 return {calls,get stored(){return stored},send:(action,data={})=>new Promise(resolve=>listener({action,data},{id:'test',url:'chrome-extension://test/panel.html'},resolve))};
}
test('an archive storage failure never closes the source tab',async()=>{
 const h=await harness(true);const result=await h.send('archive',{id:1});assert.match(result.error,/quota/i);assert(!h.calls.includes('close'));
});
test('successful archive is durable before the renderer closes',async()=>{
 const h=await harness();await h.send('archive',{id:1});assert(h.calls.indexOf('persist')<h.calls.indexOf('close'));assert.equal(h.stored.workspace.archive[0].url,'https://example.com/');
});

test('deleting a Space keeps all saved recovery snapshots valid',async()=>{
 const saved={id:'saved',at:1,windows:[{key:'1',tabs:[{key:'1',url:'https://example.com/',spaceId:'work',title:'Example'}]}]};
 const h=await harness(false,s=>{s.lastSession=structuredClone(saved);s.startupRecovery=structuredClone(saved);s.recoveryHistory=[structuredClone(saved)];s.archive=[{id:'archive',at:1,url:'https://example.com/',spaceId:'work'}]});
 const result=await h.send('delete-space',{id:'work'});assert(!result.error);
 const state=h.stored.workspace;
 for(const snapshot of [state.lastSession,state.startupRecovery,...state.recoveryHistory])
  for(const window of snapshot.windows)for(const tab of window.tabs)assert.equal(tab.spaceId,'personal');
 assert.equal(state.archive[0].spaceId,'personal');
 const {importWorkspace}=await import('../native/extension/recovery.mjs');
 assert.doesNotThrow(()=>importWorkspace({format:'wing-workspace',version:1,workspace:state},'chrome-extension://test/home.html'));
});
test('routine state messages omit recovery history while explicit recovery remains available',async()=>{
 const h=await harness(false,s=>{s.lastSession={id:'saved',at:1,windows:[]};s.recoveryHistory=[s.lastSession];s.lastTabs=[{id:1}]});
 const state=await h.send('state');
 for(const field of ['lastSession','recoveryHistory','lastTabs','startupRecovery','restoredSessionIds'])assert(!(field in state));
 assert.equal((await h.send('recovery')).snapshots[0].id,'saved');
});
