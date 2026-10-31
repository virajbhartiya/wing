import {wakeURL} from './recovery.mjs';
let target;
try{target=wakeURL(location.href,chrome.runtime.getURL('home.html'));document.querySelector('#target').textContent=target;document.title=new URL(target).hostname+' — Sleeping';}catch(error){document.querySelector('#status').textContent=error.message;}
function wake(){if(target)location.replace(target)}
document.querySelector('#wake').onclick=wake;
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')wake()});
if(document.visibilityState==='visible')wake();
