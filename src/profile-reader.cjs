"use strict";
// Read-only SQLite transactions run off the browser's UI thread. No plaintext snapshots.
const { parentPort, workerData } = require("node:worker_threads");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { webURL } = require("./profile-import.cjs");
const F = require("./browser-formats.cjs");
function json(file) {
  if (fs.statSync(file).size > 64 * 1024 * 1024)
    throw Error("Source file exceeds import limit");
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
function rows(db, sql) {
  const statement = db.prepare(sql);
  statement.setReadBigInts(true);
  return statement
    .all()
    .map((row) =>
      Object.fromEntries(
        Object.entries(row).map(([k, v]) => [
          k,
          typeof v === "bigint" ? Number(v) : v,
        ]),
      ),
    );
}
function database(file, fn) {
  if (!fs.existsSync(file)) return null;
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    db.exec("PRAGMA query_only=ON; BEGIN");
    return fn(db);
  } finally {
    db.close();
  }
}
function bookmarks(root) {
  const rows = [];
  function walk(node, folders = [], depth = 0) {
    if (!node || depth > 32 || rows.length >= 5000) return;
    const url = webURL(node.url);
    if (url)
      rows.push({
        url,
        title: String(node.name || url).slice(0, 300),
        folder: folders.join(" / ").slice(0, 80),
        kind: "pinned",
      });
    if (Array.isArray(node.children))
      for (const child of node.children)
        walk(child, node.name ? [...folders, node.name] : folders, depth + 1);
  }
  for (const node of Object.values(root?.roots || {})) walk(node);
  return rows;
}
function arcSpaces(sidebar, directory) {
  const spaces = [];
  for (const container of sidebar?.sidebar?.containers || []) {
    const items = new Map(
      (container.items || [])
        .filter((x) => x && typeof x === "object" && x.id)
        .map((x) => [x.id, x]),
    );
    for (const source of (container.spaces || []).filter(
      (x) => x && typeof x === "object",
    )) {
      const profile = source.profile?.default
        ? "Default"
        : source.profile?.custom?._0?.directoryBasename;
      if (profile !== directory) continue;
      const rows = [],
        seen = new Set();
      function walk(id, kind, folder = "", depth = 0) {
        if (seen.has(id) || depth > 32 || rows.length >= 5000) return;
        seen.add(id);
        const item = items.get(id);
        if (!item) return;
        const tab = item.data?.tab,
          url = webURL(tab?.savedURL);
        if (url)
          rows.push({
            url,
            title: String(item.title || tab.savedTitle || url).slice(0, 300),
            kind,
            folder,
          });
        const nextFolder =
          !tab && item.title
            ? [folder, item.title].filter(Boolean).join(" / ").slice(0, 80)
            : folder;
        for (const child of item.childrenIds || [])
          walk(child, kind, nextFolder, depth + 1);
      }
      const roots = source.newContainerIDs || [];
      for (let i = 0; i + 1 < roots.length; i += 2)
        walk(
          roots[i + 1],
          roots[i]?.unpinned !== undefined ? "today" : "pinned",
        );
      const apps = container.topAppsContainerIDs || [];
      for (let i = 0; i + 1 < apps.length; i += 2) {
        const p = apps[i]?.default
          ? "Default"
          : apps[i]?.custom?._0?.directoryBasename;
        if (p === directory) walk(apps[i + 1], "favorite");
      }
      spaces.push({ name: String(source.title || "Arc").slice(0, 60), rows });
    }
  }
  return spaces;
}
function safariBookmarks(root) {
  const rows = [];
  function walk(node, folders = [], depth = 0) {
    if (!node || depth > 32 || rows.length >= 5000) return;
    const url = webURL(node.URLString);
    if (url)
      rows.push({
        url,
        title: String(node.URIDictionary?.title || url).slice(0, 300),
        folder: folders.join(" / ").slice(0, 80),
        kind: "pinned",
      });
    if (Array.isArray(node.Children)) {
      const name =
        node.Title === "com.apple.ReadingList"
          ? "Reading List"
          : node.Title === "BookmarksBar"
            ? "Favorites"
            : node.Title === "BookmarksMenu"
              ? "Bookmarks Menu"
              : node.Title;
      const next = name ? [...folders, name] : folders;
      for (const child of node.Children) walk(child, next, depth + 1);
    }
  }
  walk(root);
  return rows;
}
function readLimited(file, limit = 256 * 1024 * 1024) {
  if (fs.statSync(file).size > limit)
    throw Error("Source file exceeds import limit");
  return fs.readFileSync(file);
}
function readSafari(source, options, result) {
  let denied = 0,
    attempted = 0;
  function attempt(label, fn) {
    attempted++;
    try {
      fn();
    } catch (error) {
      if (error.code === "EPERM" || error.code === "EACCES") denied++;
      else if (error.code !== "ENOENT")
        result.warnings.push(`Safari ${label} could not be read.`);
    }
  }
  const container = path.join(
    source.root,
    "../Containers/com.apple.Safari/Data/Library",
  );
  if (options.bookmarks)
    attempt("bookmarks", () => {
      result.bookmarks = safariBookmarks(
        F.parseBplist(readLimited(path.join(source.root, "Bookmarks.plist"))),
      );
    });
  if (options.history)
    attempt("history", () => {
      // Probe first: SQLite reports a denied file as a generic open failure.
      fs.accessSync(path.join(source.root, "History.db"), fs.constants.R_OK);
      result.history =
        database(path.join(source.root, "History.db"), (db) =>
          rows(
            db,
            `SELECT i.url AS url, v.title AS title,
               (v.visit_time + ${978307200 + 11644473600}) * 1000000 AS last_visit_time
             FROM history_visits v JOIN history_items i ON i.id = v.history_item
             GROUP BY i.id HAVING v.visit_time = MAX(v.visit_time)
             ORDER BY v.visit_time DESC LIMIT 5000`,
          ),
        ) || [];
    });
  if (options.tabs)
    attempt("open tabs", () => {
      const file = path.join(container, "Safari/SafariTabs.db");
      fs.accessSync(file, fs.constants.R_OK);
      const tabs =
        database(file, (db) =>
          rows(
            db,
            "SELECT url,title FROM bookmarks WHERE type=0 AND url LIKE 'http%' LIMIT 5000",
          ),
        ) || [];
      const open = tabs
        .map((t) => ({ url: webURL(t.url), title: t.title, kind: "today" }))
        .filter((t) => t.url);
      if (open.length)
        result.spaces.push({ name: "Safari tabs", rows: open });
    });
  if (options.cookies)
    attempt("cookies", () => {
      result.cookies = F.parseBinaryCookies(
        readLimited(path.join(container, "Cookies/Cookies.binarycookies")),
      );
    });
  if (options.passwords && source.passwordsCsv) {
    try {
      result.credentials = F.parseCredentialCsv(
        readLimited(source.passwordsCsv, 16 * 1024 * 1024).toString("utf8"),
      );
    } catch {
      result.warnings.push(
        "The password file could not be read. Export it from the Passwords app as CSV.",
      );
    }
  } else if (options.passwords)
    result.warnings.push(
      "Safari passwords live in iCloud Keychain, which other apps cannot read. Export them from the Passwords app as CSV, then import again and choose that file.",
    );
  if (denied && denied === attempted)
    throw Object.assign(Error("full-disk-access"), { fullDiskAccess: true });
  if (denied)
    result.warnings.push(
      "Some Safari data was blocked by macOS. Give Wing Full Disk Access in System Settings → Privacy & Security, then import again.",
    );
}
function installedExtensions(source) {
  const names = new Set(),
    root = path.join(source.path, "Extensions");
  for (const id of fs.readdirSync(root)) {
    if (!/^[a-p]{32}$/.test(id)) continue;
    const version = fs.readdirSync(path.join(root, id)).sort().at(-1);
    const manifest = json(path.join(root, id, version, "manifest.json"));
    if (!String(manifest.name).startsWith("__MSG_"))
      names.add(String(manifest.name).slice(0, 80));
  }
  return [...names].sort();
}
function chromeOpenTabs(source) {
  const directory = path.join(source.path, "Sessions");
  const latest = fs
    .readdirSync(directory)
    .filter((name) => name.startsWith("Session_"))
    .map((name) => path.join(directory, name))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
  if (!latest) return [];
  return F.parseSessionTabs(readLimited(latest))
    .map((tab) => ({
      url: webURL(tab.url),
      title: tab.url,
      kind: tab.pinned ? "pinned" : "today",
    }))
    .filter((tab) => tab.url);
}
function read(source, options) {
  const result = {
    bookmarks: [],
    spaces: [],
    history: [],
    cookies: [],
    passwords: [],
    cookieVersion: 0,
    warnings: [],
  };
  function attempt(label, fn) {
    try {
      fn();
    } catch {
      result.warnings.push(
        `${label} could not be read. Quit the source browser and retry if needed.`,
      );
    }
  }
  if (source.browser === "safari") {
    readSafari(source, options, result);
    return result;
  }
  if (source.browser === "chrome" && options.tabs)
    attempt("Chrome open tabs", () => {
      const rows = chromeOpenTabs(source);
      if (rows.length) result.spaces.push({ name: "Chrome tabs", rows });
    });
  if (source.browser !== "wing" && options.bookmarks)
    try {
      const names = installedExtensions(source);
      if (names.length)
        result.warnings.push(
          `Extensions to reinstall in Settings → Extensions: ${names.join(", ")}.`,
        );
    } catch {}
  if (source.browser === "wing") {
    const state = require("./model.cjs").validateState(
      json(path.join(source.root, "workspace.json")),
    );
    if (!state.profiles.some((p) => p.id === source.profileId))
      throw Error("Missing Wing profile");
    if (options.tabs || options.bookmarks) result.wingState = state;
    if (options.history)
      result.history = state.history
        .filter((h) => h.profileId === source.profileId)
        .map((h) => ({
          url: h.url,
          title: h.title,
          last_visit_time: (h.at + 11644473600000) * 1000,
        }));
    if (options.passwords) {
      const vault = path.join(
        source.root,
        "password-vault",
        source.profileId + ".vault",
      );
      if (fs.existsSync(vault)) {
        if (fs.statSync(vault).size > 16 * 1024 * 1024)
          throw Error("Password vault exceeds import limit");
        result.encryptedVault = fs.readFileSync(vault);
      }
    }
  }
  if (options.bookmarks && source.browser !== "wing")
    attempt("Bookmarks", () => {
      const file = path.join(source.path, "Bookmarks");
      if (fs.existsSync(file)) result.bookmarks = bookmarks(json(file));
    });
  if (source.browser === "arc" && options.tabs)
    attempt("Arc Spaces", () => {
      result.spaces = arcSpaces(
        json(path.join(source.root, "../StorableSidebar.json")),
        source.directory,
      );
    });
  if (options.history && source.browser !== "wing")
    attempt("History", () => {
      const load = (file) =>
        database(file, (db) =>
          rows(
            db,
            "SELECT url,title,last_visit_time FROM urls ORDER BY last_visit_time DESC LIMIT 5000",
          ),
        ) || [];
      const file = path.join(source.path, "History");
      try {
        result.history = load(file);
      } catch {
        // A running browser holds this lock. History has no credentials, so a
        // private temporary copy is acceptable; Cookies and Login Data never do this.
        const copy = fs.mkdtempSync(path.join(os.tmpdir(), "wing-history-"));
        try {
          fs.copyFileSync(file, path.join(copy, "History"));
          result.history = load(path.join(copy, "History"));
        } finally {
          fs.rmSync(copy, { recursive: true, force: true });
        }
      }
    });
  if (options.cookies)
    attempt("Session cookies", () => {
      const files = [
        path.join(source.path, "Network/Cookies"),
        path.join(source.path, "Cookies"),
      ];
      const file = files.find(fs.existsSync);
      if (!file) return;
      database(file, (db) => {
        result.cookieVersion = Number(
          db.prepare("SELECT value FROM meta WHERE key='version'").get()
            ?.value || 0,
        );
        result.cookies = rows(db, "SELECT * FROM cookies LIMIT 30000");
      });
    });
  if (options.passwords)
    attempt("Saved passwords", () => {
      for (const name of ["Login Data", "Login Data For Account"]) {
        const credentials = database(path.join(source.path, name), (db) =>
          rows(
            db,
            "SELECT origin_url,username_value,password_value FROM logins WHERE blacklisted_by_user=0 LIMIT 10000",
          ),
        );
        if (credentials) result.passwords.push(...credentials);
      }
    });
  return result;
}
if (parentPort) {
  try {
    parentPort.postMessage(read(workerData.source, workerData.options));
  } catch (error) {
    parentPort.postMessage({
      error: error.fullDiskAccess
        ? "macOS blocked access to Safari. Give Wing Full Disk Access in System Settings → Privacy & Security, reopen Wing, and import again."
        : "Could not read source profile",
    });
  }
}
module.exports = { bookmarks, arcSpaces, safariBookmarks, read };
