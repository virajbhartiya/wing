const {
  app,
  BrowserWindow,
  WebContentsView,
  ipcMain,
  nativeTheme,
  Menu,
  session,
  dialog,
  crashReporter,
  clipboard,
  shell,
  nativeImage,
  safeStorage,
  autoUpdater,
} = require("electron");
const DevTools = require("./dev-tools.cjs");
const { fetchPullRequests, toolError } = require("./pull-requests.cjs");
const { createMiniWindows } = require("./mini-window.cjs");
const { applyAppIcon } = require("./app-icons.cjs");
// Local development servers commonly use self-signed certificates.
app.commandLine.appendSwitch("allow-insecure-localhost");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const M = require("./model.cjs");
const Navigation = require("./navigation.cjs");
const { createBrowserFeatures } = require("./browser-features.cjs");
const { createPrivateWindows } = require("./private-window.cjs");
const I = require("./interactions.cjs");
const RecentTabs = require("./recent-tabs.cjs");
const recentTabs = new RecentTabs.TabSwitcher();
const { ExtensionManager } = require("./extensions.cjs");
const { WorkspaceStore } = require("./storage.cjs");
const { evictionCandidates, coalescer } = require("./lifecycle.cjs");
const WebStore = require("./web-store.cjs");
const { UpdateController } = require("./updates.cjs");
const ProfileImport = require("./profile-import.cjs");
const { importProfile } = require("./import-controller.cjs");
const { PasswordVault, fillScript } = require("./password-vault.cjs");
app.setName("Wing");
if (process.env.WING_DATA_DIR)
  app.setPath("userData", path.resolve(process.env.WING_DATA_DIR));
const statePath = path.join(app.getPath("userData"), "workspace.json");
const workspaceStore = new WorkspaceStore(statePath);
const passwordVault = new PasswordVault(
  path.join(app.getPath("userData"), "password-vault"),
  safeStorage,
);
let browserImportBusy = false;
let webStoreBusy = false;
const updateController = new UpdateController({
  updater: autoUpdater,
  app,
  config: require("./release-config.json"),
  onStatus: (status) => sendCommand({ type: "update-status", status }),
});

let state = M.initialState();
try {
  if (fs.existsSync(statePath))
    state = M.validateState(JSON.parse(fs.readFileSync(statePath, "utf8")));
} catch (error) {
  console.error("Workspace could not be loaded:", error.message);
  try {
    fs.copyFileSync(statePath, statePath + ".recovery-" + Date.now());
  } catch {}
}
let win,
  overlay = false,
  splitId = null,
  splitRatio = 0.5,
  splitReversed = false,
  sidebarRevealed = false,
  peek = null,
  saveTimer;
let memoryTimer,
  publishCount = 0;
const navigationCache = new Map();
const mountedViews = new Set();
const views = new Map(),
  configuredSessions = new Set(),
  downloads = [],
  runtime = new Map();
const shellURL = pathToFileURL(path.join(__dirname, "index.html")).href;
const features = createBrowserFeatures({
  state: () => state, window: () => win, contents: activeContents, tab: activeTab,
  profile: profileOf, session: sessionFor, publish, send: sendCommand, layout,
  downloads, navigate, activate: id => M.activate(state, id), closeTab,
  resetViews: () => [...views.keys()].forEach(closeView),
  permissionGranted: (wc, permission) => {
    const id = tabForContents(wc);
    if (id && permission === "media") runtime.set(id, { ...runtime.get(id), capturing: true });
  },
});
for (const record of state.downloadHistory || []) downloads.push({ ...record, status: record.status === "progressing" ? "interrupted" : record.status });

function profileOf(tab = activeTab()) {
  return (
    M.spaceOf(state, tab)?.profileId ||
    state.spaces.find((s) => s.id === state.activeSpaceId)?.profileId ||
    "default"
  );
}
function tabForContents(wc) {
  return [...views].find(([, view]) => view.webContents === wc)?.[0];
}
const extensionManager = new ExtensionManager({
  registryPath: path.join(app.getPath("userData"), "extensions.json"),
  getSession: (profile) => session.fromPartition("persist:wing-" + profile),
  createTab: async (profile, details) => {
    const space =
      state.spaces.find(
        (s) => s.id === state.activeSpaceId && s.profileId === profile,
      ) || state.spaces.find((s) => s.profileId === profile);
    if (!space) throw Error("Extension profile has no Space");
    const tab = openTab(details.url || "about:blank", space.id, {
      background: details.active === false,
    });
    const view = ensureView(tab);
    return [view.webContents, win];
  },
  selectTab: (_profile, contents) => {
    const id = tabForContents(contents);
    if (id) action("select-tab", { id });
  },
  removeTab: (_profile, contents) => {
    const id = tabForContents(contents);
    if (id) closeTab(id);
  },
  requestPermissions: async (_profile, extension, permissions) => {
    const response = await dialog.showMessageBox(win, {
      type: "question",
      message: `Allow additional access for ${extension.name}?`,
      detail: JSON.stringify(permissions, null, 2),
      buttons: ["Don’t allow", "Allow"],
      defaultId: 0,
      cancelId: 0,
    });
    return response.response === 1;
  },
});

function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 250);
}
function saveNow() {
  workspaceStore.write(state).catch((e) => {
    console.error("Save failed", e);
    sendCommand({
      type: "toast",
      message: "Workspace could not be saved. Check disk space.",
    });
  });
}

function activeTab() {
  return state.tabs.find((t) => t.id === state.activeTabId);
}
function activeContents() {
  return peek?.view.webContents || views.get(state.activeTabId)?.webContents;
}
function sendCommand(command) {
  if (win && !win.isDestroyed()) win.webContents.send("wing:command", command);
}
function snapshot(full = false) {
  const { archive, history, ...core } = state;
  const split = M.splits.groupFor(state);
  const splitIds = M.splits.visibleIds(state);
  return {
    liveTabCount: views.size,
    ...core,
    ...(full ? { archive, history } : {}),
    tabs: state.tabs.map((t) => ({ ...t, ...runtime.get(t.id) })),
    splitId: splitIds.find(id => id !== state.activeTabId) || null,
    splitIds,
    splitWeights: split ? splitIds.map(id => split.weights[split.tabIds.indexOf(id)]) : [1],
    splitRatio: split?.weights[0] ?? splitRatio,
    splitReversed: false,
    splitOrientation: split?.orientation || state.settings.splitOrientation || "horizontal",
    sidebarRevealed,
    sidebarRevealProgress,
    sidebarRevealSequence,
    sidebarRevealFrame,
    sidebarRevealAnimating,
    peek: peek
      ? { url: peek.url, title: peek.view.webContents.getTitle() || "Peek" }
      : null,
    downloads,
    versions: process.versions,
    extensionPartition: "persist:wing-" + profileOf(),
    extensionTabId: activeContents()?.id || null,
  };
}
const publisher = coalescer(() => {
  if (win && !win.isDestroyed()) {
    publishCount++;
    win.webContents.send("wing:state", snapshot());
  }
}, 16);
function publish(persist = true) {
  publisher.schedule();
  if (persist) save();
}
function trimMemory() {
  const entries = [...views].map(([id, view]) => ({
    id,
    lastActive: state.tabs.find((t) => t.id === id)?.lastActive || 0,
    audible: view.webContents.isCurrentlyAudible(),
    loading: view.webContents.isLoading(),
    ...runtime.get(id),
  }));
  evictionCandidates(entries, {
    activeIds: M.splits.visibleIds(state),
    maxLive: state.settings.maxLiveTabs || 8,
  }).forEach((id) => {
    const wc = views.get(id).webContents;
    try {
      const all = wc.navigationHistory.getAllEntries(),
        active = wc.navigationHistory.getActiveIndex(),
        start = Math.max(0, active - 20),
        entries = all.slice(start, active + 10);
      navigationCache.set(id, { entries, index: active - start });
      if (navigationCache.size > 64)
        navigationCache.delete(navigationCache.keys().next().value);
    } catch {}
    closeView(id);
    runtime.set(id, { sleeping: true });
  });
}
function forgetView(tabId) {
  closeView(tabId);
  navigationCache.delete(tabId);
  runtime.delete(tabId);
}
function detachView(view) {
  if (mountedViews.has(view)) {
    win?.contentView.removeChildView(view);
    mountedViews.delete(view);
  }
  view.setVisible(false);
}
function mountView(view) {
  if (!mountedViews.has(view)) {
    win.contentView.addChildView(view);
    mountedViews.add(view);
  }
  view.setVisible(true);
}
function closeView(tabId) {
  const view = views.get(tabId);
  if (!view) return;
  detachView(view);
  view.wingCleanup?.();
  views.delete(tabId); // Remove first: adapter removal also invokes our remove callback.
  extensionManager.removeTab(
    profileOf(state.tabs.find((t) => t.id === tabId)),
    view.webContents,
  );
  view.webContents.close();
  runtime.delete(tabId);
}
const privateWindows = createPrivateWindows({
  electron: {
    BrowserWindow,
    WebContentsView,
    ipcMain,
    session,
    Menu,
    clipboard,
  },
  resolve: (input) =>
    M.normalizeURL(
      Navigation.resolveInput(input, state.settings),
      state.settings.search === "duckduckgo"
        ? "https://duckduckgo.com/?q="
        : undefined,
    ),
  userAgent: (agent) =>
    agent.replace(/\sElectron\/\S+/g, "").replace(/\swing-browser\/\S+/gi, ""),
});
function sessionFor(profileId) {
  const partition = "persist:wing-" + profileId,
    ses = session.fromPartition(partition);
  if (configuredSessions.has(partition)) return ses;
  configuredSessions.add(partition);
  extensionManager.configure(profileId);
  extensionManager
    .restore(profileId)
    .catch((error) => console.error("Extension restore:", error.message));
  features.configureSession(profileId, ses);
  return ses;
}
function hostName(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "New Tab";
  }
}
function allowedWeb(url) {
  try {
    const parsed = new URL(url);
    return (
      ["http:", "https:"].includes(parsed.protocol) ||
      url === "about:blank" ||
      (parsed.protocol === "chrome-extension:" &&
        /^[a-p]{32}$/.test(parsed.hostname))
    );
  } catch {
    return false;
  }
}
function faviconURL(value) {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      url.href.length <= 4096
      ? url.href
      : null;
  } catch {
    return null;
  }
}
function clearTabFaviconForNavigation(tab, nextURL) {
  try {
    if (new URL(tab.url).origin === new URL(nextURL).origin) return;
  } catch {}
  delete tab.favicon;
  delete tab.faviconOrigin;
  const live = runtime.get(tab.id);
  if (live) delete live.favicon;
}
function wireContents(view, tab, isPeek = false) {
  view.wingCleanup?.();
  const wc = view.webContents,
    listeners = [];
  const on = (name, listener) => {
    wc.on(name, listener);
    listeners.push([name, listener]);
  };
  view.wingCleanup = () => {
    for (const [name, listener] of listeners) wc.removeListener(name, listener);
  };
  wc.setUserAgent(
    wc
      .getUserAgent()
      .replace(/\sElectron\/\S+/g, "")
      .replace(/\swing-browser\/\S+/gi, ""),
  );
  const update = () => {
    if (wc.isDestroyed()) return;
    if (isPeek) {
      if (peek?.view === view) peek.url = wc.getURL() || peek.url;
      publish(false);
      return;
    }
    const current = state.tabs.find((t) => t.id === tab.id);
    if (!current) return;
    const previousURL = current.url,
      previousTitle = current.title;
    const url = wc.getURL();
    if (allowedWeb(url)) {
      clearTabFaviconForNavigation(current, url);
      current.url = url;
    }
    if (wc.getTitle())
      current.title = current.customTitle || wc.getTitle().slice(0, 300);
    runtime.set(tab.id, {
      ...(runtime.get(tab.id) || {}),
      loading: wc.isLoading(),
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward(),
      audible: wc.isCurrentlyAudible(),
      muted: wc.isAudioMuted(),
    });
    publish(current.url !== previousURL || current.title !== previousTitle);
  };
  on("did-start-loading", update);
  on("did-stop-loading", update);
  on("page-title-updated", update);
  on("did-navigate-in-page", update);
  on("media-started-playing", update);
  on("media-paused", update);
  on("page-favicon-updated", (_e, urls) => {
    if (isPeek) return;
    update();
    const current = state.tabs.find((t) => t.id === tab.id);
    const favicon = urls.map(faviconURL).find(Boolean);
    if (!current || !favicon) return;
    const origin = new URL(current.url).origin;
    if (current.favicon !== favicon || current.faviconOrigin !== origin) {
      current.favicon = favicon;
      current.faviconOrigin = origin;
      publish();
    }
  });
  on("did-navigate", (_e, url) => {
    if (!isPeek && allowedWeb(url)) {
      state.history.unshift({
        id: M.id(),
        url,
        title: wc.getTitle() || new URL(url).hostname,
        at: Date.now(),
        profileId: M.spaceOf(state, tab)?.profileId,
      });
      state.history = state.history.slice(0, 2000);
      runtime.set(tab.id, {
        ...runtime.get(tab.id),
        error: null,
        hasInput: false,
      });
    }
    update();
  });
  on("did-finish-load", () => {
    applyBoost(wc);
    update();
  });
  on("did-fail-load", (_e, code, description, url, isMainFrame) => {
    if (code === -3 || !isMainFrame) return;
    if (!isPeek) {
      runtime.set(tab.id, {
        ...runtime.get(tab.id),
        error: `${description} (${code})`,
        loading: false,
      });
      layout();
      publish(false);
    }
  });
  on("render-process-gone", () => {
    if (!isPeek) {
      runtime.set(tab.id, {
        error: "This page stopped responding. Reload to try again.",
      });
      layout();
      publish(false);
    }
  });
  on("will-navigate", (event, url) => {
    if (!allowedWeb(url)) {
      event.preventDefault();
      return;
    }
    if (
      !isPeek &&
      tab.kind !== "today" &&
      state.settings.peekPinned !== false
    ) {
      try {
        if (new URL(url).hostname !== new URL(tab.homeURL).hostname) {
          event.preventDefault();
          openPeek(url, tab);
        }
      } catch {}
    }
  });
  on("will-redirect", (event, url) => {
    if (!allowedWeb(url)) event.preventDefault();
  });
  wc.setWindowOpenHandler(({ url, disposition }) => {
    if (allowedWeb(url)) {
      if (disposition === "new-window") openPeek(url, tab);
      else
        openTab(url, tab.spaceId, {
          background: disposition === "background-tab",
        });
    }
    return { action: "deny" };
  });
  on("context-menu", (_event, params) => {
    const entries = [];
    if (allowedWeb(params.linkURL))
      entries.push(
        {
          label: "Open Link in New Tab",
          click: () => openTab(params.linkURL, tab.spaceId),
        },
        {
          label: "Open Link in Peek",
          click: () => openPeek(params.linkURL, tab),
        },
        {
          label: "Open Link in Split View",
          click: () => {
            const t = openTab(params.linkURL, tab.spaceId, {
              background: true,
            });
            action("split", { id: t.id, targetId: tab.id });
          },
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
      );
    else if (params.selectionText)
      entries.push(
        { role: "copy" },
        {
          label: "Search Selection",
          click: () =>
            openTab(M.normalizeURL(params.selectionText), tab.spaceId),
        },
      );
    entries.push(
      { type: "separator" },
      {
        label: "Back",
        enabled: wc.navigationHistory.canGoBack(),
        click: () => wc.navigationHistory.goBack(),
      },
      { label: "Reload", click: () => wc.reload() },
      {
        label: "Inspect Element",
        click: () => wc.inspectElement(params.x, params.y),
      },
    );
    const extensionItems = extensionManager.getContextMenuItems(
      profileOf(tab),
      wc,
      params,
    );
    if (extensionItems.length)
      entries.push({ type: "separator" }, ...extensionItems);
    Menu.buildFromTemplate(entries).popup({ window: win });
  });
  on("before-input-event", (event, input) => {
    if (handleRecentTabsInput(event, input)) return;
    if (input.type !== "keyDown") return;
    if (
      !isPeek &&
      !input.control &&
      !input.meta &&
      (input.key.length === 1 || input.key === "Backspace")
    )
      runtime.set(tab.id, { ...runtime.get(tab.id), hasInput: true });
    if (input.key === "Escape" && peek) {
      event.preventDefault();
      closePeek();
    }
  });
  on("focus", () => {
    if (!isPeek && M.splits.visibleIds(state).includes(tab.id) && tab.id !== state.activeTabId) {
      M.activate(state, tab.id);
      splitId = M.splits.visibleIds(state).find(id => id !== tab.id) || null;
      publish();
    }
  });
}
function ensureView(tab) {
  if (!tab || M.isShellPage(tab.url)) return null;
  if (views.has(tab.id)) return views.get(tab.id);
  const view = new WebContentsView({
    webPreferences: {
      session: sessionFor(M.spaceOf(state, tab)?.profileId || "default"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      safeDialogs: true,
    },
  });
  views.set(tab.id, view);
  extensionManager.addTab(profileOf(tab), view.webContents, win);
  view.setBorderRadius(12);
  view.setVisible(false);
  wireContents(view, tab);
  const cached = navigationCache.get(tab.id);
  navigationCache.delete(tab.id);
  if (cached)
    view.webContents.navigationHistory
      .restore(cached)
      .catch(() => {
        // A restore can reject after close/sleep has released this native view.
        // Only the still-owned, live instance may perform fallback navigation.
        const contents = view.webContents;
        if (views.get(tab.id) !== view || !contents || contents.isDestroyed()) return;
        return contents.loadURL(tab.url).catch(() => {});
      });
  else view.webContents.loadURL(tab.url).catch(() => {});
  runtime.set(tab.id, { ...runtime.get(tab.id), sleeping: false });
  return view;
}
const sidebarRevealMotion = I.createSidebarRevealMotion({
  initial: state.sidebarHidden ? 0 : 1,
});
let sidebarRevealProgress = state.sidebarHidden ? 0 : 1;
let sidebarRevealSequence = 0,
  sidebarRevealFrame = 0,
  sidebarRevealTimer = null,
  sidebarRevealAnimating = false;
function sidebarTarget() {
  return I.sidebarVisible({
    hidden: state.sidebarHidden,
    revealed: sidebarRevealed,
  })
    ? 1
    : 0;
}
function sendSidebarFrame() {
  sendCommand({
    type: "sidebar-frame",
    progress: sidebarRevealProgress,
    sequence: sidebarRevealSequence,
    frame: ++sidebarRevealFrame,
    animating: sidebarRevealAnimating,
    hidden: state.sidebarHidden,
    revealed: sidebarRevealed,
  });
}
function animateSidebarReveal(animate) {
  clearInterval(sidebarRevealTimer);
  sidebarRevealSequence++;
  let frame = sidebarRevealMotion.start({
    to: sidebarTarget(),
    time: performance.now(),
    animate,
  });
  sidebarRevealProgress = frame.progress;
  sidebarRevealAnimating = frame.active;
  layout();
  sendSidebarFrame();
  if (!frame.active) return;
  sidebarRevealTimer = setInterval(() => {
    if (!win || win.isDestroyed()) {
      clearInterval(sidebarRevealTimer);
      return;
    }
    frame = sidebarRevealMotion.sample(performance.now());
    sidebarRevealProgress = frame.progress;
    sidebarRevealAnimating = frame.active;
    layout();
    sendSidebarFrame();
    if (!frame.active) {
      clearInterval(sidebarRevealTimer);
      publish(false);
    }
  }, 16);
}
const dev = (tool, value) => action("dev", { tool, value });
const FORGE_PATH = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin";
const runForgeTool = (tool, args) =>
  new Promise((resolve, reject) =>
    require("node:child_process").execFile(
      tool,
      args,
      {
        timeout: 20000,
        maxBuffer: 20 * 1024 * 1024,
        env: { ...process.env, PATH: `${process.env.PATH || ""}:${FORGE_PATH}` },
      },
      (error, stdout, stderr) =>
        error
          ? reject(toolError({ missing: error.code === "ENOENT", stderr }))
          : resolve(stdout),
    ),
  );
const showMain = () => {
  if (win && !win.isDestroyed()) {
    win.show();
    win.focus();
  }
};
const miniWindows = createMiniWindows({
  electron: { BrowserWindow, WebContentsView, ipcMain, nativeTheme },
  spaces: () =>
    state.spaces.map(({ id, name, icon }) => ({ id, name, icon })),
  sessionForSpace: (spaceId) =>
    sessionFor(
      (state.spaces.find((s) => s.id === spaceId) || currentSpaceOf()).profileId,
    ),
  allowedWeb,
  resolve: (input) =>
    M.normalizeURL(
      Navigation.resolveInput(input, state.settings),
      state.settings.search === "duckduckgo"
        ? "https://duckduckgo.com/?q="
        : undefined,
    ),
  userAgent: (agent) =>
    agent.replace(/\sElectron\/\S+/g, "").replace(/\swing-browser\/\S+/gi, ""),
  openInTab: (url, spaceId) => {
    openTab(url, state.spaces.some((s) => s.id === spaceId) ? spaceId : undefined);
    showMain();
  },
  focusMain: showMain,
  recordVisit: (url, title, spaceId) => {
    state.history.unshift({
      id: M.id(),
      url,
      title: title || new URL(url).hostname,
      at: Date.now(),
      profileId: state.spaces.find((s) => s.id === spaceId)?.profileId,
    });
    state.history = state.history.slice(0, 2000);
    save();
  },
});
function openMini(url, spaceId = state.activeSpaceId) {
  const space = state.spaces.find((s) => s.id === spaceId) || currentSpaceOf();
  return miniWindows.open({ url, spaceId: space.id });
}
const currentSpaceOf = () =>
  state.spaces.find((s) => s.id === state.activeSpaceId) || state.spaces[0];
function layout() {
  if (!win || win.isDestroyed()) return;
  const [width, height] = win.getContentSize();
  // Other actions (profile changes, import) can revoke a transient reveal.
  if (sidebarRevealMotion.target !== sidebarTarget()) {
    clearInterval(sidebarRevealTimer);
    sidebarRevealSequence++;
    sidebarRevealProgress = sidebarRevealMotion.start({
      to: sidebarTarget(),
      time: performance.now(),
      animate: false,
    }).progress;
    sidebarRevealAnimating = false;
    sendSidebarFrame();
  }
  const left = I.sidebarRevealLeft({
    width: state.settings.sidebarWidth,
    progress: sidebarRevealProgress,
  });
  M.splits.reconcile(state);
  const ids = M.splits.visibleIds(state);
  const group = M.splits.groupFor(state);
  splitId = ids.find(id => id !== state.activeTabId) || null;
  splitReversed = false;
  if (group) splitRatio = group.weights[0];
  const visibleIds = new Set(overlay || peek ? [] : ids);
  for (const [id, view] of views) if (!visibleIds.has(id)) detachView(view);
  if (overlay) {
    if (peek) detachView(peek.view);
    return;
  }
  const frame = M.splits.frame(state.settings, left);
  const gap = 8, available = width - frame.left - 8;
  const weights = group ? ids.map(id => group.weights[group.tabIds.indexOf(id)]) : [1];
  const panes = M.splits.bounds({ width, height, left: frame.left, top: frame.top, margin: frame.margin, gap, weights,
    orientation: group?.orientation || state.settings.splitOrientation });
  ids.forEach((tabId, index) => {
    const tab = state.tabs.find(t => t.id === tabId), view = ensureView(tab);
    if (!view || runtime.get(tabId)?.error) return;
    const bounds = panes[index];
    if (JSON.stringify(view.getBounds()) !== JSON.stringify(bounds)) view.setBounds(bounds);
    if (!peek) mountView(view);
  });
  if (peek) {
    const x = frame.left + 32,
      y = state.settings.tabLayout === "top" ? 136 : 100,
      w = Math.max(1, available - 64),
      h = Math.max(1, height - 140);
    peek.view.setBounds({ x, y, width: w, height: h });
    mountView(peek.view);
  }
}
function openTab(
  url,
  spaceId = state.activeSpaceId,
  { background = false } = {},
) {
  const tab = M.newTab(
    spaceId,
    M.normalizeURL(
      Navigation.resolveInput(url, state.settings),
      state.settings.search === "duckduckgo"
        ? "https://duckduckgo.com/?q="
        : undefined,
    ),
  );
  state.tabs.push(tab);
  if (!background) {
    closeOverlay(false);
    closePeek(false);
    splitId = null;
    M.activate(state, tab.id);
  }
  layout();
  publish();
  return tab;
}
function closePeek(notify = true) {
  if (peek) {
    detachView(peek.view);
    peek.view.wingCleanup?.();
    peek.view.webContents.close();
    peek = null;
  }
  if (notify) {
    layout();
    publish(false);
  }
}
function openPeek(url, from = activeTab()) {
  if (!allowedWeb(url)) return;
  closePeek(false);
  const tab = from || { spaceId: state.activeSpaceId };
  const view = new WebContentsView({
    webPreferences: {
      session: sessionFor(M.spaceOf(state, tab)?.profileId || "default"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      safeDialogs: true,
    },
  });
  view.setBorderRadius(8);
  peek = { view, url, spaceId: tab.spaceId };
  wireContents(view, tab, true);
  closeOverlay(false);
  view.webContents.loadURL(url).catch(() => {});
  layout();
  publish(false);
}
function closeTab(tabId, { archive = false } = {}) {
  if (peek && !archive) {
    closePeek();
    return;
  }
  const result = M.closePage(state, tabId, { archive });
  if (!result) return;
  if (!result.retained && M.splits) M.splits.removeTab(state, tabId);
  closeView(tabId);
  runtime.delete(tabId);
  navigationCache.delete(tabId);
  if (splitId === tabId || splitId === state.activeTabId) splitId = null;
  layout();
  publish();
}
async function applyBoost(wc) {
  try {
    const origin = new URL(wc.getURL()).origin,
      css = state.boosts[origin];
    if (css) await wc.insertCSS(css);
  } catch {}
}
const overlayBackdrop = new (require("./overlay.cjs").OverlayBackdrop)({
  capture: async () => {
    const visible = [...mountedViews].filter(
      (view) => !view.webContents.isDestroyed(),
    );
    return Promise.all(
      visible.map(async (view) => {
        const bounds = view.getBounds();
        try {
          let image = await require("./overlay.cjs").capturePageBounded(
            view.webContents,
          );
          if (image.isEmpty()) throw Error("Empty page preview");
          const size = image.getSize();
          const scale = Math.min(1, 1600 / size.width, 1000 / size.height);
          if (scale < 1)
            image = image.resize({
              width: Math.max(1, Math.round(size.width * scale)),
              height: Math.max(1, Math.round(size.height * scale)),
            });
          return {
            bounds,
            image:
              "data:image/jpeg;base64," + image.toJPEG(85).toString("base64"),
          };
        } catch {
          // Loading/crashed/protected surfaces may not have a capturable frame.
          // Keep the palette usable, with an explicit preview placeholder.
          return { bounds, fallback: true };
        }
      }),
    );
  },
  commit: () => {
    overlay = true;
    layout();
  },
  release: () => {
    overlay = false;
  },
});
function prepareOverlay() {
  return overlayBackdrop.prepare();
}
function closeOverlay(relayout = true) {
  overlayBackdrop.close();
  if (win && !win.isDestroyed())
    win.webContents.send("wing:overlay", {
      type: "clear",
      token: overlayBackdrop.generation,
      handoff: relayout,
    });
  if (relayout) layout();
}
function ui(type, extra = {}) {
  if (recentTabs.active) finishRecentTabs(false);
  // The renderer prepares and decodes a page backdrop before hiding native views.
  win.webContents.focus();
  sendCommand({ type, ...extra });
}
function tabMenu(tabId) {
  const tab = state.tabs.find((t) => t.id === tabId);
  if (!tab) return;
  const entries = [
    {
      label: "Rename Tab…",
      click: () => ui("rename", { id: tabId, value: tab.title }),
    },
    {
      label: tab.kind === "pinned" ? "Unpin Tab" : "Pin Tab",
      click: () => action("pin", {id:tabId}),
    },
    {
      label:
        tab.kind === "favorite" ? "Remove from Favorites" : "Add to Favorites",
      click: () => action("favorite", { id: tabId }),
    },
    {
      label: "Reset to Pinned Address",
      enabled: tab.kind !== "today",
      click: () => {
        M.activate(state, tabId);
        navigate(tab.homeURL, tabId);
      },
    },
    { type: "separator" },
    {
      label: "Open in Split View",
      enabled: tab.id !== state.activeTabId && tab.url !== "wing://home",
      click: () => action("split", { id: tab.id }),
    },
    {
      label: "Preview in Peek",
      enabled: allowedWeb(tab.url),
      click: () => openPeek(tab.url, tab),
    },
    { label: "Duplicate Tab", click: () => openTab(tab.url, tab.spaceId) },
    {
      label: "Move to Space",
      submenu: state.spaces.map((s) => ({
        label: s.name,
        click: () => {
          M.splits.members(state, tab.id).forEach(member => forgetView(member.id));
          M.moveTab(state, tab.id, s.id);
          splitId = null;
          layout();
          publish();
        },
      })),
    },
    {
      label: "Move to Folder",
      submenu: [
        {
          label: "No Folder",
          click: () => {
            M.splits.members(state, tab.id).forEach(member => member.folderId = null);
            publish();
          },
        },
        ...state.folders
          .filter((f) => f.spaceId === tab.spaceId)
          .map((f) => ({
            label: f.name,
            click: () => {
              M.moveTab(state, tab.id, tab.spaceId, f.id);
              publish();
            },
          })),
      ],
    },
    {
      label: "Mute / Unmute",
      click: () => {
        const wc = views.get(tabId)?.webContents;
        if (wc) {
          wc.setAudioMuted(!wc.isAudioMuted());
          runtime.set(tabId, {
            ...runtime.get(tabId),
            muted: wc.isAudioMuted(),
          });
          publish(false);
        }
      },
    },
    { type: "separator" },
    { label: tab.kind === "today" ? "Archive Tab" : "Close Page", click: () => action("close-tab", {id:tabId}) },
    ...(tab.kind === "today" ? [] : [{
      label: tab.kind === "favorite" ? "Archive Favorite" : "Archive Pinned Tab",
      click: () => action("close-tab", {id:tabId,archive:true}),
    }]),
  ];
  Menu.buildFromTemplate(entries).popup({ window: win });
}
function navigate(input, tabId = state.activeTabId) {
  closeOverlay(false);
  const url = M.normalizeURL(
      Navigation.resolveInput(input, state.settings),
      state.settings.search === "duckduckgo"
        ? "https://duckduckgo.com/?q="
        : undefined,
    ),
    tab = state.tabs.find((t) => t.id === tabId);
  if (!tab) return openTab(url);
  runtime.delete(tab.id);
  clearTabFaviconForNavigation(tab, url);
  tab.url = url;
  if (M.isShellPage(url)) closeView(tab.id);
  else {
    const view = views.get(tab.id);
    if (view) view.webContents.loadURL(url).catch(() => {});
    else ensureView(tab);
  }
  layout();
  publish();
}
async function action(name, data = {}) {
  if (["pin","favorite","move-tab","reorder-tab","rename-tab","folder"].includes(name)) features.journal.record(state);
  const tab = activeTab(),
    wc = activeContents();
  switch (name) {
    case "recent-tabs-preview":
      if (recentTabs.select(state, data.id)) publishRecentTabs();
      return { ok: true };
    case "recent-tabs-commit":
      if (!recentTabs.active) return { ok: false };
      if (data.id && !recentTabs.select(state, data.id)) return { ok: false };
      finishRecentTabs(true);
      return { ok: true };
    case "recent-tabs-cancel":
      if (!recentTabs.active) return { ok: false };
      finishRecentTabs(false);
      return { ok: true };
    case "recent-tabs-focus":
      if (!recentTabs.active) activeContents()?.focus();
      return { ok: true };
    case "state":
      return snapshot(true);
    case "browser-profiles":
      return { profiles: await ProfileImport.discoverProfiles() };
    case "browser-import": {
      if (browserImportBusy)
        throw Error("Another profile import is already running.");
      browserImportBusy = true;
      try {
        const source = await ProfileImport.resolveSource(String(data.source));
        const options = Object.fromEntries(
          ["bookmarks", "tabs", "history", "cookies", "passwords"].map((k) => [
            k,
            data.options?.[k] === true,
          ]),
        );
        if (!Object.values(options).some(Boolean))
          throw Error("Select at least one kind of data to import.");
        if (source.browser === "safari" && options.passwords) {
          const picked = await dialog.showOpenDialog(win, {
            title: "Choose the passwords you exported from the Passwords app",
            message:
              "Safari passwords can only be imported from a Passwords app CSV export. Cancel to skip them.",
            properties: ["openFile"],
            filters: [{ name: "CSV", extensions: ["csv"] }],
          });
          if (!picked.canceled) source.passwordsCsv = picked.filePaths[0];
        }
        const imported = await importProfile({
          source,
          options,
          state,
          getState: () => state,
          sessionFor,
          vault: passwordVault,
          persist: async (next) => {
            // Publish the new object before awaiting disk I/O: page navigation
            // events during the write must update the committed workspace.
            const before = state;
            const importedProfiles = new Set(
              next.profiles
                .filter((p) => !before.profiles.some((old) => old.id === p.id))
                .map((p) => p.id),
            );
            state = next;
            try {
              await workspaceStore.write(state);
            } catch (error) {
              const importedSpaces = new Set(
                state.spaces
                  .filter((s) => importedProfiles.has(s.profileId))
                  .map((s) => s.id),
              );
              state.profiles = state.profiles.filter(
                (p) => !importedProfiles.has(p.id),
              );
              state.spaces = state.spaces.filter(
                (s) => !importedSpaces.has(s.id),
              );
              state.tabs = state.tabs.filter(
                (t) => !importedSpaces.has(t.spaceId),
              );
              state.folders = state.folders.filter(
                (f) => !importedSpaces.has(f.spaceId),
              );
              state.history = state.history.filter(
                (h) => !importedProfiles.has(h.profileId),
              );
              if (importedSpaces.has(state.activeSpaceId))
                state.activeSpaceId = before.activeSpaceId;
              if (!state.tabs.some((t) => t.id === state.activeTabId))
                state.activeTabId = before.activeTabId;
              layout();
              publish(false);
              throw error;
            }
          },
        });
        closePeek(false);
        splitId = null;
        closeOverlay(false);
        sidebarRevealed = false;
        layout();
        publish(false);
        return { ok: true, report: imported.report };
      } finally {
        browserImportBusy = false;
      }
    }
    case "fill-login": {
      if (!wc || !wc.getURL().startsWith("https://"))
        throw Error("Open the HTTPS sign-in page first.");
      const origin = new URL(wc.getURL()).origin;
      const entries = (
        await passwordVault.forOrigin(profileOf(), origin)
      ).slice(0, 12);
      if (!entries.length)
        throw Error(
          "No imported passwords match this exact website in this profile.",
        );
      const choice = await dialog.showMessageBox(win, {
        type: "question",
        message: `Fill a saved login on ${origin}?`,
        detail:
          "Only this page receives the selected login. Wing will not submit the form.",
        buttons: [
          "Cancel",
          ...entries.map((e) => e.username || "Account without username"),
        ],
        defaultId: 0,
        cancelId: 0,
      });
      const selected = entries[choice.response - 1];
      if (!selected) return { ok: true };
      if (
        wc.isDestroyed() ||
        activeContents() !== wc ||
        new URL(wc.getURL()).origin !== origin
      )
        throw Error("The page changed. Select the login again.");
      const filled = await wc.executeJavaScriptInIsolatedWorld(999, [
        { code: fillScript(selected) },
      ]);
      if (!filled)
        throw Error(
          "No visible password field found. Open the site's password step and try again.",
        );
      return { ok: true };
    }
    case "updates-status":
      return updateController.status;
    case "updates-check":
      return updateController.check();
    case "updates-install": {
      await workspaceStore.write(state);
      updateController.install();
      return { ok: true };
    }
    case "extensions-store-install": {
      if (webStoreBusy)
        throw Error("An extension installation is already running.");
      webStoreBusy = true;
      const targetProfile = profileOf();
      let staged,
        installed = false;
      try {
        const id = WebStore.extensionId(String(data.url || ""));
        const existing = await extensionManager.list(targetProfile);
        if (existing.extensions.some((e) => e.id === id))
          throw Error("This extension is already installed in this profile.");
        staged = await WebStore.stageExtension(
          id,
          path.join(app.getPath("userData"), "store-extensions"),
          process.versions.chrome,
        );
        const permissions = [
          ...(staged.manifest.permissions || []),
          ...(staged.manifest.host_permissions || []),
        ];
        const choice = await dialog.showMessageBox(win, {
          type: "question",
          message: `Install ${staged.displayName || id}?`,
          detail: `Extension ID: ${id}\nVersion: ${staged.manifest.version}\n\nRequested access:\n${permissions.join("\n") || "No additional permissions"}\n\nThe package signature was verified. API compatibility varies; installation does not guarantee it works.`,
          buttons: ["Cancel", "Install extension"],
          defaultId: 0,
          cancelId: 0,
        });
        if (choice.response !== 1) return { ok: true, canceled: true };
        await extensionManager.install(targetProfile, staged.unpacked);
        installed = true;
        return { ok: true, id };
      } finally {
        if (staged && !installed)
          await fs.promises.rm(staged.directory, {
            recursive: true,
            force: true,
          });
        webStoreBusy = false;
      }
    }
    case "extensions-list":
      return extensionManager.list(profileOf());
    case "extensions-install": {
      const selected = await dialog.showOpenDialog(win, {
        title: "Load unpacked Chrome extension",
        properties: ["openDirectory"],
      });
      if (selected.canceled) return extensionManager.list(profileOf());
      const manifest = JSON.parse(
        await fs.promises.readFile(
          path.join(selected.filePaths[0], "manifest.json"),
          "utf8",
        ),
      );
      const permissions = [
        ...(manifest.permissions || []),
        ...(manifest.host_permissions || []),
      ];
      const accepted = await dialog.showMessageBox(win, {
        type: "question",
        message: `Install ${manifest.name || "extension"} in this profile?`,
        detail:
          "Requested access:\n" +
          (permissions.join("\n") || "No additional permissions") +
          "\n\nUnpacked extensions must stay in their source folder. Chrome Web Store installation and universal compatibility are not available.",
        buttons: ["Cancel", "Install extension"],
        defaultId: 0,
        cancelId: 0,
      });
      if (accepted.response === 1)
        await extensionManager.install(profileOf(), selected.filePaths[0]);
      return extensionManager.list(profileOf());
    }
    case "extensions-remove":
      return extensionManager.uninstall(profileOf(), String(data.id));
    case "library-data":
      return { archive: state.archive, history: state.history };
    case "overlay":
      if (!data.open) {
        closeOverlay();
        return { ok: true };
      }
      if (data.ready !== undefined)
        return { ok: overlayBackdrop.commit(data.ready) };
      return await prepareOverlay();
    case "new-tab":
      openTab(data.url || "wing://home");
      break;
    case "navigate":
      navigate(String(data.url || ""));
      break;
    case "select-tab": {
      if (!state.tabs.some((t) => t.id === data.id)) return { ok: true };
      closePeek(false);
      M.activate(state, data.id);
      splitId = M.splits.visibleIds(state).find(id => id !== state.activeTabId) || null;
      splitReversed = false;
      closeOverlay(false);
      layout();
      break;
    }
    case "close-tab": {
      const ids = M.splits.members(state, data.id || state.activeTabId).map(member => member.id);
      if (peek) closePeek();
      else for (const id of ids) closeTab(id, {archive:data.archive === true});
      break;
    }
    case "mute-tab": {
      const wc = views.get(data.id)?.webContents;
      if (wc && !wc.isDestroyed()) {
        wc.setAudioMuted(!wc.isAudioMuted());
        runtime.set(data.id, {
          ...runtime.get(data.id),
          muted: wc.isAudioMuted(),
        });
        publish(false);
      }
      break;
    }
    case "tab-menu":
      tabMenu(data.id);
      break;
    case "rename-tab": {
      const t = state.tabs.find((t) => t.id === data.id);
      if (t) {
        const group = M.splits.groupFor(state, t.id);
        if (group) group.title = String(data.value || t.title).slice(0,200);
        else t.title = t.customTitle = String(data.value || t.title).slice(0, 200);
      }
      break;
    }
    case "pin": {
      const selected = state.tabs.find(t => t.id === (data.id || state.activeTabId));
      if (selected) M.splits.setKind(state, selected.id, selected.kind === "today" ? "pinned" : "today");
      break;
    }
    case "favorite": {
      const favorite = state.tabs.find(t => t.id === (data.id || state.activeTabId));
      if (favorite) M.splits.setKind(state, favorite.id, favorite.kind === "favorite" ? "pinned" : "favorite");
      break;
    }
    case "move-tab":
      M.splits.members(state, data.id).forEach(member => forgetView(member.id));
      M.moveTab(
        state,
        data.id,
        data.spaceId || state.activeSpaceId,
        data.folderId,
      );
      splitId = null;
      layout();
      break;
    case "reorder-tab": {
      const moving = M.splits.members(state, data.id);
      if (data.end) {
        state.tabs = state.tabs.filter(tab => !moving.includes(tab));
        state.tabs.push(...moving);
        break;
      }
      const destination = M.splits.members(state, data.before)[0];
      if (destination && !moving.includes(destination)) {
        state.tabs = state.tabs.filter(tab => !moving.includes(tab));
        const index = state.tabs.findIndex(tab => tab.id === destination.id);
        state.tabs.splice(index, 0, ...moving);
      }
      break;
    }
    case "swipe-profile": {
      const next = I.nextProfileSpace(
        state.spaces,
        state.activeSpaceId,
        Number(data.direction),
      );
      if (next === state.activeSpaceId) return { ok: true };
      closePeek(false);
      splitId = null;
      // Keep the hover-revealed sidebar stable while the pointer is inside it.
      M.selectSpace(state, next);
      closeOverlay(false);
      layout();
      break;
    }
    case "space":
      closePeek(false);
      splitId = null;
      M.selectSpace(state, data.id);
      closeOverlay(false);
      layout();
      break;
    case "reorder-space":
      M.reorderSpace(state, data.id, data.before);
      break;
    case "emoji-panel":
      app.showEmojiPanel();
      return { ok: true };
    case "save-space": {
      const colors =
        data.colors === undefined
          ? undefined
          : M.normalizeCustomColors(data.colors);
      const name = String(data.name || "New Space")
          .trim()
          .slice(0, 60),
        theme = M.themes.includes(data.theme) ? data.theme : "lavender";
      let profileId = data.profileId;
      if (profileId === "new") {
        profileId = M.id();
        state.profiles.push({ id: profileId, name });
      }
      if (!state.profiles.some((p) => p.id === profileId))
        profileId = "default";
      // Home-only profiles still need their extension API session before the
      // shell's action list observes the new partition.
      sessionFor(profileId);
      const existing = state.spaces.find((s) => s.id === data.id);
      if (existing) {
        if (existing.profileId !== profileId)
          state.tabs
            .filter((t) => t.spaceId === existing.id)
            .forEach((t) => forgetView(t.id));
        Object.assign(existing, {
          name,
          theme,
          icon: M.spaceIcon(data.icon),
          profileId,
          ...(colors === undefined ? {} : { colors }),
        });
      } else {
        const s = {
          id: M.id(),
          name,
          theme,
          icon: M.spaceIcon(data.icon),
          profileId,
          ...(colors === undefined ? {} : { colors }),
        };
        state.spaces.push(s);
        M.selectSpace(state, s.id);
      }
      closeOverlay(false);
      splitId = null;
      layout();
      break;
    }
    case "delete-space": {
      if (state.spaces.length < 2) throw Error("Keep at least one Space");
      state.tabs
        .filter((t) => t.spaceId === data.id)
        .forEach((t) => {
          M.archiveTab(state, t.id);
          forgetView(t.id);
        });
      state.spaces = state.spaces.filter((s) => s.id !== data.id);
      state.folders = state.folders.filter((f) => f.spaceId !== data.id);
      M.selectSpace(state, state.spaces[0].id);
      splitId = null;
      closeOverlay(false);
      layout();
      break;
    }
    case "folder":
      state.folders.push({
        id: M.id(),
        spaceId: state.activeSpaceId,
        name: String(data.name || "Untitled").slice(0, 80),
        collapsed: false,
      });
      break;
    case "toggle-folder": {
      const f = state.folders.find((f) => f.id === data.id);
      if (f) f.collapsed = !f.collapsed;
      break;
    }
    case "folder-menu": {
      const f = state.folders.find((f) => f.id === data.id);
      if (f)
        Menu.buildFromTemplate([
          {
            label: "Remove Folder (keep tabs)",
            click: () => {
              state.tabs
                .filter((t) => t.folderId === f.id)
                .forEach((t) => (t.folderId = null));
              state.folders = state.folders.filter((x) => x.id !== f.id);
              publish();
            },
          },
        ]).popup({ window: win });
      break;
    }
    case "back":
      if (wc?.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
      break;
    case "forward":
      if (wc?.navigationHistory.canGoForward())
        wc.navigationHistory.goForward();
      break;
    case "reload":
      if (tab) {
        runtime.delete(tab.id);
        if (wc) wc.reload();
        else ensureView(tab);
        layout();
      }
      break;
    case "stop":
      wc?.stop();
      break;
    case "tab-layout":
      state.settings.tabLayout = data.layout === "sidebar" ? "sidebar" : "top";
      state.sidebarHidden = false;
      sidebarRevealed = false;
      animateSidebarReveal(false);
      break;
    case "sidebar":
      if (state.settings.tabLayout === "top") return action("tab-layout", { layout: "sidebar" });
      state.sidebarHidden = !state.sidebarHidden;
      sidebarRevealed = false;
      animateSidebarReveal(data.animate === true);
      break;
    case "sidebar-reveal":
      sidebarRevealed = state.sidebarHidden && data.visible === true;
      animateSidebarReveal(data.animate === true);
      break;
    case "sidebar-width":
      state.settings.sidebarWidth = Math.min(
        360,
        Math.max(200, Number(data.width) || 244),
      );
      layout();
      break;
    case "split": {
      if (!data.id) {
        const group = M.splits.groupFor(state);
        state.splits = (state.splits || []).filter(candidate => candidate.id !== group?.id);
        splitId = null;
      } else {
        const targetId = data.targetId || state.activeTabId;
        const group = M.splits.join(state, targetId, data.id, data.orientation);
        closePeek(false);
        M.activate(state, targetId);
        splitId = group.tabIds.find(id => id !== targetId) || null;
        splitRatio = group.weights[0];
        closeOverlay(false);
      }
      splitReversed = false;
      layout();
      break;
    }
    case "split-remove-pane": {
      M.splits.removeTab(state, data.id || state.activeTabId);
      layout();
      break;
    }
    case "split-orientation": {
      if (!["horizontal", "vertical"].includes(data.orientation)) throw Error("Unknown split orientation");
      state.settings.splitOrientation = data.orientation;
      const group = M.splits.groupFor(state);
      if (group) group.orientation = data.orientation;
      layout();
      break;
    }
    case "split-ratio": {
      M.splits.resize(state, state.activeTabId, Number(data.divider || 0), Number(data.ratio));
      splitRatio = M.splits.groupFor(state)?.weights[0] || .5;
      layout();
      break;
    }
    case "peek":
      openPeek(M.normalizeURL(data.url));
      break;
    case "close-peek":
      closePeek();
      break;
    case "promote-peek":
      if (peek) {
        const record = peek;
        peek = null;
        const promoted = M.newTab(record.spaceId, record.url, {
          title: record.view.webContents.getTitle() || hostName(record.url),
        });
        state.tabs.push(promoted);
        views.set(promoted.id, record.view);
        wireContents(record.view, promoted);
        M.activate(state, promoted.id);
        splitId = null;
        closeOverlay(false);
        layout();
      }
      break;
    case "restore":
      M.restoreTab(state, data.id || state.archive[0]?.id);
      closeOverlay(false);
      layout();
      break;
    case "clear-today":
      state.tabs
        .filter((t) => t.spaceId === state.activeSpaceId && t.kind === "today")
        .forEach((t) => {
          M.archiveTab(state, t.id);
          forgetView(t.id);
        });
      splitId = null;
      layout();
      break;
    case "copy-url":
      if (tab) clipboard.writeText(state.settings.cleanCopy === false ? tab.url : Navigation.cleanURL(tab.url));
      break;
    case "find":
      if (data.text && wc)
        wc.findInPage(String(data.text), {
          forward: data.forward !== false,
          findNext: !!data.next,
        });
      else wc?.stopFindInPage("clearSelection");
      break;
    case "zoom":
      if (wc)
        wc.setZoomLevel(
          data.reset
            ? 0
            : Math.min(
                5,
                Math.max(-3, wc.getZoomLevel() + Number(data.delta || 0)),
              ),
        );
      break;
    case "dev": {
      if (!wc) return { error: "Open a website first." };
      const message = await DevTools.apply(wc, String(data.tool), data.value);
      sendCommand({ type: "toast", message });
      return { ok: true };
    }
    case "pulls-open": {
      const existing = state.tabs.find((t) => t.url === M.PULLS_URL);
      if (existing) {
        M.activate(state, existing.id);
        const space = state.spaces.find((s) => s.id === existing.spaceId);
        if (space) state.activeSpaceId = space.id;
      } else {
        const tab = openTab(M.PULLS_URL);
        M.splits.setKind(state, tab.id, "pinned");
      }
      break;
    }
    case "pulls-data": {
      const data = await fetchPullRequests(runForgeTool);
      const count = data.items.filter((p) => p.section === "review").length;
      for (const tab of state.tabs)
        if (tab.url === M.PULLS_URL)
          tab.title = count ? `Pull Requests (${count})` : "Pull Requests";
      publish(false);
      return data;
    }
    case "mini-window":
      openMini(data.url ? M.normalizeURL(data.url) : "");
      return { ok: true };
    case "dev-reload":
      wc?.reloadIgnoringCache();
      return { ok: true };
    case "dev-source":
      if (wc && allowedWeb(wc.getURL())) {
        const source = new BrowserWindow({
          width: 900,
          height: 700,
          webPreferences: { session: wc.session, sandbox: true },
        });
        source.loadURL("view-source:" + wc.getURL());
      }
      return { ok: true };
    case "dev-clear-site": {
      if (!wc || !allowedWeb(wc.getURL())) return { ok: false };
      const origin = new URL(wc.getURL()).origin;
      const { response } = await dialog.showMessageBox(win, {
        type: "warning",
        message: `Clear all data for ${origin}?`,
        detail: "This removes its cookies and storage, so you will be signed out of this site.",
        buttons: ["Clear Data", "Cancel"],
        defaultId: 1,
        cancelId: 1,
      });
      if (response) return { ok: false };
      await wc.session.clearStorageData({ origin });
      await wc.session.clearCache();
      wc.reloadIgnoringCache();
      sendCommand({ type: "toast", message: `Cleared data for ${origin}` });
      return { ok: true };
    }
    case "dev-open-in":
      if (wc && allowedWeb(wc.getURL()) && ["Safari", "Google Chrome", "Firefox"].includes(data.browser))
        await DevTools.openInBrowser(data.browser, wc.getURL());
      return { ok: true };
    case "local-servers":
      return { servers: await DevTools.localServers() };
    case "devtools":
      wc?.openDevTools({ mode: "detach" });
      break;
    case "metrics":
      return {
        liveViews: views.size,
        sleepingTabs: [...runtime.values()].filter((r) => r.sleeping).length,
        totalTabs: state.tabs.length,
        cachedHistories: navigationCache.size,
        publishCount,
        processes: app.getAppMetrics().map((p) => ({
          pid: p.pid,
          type: p.type,
          cpu: p.cpu.percentCPUUsage,
          workingSetKB: p.memory.workingSetSize,
          privateKB: p.memory.privateBytes || 0,
        })),
      };
    case "trim-memory":
      trimMemory();
      publish(false);
      return { ok: true };
    case "settings": {
      if ([4, 8, 16].includes(data.maxLiveTabs))
        state.settings.maxLiveTabs = data.maxLiveTabs;
      if (typeof data.dark === "boolean") state.settings.dark = data.dark;
      if ([0, 12, 24, 168].includes(data.archiveHours))
        state.settings.archiveHours = data.archiveHours;
      if (["google", "duckduckgo"].includes(data.search))
        state.settings.search = data.search;
      if (typeof data.peekPinned === "boolean")
        state.settings.peekPinned = data.peekPinned;
      break;
    }
    case "boost":
      if (tab && allowedWeb(tab.url)) {
        state.boosts[new URL(tab.url).origin] = String(data.css || "").slice(
          0,
          50000,
        );
        wc?.reload();
      }
      break;
    case "show-download": {
      const d = downloads.find(
        (d) => d.id === data.id && d.status === "completed",
      );
      if (d?.path) shell.showItemInFolder(d.path);
      break;
    }
    case "export": {
      const r = await dialog.showSaveDialog(win, {
        defaultPath: "Wing-workspace.json",
        filters: [{ name: "Wing workspace", extensions: ["json"] }],
      });
      if (!r.canceled)
        fs.writeFileSync(r.filePath, JSON.stringify(state, null, 2), {
          mode: 0o600,
        });
      break;
    }
    case "import": {
      const r = await dialog.showOpenDialog(win, {
        properties: ["openFile"],
        filters: [{ name: "Wing workspace", extensions: ["json"] }],
      });
      if (!r.canceled) {
        const imported = M.validateState(
          JSON.parse(fs.readFileSync(r.filePaths[0], "utf8")),
        );
        await workspaceStore.write(state);
        fs.copyFileSync(statePath, statePath + ".before-import");
        closePeek(false);
        [...views.keys()].forEach(closeView);
        navigationCache.clear();
        runtime.clear();
        state = imported;
        sidebarRevealed = false;
        splitId = null;
        closeOverlay(false);
        layout();
      }
      break;
    }
    case "private-window":
      privateWindows.open();
      return { ok: true };
    default: {
      const result = await features.handle(name, data);
      if (result !== null) return result;
      throw Error("Unknown browser action");
    }
  }
  trimMemory();
  const durable = new Set([
    "new-tab",
    "navigate",
    "select-tab",
    "close-tab",
    "rename-tab",
    "pin",
    "favorite",
    "split",
    "split-orientation",
    "split-ratio",
    "split-remove-pane",
    "swipe-profile",
    "move-tab",
    "reorder-tab",
    "space",
    "save-space",
    "delete-space",
    "folder",
    "toggle-folder",
    "sidebar",
    "tab-layout",
    "reorder-space",
    "sidebar-width",
    "restore",
    "clear-today",
    "settings",
    "boost",
    "import",
    "promote-peek",
  ]);
  publish(durable.has(name));
  return { ok: true };
}
function menu() {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "Wing",
        submenu: [
          { role: "about" },
          {
            label: "Settings…",
            accelerator: "CmdOrCtrl+,",
            click: () => ui("settings"),
          },
          { type: "separator" },
          { role: "hide" },
          { role: "hideOthers" },
          { role: "unhide" },
          { type: "separator" },
          { role: "quit" },
        ],
      },
      {
        label: "File",
        submenu: [
          {
            label: "New Tab",
            accelerator: "CmdOrCtrl+T",
            click: () => ui("palette"),
          },
          {
            label: "New Mini Window",
            accelerator: "Alt+CmdOrCtrl+N",
            click: () => action("mini-window"),
          },
          {
            label: "New Private Window",
            accelerator: "CmdOrCtrl+Shift+N",
            click: () => action("private-window"),
          },
          {
            label: "Open Location",
            accelerator: "CmdOrCtrl+L",
            click: () =>
              ui("palette", {
                mode: "navigate",
                value:
                  activeTab()?.url === "wing://home" ? "" : activeTab()?.url,
              }),
          },
          {
            label: "Close Tab",
            accelerator: "CmdOrCtrl+W",
            click: () => action("close-tab"),
          },
          {
            label: "Restore Last Tab",
            accelerator: "CmdOrCtrl+Shift+T",
            click: () => action("restore"),
          },
          { label: "New Space…", click: () => ui("space-editor") },
          { type: "separator" },
          { label: "Export Workspace…", click: () => action("export") },
          { label: "Import Workspace…", click: () => action("import") },
        ],
      },
      {
        label: "Edit",
        submenu: [
          { role: "undo" },
          { role: "redo" },
          { type: "separator" },
          { role: "cut" },
          { role: "copy" },
          { role: "paste" },
          { role: "selectAll" },
          {
            label: "Find in Page",
            accelerator: "CmdOrCtrl+F",
            click: () => {
              sendCommand({ type: "find" });
              win.webContents.focus();
            },
          },
        ],
      },
      {
        label: "View",
        submenu: [
          {
            label: "Toggle Sidebar",
            accelerator: "CmdOrCtrl+S",
            click: () => action("sidebar"),
          },
          {
            label: "Move Tabs Between Top Bar and Sidebar",
            accelerator: "CmdOrCtrl+Alt+S",
            click: () =>
              action("tab-layout", {
                layout: state.settings.tabLayout === "top" ? "sidebar" : "top",
              }),
          },
          {
            label: "Previous Profile",
            accelerator: "CmdOrCtrl+Alt+Left",
            click: () => action("swipe-profile", { direction: -1 }),
          },
          {
            label: "Next Profile",
            accelerator: "CmdOrCtrl+Alt+Right",
            click: () => action("swipe-profile", { direction: 1 }),
          },
          {
            label: "Reload Page",
            accelerator: "CmdOrCtrl+R",
            click: () => action("reload"),
          },
          {
            label: "Pin / Unpin Tab",
            accelerator: "CmdOrCtrl+D",
            click: () => action("pin"),
          },
          {
            label: "Split View…",
            accelerator: "CmdOrCtrl+Shift+2",
            click: () => ui("split-picker"),
          },
          { type: "separator" },
          {
            label: "Zoom In",
            accelerator: "CmdOrCtrl+Plus",
            click: () => action("zoom", { delta: 1 }),
          },
          {
            label: "Zoom Out",
            accelerator: "CmdOrCtrl+-",
            click: () => action("zoom", { delta: -1 }),
          },
          {
            label: "Actual Size",
            accelerator: "CmdOrCtrl+0",
            click: () => action("zoom", { reset: true }),
          },
          { role: "togglefullscreen" },
          {
            label: "Developer Tools",
            accelerator: "Alt+CmdOrCtrl+I",
            click: () => action("devtools"),
          },
        ],
      },
      {
        label: "Develop",
        submenu: [
          {
            label: "Developer Tools",
            accelerator: "Alt+CmdOrCtrl+J",
            click: () => action("devtools"),
          },
          {
            label: "Reload Ignoring Cache",
            accelerator: "CmdOrCtrl+Shift+R",
            click: () => action("dev-reload"),
          },
          {
            label: "View Page Source",
            accelerator: "Alt+CmdOrCtrl+U",
            click: () => action("dev-source"),
          },
          { label: "Clear Data for This Site…", click: () => action("dev-clear-site") },
          { label: "Pull Requests", click: () => action("pulls-open") },
          { type: "separator" },
          { label: "Toggle Cache", click: () => dev("cache") },
          { label: "Toggle JavaScript", click: () => dev("javascript") },
          {
            label: "Device Size",
            submenu: [
              { label: "Window Size", click: () => dev("device") },
              ...Object.entries(DevTools.DEVICES).map(([key, d]) => ({
                label: d.label,
                click: () => dev("device", key),
              })),
            ],
          },
          {
            label: "Color Scheme",
            submenu: [
              { label: "System", click: () => dev("scheme") },
              { label: "Light", click: () => dev("scheme", "light") },
              { label: "Dark", click: () => dev("scheme", "dark") },
            ],
          },
          {
            label: "Network Speed",
            submenu: [
              { label: "No Throttling", click: () => dev("network") },
              ...Object.entries(DevTools.NETWORKS).map(([key, n]) => ({
                label: n.label,
                click: () => dev("network", key),
              })),
            ],
          },
          {
            label: "User Agent",
            submenu: [
              { label: "Default", click: () => dev("agent") },
              ...Object.entries(DevTools.AGENTS).map(([key, a]) => ({
                label: a.label,
                click: () => dev("agent", key),
              })),
            ],
          },
          { type: "separator" },
          ...["Safari", "Google Chrome", "Firefox"].map((browser) => ({
            label: `Open Page in ${browser}`,
            click: () => action("dev-open-in", { browser }),
          })),
          { label: "Performance Monitor", click: () => ui("performance") },
        ],
      },
      {
        label: "History",
        submenu: [
          {
            label: "Back",
            accelerator: "CmdOrCtrl+[",
            click: () => action("back"),
          },
          {
            label: "Forward",
            accelerator: "CmdOrCtrl+]",
            click: () => action("forward"),
          },
          {
            label: "History & Archive",
            accelerator: "CmdOrCtrl+Y",
            click: () => ui("library"),
          },
          {
            label: "Downloads",
            accelerator: "CmdOrCtrl+Shift+J",
            click: () => ui("library", { tab: "downloads" }),
          },
        ],
      },
      {
        label: "Window",
        submenu: [
          { role: "minimize" },
          { role: "zoom" },
          {
            label: "Next Recent Tab",
            accelerator: "Ctrl+Tab",
            click: () => cycleTab(1),
          },
          {
            label: "Previous Recent Tab",
            accelerator: "Ctrl+Shift+Tab",
            click: () => cycleTab(-1),
          },
          ...Array.from({ length: 9 }, (_, i) => ({
            label: i === 8 ? "Last Tab" : `Tab ${i + 1}`,
            accelerator: `CmdOrCtrl+${i + 1}`,
            click: () => {
              const tab = I.tabForShortcut(M.visibleTabs(state), state.splits, i);
              if (tab) action("select-tab", { id: tab.id });
            },
          })),
          ...Array.from({ length: 9 }, (_, i) => ({
            label: `Profile ${i + 1}`,
            accelerator: `Ctrl+${i + 1}`,
            click: () => {
              const space = I.spaceForProfile(state, i);
              if (space) action("space", { id: space.id });
            },
          })),
        ],
      },
      {
        label: "Help",
        submenu: [{ label: "Wing Guide", click: () => ui("help") }],
      },
    ]),
  );
}
function cycleTab(direction, preview = false) {
  if (!preview) {
    const tabs = RecentTabs.orderedTabs(state);
    if (tabs.length > 1)
      action("select-tab", { id: tabs[direction < 0 ? tabs.length - 1 : 1].id });
    return;
  }
  if (recentTabs.step(state, direction)) {
    win.webContents.focus();
    publishRecentTabs();
  }
}
function publishRecentTabs() {
  const selection = recentTabs.snapshot(state);
  if (!selection) return finishRecentTabs(false);
  const tabs = selection.ids.map((id) => state.tabs.find((tab) => tab.id === id)).filter(Boolean);
  sendCommand({ type: "recent-tabs", tabs, selectedId: selection.selectedId });
}
function finishRecentTabs(commit) {
  const id = commit ? recentTabs.commit(state) : (recentTabs.cancel(), null);
  sendCommand({ type: "recent-tabs-close" });
  closeOverlay(false);
  if (id) action("select-tab", { id });
  else layout();
  // The renderer restores native page focus after closing its modal.
}
function handleRecentTabsInput(event, input) {
  if (input.type === "keyDown" && input.key === "Tab" && input.control && !input.meta && !input.alt) {
    event.preventDefault();
    cycleTab(input.shift ? -1 : 1, true);
    return true;
  }
  if (!recentTabs.active) return false;
  if (input.type === "keyUp" && input.key === "Control") {
    event.preventDefault();
    finishRecentTabs(true);
    return true;
  }
  if (input.type !== "keyDown") return false;
  if (input.key === "Escape") finishRecentTabs(false);
  else if (input.key === "Enter") finishRecentTabs(true);
  else if (["ArrowDown", "ArrowRight"].includes(input.key)) cycleTab(1, true);
  else if (["ArrowUp", "ArrowLeft"].includes(input.key)) cycleTab(-1, true);
  else if (input.key === "Control" || input.key === "Shift") return false;
  event.preventDefault();
  return true;
}
// Asks on launch, like Safari, until Wing is the default or told to stop.
async function askDefaultBrowser() {
  if (
    !win ||
    win.isDestroyed() ||
    !I.shouldAskDefaultBrowser({
      packaged: app.isPackaged,
      isDefault: app.isDefaultProtocolClient("https"),
      settings: state.settings,
    })
  )
    return;
  const { response, checkboxChecked } = await dialog.showMessageBox(win, {
    type: "question",
    message: "Make Wing your default browser?",
    detail: "Links from other apps will open in Wing.",
    buttons: ["Use Wing", "Not Now"],
    defaultId: 0,
    cancelId: 1,
    checkboxLabel: "Don't ask again",
  });
  if (response === 0) {
    app.setAsDefaultProtocolClient("http");
    app.setAsDefaultProtocolClient("https");
  } else if (checkboxChecked) {
    state.settings.defaultBrowserPromptOff = true;
    save();
  }
}
app.whenReady().then(async () => {
  // Keep crash dumps on this Mac for diagnosis; nothing is uploaded.
  crashReporter.start({ uploadToServer: false });
  extensionManager.setupActionProtocol(session.defaultSession);
  app.setAboutPanelOptions({
    applicationName: "Wing",
    applicationVersion: "0.2.0",
    copyright: "GPL-3.0 distribution · Independent, open-source browser",
  });
  win = new BrowserWindow({
    show: !process.env.WING_ENGINE_TEST,
    width: 1360,
    height: 880,
    minWidth: 800,
    minHeight: 560,
    title: "Wing",
    backgroundColor: "#d6d0e5",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 18, y: 17 },
    webPreferences: {
      preload: path.join(__dirname, "preload.bundle.cjs"),
      backgroundThrottling: false,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  const shellErrors = [];
  win.webContents.on("before-input-event", handleRecentTabsInput);
  win.on("blur", () => {
    if (recentTabs.active) finishRecentTabs(false);
  });
  win.webContents.on("console-message", (event) => {
    if (event.level === "error" && shellErrors.length < 50)
      shellErrors.push(event.message);
    if (event.level === "error") console.error("[shell]", event.message);
  });
  win.webContents.on("render-process-gone", (_event, details) =>
    console.error("Shell renderer exited", details),
  );
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  ipcMain.handle("wing:action", async (event, name, data) => {
    if (
      event.sender !== win.webContents ||
      event.senderFrame !== win.webContents.mainFrame ||
      event.senderFrame.url !== shellURL
    )
      throw Error("Untrusted caller");
    if (typeof name !== "string" || data === null || typeof data !== "object")
      throw Error("Invalid request");
    try {
      return await action(name, data);
    } catch (error) {
      return { error: error.message };
    }
  });
  win.on("resize", layout);
  let closing = false;
  win.on("close", async (event) => {
    if (closing) return;
    event.preventDefault();
    closing = true;
    updateController.stop();
    privateWindows.closeAll();
    closeOverlay(false);
    clearInterval(memoryTimer);
    clearTimeout(saveTimer);
    try {
      await workspaceStore.write(state);
      workspaceStore.flushSync(state);
    } catch (error) {
      console.error("Final workspace save failed", error);
    }
    publisher.cancel();
    closePeek(false);
    [...views.keys()].forEach(closeView);
    win.destroy();
  });
  win.on("closed", () => {
    miniWindows.closeAll();
    win = null;
    app.quit();
  });
  // Extension workers may open tabs during startup; the host window must exist first.
  for (const profile of new Set(state.spaces.map((s) => s.profileId))) {
    sessionFor(profile);
    await extensionManager
      .restore(profile)
      .catch((error) => console.error("Extension restore:", error.message));
  }
  win.loadFile(path.join(__dirname, "index.html"));
  win.webContents.on("did-finish-load", () => {
    layout();
    publish(false);
    if (process.env.WING_ENGINE_TEST) {
      require("../scripts/engine-test.cjs")({
        openTab,
        action,
        views,
        sessionFor,
        trimMemory,
        getState: () => state,
        getSnapshot: snapshot,
        testWindow: win,
        getShellErrors: () => shellErrors,
        extensionManager,
      })
        .then(() => app.quit())
        .catch((e) => {
          console.error(e);
          app.exit(1);
        });
    }
  });
  menu();
  for (const url of pendingExternalLinks.splice(0)) openExternalLink(url);
  if (!process.env.WING_ENGINE_TEST) updateController.start();
  setTimeout(askDefaultBrowser, 1500);
  applyAppIcon(state.settings.appIcon);
  M.autoArchive(state);
  memoryTimer = setInterval(() => {
    const protectedIds = [
      ...M.splits.visibleIds(state),
      ...[...views]
        .filter(([, v]) => v.webContents.isCurrentlyAudible())
        .map(([id]) => id),
    ];
    const expired = M.autoArchive(state, Date.now(), protectedIds);
    expired.forEach((id) => {
      closeView(id);
      navigationCache.delete(id);
    });
    const before = views.size;
    trimMemory();
    if (expired.length || before !== views.size) {
      layout();
      publish();
    }
  }, 60000);
  memoryTimer.unref();
});
app.on("window-all-closed", () => app.quit());

const pendingExternalLinks = [];
function openExternalLink(url) {
  try {
    const parsed = new URL(url);
    if (!["http:","https:"].includes(parsed.protocol)) return;
    if (!win || win.isDestroyed()) { pendingExternalLinks.push(parsed.href); return; }
    const destination = Navigation.routeURL(parsed.href, state.settings.routes, state.spaces, state.settings.defaultSpaceId || state.activeSpaceId);
    if (state.settings.linksInMini !== false) {
      openMini(parsed.href, destination);
      return;
    }
    openTab(parsed.href, destination);
    win.show(); win.focus();
  } catch (error) { console.error("External link rejected:", error.message); }
}
app.on("open-url", (event, url) => { event.preventDefault(); openExternalLink(url); });
// Page tabs only load web addresses, so a local file goes to Safari.
app.on("open-file", (event, file) => {
  event.preventDefault();
  DevTools.openInBrowser("Safari", file).catch(() => {});
  if (win && !win.isDestroyed())
    sendCommand({ type: "toast", message: "Wing can't open local files yet. Opened in Safari." });
});
