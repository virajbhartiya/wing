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
    this.journal = new O.OrganizationJournal();
    this.revealed = false;
    this.runtime = new Map();
    this.recent = new TabSwitcher();
    this.downloads = [];
    this.peekId = null;
    this.state.tabs = this.state.tabs.filter((t) => !t.transient);
  }
  snapshot(version = "") {
    const state = this.state,
      group = M.splits.groupFor(state);
    const ids = M.splits.visibleIds(state);
    return {
      ...state,
      tabs: state.tabs
        .filter((tab) => !tab.transient)
        .map((tab) => ({ ...tab, ...this.runtime.get(tab.id) })),
      splitIds: ids,
      splitId: ids.find((id) => id !== state.activeTabId) || null,
      splitWeights: group
        ? ids.map((id) => group.weights[group.tabIds.indexOf(id)])
        : [1],
      splitRatio: group?.weights[0] || 0.5,
      splitReversed: false,
      splitOrientation: group?.orientation || state.settings.splitOrientation,
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
    const snapshot = this.snapshot();
    const ids = snapshot.splitIds.filter(
      (id) =>
        this.state.tabs.find((tab) => tab.id === id)?.url !== "wing://home" &&
        !this.runtime.get(id)?.crashed,
    );
    const frame = M.splits.frame(
      this.state.settings,
      this.state.sidebarHidden && !this.revealed
        ? 8
        : this.state.settings.sidebarWidth,
    );
    const left = frame.left;
    if (this.peekId)
      return [
        {
          id: this.peekId,
          x: left + 32,
          y: this.state.settings.tabLayout === "top" ? 136 : 100,
          width: Math.max(1, width - left - 72),
          height: Math.max(1, height - 140),
        },
      ];
    const bounds = M.splits.bounds({
      width,
      height,
      left,
      top: frame.top,
      margin: frame.margin,
      weights: snapshot.splitWeights,
      orientation: snapshot.splitOrientation,
    });
    return ids.map((id, index) => ({ id, ...bounds[index] }));
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
    this.runtime.set(tab.id, {
      loading: !!event.loading,
      canGoBack: !!event.canGoBack,
      canGoForward: !!event.canGoForward,
      audible: !!event.audible,
      muted: !!event.muted,
      capturing: !!event.capturing,
      screenSharing: !!event.screenSharing,
      pictureInPicture: !!event.pictureInPicture,
      favicon: event.favicon || "",
      progress: Number(event.progress) || 0,
      zoom: Number(event.zoom) || 1,
      crashed: typeof event.crashed === "string" ? event.crashed : "",
    });
    return tab.url !== previousURL || tab.title !== previousTitle;
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
  action(name, data = {}) {
    const s = this.state,
      tab = s.tabs.find((tab) => tab.id === (data.id || s.activeTabId));
    const normalize = (input) =>
      M.normalizeURL(
        N.resolveInput(input, s.settings),
        s.settings.search === "duckduckgo"
          ? "https://duckduckgo.com/?q="
          : undefined,
      );
    switch (name) {
      case "settings":
        for (const key of ["dark", "peekPinned"])
          if (typeof data[key] === "boolean") s.settings[key] = data[key];
        if ([4, 8, 16].includes(data.maxLiveTabs))
          s.settings.maxLiveTabs = data.maxLiveTabs;
        if ([0, 12, 24, 168].includes(data.archiveHours))
          s.settings.archiveHours = data.archiveHours;
        if (["google", "duckduckgo"].includes(data.search))
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
        ])
          if (typeof data[key] === "boolean") next[key] = data[key];
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
        break;
      }
      case "boost":
        if (tab && /^https?:/.test(tab.url))
          s.boosts[new URL(tab.url).origin] = String(data.css || "").slice(
            0,
            50000,
          );
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
          icon: String(data.icon || "✳").slice(0, 4),
        };
        if (data.colors !== undefined)
          fields.colors = M.normalizeCustomColors(data.colors);
        if (existing) Object.assign(existing, fields);
        else {
          const space = { id: M.id(), ...fields };
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
      case "folder":
        O.saveFolder(s, { name: data.name || "Untitled" });
        break;
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
        if (id) M.activate(s, id);
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
      case "external-url": {
        const url = new URL(data.url);
        if (!["http:", "https:"].includes(url.protocol))
          throw Error("Only web links can be opened externally.");
        const destination = N.routeURL(
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
        M.activate(s, data.id);
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
        if (target) M.activate(s, target.id);
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
      case "restore":
        M.restoreTab(s, data.id || s.archive[0]?.id);
        break;
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
module.exports = { ChromiumWorkspace };
