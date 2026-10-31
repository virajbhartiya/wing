if(location.pathname==='/probe'){
 const parameters=new URLSearchParams(location.search),stage=parameters.get('stage'),profile=parameters.get('profile');
 const previousCookie=document.cookie;
 if(stage==='seed')document.cookie='wing_profile='+profile+'; Max-Age=86400; SameSite=Lax; Path=/';
 chrome.runtime.sendMessage({type:'run',stage,profile,previousCookie},async report=>{
  const reply=await fetch('/report',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...report,stage,profile,previousCookie})});
  if(await reply.text()==='close')chrome.runtime.sendMessage({type:'close'});
 });
}
