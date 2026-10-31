const test = require("node:test"),
  assert = require("node:assert/strict");
const fs = require("node:fs"),
  vm = require("node:vm"),
  path = require("node:path"),
  { EventEmitter } = require("node:events");
const M = require("../src/model.cjs");
const S = require("../src/splits.cjs");
function fixture() {
  const state = M.initialState(),
    ses = new EventEmitter(),
    downloads = [],
    messages = [];
  const replies = [];
  const electron = {
    dialog: { showMessageBox: async () => replies.shift() || { response: 0 } },
    nativeTheme: new EventEmitter(),
    app: {},
    clipboard: { writeText: (t) => messages.push(t) },
    shell: {},
  };
  electron.nativeTheme.shouldUseDarkColors = false;
  const module = { exports: {} };
  vm.runInNewContext(
    fs.readFileSync(
      path.join(__dirname, "../src/browser-features.cjs"),
      "utf8",
    ),
    {
      module,
      exports: module.exports,
      require: (name) =>
        name === "electron"
          ? electron
          : require(
              name.startsWith(".")
                ? path.join(__dirname, "../src", name)
                : name,
            ),
      structuredClone,
      Set,
      Map,
      URL,
      console,
    },
  );
  const wc = {
    getURL: () => "https://example.com/path",
    isDestroyed: () => false,
    session: ses,
  };
  let grants = 0;
  const features = module.exports.createBrowserFeatures({
    state: () => state,
    window: () => null,
    contents: () => wc,
    tab: () => state.tabs.find((t) => t.id === state.activeTabId),
    profile: () => "default",
    downloads,
    publish() {},
    send: (m) => messages.push(m),
    permissionGranted() {
      grants++;
    },
    layout() {},
  });
  ses.setPermissionCheckHandler = (fn) => (ses.check = fn);
  ses.setPermissionRequestHandler = (fn) => (ses.request = fn);
  ses.setDisplayMediaRequestHandler = (fn) => (ses.share = fn);
  features.configureSession("default", ses);
  return {
    state,
    ses,
    wc,
    features,
    replies,
    downloads,
    messages,
    grants: () => grants,
  };
}
test("session permission grants work without persistence and explicit revocation takes precedence", async () => {
  const f = fixture();
  f.replies.push({ response: 1, checkboxChecked: false });
  let allowed;
  await f.ses.request(f.wc, "media", (v) => (allowed = v), {
    requestingUrl: f.wc.getURL(),
  });
  assert.equal(allowed, true);
  assert.equal(f.ses.check(f.wc, "media", "https://example.com"), true);
  assert.equal(f.state.sitePermissions, undefined);
  assert.equal(f.grants(), 1);
  await f.features.handle("site-permission", {
    permission: "media",
    value: "block",
  });
  assert.equal(f.ses.check(f.wc, "media", "https://example.com"), false);
  assert.equal(f.ses.check(f.wc, "media", "https://other.example"), false);
});
test("remembered permission persists by origin, profile and capability", async () => {
  const f = fixture();
  f.replies.push({ response: 1, checkboxChecked: true });
  await f.ses.request(f.wc, "notifications", () => {}, {
    requestingUrl: "https://example.com/a",
  });
  assert.equal(
    f.state.sitePermissions[
      JSON.stringify(["default", "https://example.com", "notifications"])
    ],
    "allow",
  );
  assert.equal(f.ses.check(f.wc, "geolocation", "https://example.com"), false);
});
test("download lifecycle records progress, completion and profile and exposes cancellation", async () => {
  const f = fixture(),
    item = new EventEmitter();
  let paused = false,
    canceled = false;
  Object.assign(item, {
    getURL: () => "https://example.com/file",
    getFilename: () => "file.pdf",
    getReceivedBytes: () => 10,
    getTotalBytes: () => 20,
    getState: () => (canceled ? "cancelled" : "progressing"),
    getSavePath: () => "/tmp/file.pdf",
    isPaused: () => paused,
    pause: () => (paused = true),
    resume: () => (paused = false),
    canResume: () => true,
    cancel: () => (canceled = true),
  });
  f.ses.emit("will-download", {}, item);
  const d = f.downloads[0];
  assert.equal(d.profileId, "default");
  assert.equal(f.state.downloadHistory.length, 1);
  await f.features.handle("download-control", { id: d.id, operation: "pause" });
  assert.equal(paused, true);
  await f.features.handle("download-control", {
    id: d.id,
    operation: "cancel",
  });
  assert.equal(canceled, true);
  item.emit("done", {}, "cancelled");
  assert.equal(f.state.downloadHistory[0].status, "cancelled");
});
test("invalid link routes and search templates never change settings", async () => {
  const f = fixture();
  await assert.rejects(
    f.features.handle("features-settings", {
      routes: [{ type: "host", value: "example.com", spaceId: "missing" }],
    }),
  );
  assert.equal(f.state.settings.routes, undefined);
  await assert.rejects(
    f.features.handle("features-settings", {
      siteSearches: [{ name: "Bad", keyword: "x", url: "javascript:%s" }],
    }),
  );
  assert.equal(f.state.settings.siteSearches, undefined);
});

test("bulk pin and folder actions include every pane of selected split", async () => {
  const f = fixture(),
    s = f.state;
  s.tabs = ["a", "b", "c"].map((id) =>
    M.newTab(s.activeSpaceId, `https://${id}.example`, { id }),
  );
  s.activeTabId = "a";
  S.join(s, "a", "b");
  await f.features.handle("bulk-tabs", { ids: ["b"], operation: "pin" });
  assert.deepEqual(
    s.tabs.map((t) => t.kind),
    ["pinned", "pinned", "today"],
  );
  s.folders.push({
    id: "research",
    spaceId: s.activeSpaceId,
    name: "Research",
  });
  await f.features.handle("bulk-tabs", {
    ids: ["a"],
    operation: "folder",
    folderId: "research",
  });
  assert.deepEqual(
    s.tabs.map((t) => t.folderId),
    ["research", "research", null],
  );
  await f.features.handle("organization-undo", {});
  assert.deepEqual(
    s.tabs.map((t) => t.folderId),
    [null, null, null],
  );
});

test("download destinations preserve existing files and simultaneous same-name downloads", () => {
  const f = fixture();
  const directory = fs.mkdtempSync(
    path.join(require("node:os").tmpdir(), "wing-download-targets-"),
  );
  try {
    f.state.settings.downloadDirectory = directory;
    fs.writeFileSync(path.join(directory, "report.pdf"), "existing document");
    const targets = [];
    for (let i = 0; i < 2; i++) {
      const item = new EventEmitter();
      let target = "";
      Object.assign(item, {
        getURL: () => "https://example.com/report.pdf",
        getFilename: () => "report.pdf",
        getTotalBytes: () => 0,
        getReceivedBytes: () => 0,
        getState: () => "progressing",
        isPaused: () => false,
        setSavePath: (value) => {
          target = value;
        },
        getSavePath: () => target,
      });
      f.ses.emit("will-download", {}, item);
      targets.push(path.basename(target));
    }
    assert.deepEqual(targets, ["report (1).pdf", "report (2).pdf"]);
    assert.equal(
      fs.readFileSync(path.join(directory, "report.pdf"), "utf8"),
      "existing document",
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("permission prompt cannot grant access after its page navigates away", async () => {
  const f = fixture();
  f.replies.push({ response: 1, checkboxChecked: true });
  let allowed;
  const pending = f.ses.request(
    f.wc,
    "media",
    (value) => {
      allowed = value;
    },
    { requestingUrl: f.wc.getURL() },
  );
  f.wc.getURL = () => "https://elsewhere.example/";
  await pending;
  assert.equal(allowed, false);
  assert.equal(f.grants(), 0);
  assert.equal(f.state.sitePermissions, undefined);
});
