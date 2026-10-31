const test = require("node:test");
const assert = require("node:assert/strict");
const { orderedTabs, TabSwitcher } = require("../src/recent-tabs.cjs");

const workspace = () => ({
  activeTabId: "a",
  activeSpaceId: "personal",
  spaces: [
    { id: "personal", profileId: "p" },
    { id: "project", profileId: "p" },
    { id: "work", profileId: "w" },
  ],
  tabs: [
    { id: "a", spaceId: "personal", lastActive: 300 },
    { id: "b", spaceId: "personal", lastActive: 100 },
    { id: "c", spaceId: "project", lastActive: 200 },
    { id: "private", spaceId: "work", lastActive: 400 },
  ],
});

test("recent tabs includes same-profile spaces, excludes other profiles and starts with active", () => {
  const state = workspace();
  assert.deepEqual(
    orderedTabs(state).map((t) => t.id),
    ["a", "c", "b"],
  );
  state.tabs[0].lastActive = 1;
  assert.deepEqual(
    orderedTabs(state).map((t) => t.id),
    ["a", "c", "b"],
  );
});
test("holding Control cycles a frozen MRU order until commit", () => {
  const state = workspace(),
    switcher = new TabSwitcher();
  assert.equal(switcher.step(state, 1).selectedId, "c");
  assert.equal(
    state.activeTabId,
    "a",
    "preview must not activate or reorder tabs",
  );
  state.tabs[1].lastActive = 500;
  assert.equal(switcher.step(state, 1).selectedId, "b");
  assert.equal(switcher.step(state, 1).selectedId, "a");
  assert.equal(switcher.step(state, -1).selectedId, "b");
  assert.equal(switcher.commit(state), "b");
  assert.equal(switcher.active, false);
});
test("cancel preserves the original page and a fresh gesture takes fresh ordering", () => {
  const state = workspace(),
    switcher = new TabSwitcher();
  switcher.step(state, 1);
  assert.equal(switcher.cancel(), "a");
  assert.equal(switcher.active, false);
  state.tabs[1].lastActive = 500;
  assert.equal(switcher.step(state, 1).selectedId, "b");
});
test("closed tabs disappear and profile changes invalidate the gesture", () => {
  const state = workspace(),
    switcher = new TabSwitcher();
  switcher.step(state, 1);
  state.tabs = state.tabs.filter((t) => t.id !== "c");
  assert.equal(switcher.commit(state), "b");
  switcher.step(state, 1);
  state.activeSpaceId = "work";
  assert.equal(switcher.commit(state), null);
});
test("pointer selection rejects foreign and unknown tabs", () => {
  const state = workspace(),
    switcher = new TabSwitcher();
  switcher.step(state, 1);
  assert.equal(switcher.select(state, "private"), false);
  assert.equal(switcher.select(state, "missing"), false);
  assert.equal(switcher.select(state, "b"), true);
  assert.equal(switcher.commit(state), "b");
});
test("empty or single-tab profiles have no switcher to display", () => {
  const state = workspace(),
    switcher = new TabSwitcher();
  state.tabs = state.tabs.slice(0, 1);
  assert.equal(switcher.step(state, 1), null);
  state.tabs = [];
  assert.equal(switcher.step(state, -1), null);
});

test("closed saved destinations do not appear among recently open pages", () => {
  const state = workspace();
  state.tabs[2].closed = true;
  assert.deepEqual(
    orderedTabs(state).map((tab) => tab.id),
    ["a", "b"],
  );
});

test("release still ends a gesture if all but one of its tabs were closed", () => {
  const state = workspace(),
    switcher = new TabSwitcher();
  switcher.step(state, 1);
  state.tabs = state.tabs.filter((t) => t.id === "a");
  switcher.snapshot(state);
  assert.equal(switcher.active, true);
  assert.equal(switcher.commit(state), "a");
  assert.equal(switcher.active, false);
});

test("native key routing previews on Control-Tab, commits on release, and cancels on Escape", () => {
  const fs = require("node:fs"),
    vm = require("node:vm");
  const source = fs.readFileSync(require.resolve("../src/main.cjs"), "utf8");
  const state = workspace(),
    calls = [],
    commands = [];
  const context = {
    state,
    RecentTabs: require("../src/recent-tabs.cjs"),
    recentTabs: new TabSwitcher(),
    win: { webContents: { focus() {} } },
    sendCommand: (command) => commands.push(command),
    closeOverlay() {},
    layout() {},
    action: (name, data) => calls.push({ name, data }),
  };
  vm.createContext(context);
  vm.runInContext(
    source.slice(
      source.indexOf("function cycleTab("),
      source.indexOf("app.whenReady()"),
    ),
    context,
  );
  let prevented = 0;
  const input = (event) =>
    context.handleRecentTabsInput(
      {
        preventDefault() {
          prevented++;
        },
      },
      event,
    );
  input({ type: "keyDown", key: "Tab", control: true });
  assert.equal(calls.length, 0);
  assert.equal(commands.at(-1).selectedId, "c");
  input({ type: "keyDown", key: "Tab", control: true });
  assert.equal(commands.at(-1).selectedId, "b");
  input({ type: "keyUp", key: "Control" });
  assert.equal(calls.at(-1).data.id, "b");
  assert.equal(commands.at(-1).type, "recent-tabs-close");
  input({ type: "keyDown", key: "Tab", control: true });
  input({ type: "keyDown", key: "Escape", control: true });
  assert.equal(calls.length, 1, "cancel must never activate a preview");
  assert.equal(context.recentTabs.active, false);
  assert.equal(prevented, 5);
});
