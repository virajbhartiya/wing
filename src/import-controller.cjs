"use strict";
const M = require("./model.cjs");
const P = require("./profile-import.cjs");
const { appendWingProfile } = require("./wing-profile-migration.cjs");
const SPACE_THEMES = ["lavender", "ocean", "sage", "peach", "rose"];
// Importing a source again updates its earlier copy: Spaces and folders are
// matched by name, and only pages that copy doesn't already have are added.
function foldIntoExisting(next, state, profile, report) {
  const old = (key) => new Set(state[key].map((row) => row.id));
  const oldSpaces = state.spaces.filter((s) => s.profileId === profile.id);
  const oldSpaceIds = new Set(oldSpaces.map((s) => s.id));
  const spaceMap = new Map();
  const oldSpaceRows = old("spaces");
  next.spaces = next.spaces.filter((space) => {
    if (oldSpaceRows.has(space.id) || space.profileId !== profile.id)
      return true;
    const match = oldSpaces.find((s) => s.name === space.name);
    if (match) spaceMap.set(space.id, match.id);
    return !match;
  });
  const moved = (id) => spaceMap.get(id) || id;
  const inProfile = new Set(
    next.spaces.filter((s) => s.profileId === profile.id).map((s) => s.id),
  );
  const oldFolders = old("folders");
  const newFolders = next.folders.filter((f) => !oldFolders.has(f.id));
  const folderMap = new Map();
  const movedFolder = (id) => folderMap.get(id) || id || null;
  const place = (folder) => {
    const parent = newFolders.find((f) => f.id === folder.parentId);
    if (parent) place(parent);
    folder.spaceId = moved(folder.spaceId);
    if (folder.parentId) folder.parentId = movedFolder(folder.parentId);
    const match = next.folders.find(
      (f) =>
        oldFolders.has(f.id) &&
        f.spaceId === folder.spaceId &&
        f.name === folder.name &&
        (f.parentId || null) === (folder.parentId || null),
    );
    if (match) folderMap.set(folder.id, match.id);
  };
  newFolders.forEach(place);
  next.folders = next.folders.filter((f) => !folderMap.has(f.id));
  const known = new Set(
    [...state.tabs, ...state.archive]
      .filter((t) => oldSpaceIds.has(t.spaceId))
      .map((t) => t.url),
  );
  const keep = (key) => {
    const existing = old(key);
    next[key] = next[key].filter((tab) => {
      if (existing.has(tab.id) || !inProfile.has(moved(tab.spaceId)))
        return true;
      tab.spaceId = moved(tab.spaceId);
      if (tab.folderId) tab.folderId = movedFolder(tab.folderId);
      if (known.has(tab.url)) {
        if (key === "archive") report.archivedTabs = Math.max(0, (report.archivedTabs || 0) - 1);
        else if (tab.kind === "today") report.tabs = Math.max(0, report.tabs - 1);
        else report.bookmarks = Math.max(0, report.bookmarks - 1);
        return false;
      }
      known.add(tab.url);
      return true;
    });
  };
  keep("tabs");
  keep("archive");
  const live = new Set([...next.tabs, ...next.archive].map((t) => t.id));
  next.splits = next.splits.filter((g) => g.tabIds.every((id) => live.has(id)));
  for (const tab of [...next.tabs, ...next.archive])
    if (tab.splitBackup?.tabIds.some((id) => !live.has(id)))
      delete tab.splitBackup;
  const oldHistory = old("history");
  const visits = new Set(
    state.history
      .filter((h) => h.profileId === profile.id)
      .map((h) => `${h.at} ${h.url}`),
  );
  next.history = next.history.filter((h) => {
    if (oldHistory.has(h.id) || h.profileId !== profile.id) return true;
    if (!visits.has(`${h.at} ${h.url}`)) return true;
    report.history--;
    return false;
  });
  return moved;
}
// A source's first import gets a fresh partition. No merge into any other signed-in session.
async function importProfile({
  source,
  options,
  state,
  sessionFor,
  vault,
  persist,
  getState,
  read = P.readProfile,
  getKey = P.sourceKey,
}) {
  const input = await read(source, options);
  const report = {
    bookmarks: 0,
    tabs: 0,
    history: 0,
    cookies: 0,
    passwords: 0,
    skippedCookies: 0,
    skippedPasswords: 0,
    warnings: [...input.warnings],
  };
  const name = `${source.name} (${source.browserName})`.slice(0, 100);
  const existing = state.profiles.find(
    (p) => p.name === name && !M.BUILT_IN_PROFILES.has(p.id),
  );
  const profile = existing || { id: M.id(), name };
  const next = structuredClone(state);
  if (!existing) next.profiles.push(profile);
  const importedSpaces = [];
  function addSpace(name, rows) {
    const space = {
      id: M.id(),
      name: String(name).slice(0, 60),
      icon: String(source.name || name).trim().slice(0, 1).toUpperCase() || "W",
      theme: SPACE_THEMES[next.spaces.length % SPACE_THEMES.length],
      profileId: profile.id,
    };
    next.spaces.push(space);
    importedSpaces.push(space);
    const folders = new Map();
    for (const row of rows) {
      const url = P.webURL(row.url);
      if (!url) continue;
      let folderId = null;
      if (row.folder && row.kind !== "favorite" && row.kind !== "today") {
        if (!folders.has(row.folder)) {
          const f = {
            id: M.id(),
            spaceId: space.id,
            name: row.folder.slice(0, 80),
            collapsed: false,
          };
          next.folders.push(f);
          folders.set(row.folder, f.id);
        }
        folderId = folders.get(row.folder);
      }
      next.tabs.push(
        M.newTab(space.id, url, {
          title: row.title,
          kind: row.kind || "pinned",
          folderId,
        }),
      );
      if (row.kind === "today") report.tabs++;
      else report.bookmarks++;
    }
    return space;
  }
  if (source.browser === "wing" && input.wingState) {
    const migrated = appendWingProfile(
      next,
      input.wingState,
      source.profileId,
      profile,
      options,
    );
    importedSpaces.push(...migrated.spaces);
    report.tabs += migrated.tabs;
    report.bookmarks += migrated.bookmarks;
    report.archivedTabs = migrated.archivedTabs;
  }
  if (options.tabs) for (const s of input.spaces) addSpace(s.name, s.rows);
  if (input.bookmarks.length || !importedSpaces.length)
    addSpace(`${source.name} · ${source.browserName}`, input.bookmarks);
  for (const row of input.history) {
    const url = P.webURL(row.url);
    if (!url) continue;
    next.history.push({
      id: M.id(),
      url,
      title: String(row.title || url).slice(0, 300),
      at: Math.max(0, Number(row.last_visit_time) / 1000 - 11644473600000),
      profileId: profile.id,
    });
    report.history++;
  }
  next.history = next.history.slice(-10000);
  const moved = existing
    ? foldIntoExisting(next, state, profile, report)
    : (id) => id;
  const firstId = moved(importedSpaces[0].id);
  next.activeSpaceId = firstId;
  let home = existing && next.tabs.find((t) => t.spaceId === firstId);
  if (!home) {
    home = M.newTab(firstId);
    next.tabs.push(home);
  }
  next.activeTabId = home.id;
  // Validate capacity/schema before touching a destination session or Keychain.
  M.validateState(next);
  let key, ses;
  try {
    if (
      input.cookies.some((c) => c.encrypted_value?.length) ||
      input.passwords.length ||
      input.encryptedVault?.length
    )
      key = await getKey(source.browser);
    if (options.passwords) {
      const credentials = [];
      if (input.encryptedVault?.length) {
        let saved;
        try {
          saved = JSON.parse(P.decryptV10(input.encryptedVault, key));
          if (
            saved.version !== 1 ||
            !Array.isArray(saved.entries) ||
            saved.entries.length > 10000
          )
            throw Error("Invalid vault");
        } catch {
          throw Error(
            "The Wing password vault could not be unlocked. The source is unchanged; retry without passwords or allow Keychain access.",
          );
        }
        for (const entry of saved.entries) {
          const url = P.webURL(entry.origin);
          if (
            !url ||
            typeof entry.password !== "string" ||
            !entry.password ||
            typeof entry.username !== "string"
          ) {
            report.skippedPasswords++;
            continue;
          }
          credentials.push({
            url,
            username: entry.username,
            password: entry.password,
          });
        }
        saved.entries.length = 0;
      }
      for (const row of input.passwords) {
        try {
          const url = P.webURL(row.origin_url);
          if (!url) throw Error();
          credentials.push({
            url,
            username: row.username_value,
            password: P.decryptV10(row.password_value, key),
          });
        } catch {
          report.skippedPasswords++;
        }
      }
      for (const row of input.credentials || []) {
        const url = P.webURL(row.url);
        if (url)
          credentials.push({
            url,
            username: row.username,
            password: row.password,
          });
        else report.skippedPasswords++;
      }
      if (credentials.length)
        report.passwords = await vault.import(profile.id, credentials);
      credentials.length = 0;
    }
    if (options.cookies && input.cookies.length) {
      ses = sessionFor(profile.id);
      for (const row of input.cookies) {
        try {
          await ses.cookies.set(P.cookieDetails(row, key, input.cookieVersion));
          report.cookies++;
        } catch {
          report.skippedCookies++;
        }
      }
      await ses.cookies.flushStore();
    }
    // Rebase onto the latest workspace after Keychain/cookie work so browsing while
    // importing cannot erase newly created tabs or edits in another profile.
    const merged = structuredClone(getState ? getState() : state);
    if (!existing) merged.profiles.push(profile);
    const ids = new Set(
      next.spaces.filter((s) => s.profileId === profile.id).map((s) => s.id),
    );
    const addNew = (key, rows) => {
      const present = new Set(merged[key].map((row) => row.id));
      merged[key].push(...rows.filter((row) => !present.has(row.id)));
    };
    addNew(
      "spaces",
      next.spaces.filter((s) => s.profileId === profile.id),
    );
    const importedTabIds = new Set(
      next.tabs
        .filter(
          (t) =>
            ids.has(t.spaceId) && !state.tabs.some((old) => old.id === t.id),
        )
        .map((t) => t.id),
    );
    addNew(
      "tabs",
      next.tabs.filter((t) => ids.has(t.spaceId)),
    );
    addNew(
      "folders",
      next.folders.filter((f) => ids.has(f.spaceId)),
    );
    addNew(
      "archive",
      next.archive.filter((t) => ids.has(t.spaceId)),
    );
    addNew(
      "splits",
      next.splits.filter((s) =>
        s.tabIds.every((id) => importedTabIds.has(id)),
      ),
    );
    addNew(
      "history",
      next.history.filter((h) => h.profileId === profile.id),
    );
    merged.history = merged.history.slice(-10000);
    merged.activeSpaceId = firstId;
    merged.activeTabId = home.id;
    M.validateState(merged);
    await persist(merged, profile.id);
    return { state: merged, report, profileId: profile.id };
  } catch (error) {
    // Roll back only this import's brand-new partition/vault. Source remains read-only.
    if (!existing) {
      if (ses) await ses.clearStorageData().catch(() => {});
      await vault.removeProfile(profile.id).catch(() => {});
    }
    throw error;
  } finally {
    key?.fill(0);
    input.cookies.length = 0;
    input.passwords.length = 0;
    if (input.credentials) input.credentials.length = 0;
    input.encryptedVault?.fill(0);
  }
}
module.exports = { importProfile };
