const test=require('node:test'),assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const preload=fs.readFileSync(path.join(__dirname,'../src/extension-namespace-preload.cjs'),'utf8');
function run({type='service-worker',protocol='chrome-extension:',browser={},chrome={}}={}) {
 let executions=0;
 const context={process:{type},location:{protocol},browser,chrome,require:()=>({contextBridge:{executeInMainWorld:({func})=>{executions++;func()}}})};
 vm.runInNewContext(preload,context);return {browser,chrome,executions};
}
test('browser namespace gains real adapter methods and retains native-only APIs',()=>{
 const query=()=>Promise.resolve(['tab']),nativeOnly=()=>42,commands={onCommand:{addListener(){}}},dnr={native:true};
 const tabs={};Object.defineProperty(tabs,'nativeOnly',{value:nativeOnly,enumerable:false});
 const result=run({browser:{tabs,declarativeNetRequest:dnr},chrome:{tabs:{query},commands}});
 assert.equal(result.browser.tabs.query,query);assert.equal(result.browser.tabs.nativeOnly,nativeOnly);
 assert.equal(result.browser.commands.onCommand,commands.onCommand);
 assert.equal(result.browser.declarativeNetRequest,dnr);
});
test('normal web pages do not receive extension namespace adaptation',()=>{
 const browser={};const result=run({type:'renderer',protocol:'https:',browser,chrome:{commands:{}}});
 assert.equal(result.executions,0);assert.equal(browser.commands,undefined);
});
test('older engines without browser namespace retain their chrome namespace',()=>{
 const chrome={commands:{}};const result=run({browser:null,chrome});assert.equal(result.chrome,chrome);
});
