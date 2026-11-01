const { randomUUID } = require("node:crypto");
const splits = require("./splits.cjs");
const { normalizeCustomColors } = require("./themes.cjs");
const id = () => randomUUID();
const themes = ["lavender", "sage", "peach", "ocean", "rose", "graphite"];
// Chromium's own management pages Wing exposes. Everything else under
// chrome:// stays blocked.
// Drawn by the app shell rather than a page view, like the home tab.
const PULLS_URL = "wing://pulls";
const isShellPage = (url) => url === "wing://home" || url === PULLS_URL;
const INTERNAL_PAGES = {
  "wing://passwords": "chrome://password-manager/passwords",
  "wing://history": "chrome://history/",
  "wing://clear-data": "chrome://settings/clearBrowserData",
};
const INTERNAL_PATTERN =
  /^chrome:\/\/(password-manager\/[\w/-]*|history\/[\w/?=&%-]*|settings\/clearBrowserData)$/;
function internalPage(url) {
  return INTERNAL_PATTERN.test(String(url || ""));
}
function normalizeURL(input, search = "https://www.google.com/search?q=") {
  const value = String(input || "").trim();
  if (!value || value === "wing://home") return "wing://home";
  if (value === PULLS_URL) return value;
  if (INTERNAL_PAGES[value]) return INTERNAL_PAGES[value];
  if (internalPage(value)) return value;
  if (value === "about:blank") return value;
  if (/^chrome-extension:\/\/[a-p]{32}\//.test(value))
    return new URL(value).href;
  if (/^https?:\/\//i.test(value)) {
    const u = new URL(value);
    if (!u.hostname) throw Error("Invalid address");
    return u.href;
  }
  if (
    /^[a-z][a-z\d+.-]*:/i.test(value) &&
    !/^(localhost|[\w.-]+\.\w+):\d+/i.test(value)
  )
    throw Error("Only HTTP and HTTPS addresses are supported");
  if (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?([/?#]|$)/.test(value))
    return new URL("http://" + value).href;
  if (/^[\w.-]+\.[a-z]{2,}(:\d+)?([/?#]\S*)?$/i.test(value))
    return new URL("https://" + value).href;
  return search + encodeURIComponent(value);
}
function newTab(spaceId, url = "wing://home", extras = {}) {
  url = normalizeURL(url);
  return {
    id: id(),
    spaceId,
    url,
    title:
      url === "wing://home"
        ? "New tab"
        : url === PULLS_URL
          ? "Pull Requests"
          : new URL(url).hostname,
    kind: "today",
    folderId: null,
    homeURL: url,
    createdAt: Date.now(),
    lastActive: Date.now(),
    ...extras,
  };
}
function initialState() {
  const personal = {
    id: id(),
    name: "Personal",
    icon: "✳",
    theme: "lavender",
    profileId: "default",
  };
  const work = {
    id: id(),
    name: "Work",
    icon: "◈",
    theme: "sage",
    profileId: "work",
  };
  const home = newTab(personal.id);
  return {
    version: 1,
    spaces: [personal, work],
    activeSpaceId: personal.id,
    activeTabId: home.id,
    profiles: [
      { id: "default", name: "Personal" },
      { id: "work", name: "Work" },
    ],
    tabs: [
      newTab(personal.id, "https://github.com", {
        kind: "favorite",
        title: "GitHub",
      }),
      newTab(personal.id, "https://en.wikipedia.org", {
        kind: "favorite",
        title: "Wikipedia",
      }),
      newTab(personal.id, "https://www.are.na", {
        kind: "favorite",
        title: "Are.na",
      }),
      newTab(personal.id, "https://developer.mozilla.org", {
        kind: "pinned",
        title: "MDN Web Docs",
      }),
      home,
    ],
    folders: [],
    splits: [],
    archive: [],
    history: [],
    boosts: {},
    settings: {
      archiveHours: 12,
      automaticPictureInPicture: false,
      dark: false,
      onboarded: false,
      search: "google",
      sidebarWidth: 256,
      tabLayout: "top",
      splitOrientation: "horizontal",
    },
    sidebarHidden: false,
  };
}
function spaceOf(state, tab) {
  return state.spaces.find((s) => s.id === tab?.spaceId);
}
function visibleTabs(state) {
  const space = state.spaces.find((s) => s.id === state.activeSpaceId);
  return state.tabs.filter((t) =>
    t.kind === "favorite"
      ? spaceOf(state, t)?.profileId === space?.profileId
      : t.spaceId === space?.id,
  );
}
function activate(state, tabId) {
  const tab = state.tabs.find((t) => t.id === tabId);
  if (!tab) return;
  if (
    tab.kind !== "favorite" ||
    !visibleTabs(state).some((t) => t.id === tabId)
  )
    state.activeSpaceId = tab.spaceId;
  state.activeTabId = tab.id;
  for (const member of splits.members(state, tab.id)) delete member.closed;
  tab.lastActive = Date.now();
}
function selectSpace(state, spaceId) {
  if (!state.spaces.some((s) => s.id === spaceId)) return;
  state.activeSpaceId = spaceId;
  const next = visibleTabs(state)
    .filter((t) => t.kind !== "favorite" && !t.closed)
    .sort((a, b) => b.lastActive - a.lastActive)[0];
  state.activeTabId = next?.id || null;
}
function archiveTab(state, tabId) {
  const tab = state.tabs.find((t) => t.id === tabId);
  if (!tab) return;
  const splitBackup =
    splits.groupFor(state, tabId) ||
    state.archive.find(
      (entry) =>
        Array.isArray(entry.splitBackup?.tabIds) &&
        entry.splitBackup.tabIds.length <= 3 &&
        entry.splitBackup.tabIds.includes(tabId),
    )?.splitBackup;
  state.archive.unshift({
    ...tab,
    ...(splitBackup ? { splitBackup: structuredClone(splitBackup) } : {}),
    archivedAt: Date.now(),
  });
  state.archive = state.archive.slice(0, 500);
  state.tabs = state.tabs.filter((t) => t.id !== tabId);
  splits.removeTab(state, tabId);
  if (state.activeTabId === tabId)
    state.activeTabId =
      visibleTabs(state)
        .filter((t) => !t.closed)
        .at(-1)?.id || null;
}
/** Saved destinations survive closing their current document. Removal is explicit. */
function closePage(state, tabId, { archive = false } = {}) {
  const tab = state.tabs.find((t) => t.id === tabId);
  if (!tab) return;
  if (archive || tab.kind === "today") {
    archiveTab(state, tabId);
    return { retained: false, tab };
  }
  tab.closedURL = tab.url;
  tab.closedAt = Date.now();
  tab.url = tab.homeURL;
  tab.closed = true;
  if (tab.faviconOrigin && tab.faviconOrigin !== new URL(tab.homeURL).origin) {
    delete tab.favicon;
    delete tab.faviconOrigin;
  }
  if (state.activeTabId === tabId) {
    const next = visibleTabs(state)
      .filter((candidate) => candidate.id !== tabId && !candidate.closed)
      .sort((a, b) => b.lastActive - a.lastActive)[0];
    state.activeTabId = next?.id || null;
  }
  return { retained: true, tab };
}
function autoArchive(state, now = Date.now(), protectedIds = []) {
  if (!state.settings.archiveHours) return [];
  const expired = state.tabs
    .filter(
      (t) =>
        t.kind === "today" &&
        t.id !== state.activeTabId &&
        !protectedIds.includes(t.id) &&
        now - t.lastActive > state.settings.archiveHours * 3600000,
    )
    .map((t) => t.id);
  expired.forEach((t) => archiveTab(state, t));
  return expired;
}
function restoreTab(state, tabId) {
  const entry = state.archive.find((t) => t.id === tabId);
  if (!entry) return;
  const backup = entry.splitBackup;
  const ids =
    Array.isArray(backup?.tabIds) && backup.tabIds.length <= 3
      ? backup.tabIds
      : [tabId];
  const entries = state.archive.filter(
    (item) =>
      item.id === tabId ||
      (ids.includes(item.id) && item.splitBackup?.id === backup?.id),
  );
  for (const item of entries) {
    state.archive = state.archive.filter((t) => t.id !== item.id);
    if (state.tabs.some((t) => t.id === item.id)) continue;
    const tab = { ...item, lastActive: Date.now() };
    delete tab.archivedAt;
    delete tab.splitBackup;
    delete tab.closed;
    if (!state.spaces.some((space) => space.id === tab.spaceId))
      tab.spaceId = state.activeSpaceId;
    if (!state.folders.some((folder) => folder.id === tab.folderId))
      tab.folderId = null;
    state.tabs.push(tab);
  }
  if (backup) {
    try {
      const candidate = {
        ...state,
        splits: [...(state.splits || []), structuredClone(backup)],
      };
      state.splits = splits.validate(candidate);
    } catch {
      /* Pages remain restored if their old grouping is no longer valid. */
    }
  }
  activate(state, tabId);
  return state.tabs.find((tab) => tab.id === tabId);
}
function moveTab(state, tabId, spaceId, folderId = null) {
  const tab = state.tabs.find((t) => t.id === tabId),
    space = state.spaces.find((s) => s.id === spaceId);
  if (!tab || !space) return;
  for (const member of splits.members(state, tabId)) {
    member.spaceId = spaceId;
    member.folderId = state.folders.some(
      (f) => f.id === folderId && f.spaceId === spaceId,
    )
      ? folderId
      : null;
    if (member.folderId) member.kind = "pinned";
  }
  activate(state, tab.id);
}
function validateState(value) {
  const fail = () => {
    throw Error("Invalid or unsupported workspace file");
  };
  const text = (v, max = 300) => typeof v === "string" && v.length <= max;
  const identity = (v) => text(v, 100) && /^[\w-]+$/.test(v);
  const validURL = (v) => {
    try {
      return text(v, 20000) && normalizeURL(v) === v;
    } catch {
      return false;
    }
  };
  if (!value || value.version !== 1) fail();
  for (const key of [
    "spaces",
    "profiles",
    "tabs",
    "folders",
    "archive",
    "history",
  ]) {
    if (!Array.isArray(value[key]) || value[key].length > 10000) fail();
    const ids = new Set();
    for (const item of value[key]) {
      if (!item || !identity(item.id) || ids.has(item.id)) fail();
      ids.add(item.id);
    }
  }
  if (!value.spaces.length || !value.profiles.length) fail();
  for (const p of value.profiles) if (!text(p.name, 100)) fail();
  for (const s of value.spaces)
    if (
      !text(s.name, 100) ||
      !text(s.icon, 10) ||
      !themes.includes(s.theme) ||
      !value.profiles.some((p) => p.id === s.profileId)
    )
      fail();
  // Validate color overrides before importing them into privileged shell styles.
  const spaces = value.spaces.map((space) =>
    Object.hasOwn(space, "colors")
      ? { ...space, colors: normalizeCustomColors(space.colors) }
      : { ...space },
  );
  if (!value.spaces.some((s) => s.id === value.activeSpaceId)) fail();
  for (const tab of [...value.tabs, ...value.archive]) {
    if (
      !identity(tab.spaceId) ||
      !text(tab.title) ||
      !["today", "pinned", "favorite"].includes(tab.kind) ||
      !validURL(tab.url) ||
      !validURL(tab.homeURL) ||
      !Number.isFinite(tab.lastActive) ||
      !Number.isFinite(tab.createdAt)
    )
      fail();
    if (tab.folderId !== null && !identity(tab.folderId)) fail();
  }
  if (value.tabs.some((t) => !value.spaces.some((s) => s.id === t.spaceId)))
    fail();
  if (
    value.activeTabId !== null &&
    !value.tabs.some((t) => t.id === value.activeTabId)
  )
    fail();
  const folderById = new Map(
    value.folders.map((folder) => [folder.id, folder]),
  );
  for (const f of value.folders) {
    if (!text(f.name, 100) || !value.spaces.some((s) => s.id === f.spaceId))
      fail();
    const ancestors = new Set([f.id]);
    let parentId = f.parentId;
    while (parentId !== undefined && parentId !== null) {
      const parent = folderById.get(parentId);
      if (!parent || parent.spaceId !== f.spaceId || ancestors.has(parentId))
        fail();
      ancestors.add(parentId);
      parentId = parent.parentId;
    }
  }
  for (const h of value.history)
    if (
      !validURL(h.url) ||
      !text(h.title) ||
      !Number.isFinite(h.at) ||
      !identity(h.profileId)
    )
      fail();
  if (
    !value.boosts ||
    typeof value.boosts !== "object" ||
    Array.isArray(value.boosts)
  )
    fail();
  for (const [origin, css] of Object.entries(value.boosts)) {
    try {
      if (
        !["https:", "http:"].includes(new URL(origin).protocol) ||
        new URL(origin).origin !== origin ||
        !text(css, 50000)
      )
        fail();
    } catch {
      fail();
    }
  }
  const base = initialState();
  const settings = { ...base.settings, ...value.settings };
  settings.sidebarWidth = Math.max(
    200,
    Math.min(360, Number(settings.sidebarWidth) || 256),
  );
  if (![0, 12, 24, 168].includes(settings.archiveHours))
    settings.archiveHours = 12;
  if (!["google", "duckduckgo"].includes(settings.search))
    settings.search = "google";
  if (!["top", "sidebar"].includes(settings.tabLayout))
    settings.tabLayout = "top";
  settings.dark = !!settings.dark;
  settings.automaticPictureInPicture =
    settings.automaticPictureInPicture === true;
  if (!["horizontal", "vertical"].includes(settings.splitOrientation))
    settings.splitOrientation = "horizontal";
  if (settings.maxLiveTabs && ![4, 8, 16].includes(settings.maxLiveTabs))
    settings.maxLiveTabs = 8;
  return {
    ...base,
    ...value,
    spaces,
    splits: splits.validate(value),
    sidebarHidden: Boolean(value.sidebarHidden),
    settings,
  };
}

// One grapheme, so multi-part emoji are never cut in half.
function spaceIcon(value) {
  const [first] = new Intl.Segmenter(undefined, {
    granularity: "grapheme",
  }).segment(String(value || "").trim());
  return first && first.segment.length <= 10 ? first.segment : "✳";
}
// ⌃N follows this order, so profiles are ranked by their first Space.
function reorderSpace(state, id, beforeId) {
  const moving = state.spaces.find((s) => s.id === id);
  if (!moving || id === beforeId) return;
  state.spaces = state.spaces.filter((s) => s !== moving);
  const index = state.spaces.findIndex((s) => s.id === beforeId);
  state.spaces.splice(index < 0 ? state.spaces.length : index, 0, moving);
  const rank = (profile) => {
    const at = state.spaces.findIndex((s) => s.profileId === profile.id);
    return at < 0 ? state.spaces.length : at;
  };
  state.profiles = state.profiles
    .map((profile, order) => [profile, order])
    .sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1])
    .map(([profile]) => profile);
}
const BUILT_IN_PROFILES = new Set(["default", "work"]);
// Deleting a profile's last Space leaves nothing to reach it by. Drop the empty
// profile, and keep its history and archived tabs in a surviving Space's profile.
function removeEmptyProfiles(state) {
  const spaceIds = new Set(state.spaces.map((s) => s.id));
  const owners = new Set(state.spaces.map((s) => s.profileId));
  const home =
    state.spaces.find((s) => s.id === state.activeSpaceId) || state.spaces[0];
  const removed = new Set(
    state.profiles
      .filter((p) => !BUILT_IN_PROFILES.has(p.id) && !owners.has(p.id))
      .map((p) => p.id),
  );
  state.profiles = state.profiles.filter((p) => !removed.has(p.id));
  for (const row of state.history)
    if (removed.has(row.profileId)) row.profileId = home.profileId;
  for (const tab of state.archive)
    if (!spaceIds.has(tab.spaceId)) {
      tab.spaceId = home.id;
      tab.folderId = null;
    }
  return [...removed];
}
module.exports = {
  BUILT_IN_PROFILES,
  removeEmptyProfiles,
  PULLS_URL,
  isShellPage,
  splits,
  spaceIcon,
  reorderSpace,
  id,
  themes,
  normalizeURL,
  normalizeCustomColors,
  newTab,
  initialState,
  visibleTabs,
  internalPage,
  spaceOf,
  activate,
  selectSpace,
  archiveTab,
  closePage,
  autoArchive,
  restoreTab,
  moveTab,
  validateState,
};
