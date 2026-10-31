if(location.pathname==='/'){
 let done=false;
 const send=async(result)=>{
  if(done)return;done=true;let staticDNR=false,dynamicDNR=false;
  try{await fetch('/must-be-blocked')}catch{staticDNR=true}
  try{await fetch('/must-dynamically-block')}catch{dynamicDNR=true}
  fetch('/report',{method:'POST',body:JSON.stringify({...result,contentScript:true,staticDNR,dynamicDNRBlocked:dynamicDNR})});
 };
 chrome.runtime.sendMessage({type:'probe'},result=>send(result||{worker:false,error:chrome.runtime.lastError?.message}));
 setTimeout(()=>send({worker:false,error:'worker timeout'}),15000);
}
