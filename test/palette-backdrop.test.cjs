const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
test("opening a modal captures the current webpage before hiding native content", async () => {
  const source = fs.readFileSync("src/main.cjs", "utf8");
  const start = source.indexOf('    case "overlay":');
  const end = source.indexOf("\n    case ", start + 5);
  const events = [];
  const context = {
    data: { open: true },
    overlay: false,
    layout: () => events.push("detach"),
    prepareOverlay: async () => events.push("capture"),
    closeOverlay: () => {},
    state: {},
    wc: {},
    win: {},
  };
  vm.createContext(context);
  await vm.runInContext(
    '(async()=>{switch("overlay"){' + source.slice(start, end) + "}})()",
    context,
  );
  assert.equal(
    events[0],
    "capture",
    "a real page must be preserved before detaching",
  );
});
const { OverlayBackdrop } = require("../src/overlay.cjs");
test("closing during capture prevents a late result from hiding the page", async () => {
  let finish;
  let detached = 0;
  const controller = new OverlayBackdrop({
    capture: () => new Promise((resolve) => (finish = resolve)),
    commit: () => detached++,
    release: () => {},
  });
  const pending = controller.prepare();
  controller.close();
  finish([{ image: "old" }]);
  assert.deepEqual(await pending, { cancelled: true });
  assert.equal(detached, 0);
  assert.equal(controller.frames, null);
});
test("reopening invalidates prior decode acknowledgements and reuses only the current capture", async () => {
  let captures = 0,
    detached = 0;
  const controller = new OverlayBackdrop({
    capture: async () => [{ image: ++captures }],
    commit: () => detached++,
    release: () => {},
  });
  const first = await controller.prepare();
  const second = await controller.prepare();
  assert.equal(captures, 1);
  assert.equal(controller.commit(first.token), false);
  assert.equal(controller.commit(second.token), true);
  controller.close();
  const third = await controller.prepare();
  assert.equal(captures, 2);
  assert.equal(controller.commit(second.token), false);
  assert.equal(controller.commit(third.token), true);
  assert.equal(detached, 2);
});
test("a fully occluded shell still commits its dialog when animation frames never arrive", async () => {
  const source = fs.readFileSync("src/renderer.js", "utf8");
  const nodes = new Map();
  let commits = 0;
  class Image {
    constructor() {
      this.style = {};
    }
    decode() {
      return Promise.resolve();
    }
  }
  const context = {
    Image,
    HTMLImageElement: Image,
    setTimeout,
    clearTimeout,
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {},
    document: { createElement: () => ({ style: {} }) },
    $: (id) => {
      if (!nodes.has(id)) nodes.set(id, { replaceChildren() {}, hidden: true });
      return nodes.get(id);
    },
    toast: () => {},
    window: {
      wing: {
        invoke: async (_action, data) =>
          data.ready !== undefined
            ? (commits++, { ok: true })
            : {
                token: 1,
                frames: [
                  {
                    bounds: { x: 0, y: 0, width: 100, height: 100 },
                    image: "fixture",
                  },
                ],
              },
      },
    },
  };
  vm.createContext(context);
  vm.runInContext(
    source.slice(
      source.indexOf("let backdropEpoch"),
      source.indexOf("window.wing.onOverlay"),
    ),
    context,
  );
  const result = await Promise.race([
    context.prepareOverlayBackdrop(),
    new Promise((resolve) => setTimeout(() => resolve("deadline"), 500)),
  ]);
  assert.equal(
    result,
    true,
    "occlusion must not indefinitely block the capture/decode handshake",
  );
  assert.equal(commits, 1);
});
test("a stalled native capture times out without accumulating requests", async () => {
  const { capturePageBounded } = require("../src/overlay.cjs");
  let requests = 0;
  const contents = {
    capturePage: () => {
      requests++;
      return new Promise(() => {});
    },
  };
  await assert.rejects(capturePageBounded(contents, 5), /timed out/);
  await assert.rejects(capturePageBounded(contents, 5), /timed out/);
  assert.equal(requests, 1);
});
function closingBackdropHarness() {
  const source = fs.readFileSync("src/renderer.js", "utf8");
  let onOverlay;
  let clears = 0;
  const node = { hidden: false, replaceChildren: () => clears++ };
  const context = {
    $: () => node,
    setTimeout,
    clearTimeout,
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {},
    window: {
      wing: {
        invoke: async () => ({ ok: true }),
        onOverlay: (callback) => (onOverlay = callback),
      },
    },
  };
  vm.createContext(context);
  vm.runInContext(
    source.slice(
      source.indexOf("let backdropEpoch"),
      source.indexOf("function showModal("),
    ),
    context,
  );
  vm.runInContext("displayedBackdropToken = 7", context);
  return {
    context,
    node,
    onOverlay,
    get clears() {
      return clears;
    },
  };
}
test("dialog close retains the decoded backdrop until the native page handoff completes", async () => {
  const h = closingBackdropHarness();
  await h.context.releaseOverlayBackdrop();
  h.onOverlay({ type: "clear", token: 8, handoff: true });
  assert.equal(
    h.clears,
    0,
    "closing must not expose the shell before the native page repaints",
  );
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(h.clears, 1);
  assert.equal(h.node.hidden, true);
});
test("an old close handoff cannot erase a new dialog backdrop, while navigation clears immediately", async () => {
  const h = closingBackdropHarness();
  h.onOverlay({ type: "clear", token: 8, handoff: true });
  vm.runInContext("++backdropEpoch; displayedBackdropToken = 9", h.context);
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(h.clears, 0);
  h.onOverlay({ type: "clear", token: 10, handoff: false });
  assert.equal(h.clears, 1);
});
