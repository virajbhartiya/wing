chrome.runtime.onMessage.addListener((message,sender,reply)=>{
 if(message.type!=='probe')return;
 (async()=>{
 const proof={commandsNamespace:typeof chrome.commands?.onCommand?.addListener==='function'&&typeof browser.commands?.onCommand?.addListener==='function',worker:true,messaging:!!sender.tab,errors:{}};
 for(const [name,fn] of Object.entries({
  staticRules:async()=>{const before=await chrome.declarativeNetRequest.getEnabledRulesets();await chrome.declarativeNetRequest.updateEnabledRulesets({enableRulesetIds:['probe']});return {before,after:await chrome.declarativeNetRequest.getEnabledRulesets()}},
  storage:async()=>{await chrome.storage.local.set({probe:'yes'});return (await chrome.storage.local.get('probe')).probe==='yes'},
  tabs:async()=>{const tabs=await chrome.tabs.query({});return tabs.some(t=>t.id===sender.tab.id)},
  createRemoveTab:async()=>{const tab=await chrome.tabs.create({url:new URL('/peer',sender.url).href,active:false});await chrome.tabs.remove(tab.id);return !!tab.id},
  browserCreateRemoveTab:async()=>{const tab=await browser.tabs.create({url:new URL('/peer',sender.url).href,active:false});await browser.tabs.remove(tab.id);return !!tab.id},
  dynamicDNR:async()=>{await chrome.declarativeNetRequest.updateDynamicRules({removeRuleIds:[10],addRules:[{id:10,priority:1,action:{type:'block'},condition:{urlFilter:'must-dynamically-block',resourceTypes:['xmlhttprequest']}}]});return true}
 })) {try{proof[name]=await fn()}catch(e){proof[name]=false;proof.errors[name]=e.message}}
 reply(proof);
 })();return true;
});
