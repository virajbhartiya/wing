const $ = (selector) => document.querySelector(selector);
const icons = {
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  volume:
    '<path d="m11 5-6 4H2v6h3l6 4zM15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14"/>',
  muted: '<path d="m11 5-6 4H2v6h3l6 4zM16 9l6 6m0-6-6 6"/>',
  star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-2.9-5.6 2.9 1.1-6.2L3 9.6l6.2-.9Z"/>',
  sidebar:
    '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16"/>',
  back: '<path d="m14 5-7 7 7 7M7 12h14"/>',
  forward: '<path d="m10 5 7 7-7 7M3 12h14"/>',
  reload: '<path d="M20 7v5h-5M19 12a7 7 0 1 0-2 5"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  globe:
    '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="3"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
  split:
    '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M12 4v16"/>',
  settings:
    '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3" fill="var(--base)"/><circle cx="16" cy="17" r="3" fill="var(--base)"/>',
  library:
    '<rect x="4" y="5" width="16" height="15" rx="3"/><path d="M3 9h18M9 13h6"/>',
  folder:
    '<path d="M3 7a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  sparkle:
    '<path d="m12 3 2.6 6.4L21 12l-6.4 2.6L12 21l-2.6-6.4L3 12l6.4-2.6z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  pin: '<path d="m8 3 8 0-1 7 4 4H5l4-4zM12 14v7"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  home: '<path d="m3 10 9-7 9 7M5 9v12h14V9M10 21v-7h4v7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  play: '<path d="M7 4.5v15l12-7.5z" fill="currentColor"/>',
  pause: '<path d="M8 5v14M16 5v14" stroke-width="3"/>',
  warning:
    '<path d="M12 3.5 2.5 20h19L12 3.5Z"/><path d="M12 10v4.5M12 17.5v.01"/>',
  offline:
    '<path d="M2 8.5a15 15 0 0 1 20 0M5.5 12a10 10 0 0 1 13 0M9 15.5a5 5 0 0 1 6 0M12 19v.01"/><path d="m3 3 18 18"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m10.8 12.2 8.7-8.7M16 7l2.5 2.5M14 9l2 2"/>',
  more: '<circle cx="5.5" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="18.5" cy="12" r="1.2" fill="currentColor" stroke="none"/>',
  up: '<path d="m6 15 6-6 6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  external:
    '<path d="M14 4h6v6M20 4l-9 9M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/>',
};
function icon(name) {
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.globe}</svg>`;
}
function esc(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
}
const palettes = {
  lavender: ["#d9d4f5", "#e9d5ef"],
  sage: ["#cfe3d2", "#e0ecc9"],
  peach: ["#f6d5c3", "#f7e3b8"],
  ocean: ["#c7e0f2", "#cfd9f7"],
  rose: ["#f3cfe0", "#f0d7f0"],
  graphite: ["#dcdfe6", "#e7e3ec"],
};
const SPACE_EMOJI = [..."✳️⭐🔥🌈🌊🌿🍀🌸🌙☀️⚡🎯🚀💼📚🎨🎵🎮🏠💡🧠💰🛠️🧪🌍❤️🐱🐶🦊🍕☕✈️🏃"];
let themePreview = null;
let state = null,
  modalType = null,
  modalOpener = null,
  paletteMode = "new",
  paletteIndex = 0,
  paletteResults = [],
  libraryTab = "archive",
  toastTimer;
async function act(name, data = {}) {
  try {
    const r = await window.wing.invoke(name, data);
    if (r?.error) toast(r.error);
    return r;
  } catch (e) {
    toast(e.message);
  }
}
window.__wingToast = (message) => toast(message);
function toast(message) {
  $("#toast").textContent = message;
  $("#toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("#toast").hidden = true), 3500);
}
const renderedTabIds = new Map();
function patchHTML(selector, html) {
  const el = $(selector);
  if (el.dataset.rendered !== html) {
    el.innerHTML = html;
    el.dataset.rendered = html;
    // Rows are rebuilt from HTML; only tabs that were not shown before animate in.
    const previous = renderedTabIds.get(selector);
    const ids = new Set();
    el.querySelectorAll("[data-tab]").forEach((row) => {
      ids.add(row.dataset.tab);
      if (previous && !previous.has(row.dataset.tab))
        row.classList.add("entering");
    });
    renderedTabIds.set(selector, ids);
  }
}
const current = () => state?.tabs.find((t) => t.id === state.activeTabId);
const currentSpace = () =>
  state?.spaces.find((s) => s.id === state.activeSpaceId) || state?.spaces[0];
function tabsForSpace() {
  const space = currentSpace();
  return state.tabs.filter((t) =>
    t.kind === "favorite"
      ? state.spaces.find((s) => s.id === t.spaceId)?.profileId ===
        space.profileId
      : t.spaceId === space.id,
  );
}
const INTERNAL_NAMES = {
  "password-manager": "Passwords",
  history: "History",
  settings: "Clear Browsing Data",
};
function host(url) {
  if (String(url).startsWith("chrome://"))
    return INTERNAL_NAMES[String(url).slice(9).split("/")[0]] || "Wing";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
function tabIcon(t) {
  if (t.url === "wing://home")
    return '<span class="wing-mark" aria-hidden="true"></span>';
  if (t.url === "wing://pulls") return icon("split");
  let page;
  try {
    page = new URL(t.url);
  } catch {
    return icon("globe");
  }
  if (page.protocol === "chrome:")
    return icon(
      page.hostname === "password-manager"
        ? "key"
        : page.hostname === "history"
          ? "clock"
          : "settings",
    );
  if (!["https:", "http:"].includes(page.protocol)) return icon("globe");
  const hostname = page.hostname.replace(/^www\./, "");
  const monogram = hostname.slice(0, 1).toUpperCase() || "·";
  let favicon = page.origin + "/favicon.ico";
  try {
    const discovered = new URL(t.favicon);
    if (
      ["https:", "http:"].includes(discovered.protocol) &&
      !discovered.username &&
      !discovered.password &&
      discovered.href.length <= 4096 &&
      (!t.faviconOrigin || t.faviconOrigin === page.origin)
    )
      favicon = discovered.href;
  } catch {}
  const hue = [...hostname].reduce(
    (hash, char) => (hash * 31 + char.charCodeAt(0)) % 360,
    0,
  );
  return `<span class="site-icon${t.sleeping ? " is-sleeping" : ""}${t.loading ? " is-loading" : ""}" style="--site-hue:${hue}" aria-hidden="true"${t.sleeping ? ' title="Sleeping tab"' : ""}><span class="site-monogram">${esc(monogram)}</span><img class="site-favicon" src="${esc(favicon)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer"></span>`;
}
function sidebarSplit(tab) {
  return (state.splits || []).find((group) => group.tabIds.includes(tab.id));
}
function sidebarTabTitle(tab) {
  const group = sidebarSplit(tab);
  return group
    ? group.title ||
        group.tabIds
          .map((id) => state.tabs.find((t) => t.id === id)?.title || "Page")
          .join(" / ")
    : tab.title;
}
function sidebarRepresentative(tab) {
  const group = sidebarSplit(tab);
  return !group || group.tabIds[0] === tab.id;
}
function tabHTML(t) {
  if (!sidebarRepresentative(t)) return "";
  const group = sidebarSplit(t);
  const active = group
    ? group.tabIds.includes(state.activeTabId)
    : t.id === state.activeTabId;
  const title = sidebarTabTitle(t);
  return `<div class="tab ${active ? "active" : ""} ${group ? "is-split" : ""}" role="button" tabindex="0" draggable="true" data-tab="${esc(t.id)}" title="${esc(title)}\n${esc(t.url)}"><span class="tab-icon">${group ? icon("split") : tabIcon(t)}</span><span class="tab-title">${esc(title)}</span>${group ? `<span class="split-count">${group.tabIds.length}</span><button class="split-separate" data-separate-split="${esc(t.id)}" aria-label="Separate split view" title="Separate split view">${icon("close")}</button>` : ""}${t.screenSharing ? `<button class="tab-capture" data-stop-sharing="${esc(t.id)}" aria-label="Stop sharing ${esc(t.title)}" title="Stop sharing this screen or tab">●</button>` : t.capturing ? `<span class="tab-capture" aria-label="Camera or microphone in use" title="Camera or microphone in use">●</span>` : ""}${t.pictureInPicture ? `<span class="tab-pip" aria-label="Picture-in-picture active" title="Playing in picture-in-picture">▣</span>` : ""}${t.audible || t.muted ? `<button class="tab-audio" data-mute="${esc(t.id)}" title="${t.muted ? "Unmute tab" : "Mute tab"}" aria-label="${t.muted ? "Unmute" : "Mute"} ${esc(t.title)}">${icon(t.muted ? "muted" : "volume")}</button>` : ""}<button class="tab-close" data-close="${t.id}" title="Close ${group ? "split" : "tab"}" aria-label="Close ${esc(title)}">${icon("close")}</button></div>`;
}
let addressFinish = 0;
let sidebarFrameSequence = -1,
  sidebarFrameNumber = -1,
  sidebarFrameProgress = 1;
// Mirrors splits.cjs frame(), which positions the native page views.
function pageFrame() {
  const hidden = state.settings.toolbarHidden;
  if (state.settings.tabLayout === "top")
    return { left: 8, top: hidden ? 52 : 88, margin: 8 };
  return {
    left: Math.round(
      8 + (state.settings.sidebarWidth - 8) * sidebarFrameProgress,
    ),
    top: hidden ? 8 : 52,
    margin: 8,
  };
}
function positionSplitDivider() {
  if (!state) return;
  const { left, top: pageTop, margin } = pageFrame();
  const vertical = state.splitOrientation === "vertical";
  const weights =
    state.splitWeights?.length > 1
      ? state.splitWeights
      : [state.splitRatio || 0.5, 1 - (state.splitRatio || 0.5)];
  const total = weights.reduce((a, b) => a + b, 0);
  const extent =
    (vertical ? innerHeight - pageTop - margin : innerWidth - left - margin) -
    8 * (weights.length - 1);
  let offset = 0;
  for (let index = 0; index < 2; index++) {
    const divider = $(index ? "#split-divider-secondary" : "#split-divider");
    if (!divider) continue;
    offset += Math.round((extent * (weights[index] || 0)) / total);
    divider.hidden =
      !state.splitId || !!state.peek || index >= weights.length - 1;
    divider.classList.toggle("vertical", vertical);
    divider.style.left = (vertical ? left : left + offset + index * 8) + "px";
    divider.style.top =
      (vertical ? pageTop + offset + index * 8 : pageTop) + "px";
    divider.style.width =
      (vertical ? Math.max(0, innerWidth - left - margin) : 8) + "px";
    divider.style.height =
      (vertical ? 8 : Math.max(0, innerHeight - pageTop - margin)) + "px";
    divider.setAttribute?.(
      "aria-orientation",
      vertical ? "horizontal" : "vertical",
    );
    divider.setAttribute?.(
      "aria-valuenow",
      String(
        Math.round(
          (weights.slice(0, index + 1).reduce((a, b) => a + b, 0) / total) *
            100,
        ),
      ),
    );
  }
}
function applySidebarReveal(frame) {
  const sequence = frame.sequence ?? 0,
    number = frame.frame ?? 0;
  if (
    sequence < sidebarFrameSequence ||
    (sequence === sidebarFrameSequence && number < sidebarFrameNumber)
  )
    return;
  sidebarFrameSequence = sequence;
  sidebarFrameNumber = number;
  sidebarFrameProgress = Math.max(0, Math.min(1, frame.progress));
  if (state) {
    state.sidebarHidden = frame.hidden;
    state.sidebarRevealed = frame.revealed;
    state.sidebarRevealProgress = sidebarFrameProgress;
    state.sidebarRevealSequence = sequence;
    state.sidebarRevealFrame = number;
    state.sidebarRevealAnimating = frame.animating;
  }
  const left = Math.round(
    8 + ((state?.settings.sidebarWidth || 256) - 8) * sidebarFrameProgress,
  );
  document.documentElement.style.setProperty(
    "--sidebar-progress",
    String(sidebarFrameProgress),
  );
  document.documentElement.style.setProperty("--sidebar-left", `${left}px`);
  document.body.classList.toggle(
    "sidebar-hidden",
    frame.hidden && !frame.revealed,
  );
  document.body.classList.toggle("sidebar-revealed", !!frame.revealed);
  document.body.classList.toggle("sidebar-auto-hidden", !!frame.hidden);
  document.body.classList.toggle("sidebar-animating", !!frame.animating);
  $("#sidebar").inert = sidebarFrameProgress === 0 && !frame.animating;
  $("#sidebar-edge").hidden = !frame.hidden || sidebarFrameProgress > 0.98;
  positionSplitDivider();
}
function render() {
  if (!state) return;
  document.body.classList.toggle(
    "toolbar-hidden",
    !!state.settings.toolbarHidden,
  );
  const tabsOnTop = state.settings.tabLayout === "top";
  document.body.classList.toggle("tabs-top", tabsOnTop);
  $("#show-sidebar").title = tabsOnTop
    ? "Move tabs to sidebar · ⌘S"
    : "Show sidebar · ⌘S";
  document.body.classList.toggle(
    "pins-collapsed",
    !!state.settings.pinnedCollapsed,
  );
  const space = currentSpace(),
    t = current();
  const previewSpace = themePreview?.space || space;
  const dark = themePreview?.dark ?? state.settings.dark;
  for (const [key, value] of Object.entries(
    window.wing.theme.resolve(previewSpace, dark),
  )) {
    document.documentElement.style.setProperty(key, value);
    document.body.style.setProperty(key, value);
  }
  document.documentElement.style.setProperty(
    "--sidebar",
    state.settings.sidebarWidth + "px",
  );
  document.body.classList.toggle("dark", dark);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  const actions = $("#extension-actions");
  actions.setAttribute(
    "partition",
    state.extensionPartition || "persist:wing-default",
  );
  if (state.extensionTabId)
    actions.setAttribute("tab", String(state.extensionTabId));
  else actions.removeAttribute("tab");
  applySidebarReveal({
    progress:
      state.sidebarRevealProgress ??
      (state.sidebarHidden && !state.sidebarRevealed ? 0 : 1),
    sequence: state.sidebarRevealSequence,
    frame: state.sidebarRevealFrame,
    animating: state.sidebarRevealAnimating,
    hidden: state.sidebarHidden,
    revealed: state.sidebarRevealed,
  });
  $("#favorite-button").classList.toggle("is-favorite", t?.kind === "favorite");
  $("#favorite-button").setAttribute(
    "aria-pressed",
    String(t?.kind === "favorite"),
  );
  $("#favorite-button").title =
    t?.kind === "favorite" ? "Remove from Favorites" : "Add to Favorites";
  $("#space-name").innerHTML = `<b>${esc(space.icon)}</b>${esc(space.name)}`;
  const tabs = tabsForSpace().filter(sidebarRepresentative),
    favorites = tabs.filter((t) => t.kind === "favorite");
  patchHTML(
    "#favorites",
    favorites
      .map(
        (t) =>
          `<button class="favorite ${(sidebarSplit(t)?.tabIds || [t.id]).includes(state.activeTabId) ? "active" : ""}" data-tab="${t.id}" data-capturing="${!!t.capturing}" data-pip="${!!t.pictureInPicture}" aria-label="${esc(sidebarTabTitle(t))}${t.capturing ? " — camera, microphone or screen capture active" : ""}${t.pictureInPicture ? " — picture-in-picture active" : ""}" title="${esc(sidebarTabTitle(t))}${t.capturing ? " — capture active" : ""}${t.pictureInPicture ? " — picture-in-picture active" : ""}" draggable="true">${sidebarSplit(t) ? icon("split") : tabIcon(t)}</button>`,
      )
      .join(""),
  );
  $("#favorites").style.display = favorites.length ? "grid" : "none";
  $("#home-context").textContent =
    `${space.name} / ${state.profiles.find((p) => p.id === space.profileId)?.name || "Default"}`;
  patchHTML(
    "#home-favorites",
    favorites
      .map(
        (t) =>
          `<button class="launch-favorite" data-tab="${esc(t.id)}"><span class="launch-icon">${tabIcon(t)}</span><span>${esc(t.title)}</span></button>`,
      )
      .join("") ||
      '<p class="launch-empty">Use the star in the toolbar to keep a page here.</p>',
  );
  const openTabs = tabs
    .filter(
      (t) =>
        t.url !== "wing://home" &&
        t.url !== "wing://pulls" &&
        t.kind !== "favorite",
    )
    .slice(0, 5);
  $("#home-tab-count").textContent =
    `${openTabs.length} ${openTabs.length === 1 ? "tab" : "tabs"}`;
  patchHTML(
    "#home-tabs",
    openTabs
      .map(
        (t) =>
          `<button class="launch-tab" data-tab="${esc(t.id)}"><span class="tab-icon">${tabIcon(t)}</span><span class="launch-title">${esc(t.title)}</span><span class="launch-host">${esc(host(t.url))}</span><span aria-hidden="true">↗</span></button>`,
      )
      .join("") ||
      '<div class="launch-empty">A clear space. Open your first tab with <kbd>⌘ T</kbd>.</div>',
  );

  const folders = state.folders.filter((f) => f.spaceId === space.id);
  function folderHTML(folder, ancestors = new Set()) {
    if (ancestors.has(folder.id)) return "";
    const visited = new Set([...ancestors, folder.id]);
    const children = tabs.filter(
      (t) => t.folderId === folder.id && t.kind === "pinned",
    );
    const activeChild = children.find(
      (t) =>
        t.id === state.activeTabId ||
        sidebarSplit(t)?.tabIds.includes(state.activeTabId),
    );
    const content = folder.collapsed
      ? activeChild
        ? tabHTML(activeChild)
        : ""
      : children.map(tabHTML).join("") +
        folders
          .filter((f) => f.parentId === folder.id)
          .map((f) => folderHTML(f, visited))
          .join("");
    return `<div class="folder" data-folder="${folder.id}"><button class="folder-head" data-folder-toggle="${folder.id}" aria-expanded="${!folder.collapsed}"><span>${folder.collapsed ? "›" : "⌄"}</span>${icon("folder")}<span>${esc(folder.name)}</span></button><div class="folder-children">${content || (folder.collapsed ? "" : '<div class="empty">Drop tabs here</div>')}</div></div>`;
  }
  patchHTML(
    "#pinned",
    tabs
      .filter((t) => t.kind === "pinned" && !t.folderId)
      .map(tabHTML)
      .join("") +
      folders
        .filter((f) => !f.parentId || !folders.some((p) => p.id === f.parentId))
        .map((f) => folderHTML(f))
        .join(""),
  );
  patchHTML(
    "#today",
    tabs
      .filter((t) => t.kind === "today")
      .map(tabHTML)
      .join(""),
  );
  const spaceButtons = state.spaces
      .map(
        (s) =>
          `<button class="space-dot ${s.id === space.id ? "active" : ""}" data-space="${s.id}" draggable="true" title="${esc(s.name)} · ${esc(state.profiles.find((p) => p.id === s.profileId)?.name)} profile. Drag to reorder, right-click to edit" aria-label="${esc(s.name)} space" aria-pressed="${s.id === space.id}"><span aria-hidden="true">${esc(s.icon)}</span><span class="space-label">${esc(s.name)}</span></button>`,
      )
      .join("");
  patchHTML("#spaces", spaceButtons);
  if (tabsOnTop) {
    patchHTML("#toolbar-spaces", spaceButtons);
    patchHTML(
      "#strip-tabs",
      [
        ...favorites,
        ...tabs.filter((t) => t.kind === "pinned"),
        ...tabs.filter((t) => t.kind === "today"),
      ]
        .map((t) =>
          t.kind === "today"
            ? tabHTML(t)
            : tabHTML(t).replace('class="tab ', 'class="tab tab-compact '),
        )
        .join(""),
    );
    $("#strip-tabs .tab.active")?.scrollIntoView({
      block: "nearest",
      inline: "nearest",
    });
  }
  $("#address-text").textContent =
    t?.url === "wing://pulls"
      ? "Pull Requests"
      : t && t.url !== "wing://home"
        ? host(t.url)
        : "New tab";
  $("#address").title = (t?.url || "New Tab") + " · ⌘L";
  $("#security-icon").innerHTML = icon(
    t?.url.startsWith("https:")
      ? "lock"
      : t?.url === "wing://home"
        ? "sparkle"
        : "globe",
  );
  $("#back").disabled = !t?.canGoBack;
  $("#forward").disabled = !t?.canGoForward;
  // Safari-style: real load progress fills the address field.
  const address = $("#address");
  const finished =
    address.classList.contains("loading") &&
    !t?.loading &&
    address.dataset.loadingTab === t?.id;
  address.classList.toggle("loading", !!t?.loading);
  address.dataset.loadingTab = t?.loading ? t.id : "";
  if (t?.loading) {
    clearTimeout(addressFinish);
    address.classList.remove("load-done");
  } else if (finished) {
    address.classList.add("load-done");
    clearTimeout(addressFinish);
    addressFinish = setTimeout(() => {
      address.classList.remove("load-done");
      address.style.setProperty("--progress", 0);
    }, 700);
  }
  if (t?.loading)
    address.style.setProperty(
      "--progress",
      Math.max(0.08, Math.min(1, t.progress || 0)),
    );
  else if (finished) address.style.setProperty("--progress", 1);
  else if (!address.classList.contains("load-done"))
    address.style.setProperty("--progress", 0);
  renderDownloadsButton();
  renderMediaPlayer();
  const zoom = Math.round((t?.zoom || 1) * 100);
  $("#zoom-badge").hidden = !t || zoom === 100;
  $("#zoom-badge").textContent = zoom + "%";
  const environment = environmentOf(t?.url);
  $("#env-badge").hidden = !environment;
  if (environment) {
    $("#env-badge").textContent = environment.label;
    $("#env-badge").dataset.kind = environment.kind;
  }
  const failed = t?.error || t?.crashed;
  $("#home").hidden = !!t && t.url !== "wing://home" && !failed;
  const showingPulls = t?.url === "wing://pulls" && !failed;
  if (showingPulls && $("#pulls").hidden) refreshPulls();
  $("#pulls").hidden = !showingPulls;
  $("#page-error").hidden = !failed;
  if (failed) $("#page-error").innerHTML = errorPage(t);
  $("#peek-frame").hidden = !state.peek;
  if (state.peek)
    $("#peek-title").textContent =
      state.peek.title + " · " + host(state.peek.url);
  $("#split-button").style.background = state.splitId ? "var(--selected)" : "";
  $("#split-divider").hidden = !state.splitId || !!state.peek;
  positionSplitDivider();
  if (modalType === "library") renderLibraryList();
}
// Safari-style toolbar button: appears once this profile has downloads and
// shows a progress ring while any are still transferring.
function renderDownloadsButton() {
  const profile = currentSpace()?.profileId;
  const records = (state.downloads || []).filter(
    (d) => !d.profileId || d.profileId === profile,
  );
  const button = $("#downloads-button");
  button.hidden = !records.length;
  if (!records.length) return;
  const active = records.filter((d) => d.status === "progressing" && !d.paused);
  const total = active.reduce((sum, d) => sum + (d.total || 0), 0);
  const received = active.reduce((sum, d) => sum + (d.received || 0), 0);
  const progress = active.length ? (total ? received / total : 0.15) : 0;
  const key = `${active.length}:${progress.toFixed(2)}`;
  if (button.dataset.key === key) return;
  button.dataset.key = key;
  button.classList.toggle("active", active.length > 0);
  const ring = active.length
    ? `<circle class="download-track" cx="12" cy="12" r="10"/><circle class="download-ring" cx="12" cy="12" r="10" pathLength="100" stroke-dasharray="${(progress * 100).toFixed(1)} 100" transform="rotate(-90 12 12)"/>`
    : "";
  button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ring}<path d="M12 6.5v9m-3.5-3.5 3.5 3.5 3.5-3.5M7.5 18h9"/></svg>`;
  button.title = active.length
    ? `Downloading ${active.length} file${active.length > 1 ? "s" : ""}${total ? ` · ${Math.round(progress * 100)}%` : ""}`
    : "Downloads · ⇧⌘J";
}
$("#downloads-button").addEventListener("click", () => {
  const records = (state.downloads || []).slice(0, 5);
  showModal(
    "downloads-summary",
    `<div class="dialog-content">${dialogHead("Downloads")}<div class="library-list">${window.wingFeatures?.downloads(records) || ""}</div><button class="primary" id="all-downloads">Show All Downloads</button></div>`,
  );
  $("#all-downloads").addEventListener("click", () => openLibrary("downloads"));
});
// Labels local and pre-production hosts, so they aren't mistaken for the real site.
function environmentOf(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(parsed.protocol)) return null;
  if (/^(localhost|127\.0\.0\.1|\[::1\])$|\.(localhost|test)$/.test(parsed.hostname))
    return { kind: "local", label: parsed.port ? `local :${parsed.port}` : "local" };
  if (/(^|[.-])(staging|stage|preview|qa|uat|dev)([.-])/.test(parsed.hostname))
    return { kind: "staging", label: "staging" };
  return null;
}
function askText(title, placeholder, done) {
  showModal(
    "ask-text",
    `<div class="dialog-content">${dialogHead(title)}<input id="ask-text" placeholder="${esc(placeholder)}" /><button class="primary" id="ask-done">Apply</button></div>`,
  );
  const finish = () => {
    const value = $("#ask-text").value;
    closeModal();
    done(value);
  };
  $("#ask-done").addEventListener("click", finish);
  $("#ask-text").addEventListener("keydown", (event) => {
    if (event.key === "Enter") finish();
  });
  $("#ask-text").focus();
}
async function toggleReader() {
  const r = await act("reader");
  if (r?.unavailable) toast("Reader isn’t available for this page.");
}
// Arc-style mini player: controls the last background tab that played sound.
let mediaTabId = null,
  mediaPaused = false,
  mediaAudible = false,
  mediaDismissed = null;
function renderMediaPlayer() {
  if (
    mediaDismissed &&
    !state.tabs.find((t) => t.id === mediaDismissed)?.audible
  )
    mediaDismissed = null;
  const audible = state.tabs.find(
    (t) => t.audible && t.id !== state.activeTabId,
  );
  if (audible && audible.id !== mediaDismissed && audible.id !== mediaTabId) {
    mediaTabId = audible.id;
    mediaPaused = false;
    mediaAudible = false;
  }
  const t = state.tabs.find((t) => t.id === mediaTabId && !t.closed);
  if (!t) mediaTabId = null;
  // Chromium reports sound for a moment after a pause; only a new start resumes.
  if (t?.audible && !mediaAudible) mediaPaused = false;
  mediaAudible = !!t?.audible;
  const show = !!t && t.id !== state.activeTabId && (t.audible || mediaPaused);
  $("#media-player").hidden = !show;
  if (!show) return;
  $("#media-player").innerHTML =
    `<button class="media-info" data-media="open" title="Go to tab"><span class="tab-icon">${tabIcon(t)}</span><span><strong>${esc(t.customTitle || t.title)}</strong><small>${esc(host(t.url))}</small></span></button><button class="icon" data-media="toggle" aria-label="${mediaPaused ? "Play" : "Pause"}" title="${mediaPaused ? "Play" : "Pause"}">${icon(mediaPaused ? "play" : "pause")}</button><button class="icon" data-media="mute" aria-label="${t.muted ? "Unmute" : "Mute"}" title="${t.muted ? "Unmute" : "Mute"}">${icon(t.muted ? "muted" : "volume")}</button><button class="icon" data-media="dismiss" aria-label="Hide player" title="Hide">${icon("close")}</button>`;
}
$("#media-player").addEventListener("click", async (e) => {
  const button = e.target.closest("[data-media]");
  if (!button || !mediaTabId) return;
  const id = mediaTabId;
  switch (button.dataset.media) {
    case "open":
      act("select-tab", { id });
      break;
    case "toggle": {
      const r = await act("media-toggle", { id });
      if (r?.none) toast("This page’s player can’t be controlled from Wing.");
      else mediaPaused = !r?.playing;
      renderMediaPlayer();
      break;
    }
    case "mute":
      act("mute-tab", { id });
      break;
    case "dismiss":
      mediaDismissed = id;
      mediaTabId = null;
      mediaPaused = false;
      renderMediaPlayer();
  }
});
// Plain-language error pages; the raw network code stays available as detail.
function errorPage(t) {
  if (t.crashed)
    return `<div>${icon("warning")}<h2>${t.crashed === "oom" ? "This webpage ran out of memory" : "This webpage crashed"}</h2><p>${esc(host(t.url))} stopped unexpectedly. Reload to open it again.</p><p class="error-code">${esc(t.crashed)}</p><button class="primary" data-action="reload">Reload Page</button></div>`;
  const code = String(t.error || "");
  const site = esc(host(t.url) || t.url);
  const pages = [
    [
      /INTERNET_DISCONNECTED|NETWORK_CHANGED|ADDRESS_UNREACHABLE/,
      "You’re not connected to the internet",
      "Check your Wi‑Fi or network connection, then try again.",
    ],
    [
      /NAME_NOT_RESOLVED|NAME_RESOLUTION/,
      "Can’t find this site",
      `Wing can’t find the server for <b>${site}</b>. Check the address for typos.`,
    ],
    [
      /TIMED_OUT|TIMEOUT/,
      "This site took too long to respond",
      `<b>${site}</b> didn’t respond in time. It may be busy or down.`,
    ],
    [
      /CONNECTION_REFUSED|CONNECTION_RESET|CONNECTION_CLOSED|EMPTY_RESPONSE/,
      "This site can’t be reached",
      `<b>${site}</b> refused or dropped the connection.`,
    ],
    [
      /CERT|SSL/,
      "This connection isn’t private",
      `Wing can’t verify the identity of <b>${site}</b>. Someone may be trying to impersonate it.`,
    ],
    [
      /BLOCKED_BY_CLIENT/,
      "Blocked by content protection",
      `uBlock Origin blocked <b>${site}</b>.`,
    ],
  ];
  const [, title, body] = pages.find(([pattern]) => pattern.test(code)) || [
    null,
    "This page couldn’t load",
    `Something went wrong loading <b>${site}</b>.`,
  ];
  return `<div>${icon(/INTERNET_DISCONNECTED|NETWORK_CHANGED/.test(code) ? "offline" : /CERT|SSL/.test(code) ? "lock" : "warning")}<h2>${title}</h2><p>${body}</p><p class="error-code">${esc(code)}</p><button class="primary" data-action="reload">Try Again</button></div>`;
}
function modalFocusable() {
  return [
    ...$("#modal").querySelectorAll(
      'button,input,select,textarea,summary,a[href],[tabindex],[contenteditable="true"]',
    ),
  ].filter(
    (element) =>
      element.tabIndex >= 0 &&
      !element.matches(":disabled") &&
      element.getClientRects().length > 0 &&
      getComputedStyle(element).visibility !== "hidden",
  );
}
let backdropEpoch = 0;
let modalGeneration = 0;
let displayedBackdropToken = 0;
function clearPageBackdrop() {
  $("#page-backdrop").replaceChildren();
  $("#page-backdrop").hidden = true;
  displayedBackdropToken = 0;
}
function waitForOverlayPaint() {
  return new Promise((resolve) => {
    let frame,
      finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(deadline);
      cancelAnimationFrame(frame);
      resolve();
    };
    // Native WebContentsViews can fully occlude the shell and suppress rAF.
    // Prefer two painted frames, but never block browser commands on them.
    const deadline = setTimeout(finish, 120);
    frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(finish);
    });
  });
}
async function decodeBackdropImages(images) {
  let timer;
  try {
    return await Promise.race([
      Promise.all(
        images
          .filter((image) => image instanceof HTMLImageElement)
          .map((image) => image.decode()),
      ).then(
        () => true,
        () => false,
      ),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(false), 200);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
async function prepareOverlayBackdrop() {
  const epoch = ++backdropEpoch;
  const preview = await window.wing.invoke("overlay", { open: true });
  if (epoch !== backdropEpoch || preview?.cancelled) return false;
  if (preview?.error) {
    toast(preview.error);
    await releaseOverlayBackdrop();
    return false;
  }
  const images = (preview.frames || []).map(({ bounds, image, fallback }) => {
    const element = fallback ? document.createElement("div") : new Image();
    if (fallback) {
      element.className = "page-backdrop-fallback";
      element.textContent = "Page preview unavailable";
    } else element.src = image;
    element.style.left = bounds.x + "px";
    element.style.top = bounds.y + "px";
    element.style.width = bounds.width + "px";
    element.style.height = bounds.height + "px";
    return element;
  });
  if (!(await decodeBackdropImages(images))) {
    for (let index = 0; index < images.length; index++) {
      if (!(images[index] instanceof HTMLImageElement)) continue;
      const fallback = document.createElement("div");
      fallback.className = "page-backdrop-fallback";
      fallback.textContent = "Page preview unavailable";
      fallback.style.cssText = images[index].style.cssText;
      images[index] = fallback;
    }
  }
  if (epoch !== backdropEpoch) return false;
  $("#page-backdrop").replaceChildren(...images);
  $("#page-backdrop").hidden = false;
  displayedBackdropToken = preview.token;
  // Decode and submit the shell frame before native page views are detached.
  await waitForOverlayPaint();
  if (epoch !== backdropEpoch) return false;
  const committed = await window.wing.invoke("overlay", {
    open: true,
    ready: preview.token,
  });
  return epoch === backdropEpoch && committed?.ok === true;
}
async function releaseOverlayBackdrop() {
  ++backdropEpoch;
  // Main restores the native views and sends a generation-tagged handoff.
  await window.wing.invoke("overlay", { open: false });
}
let backdropRetirement = 0;
window.wing.onOverlay((event) => {
  if (event.type !== "clear" || event.token < displayedBackdropToken) return;
  const retirement = ++backdropRetirement;
  const epoch = backdropEpoch;
  if (!event.handoff) {
    // Navigation/profile changes must not retain pixels from the old origin.
    clearPageBackdrop();
    return;
  }
  // Keep decoded pixels beneath the native page until its remount can paint.
  // The same bounded wait also works when native content occludes the shell.
  waitForOverlayPaint().then(() => {
    if (
      retirement === backdropRetirement &&
      epoch === backdropEpoch &&
      event.token >= displayedBackdropToken
    )
      clearPageBackdrop();
  });
});
function showModal(type, html) {
  const generation = ++modalGeneration;
  stopMetrics();
  if (!modalType) modalOpener = document.activeElement;
  modalType = type;
  $("#overlay").classList.remove("closing");
  $("#modal").className = "";
  $("#modal").innerHTML = html;
  $("#overlay").hidden = false;
  prepareOverlayBackdrop()
    .then((ready) => {
      if (generation !== modalGeneration) return;
      if (ready)
        ($("#modal [autofocus]") || modalFocusable()[0] || $("#modal")).focus();
      else closeModal();
    })
    .catch((error) => {
      if (generation !== modalGeneration) return;
      closeModal();
      toast(error.message || "The page preview could not be opened.");
    });
  $("#modal").setAttribute("tabindex", "-1");
  ($("#modal [autofocus]") || modalFocusable()[0] || $("#modal")).focus();
}
let metricsTimer = null;
function stopMetrics() {
  clearInterval(metricsTimer);
  metricsTimer = null;
}
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
function closeModal() {
  const generation = ++modalGeneration;
  stopMetrics();
  const wasOpen = !!modalType && !$("#overlay").hidden;
  modalType = null;
  themePreview = null;
  if (state) render();
  // Let the dialog fade out over the frozen page before live pages return.
  const finish = () => {
    if (generation !== modalGeneration) return;
    $("#overlay").classList.remove("closing");
    $("#overlay").hidden = true;
    $("#modal").innerHTML = "";
    releaseOverlayBackdrop();
  };
  if (wasOpen && !reducedMotion.matches) {
    $("#overlay").classList.add("closing");
    setTimeout(finish, 130);
  } else finish();
  const opener = modalOpener?.isConnected
    ? modalOpener
    : modalOpener?.id
      ? document.getElementById(modalOpener.id)
      : null;
  modalOpener = null;
  if (state?.sidebarHidden && !$("#sidebar").matches(":hover"))
    act("sidebar-reveal", { visible: false });
  const visibleOpener =
    opener &&
    opener.getClientRects().length > 0 &&
    getComputedStyle(opener).visibility !== "hidden" &&
    !opener.matches(":disabled");
  (visibleOpener
    ? opener
    : $(
        state?.settings.tabLayout === "top"
          ? "#strip-new-tab"
          : state?.sidebarHidden
            ? "#show-sidebar"
            : "#new-tab",
      )
  ).focus();
}
function dialogHead(title) {
  return `<div class="dialog-head"><h2>${title}</h2><button class="icon" data-dismiss aria-label="Close dialog">${icon("close")}</button></div>`;
}
let localServers = [];
const DEV_COMMANDS = [
  ["Reload Ignoring Cache", "Develop", "dev-reload"],
  ["View Page Source", "Develop", "dev-source"],
  ["Toggle Cache", "Develop · this tab", "dev", { tool: "cache" }],
  ["Copy as curl", "Develop · this tab", "dev-curl"],
  ["Decode JWT from Clipboard", "Develop", "dev-jwt"],
  ["Format JSON from Clipboard", "Develop", "dev-json"],
  ["Toggle JavaScript", "Develop · this tab", "dev", { tool: "javascript" }],
  ["Emulate iPhone", "Develop · this tab", "dev", { tool: "device", value: "iphone" }],
  ["Emulate iPad", "Develop · this tab", "dev", { tool: "device", value: "ipad" }],
  ["Back to Window Size", "Develop · this tab", "dev", { tool: "device" }],
  ["Page in Dark Mode", "Develop · this tab", "dev", { tool: "scheme", value: "dark" }],
  ["Page in Light Mode", "Develop · this tab", "dev", { tool: "scheme", value: "light" }],
  ["Slow 3G", "Develop · this tab", "dev", { tool: "network", value: "slow3g" }],
  ["No Network Throttling", "Develop · this tab", "dev", { tool: "network" }],
  ["Clear Data for This Site", "Develop", "dev-clear-site"],
  ["Open Page in Safari", "Develop", "dev-open-in", { browser: "Safari" }],
  ["Open Page in Chrome", "Develop", "dev-open-in", { browser: "Google Chrome" }],
];
function openPalette(mode = "new", value = "") {
  paletteMode = mode;
  paletteIndex = 0;
  window.wing.invoke("local-servers").then((data) => {
    localServers = data?.servers || [];
    if (modalType === "palette") renderPalette();
  }, () => {});
  window.wing.invoke("library-data").then((data) => {
    state = { ...state, ...data };
    if (modalType === "palette") renderPalette();
  });
  showModal(
    "palette",
    `<div class="palette-input-wrap">${icon("search")}<input id="palette-input" placeholder="Search or enter website name" aria-label="Search or enter URL" autocomplete="off" spellcheck="false"><kbd>esc</kbd></div><div class="results" id="palette-results"></div><div class="palette-footer"><span><kbd>↑</kbd><kbd>↓</kbd> to navigate <kbd>↵</kbd> to open</span><span><kbd>⇥</kbd> to search a site</span></div>`,
  );
  $("#palette-input").value = value || "";
  $("#palette-input").addEventListener("input", () => {
    paletteIndex = 0;
    renderPalette();
  });
  $("#palette-input").addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      paletteIndex =
        (paletteIndex +
          (e.key === "ArrowDown" ? 1 : -1) +
          paletteResults.length) %
        paletteResults.length;
      renderPalette(false);
    } else if (e.key === "Enter") {
      e.preventDefault();
      runResult(paletteIndex);
    }
  });
  renderPalette();
  $("#palette-input").focus();
  $("#palette-input").select();
}
function renderPalette(rebuild = true) {
  const q = $("#palette-input").value.trim(),
    lower = q.toLowerCase();
  if (rebuild) {
    const commands = [
      ...(window.wingFeatures?.commands() || []),
      {
        label: "Add Split View",
        detail: "Two pages, one train of thought",
        glyph: "split",
        run: () => openSplit(),
      },
      ...(state.splitId
        ? [
            {
              label: "Separate Split View",
              detail: "Put these pages back in their own tabs",
              glyph: "split",
              run: () => {
                closeModal();
                act("split-dissolve");
              },
            },
          ]
        : []),
      ...localServers.map(({ port, command }) => ({
        label: `localhost:${port}`,
        detail: `Local server · ${command}`,
        glyph: "globe",
        run: () => {
          closeModal();
          act("new-tab", { url: `http://localhost:${port}` });
        },
      })),
      {
        label: "New Mini Window",
        detail: "A quick look, outside your tabs  ⌥⌘N",
        glyph: "globe",
        run: () => {
          closeModal();
          act("mini-window");
        },
      },
      {
        label: "Pull Requests",
        detail: "Your reviews and open PRs, always current",
        glyph: "split",
        run: () => {
          closeModal();
          act("pulls-open");
        },
      },
      {
        label: "Block Requests…",
        detail: "Develop · this tab",
        glyph: "settings",
        run: () =>
          askText("Block requests", "*analytics*, *.example.com/ads/*  (empty turns it off)", (value) =>
            act("dev", { tool: "block", value }),
          ),
      },
      ...(/^https?:/.test(current()?.url || "")
        ? localServers.map(({ port }) => ({
            label: `Open This Page on localhost:${port}`,
            detail: "Develop",
            glyph: "globe",
            run: () => {
              closeModal();
              act("dev-local", { port });
            },
          }))
        : []),
      ...DEV_COMMANDS.map(([label, detail, name, data]) => ({
        label,
        detail,
        glyph: "settings",
        run: () => {
          closeModal();
          act(name, data);
        },
      })),
      {
        label: "Edit This Space",
        detail: "Change its name, icon, or color",
        glyph: "more",
        run: () => openSpace(currentSpace()),
      },
      {
        label: "New Space",
        detail: "A fresh context for a different part of your day",
        glyph: "sparkle",
        run: () => openSpace(),
      },
      {
        label: "New Folder",
        detail: "Keep your pinned tabs together",
        glyph: "folder",
        run: () => openFolder(),
      },
      {
        label: "History & Archive",
        detail: "Find your way back",
        glyph: "clock",
        run: () => openLibrary(),
      },
      {
        label: "Downloads",
        detail: "Your downloaded files",
        glyph: "download",
        run: () => openLibrary("downloads"),
      },
      {
        label: "Show Reader",
        detail: "Read the article without clutter  ⇧⌘R",
        glyph: "library",
        run: () => {
          closeModal();
          toggleReader();
        },
      },
      {
        label: "New Private Window",
        detail: "Browse without saving history  ⇧⌘N",
        glyph: "lock",
        run: () => {
          closeModal();
          act("private-window");
        },
      },
      {
        label: "Show Full History",
        detail: "Every visit, grouped by day",
        glyph: "clock",
        run: () => openInternal("wing://history"),
      },
      {
        label: "Clear Browsing Data",
        detail: "History, cookies and cached files",
        glyph: "lock",
        run: () => openClearHistory(),
      },
      {
        label: "Passwords",
        detail: "Saved logins for this profile",
        glyph: "key",
        run: () => openInternal("wing://passwords"),
      },
      {
        label: "Performance Monitor",
        detail: "Live CPU, memory, and tab lifecycle",
        glyph: "settings",
        run: () => openPerformance(),
      },
      {
        label: "Settings",
        detail: "Make Wing feel like you",
        glyph: "settings",
        run: () => openSettings(),
      },
      {
        label: "Move Tabs to " + (state.settings.tabLayout === "top" ? "Sidebar" : "Top Bar"),
        detail: "Switch between Safari-style and Arc-style tabs",
        glyph: "sidebar",
        run: () => {
          closeModal();
          act("tab-layout", {
            layout: state.settings.tabLayout === "top" ? "sidebar" : "top",
          });
        },
      },
      {
        label: "Toggle Sidebar",
        detail: "Give the page a little more room",
        glyph: "sidebar",
        run: () => {
          closeModal();
          act("sidebar");
        },
      },
      {
        label: "Pin This Tab",
        detail: "Keep it for another day",
        glyph: "pin",
        run: () => {
          closeModal();
          act("pin");
        },
      },
      {
        label: "Style This Website",
        detail: "Your own CSS, saved for this site",
        glyph: "sparkle",
        run: () => openBoost(),
      },
      {
        label: "New Home Tab",
        detail: "A quiet place to start",
        glyph: "home",
        run: () => {
          closeModal();
          act("new-tab");
        },
      },
    ];
    const spaceName = (id) => state.spaces.find((s) => s.id === id)?.name || "";
    const openAction = paletteMode === "navigate" ? "navigate" : "new-tab";
    const flatten = (nodes = []) =>
      nodes.flatMap((n) =>
        n.url
          ? [
              {
                kind: "bookmark",
                title: n.title,
                url: n.url,
                at: n.dateLastUsed || n.dateAdded,
              },
            ]
          : flatten(n.children),
      );
    const profileId = currentSpace().profileId;
    const pages = (
      q
        ? window.wing.navigation.rankResults(q, [
            ...state.tabs
              .filter((t) => !t.transient && t.url !== "wing://home")
              .map((t) => ({
                kind: t.kind === "today" ? "tab" : "saved",
                id: t.id,
                title: t.customTitle || t.title,
                url: t.url,
                at: t.lastActive,
                tab: t,
              })),
            ...flatten(state.bookmarks),
            ...(state.history || [])
              .filter(
                (h) => h.profileId === undefined || h.profileId === profileId,
              )
              .map((h) => ({
                kind: "history",
                title: h.title || h.url,
                url: h.url,
                visits: h.visitCount,
                typed: h.typedCount,
                at: h.at,
              })),
          ])
        : state.tabs
            .filter((t) => !t.transient)
            .sort((a, b) => b.lastActive - a.lastActive)
            .map((t) => ({
              kind: "tab",
              id: t.id,
              title: t.title,
              url: t.url,
              tab: t,
            }))
    )
      .slice(0, 9)
      .map((page) =>
        page.tab
          ? {
              label: page.title,
              detail: host(page.url) + " · " + spaceName(page.tab.spaceId),
              siteTab: page.tab,
              hint: "Switch to Tab",
              topHit: page.topHit,
              run: () => {
                closeModal();
                act("select-tab", { id: page.tab.id });
              },
            }
          : {
              label: page.title,
              detail: page.term ? `Searched on ${host(page.url)}` : host(page.url),
              siteTab: { url: page.url },
              hint: page.term
                ? "Search"
                : page.kind === "bookmark"
                  ? "Bookmark"
                  : "History",
              topHit: page.topHit,
              run: () => {
                closeModal();
                act(openAction, { url: page.url });
              },
            },
      );
    const spaces = state.spaces
      .filter((s) => s.name.toLowerCase().includes(lower))
      .map((s) => ({
        label: s.name,
        detail: "Switch Space",
        symbol: s.icon,
        hint: "Space",
        run: () => {
          closeModal();
          act("space", { id: s.id });
        },
      }));
    const matched = commands.filter((c) =>
      c.label.toLowerCase().includes(lower),
    );
    const nav = {
      label: q,
      detail: /^(https?:\/\/\S+|localhost(:\d+)?(\/\S*)?|[\w-]+(\.[\w-]+)*\.[a-z]{2,}(:\d+)?([/?#]\S*)?)$/i.test(q)
        ? "Go to address"
        : `Search ${state.settings.search === "duckduckgo" ? "DuckDuckGo" : "Google"}`,
      glyph: "search",
      hint: "↵",
      run: () => {
        const action = paletteMode === "navigate" ? "navigate" : "new-tab";
        closeModal();
        act(action, { url: q });
      },
    };
    paletteResults = q
      ? [...pages, ...spaces, ...matched].slice(0, 12)
      : [...pages.slice(0, 3), ...commands.slice(0, 3)];
    const calculation = window.wing.navigation.calculate(q);
    if (calculation !== null)
      paletteResults.unshift({
        label: String(calculation),
        detail: q,
        glyph: "sparkle",
        hint: "Copy result",
        run: () => {
          act("copy-text", { text: String(calculation) });
          closeModal();
          toast("Result copied.");
        },
      });
    // Safari's Top Hit: a site whose address starts with what you typed opens on ↵.
    if (q && paletteResults[0]?.topHit) {
      paletteResults[0] = { ...paletteResults[0], hint: "Top Hit" };
      paletteResults.splice(1, 0, nav);
    } else if (q) {
      const exact = paletteResults.findIndex(
        (r) => !r.siteTab && r.label.toLowerCase() === lower,
      );
      if (exact >= 0) {
        const [match] = paletteResults.splice(exact, 1);
        paletteResults.unshift(match);
        paletteResults.splice(1, 0, nav);
      } else paletteResults.unshift(nav);
    }
  }
  $("#palette-results").innerHTML = paletteResults
    .map(
      (r, i) =>
        `<button class="result ${i === paletteIndex ? "selected" : ""}" data-result="${i}"><span class="result-icon">${r.siteTab ? tabIcon(r.siteTab) : r.symbol ? esc(r.symbol) : icon(r.glyph)}</span><span class="result-label"><strong>${esc(r.label)}</strong><small>${esc(r.detail)}</small></span><kbd>${esc(r.hint || "Command")}</kbd></button>`,
    )
    .join("");
}
function runResult(i) {
  paletteResults[i]?.run();
}
function openSpace(space = null) {
  const s = structuredClone(
    space || {
      name: "",
      icon: "✳",
      theme: "lavender",
      profileId: "default",
    },
  );
  s.colors ||= { light: {}, dark: {} };
  showModal(
    "space",
    `<form id="space-form" class="dialog-content">${dialogHead(space ? "Edit Space" : "New Space")}<p>Separate the different parts of your day. Each Space has its own tabs, folders, and color.</p><div class="form-row"><label class="field" style="max-width:85px"><span>Icon</span><input name="icon" id="space-icon" value="${esc(s.icon)}" aria-label="Space icon"></label><label class="field"><span>Space name</span><input name="name" placeholder="Work, weekends, a big idea…" value="${esc(s.name)}" required maxlength="60" autofocus></label></div><div class="field"><span>Icon or emoji</span><div class="emoji-grid">${[...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(SPACE_EMOJI.join(""))].map(({ segment }) => `<button type="button" class="emoji-choice" data-emoji="${segment}" aria-label="Use ${segment}">${segment}</button>`).join("")}${window.wing.engine === "chromium" ? "" : `<button type="button" class="secondary" id="emoji-panel">More…</button>`}</div></div><div class="field"><span>Color</span><div class="swatches">${Object.entries(
      palettes,
    )
      .map(
        ([key, c]) =>
          `<button type="button" class="swatch ${key === s.theme ? "selected" : ""}" data-theme="${key}" style="background:linear-gradient(135deg,${c[0]},${c[1]})" title="${key}" aria-label="${key}"></button>`,
      )
      .join(
        "",
      )}<label class="swatch custom-swatch" title="Custom color"><input type="color" id="custom-color" value="${esc(s.colors.light?.accent?.slice(0, 7) || "#5b4bd6")}" aria-label="Custom color"></label></div><input type="hidden" name="theme" value="${s.theme}"></div><details class="theme-editor"><summary>Customize every interface color</summary><div class="theme-editor-head"><select id="color-mode" aria-label="Color appearance"><option value="light">Light appearance</option><option value="dark">Dark appearance</option></select><button type="button" class="secondary" id="reset-colors">Reset colors</button></div><div id="color-fields" class="color-fields"></div><p>Colors apply to Wing’s interface in this Space. Website colors stay under the site’s control.</p></details><label class="field"><span>Browser profile</span><select name="profileId">${state.profiles.map((p) => `<option value="${p.id}" ${p.id === s.profileId ? "selected" : ""}>${esc(p.name)}</option>`).join("")}<option value="new">Create a separate profile</option></select></label><p style="font-size:11px;color:var(--muted)">Spaces using the same profile share logins and favorites. A separate profile starts with a clean session.</p><div class="dialog-actions">${space && state.spaces.length > 1 ? '<button type="button" class="danger" id="delete-space">Archive & remove Space</button>' : ""}<button type="button" class="secondary" data-dismiss>Cancel</button><button class="primary">${space ? "Save changes" : "Create Space"}</button></div></form>`,
  );
  $("#space-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target));
    if (space) data.id = space.id;
    data.colors = s.colors;
    const r = await act("save-space", data);
    if (!r?.error) closeModal();
  });
  $("#modal")
    .querySelectorAll("[data-theme]")
    .forEach(
      (b) =>
        (b.onclick = () => {
          $("[name=theme]").value = b.dataset.theme;
          s.theme = b.dataset.theme;
          // A preset replaces any custom frame color; other overrides stay.
          for (const mode of ["light", "dark"])
            for (const key of ["sidebar", "frame", "accent", "focus"])
              delete s.colors[mode]?.[key];
          drawColorFields();
          previewColors();
          $("#modal")
            .querySelectorAll(".swatch")
            .forEach((el) => el.classList.toggle("selected", el === b));
        }),
    );
  // One picked color becomes a soft gradient for light and a deep one for dark.
  const mixHex = (hex, target, amount) =>
    "#" +
    [1, 3, 5]
      .map((i) =>
        Math.round(
          parseInt(hex.slice(i, i + 2), 16) * (1 - amount) + target * amount,
        )
          .toString(16)
          .padStart(2, "0"),
      )
      .join("");
  $("#custom-color").oninput = (e) => {
    const c = e.target.value;
    s.colors.light = {
      ...s.colors.light,
      sidebar: mixHex(c, 255, 0.72),
      frame: mixHex(c, 255, 0.82),
      accent: c,
      focus: c,
    };
    s.colors.dark = {
      ...s.colors.dark,
      sidebar: mixHex(c, 20, 0.78),
      frame: mixHex(c, 20, 0.68),
      accent: mixHex(c, 255, 0.45),
      focus: mixHex(c, 255, 0.45),
    };
    $("#modal")
      .querySelectorAll(".swatch.selected")
      .forEach((el) => el.classList.remove("selected"));
    drawColorFields();
    previewColors();
  };
  $("#modal")
    .querySelectorAll("[data-emoji]")
    .forEach(
      (b) =>
        (b.onclick = () => {
          $("#space-icon").value = b.dataset.emoji;
        }),
    );
  if ($("#emoji-panel"))
    $("#emoji-panel").onclick = () => {
      $("#space-icon").value = "";
      $("#space-icon").focus();
      act("emoji-panel");
    };
  const colorMode = () => $("#color-mode").value;
  function previewColors() {
    themePreview = { space: s, dark: colorMode() === "dark" };
    render();
  }
  function drawColorFields() {
    const resolved = window.wing.theme.resolve(s, colorMode() === "dark");
    $("#color-fields").innerHTML = window.wing.theme.fields
      .map((field) => {
        const value =
          s.colors[colorMode()]?.[field.key] || resolved[field.cssVar];
        return `<label class="color-field"><span>${esc(field.label)}</span><input type="color" value="${esc(value.slice(0, 7))}" data-color="${field.key}" aria-label="${esc(field.label)} color"><input type="text" value="${esc(value)}" data-color-text="${field.key}" aria-label="${esc(field.label)} hexadecimal color" pattern="#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?" maxlength="9"></label>`;
      })
      .join("");
    $("#color-fields").oninput = (e) => {
      const key = e.target.dataset.color || e.target.dataset.colorText;
      if (!key) return;
      const value = e.target.value;
      if (!/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(value)) {
        e.target.setCustomValidity("Use #RRGGBB or #RRGGBBAA");
        return;
      }
      e.target.setCustomValidity("");
      s.colors[colorMode()] ||= {};
      s.colors[colorMode()][key] = value;
      const row = e.target.closest(".color-field");
      row.querySelector("[type=color]").value = value.slice(0, 7);
      row.querySelector("[type=text]").value = value;
      previewColors();
    };
  }
  $("#color-mode").value = state.settings.dark ? "dark" : "light";
  $("#color-mode").onchange = () => {
    drawColorFields();
    previewColors();
  };
  $("#reset-colors").onclick = () => {
    s.colors[colorMode()] = {};
    drawColorFields();
    previewColors();
  };
  drawColorFields();
  if ($("#delete-space"))
    $("#delete-space").onclick = async () => {
      await act("delete-space", { id: space.id });
      closeModal();
    };
  $("[name=name]").focus();
}
function openFolder() {
  showModal(
    "folder",
    `<form id="folder-form" class="dialog-content">${dialogHead("New folder")}<p>Create a folder, then drag tabs into it or use their right-click menu.</p><label class="field"><span>Folder name</span><input name="name" placeholder="Research" required maxlength="80"></label><div class="dialog-actions"><button class="primary">Create folder</button></div></form>`,
  );
  $("#folder-form").onsubmit = (e) => {
    e.preventDefault();
    act("folder", { name: new FormData(e.target).get("name") });
    closeModal();
  };
  $("[name=name]").focus();
}
function openRename(id, value) {
  showModal(
    "rename",
    `<form id="rename-form" class="dialog-content">${dialogHead("Rename tab")}<label class="field"><span>Tab name</span><input name="value" value="${esc(value)}" required maxlength="200"></label><div class="dialog-actions"><button class="primary">Save name</button></div></form>`,
  );
  $("#rename-form").onsubmit = (e) => {
    e.preventDefault();
    act("rename-tab", { id, value: new FormData(e.target).get("value") });
    closeModal();
  };
  $("[name=value]").focus();
  $("[name=value]").select();
}
function openSplit() {
  const ids = state.splitIds || [state.activeTabId];
  const candidates = tabsForSpace().filter(
    (t) =>
      !ids.includes(t.id) && t.url !== "wing://home" && t.url !== "wing://pulls",
  );
  showModal(
    "split",
    `<div class="dialog-content">${dialogHead("Split view")}<p>Keep up to three pages together. Your layout returns when you return to any pane.</p><label class="field"><span>Split direction</span><select id="split-orientation"><option value="horizontal">Horizontal — side by side</option><option value="vertical">Vertical — stacked</option></select></label>${
      state.splitId
        ? `<div class="split-members">${ids
            .map((id) => {
              const tab = state.tabs.find((t) => t.id === id);
              return `<div class="setting-row"><span>${esc(tab?.title || "Page")}</span><button class="secondary" data-remove-pane="${id}">Separate</button></div>`;
            })
            .join(
              "",
            )}</div><button class="secondary" id="remove-split">Separate all pages</button>`
        : ""
    }<div class="results">${ids.length >= 3 ? '<div class="empty">Three pages are open. Separate a pane to add another.</div>' : candidates.map((t) => `<button class="result" data-split-tab="${t.id}"><span class="result-icon">${tabIcon(t)}</span><span class="result-label"><strong>${esc(t.title)}</strong><small>${esc(host(t.url))}</small></span>${icon("split")}</button>`).join("") || '<div class="empty">Open another website, then bring it into Split View.</div>'}</div></div>`,
  );
  $("#modal")
    .querySelectorAll("[data-split-tab]")
    .forEach(
      (b) =>
        (b.onclick = () => {
          const orientation = $("#split-orientation").value;
          closeModal();
          act("split", { id: b.dataset.splitTab, orientation });
        }),
    );
  $("#modal")
    .querySelectorAll("[data-remove-pane]")
    .forEach(
      (b) =>
        (b.onclick = () => {
          closeModal();
          act("split-remove-pane", { id: b.dataset.removePane });
        }),
    );
  $("#split-orientation").value = state.splitOrientation || "horizontal";
  $("#split-orientation").onchange = (e) =>
    act("split-orientation", { orientation: e.target.value });
  if ($("#remove-split"))
    $("#remove-split").onclick = () => {
      closeModal();
      act("split");
    };
}
function renderUpdateStatus(status) {
  if (modalType !== "settings" || !status?.state || !$("#update-status"))
    return;
  $("#update-status").textContent = status.message;
  $("#update-check").disabled = [
    "unconfigured",
    "checking",
    "downloading",
  ].includes(status.state);
  $("#update-check").textContent =
    status.state === "ready" ? "Restart & Update" : "Check Now";
  $("#update-check").onclick = () =>
    act(status.state === "ready" ? "updates-install" : "updates-check").then(
      renderUpdateStatus,
    );
}
// Settings: one window with a pane sidebar and search, like Safari's.
let settingsPane = "general";
const SHORTCUTS = [
  ["New tab / command bar", "⌘T"],
  ["Open location", "⌘L"],
  ["Close tab", "⌘W"],
  ["Reopen closed tab", "⇧⌘T"],
  ["Show next / previous tab", "⇧⌘] / ⇧⌘["],
  ["Go to tab 1–8 / last tab", "⌘1–8 / ⌘9"],
  ["Recent tabs", "⌃Tab"],
  ["Switch profile 1–9", "⌃1–9"],
  ["Go to tab 1–8 / last tab", "⌘1–8 / ⌘9"],
  ["Previous / next Space", "⌥⌘← / ⌥⌘→"],
  ["Pin / unpin tab", "⌘D"],
  ["Toggle sidebar", "⌘S"],
  ["Move tabs between top bar and sidebar", "⌥⌘S"],
  ["Split view", "⇧⌘2"],
  ["Find / next / previous", "⌘F / ⌘G / ⇧⌘G"],
  ["Back / forward", "⌘[ / ⌘]"],
  ["Reload / stop", "⌘R / ⌘."],
  ["Zoom in / out / actual size", "⌘+ / ⌘− / ⌘0"],
  ["Copy page address", "⇧⌘C"],
  ["History / downloads", "⌘Y / ⇧⌘J"],
  ["Print", "⌘P"],
  ["Settings", "⌘,"],
  ["Developer tools", "⌥⌘I / ⌥⌘J"],
  ["Reload ignoring cache", "⇧⌘R"],
  ["View page source", "⌥⌘U"],
  ["Full screen", "⌃⌘F"],
];
// The row's cross removes a pinned page; ⌘W only closes it and keeps the row.
function closeFromRow(button) {
  const id = button.dataset.close,
    tab = state.tabs.find((t) => t.id === id),
    pinned = tab?.kind === "pinned" || tab?.kind === "favorite",
    remove = pinned && !button.closest(".is-split");
  act("close-tab", { id, archive: remove });
  if (remove) toast("Removed. You can restore it from History & Archive.");
}
// The Pull Requests smart tab.
const PR_CI = {
  passing: ["Checks passing", "good"],
  failing: ["Checks failing", "bad"],
  pending: ["Checks running", "wait"],
};
const PR_REVIEW = {
  approved: ["Approved", "good"],
  changes: ["Changes requested", "bad"],
  waiting: ["Review needed", "wait"],
};
let pullsData = null,
  pullsBusy = false;
function prAge(at) {
  const minutes = Math.max(0, (Date.now() - Date.parse(at)) / 60000);
  if (!Number.isFinite(minutes)) return "";
  if (minutes < 60) return `${Math.round(minutes)}m`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}h`;
  return `${Math.round(minutes / 1440)}d`;
}
function prRow(p) {
  const badge = ([text, tone]) =>
    `<span class="pr-badge ${tone}">${esc(text)}</span>`;
  const badges = [
    p.draft && badge(["Draft", "quiet"]),
    p.conflict && badge(["Conflicts", "bad"]),
    PR_CI[p.ci] && badge(PR_CI[p.ci]),
    PR_REVIEW[p.review] && badge(PR_REVIEW[p.review]),
  ]
    .filter(Boolean)
    .join("");
  const size = p.additions || p.deletions ? ` · +${p.additions} −${p.deletions}` : "";
  const notes = p.comments ? ` · ${p.comments} ${p.comments === 1 ? "comment" : "comments"}` : "";
  return `<button class="pr-row" data-pr-url="${esc(p.url)}"><span class="pr-main"><strong>${esc(p.title)}</strong><small>${esc(p.repo)} #${esc(String(p.number))}${p.author ? ` · ${esc(p.author)}` : ""} · ${prAge(p.updatedAt)}${size}${notes}</small></span><span class="pr-badges">${badges}</span></button>`;
}
function renderPulls() {
  const data = pullsData;
  const section = (title, items) =>
    items.length
      ? `<div class="section-label">${title} · ${items.length}</div>${items.map(prRow).join("")}`
      : "";
  const notices = (data?.providers || [])
    .filter((p) => p.status !== "ok")
    .map((p) => `<p class="pr-notice">${esc(p.message)}</p>`)
    .join("");
  const body = !data
    ? "<p class=\"pr-notice\">Fetching pull requests…</p>"
    : section("NEEDS YOUR REVIEW", data.items.filter((p) => p.section === "review")) +
        section("YOURS", data.items.filter((p) => p.section === "mine")) ||
      (data.providers.some((p) => p.status === "ok")
        ? "<p class=\"pr-notice\">No open pull requests.</p>"
        : "");
  $("#pulls").innerHTML = `<div class="pr-page"><div class="pr-head"><h1>Pull Requests</h1><button class="secondary" id="pulls-refresh" ${pullsBusy ? "disabled" : ""}>${pullsBusy ? "Refreshing…" : "Refresh"}</button></div>${body}${notices}</div>`;
  $("#pulls-refresh").onclick = refreshPulls;
  $("#pulls").querySelectorAll("[data-pr-url]").forEach((row) => {
    row.onclick = () => act("new-tab", { url: row.dataset.prUrl });
  });
}
async function refreshPulls() {
  if (pullsBusy) return;
  pullsBusy = true;
  renderPulls();
  const data = await act("pulls-data");
  pullsBusy = false;
  if (data && !data.error) pullsData = data;
  renderPulls();
}
setInterval(() => {
  if (!document.hidden && state?.tabs.some((t) => t.url === "wing://pulls"))
    refreshPulls();
}, 120000);
const APP_ICONS = [
  ["violet", "Violet"],
  ["midnight", "Midnight"],
  ["paper", "Paper"],
  ["coral", "Coral"],
  ["ocean", "Ocean"],
  ["forest", "Forest"],
  ["gold", "Gold"],
];
function settingRow(label, detail, control, keywords = "") {
  return `<div class="setting-row" data-search="${esc((label + " " + detail + " " + keywords).toLowerCase())}"><span>${label}${detail ? `<small>${detail}</small>` : ""}</span>${control}</div>`;
}
function settingToggle(id, label, detail, checked, keywords) {
  return `<label class="setting-row" data-search="${esc((label + " " + detail + " " + (keywords || "")).toLowerCase())}"><span>${label}${detail ? `<small>${detail}</small>` : ""}</span><input type="checkbox" class="switch" id="${id}" ${checked ? "checked" : ""}></label>`;
}
function settingSelect(id, label, detail, choices, value) {
  return settingRow(
    label,
    detail,
    `<select id="${id}">${choices.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(value) ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>`,
  );
}
function settingsPanes() {
  const s = state.settings;
  const chromium = window.wing.engine === "chromium";
  return [
    {
      id: "general",
      title: "General",
      icon: "settings",
      html:
        settingSelect(
          "appearance",
          "Appearance",
          "",
          [
            ["system", "Follow system"],
            ["light", "Light"],
            ["dark", "Dark"],
          ],
          s.appearance || (s.dark ? "dark" : "light"),
        ) +
        (settingRow(
              "App icon",
              "Shown in the Dock while Wing is open.",
              `<div class="app-icons" role="radiogroup" aria-label="App icon">${APP_ICONS.map(
                ([id, label], i) =>
                  `<button type="button" data-app-icon="${id}" title="${label}" aria-label="${label}" class="${(APP_ICONS.some(([x]) => x === s.appIcon) ? s.appIcon : "violet") === id ? "selected" : ""}"><img src="../assets/icons/${id}.png" alt=""></button>`,
              ).join("")}</div>`,
              "logo dock icon variant",
            )) +
        settingSelect(
          "search-engine",
          "Search engine",
          "Used for searches from the command bar.",
          [
            ["google", "Google"],
            ["duckduckgo", "DuckDuckGo"],
          ],
          s.search,
        ) +
        (settingToggle(
              "links-in-mini",
              "Open links from other apps in a mini window",
              "Take a quick look without leaving what you're doing.",
              s.linksInMini !== false,
              "little arc mini wing external",
            )) +
        settingRow(
          "Default web browser",
          "Open links from other apps in Wing.",
          `<button class="secondary" id="make-default">Set as Default</button>`,
          "default",
        ) +
        settingRow(
          "Download location",
          esc(s.downloadDirectory || "Downloads folder"),
          `<button class="secondary" id="download-directory">Choose…</button>`,
          "downloads folder",
        ) +
        settingRow(
          "Import from another browser",
          "Bring bookmarks, history, logins and Spaces from Arc or Chrome.",
          `<button class="secondary" id="browser-import-button">Import…</button>`,
          "arc chrome",
        ) +
        settingRow(
          "Workspace backup",
          "Tabs, Spaces, history and site styles. Not cookies or passwords.",
          `<div class="setting-buttons"><button class="secondary" id="export-data">Export…</button><button class="secondary" id="import-data">Restore…</button></div>`,
          "export import backup",
        ),
    },
    {
      id: "tabs",
      title: "Tabs",
      icon: "split",
      html:
        settingSelect(
          "archive-hours",
          "Archive idle tabs",
          "Pinned tabs, favorites and active pages are never archived.",
          [
            [12, "After 12 hours"],
            [24, "After 24 hours"],
            [168, "After 7 days"],
            [0, "Never"],
          ],
          s.archiveHours,
        ) +
        settingSelect(
          "tab-layout",
          "Tab position",
          "Keep tabs in a Safari-style top bar or an Arc-style sidebar. ⌥⌘S switches.",
          [
            ["top", "Top bar"],
            ["sidebar", "Sidebar"],
          ],
          s.tabLayout,
        ) +
        settingToggle(
          "peek-toggle",
          "Peek from pinned tabs",
          "Open links to other sites in a floating preview.",
          s.peekPinned !== false,
        ) +
        settingToggle(
          "pins-collapsed",
          "Collapse pinned section",
          "",
          s.pinnedCollapsed,
        ) +
        settingToggle(
          "toolbar-hidden",
          "Hide top toolbar",
          "Keep only the page and sidebar.",
          s.toolbarHidden,
        ) +
        settingToggle(
          "clean-copy",
          "Remove tracking parameters when copying links",
          "",
          s.cleanCopy !== false,
          "utm clean",
        ) +
        (chromium
          ? settingToggle(
              "automatic-pip",
              "Automatic picture in picture",
              "Playing videos follow you when you switch tabs.",
              s.automaticPictureInPicture,
              "pip video",
            )
          : "") +
        settingRow(
          "Performance",
          `${state.liveTabCount} live tabs · background tabs sleep after 10 minutes`,
          `<button class="secondary" id="performance-button">Open Monitor</button>`,
          "memory sleep",
        ),
    },
    {
      id: "spaces",
      title: "Spaces",
      icon: "library",
      html:
        state.spaces
          .map((sp) =>
            settingRow(
              `${esc(sp.icon)}&nbsp; ${esc(sp.name)}`,
              `${esc(state.profiles.find((p) => p.id === sp.profileId)?.name || "")} profile`,
              `<button class="secondary" data-edit-space="${esc(sp.id)}">Edit…</button>`,
              "space profile",
            ),
          )
          .join("") +
        settingRow(
          "New Space",
          "Each Space can use its own profile, logins and colors.",
          `<button class="secondary" id="new-space-button">New Space…</button>`,
        ) +
        settingRow(
          "Link routing",
          "Send links from specific sites to a chosen Space.",
          `<button class="secondary" id="routing-settings">Edit…</button>`,
          "routes",
        ) +
        settingRow(
          "Site searches",
          "Type a keyword and a space in the command bar, e.g. “yt cats”.",
          `<button class="secondary" id="search-settings">Edit…</button>`,
          "keyword",
        ) +
        settingRow(
          "Folders",
          "Organize pinned tabs in this Space.",
          `<button class="secondary" id="folders-settings">Edit…</button>`,
        ),
    },
    {
      id: "privacy",
      title: "Privacy & Security",
      icon: "lock",
      html:
        (chromium
          ? settingRow(
              "Content blocking",
              "uBlock Origin blocks ads and trackers in every profile.",
              `<button class="secondary" id="protection-settings">Filters…</button>`,
              "ublock ads trackers",
            )
          : "") +
        settingRow(
          "Website permissions",
          "Camera, microphone, location and more for the current site.",
          `<button class="secondary" id="site-preferences">Site Controls…</button>`,
          "permissions camera microphone location",
        ) +
        settingRow(
          "Clear browsing history",
          "Remove history for this profile from Wing.",
          `<button class="danger" id="clear-history">Clear History…</button>`,
          "delete",
        ) +
        `<p class="settings-note">Wing has no account, analytics or cloud sync. Websites and your search engine receive normal browsing requests.</p>`,
    },
    {
      id: "passwords",
      title: "Passwords",
      icon: "key",
      html: `<div id="password-list" class="password-list"><div class="empty">Loading saved passwords…</div></div>`,
    },
    {
      id: "extensions",
      title: "Extensions",
      icon: "sparkle",
      html: settingRow(
        "Extensions",
        "Install from the Chrome Web Store or load an unpacked extension.",
        `<button class="secondary" id="extensions-button">Manage…</button>`,
        "chrome web store",
      ),
    },
    {
      id: "shortcuts",
      title: "Shortcuts",
      icon: "arrow",
      html: `<div class="shortcut-table">${SHORTCUTS.map(([label, keys]) => `<div class="shortcut-row" data-search="${esc((label + " shortcut").toLowerCase())}"><span>${esc(label)}</span><kbd>${esc(keys)}</kbd></div>`).join("")}</div>`,
    },
    {
      id: "about",
      title: "About",
      icon: "home",
      html:
        settingRow(
          "Wing updates",
          `<span id="update-status">Checking release configuration…</span>`,
          `<button class="secondary" id="update-check">Check Now</button>`,
          "update version",
        ) +
        `<div class="about-card"><span class="wing-mark" aria-hidden="true"></span><div><strong>Wing 0.2.0</strong><small>Chromium ${esc(state.versions.chrome)}${chromium ? " · native host" : " · Electron " + esc(state.versions.electron)}</small><small>Independent and open source. Everything is stored on this Mac.</small></div></div>`,
    },
  ];
}
function openSettings(pane = settingsPane) {
  settingsPane = pane;
  const panes = settingsPanes();
  showModal(
    "settings",
    `<div class="settings-window"><nav class="settings-nav"><input id="settings-search" type="search" placeholder="Search" aria-label="Search settings" autocomplete="off" spellcheck="false">${panes.map((p) => `<button data-settings-pane="${p.id}" class="${p.id === pane ? "active" : ""}">${icon(p.icon)}<span>${p.title}</span></button>`).join("")}</nav><section class="settings-body"><div class="dialog-head"><h2 id="settings-title">${panes.find((p) => p.id === pane).title}</h2><button class="icon" data-dismiss aria-label="Close settings">${icon("close")}</button></div><div id="settings-content">${panes.find((p) => p.id === pane).html}</div></section></div>`,
  );
  $("#modal").classList.add("settings-modal");
  bindSettings();
  document
    .querySelectorAll("[data-settings-pane]")
    .forEach((b) => (b.onclick = () => openSettings(b.dataset.settingsPane)));
  $("#settings-search").oninput = (e) => {
    const query = e.target.value.trim().toLowerCase();
    const panesNow = settingsPanes();
    if (!query) {
      $("#settings-title").textContent = panesNow.find(
        (p) => p.id === settingsPane,
      ).title;
      $("#settings-content").innerHTML = panesNow.find(
        (p) => p.id === settingsPane,
      ).html;
    } else {
      // Show matching rows from every pane, grouped under their pane.
      const holder = document.createElement("div");
      const groups = panesNow
        .map((p) => {
          holder.innerHTML = p.html;
          const rows = [...holder.querySelectorAll("[data-search]")].filter(
            (row) =>
              row.dataset.search.includes(query) ||
              p.title.toLowerCase().includes(query),
          );
          return rows.length
            ? `<div class="section-label">${p.title}</div>${rows.map((r) => r.outerHTML).join("")}`
            : "";
        })
        .join("");
      $("#settings-title").textContent = "Search results";
      $("#settings-content").innerHTML =
        groups || `<div class="empty">No settings match “${esc(query)}”.</div>`;
    }
    bindSettings();
  };
}
function openInternal(url) {
  closeModal();
  act("new-tab", { url });
}
function renderPasswords() {
  $("#password-list").innerHTML =
    settingRow(
      "Saved passwords",
      "View, search, edit, export or delete the passwords saved in this profile. macOS asks for your password or Touch ID before showing one.",
      `<button class="primary" id="open-passwords">Open Passwords</button>`,
      "logins keychain",
    ) +
    settingRow(
      "Fill a saved login",
      "Fill your saved account on the current HTTPS page.",
      `<button class="secondary" id="fill-login-button">Fill Login</button>`,
      "autofill",
    ) +
    `<p class="settings-note">Wing offers to save a password when you sign in. Passwords are encrypted with your Mac’s keychain and are never sent to Wing.</p>`;
  $("#open-passwords").onclick = () => openInternal("wing://passwords");
  $("#fill-login-button").onclick = () => {
    closeModal();
    act("fill-login");
  };
}
function openClearHistory() {
  openInternal("wing://clear-data");
}
function bindSettings() {
  const on = (id, event, handler) => {
    const el = document.getElementById(id);
    if (el) el[event] = handler;
  };
  const feature = (key) => (e) =>
    act("features-settings", { [key]: e.target.checked });
  document.querySelectorAll("[data-app-icon]").forEach((button) => {
    button.onclick = () => {
      document
        .querySelectorAll("[data-app-icon]")
        .forEach((b) => b.classList.toggle("selected", b === button));
      act("features-settings", { appIcon: button.dataset.appIcon });
    };
  });
  on("appearance", "onchange", (e) =>
    act("features-settings", { appearance: e.target.value }),
  );
  on("search-engine", "onchange", (e) =>
    act("settings", { search: e.target.value }),
  );
  on("archive-hours", "onchange", (e) =>
    act("settings", { archiveHours: Number(e.target.value) }),
  );
  on("tab-layout", "onchange", (e) =>
    act("tab-layout", { layout: e.target.value }),
  );
  on("peek-toggle", "onchange", (e) =>
    act("settings", { peekPinned: e.target.checked }),
  );
  on("pins-collapsed", "onchange", feature("pinnedCollapsed"));
  on("toolbar-hidden", "onchange", feature("toolbarHidden"));
  on("clean-copy", "onchange", feature("cleanCopy"));
  on("links-in-mini", "onchange", feature("linksInMini"));
  on("automatic-pip", "onchange", feature("automaticPictureInPicture"));
  on("make-default", "onclick", async () => {
    const r = await act("default-browser");
    toast(
      r?.ok
        ? "macOS will ask you to confirm Wing as your default browser."
        : "macOS could not set the default browser.",
    );
  });
  on("download-directory", "onclick", () =>
    act("features-directory").then(() => openSettings("general")),
  );
  on("browser-import-button", "onclick", openBrowserImport);
  on("export-data", "onclick", () => act("export"));
  on("import-data", "onclick", async () => {
    await act("import");
    closeModal();
  });
  on("performance-button", "onclick", openPerformance);
  on("new-space-button", "onclick", () => openSpace());
  document
    .querySelectorAll("[data-edit-space]")
    .forEach(
      (b) =>
        (b.onclick = () =>
          openSpace(state.spaces.find((sp) => sp.id === b.dataset.editSpace))),
    );
  on("routing-settings", "onclick", () => window.wingFeatures.showRoutes());
  on("search-settings", "onclick", () => window.wingFeatures.showSearches());
  on("folders-settings", "onclick", () => window.wingFeatures.showFolders());
  on("protection-settings", "onclick", () => {
    closeModal();
    act("protection-settings");
  });
  on("site-preferences", "onclick", () =>
    window.wingFeatures.showSiteControls(),
  );
  on("clear-history", "onclick", () => openClearHistory());
  on("extensions-button", "onclick", openExtensions);
  on("update-check", "onclick", () =>
    act("updates-check").then(renderUpdateStatus),
  );
  if (document.getElementById("update-status"))
    act("updates-status").then(renderUpdateStatus);
  if (document.getElementById("password-list")) renderPasswords();
}
const IMPORT_DATA = [
  ["bookmarks", "Bookmarks and folders"],
  ["tabs", "Spaces and open tabs"],
  ["history", "History"],
  ["cookies", "Website logins"],
  ["passwords", "Saved passwords"],
];
const IMPORT_NOTES = {
  arc: "Quit Arc for the freshest data. macOS may ask for Keychain access; choose Always Allow to avoid a prompt per profile.",
  chrome:
    "Quit Chrome for the freshest data. macOS may ask for Keychain access; choose Always Allow to avoid a prompt per profile.",
  safari:
    "Wing needs Full Disk Access in System Settings → Privacy & Security. Safari passwords come from a CSV you export from the Passwords app; delete that file afterwards.",
  wing: "Copies a profile from the earlier Wing app.",
};
async function openBrowserImport() {
  showModal(
    "browser-import",
    `<div class="dialog-content">${dialogHead("Import from another browser")}<p>Looking for browsers on this Mac…</p></div>`,
  );
  const result = await act("browser-profiles");
  if (modalType !== "browser-import") return;
  if (result?.error) return toast(result.error);
  // Importing Wing into itself only makes sense when migrating to the native host.
  const profiles = (result.profiles || []).filter(
    (p) => window.wing.engine === "chromium" || p.browser !== "wing",
  );
  const browsers = ["arc", "chrome", "safari", "wing"]
    .map((id) => ({
      id,
      name:
        profiles.find((p) => p.browser === id)?.browserName || "",
      profiles: profiles.filter((p) => p.browser === id),
    }))
    .filter((b) => b.profiles.length);
  showModal(
    "browser-import",
    `<form id="browser-import-form" class="dialog-content">${dialogHead("Import from another browser")}${
      browsers.length
        ? `<div class="import-browsers" role="radiogroup" aria-label="Browser">${browsers
            .map(
              (b, i) =>
                `<label class="import-browser"><input type="radio" name="browser" value="${b.id}" ${i ? "" : "checked"}><span>${esc(b.name)}</span><small class="import-count" data-import-count="${b.id}"></small></label>`,
            )
            .join("")}</div><div id="import-profiles"></div>
      <div class="section-label">WHAT TO BRING</div>${IMPORT_DATA.map(
        ([key, label]) =>
          `<label class="setting-row"><span>${label}</span><input type="checkbox" class="switch" name="${key}" checked></label>`,
      ).join("")}<p id="import-note"></p>`
        : "<p>No Arc, Chrome or Safari data was found on this Mac.</p>"
    }<div id="import-status" role="status"></div><div class="dialog-actions"><button type="button" class="secondary" data-dismiss>Cancel</button><button class="primary" id="import-start" ${browsers.length ? "" : "disabled"}>Import</button></div></form>`,
  );
  if (!browsers.length) return;
  const form = $("#browser-import-form");
  const chosen = () => [...form.querySelectorAll("[name=profile]:checked")];
  // Every browser's list stays in the form, so ticks survive switching browsers.
  const lists = () => [...form.querySelectorAll(".import-browser-profiles")];
  function updateCount() {
    const count = chosen().length;
    $("#import-start").disabled = !count;
    $("#import-start").textContent =
      count > 1 ? `Import ${count} profiles` : "Import";
    for (const list of lists()) {
      const boxes = list.querySelectorAll("[name=profile]"),
        ticked = list.querySelectorAll("[name=profile]:checked").length,
        all = list.querySelector("[data-import-all]");
      if (all) all.checked = ticked === boxes.length;
      form.querySelector(
        `[data-import-count="${list.dataset.browser}"]`,
      ).textContent = ticked ? String(ticked) : "";
    }
  }
  function showBrowser() {
    const id = form.querySelector("[name=browser]:checked").value;
    for (const list of lists()) list.hidden = list.dataset.browser !== id;
    $("#import-note").textContent = IMPORT_NOTES[id] || "";
  }
  $("#import-profiles").innerHTML = browsers
    .map(
      (browser, b) =>
        `<div class="import-browser-profiles" data-browser="${browser.id}"><div class="section-label import-profiles-head"><span>PROFILES</span>${
          browser.profiles.length > 1
            ? `<label><input type="checkbox" data-import-all> Select all</label>`
            : ""
        }</div><div class="import-profile-list">${browser.profiles
          .map(
            (p, i) =>
              `<label class="import-profile"><input type="checkbox" name="profile" value="${esc(p.id)}" data-name="${esc(p.name)}" ${b || i ? "" : "checked"}><span>${esc(p.name)}</span></label>`,
          )
          .join("")}</div></div>`,
    )
    .join("");
  form.querySelectorAll("[name=browser]").forEach((radio) => {
    radio.onchange = showBrowser;
  });
  $("#import-profiles").onchange = (event) => {
    if (event.target.matches("[data-import-all]"))
      event.target
        .closest(".import-browser-profiles")
        .querySelectorAll("[name=profile]")
        .forEach((box) => (box.checked = event.target.checked));
    updateCount();
  };
  showBrowser();
  updateCount();
  form.onsubmit = async (event) => {
    event.preventDefault();
    const values = new FormData(form);
    const options = Object.fromEntries(
      IMPORT_DATA.map(([key]) => [key, values.has(key)]),
    );
    const sources = chosen().map((box) => ({
      id: box.value,
      name: box.dataset.name,
    }));
    form
      .querySelectorAll("button,input,select")
      .forEach((el) => (el.disabled = true));
    const total = {
      bookmarks: 0,
      tabs: 0,
      history: 0,
      cookies: 0,
      passwords: 0,
      skippedCookies: 0,
      skippedPasswords: 0,
    };
    const warnings = new Set(),
      failed = [];
    for (const [index, source] of sources.entries()) {
      $("#import-status").textContent =
        `Importing ${esc(source.name)}${sources.length > 1 ? ` (${index + 1} of ${sources.length})` : ""}… Complete any macOS prompt to continue.`;
      const imported = await act("browser-import", {
        source: source.id,
        options,
      });
      if (modalType !== "browser-import") return;
      if (imported?.error) {
        failed.push(`${source.name}: ${imported.error}`);
        continue;
      }
      for (const key of Object.keys(total))
        total[key] += imported.report[key] || 0;
      imported.report.warnings.forEach((w) => warnings.add(w));
    }
    const done = sources.length - failed.length;
    showModal(
      "browser-import",
      `<div class="dialog-content">${dialogHead(done ? `Imported ${done} ${done === 1 ? "profile" : "profiles"}` : "Import failed")}<p>${total.bookmarks} saved tabs · ${total.tabs} open tabs · ${total.history} history entries</p><p>${total.cookies} website logins · ${total.passwords} passwords</p>${total.skippedCookies || total.skippedPasswords ? `<p>${total.skippedCookies} logins and ${total.skippedPasswords} passwords could not be transferred, so some sites may ask you to sign in again.</p>` : ""}${failed.map((f) => `<p>${esc(f)}</p>`).join("")}${[...warnings].map((w) => `<p>${esc(w)}</p>`).join("")}<div class="dialog-actions"><button class="primary" data-dismiss>Done</button></div></div>`,
    );
  };
}
async function openExtensions() {
  const result = await window.wing.invoke("extensions-list");
  if (result.error) return toast(result.error);
  showModal(
    "extensions",
    `<div class="dialog-content">${dialogHead("Extensions")}<p>Extensions belong to this profile. Install from a Chrome Web Store link or a local unpacked folder. Support varies by extension API.</p><form id="store-extension-form"><label class="field"><span>Chrome Web Store link</span><input id="store-extension-url" type="text" required placeholder="https://chromewebstore.google.com/detail/…" aria-label="Chrome Web Store extension link"></label><div class="dialog-actions"><button class="primary" id="store-extension-submit">Review & install</button><button type="button" class="secondary" id="load-extension">Load unpacked</button></div><p id="store-extension-status" role="status"></p></form><div class="extension-list">${result.extensions.map((e) => `<div class="setting-row"><span>${esc(e.name)}<small>Version ${esc(e.version)}${e.manifestVersion ? ` · Manifest ${e.manifestVersion}` : ""}</small><details class="extension-permissions"><summary>Requested permissions</summary><p>${esc([...(e.permissions || []), ...(e.hostPermissions || [])].join(", ") || "No permissions declared")}</p></details></span><button class="secondary" data-remove-extension="${esc(e.id)}">Remove</button></div>`).join("") || "<p>No extensions installed in this profile.</p>"}</div>${(result.errors || []).map((e) => `<p>${esc(e.error)}</p>`).join("")}<p class="extension-note">${window.wing.engine === "chromium" ? "Full uBlock Origin is built in. Compatibility with other extensions is still being qualified." : "Compatibility is incomplete. uBlock Origin Lite currently fails our blocking test. Some static rules require explicit activation. Verify extensions before relying on them."}</p></div>`,
  );
  $("#store-extension-form").onsubmit = async (event) => {
    event.preventDefault();
    const button = $("#store-extension-submit"),
      status = $("#store-extension-status");
    button.disabled = true;
    status.textContent = "Downloading and verifying the extension signature…";
    const r = await act("extensions-store-install", {
      url: $("#store-extension-url").value,
    });
    if (modalType !== "extensions") return;
    if (r.error) {
      status.textContent = r.error;
      button.disabled = false;
    } else if (r.reviewInStore) closeModal();
    else openExtensions();
  };
  $("#load-extension").onclick = async () => {
    const r = await window.wing.invoke("extensions-install");
    if (r.error) toast(r.error);
    else openExtensions();
  };
  document.querySelectorAll("[data-remove-extension]").forEach(
    (button) =>
      (button.onclick = async () => {
        const r = await window.wing.invoke("extensions-remove", {
          id: button.dataset.removeExtension,
        });
        if (r.error) toast(r.error);
        else openExtensions();
      }),
  );
}
function openPerformance() {
  showModal(
    "performance",
    `<div class="dialog-content">${dialogHead("Performance")}<p>Live process measurements. Sleeping tabs keep their place and reload when you return.</p><label class="setting-row"><span>Background tab budget<small>Active pages, audio, and pages with typed input are protected.<br>The limit is soft when a page needs to stay awake.</small></span><select id="tab-budget">${[4, 8, 16].map((n) => `<option value="${n}" ${(state.settings.maxLiveTabs || 4) === n ? "selected" : ""}>${n} live tabs</option>`).join("")}</select></label><div id="performance-stats" class="performance-stats"></div><div id="process-list"></div><p style="font-size:10px;color:var(--muted);line-height:1.7">Memory shows the sum of process working sets; shared pages can be counted more than once. CPU is sampled while this panel is open. These are diagnostics, not a leak-free guarantee.</p><div class="dialog-actions"><button class="secondary" id="trim-memory">Run memory cleanup</button></div></div>`,
  );
  $("#tab-budget").onchange = (e) =>
    act("settings", { maxLiveTabs: Number(e.target.value) });
  $("#trim-memory").onclick = () => act("trim-memory");
  const refresh = async () => {
    const m = await act("metrics");
    if (modalType !== "performance" || !m?.processes) return;
    const memory = m.processes.reduce((n, p) => n + p.workingSetKB, 0) / 1024,
      cpu = m.processes.reduce((n, p) => n + p.cpu, 0);
    $("#performance-stats").innerHTML =
      `<div><strong>${memory.toFixed(0)}<small> MB</small></strong><span>Working set</span></div><div><strong>${cpu.toFixed(1)}<small>%</small></strong><span>CPU usage</span></div><div><strong>${m.liveViews}<small> / ${m.totalTabs}</small></strong><span>Live / total tabs</span></div>`;
    $("#process-list").innerHTML =
      `<div class="section-label">${m.sleepingTabs} SLEEPING TABS · ${m.processes.length} PROCESSES${savedMemoryLabel(m)}</div>` +
      m.processes
        .map(
          (p) =>
            `<div class="process-row"><span>${esc(p.type)} <small>${p.pid}</small></span><span>${(p.workingSetKB / 1024).toFixed(0)} MB</span><span>${p.cpu.toFixed(1)}%</span></div>`,
        )
        .join("");
  };
  refresh();
  metricsTimer = setInterval(refresh, 1500);
}
// A sleeping tab has no process to measure, so this assumes it would use what
// an average open page uses now.
function savedMemoryLabel(metrics) {
  const pages = metrics.processes.filter((p) => /render|tab/i.test(p.type));
  if (!metrics.sleepingTabs || !pages.length) return "";
  const average =
    pages.reduce((n, p) => n + p.workingSetKB, 0) / pages.length / 1024;
  return ` · ABOUT ${Math.round(average * metrics.sleepingTabs)} MB SAVED`;
}
function openLibrary(tab = "archive") {
  libraryTab = tab;
  window.wing.invoke("library-data").then((data) => {
    state = { ...state, ...data };
    if (modalType === "library") renderLibraryList();
  });
  showModal(
    "library",
    `<div class="dialog-content">${dialogHead("Library")}<div class="library-tabs">${["archive", "history", "downloads"].map((t) => `<button data-library="${t}" class="${t === tab ? "active" : ""}">${t[0].toUpperCase() + t.slice(1)}</button>`).join("")}</div><input class="library-search" id="library-search" placeholder="Find something you left behind…" aria-label="Search library"><div class="library-list" id="library-list"></div></div>`,
  );
  $("#library-search").oninput = renderLibraryList;
  $("#modal")
    .querySelectorAll("[data-library]")
    .forEach((b) => (b.onclick = () => openLibrary(b.dataset.library)));
  renderLibraryList();
  $("#library-search").focus();
}
function renderLibraryList() {
  if (!$("#library-list")) return;
  const q = $("#library-search").value.toLowerCase(),
    profileId = currentSpace().profileId;
  const records = (
    libraryTab === "archive"
      ? state.archive || []
      : libraryTab === "history"
        ? (state.history || []).filter((h) => h.profileId === profileId)
        : state.downloads
  )
    .filter((t) =>
      `${t.title || t.name} ${t.url || ""}`.toLowerCase().includes(q),
    )
    .slice(0, 150);
  if (libraryTab === "downloads" && window.wingFeatures) {
    $("#library-list").innerHTML = window.wingFeatures.downloads(records);
    return;
  }
  $("#library-list").innerHTML =
    records
      .map(
        (t) =>
          `<button class="result" data-library-item="${t.id}"><span class="result-icon">${icon(libraryTab === "downloads" ? "download" : "clock")}</span><span class="result-label"><strong>${esc(t.title || t.name)}</strong><small>${esc(libraryTab === "downloads" ? `${t.status} · ${(t.received / 1048576).toFixed(1)} MB` : host(t.url) + " · " + new Date(t.archivedAt || t.at).toLocaleDateString())}</small></span><kbd>${libraryTab === "archive" ? "Restore" : libraryTab === "downloads" ? "Show in Finder" : "Open"}</kbd></button>`,
      )
      .join("") ||
    `<div class="empty">${libraryTab === "archive" ? "A clean slate. Archived tabs will wait here." : libraryTab === "history" ? "Your browsing history will appear here." : "Your downloads will land here."}</div>`;
  $("#library-list")
    .querySelectorAll("[data-library-item]")
    .forEach(
      (b) =>
        (b.onclick = () => {
          const t = records.find((t) => t.id === b.dataset.libraryItem);
          if (libraryTab === "downloads") act("show-download", { id: t.id });
          else {
            closeModal();
            act(
              libraryTab === "archive" ? "restore" : "new-tab",
              libraryTab === "archive" ? { id: t.id } : { url: t.url },
            );
          }
        }),
    );
}
function openBoost() {
  const t = current();
  if (!t || !/^https?:/.test(t.url)) {
    closeModal();
    toast("Open a website to customize its style.");
    return;
  }
  const origin = new URL(t.url).origin;
  showModal(
    "boost",
    `<form class="dialog-content" id="boost-form">${dialogHead("Site styles")}<p>Write custom CSS for <strong>${esc(host(t.url))}</strong>. It applies whenever you visit this site.</p><label class="field"><span>Site stylesheet</span><textarea name="css" spellcheck="false" placeholder="/* Try a softer background */\nbody { background: #f6f1ea !important; }">${esc(state.boosts[origin] || "")}</textarea></label><p style="font-size:11px;color:var(--muted)">Saving reloads the page. Empty the stylesheet to restore the site’s original appearance.</p><div class="dialog-actions"><button type="button" class="secondary" data-dismiss>Cancel</button><button class="primary">Save & reload</button></div></form>`,
  );
  $("#boost-form").onsubmit = (e) => {
    e.preventDefault();
    act("boost", { css: new FormData(e.target).get("css") });
    closeModal();
  };
}
// First run, for brand-new workspaces only (existing ones have no flag).
function openOnboarding(step = 0) {
  const s = state.settings;
  const finish = () => {
    act("features-settings", { onboarded: true });
    closeModal();
  };
  const steps = [
    {
      body: `<span class="wing-mark onboarding-mark" aria-hidden="true"></span><h2>Welcome to Wing</h2><p>A calmer way to browse. Spaces keep each part of your life separate, tabs tidy themselves away, and everything stays on this Mac.</p>`,
      primary: "Get Started",
    },
    {
      body: `<h2>Bring your browser with you</h2><p>Import bookmarks, history, open tabs and saved passwords from Arc or Chrome. Your other browser stays exactly as it is.</p><button class="secondary onboarding-wide" id="onboarding-import">${icon("download")}<span>Import from Arc or Chrome…</span></button>`,
      primary: "Continue",
    },
    {
      body: `<h2>Make it yours</h2><div class="onboarding-choices" role="radiogroup" aria-label="Appearance">${[
        ["system", "Automatic"],
        ["light", "Light"],
        ["dark", "Dark"],
      ]
        .map(
          ([value, label]) =>
            `<button class="onboarding-choice ${(s.appearance || "system") === value ? "selected" : ""}" role="radio" aria-checked="${(s.appearance || "system") === value}" data-appearance="${value}"><span class="appearance-swatch ${value}"></span>${label}</button>`,
        )
        .join(
          "",
        )}</div><label class="setting-row"><span>Search engine</span><select id="onboarding-search"><option value="google" ${s.search !== "duckduckgo" ? "selected" : ""}>Google</option><option value="duckduckgo" ${s.search === "duckduckgo" ? "selected" : ""}>DuckDuckGo</option></select></label>`,
      primary: "Continue",
    },
    {
      body: `<h2>You’re all set</h2><div class="onboarding-keys">${[
        ["⌘T", "Search or open a website"],
        ["⌘S", "Show or hide the sidebar"],
        ["⌃1–9", "Jump between Spaces"],
        ["⇧⌘N", "Open a private window"],
      ]
        .map(([k, d]) => `<div><kbd>${k}</kbd><span>${d}</span></div>`)
        .join(
          "",
        )}</div><button class="secondary onboarding-wide" id="onboarding-default">${icon("globe")}<span>Make Wing your default browser</span></button>`,
      primary: "Start Browsing",
    },
  ];
  const current = steps[step];
  showModal(
    "onboarding",
    `<div class="dialog-content onboarding" aria-live="polite"><div class="onboarding-body">${current.body}</div><div class="onboarding-footer"><div class="onboarding-dots" aria-label="Step ${step + 1} of ${steps.length}">${steps.map((_, i) => `<span class="${i === step ? "active" : ""}"></span>`).join("")}</div>${step ? `<button class="secondary" id="onboarding-back">Back</button>` : `<button class="secondary" id="onboarding-skip">Skip</button>`}<button class="primary" id="onboarding-next" autofocus>${current.primary}</button></div></div>`,
  );
  $("#modal").classList.add("onboarding-modal");
  $("#onboarding-next").onclick = () =>
    step === steps.length - 1 ? finish() : openOnboarding(step + 1);
  if ($("#onboarding-skip")) $("#onboarding-skip").onclick = finish;
  if ($("#onboarding-back"))
    $("#onboarding-back").onclick = () => openOnboarding(step - 1);
  if ($("#onboarding-import"))
    $("#onboarding-import").onclick = () => {
      act("features-settings", { onboarded: true });
      openBrowserImport();
    };
  document.querySelectorAll("[data-appearance]").forEach(
    (b) =>
      (b.onclick = async () => {
        await act("features-settings", {
          appearance: b.dataset.appearance,
          systemDark: matchMedia("(prefers-color-scheme: dark)").matches,
        });
        openOnboarding(step);
      }),
  );
  if ($("#onboarding-search"))
    $("#onboarding-search").onchange = (e) =>
      act("settings", { search: e.target.value });
  if ($("#onboarding-default"))
    $("#onboarding-default").onclick = async () => {
      const r = await act("default-browser");
      toast(
        r?.ok
          ? "macOS will ask you to confirm Wing as your default browser."
          : "macOS could not set the default browser.",
      );
    };
}
function openHelp() {
  showModal(
    "help",
    `<div class="dialog-content">${dialogHead("Keyboard & navigation")}<p>Move between pages, Spaces, and profiles using these controls.</p><div class="guide-grid">${[
      [
        "sparkle",
        "Find your Space",
        "Use the icons below or swipe horizontally on the sidebar to switch profiles. Edit a Space to customize all interface colors.",
      ],
      [
        "pin",
        "Keep the good stuff",
        "Use the toolbar star to favorite a tab. Right-click for pinning, renaming and folders. Favorites stay with their profile.",
      ],
      [
        "split",
        "Follow two thoughts",
        "Drag a tab onto another to split. Choose side-by-side or stacked panes in the split control. Drop at a tab’s top edge to reorder.",
      ],
      [
        "library",
        "Let the rest go",
        "Today’s idle tabs archive after 12 hours. Restore them anytime from the Library.",
      ],
    ]
      .map(
        ([i, t, d]) =>
          `<div class="guide-card">${icon(i)}<h3>${t}</h3><p>${d}</p></div>`,
      )
      .join(
        "",
      )}</div><div class="shortcuts"><span>Search, switch tabs, or run a command</span><kbd>⌘ T</kbd><span>Previous / next profile</span><kbd>⌘ ⌥ ← / →</kbd><span>Edit the current address</span><kbd>⌘ L</kbd><span>Hide sidebar; hover the left edge to reveal</span><kbd>⌘ S</kbd><span>Archive / restore a tab</span><kbd>⌘ W / ⌘ ⇧ T</kbd><span>Find in page</span><kbd>⌘ F</kbd><span>Settings</span><kbd>⌘ ,</kbd></div></div>`,
  );
}
// Native views sit above the shell. Opening a dialog temporarily hides them.
// The main process remains the source of truth for every browser mutation.
document.addEventListener("click", (e) => {
  const dismiss = e.target.closest("[data-dismiss]");
  if (dismiss) {
    closeModal();
    return;
  }
  const action = e.target.closest("[data-action]");
  if (action) {
    act(action.dataset.action);
    return;
  }
  const mute = e.target.closest("[data-mute]");
  if (mute) {
    act("mute-tab", { id: mute.dataset.mute });
    return;
  }
  const capture = e.target.closest("[data-stop-sharing]");
  if (capture) {
    e.stopPropagation();
    act("stop-sharing", { id: capture.dataset.stopSharing });
    return;
  }
  const separate = e.target.closest("[data-separate-split]");
  if (separate) {
    e.stopPropagation();
    act("split-dissolve", { id: separate.dataset.separateSplit });
    return;
  }
  const close = e.target.closest("[data-close]");
  if (close) {
    e.stopPropagation();
    const row = close.closest("#strip-tabs .tab");
    if (row && !stripReducedMotion.matches) {
      // Hold widths so the next close button lands under the pointer.
      const strip = $("#strip-tabs");
      strip.style.setProperty("--frozen-tab-width", row.offsetWidth + "px");
      strip.classList.add("frozen");
      row.classList.add("closing");
      setTimeout(() => closeFromRow(close), 120);
    } else closeFromRow(close);
    return;
  }
  const tab = e.target.closest("[data-tab]");
  if (tab) {
    if (e.altKey) act("split", { id: tab.dataset.tab });
    else act("select-tab", { id: tab.dataset.tab });
    return;
  }
  const space = e.target.closest("[data-space]");
  if (space) {
    act("space", { id: space.dataset.space });
    return;
  }
  const folder = e.target.closest("[data-folder-toggle]");
  if (folder) {
    act("toggle-folder", { id: folder.dataset.folderToggle });
    return;
  }
  const result = e.target.closest("[data-result]");
  if (result) {
    runResult(Number(result.dataset.result));
    return;
  }
  const url = e.target.closest("[data-url]");
  if (url) act("new-tab", { url: url.dataset.url });
});
document.addEventListener("auxclick", (e) => {
  const tab = e.target.closest("[data-tab]");
  if (
    e.button === 1 &&
    tab &&
    !e.target.closest("button[data-close],button[data-mute]")
  ) {
    e.preventDefault();
    act("close-tab", { id: tab.dataset.tab });
  }
});
document.addEventListener("contextmenu", (e) => {
  const tab = e.target.closest("[data-tab]");
  if (tab) {
    e.preventDefault();
    act("tab-menu", { id: tab.dataset.tab });
  }
  const folder = e.target.closest("[data-folder]");
  if (folder && !tab) {
    e.preventDefault();
    act("folder-menu", { id: folder.dataset.folder });
  }
  const space = e.target.closest("[data-space]");
  if (space) {
    e.preventDefault();
    openSpace(state.spaces.find((s) => s.id === space.dataset.space));
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (modalType) closeModal();
    else if (!$("#find-bar").hidden) closeFind();
    else act("close-peek");
  }
  if (
    (e.key === "Enter" || e.key === " ") &&
    e.target.matches(".tab[data-tab]")
  ) {
    e.preventDefault();
    act("select-tab", { id: e.target.dataset.tab });
  }
  if (e.key === "Tab" && modalType) {
    const focusable = modalFocusable();
    const first = focusable[0],
      last = focusable.at(-1);
    if (!first) {
      e.preventDefault();
      $("#modal").focus();
    } else if (!focusable.includes(document.activeElement)) {
      e.preventDefault();
      (e.shiftKey ? last : first).focus();
    } else if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
});
$("#overlay").onclick = (e) => {
  if (e.target === $("#overlay")) closeModal();
};
$("#new-tab").onclick = () => openPalette();
$("#home-search").onclick = () => openPalette();
$("#address").onclick = () =>
  openPalette(
    "navigate",
    current()?.url === "wing://home" ? "" : current()?.url,
  );
const stripReducedMotion = window.matchMedia(
  "(prefers-reduced-motion: reduce)",
);
const releaseStripWidths = () => $("#strip-tabs").classList.remove("frozen");
$("#tab-strip").addEventListener("pointerleave", releaseStripWidths);
$("#toolbar-add-space").onclick = () => openSpace();
$("#move-tabs-top").onclick = () => act("tab-layout", { layout: "top" });
$("#strip-new-tab").onclick = () => {
  releaseStripWidths();
  $("#new-tab").click();
};
$("#edit-space").onclick = () => openSpace(currentSpace());
$("#add-space").onclick = () => openSpace();
$("#settings-button").onclick = () => openSettings();
$("#library-button").onclick = () => openLibrary();
$("#split-button").onclick = openSplit;
$("#favorite-button").onclick = () =>
  act("favorite", { id: state.activeTabId });
$("#boost-button").onclick = openBoost;
$("#copy-url").onclick = () => {
  act("copy-url");
  toast("Address copied.");
};
$("#clear-today").onclick = () => act("clear-today");
$("#guide-button").onclick = openHelp;
$("#promote-peek").onclick = () => act("promote-peek");
function closeFind() {
  $("#find-bar").hidden = true;
  $("#find-count").textContent = "";
  $("#find-bar").classList.remove("no-match");
  act("find", { text: "" });
}
$("#find-close").onclick = closeFind;
$("#find-input").oninput = (e) => {
  if (!e.target.value) {
    $("#find-count").textContent = "";
    $("#find-bar").classList.remove("no-match");
  }
  act("find", { text: e.target.value });
};
$("#find-input").onkeydown = (e) => {
  if (e.key === "Enter")
    act("find", { text: e.target.value, next: true, forward: !e.shiftKey });
};
$("#find-prev").onclick = () =>
  act("find", { text: $("#find-input").value, next: true, forward: false });
$("#find-next").onclick = () =>
  act("find", { text: $("#find-input").value, next: true });
let dragged = null,
  draggedSpace = null;
function spaceDropBefore(event, dot) {
  const rect = dot.getBoundingClientRect();
  return event.clientX - rect.left < rect.width / 2
    ? dot.dataset.space
    : dot.nextElementSibling?.dataset.space;
}
document.addEventListener("dragstart", (e) => {
  const dot = e.target.closest?.("[data-space]");
  if (dot) {
    draggedSpace = dot.dataset.space;
    e.dataTransfer.setData("text/plain", draggedSpace);
    e.dataTransfer.effectAllowed = "move";
    return;
  }
  const tab = e.target.closest("[data-tab]");
  if (tab) {
    dragged = tab.dataset.tab;
    e.dataTransfer.setData("text/plain", dragged);
    e.dataTransfer.effectAllowed = "move";
  }
});
function clearDropHints() {
  document
    .querySelectorAll(".drop-split,.drop-before,.drop-after,.drop-favorite")
    .forEach((el) =>
      el.classList.remove("drop-split", "drop-before", "drop-after", "drop-favorite"),
    );
}
function dropMode(event, tab) {
  const rect = tab.getBoundingClientRect();
  if (tab.closest("#tab-strip")) {
    const position = (event.clientX - rect.left) / rect.width;
    return position < 0.3 ? "reorder" : position > 0.7 ? "after" : "split";
  }
  return event.clientY - rect.top < Math.min(8, rect.height * 0.22)
    ? "reorder"
    : "split";
}
document.addEventListener("dragover", (e) => {
  if (draggedSpace) {
    const dot = e.target.closest("[data-space]");
    clearDropHints();
    if (dot && dot.dataset.space !== draggedSpace) {
      e.preventDefault();
      const before = spaceDropBefore(e, dot) === dot.dataset.space;
      dot.classList.add(before ? "drop-before" : "drop-after");
    }
    return;
  }
  if (!dragged) return;
  const target = e.target.closest(
    "[data-folder],[data-space],[data-tab],#favorites,#tab-strip",
  );
  if (!target) return;
  e.preventDefault();
  clearDropHints();
  const tab = e.target.closest("[data-tab]");
  if (tab && tab.dataset.tab !== dragged)
    tab.classList.add(
      { split: "drop-split", after: "drop-after" }[dropMode(e, tab)] ||
        "drop-before",
    );
  else if (target.id === "favorites") target.classList.add("drop-favorite");
});
document.addEventListener("drop", (e) => {
  if (draggedSpace) {
    e.preventDefault();
    const dot = e.target.closest("[data-space]"),
      id = draggedSpace;
    draggedSpace = null;
    clearDropHints();
    if (dot && dot.dataset.space !== id)
      act("reorder-space", { id, before: spaceDropBefore(e, dot) });
    return;
  }
  if (!dragged) return;
  e.preventDefault();
  const id = dragged;
  dragged = null;
  clearDropHints();
  const folder = e.target.closest("[data-folder]"),
    space = e.target.closest("[data-space]"),
    tab = e.target.closest("[data-tab]");
  if (space) act("move-tab", { id, spaceId: space.dataset.space });
  else if (tab && tab.dataset.tab !== id) {
    const mode = dropMode(e, tab);
    if (mode === "reorder") act("reorder-tab", { id, before: tab.dataset.tab });
    else if (mode === "after") {
      const next = tab.nextElementSibling?.dataset.tab;
      if (next === id) return;
      act("reorder-tab", next ? { id, before: next } : { id, end: true });
    } else
      act("split", {
        id,
        targetId: tab.dataset.tab,
        orientation: state.splitOrientation || "horizontal",
      });
  } else if (e.target.closest("#favorites"))
    act("favorite", { id, favorite: true });
  else if (folder) act("move-tab", { id, folderId: folder.dataset.folder });
  else if (e.target.closest("#tab-strip")) act("reorder-tab", { id, end: true });
});
document.addEventListener("dragend", () => {
  dragged = null;
  draggedSpace = null;
  clearDropHints();
});
let revealTimer;
const sidebarReducedMotion = window.matchMedia(
  "(prefers-reduced-motion: reduce)",
);
function requestSidebarReveal(visible) {
  clearTimeout(revealTimer);
  if (state?.sidebarHidden)
    act("sidebar-reveal", { visible, animate: !sidebarReducedMotion.matches });
}
function scheduleSidebarHide() {
  clearTimeout(revealTimer);
  if (!state?.sidebarHidden) return;
  revealTimer = setTimeout(() => {
    if (
      !modalType &&
      !dragged &&
      profileSwipeIdle === null &&
      !$("#sidebar").matches(":hover") &&
      !$("#sidebar").contains(document.activeElement)
    )
      requestSidebarReveal(false);
  }, 150);
}
$("#sidebar-edge").addEventListener("pointerenter", () =>
  requestSidebarReveal(true),
);
$("#sidebar-edge").addEventListener("pointerleave", scheduleSidebarHide);
$("#sidebar").addEventListener("pointerenter", () => {
  clearTimeout(revealTimer);
  if (state?.sidebarHidden && !state.sidebarRevealed)
    requestSidebarReveal(true);
});
$("#sidebar").addEventListener("pointerleave", scheduleSidebarHide);
$("#sidebar").addEventListener("focusout", (event) => {
  if (
    state?.sidebarHidden &&
    !$("#sidebar").contains(event.relatedTarget) &&
    !modalType
  )
    scheduleSidebarHide();
});
sidebarReducedMotion.addEventListener("change", () => {
  if (sidebarReducedMotion.matches && state?.sidebarHidden)
    act("sidebar-reveal", { visible: !!state.sidebarRevealed, animate: false });
});
let profileSwipeFrame = null,
  profileSwipeIdle = null,
  profileSwipeSettle = null,
  profileSwipeAcknowledgement = null,
  profileSwipeDirection = 0,
  profileSwipeProgress = 0;
const profileSwipeReducedMotion = window.matchMedia(
  "(prefers-reduced-motion: reduce)",
);
function trackProfileSwipe(progress) {
  profileSwipeProgress = progress;
  if (profileSwipeReducedMotion.matches || profileSwipeFrame !== null) return;
  profileSwipeFrame = requestAnimationFrame(() => {
    profileSwipeFrame = null;
    const sidebar = $("#sidebar");
    clearTimeout(profileSwipeSettle);
    sidebar.classList.remove("profile-swipe-enter", "profile-swipe-settling");
    sidebar.classList.add("profile-swipe-dragging");
    sidebar.style.setProperty(
      "--profile-swipe-offset",
      `${-32 * profileSwipeProgress}px`,
    );
    sidebar.style.setProperty(
      "--profile-swipe-opacity",
      String(1 - Math.abs(profileSwipeProgress) * 0.12),
    );
  });
}
function settleProfileSwipe(direction = 0) {
  if (profileSwipeFrame !== null) cancelAnimationFrame(profileSwipeFrame);
  profileSwipeFrame = null;
  profileSwipeProgress = 0;
  const sidebar = $("#sidebar");
  sidebar.classList.remove("profile-swipe-dragging", "profile-swipe-enter");
  sidebar.style.setProperty("--profile-swipe-offset", "0px");
  sidebar.style.setProperty("--profile-swipe-opacity", "1");
  clearTimeout(profileSwipeSettle);
  if (profileSwipeReducedMotion.matches) {
    sidebar.classList.remove("profile-swipe-settling");
    return;
  }
  if (direction) {
    sidebar.style.setProperty("--profile-swipe-arrival", `${direction * 16}px`);
    sidebar.classList.add("profile-swipe-enter");
  } else sidebar.classList.add("profile-swipe-settling");
  profileSwipeSettle = setTimeout(() => {
    sidebar.classList.remove("profile-swipe-enter", "profile-swipe-settling");
  }, 220);
}
profileSwipeReducedMotion.addEventListener("change", () =>
  settleProfileSwipe(),
);
for (const swipeHost of ["#sidebar", "#tab-strip", "#toolbar"])
$(swipeHost).addEventListener(
  "wheel",
  (event) => {
    if (event.ctrlKey || modalType || dragged || !state) return;
    if (new Set(state.spaces.map((space) => space.profileId)).size < 2) return;
    const unit =
      event.deltaMode === 1
        ? 16
        : event.deltaMode === 2
          ? state.settings.sidebarWidth
          : 1;
    const sample = window.wing.swipeUpdate(
      event.deltaX * unit,
      event.deltaY * unit,
      performance.now(),
    );
    const gestureStarting = profileSwipeIdle === null;
    // Observe vertical and momentum events too; they belong to the same gesture
    // even after the profile has changed. Ordinary vertical scrolling stays native.
    clearTimeout(profileSwipeIdle);
    profileSwipeIdle = setTimeout(() => {
      profileSwipeIdle = null;
      window.wing.swipeReset();
      settleProfileSwipe();
      scheduleSidebarHide();
    }, 320);
    if (
      sample.phase !== "tracking" &&
      !sample.direction &&
      sample.progress === 0 &&
      profileSwipeProgress &&
      !profileSwipeDirection
    )
      settleProfileSwipe();
    if (!sample.handled) return;
    event.preventDefault();
    // A new gesture can arrive after idle queued a native hide but before its
    // state broadcast. Reassert intent once, so the sidebar reverses that hide.
    if (gestureStarting && state.sidebarHidden) requestSidebarReveal(true);
    if (sample.phase === "tracking") trackProfileSwipe(sample.progress);
    if (sample.direction) {
      profileSwipeDirection = sample.direction;
      clearTimeout(profileSwipeAcknowledgement);
      profileSwipeAcknowledgement = setTimeout(() => {
        // No-op/rejected actions must eventually release feedback even without a state update.
        if (profileSwipeDirection) settleProfileSwipe();
        profileSwipeDirection = 0;
      }, 700);
      act("swipe-profile", { direction: sample.direction }).then((result) => {
        // Successful IPC returns before the coalesced state broadcast. Keep the
        // direction until that broadcast acknowledges the new profile.
        if (!result?.error) return;
        clearTimeout(profileSwipeAcknowledgement);
        settleProfileSwipe();
        profileSwipeDirection = 0;
      });
    }
  },
  { passive: false },
);
function resizer(element, onMove) {
  let resizing = false;
  element.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || resizing) return;
    e.preventDefault();
    element.setPointerCapture(e.pointerId);
    resizing = true;
    prepareOverlayBackdrop();
    let frame = null,
      pending = null;
    const flush = () => {
      frame = null;
      if (pending) {
        const point = pending;
        pending = null;
        onMove(point.x, point.y);
      }
    };
    const move = (event) => {
      if (event.pointerId !== e.pointerId) return;
      pending = { x: event.clientX, y: event.clientY };
      if (frame === null) frame = requestAnimationFrame(flush);
    };
    const end = (event) => {
      if (event.pointerId !== e.pointerId || !resizing) return;
      resizing = false;
      element.removeEventListener("pointermove", move);
      for (const type of ["pointerup", "pointercancel", "lostpointercapture"])
        element.removeEventListener(type, end);
      if (frame !== null) cancelAnimationFrame(frame);
      if (event.type === "pointerup") flush();
      pending = null;
      if (element.hasPointerCapture(e.pointerId))
        element.releasePointerCapture(e.pointerId);
      releaseOverlayBackdrop();
    };
    element.addEventListener("pointermove", move);
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"])
      element.addEventListener(type, end);
  });
}
resizer($("#sidebar-resize"), (x) => act("sidebar-width", { width: x }));
const secondarySplitDivider = document.createElement("div");
secondarySplitDivider.id = "split-divider-secondary";
secondarySplitDivider.hidden = true;
$("#main").append(secondarySplitDivider);
[$("#split-divider"), secondarySplitDivider].forEach((divider, index) => {
  divider.tabIndex = 0;
  divider.setAttribute("role", "separator");
  divider.setAttribute("aria-label", `Resize split divider ${index + 1}`);
  divider.setAttribute("aria-valuemin", "15");
  divider.setAttribute("aria-valuemax", "85");
  resizer(divider, (x, y) => {
    const { left, top, margin } = pageFrame();
    const count = state.splitIds?.length || 2;
    const ratio =
      state.splitOrientation === "vertical"
        ? (y - top - index * 8) / (innerHeight - top - margin - (count - 1) * 8)
        : (x - left - index * 8) / (innerWidth - left - margin - (count - 1) * 8);
    act("split-ratio", { ratio, divider: index });
  });
  divider.addEventListener("keydown", (event) => {
    const vertical = state.splitOrientation === "vertical";
    const direction =
      event.key === (vertical ? "ArrowDown" : "ArrowRight")
        ? 1
        : event.key === (vertical ? "ArrowUp" : "ArrowLeft")
          ? -1
          : 0;
    if (!direction) return;
    event.preventDefault();
    const current = (state.splitWeights || [0.5, 0.5])
      .slice(0, index + 1)
      .reduce((a, b) => a + b, 0);
    act("split-ratio", { ratio: current + direction * 0.025, divider: index });
  });
});
const assignments = {
  ".sidebar-toggle": "sidebar",
  "#show-sidebar": "sidebar",
  "#back": "back",
  "#forward": "forward",
  "#reload": "reload",
  "#copy-url": "copy",
  "#split-button": "split",
  "#favorite-button": "star",
  "#settings-button": "settings",
  "#library-button": "library",
  "#boost-button": "sparkle",
  ".search-icon": "search",
  "#edit-space": "more",
  "#add-space": "plus",
  "#strip-new-tab": "plus",
  "#toolbar-add-space": "plus",
  "#move-tabs-top": "up",
  "#new-tab .new-tab-icon": "plus",
  "#find-prev": "up",
  "#find-next": "down",
  "#find-close": "close",
  "#peek-close": "close",
};
Object.entries(assignments).forEach(
  ([selector, name]) => ($(selector).innerHTML = icon(name)),
);
const stopOnboardingCheck = window.wing.onState(() => {
  stopOnboardingCheck();
  setTimeout(() => {
    if (
      state.settings.onboarded === false &&
      !modalType &&
      !window.__wingQualifying
    )
      openOnboarding();
  }, 500);
});
window.wing.onState((next) => {
  const previousProfile = currentSpace()?.profileId;
  state = { ...state, ...next };
  render();
  if (profileSwipeDirection && previousProfile !== currentSpace()?.profileId) {
    clearTimeout(profileSwipeAcknowledgement);
    settleProfileSwipe(profileSwipeDirection);
    profileSwipeDirection = 0;
  }
});
window.wing.onCommand((c) => {
  switch (c.type) {
    case "update-status":
      renderUpdateStatus(c.status);
      break;
    case "toast":
      toast(c.message);
      break;
    case "sidebar-frame":
      applySidebarReveal(c);
      break;
    case "palette":
      openPalette(c.mode, c.value);
      break;
    case "space-editor":
      openSpace();
      break;
    case "rename":
      openRename(c.id, c.value);
      break;
    case "settings":
      openSettings();
      break;
    case "library":
      openLibrary(c.tab);
      break;
    case "split-picker":
      openSplit();
      break;
    case "help":
      openHelp();
      break;
    case "performance":
      openPerformance();
      break;
    case "reader":
      toggleReader();
      break;
    case "import":
      openBrowserImport();
      break;
    case "find": {
      const input = $("#find-input");
      if (c.step && input.value) {
        $("#find-bar").hidden = false;
        act("find", { text: input.value, next: true, forward: c.step > 0 });
        break;
      }
      $("#find-bar").hidden = false;
      input.focus();
      input.select();
      break;
    }
    case "toast":
      toast(c.message);
      break;
    case "find-result": {
      if (c.id !== state.activeTabId) break;
      const query = $("#find-input").value;
      $("#find-count").textContent = !query
        ? ""
        : c.count
          ? `${c.active} of ${c.count}`
          : c.final
            ? "No matches"
            : "";
      $("#find-bar").classList.toggle(
        "no-match",
        !!query && c.final && !c.count,
      );
      break;
    }
  }
});
$("#zoom-badge").addEventListener("click", (e) => {
  e.stopPropagation();
  act("zoom", { reset: true });
});
// Without a native title bar, empty chrome moves the window like AppKit's.
document.addEventListener("mousedown", (e) => {
  if (e.button !== 0 || !e.target.closest(".window-drag, #toolbar")) return;
  if (
    e.target.closest(
      "button, a, input, select, textarea, [contenteditable], browser-action-list, [role=button]",
    )
  )
    return;
  window.wing
    .invoke(e.detail === 2 ? "window-zoom" : "window-drag")
    .catch(() => {});
});
window.wing.invoke("state").then((next) => {
  state = next;
  render();
});

// Resource errors do not bubble; capture keeps a failed icon from exposing a
// broken-image glyph, while the monogram underneath remains recognizable.
document.addEventListener(
  "error",
  (event) => {
    if (!event.target?.matches?.("img.site-favicon")) return;
    event.target.hidden = true;
    event.target.parentElement?.classList.remove("has-favicon");
  },
  true,
);
document.addEventListener(
  "load",
  (event) => {
    if (!event.target?.matches?.("img.site-favicon")) return;
    event.target.parentElement?.classList.add("has-favicon");
  },
  true,
);
