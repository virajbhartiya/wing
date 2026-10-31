const test = require("node:test");
const assert = require("node:assert/strict");
const M = require("../src/model.cjs");
const S = require("../src/splits.cjs");
function fixture() {
  const state = M.initialState();
  state.tabs = ["a", "b", "c", "d"].map((id) =>
    M.newTab(state.activeSpaceId, `https://${id}.example`, { id }),
  );
  state.activeTabId = "a";
  return state;
}
test("split membership, orientation and sizes round-trip with workspace", () => {
  const state = fixture();
  S.join(state, "a", "b", "vertical");
  S.join(state, "a", "c");
  S.resize(state, "a", 0, 0.3);
  const restored = M.validateState(JSON.parse(JSON.stringify(state)));
  assert.deepEqual(S.groupFor(restored, "b"), S.groupFor(state, "b"));
  assert.equal(S.groupFor(restored, "b").orientation, "vertical");
  assert.equal(S.groupFor(restored, "a").tabIds.length, 3);
  assert.throws(() => S.join(state, "a", "d"), /three/);
});
test("removing a pane leaves its page open and dissolves undersized groups", () => {
  const state = fixture();
  S.join(state, "a", "b");
  S.join(state, "a", "c");
  S.removeTab(state, "b");
  assert.deepEqual(S.groupFor(state, "a").tabIds, ["a", "c"]);
  assert.equal(state.tabs.length, 4);
  S.removeTab(state, "a");
  assert.equal(S.groupFor(state, "c"), null);
});
test("a closed saved pin remains a member but is not mounted", () => {
  const state = fixture();
  S.join(state, "a", "b");
  state.tabs[1].closed = true;
  assert.deepEqual(S.visibleIds(state, "a"), ["a"]);
  delete state.tabs[1].closed;
  assert.deepEqual(S.visibleIds(state, "a"), ["a", "b"]);
});
test("cross-profile groups and malformed imported groups are rejected", () => {
  const state = fixture();
  state.tabs[1].spaceId = state.spaces[1].id;
  assert.throws(() => S.join(state, "a", "b"), /profile/);
  state.tabs[1].spaceId = state.activeSpaceId;
  S.join(state, "a", "b");
  state.splits[0].tabIds.push("missing");
  assert.throws(() => M.validateState(state), /split/i);
});
test("moving tabs prunes stale group membership without losing remaining pair", () => {
  const state = fixture();
  S.join(state, "a", "b");
  S.join(state, "a", "c");
  state.tabs[1].spaceId = state.spaces[1].id;
  S.reconcile(state);
  assert.deepEqual(S.groupFor(state, "a").tabIds, ["a", "c"]);
});
test("two and three pane layouts tile in either orientation, without overlap", () => {
  for (const orientation of ["horizontal", "vertical"])
    for (const weights of [
      [0.4, 0.6],
      [0.2, 0.3, 0.5],
    ]) {
      const bounds = S.bounds({
        width: 1200,
        height: 800,
        left: 256,
        top: 52,
        orientation,
        weights,
      });
      assert.equal(bounds.length, weights.length);
      for (let i = 1; i < bounds.length; i++) {
        if (orientation === "horizontal")
          assert.equal(bounds[i].x, bounds[i - 1].x + bounds[i - 1].width + 8);
        else
          assert.equal(bounds[i].y, bounds[i - 1].y + bounds[i - 1].height + 8);
      }
      const last = bounds.at(-1);
      assert.equal(last.x + last.width, 1192);
      assert.equal(last.y + last.height, 792);
    }
});
test("resizing clamps adjacent pane minimums while preserving other panes", () => {
  const state = fixture();
  S.join(state, "a", "b");
  S.join(state, "a", "c");
  const group = S.groupFor(state, "a");
  S.resize(state, "a", 0, 0.99);
  assert(
    Math.abs(group.weights[0] + group.weights[1] + group.weights[2] - 1) < 1e-8,
  );
  assert(group.weights.every((w) => w >= 0.15 - 1e-8));
  assert.equal(group.weights[2], 1 / 3);
  S.resize(state, "a", 1, 0.01);
  assert(group.weights.every((w) => w >= 0.15 - 1e-8));
});
test("pinning and moving a split treats its pages as one sidebar item", () => {
  const state = fixture();
  S.join(state, "a", "b");
  S.join(state, "a", "c");
  S.setKind(state, "b", "pinned");
  assert(state.tabs.slice(0, 3).every((tab) => tab.kind === "pinned"));
  state.folders.push({
    id: "folder",
    name: "Research",
    spaceId: state.spaces[1].id,
  });
  M.moveTab(state, "b", state.spaces[1].id, "folder");
  assert(
    state.tabs
      .slice(0, 3)
      .every(
        (tab) =>
          tab.spaceId === state.spaces[1].id && tab.folderId === "folder",
      ),
  );
  assert.deepEqual(S.groupFor(state, "b").tabIds, ["a", "b", "c"]);
});
test("a saved split reopens all of its closed panes as a unit", () => {
  const state = fixture();
  S.join(state, "a", "b");
  S.setKind(state, "a", "pinned");
  for (const tab of S.members(state, "a")) tab.closed = true;
  M.activate(state, "a");
  assert.deepEqual(S.visibleIds(state), ["a", "b"]);
});
test("dragging a split onto a standalone page preserves both source panes", () => {
  const state = fixture();
  S.join(state, "a", "b");
  S.join(state, "c", "a");
  assert.deepEqual(S.groupFor(state, "c").tabIds, ["c", "a", "b"]);
  assert.equal(state.splits.length, 1);
});
test("closing then restoring a temporary split restores the complete group", () => {
  const state = fixture();
  const group = S.join(state, "a", "b", "vertical");
  S.resize(state, "a", 0, 0.3);
  const original = structuredClone(group);
  for (const id of [...group.tabIds]) M.archiveTab(state, id);
  M.restoreTab(state, "a");
  assert.deepEqual(S.groupFor(state, "a"), original);
  assert(state.tabs.some((tab) => tab.id === "b"));
  assert.equal(state.archive.length, 0);
});
test("composite sidebar emits one row with all pane names and active state", () => {
  const vm = require("node:vm"),
    fs = require("node:fs"),
    state = fixture();
  S.join(state, "a", "b");
  state.activeTabId = "b";
  const source = fs.readFileSync(require.resolve("../src/renderer.js"), "utf8");
  const context = {
    state,
    esc: (s) => String(s),
    icon: () => "<svg></svg>",
    tabIcon: () => "<img>",
  };
  vm.createContext(context);
  vm.runInContext(
    source.slice(
      source.indexOf("function sidebarSplit("),
      source.indexOf("let sidebarFrameSequence"),
    ),
    context,
  );
  const html = state.tabs.map((tab) => context.tabHTML(tab)).join("");
  assert.equal((html.match(/data-tab="/g) || []).length, 3);
  assert.match(context.tabHTML(state.tabs[0]), /class="tab active is-split"/);
  assert.match(html, /a.example \/ b.example/);
});
