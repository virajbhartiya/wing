const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
test('protection startup waits for dashboard API and populated engines',async()=>{
  const source=fs.readFileSync(require('node:path').join(__dirname,'../native/chromium/protection-ready.js'),'utf8');
  let ticks=0,calls=0;
  let finish;
  const result=new Promise(resolve=>finish=resolve);
  const context={Date,Promise,JSON,Error,post:(_kind,value)=>finish(JSON.parse(value))};
  context.setTimeout=callback=>{
    ticks++;
    if(ticks===1)context.vAPI={messaging:{send:async()=> ++calls===1?{netFilterCount:0,cosmeticFilterCount:0}:{netFilterCount:100,cosmeticFilterCount:20}}};
    return setTimeout(callback,0);
  };
  vm.runInNewContext(source,context);
  assert.equal((await result).ready,true);
  assert.ok(ticks>=2);
  assert.equal(calls,2);
});
