import {initialWorkspace} from './workspace.js';
import {captureSession,restoreSession,exportWorkspace,importWorkspace,wakeURL} from './recovery.mjs';
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
 if(message.type==='close'){
  chrome.windows.getAll().then(async windows=>{for(const window of windows)await chrome.windows.remove(window.id)});return;
 }
 if(message.type!=='run')return;
 (async()=>{
  const stored=await chrome.storage.local.get(['marker','saved']);
  const result={priorMarker:stored.marker||null};
  if(message.stage==='seed'){
   await chrome.storage.local.set({marker:message.profile});
   if(message.profile==='A'){
    const base=new URL(sender.url).origin;
    const a=await chrome.tabs.create({url:base+'/same',active:false});
    const b=await chrome.tabs.create({url:base+'/same',active:false});
    await chrome.tabs.createSplit([a.id,b.id]);
    const other=await chrome.windows.create({url:base+'/other',focused:false});
    await chrome.tabs.update(other.tabs[0].id,{pinned:true});
    const state=initialWorkspace();state.assignments[a.id]='personal';state.assignments[b.id]='work';state.assignments[other.tabs[0].id]='work';
    const ids=[a.id,b.id,other.tabs[0].id];
    const source=(await chrome.tabs.query({})).filter(t=>ids.includes(t.id));
    const home=chrome.runtime.getURL('home.html');
    const snapshot=captureSession(state,source,home);state.lastSession=snapshot;
    await chrome.storage.local.set({saved:exportWorkspace(state)});
    result.savedWindows=snapshot.windows.length;result.savedTabs=source.length;
   }
  }
  if(message.stage==='restore'){
   const home=chrome.runtime.getURL('home.html');
   const state=importWorkspace(stored.saved,home);
   const ids=await restoreSession(chrome,state,state.lastSession,home,s=>chrome.storage.local.set({partial:exportWorkspace(s)}));
   const tabs=await Promise.all(ids.map(id=>chrome.tabs.get(id)));
   result.restoredTabs=tabs.length;result.restoredWindows=new Set(tabs.map(t=>t.windowId)).size;
   result.pinned=tabs.filter(t=>t.pinned).length;
   result.split=tabs.filter(t=>t.splitViewId>=0).length;
   const same=tabs.filter(t=>wakeURL(t.url,home).endsWith('/same'));
   result.duplicateSpaces=same.map(t=>state.assignments[t.id]).sort();
   result.sourcePreserved=(await chrome.storage.local.get('saved')).saved.workspace.lastSession.id===state.lastSession.id;
  }
  reply(result);
 })().catch(error=>reply({error:error.stack}));return true;
});
