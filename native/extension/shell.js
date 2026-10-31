import './panel.js';
const $=s=>document.querySelector(s);
let active;
async function updateLocation(){
 const tabs=await chrome.tabs.query({active:true,lastFocusedWindow:true});
 active=tabs.find(t=>!t.url?.endsWith('/shell.html'));
 const url=active?.url || '';
 let label='New tab';
 try {const u=new URL(url);label=u.protocol==='chrome-extension:'?'New tab':u.protocol==='https:'||u.protocol==='http:'?u.hostname:u.host||u.protocol;}catch{}
 $('#location-label').textContent=label;
 $('#location').title=(url||'New tab')+' · ⌘L';
}
function focusSearch(mode='new'){
 document.body.classList.add('searching');
 $('#query').value=mode==='location'&&active?.url&&!active.url.startsWith('chrome-extension:')?active.url:'';
 $('#query').focus();$('#query').select();
}
// Called by the native menu only in this trusted extension frame.
window.wingFocusSearch=focusSearch;
$('#location').onclick=()=>focusSearch('location');
$('#new-tab').onclick=()=>focusSearch();
$('#back').onclick=()=>active&&chrome.tabs.goBack(active.id).catch(()=>{});
$('#forward').onclick=()=>active&&chrome.tabs.goForward(active.id).catch(()=>{});
$('#reload').onclick=()=>active&&chrome.tabs.reload(active.id);
$('#search').addEventListener('submit',()=>document.body.classList.remove('searching'));
document.addEventListener('keydown',e=>{if(e.key==='Escape'){document.body.classList.remove('searching');$('#query').value='';$('#query').dispatchEvent(new Event('input'));$('#location').focus();}});
const refresh=()=>updateLocation().catch(()=>{});
chrome.tabs.onActivated.addListener(refresh);chrome.tabs.onUpdated.addListener(refresh);chrome.windows.onFocusChanged.addListener(refresh);refresh();
window.addEventListener('wing-command',event=>focusSearch(event.detail==='address'?'location':'new'));
