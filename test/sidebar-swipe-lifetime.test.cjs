const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

test("native pointer recomputation cannot hide the sidebar during an ongoing routed swipe", () => {
  let timer;
  const reveals = [];
  const context = {
    state: { sidebarHidden: true },
    revealTimer: null,
    modalType: null,
    dragged: null,
    profileSwipeIdle: 123,
    document: { activeElement: null },
    $: () => ({ matches: () => false, contains: () => false }),
    clearTimeout() {},
    setTimeout: (callback) => {
      timer = callback;
      return 1;
    },
    requestSidebarReveal: (visible) => reveals.push(visible),
  };
  vm.createContext(context);
  const source = fs.readFileSync(require.resolve("../src/renderer.js"), "utf8");
  vm.runInContext(
    source.slice(
      source.indexOf("function scheduleSidebarHide("),
      source.indexOf('$("#sidebar-edge").addEventListener'),
    ),
    context,
  );
  context.scheduleSidebarHide();
  timer();
  assert.deepEqual(
    reveals,
    [],
    "wheel momentum still belongs to the revealed sidebar",
  );
  context.profileSwipeIdle = null;
  context.scheduleSidebarHide();
  timer();
  assert.deepEqual(
    reveals,
    [false],
    "sidebar may hide once the gesture settles and the pointer is outside",
  );
});

test("a fresh sidebar swipe reverses a hide already queued after the previous gesture", () => {
  let wheel;
  const reveals = [];
  const sidebar = {
    addEventListener: (_event, listener) => {
      wheel = listener;
    },
    classList: { add() {}, remove() {} },
    style: { setProperty() {} },
  };
  const context = {
    state: {
      sidebarHidden: true,
      sidebarRevealed: false,
      settings: { sidebarWidth: 256 },
      spaces: [{ profileId: "a" }, { profileId: "b" }],
    },
    modalType: null,
    dragged: null,
    performance: { now: () => 1000 },
    $: () => sidebar,
    window: {
      matchMedia: () => ({ matches: true, addEventListener() {} }),
      wing: {
        swipeUpdate: () => ({
          handled: true,
          phase: "tracking",
          progress: 0.2,
          direction: 0,
        }),
      },
    },
    clearTimeout() {},
    setTimeout: () => 1,
    requestAnimationFrame: () => 1,
    cancelAnimationFrame() {},
    requestSidebarReveal: (visible) => reveals.push(visible),
  };
  vm.createContext(context);
  const source = fs.readFileSync(require.resolve("../src/renderer.js"), "utf8");
  vm.runInContext(
    source.slice(
      source.indexOf("let profileSwipeFrame ="),
      source.indexOf("function resizer("),
    ),
    context,
  );
  wheel({
    deltaX: 20,
    deltaY: 0,
    deltaMode: 0,
    ctrlKey: false,
    preventDefault() {},
  });
  assert.deepEqual(
    reveals,
    [true],
    "routed input must reverse a pending native hide even before the next state broadcast",
  );
  wheel({
    deltaX: 20,
    deltaY: 0,
    deltaMode: 0,
    ctrlKey: false,
    preventDefault() {},
  });
  assert.deepEqual(
    reveals,
    [true],
    "a continuous gesture must not restart reveal animation for every wheel sample",
  );
});
