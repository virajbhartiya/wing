const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  vm = require("node:vm");
test("switching profiles preserves a hover-revealed sidebar until the cursor leaves", async () => {
  const source = fs.readFileSync("src/main.cjs", "utf8"),
    start = source.indexOf('    case "swipe-profile":'),
    end = source.indexOf("\n    case ", start + 5);
  const state = {
    sidebarHidden: true,
    activeSpaceId: "a",
    spaces: [
      { id: "a", profileId: "one" },
      { id: "b", profileId: "two" },
    ],
  };
  const context = {
    state,
    data: { direction: 1 },
    I: require("../src/interactions.cjs"),
    M: { selectSpace: (s, id) => (s.activeSpaceId = id) },
    sidebarRevealed: true,
    splitId: null,
    overlay: false,
    closePeek() {},
    closeOverlay() {},
    layout() {},
  };
  vm.createContext(context);
  await vm.runInContext(
    '(async()=>{switch("swipe-profile"){' + source.slice(start, end) + "}})()",
    context,
  );
  assert.equal(state.activeSpaceId, "b");
  assert.equal(
    context.sidebarRevealed,
    true,
    "profile changes must not dismiss the sidebar under the pointer",
  );
  assert.equal(
    state.sidebarHidden,
    true,
    "persistent hide preference remains unchanged",
  );
});

test("clicking a Space also retains the hover reveal and hidden preference", async () => {
  const source = fs.readFileSync("src/main.cjs", "utf8"),
    start = source.indexOf('    case "space":'),
    end = source.indexOf("\n    case ", start + 5);
  const state = { sidebarHidden: true, activeSpaceId: "a" };
  const context = {
    state,
    data: { id: "b" },
    M: { selectSpace: (s, id) => (s.activeSpaceId = id) },
    sidebarRevealed: true,
    splitId: null,
    closePeek() {},
    closeOverlay() {},
    layout() {},
  };
  vm.createContext(context);
  await vm.runInContext(
    '(async()=>{switch("space"){' + source.slice(start, end) + "}})()",
    context,
  );
  assert.equal(state.activeSpaceId, "b");
  assert.equal(context.sidebarRevealed, true);
  assert.equal(state.sidebarHidden, true);
});
