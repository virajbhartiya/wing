const test=require('node:test'),assert=require('node:assert/strict');
const mod=()=>import('../native/extension/recovery.mjs');
const home='chrome-extension://wing/home.html';
const state=()=>({version:1,spaces:[{id:'personal',name:'Personal',color:'lavender'},{id:'work',name:'Work',color:'sage'}],activeSpace:'personal',assignments:{1:'personal',2:'work',3:'work'},archive:[],budget:8,dark:false});
test('recovery preserves duplicate URLs in different Spaces, windows, pins and splits',async()=>{
 const {captureSession}=await mod();
 const tabs=[{id:1,windowId:10,index:0,url:'https://example.com/',title:'one',pinned:true,active:true},{id:2,windowId:20,index:0,url:'https://example.com/',title:'two',splitViewId:7},{id:3,windowId:20,index:1,url:'https://example.net/',splitViewId:7,active:true},{id:4,windowId:30,index:0,url:'https://private.invalid/',incognito:true}];
 const saved=captureSession(state(),tabs,home,123);
 assert.equal(saved.windows.length,2);assert.equal(saved.windows[0].tabs[0].pinned,true);
 assert.equal(saved.windows[0].tabs[0].spaceId,'personal');assert.equal(saved.windows[1].tabs[0].spaceId,'work');
 assert.equal(saved.windows[1].tabs[0].splitKey,saved.windows[1].tabs[1].splitKey);
 assert(!JSON.stringify(saved).includes('private.invalid'));
});
test('last-window closing cannot replace a useful recovery snapshot with an empty session',async()=>{
 const {captureSession,checkpoint}=await mod();const s=state();
 const saved=captureSession(s,[{id:1,windowId:1,index:0,url:'https://example.com/'}],home,1);
 checkpoint(s,saved);checkpoint(s,captureSession(s,[],home,2));assert.equal(s.lastSession.id,saved.id);
 checkpoint(s,saved);assert.equal(s.recoveryHistory.length,0);
});
test('backup import excludes runtime ids and rejects privileged URLs and duplicate identities',async()=>{
 const {exportWorkspace,importWorkspace,captureSession}=await mod();const s=state();s.lastSession=captureSession(s,[{id:1,windowId:1,index:0,url:'https://example.com/'}],home,1);
 const backup=exportWorkspace(s);const restored=importWorkspace(backup,home);
 assert.deepEqual(restored.assignments,{});assert.equal(restored.lastSession.windows[0].tabs[0].url,'https://example.com/');
 const bad=structuredClone(backup);bad.workspace.lastSession.windows[0].tabs[0].url='javascript:alert(1)';assert.throws(()=>importWorkspace(bad,home));
 const duplicate=structuredClone(backup);duplicate.workspace.spaces.push({...duplicate.workspace.spaces[0]});assert.throws(()=>importWorkspace(duplicate,home));
});
test('sleeping tabs capture their real target and reject forged privileged targets',async()=>{
 const {captureSession,sleepURL,wakeURL}=await mod();
 const sleeping=sleepURL('https://example.com/',home);
 assert.equal(wakeURL(sleeping,home),'https://example.com/');
 assert.throws(()=>wakeURL(sleepURL('javascript:alert(1)',home),home));
 const s=captureSession(state(),[{id:1,windowId:1,index:0,url:sleeping}],home,1);
 assert.equal(s.windows[0].tabs[0].url,'https://example.com/');
});
