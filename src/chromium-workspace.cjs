"use strict";
const M = require("./model.cjs");
const N = require("./navigation.cjs");
const O = require("./organization.cjs");
const I = require("./interactions.cjs");
const { TabSwitcher } = require("./recent-tabs.cjs");

// Engine-independent workspace behavior used by the native Chromium host.
// Browser services (navigation, permissions, downloads) stay in the native host.
class ChromiumWorkspace {
  constructor(saved) {
    this.state = saved ? M.validateState(saved) : M.initialState();
    // The host deletes these profiles' browser data once the removal is saved.
    this.removedProfiles = M.removeEmptyProfiles(this.state);
    this.journal = new O.OrganizationJournal();
    this.revealed = false;
    this.runtime = new Map();
    this.recent = new TabSwitcher();
    this.downloads = [];
    this.peekId = null;
    this.state.tabs = this.state.tabs.filter((t) => !t.transient);
  }
  #splitLayout() {
    const state = this.state,
      group = M.splits.groupFor(state);
    const ids = M.splits.visibleIds(state);
    const weights = group
      ? ids.map((id) => group.weights[group.tabIds.indexOf(id)])
      : [1];
    const orientation = group?.orientation || state.settings.splitOrientation;
    return { group, ids, weights, orientation };
  }
  snapshot(version = "") {
    const state = this.state;
    const { group, ids, weights, orientation } = this.#splitLayout();
    return {
      ...state,
      tabs: state.tabs
        .filter((tab) => !tab.transient)
        .map((tab) => ({ ...tab, ...this.runtime.get(tab.id) })),
      splitIds: ids,
      splitId: ids.find((id) => id !== state.activeTabId) || null,
      splitWeights: weights,
      splitRatio: group?.weights[0] || 0.5,
      splitReversed: false,
      splitOrientation: orientation,
      sidebarRevealed: this.revealed,
      sidebarRevealProgress: !state.sidebarHidden || this.revealed ? 1 : 0,
      sidebarRevealAnimating: false,
      peek: this.peekId
        ? state.tabs.find((tab) => tab.id === this.peekId)
        : null,
      downloads: this.downloads,
      recentTabs: this.recent.snapshot(state),
      versions: { chrome: version, electron: "native preview" },
      liveTabCount: this.runtime.size,
    };
  }
  layout(width, height) {
    const { ids: splitIds, weights, orientation } = this.#splitLayout();
    const ids = splitIds.filter(
      (id) =>
        !M.isShellPage(this.state.tabs.find((tab) => tab.id === id)?.url) &&
        !this.runtime.get(id)?.crashed,
    );
    const frame = M.splits.frame(
      this.state.settings,
      // The revealed sidebar floats over the page without resizing it.
      this.state.sidebarHidden ? 8 : this.state.settings.sidebarWidth,
    );
    const left = frame.left;
    const area = {
      width,
      height,
      left,
      top: frame.top,
      margin: frame.margin,
      orientation,
    };
    const bounds = M.splits.bounds({ ...area, weights });
    const panes = ids
      .map((id, index) => ({ id, ...bounds[index] }))
      .filter((pane) => pane.id !== this.peekId);
    if (!this.peekId) return panes;
    // Peek floats over the page it came from, which stays in place and dims.
    // The native host draws the card around it, with a 40-point header.
    const [content] = M.splits.bounds({ ...area, weights: [1] });
    const inset = Math.min(56, Math.max(12, content.width * 0.06));
    return [
      ...panes.slice(0, 2),
      {
        id: this.peekId,
        peek: true,
        x: content.x + inset,
        y: content.y + 16 + 40,
        width: Math.max(1, content.width - 2 * inset),
        height: Math.max(1, content.height - 16 - 40 - 22),
      },
    ];
  }
  pageChanged(event) {
    const tab = this.state.tabs.find((tab) => tab.id === event.id);
    if (!tab) return false;
    const previousURL = tab.url,
      previousTitle = tab.title;
    if (
      event.url &&
      (/^(https?:|about:blank|chrome-extension:)/.test(event.url) ||
        M.internalPage(event.url))
    )
      tab.url = M.normalizeURL(event.url);
    if (event.title && !tab.customTitle)
      tab.title = String(event.title).slice(0, 300);
    // Saved with the tab, since a page reports no icon until it has loaded again.
    const previousFavicon = tab.favicon;
    if (/^https?:/.test(event.favicon || "") && event.favicon.length <= 4096) {
      tab.favicon = event.favicon;
      tab.faviconOrigin = new URL(tab.url).origin;
    }
    this.runtime.set(tab.id, {
      loading: !!event.loading,
      canGoBack: !!event.canGoBack,
      canGoForward: !!event.canGoForward,
      audible: !!event.audible,
      muted: !!event.muted,
      capturing: !!event.capturing,
      screenSharing: !!event.screenSharing,
      pictureInPicture: !!event.pictureInPicture,
      progress: Number(event.progress) || 0,
      zoom: Number(event.zoom) || 1,
      crashed: typeof event.crashed === "string" ? event.crashed : "",
    });
    return (
      tab.url !== previousURL ||
      tab.title !== previousTitle ||
      tab.favicon !== previousFavicon
    );
  }
  closed(id, archive = false) {
    this.runtime.delete(id);
    if (this.state.tabs.find((t) => t.id === id)?.transient) {
      this.state.tabs = this.state.tabs.filter((t) => t.id !== id);
      if (this.peekId === id) this.peekId = null;
      return;
    }
    M.closePage(this.state, id, { archive });
  }
  #selectTab(id, onSelection, resume = false) {
    const state = this.state;
    const tab = state.tabs.find((tab) => tab.id === id);
    if (!tab) return;
    const { activeSpaceId } = state;
    const { url } = tab;
    const wasOpen = onSelection && !tab.transient &&
      M.splits.members(state, id).every((member) => !member.closed);
    if (resume) M.resumeElsewhere(state, id);
    M.activate(state, id);
    if (wasOpen && tab.url === url && state.activeSpaceId === activeSpaceId)
      onSelection(tab);
  }
  action(name, data = {}, onSelection) {
    const s = this.state,
      tab = s.tabs.find((tab) => tab.id === (data.id || s.activeTabId));
    const normalize = (input) =>
      M.normalizeURL(
        N.resolveInput(input, s.settings),
        M.searchURL(s.settings),
      );
    switch (name) {
      case "settings":
        for (const key of ["dark", "peekPinned", "memorySaver"])
          if (typeof data[key] === "boolean") s.settings[key] = data[key];
        if ([4, 8, 16].includes(data.maxLiveTabs))
          s.settings.maxLiveTabs = data.maxLiveTabs;
        if ([0, 12, 24, 168].includes(data.archiveHours))
          s.settings.archiveHours = data.archiveHours;
        if (Object.hasOwn(M.SEARCH_ENGINES, data.search))
          s.settings.search = data.search;
        break;
      case "features-settings": {
        const next = {};
        for (const key of [
          "cleanCopy",
          "toolbarHidden",
          "pinnedCollapsed",
          "automaticPictureInPicture",
          "onboarded",
          "linksInMini",
          "icloudSync",
          "pullRequestsInSidebar",
          "pullRequestsCollapsed",
          "askSpaceForLinks",
          "defaultBrowserPromptOff",
        ])
          if (typeof data[key] === "boolean") next[key] = data[key];
        if (I.APP_ICONS.includes(data.appIcon)) next.appIcon = data.appIcon;
        if (["ask", "always", "never"].includes(data.crashReports))
          next.crashReports = data.crashReports;
        if (["system", "light", "dark"].includes(data.appearance)) {
          next.appearance = data.appearance;
          next.dark =
            data.appearance === "system"
              ? !!data.systemDark
              : data.appearance === "dark";
        }
        if (data.siteSearches !== undefined) {
          if (
            !Array.isArray(data.siteSearches) ||
            data.siteSearches.length > 50
          )
            throw Error("Too many site searches.");
          next.siteSearches = data.siteSearches.map(N.validateSearch);
        }
        if (data.routes !== undefined) {
          if (!Array.isArray(data.routes) || data.routes.length > 100)
            throw Error("Too many routes.");
          next.routes = data.routes.map((r) => {
            if (
              !["host", "equals", "contains"].includes(r.type) ||
              !String(r.value || "").trim() ||
              !s.spaces.some((space) => space.id === r.spaceId)
            )
              throw Error("Invalid link route.");
            return {
              type: r.type,
              value: String(r.value).trim().slice(0, 4000),
              spaceId: r.spaceId,
            };
          });
        }
        if (s.spaces.some((space) => space.id === data.defaultSpaceId))
          next.defaultSpaceId = data.defaultSpaceId;
        Object.assign(s.settings, next);
        break;
      }
      case "delete-space": {
        if (s.spaces.length < 2) throw Error("Keep at least one Space.");
        if (s.spaces.find((space) => space.id === data.id)?.throwaway) {
          this.removedProfiles.push(...M.removeThrowawaySpaces(s, data.id));
          break;
        }
        for (const target of [...s.tabs].filter((t) => t.spaceId === data.id))
          M.archiveTab(s, target.id);
        s.spaces = s.spaces.filter((space) => space.id !== data.id);
        s.folders = s.folders.filter((folder) => folder.spaceId !== data.id);
        s.settings.routes = (s.settings.routes || []).filter(
          (route) => route.spaceId !== data.id,
        );
        if (s.settings.defaultSpaceId === data.id)
          s.settings.defaultSpaceId = s.spaces[0].id;
        M.selectSpace(s, s.spaces[0].id);
        this.removedProfiles.push(...M.removeEmptyProfiles(s));
        break;
      }
      case "boost":
        if (tab && /^https?:/.test(tab.url))
          s.boosts[new URL(tab.url).origin] = String(data.css || "").slice(
            0,
            50000,
          );
        break;
      case "reorder-space":
        M.reorderSpace(s, data.id, data.before);
        break;
      case "save-space": {
        const existing = s.spaces.find((space) => space.id === data.id);
        const name =
          String(data.name || "New Space")
            .trim()
            .slice(0, 60) || "New Space";
        let profileId = data.profileId;
        if (profileId === "new") {
          profileId = M.id();
          s.profiles.push({ id: profileId, name });
        }
        if (!s.profiles.some((profile) => profile.id === profileId))
          profileId = "default";
        const fields = {
          name,
          profileId,
          theme: M.themes.includes(data.theme) ? data.theme : "lavender",
          icon: M.spaceIcon(data.icon),
        };
        if (data.colors !== undefined)
          fields.colors = M.normalizeCustomColors(data.colors);
        if (existing) Object.assign(existing, fields);
        else {
          const space = { id: M.id(), ...fields };
          if (data.throwaway === true && data.profileId === "new")
            space.throwaway = true;
          s.spaces.push(space);
          M.selectSpace(s, space.id);
        }
        break;
      }
      case "swipe-profile":
        M.selectSpace(
          s,
          I.nextProfileSpace(s.spaces, s.activeSpaceId, Number(data.direction)),
        );
        break;
      case "folder": {
        this.journal.record(s);
        const tab = s.tabs.find((t) => t.id === data.tabId);
        const folder = O.saveFolder(s, {
          name: data.name || "Untitled",
          parentId: data.parentId,
        });
        // A folder made from a tab's menu takes that tab in, pinning it.
        if (tab && tab.spaceId === folder.spaceId)
          M.moveTab(s, tab.id, tab.spaceId, folder.id);
        break;
      }
      case "reorder-tab": {
        const moving = M.splits.members(s, data.id),
          destination = M.splits.members(s, data.before)[0];
        if (data.end) {
          this.journal.record(s);
          s.tabs = s.tabs.filter((t) => !moving.includes(t));
          s.tabs.push(...moving);
          break;
        }
        if (
          destination &&
          !moving.includes(destination) &&
          moving.every((t) => t.spaceId === destination.spaceId)
        ) {
          this.journal.record(s);
          s.tabs = s.tabs.filter((t) => !moving.includes(t));
          s.tabs.splice(s.tabs.indexOf(destination), 0, ...moving);
        }
        break;
      }
      case "group-by-site": {
        const inSplit = new Set(s.splits.flatMap((split) => split.tabIds));
        const sites = new Map();
        for (const tab of s.tabs) {
          if (tab.spaceId !== s.activeSpaceId || tab.kind !== "today") continue;
          if (tab.closed || inSplit.has(tab.id) || !/^https?:/.test(tab.url))
            continue;
          const host = new URL(tab.url).hostname.replace(/^www\./, "");
          sites.set(host, [...(sites.get(host) || []), tab]);
        }
        const groups = [...sites].filter(([, tabs]) => tabs.length > 1);
        if (!groups.length) return false;
        this.journal.record(s);
        for (const [host, tabs] of groups) {
          O.saveFolder(s, { name: host });
          const folder = s.folders[s.folders.length - 1];
          for (const tab of tabs) {
            tab.kind = "pinned";
            tab.homeURL = tab.url;
            tab.folderId = folder.id;
          }
        }
        break;
      }
      case "tab-icon":
        if (tab) {
          this.journal.record(s);
          tab.customIcon = String(data.icon || "").slice(0, 8);
        }
        break;
      case "bulk-tabs": {
        const profile = s.spaces.find(
          (space) => space.id === s.activeSpaceId,
        )?.profileId;
        const ids = new Set(
          (Array.isArray(data.ids) ? data.ids : []).flatMap((id) =>
            M.splits.members(s, id).map((t) => t.id),
          ),
        );
        const tabs = s.tabs.filter(
          (t) =>
            ids.has(t.id) &&
            s.spaces.find((space) => space.id === t.spaceId)?.profileId ===
              profile,
        );
        if (!["pin", "unpin", "folder"].includes(data.operation)) return false;
        const folder = s.folders.find(
          (f) => f.id === data.folderId && f.spaceId === s.activeSpaceId,
        );
        if (data.operation === "folder" && !folder)
          throw Error("Choose a folder in this Space.");
        this.journal.record(s);
        for (const t of tabs) {
          t.kind = data.operation === "unpin" ? "today" : "pinned";
          t.homeURL = t.url;
          if (folder) {
            t.folderId = folder.id;
            t.spaceId = folder.spaceId;
          } else if (t.kind === "today") t.folderId = null;
        }
        break;
      }
      case "recent-tabs-preview":
        if (data.id) this.recent.select(s, data.id);
        else this.recent.step(s, data.direction);
        break;
      case "recent-tabs-focus":
        this.recent.select(s, data.id);
        break;
      case "recent-tabs-commit": {
        if (data.id) this.recent.select(s, data.id);
        const id = this.recent.commit(s);
        this.#selectTab(id, onSelection);
        break;
      }
      case "recent-tabs-cancel":
        this.recent.cancel();
        break;
      case "peek": {
        if (this.peekId)
          this.state.tabs = this.state.tabs.filter((t) => t.id !== this.peekId);
        const peek = M.newTab(s.activeSpaceId, normalize(data.url), {
          transient: true,
        });
        s.tabs.push(peek);
        this.peekId = peek.id;
        break;
      }
      case "promote-peek": {
        const peek = s.tabs.find((t) => t.id === this.peekId);
        if (peek) {
          delete peek.transient;
          M.activate(s, peek.id);
        }
        this.peekId = null;
        break;
      }
      case "close-peek":
        if (this.peekId) this.closed(this.peekId);
        break;
      case "pulls-open": {
        const existing = s.tabs.find((tab) => tab.url === M.PULLS_URL);
        if (existing) {
          s.activeSpaceId = existing.spaceId;
          M.activate(s, existing.id);
        } else {
          const created = M.newTab(s.activeSpaceId, M.PULLS_URL);
          s.tabs.push(created);
          M.splits.setKind(s, created.id, "pinned");
          M.activate(s, created.id);
        }
        break;
      }
      case "pulls-title":
        for (const tab of s.tabs)
          if (tab.url === M.PULLS_URL)
            tab.title = data.count ? `Pull Requests (${data.count})` : "Pull Requests";
        break;
      case "mini-visit":
        s.history.unshift({
          id: M.id(),
          url: new URL(data.url).href,
          title: String(data.title || new URL(data.url).hostname).slice(0, 300),
          at: Date.now(),
          profileId: s.spaces.find((space) => space.id === data.spaceId)?.profileId,
        });
        s.history = s.history.slice(0, 2000);
        break;
      case "external-url": {
        const url = new URL(data.url);
        if (!["http:", "https:"].includes(url.protocol))
          throw Error("Only web links can be opened externally.");
        const named = data.spaceId
          ? s.spaces.find((space) => space.id === data.spaceId)
          : data.space
            ? s.spaces.find(
                (space) =>
                  space.name.toLowerCase() === String(data.space).toLowerCase(),
              )
            : null;
        const destination =
          named?.id ||
          N.routeURL(
            url.href,
            s.settings.routes,
            s.spaces,
            s.settings.defaultSpaceId || s.activeSpaceId,
          );
        const created = M.newTab(destination, url.href);
        s.tabs.push(created);
        M.activate(s, created.id);
        break;
      }
      case "new-tab": {
        const url = normalize(data.url || "wing://home");
        // Passwords, History and Clear Data are single pages: reuse an open one.
        const existing =
          M.internalPage(url) &&
          s.tabs.find(
            (t) => t.spaceId === s.activeSpaceId && t.url === url && !t.closed,
          );
        if (existing) {
          M.activate(s, existing.id);
          break;
        }
        const created = M.newTab(s.activeSpaceId, url);
        s.tabs.push(created);
        M.activate(s, created.id);
        break;
      }
      case "navigate":
        if (!tab) return this.action("new-tab", data);
        tab.url = normalize(data.url);
        delete tab.closed;
        break;
      case "select-tab":
        this.#selectTab(data.id, onSelection, true);
        break;
      case "tab-index":
      case "cycle-tab": {
        // Sidebar order: favorites, pinned, then today's tabs.
        const rank = { favorite: 0, pinned: 1, today: 2 };
        const ordered = M.visibleTabs(s)
          .filter((t) => !t.transient)
          .sort((a, b) => rank[a.kind] - rank[b.kind]);
        if (!ordered.length) break;
        let target;
        if (name === "tab-index")
          target = data.index < 0 ? ordered.at(-1) : ordered[data.index];
        else {
          const current = ordered.findIndex((t) => t.id === s.activeTabId);
          const step = data.direction < 0 ? -1 : 1;
          target = ordered[(current + step + ordered.length) % ordered.length];
        }
        if (target) this.#selectTab(target.id, onSelection);
        break;
      }
      case "space-index": {
        const space = I.spaceForProfile(s, data.index);
        if (space) M.selectSpace(s, space.id);
        this.revealed = false;
        break;
      }
      case "space":
        M.selectSpace(s, data.id);
        this.revealed = false;
        break;
      case "pin":
      case "favorite":
        if (tab) {
          this.journal.record(s);
          M.splits.setKind(
            s,
            tab.id,
            name === "favorite"
              ? tab.kind === "favorite"
                ? "pinned"
                : "favorite"
              : tab.kind === "today"
                ? "pinned"
                : "today",
          );
        }
        break;
      case "rename-tab":
        if (tab) {
          this.journal.record(s);
          const group = M.splits.groupFor(s, tab.id);
          const title = String(data.value || tab.title).slice(0, 200);
          if (group) group.title = title;
          else tab.customTitle = tab.title = title;
        }
        break;
      case "place-tab":
        this.journal.record(s);
        M.placeTab(s, data.id, data);
        break;
      case "move-tab":
        this.journal.record(s);
        M.moveTab(s, data.id, data.spaceId || s.activeSpaceId, data.folderId);
        break;
      case "save-folder":
        this.journal.record(s);
        O.saveFolder(s, data);
        break;
      case "remove-folder":
        this.journal.record(s);
        O.removeFolder(s, data.id);
        break;
      case "toggle-folder": {
        const folder = s.folders.find((folder) => folder.id === data.id);
        if (folder) folder.collapsed = !folder.collapsed;
        break;
      }
      case "organization-undo":
        this.journal.undo(s);
        break;
      case "organization-redo":
        this.journal.redo(s);
        break;
      case "sidebar":
        if (s.settings.tabLayout === "top") {
          s.settings.tabLayout = "sidebar";
          s.sidebarHidden = false;
          this.revealed = false;
          break;
        }
        s.sidebarHidden = !s.sidebarHidden;
        this.revealed = false;
        break;
      case "sidebar-reveal":
        this.revealed = s.sidebarHidden && !!data.visible;
        break;
      case "tab-layout":
        s.settings.tabLayout = data.layout === "sidebar" ? "sidebar" : "top";
        s.sidebarHidden = false;
        this.revealed = false;
        break;
      case "sidebar-width":
        s.settings.sidebarWidth = Math.max(
          200,
          Math.min(360, Number(data.width) || 256),
        );
        break;
      case "split":
        if (data.id)
          M.splits.join(
            s,
            data.targetId || s.activeTabId,
            data.id,
            data.orientation,
          );
        else {
          const group = M.splits.groupFor(s);
          s.splits = s.splits.filter((candidate) => candidate !== group);
        }
        break;
      case "split-remove-pane":
        M.splits.removeTab(s, data.id || s.activeTabId);
        break;
      case "split-dissolve":
        for (const member of M.splits.members(s, data.id || s.activeTabId))
          M.splits.removeTab(s, member.id);
        break;
      case "split-ratio":
        M.splits.resize(
          s,
          s.activeTabId,
          Number(data.divider || 0),
          Number(data.ratio),
        );
        break;
      case "split-orientation":
        if (!["horizontal", "vertical"].includes(data.orientation))
          throw Error("Invalid split orientation");
        s.settings.splitOrientation = data.orientation;
        if (M.splits.groupFor(s))
          M.splits.groupFor(s).orientation = data.orientation;
        break;
      case "restore": {
        // Undo Close: the newest of an archived tab or a closed pinned tab.
        const closed = data.id
          ? null
          : s.tabs
              .filter((t) => t.closed && t.closedAt)
              .sort((a, b) => b.closedAt - a.closedAt)[0];
        if (closed && closed.closedAt >= (s.archive[0]?.archivedAt || 0)) {
          if (closed.closedURL) closed.url = closed.closedURL;
          delete closed.closedURL;
          delete closed.closedAt;
          M.activate(s, closed.id);
        } else M.restoreTab(s, data.id || s.archive[0]?.id);
        break;
      }
      case "reset-pin":
      case "reset-pin-id":
        if (tab && tab.kind !== "today") {
          tab.url = tab.homeURL;
          M.activate(s, tab.id);
        }
        break;
      default:
        return false;
    }
    return true;
  }
}
// A saved workspace that fails validation falls back to the newest usable backup,
// then to a fresh start, so a damaged file can't leave the browser unusable.
async function openWorkspace(result, recover) {
  let saved = result.workspace,
    index = result.backup ?? -1,
    recovery = result.recovered ? (saved ? "backup" : "fresh") : null;
  for (;;) {
    try {
      return { workspace: new ChromiumWorkspace(saved), recovery };
    } catch {
      const next = await recover(index);
      saved = next.workspace;
      index = next.index;
      recovery = saved ? "backup" : "fresh";
    }
  }
}
function startupNotice(recovery, uncleanExit) {
  if (recovery === "backup")
    return "Your workspace was damaged, so Wing restored the latest backup.";
  if (recovery === "fresh")
    return "Your workspace was damaged and no backup could be read. The damaged file was kept.";
  return uncleanExit ? "Wing didn't close properly last time. Your tabs are back." : null;
}
module.exports = { ChromiumWorkspace, openWorkspace, startupNotice };
