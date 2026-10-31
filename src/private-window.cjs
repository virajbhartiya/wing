"use strict";
// A window whose browsing leaves nothing behind. It runs on an in-memory session
// and has no link to the workspace, so history, tabs and extensions cannot see it.
const crypto = require("node:crypto");
const path = require("node:path");
const SHELL_HEIGHT = 44;
const INSET = 6;
const EDIT_KEYS = new Set(["c", "v", "x", "a", "z", "q", "h", "m", "`"]);
function allowedPrivateURL(url) {
  try {
    return (
      url === "about:blank" ||
      ["http:", "https:"].includes(new URL(url).protocol)
    );
  } catch {
    return false;
  }
}
// The app menu acts on the main window, so its shortcuts must stop here.
function privateKeyAction(input) {
  if (input.type !== "keyDown") return "pass";
  const key = String(input.key || "").toLowerCase();
  if (input.control && !input.meta)
    return /^(\d|tab)$/.test(key) ? "block" : "pass";
  if (!input.meta) return "pass";
  if (key === "w") return "close";
  if (key === "l") return "address";
  if (key === "r") return "reload";
  if (key === "[" || key === "arrowleft") return "back";
  if (key === "]" || key === "arrowright") return "forward";
  if (key === "n" && input.shift) return "pass";
  return EDIT_KEYS.has(key) ? "pass" : "block";
}
function createPrivateWindows(deps) {
  const { BrowserWindow, WebContentsView, ipcMain, session } = deps.electron;
  const shells = new Map();
  const groups = new Set();
  ipcMain.handle("private:action", (event, name, value) => {
    const entry = shells.get(event.sender.id);
    if (!entry || event.senderFrame !== event.sender.mainFrame)
      throw Error("Unknown private window.");
    return entry.run(String(name), value);
  });
  function createGroup() {
    // No "persist:" prefix, so Chromium keeps this session in memory only.
    const ses = session.fromPartition("wing-private-" + crypto.randomUUID());
    ses.setPermissionCheckHandler(() => false);
    ses.setPermissionRequestHandler((_wc, permission, callback) =>
      callback(permission === "fullscreen"),
    );
    ses.setDevicePermissionHandler(() => false);
    const group = { ses, windows: new Set(), downloads: new Set() };
    // A save dialog still asks where each download goes; only a saved file stays.
    ses.on("will-download", (_event, item) => {
      group.downloads.add(item);
      item.once("done", () => group.downloads.delete(item));
    });
    groups.add(group);
    return group;
  }
  function releaseGroup(group) {
    groups.delete(group);
    for (const item of group.downloads) item.cancel();
    group.downloads.clear();
    const { ses } = group;
    Promise.allSettled([
      ses.clearStorageData(),
      ses.clearCache(),
      ses.clearAuthCache(),
      ses.closeAllConnections(),
    ]).catch(() => {});
  }
  function open({ url, group = createGroup() } = {}) {
    const window = new BrowserWindow({
      width: 1100,
      height: 760,
      minWidth: 420,
      minHeight: 300,
      // A fixed title keeps page titles out of what macOS records about windows.
      title: "Private Window",
      titleBarStyle: "hiddenInset",
      trafficLightPosition: { x: 14, y: 15 },
      backgroundColor: "#211b2e",
      webPreferences: {
        session: group.ses,
        preload: path.join(__dirname, "private-preload.cjs"),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    group.windows.add(window);
    const shell = window.webContents;
    const view = new WebContentsView({
      webPreferences: {
        session: group.ses,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        safeDialogs: true,
      },
    });
    const page = view.webContents;
    const shellId = shell.id;
    const layout = () => {
      const [width, height] = window.getContentSize();
      view.setBounds({
        x: INSET,
        y: SHELL_HEIGHT,
        width: Math.max(0, width - INSET * 2),
        height: Math.max(0, height - SHELL_HEIGHT - INSET),
      });
    };
    const publish = () => {
      if (window.isDestroyed() || page.isDestroyed()) return;
      const current = page.getURL();
      shell.send("private:state", {
        url: current === "about:blank" ? "" : current,
        canGoBack: page.navigationHistory.canGoBack(),
        canGoForward: page.navigationHistory.canGoForward(),
        loading: page.isLoading(),
      });
    };
    const run = (name, value) => {
      if (name === "ready") return publish();
      if (name === "back") page.navigationHistory.goBack();
      else if (name === "forward") page.navigationHistory.goForward();
      else if (name === "reload") page.reload();
      else if (name === "navigate") {
        let next;
        try {
          next = deps.resolve(String(value || ""));
        } catch {
          return;
        }
        if (allowedPrivateURL(next)) page.loadURL(next).catch(() => {});
      }
    };
    shells.set(shellId, { run });
    const focusAddress = () => {
      shell.focus();
      shell.send("private:focus-address");
    };
    const onKey = (event, input) => {
      const key = privateKeyAction(input);
      if (key === "pass") return;
      event.preventDefault();
      if (key === "close") window.close();
      else if (key === "address") focusAddress();
      else if (key !== "block") run(key);
    };
    shell.on("before-input-event", onKey);
    shell.on("will-navigate", (event) => event.preventDefault());
    shell.setWindowOpenHandler(() => ({ action: "deny" }));
    page.on("before-input-event", onKey);
    page.setUserAgent(deps.userAgent(page.getUserAgent()));
    page.setWindowOpenHandler(({ url: target }) => {
      if (allowedPrivateURL(target)) open({ url: target, group });
      return { action: "deny" };
    });
    const guard = (event, target) => {
      if (!allowedPrivateURL(target)) event.preventDefault();
    };
    page.on("will-navigate", guard);
    page.on("will-redirect", guard);
    page.on("context-menu", (_event, params) => {
      const { Menu, clipboard } = deps.electron;
      const entries = [];
      if (allowedPrivateURL(params.linkURL))
        entries.push(
          {
            label: "Open Link in New Private Window",
            click: () => open({ url: params.linkURL, group }),
          },
          {
            label: "Copy Link Address",
            click: () => clipboard.writeText(params.linkURL),
          },
          { type: "separator" },
        );
      if (params.isEditable)
        entries.push(
          { role: "undo" },
          { role: "redo" },
          { type: "separator" },
          { role: "cut" },
          { role: "copy" },
          { role: "paste" },
          { role: "selectAll" },
          { type: "separator" },
        );
      else if (params.selectionText)
        entries.push({ role: "copy" }, { type: "separator" });
      entries.push(
        {
          label: "Back",
          enabled: page.navigationHistory.canGoBack(),
          click: () => page.navigationHistory.goBack(),
        },
        { label: "Reload", click: () => page.reload() },
      );
      Menu.buildFromTemplate(entries).popup({ window });
    });
    for (const name of [
      "did-navigate",
      "did-navigate-in-page",
      "did-start-loading",
      "did-stop-loading",
    ])
      page.on(name, publish);
    view.setBorderRadius?.(10);
    window.contentView.addChildView(view);
    layout();
    window.on("resize", layout);
    window.once("closed", () => {
      shells.delete(shellId);
      if (!page.isDestroyed()) page.close();
      group.windows.delete(window);
      if (!group.windows.size) releaseGroup(group);
    });
    page.loadURL(url || "about:blank").catch(() => {});
    shell.loadFile(path.join(__dirname, "private.html"));
    if (!url) shell.once("did-finish-load", focusAddress);
    window.focus();
    return window;
  }
  const closeAll = () => {
    for (const group of [...groups])
      for (const window of [...group.windows]) window.close();
  };
  return { open, closeAll };
}
module.exports = { createPrivateWindows, privateKeyAction, allowedPrivateURL };
