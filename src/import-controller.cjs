"use strict";
const M = require("./model.cjs");
const P = require("./profile-import.cjs");
const { appendWingProfile } = require("./wing-profile-migration.cjs");
const SPACE_THEMES = ["lavender", "ocean", "sage", "peach", "rose"];
// All imported accounts get a fresh partition. No merge into an existing signed-in session.
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
  const profile = {
    id: M.id(),
    name: `${source.name} (${source.browserName})`.slice(0, 100),
  };
  const next = structuredClone(state);
  next.profiles.push(profile);
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
  const first = importedSpaces[0];
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
  next.activeSpaceId = first.id;
  const home = M.newTab(first.id);
  next.tabs.push(home);
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
    merged.profiles.push(profile);
    merged.spaces.push(
      ...next.spaces.filter((s) => s.profileId === profile.id),
    );
    const ids = new Set(importedSpaces.map((s) => s.id));
    merged.tabs.push(...next.tabs.filter((t) => ids.has(t.spaceId)));
    merged.folders.push(...next.folders.filter((f) => ids.has(f.spaceId)));
    merged.archive.push(...next.archive.filter((t) => ids.has(t.spaceId)));
    const importedTabIds = new Set(
      next.tabs.filter((t) => ids.has(t.spaceId)).map((t) => t.id),
    );
    merged.splits.push(
      ...next.splits.filter((s) =>
        s.tabIds.every((id) => importedTabIds.has(id)),
      ),
    );
    merged.history.push(
      ...next.history.filter((h) => h.profileId === profile.id),
    );
    merged.history = merged.history.slice(-10000);
    merged.activeSpaceId = first.id;
    merged.activeTabId = home.id;
    M.validateState(merged);
    await persist(merged);
    return { state: merged, report, profileId: profile.id };
  } catch (error) {
    // Roll back only this import's brand-new partition/vault. Source remains read-only.
    if (ses) await ses.clearStorageData().catch(() => {});
    await vault.removeProfile(profile.id).catch(() => {});
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
