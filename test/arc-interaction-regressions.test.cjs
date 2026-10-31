const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const M = require('../src/model.cjs');
const source = fs.readFileSync(require.resolve('../src/main.cjs'), 'utf8');

test('closing a pinned page keeps its saved sidebar destination', () => {
  const state = M.initialState();
  const tab = state.tabs.find(t => t.kind === 'pinned');
  tab.url = 'https://developer.mozilla.org/en-US/docs/Web';
  state.activeTabId = tab.id;
  const context = { M, state, peek: null, splitId: null, navigationCache: new Map(),
    closeView() {}, layout() {}, publish() {}, runtime: new Map(), views: new Map() };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('function closeTab('), source.indexOf('async function applyBoost(')), context);
  context.closeTab(tab.id);
  assert.ok(state.tabs.some(t => t.id === tab.id), 'closing must unload a pin, not remove its saved destination');
  assert.equal(state.archive.some(t => t.id === tab.id), false);
  assert.equal(state.tabs.find(t => t.id === tab.id).url, tab.homeURL);
});

test('Ctrl+Tab returns to the most recently visited page rather than sidebar neighbor', () => {
  const state = M.initialState();
  state.tabs = ['a', 'b', 'c'].map((name, i) => M.newTab(state.activeSpaceId, `https://${name}.example/`, {id:name,lastActive:[300,100,200][i]}));
  state.activeTabId = 'a';
  let selected;
  const context = { M, state, RecentTabs: require('../src/recent-tabs.cjs'), action: (_name, data) => { selected = data.id; } };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('function cycleTab('), source.indexOf('app.whenReady()')), context);
  context.cycleTab(1);
  assert.equal(selected, 'c');
});

test('a split pair survives visiting a different tab and returning', async () => {
  const state = M.initialState();
  state.tabs = ['a','b','c'].map(id => M.newTab(state.activeSpaceId, `https://${id}.example/`, {id}));
  state.activeTabId = 'a';
  const context = {M,state,splitId:null,splitRatio:0.5,splitReversed:false,
    activeTab:()=>state.tabs.find(t=>t.id===state.activeTabId),activeContents:()=>null,
    profileOf:t=>M.spaceOf(state,t).profileId, closePeek(){},closeOverlay(){},layout(){},trimMemory(){},publish(){} };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('async function action('),source.indexOf('function menu()')),context);
  await context.action('split',{id:'b'});
  await context.action('select-tab',{id:'c'});
  await context.action('select-tab',{id:'a'});
  assert.equal(context.splitId,'b','saved split must return with its first tab');
});
