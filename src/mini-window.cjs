"use strict";
// A small floating window for a quick look, like Little Arc. It holds one page
// outside the workspace until the user moves it into a tab.
const path = require("node:path");
const SHELL_HEIGHT = 44;
const INSET = 6;
const EDIT_KEYS = new Set(["c", "v", "x", "a", "z", "q", "h", "m", "`"]);
// The app menu acts on the main window, so its shortcuts must stop here.
function miniKeyAction(input) {
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
  return EDIT_KEYS.has(key) ? "pass" : "block";
}
function createMiniWindows(deps) {
  const { BrowserWindow, WebContentsView, ipcMain, nativeTheme } = deps.electron;
  const minis = new Map();
  ipcMain.handle("mini:action", (event, name, value) => {
    const mini = minis.get(event.sender.id);
    if (!mini) throw Error("Unknown mini window.");
    return mini.run(String(name), value);
  });
  function open({ url, spaceId }) {
    const window = new BrowserWindow({
      width: 520,
      height: 720,
      minWidth: 360,
      minHeight: 300,
      title: "Mini Wing",
      titleBarStyle: "hiddenInset",
      trafficLightPosition: { x: 14, y: 15 },
      backgroundColor: nativeTheme.shouldUseDarkColors ? "#1d1d22" : "#ecebf1",
      webPreferences: {
        preload: path.join(__dirname, "mini-preload.cjs"),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    const shell = window.webContents;
    let view, page;
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
      window.setTitle(
        current === "about:blank" ? "Mini Wing" : page.getTitle() || "Mini Wing",
      );
      shell.send("mini:state", {
        url: current === "about:blank" ? "" : current,
        canGoBack: page.navigationHistory.canGoBack(),
        canGoForward: page.navigationHistory.canGoForward(),
        loading: page.isLoading(),
        spaces: deps.spaces(),
        spaceId,
      });
    };
    const mini = {
      run(name, value) {
        if (name === "ready") return publish();
        if (name === "back") page.navigationHistory.goBack();
        else if (name === "forward") page.navigationHistory.goForward();
        else if (name === "reload") page.reload();
        else if (name === "navigate") {
          const next = deps.resolve(String(value || ""));
          if (deps.allowedWeb(next)) page.loadURL(next).catch(() => {});
        } else if (name === "space") {
          // A page cannot change session, so reopen it under the new profile.
          if (!deps.spaces().some((s) => s.id === value)) return;
          const current = page.getURL();
          spaceId = value;
          attachPage(current);
          publish();
        } else if (name === "expand") {
          const current = page.getURL();
          if (deps.allowedWeb(current) && current !== "about:blank")
            deps.openInTab(current, spaceId);
          else deps.focusMain();
          window.close();
        }
      },
    };
    minis.set(shell.id, mini);
    const onKey = (event, input) => {
      const key = miniKeyAction(input);
      if (key === "pass") return;
      event.preventDefault();
      if (key === "close") window.close();
      else if (key === "address") {
        shell.focus();
        shell.send("mini:focus-address");
      } else if (key === "reload") page.reload();
      else if (key !== "block") mini.run(key);
    };
    shell.on("before-input-event", onKey);
    function attachPage(target) {
      if (view) {
        window.contentView.removeChildView(view);
        page.close();
      }
      view = new WebContentsView({
        webPreferences: {
          session: deps.sessionForSpace(spaceId),
          sandbox: true,
          contextIsolation: true,
        },
      });
      page = view.webContents;
      view.setBorderRadius?.(10);
      window.contentView.addChildView(view);
      layout();
      page.on("before-input-event", onKey);
      page.setUserAgent(deps.userAgent(page.getUserAgent()));
      page.setWindowOpenHandler(({ url: target }) => {
        if (deps.allowedWeb(target)) deps.openInTab(target, spaceId);
        return { action: "deny" };
      });
      page.on("will-navigate", (event, target) => {
        if (!deps.allowedWeb(target)) event.preventDefault();
      });
      page.on("did-navigate", (_event, target) => {
        if (deps.allowedWeb(target) && target !== "about:blank")
          deps.recordVisit(target, page.getTitle(), spaceId);
        publish();
      });
      for (const name of [
        "did-navigate-in-page",
        "did-start-loading",
        "did-stop-loading",
        "page-title-updated",
      ])
        page.on(name, publish);
      page.loadURL(target || "about:blank").catch(() => {});
    }
    window.on("resize", layout);
    window.once("closed", () => {
      minis.delete(mini.shellId);
      if (!page.isDestroyed()) page.close();
    });
    mini.shellId = shell.id;
    attachPage(url);
    shell.loadFile(path.join(__dirname, "mini.html"));
    if (!url)
      shell.once("did-finish-load", () => {
        shell.focus();
        shell.send("mini:focus-address");
      });
    window.focus();
    return window;
  }
  const closeAll = () => {
    for (const window of BrowserWindow.getAllWindows())
      if (window.getTitle && window.webContents && minis.has(window.webContents.id))
        window.close();
  };
  return { open, closeAll };
}
module.exports = { createMiniWindows, miniKeyAction };
