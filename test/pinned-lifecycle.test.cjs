const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../src/model.cjs');
const fs = require('node:fs');
const vm = require('node:vm');

for (const kind of ['pinned', 'favorite']) {
  test(`closing ${kind} preserves its identity, placement and saved address`, () => {
    const state = M.initialState();
    const tab = state.tabs.find(t => t.kind === kind);
    tab.customTitle = tab.title = 'My saved destination';
    tab.url = 'https://elsewhere.example/article';
    state.activeTabId = tab.id;
    M.closePage(state, tab.id);
    assert.equal(state.tabs.find(t => t.id === tab.id), tab);
    assert.equal(tab.url, tab.homeURL);
    assert.equal(tab.closed, true);
    assert.equal(tab.title, 'My saved destination');
    assert.equal(state.archive.length, 0);
    assert.notEqual(state.activeTabId, tab.id);
    M.activate(state, tab.id);
    assert.equal(state.activeTabId, tab.id);
    assert.equal(tab.closed, undefined);
  });
}

test('closing last open saved page leaves a valid empty view and switching Spaces does not reopen it', () => {
  const state = M.initialState();
  const tab = state.tabs.find(t => t.kind === 'pinned');
  state.tabs = [tab];
  state.activeTabId = tab.id;
  M.closePage(state, tab.id);
  assert.equal(state.activeTabId, null);
  M.selectSpace(state, tab.spaceId);
  assert.equal(state.activeTabId, null);
  assert.equal(M.validateState(JSON.parse(JSON.stringify(state))).tabs[0].closed, true);
});

test('explicitly archiving a saved destination removes it and restore opens it again', () => {
  const state = M.initialState();
  const tab = state.tabs.find(t => t.kind === 'pinned');
  M.closePage(state, tab.id);
  M.closePage(state, tab.id, {archive: true});
  assert.equal(state.tabs.some(t => t.id === tab.id), false);
  assert.equal(state.archive[0].id, tab.id);
  M.restoreTab(state, tab.id);
  assert.equal(state.activeTabId, tab.id);
  assert.equal(state.tabs.find(t => t.id === tab.id).closed, undefined);
});

test('closing a regular tab archives it without selecting an unloaded saved page', () => {
  const state = M.initialState();
  state.tabs.filter(t => t.kind !== 'today').forEach(t => M.closePage(state, t.id));
  const tab = state.tabs.find(t => t.kind === 'today');
  state.activeTabId = tab.id;
  M.closePage(state, tab.id);
  assert.equal(state.archive[0].id, tab.id);
  assert.equal(state.activeTabId, null);
});

test('closing background saved page preserves active tab and repeated close is harmless', () => {
  const state = M.initialState();
  const current = state.activeTabId;
  const tab = state.tabs.find(t => t.kind === 'pinned');
  M.closePage(state, tab.id);
  M.closePage(state, tab.id);
  M.closePage(state, 'missing');
  assert.equal(state.activeTabId, current);
  assert.equal(state.archive.length, 0);
});

test('host close unloads the saved page and clears document runtime before relayout', () => {
  const state = M.initialState();
  const tab = state.tabs.find(t => t.kind === 'pinned');
  state.tabs = [tab];
  state.activeTabId = tab.id;
  const closed = [];
  const runtime = new Map([[tab.id, {error: 'old document error', audible: true}]]);
  const navigationCache = new Map([[tab.id, {entries: ['old navigation']}]]);
  const context = {M, state, peek:null, splitId:null, runtime, navigationCache,
    closeView:id => closed.push(id), publish(){},
    layout(){
      assert.equal(state.activeTabId, null, 'relayout must not recreate the closed page');
      assert.equal(runtime.has(tab.id), false);
      assert.equal(navigationCache.has(tab.id), false);
    },
  };
  const source = fs.readFileSync(require.resolve('../src/main.cjs'), 'utf8');
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('function closeTab('), source.indexOf('async function applyBoost(')), context);
  context.closeTab(tab.id);
  assert.deepEqual(closed, [tab.id]);
});
