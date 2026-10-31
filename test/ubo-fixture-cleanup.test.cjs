const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
test('uBlock fixture removal tolerates extension destroyed-event reentry', () => {
  const source = fs.readFileSync(require.resolve('../scripts/full-ubo-engine-fixture.cjs'), 'utf8');
  const callback = source.match(/removeTab:\s*([\s\S]*?),\s*selectTab\(/)?.[1];
  assert.ok(callback, 'fixture removal hook exists');
  const removeTab = vm.runInNewContext(`(${callback})`);
  let closes = 0;
  assert.doesNotThrow(() => removeTab('qualification', {
    isDestroyed: () => true,
    close() { throw new TypeError('Object has been destroyed'); },
  }));
  removeTab('qualification', {isDestroyed: () => false, close() { closes++; }});
  assert.equal(closes, 1);
});
