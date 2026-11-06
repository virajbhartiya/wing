const test = require("node:test");
const assert = require("node:assert/strict");
const M = require("../src/model.cjs");
const S = require("../src/icloud-sync.cjs");

const clone = (value) => JSON.parse(JSON.stringify(value));
const pinned = (state) =>
  state.tabs.filter((t) => t.kind === "pinned").map((t) => t.homeURL);

test("a fresh Mac adopts matching Spaces instead of doubling them", () => {
  const a = M.initialState(),
    b = M.initialState();
  assert.notEqual(a.spaces[0].id, b.spaces[0].id);
  const changed = S.merge(b, S.layoutOf(a), null);
  assert.equal(changed, true);
  assert.deepEqual(
    b.spaces.map((s) => s.id),
    a.spaces.map((s) => s.id),
  );
  assert.deepEqual(pinned(b), pinned(a));
  assert.doesNotThrow(() => M.validateState(b));
});

test("pins added on either Mac survive a merge", () => {
  const a = M.initialState();
  const b = clone(a);
  const base = S.layoutOf(a);
  const space = a.spaces[0].id;
  a.tabs.push(M.newTab(space, "https://news.ycombinator.com", { kind: "pinned" }));
  b.tabs.push(M.newTab(space, "https://lobste.rs", { kind: "pinned" }));
  S.merge(b, S.layoutOf(a), base);
  assert.ok(pinned(b).includes("https://news.ycombinator.com/"));
  assert.ok(pinned(b).includes("https://lobste.rs/"));
  assert.doesNotThrow(() => M.validateState(b));
});

test("a pin removed on the other Mac is removed here", () => {
  const a = M.initialState();
  const b = clone(a);
  const base = S.layoutOf(a);
  const gone = a.tabs.find((t) => t.kind === "pinned" && t.id !== a.activeTabId);
  a.tabs = a.tabs.filter((t) => t !== gone);
  S.merge(b, S.layoutOf(a), base);
  assert.ok(!pinned(b).includes(gone.homeURL));
});

test("a Space renamed there is renamed here; local renames stay otherwise", () => {
  const a = M.initialState();
  const b = clone(a);
  const base = S.layoutOf(a);
  a.spaces[0].name = "Home";
  b.spaces[1].name = "Office";
  S.merge(b, S.layoutOf(a), base);
  assert.equal(b.spaces[0].name, "Home");
  assert.equal(b.spaces[1].name, "Office");
});

test("a merge with nothing new changes nothing", () => {
  const a = M.initialState();
  const layout = S.layoutOf(a);
  assert.equal(S.merge(a, layout, layout), false);
});

test("an invalid sync file is ignored", () => {
  const a = M.initialState();
  const before = JSON.stringify(a);
  assert.equal(S.merge(a, { spaces: "x" }, null), false);
  assert.equal(
    S.merge(a, { spaces: [], folders: [], items: [{ key: "x" }] }, null),
    false,
  );
  assert.equal(JSON.stringify(a), before);
});
