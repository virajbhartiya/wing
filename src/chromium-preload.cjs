"use strict";
const {
  ChromiumWorkspace,
  openWorkspace,
  startupNotice,
} = require("./chromium-workspace.cjs");
const M = require("./model.cjs");
const theme = require("./themes.cjs");
const swipe = require("./interactions.cjs").createSwipeTracker();
const DevPlan = require("./dev-plan.cjs");
const Pulls = require("./pull-requests.cjs");
const { shouldAskDefaultBrowser } = require("./interactions.cjs");
const devStates = new Map();
const runTool = async (tool, args) => {
  const result = await native("run-tool", { tool, args });
  if (result.status !== 0) throw Pulls.toolError(result);
  return result.stdout;
};
const navigation = require("./navigation.cjs");
const ICloud = require("./icloud-sync.cjs");
const { nativeMessages } = require("./native-messages.cjs");
const pending = new Map(),
  states = new Set(),
  commands = new Set(),
  overlays = new Set();
let sequence = 0,
  workspace,
  version,
  queue = Promise.resolve(),
  overlay = false,
  overlayToken = 0,
  shellRaised = false,
  shellLowerTimer = 0,
  privateMode = false;
// A private window keeps one in-memory Space; anything that would save or
// reach the person's other profiles stays in the normal window.
const NOT_PRIVATE = new Set([
  "settings",
  "icloud-sync-now",
  "features-settings",
  "delete-space",
  "boost",
  "reorder-space",
  "save-space",
  "swipe-profile",
  "space-index",
  "space",
  "pin",
  "favorite",
  "folder",
  "save-folder",
  "remove-folder",
  "reset-pin",
  "reset-pin-id",
  "new-throwaway",
  "browser-profiles",
  "browser-import",
  "export",
  "import",
  "export-space",
  "library-data",
  "extensions-install",
  "extensions-store-install",
  "extension-capabilities",
  "protection-settings",
  "default-browser",
  "updates-check",
  "mini-visit",
  "pulls-open",
]);
function native(action, data = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(
      () => {
        pending.delete(id);
        reject(Error(`Native request timed out: ${action}`));
      },
      [
        "browser-import",
        "default-browser",
        "run-tool",
        "default-browser-prompt",
        "confirm",
        "extensions-install",
        "file-save",
        "image-export",
        "file-read",
        "directory",
        "clear-site-data",
        "capture-preview",
        "capture-page",
        "capture-full-page",
        "save-pdf",
        "save-page",
        "summarize",
      ].includes(action)
        ? 600000
        : // The services page can take a while to start on a busy Mac.
          action === "service"
          ? 45000
          : 15000,
    );
    pending.set(id, { resolve, reject, timer });
    for (const { kind, json } of nativeMessages(id, action, data))
      window.__wingNativePost(kind, json);
  });
}
// The native host draws the macOS sidebar material behind this page.
document.documentElement.classList.add("native-material");
window.addEventListener("wing-native", (event) => {
  const { kind, data } = event.detail;
  if (kind === "response") {
    const item = pending.get(data.id);
    if (!item) return;
    clearTimeout(item.timer);
    pending.delete(data.id);
    if (data.error) item.reject(Error(data.error));
    else item.resolve(data.result);
  } else if (kind === "command") commands.forEach((callback) => callback(data));
  else if (workspace && kind === "action")
    invoke(data.name, data.args || {}).catch(() => {});
  else if (workspace && kind === "workspace-imported")
    enqueue(async () => {
      workspace = new ChromiumWorkspace(data);
      await publish();
    });
  else if (workspace && kind === "created")
    enqueue(async () => {
      const state = workspace.state;
      const space =
        state.spaces.find(
          (s) => s.id === state.activeSpaceId && s.profileId === data.profileId,
        ) || state.spaces.find((s) => s.profileId === data.profileId);
      if (!space) {
        await native("close", { id: data.id });
        return;
      }
      const record = M.newTab(space.id, data.url || "about:blank", {
        id: data.id,
      });
      record.id = data.id;
      if (data.peek) {
        if (workspace.peekId) {
          const result = await native("close", { id: workspace.peekId });
          if (!result.pending) workspace.closed(workspace.peekId);
        }
        record.transient = true;
        workspace.peekId = record.id;
        state.tabs.push(record);
      } else {
        state.tabs.push(record);
        if (data.foreground) M.activate(state, record.id);
      }
      await publish();
    });
  else if (workspace && kind === "page")
    enqueue(async () => {
      await publish(workspace.pageChanged(data));
    });
  else if (workspace && kind === "closed")
    enqueue(async () => {
      workspace.closed(data.id, data.archive);
      await publish();
    });
  else if (workspace && kind === "service-event" && !privateMode)
    enqueue(async () => {
      if (data.profileId === profileId()) {
        await library();
        await publish(false);
        watchDownloads();
      }
    });
  else if (workspace && kind === "resize") enqueue(() => publish(false));
});
const ready = native("bootstrap").then(async (result) => {
  if (result.private) {
    privateMode = true;
    document.body.classList.add("private");
    workspace = new ChromiumWorkspace(M.privateState(result.settings));
    version = result.version;
    return;
  }
  const opened = await openWorkspace(result, (after) =>
    native("workspace-recover", { after }),
  );
  workspace = opened.workspace;
  workspace.removedProfiles.push(...M.removeThrowawaySpaces(workspace.state));
  version = result.version;
  const notice = startupNotice(opened.recovery, result.uncleanExit);
  if (notice)
    setTimeout(
      () => commands.forEach((callback) => callback({ type: "toast", message: notice })),
      2500,
    );
  // Populate recent downloads for the toolbar once startup work settles.
  setTimeout(
    () =>
      enqueue(async () => {
        await library();
        await publish(false);
        watchDownloads();
      }).catch(() => {}),
    2500,
  );
});
// iCloud Drive layout sync: pull the other Macs' changes, merge, then write ours.
let syncTimer = null;
function scheduleSync(delay = 8000) {
  if (privateMode || !workspace?.state.settings.icloudSync) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(
    () => enqueue(() => syncNow().catch(() => {})),
    delay,
  );
}
async function syncNow() {
  const { remote, base } = await native("icloud-sync-read");
  const baseLayout = base && ICloud.validLayout(base) ? base : null;
  const remoteLayout =
    remote && ICloud.validLayout(remote.layout) ? remote.layout : null;
  if (
    remoteLayout &&
    ICloud.fingerprint(remoteLayout) !== ICloud.fingerprint(baseLayout)
  ) {
    const next = structuredClone(workspace.state);
    if (ICloud.merge(next, remoteLayout, baseLayout)) {
      M.validateState(next);
      workspace.state = next;
      await publish(true, false);
    }
    await native("icloud-sync-write", { base: remoteLayout });
  }
  const local = ICloud.layoutOf(workspace.state);
  if (ICloud.fingerprint(local) !== ICloud.fingerprint(remoteLayout))
    await native("icloud-sync-write", {
      file: { version: 1, updatedAt: Date.now(), layout: local },
      base: local,
    });
  return { ok: true };
}
setInterval(() => scheduleSync(0), 60000);
// Start the services page once the window is up, so the first real request
// (history, downloads, site settings) doesn't wait for it on a busy Mac.
ready.then(() => {
  if (!privateMode)
    setTimeout(() => service("ping").catch(() => {}), 1500);
});
window.addEventListener("focus", () => scheduleSync(500));
function enqueue(operation) {
  const result = queue.then(() => ready).then(operation);
  queue = result.catch((error) =>
    commands.forEach((callback) =>
      callback({ type: "toast", message: error.message }),
    ),
  );
  return result;
}
// Lifts the shell over live pages while an overlay or the floating sidebar shows.
// Lowering waits for the sidebar's slide out; a closed overlay lowers straight away.
function updateShellRaise(lowerDelay = 0) {
  clearTimeout(shellLowerTimer);
  const wanted = overlay || !!workspace?.revealed;
  if (wanted === shellRaised) return;
  const apply = () => {
    shellRaised = wanted;
    const panes = workspace.layout(innerWidth, innerHeight);
    overlays.forEach((callback) =>
      callback({
        type: "raised",
        raised: wanted,
        live: panes.length > 0,
        hole: {
          left: Math.min(...panes.map((p) => p.x)),
          top: Math.min(...panes.map((p) => p.y)),
          right: Math.max(...panes.map((p) => p.x + p.width)),
          bottom: Math.max(...panes.map((p) => p.y + p.height)),
        },
      }),
    );
    return native("raise-shell", { raised: wanted }).catch(() => {});
  };
  if (wanted || !lowerDelay) return apply();
  shellLowerTimer = setTimeout(apply, lowerDelay);
}
async function publish(persist = true, sync = true) {
  updateShellRaise(260);
  const snapshot = workspace.snapshot(version);
  const address = document.querySelector("#address")?.getBoundingClientRect();
  persist = persist && !privateMode;
  await native("sync", {
    workspace: workspace.state,
    panes: workspace.layout(innerWidth, innerHeight),
    persist,
    // Native site prompts attach below the address field.
    anchor: address?.width
      ? {
          x: address.x,
          y: address.y,
          width: address.width,
          height: address.height,
        }
      : null,
  });
  if (persist)
    for (const id of workspace.removedProfiles.splice(0))
      native("delete-profile", { id }).catch(() => {});
  if (persist && sync) scheduleSync();
  states.forEach((callback) => callback(snapshot));
  return snapshot;
}
// Chromium reports download state changes, not byte progress; poll while a
// transfer is active so the toolbar progress ring moves.
let downloadWatch = null;
function watchDownloads() {
  if (downloadWatch) return;
  if (!workspace.downloads.some((d) => d.status === "progressing" && !d.paused))
    return;
  downloadWatch = setTimeout(() => {
    enqueue(async () => {
      await library();
      await publish(false);
      downloadWatch = null;
      watchDownloads();
    });
  }, 700);
}
function profileId() {
  return workspace.state.spaces.find(
    (space) => space.id === workspace.state.activeSpaceId,
  )?.profileId;
}
function service(method, args = {}) {
  return native("service", { profile: profileId(), method, args });
}
async function library() {
  const result = await service("library");
  workspace.downloads = result.downloads;
  const profile = profileId(),
    spaces = new Set(
      workspace.state.spaces
        .filter((s) => s.profileId === profile)
        .map((s) => s.id),
    );
  const urls = new Set(result.history.map((row) => row.url));
  return {
    ...result,
    history: [
      ...result.history,
      ...workspace.state.history.filter(
        (row) => row.profileId === profile && !urls.has(row.url),
      ),
    ],
    archive: workspace.state.archive.filter((row) => spaces.has(row.spaceId)),
  };
}
function openMini(url, spaceId) {
  const s = workspace.state;
  return native("mini-open", {
    url: url || "",
    spaceId: spaceId || s.activeSpaceId,
    search:
      s.settings.search === "duckduckgo"
        ? "https://duckduckgo.com/?q="
        : "https://www.google.com/search?q=",
    spaces: s.spaces.map(({ id, name, icon, profileId }) => ({ id, name, icon, profileId })),
  });
}
async function developerAction(action, data) {
  const id = data.id || workspace.state.activeTabId;
  switch (action) {
    case "dev": {
      if (!devStates.has(id)) devStates.set(id, { cache: false, script: false });
      const plan = DevPlan.devPlan(devStates.get(id), String(data.tool), data.value);
      const calls = plan.calls.map(([method, params]) => ({ method, params: params || {} }));
      if (plan.agent !== undefined)
        calls.push({
          method: "Emulation.setUserAgentOverride",
          params: { userAgent: plan.agent },
        });
      await invoke("dev-cdp", { id, calls, reload: !!plan.reload });
      return { ok: true, message: plan.message };
    }
    case "dev-clear-site": {
      const url = workspace.state.tabs.find((t) => t.id === id)?.url || "";
      if (!/^https?:/.test(url)) return { ok: false };
      const { origin } = new URL(url);
      const { confirmed } = await native("confirm", {
        message: `Clear all data for ${origin}?`,
        detail: "This removes its cookies and storage, so you will be signed out of this site.",
        button: "Clear Data",
      });
      if (!confirmed) return { ok: false };
      await invoke("clear-site-data", { id });
      return { ok: true, message: `Cleared data for ${origin}` };
    }
    case "dev-jwt": {
      const { text } = await native("clipboard-read");
      const decoded = DevPlan.decodeJWT(text);
      await invoke("copy-text", { text: JSON.stringify(decoded, null, 2) });
      const expires = Number(decoded.payload.exp);
      return {
        ok: true,
        message: `Decoded token copied${expires ? ` · expires ${new Date(expires * 1000).toLocaleString()}` : ""}`,
      };
    }
    case "dev-json": {
      const { text } = await native("clipboard-read");
      await invoke("copy-text", { text: DevPlan.formatJSON(text) });
      return { ok: true, message: "Formatted JSON copied" };
    }
    case "dev-curl": {
      const url = workspace.state.tabs.find((t) => t.id === id)?.url || "";
      if (!/^https?:/.test(url)) return { ok: false, message: "Open a website first." };
      await invoke("copy-text", { text: DevPlan.curlCommand(url) });
      return { ok: true, message: "curl command copied" };
    }
    case "dev-local": {
      const url = workspace.state.tabs.find((t) => t.id === id)?.url || "";
      if (!/^https?:/.test(url)) return { ok: false, message: "Open a website first." };
      await invoke("new-tab", { url: DevPlan.localURL(url, Number(data.port)) });
      return { ok: true };
    }
    case "dev-open-in": {
      const url = workspace.state.tabs.find((t) => t.id === id)?.url || "";
      if (!/^https?:/.test(url)) return { ok: false };
      return native("open-in-browser", { browser: data.browser, url });
    }
    case "local-servers":
      return {
        servers: DevPlan.parseListeningPorts(
          await runTool("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN"]).catch(() => ""),
        ),
      };
    case "pulls-data": {
      const result = await Pulls.fetchPullRequests(runTool);
      await invoke("pulls-title", {
        count: result.items.filter((p) => p.section === "review").length,
      });
      return result;
    }
    case "mini-window":
      return openMini(data.url);
    case "mini-expand":
      await invoke("space", { id: data.spaceId });
      return invoke("new-tab", { url: data.url });
    case "emoji-panel":
      return native("emoji-panel");
  }
}
const DEVELOPER_ACTIONS = new Set([
  "dev",
  "dev-clear-site",
  "dev-open-in",
  "dev-jwt",
  "dev-json",
  "dev-curl",
  "dev-local",
  "local-servers",
  "pulls-data",
  "mini-window",
  "mini-expand",
  "emoji-panel",
]);
async function invoke(action, data = {}) {
  if (privateMode && NOT_PRIVATE.has(action))
    throw Error("Not available in a private window.");
  if (DEVELOPER_ACTIONS.has(action)) {
    await ready;
    const result = await developerAction(action, data);
    if (result?.message) window.__wingToast?.(result.message);
    return result;
  }
  if (action === "external-url") {
    await ready;
    if (
      !data.space &&
      !data.spaceId &&
      workspace.state.settings.askSpaceForLinks &&
      workspace.state.spaces.length > 1
    ) {
      const spaceId = await window.__wingPickSpace?.(data.url);
      if (!spaceId) return { ok: false };
      data = { ...data, spaceId };
    }
    if (!data.space && !data.spaceId && workspace.state.settings.linksInMini !== false) {
      const s = workspace.state;
      const url = new URL(data.url);
      if (["http:", "https:"].includes(url.protocol))
        return openMini(
          url.href,
          navigation.routeURL(
            url.href,
            s.settings.routes,
            s.spaces,
            s.settings.defaultSpaceId || s.activeSpaceId,
          ),
        );
    }
  }
  if (action === "browser-profiles" || action === "browser-import") {
    await ready;
    return native(action, data);
  }
  if (action === "close-duplicates") {
    await ready;
    const ids = M.duplicateTabIds(workspace.state, workspace.state.activeSpaceId);
    if (ids.length) await invoke("bulk-tabs", { ids, operation: "close", archive: true });
    return { count: ids.length };
  }
  if (action === "new-throwaway") {
    await ready;
    await invoke("save-space", {
      name: "Throwaway",
      profileId: "new",
      theme: "lavender",
      throwaway: true,
    });
    const space = workspace.state.spaces.find(
      (s) => s.id === workspace.state.activeSpaceId,
    );
    await native("throwaway-profile", { id: space.profileId });
    return { ok: true };
  }
  if (
    action === "clear-today" ||
    action === "delete-space" ||
    (action === "bulk-tabs" && data.operation === "close")
  ) {
    await ready;
    if (action === "delete-space" && workspace.state.spaces.length < 2)
      throw Error("Keep at least one Space.");
    const ids = new Set(data.ids || []),
      current = profileId();
    const targets = workspace.state.tabs.filter((t) =>
      action === "clear-today"
        ? t.spaceId === workspace.state.activeSpaceId && t.kind === "today"
        : action === "delete-space"
          ? t.spaceId === data.id
          : ids.has(t.id) &&
            workspace.state.spaces.find((s) => s.id === t.spaceId)
              ?.profileId === current,
    );
    for (const tab of targets)
      await invoke("close-tab", {
        id: tab.id,
        archive: action !== "bulk-tabs" || !!data.archive,
      });
    const deadline = Date.now() + 15000;
    while (
      targets.some((t) =>
        workspace.state.tabs.some((live) => live.id === t.id && !live.closed),
      )
    ) {
      if (Date.now() > deadline)
        throw Error(
          "A page is still open. Complete or cancel its close prompt before trying again.",
        );
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (action !== "delete-space") return { ok: true };
  }
  await ready;
  if (
    workspace.peekId &&
    [
      "space",
      "select-tab",
      "new-tab",
      "navigate",
      "swipe-profile",
      "external-url",
      "peek",
    ].includes(action)
  ) {
    const closingId = workspace.peekId;
    await invoke("close-peek");
    const deadline = Date.now() + 15000;
    while (workspace.peekId === closingId) {
      if (Date.now() > deadline)
        throw Error(
          "Finish or cancel the Peek close prompt before changing pages.",
        );
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  return enqueue(async () => {
    if (
      ["recent-tabs-commit", "recent-tabs-cancel"].includes(action) &&
      !workspace.recent.active
    )
      return { ok: false };
    if (action === "recent-tabs-focus" && !data.id)
      return native("focus", { id: workspace.state.activeTabId });
    if (action === "metrics" || action === "trim-memory") return native(action);
    if (["site-cookies", "page-json", "adblock-site"].includes(action))
      return native(action, {
        ...data,
        id: data.id || workspace.state.activeTabId,
      });
    if (action === "password-apps" || action === "password-app-open")
      return native(action, data);
    if (["extensions-unpacked", "extensions-reload", "extensions-watch"].includes(action))
      return native(action, { ...data, profile: profileId() });
    if (action === "extension-actions") return native(action);
    if (action === "private-window") return native(action);
    if (action === "extension-action")
      return native(action, {
        ...data,
        id: data.id || workspace.state.activeTabId,
      });
    if (action === "tab-menu" || action === "folder-menu") {
      const command = (title, type, args = {}) => ({
        title,
        kind: "command",
        data: { type, ...args },
      });
      const operation = (title, name, args = {}) => ({
        title,
        kind: "action",
        data: { name, args },
      });
      let items;
      if (action === "folder-menu")
        items = [
          operation("Remove folder (keep tabs)", "remove-folder", {
            id: data.id,
          }),
        ];
      else {
        const state = workspace.state,
          tab = state.tabs.find((t) => t.id === data.id);
        if (!tab) return { ok: false };
        const live = workspace.runtime.get(tab.id) || {},
          separator = { separator: true };
        const today = state.tabs.filter(
          (t) => t.kind === "today" && t.spaceId === tab.spaceId && !t.closed,
        );
        const others = today.filter((t) => t.id !== tab.id).map((t) => t.id),
          below = today.slice(today.indexOf(tab) + 1).map((t) => t.id);
        const web = /^https?:/.test(tab.url);
        items = [
          {
            ...operation("Copy Link", "copy-text", {
              text: navigation.cleanURL(tab.url),
            }),
            symbol: "link",
            disabled: !web,
          },
          {
            ...operation("Duplicate Tab", "new-tab", { url: tab.url }),
            symbol: "plus.square.on.square",
          },
          {
            ...command("Rename…", "rename", {
              id: tab.id,
              value: tab.customTitle || tab.title,
            }),
            symbol: "pencil",
          },
          separator,
          {
            ...operation(
              tab.kind === "favorite"
                ? "Remove from Favorites"
                : "Add to Favorites",
              "favorite",
              { id: tab.id },
            ),
            symbol: "star",
          },
          {
            ...operation(
              tab.kind === "today" ? "Pin Tab" : "Unpin Tab",
              "pin",
              {
                id: tab.id,
              },
            ),
            symbol: "pin",
          },
          ...(tab.kind !== "today"
            ? [
                {
                  ...operation("Reset to Pinned Address", "reset-pin-id", {
                    id: tab.id,
                  }),
                  symbol: "arrow.uturn.backward",
                  disabled: tab.url === tab.homeURL,
                },
              ]
            : []),
          {
            title: "Move to Space",
            symbol: "square.stack",
            items: state.spaces.map((space) => ({
              ...operation(space.name, "move-tab", {
                id: tab.id,
                spaceId: space.id,
              }),
              checked: space.id === tab.spaceId,
              disabled: space.id === tab.spaceId,
            })),
          },
          {
            ...operation("Open in Split View", "split", { id: tab.id }),
            symbol: "rectangle.split.2x1",
            disabled: tab.id === state.activeTabId,
          },
          ...((state.splits || []).some((split) => split.tabIds.includes(tab.id))
            ? [
                {
                  ...operation("Separate Split View", "split-dissolve", {
                    id: tab.id,
                  }),
                  symbol: "rectangle",
                },
              ]
            : []),
          {
            ...operation(live.muted ? "Unmute Tab" : "Mute Tab", "mute-tab", {
              id: tab.id,
            }),
            symbol: live.muted ? "speaker.wave.2" : "speaker.slash",
          },
          separator,
          {
            ...operation("Close Tab", "close-tab", { id: tab.id }),
            symbol: "xmark",
          },
          ...(tab.kind === "today"
            ? [
                {
                  ...operation("Close Other Tabs", "bulk-tabs", {
                    operation: "close",
                    ids: others,
                  }),
                  disabled: !others.length,
                },
                {
                  ...operation("Close Tabs Below", "bulk-tabs", {
                    operation: "close",
                    ids: below,
                  }),
                  disabled: !below.length,
                },
              ]
            : []),
        ];
      }
      return native("context-menu", { items });
    }
    if (action === "state") return publish(false);
    if (["updates-status", "updates-check"].includes(action))
      return {
        state: "unconfigured",
        message: "This development build has no signed update channel.",
      };
    if (action === "show-download")
      return service("download-control", { id: data.id, operation: "show" });

    if (action === "extensions-install" || action === "extension-capabilities")
      return native(action, { profile: profileId() });
    if (action === "extensions-store-install") {
      const url = new URL(String(data.url || ""));
      if (
        url.protocol !== "https:" ||
        !["chromewebstore.google.com", "chrome.google.com"].includes(
          url.hostname,
        ) ||
        !/\/[a-p]{32}(?:[/?#]|$)/.test(url.href)
      )
        throw Error("Enter a valid Chrome Web Store extension link.");
      workspace.action("new-tab", { url: url.href });
      await publish();
      return { ok: true, reviewInStore: true };
    }
    if (action === "protection-settings") {
      const profile = workspace.state.spaces.find(
        (space) => space.id === workspace.state.activeSpaceId,
      ).profileId;
      const result = await native("protection-url", { profile });
      workspace.action("new-tab", { url: result.url });
      await publish();
      return { ok: true };
    }
    if (action === "image-export") return native(action, data);
    if (action === "default-browser") return native("default-browser");
    if (action === "window-drag" || action === "window-zoom")
      return native(action);
    if (action === "native-cancel-device")
      return native("test-cancel-device", data);
    if (action === "native-cancel-external")
      return native("test-cancel-external", data);
    if (action === "native-test-extension")
      return native("test-extension", data);
    if (action === "native-archive-idle")
      return native("test-archive-idle", data);
    if (action === "native-minis") return native("test-minis", data);
    if (action === "native-test-private") return native("test-private", data);
    if (action === "native-install-unpacked")
      return native("test-install-unpacked", { ...data, profile: profileId() });
    if (action === "native-diagnostics" || action === "native-evaluate")
      return native(
        action === "native-diagnostics" ? "diagnostics" : "evaluate-page",
        data,
      );
    if (action === "overlay") {
      if (data.ready !== undefined)
        return data.ready === overlayToken
          ? { ok: true }
          : { ok: false, cancelled: true };
      overlayToken = ++sequence;
      if (data.open) {
        overlay = true;
        await updateShellRaise();
        return { frames: [], ok: true, token: overlayToken };
      }
      overlay = false;
      await updateShellRaise();
      overlays.forEach((callback) =>
        callback({ type: "clear", token: overlayToken, handoff: true }),
      );
      return { ok: true };
    }
    if (action === "library-data") return library();
    if (
      [
        "download-control",
        "extensions-list",
        "extensions-enabled",
        "extensions-remove",
        "github-signed-in",
      ].includes(action)
    )
      return action === "extensions-list"
        ? { extensions: await service(action, data), errors: [] }
        : service(action, data);
    if (action === "site-controls" || action === "site-permission") {
      const tab = workspace.state.tabs.find(
        (t) => t.id === workspace.state.activeTabId,
      );
      return service(action, { ...data, url: tab?.url });
    }
    if (action === "features-settings" && data.appIcon)
      native("app-icon", { icon: data.appIcon }).catch(() => {});
    if (action === "features-settings")
      data = {
        ...data,
        systemDark: matchMedia("(prefers-color-scheme: dark)").matches,
      };
    if (action === "focus-shell") return native("focus-shell");
    if (action === "icloud-sync-now")
      // Already inside the action queue.
      return syncNow().catch((error) => ({
        error: error.message,
      }));
    if (action === "copy-text")
      return native("clipboard", {
        text: String(data.text || "").slice(0, 100000),
      });
    if (action === "mute-tab")
      return native("mute", { id: data.id || workspace.state.activeTabId });
    if (action === "bulk-tabs" && data.operation === "copy") {
      const profile = profileId(),
        ids = new Set(
          (data.ids || []).flatMap((id) =>
            M.splits.members(workspace.state, id).map((t) => t.id),
          ),
        );
      const tabs = workspace.state.tabs.filter(
        (t) =>
          ids.has(t.id) &&
          workspace.state.spaces.find((s) => s.id === t.spaceId)?.profileId ===
            profile,
      );
      return native("clipboard", {
        text: tabs.map((t) => navigation.cleanURL(t.url)).join("\n"),
      });
    }
    if (action === "features-directory") {
      const selected = await native("directory");
      if (selected.cancelled) return selected;
      await native("download-directory", {
        id: workspace.state.activeTabId,
        path: selected.path,
      });
      workspace.state.settings.downloadDirectory = selected.path;
      await publish();
      return { ok: true };
    }
    if (action === "download-start") return service("download-start", data);
    if (action === "download-directory")
      return native(action, {
        ...data,
        id: data.id || workspace.state.activeTabId,
      });
    if (action === "export")
      return native("file-save", "image-export", {
        name: "Wing-workspace.json",
        text: JSON.stringify(workspace.state, null, 2),
      });
    if (action === "import") {
      const result = await native("file-read");
      if (result.cancelled) return result;
      const replacement = new ChromiumWorkspace(JSON.parse(result.text));
      workspace = replacement;
      await publish();
      return { ok: true };
    }
    if (action === "export-space") {
      const state = workspace.state,
        space = state.spaces.find((s) => s.id === state.activeSpaceId);
      const escape = (text) =>
        String(text).replace(
          /[&<>"']/g,
          (c) =>
            ({
              "&": "&amp;",
              "<": "&lt;",
              ">": "&gt;",
              '"': "&quot;",
              "'": "&#39;",
            })[c],
        );
      const links = state.tabs.filter(
        (t) => t.spaceId === space.id && /^https?:/.test(t.url),
      );
      return native("file-save", "image-export", {
        name: "Wing-links.html",
        text: `<!doctype html><meta charset="utf-8"><title>${escape(space.name)}</title><h1>${escape(space.name)}</h1><ul>${links.map((t) => `<li><a href="${escape(navigation.cleanURL(t.url))}">${escape(t.customTitle || t.title)}</a></li>`).join("")}</ul>`,
      });
    }
    if (action === "close-peek") {
      if (!workspace.peekId) return { ok: true };
      const result = await native("close", { id: workspace.peekId });
      if (!result.pending) workspace.closed(workspace.peekId);
      await publish();
      return { ok: true };
    }
    if (action === "close-tab") {
      for (const tab of M.splits.members(
        workspace.state,
        data.id || workspace.state.activeTabId,
      )) {
        const result = await native("close", {
          id: tab.id,
          archive: data.archive === true,
        });
        if (!result.pending) workspace.closed(tab.id, data.archive === true);
      }
      await publish();
      return { ok: true };
    }
    if (
      [
        "back",
        "forward",
        "reload",
        "stop",
        "devtools",
        "find",
        "zoom",
        "mute",
        "clear-site-data",
        "dev-cdp",
        "dev-reload",
        "dev-source",
        "capture-preview",
        "capture-page",
        "capture-full-page",
        "save-pdf",
        "save-page",
        "print-page",
        "picture-in-picture",
        "stop-sharing",
        "fill-login",
        "media-control",
        "reader",
        "summarize",
        "cast",
        "test-cast",
        "test-fullscreen",
        "test-webkit",
      ].includes(action)
    )
      return native(action, {
        ...data,
        id: data.id || workspace.state.activeTabId,
      });
    if (action === "copy-url" || action === "copy-clean-url") {
      const tab = workspace.state.tabs.find(
        (tab) => tab.id === workspace.state.activeTabId,
      );
      return native("clipboard", {
        text: tab
          ? action === "copy-clean-url" ||
            workspace.state.settings.cleanCopy !== false
            ? navigation.cleanURL(tab.url)
            : tab.url
          : "",
      });
    }
    if (workspace.action(action, data)) {
      if (action.startsWith("recent-tabs-")) {
        const recent = workspace.recent.snapshot(workspace.state);
        commands.forEach((callback) =>
          callback(
            recent
              ? {
                  type: "recent-tabs",
                  selectedId: recent.selectedId,
                  tabs: recent.ids.map((id) => ({
                    ...workspace.state.tabs.find((t) => t.id === id),
                    ...workspace.runtime.get(id),
                  })),
                }
              : { type: "recent-tabs-close" },
          ),
        );
      }
      await publish();
      return { ok: true };
    }
    throw Error(`${action} has not yet been migrated to the native preview.`);
  });
}
window.wing = {
  engine: "chromium",
  navigation: {
    calculate: navigation.calculate,
    rankResults: navigation.rankResults,
  },
  theme: { fields: theme.COLOR_FIELDS, resolve: theme.resolveColors },
  swipeGesture: (deltaX, deltaY, time) => swipe.push({ deltaX, deltaY, time }),
  swipeUpdate: (deltaX, deltaY, time) => swipe.update({ deltaX, deltaY, time }),
  swipeReset: () => swipe.reset(),
  invoke,
  onState: (callback) => {
    states.add(callback);
    return () => states.delete(callback);
  },
  onCommand: (callback) => {
    commands.add(callback);
    return () => commands.delete(callback);
  },
  onOverlay: (callback) => {
    overlays.add(callback);
    return () => overlays.delete(callback);
  },
};
require("./chromium-actions.cjs").installBrowserActions(window.wing);
// App icon and the default browser question wait for the saved workspace.
ready.then(async () => {
  if (privateMode) return;
  const { settings } = workspace.state;
  if (settings.appIcon) native("app-icon", { icon: settings.appIcon }).catch(() => {});
  if (!shouldAskDefaultBrowser({ packaged: true, isDefault: false, settings })) return;
  const reply = await native("default-browser-prompt").catch(() => null);
  if (reply?.use) native("default-browser").catch(() => {});
  else if (reply?.off) invoke("features-settings", { defaultBrowserPromptOff: true });
});
