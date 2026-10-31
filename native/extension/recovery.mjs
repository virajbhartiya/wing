// Recovery contains browsing metadata only. It never includes incognito tabs,
// cookies, passwords, form contents, extension secrets or renderer state.
import {initialWorkspace, restoreURL} from './workspace.js';
const LIMIT=500;
export function sleepURL(target,home){return new URL('sleep.html',home).href+'#'+encodeURIComponent(target);}
export function wakeURL(value,home){
 const prefix=new URL('sleep.html',home).href+'#';
 const target=value.startsWith(prefix)?decodeURIComponent(value.slice(prefix.length)):value;
 return restoreURL(target,home);
}
function allowed(value,home){
 if(typeof value!=='string'||value.length>20000)throw Error('Invalid saved address');
 const normalized=wakeURL(value,home);
 if(!/^(https?:\/\/|chrome:\/\/)/.test(normalized))throw Error('Invalid saved address');
 // Searches are not valid stored addresses: do not reinterpret corrupted input.
 if(normalized!==value && value!==home && !value.startsWith(new URL('sleep.html',home).href+'#'))throw Error('Invalid saved address');
 return normalized;
}
export function captureSession(state,tabs,home,now=Date.now()){
 const windows=new Map();let count=0;
 for(const tab of [...tabs].sort((a,b)=>(a.windowId-b.windowId)||(a.index-b.index))){
  if(tab.incognito||!tab.url)continue;
  let url;try{url=allowed(tab.url,home)}catch{continue}
  if(++count>LIMIT)throw Error('Recovery supports up to 500 tabs; export or close tabs before continuing');
  if(!windows.has(tab.windowId))windows.set(tab.windowId,{key:String(tab.windowId),tabs:[]});
  windows.get(tab.windowId).tabs.push({key:String(tab.id),url,title:String(tab.title||url).slice(0,300),spaceId:state.assignments[tab.id]||state.activeSpace,pinned:!!tab.pinned,active:!!tab.active,groupKey:tab.groupId>=0?String(tab.groupId):null,splitKey:tab.splitViewId>=0?String(tab.splitViewId):null});
 }
 return {id:crypto.randomUUID(),at:now,windows:[...windows.values()]};
}
export function checkpoint(state,snapshot){
 state.recoveryHistory||=[];
 if(!snapshot.windows.length)return;
 if(state.lastSession && JSON.stringify(state.lastSession.windows)===JSON.stringify(snapshot.windows))return;
 if(state.lastSession)state.recoveryHistory.unshift(state.lastSession);
 state.recoveryHistory=state.recoveryHistory.slice(0,10);
 state.lastSession=snapshot;
}
export function exportWorkspace(state){
 const {spaces,activeSpace,archive,budget,dark,lastSession,recoveryHistory=[]}=state;
 return {format:'wing-workspace',version:1,exportedAt:Date.now(),workspace:structuredClone({version:1,spaces,activeSpace,archive,budget,dark,lastSession,recoveryHistory})};
}
export function importWorkspace(input,home){
 const fail=()=>{throw Error('Invalid Wing workspace backup')};
 if(input?.format!=='wing-workspace'||input.version!==1||!input.workspace)fail();
 const v=input.workspace;
 const text=(x,n)=>typeof x==='string'&&x.length>0&&x.length<=n;
 const identity=x=>text(x,100)&&/^[\w-]+$/.test(x);
 if(!Array.isArray(v.spaces)||!v.spaces.length||v.spaces.length>100)fail();
 const ids=new Set();
 const spaces=v.spaces.map(s=>{if(!s||!identity(s.id)||ids.has(s.id)||!text(s.name,50)||!['lavender','sage','peach','ocean'].includes(s.color))fail();ids.add(s.id);return {id:s.id,name:s.name,color:s.color}});
 if(!ids.has(v.activeSpace))fail();
 const session=s=>{
  if(!s)return undefined;
  if(!identity(s.id)||!Number.isFinite(s.at)||!Array.isArray(s.windows)||s.windows.length>100)fail();
  let count=0;const keys=new Set();
  return {id:s.id,at:s.at,windows:s.windows.map(w=>{
   if(!w||!text(w.key,100)||!Array.isArray(w.tabs))fail();
   return {key:w.key,tabs:w.tabs.map(t=>{
    if(!t||!text(t.key,100)||keys.has(t.key)||!ids.has(t.spaceId)||++count>LIMIT)fail();keys.add(t.key);
    return {key:t.key,url:allowed(t.url,home),title:String(t.title||'').slice(0,300),spaceId:t.spaceId,pinned:!!t.pinned,active:!!t.active,groupKey:t.groupKey==null?null:String(t.groupKey).slice(0,100),splitKey:t.splitKey==null?null:String(t.splitKey).slice(0,100)};
   })};
  })};
 };
 if(!Array.isArray(v.archive)||v.archive.length>500||!Array.isArray(v.recoveryHistory||[])||(v.recoveryHistory||[]).length>10)fail();
 const archive=v.archive.map(t=>{if(!t||!identity(t.id)||!Number.isFinite(t.at))fail();return {id:t.id,url:allowed(t.url,home),title:String(t.title||'').slice(0,300),spaceId:ids.has(t.spaceId)?t.spaceId:v.activeSpace,at:t.at}});
 return {...initialWorkspace(),spaces,activeSpace:v.activeSpace,archive,budget:[4,8,16].includes(v.budget)?v.budget:8,dark:!!v.dark,lastSession:session(v.lastSession),recoveryHistory:(v.recoveryHistory||[]).map(session)};
}
// Replay uses fresh identifiers. Equal URLs never collapse into one tab.
// Tabs open as local sleeping placeholders, so recovery doesn't load 500 websites.
export async function restoreSession(api,state,snapshot,home,save){
 const validated=importWorkspace({...exportWorkspace(state),workspace:{...exportWorkspace(state).workspace,lastSession:snapshot}},home).lastSession;
 if(!validated)throw Error('No recovery snapshot selected');
 if(state.restoredSessionIds?.includes(validated.id))throw Error('This snapshot is already restored in this browser session');
 const created=[];
 try{
  for(const savedWindow of validated.windows){
   if(!savedWindow.tabs.length)continue;
   const first=savedWindow.tabs[0];
   const win=await api.windows.create({url:sleepURL(first.url,home),focused:false});
   const rows=[];
   for(let i=0;i<savedWindow.tabs.length;i++){
    const row=savedWindow.tabs[i];
    const tab=i===0?win.tabs[0]:await api.tabs.create({windowId:win.id,url:sleepURL(row.url,home),active:false,pinned:row.pinned});
    if(i===0&&row.pinned)await api.tabs.update(tab.id,{pinned:true});
    state.assignments[tab.id]=row.spaceId;rows.push({row,id:tab.id});created.push(tab.id);
    // Persist each assigned identity before proceeding, including partial failures.
    await save(state);
   }
   for(const key of new Set(rows.map(x=>x.row.groupKey).filter(x=>x!==null))){
    const tabIds=rows.filter(x=>x.row.groupKey===key&&!x.row.pinned).map(x=>x.id);
    if(tabIds.length)await api.tabs.group({tabIds});
   }
   for(const key of new Set(rows.map(x=>x.row.splitKey).filter(x=>x!==null))){
    const pair=rows.filter(x=>x.row.splitKey===key);
    if(pair.length===2)await api.tabs.createSplit(pair.map(x=>x.id));
   }
   const active=rows.find(x=>x.row.active)||rows[0];await api.tabs.update(active.id,{active:true});
  }
  state.restoredSessionIds=[...(state.restoredSessionIds||[]),validated.id].slice(-20);await save(state);
  return created;
 }catch(error){await save(state);throw Error(`Recovery stopped after ${created.length} tabs: ${error.message}. The source snapshot is preserved.`)}
}
