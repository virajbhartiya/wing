const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const M = require("../src/model.cjs");

test("cached history rejection after tab destruction does not try to reload a released WebContents", async () => {
  const state = M.initialState();
  const tab = state.tabs.find((tab) => tab.kind === "pinned");
  let rejectRestore;
  let loadCalls = 0;
  let destroyed = false;
  class FakeView {
    constructor() {
      this.webContents = {
        isDestroyed: () => destroyed,
        navigationHistory: {
          restore: () => ({
            catch: (callback) => {
              rejectRestore = callback;
            },
          }),
        },
        loadURL: async () => {
          loadCalls++;
        },
      };
    }
    setBorderRadius() {}
    setVisible() {}
  }
  const context = {
    M,
    state,
    WebContentsView: FakeView,
    views: new Map(),
    runtime: new Map(),
    navigationCache: new Map([[tab.id, { entries: [{ url: tab.url }] }]]),
    sessionFor() {},
    profileOf: () => "default",
    extensionManager: { addTab() {} },
    win: {},
    wireContents() {},
  };
  vm.createContext(context);
  const source = fs.readFileSync(require.resolve("../src/main.cjs"), "utf8");
  vm.runInContext(
    source.slice(
      source.indexOf("function ensureView("),
      source.indexOf("const sidebarRevealMotion"),
    ),
    context,
  );
  const view = context.ensureView(tab);
  destroyed = true;
  view.webContents = undefined;
  await assert.doesNotReject(async () =>
    rejectRestore(Error("WebContents destroyed")),
  );
  assert.equal(loadCalls, 0);
});
