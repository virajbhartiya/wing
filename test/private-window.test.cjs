const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const {
  createPrivateWindows,
  privateKeyAction,
  allowedPrivateURL,
} = require("../src/private-window.cjs");

function fakeElectron() {
  const made = { sessions: [], windows: [], pages: [] };
  let nextId = 1;
  const contents = () =>
    Object.assign(new EventEmitter(), {
      id: nextId++,
      destroyed: false,
      url: "about:blank",
      loaded: [],
      isDestroyed() {
        return this.destroyed;
      },
      close() {
        this.destroyed = true;
      },
      getURL() {
        return this.url;
      },
      getUserAgent: () => "Mozilla Electron/45.0.0 wing-browser/0.2.0",
      setUserAgent(agent) {
        this.agent = agent;
      },
      setWindowOpenHandler(handler) {
        this.openHandler = handler;
      },
      loadURL(url) {
        this.loaded.push(url);
        return Promise.resolve();
      },
      loadFile() {},
      send() {},
      focus() {},
      isLoading: () => false,
      reload() {},
      navigationHistory: {
        canGoBack: () => false,
        canGoForward: () => false,
        goBack() {},
        goForward() {},
      },
    });
  class BrowserWindow extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.webContents = contents();
      this.contentView = { addChildView() {} };
      made.windows.push(this);
    }
    getContentSize() {
      return [800, 600];
    }
    focus() {}
    isDestroyed() {
      return !!this.gone;
    }
    close() {
      this.gone = true;
      this.emit("closed");
    }
  }
  class WebContentsView {
    constructor(options) {
      this.options = options;
      this.webContents = contents();
      made.pages.push(this);
    }
    setBounds() {}
  }
  const session = {
    fromPartition(partition) {
      const ses = Object.assign(new EventEmitter(), {
        partition,
        cleared: [],
        setPermissionCheckHandler(handler) {
          this.check = handler;
        },
        setPermissionRequestHandler(handler) {
          this.request = handler;
        },
        setDevicePermissionHandler(handler) {
          this.device = handler;
        },
        clearStorageData() {
          this.cleared.push("storage");
          return Promise.resolve();
        },
        clearCache() {
          this.cleared.push("cache");
          return Promise.resolve();
        },
        clearAuthCache() {
          this.cleared.push("auth");
          return Promise.resolve();
        },
        closeAllConnections() {
          this.cleared.push("connections");
          return Promise.resolve();
        },
      });
      made.sessions.push(ses);
      return ses;
    },
  };
  const ipcMain = { handle(name, handler) { made.ipc = handler; } };
  return { made, electron: { BrowserWindow, WebContentsView, ipcMain, session } };
}
function setup() {
  const { made, electron } = fakeElectron();
  const windows = createPrivateWindows({
    electron,
    resolve: (input) => input,
    userAgent: (agent) => agent.replace(/\sElectron\/\S+/g, ""),
  });
  return { made, windows };
}

test("each private window gets its own in-memory session", () => {
  const { made, windows } = setup();
  windows.open();
  windows.open();
  assert.equal(made.sessions.length, 2);
  assert.notEqual(made.sessions[0].partition, made.sessions[1].partition);
  for (const ses of made.sessions)
    assert.doesNotMatch(ses.partition, /^persist:/, "persist: writes to disk");
});

test("the shell and the page both live in the private session", () => {
  const { made, windows } = setup();
  windows.open();
  assert.equal(made.windows[0].options.webPreferences.session, made.sessions[0]);
  assert.equal(made.pages[0].options.webPreferences.session, made.sessions[0]);
  assert.equal(made.pages[0].options.webPreferences.preload, undefined);
});

test("a popup opens a sibling window that shares the session, never a tab", () => {
  const { made, windows } = setup();
  windows.open();
  const result = made.pages[0].webContents.openHandler({
    url: "https://example.com/popup",
  });
  assert.deepEqual(result, { action: "deny" });
  assert.equal(made.windows.length, 2);
  assert.equal(made.sessions.length, 1);
  assert.deepEqual(made.pages[1].webContents.loaded, [
    "https://example.com/popup",
  ]);
});

test("the session is wiped only when its last window closes", async () => {
  const { made, windows } = setup();
  windows.open();
  made.pages[0].webContents.openHandler({ url: "https://example.com/" });
  made.windows[0].close();
  assert.deepEqual(made.sessions[0].cleared, []);
  made.windows[1].close();
  await new Promise(setImmediate);
  assert.deepEqual(
    [...made.sessions[0].cleared].sort(),
    ["auth", "cache", "connections", "storage"],
  );
  assert.equal(made.pages[0].webContents.isDestroyed(), true);
  assert.equal(made.pages[1].webContents.isDestroyed(), true);
});

test("closing cancels a partial download", () => {
  const { made, windows } = setup();
  windows.open();
  const item = Object.assign(new EventEmitter(), {
    canceled: false,
    cancel() {
      this.canceled = true;
    },
  });
  made.sessions[0].emit("will-download", {}, item);
  made.windows[0].close();
  assert.equal(item.canceled, true);
});

test("sites get no permissions beyond fullscreen", () => {
  const { made, windows } = setup();
  windows.open();
  const ses = made.sessions[0];
  assert.equal(ses.check({}, "geolocation", "https://example.com"), false);
  assert.equal(ses.device({}), false);
  const answer = (permission) => {
    let granted;
    ses.request({}, permission, (value) => (granted = value), {});
    return granted;
  };
  assert.equal(answer("media"), false);
  assert.equal(answer("notifications"), false);
  assert.equal(answer("fullscreen"), true);
});

test("only the window's own shell can drive it", () => {
  const { made, windows } = setup();
  windows.open();
  const shell = made.windows[0].webContents;
  const frame = {};
  shell.mainFrame = frame;
  assert.throws(() =>
    made.ipc({ sender: made.pages[0].webContents, senderFrame: frame }, "ready"),
  );
  assert.throws(() => made.ipc({ sender: shell, senderFrame: {} }, "ready"));
  made.ipc({ sender: shell, senderFrame: frame }, "navigate", "https://a.test/");
  assert.deepEqual(made.pages[0].webContents.loaded, ["about:blank", "https://a.test/"]);
  made.ipc({ sender: shell, senderFrame: frame }, "navigate", "wing://history");
  assert.deepEqual(made.pages[0].webContents.loaded, ["about:blank", "https://a.test/"]);
});

test("private pages load web addresses only", () => {
  assert.equal(allowedPrivateURL("https://example.com/"), true);
  assert.equal(allowedPrivateURL("http://localhost:3000/"), true);
  assert.equal(allowedPrivateURL("about:blank"), true);
  assert.equal(allowedPrivateURL("wing://history"), false);
  assert.equal(allowedPrivateURL("file:///etc/passwd"), false);
  assert.equal(
    allowedPrivateURL("chrome-extension://abcdefghijklmnopabcdefghijklmnop/a"),
    false,
  );
  assert.equal(allowedPrivateURL("not a url"), false);
});

test("menu shortcuts that act on the main window stop at the private window", () => {
  const key = (k, extra = {}) =>
    privateKeyAction({ type: "keyDown", key: k, meta: true, ...extra });
  assert.equal(key("w"), "close");
  assert.equal(key("l"), "address");
  assert.equal(key("t"), "block");
  assert.equal(key("d"), "block");
  assert.equal(key("c"), "pass");
  assert.equal(key("n", { shift: true }), "pass");
  assert.equal(key("n"), "block");
  assert.equal(
    privateKeyAction({ type: "keyDown", key: "1", control: true }),
    "block",
  );
  assert.equal(privateKeyAction({ type: "keyUp", key: "w", meta: true }), "pass");
});
