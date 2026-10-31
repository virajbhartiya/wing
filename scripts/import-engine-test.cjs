#!/usr/bin/env electron
"use strict";
// Runs the importers against synthetic Chrome and Safari data in real Electron
// sessions. Uses fixture secrets only and never reads a real browser profile.
const { app, session } = require("electron");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const M = require("../src/model.cjs");
const P = require("../src/profile-import.cjs");
const { importProfile } = require("../src/import-controller.cjs");
const key = Buffer.alloc(16, 7);
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "wing-import-engine-"));
app.setPath("userData", path.join(temp, "wing"));
function encrypt(text, host) {
  const c = crypto.createCipheriv("aes-128-cbc", key, Buffer.alloc(16, 32));
  const prefix = host
    ? crypto.createHash("sha256").update(host).digest()
    : Buffer.alloc(0);
  return Buffer.concat([
    Buffer.from("v10"),
    c.update(Buffer.concat([prefix, Buffer.from(text)])),
    c.final(),
  ]);
}
const FUTURE = (Date.now() / 1000 + 86400 + 11644473600) * 1000000;
function chromeFixture(base) {
  const root = path.join(base, "Application Support/Google/Chrome");
  const dir = path.join(root, "Default");
  fs.mkdirSync(path.join(dir, "Network"), { recursive: true });
  fs.writeFileSync(path.join(dir, "Preferences"), "{}");
  fs.writeFileSync(
    path.join(dir, "Bookmarks"),
    JSON.stringify({
      roots: {
        bookmark_bar: {
          name: "Bar",
          children: [{ name: "Site", url: "https://bookmark.test/" }],
        },
      },
    }),
  );
  let db = new DatabaseSync(path.join(dir, "Network/Cookies"));
  db.exec(`CREATE TABLE meta(key TEXT, value TEXT);
    INSERT INTO meta VALUES('version','24');
    CREATE TABLE cookies(host_key TEXT,name TEXT,value TEXT,encrypted_value BLOB,
      path TEXT,expires_utc INTEGER,is_secure INTEGER,is_httponly INTEGER,
      has_expires INTEGER,samesite INTEGER,top_frame_site_key TEXT)`);
  db.prepare("INSERT INTO cookies VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(
    ".import.test", "sid", "", encrypt("cookie-fixture", ".import.test"),
    "/", FUTURE, 1, 1, 1, 1, "",
  );
  db.close();
  db = new DatabaseSync(path.join(dir, "Login Data"));
  db.exec(`CREATE TABLE logins(origin_url TEXT,username_value TEXT,
    password_value BLOB,blacklisted_by_user INTEGER)`);
  db.prepare("INSERT INTO logins VALUES(?,?,?,0)").run(
    "https://import.test/", "fixture-user", encrypt("fixture-password"),
  );
  db.close();
  db = new DatabaseSync(path.join(dir, "History"));
  db.exec(`CREATE TABLE urls(url TEXT,title TEXT,last_visit_time INTEGER);
    INSERT INTO urls VALUES('https://visited.test/','Visited',${FUTURE})`);
  db.close();
}
function safariFixture(base) {
  const root = path.join(base, "Safari");
  const data = path.join(base, "Containers/com.apple.Safari/Data/Library");
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(path.join(data, "Safari"), { recursive: true });
  let db = new DatabaseSync(path.join(root, "History.db"));
  db.exec(`CREATE TABLE history_items(id INTEGER,url TEXT);
    CREATE TABLE history_visits(history_item INTEGER,visit_time REAL,title TEXT);
    INSERT INTO history_items VALUES(1,'https://safari-history.test/');
    INSERT INTO history_visits VALUES(1,700000000,'Older');
    INSERT INTO history_visits VALUES(1,800000000,'Newest')`);
  db.close();
  db = new DatabaseSync(path.join(data, "Safari/SafariTabs.db"));
  db.exec(`CREATE TABLE bookmarks(type INTEGER,url TEXT,title TEXT);
    INSERT INTO bookmarks VALUES(0,'https://safari-tab.test/','Tab');
    INSERT INTO bookmarks VALUES(1,NULL,'Group')`);
  db.close();
}
async function run(id, base, options, expect) {
  const stored = [];
  const source = await P.resolveSource(
    id,
    path.join(base, "Application Support"),
  );
  let partition;
  const { report, state } = await importProfile({
    source,
    options,
    state: M.initialState(),
    getKey: async () => Buffer.from(key),
    sessionFor: (profile) =>
      (partition = session.fromPartition(`persist:import-test-${profile}`)),
    vault: {
      import: async (_, rows) => {
        stored.push(...structuredClone(rows));
        return rows.length;
      },
      removeProfile: async () => {},
    },
    persist: async () => {},
  });
  await expect({ report, state, stored, partition });
}
app.whenReady().then(async () => {
  try {
    chromeFixture(temp);
    safariFixture(temp);
    await run(
      "chrome:Default",
      temp,
      { bookmarks: true, history: true, cookies: true, passwords: true },
      async ({ report, stored, partition, state }) => {
        assert.equal(report.bookmarks, 1);
        assert.equal(report.history, 1);
        assert.equal(report.cookies, 1, `skipped ${report.skippedCookies}`);
        assert.equal(stored[0].password, "fixture-password");
        const [cookie] = await partition.cookies.get({ name: "sid" });
        assert.equal(cookie.value, "cookie-fixture");
        assert.equal(cookie.httpOnly, true);
      },
    );
    await run(
      "safari:Default",
      temp,
      { tabs: true, history: true, passwords: true },
      async ({ report, state }) => {
        assert.equal(report.tabs, 1);
        assert.equal(report.history, 1);
        assert.equal(
          state.history.find((h) => h.url.includes("safari-history")).title,
          "Newest",
        );
        assert.match(report.warnings.join(), /iCloud Keychain/);
      },
    );
    console.log("import engine test passed");
    fs.rmSync(temp, { recursive: true, force: true });
    app.exit(0);
  } catch (error) {
    console.error(error);
    fs.rmSync(temp, { recursive: true, force: true });
    app.exit(1);
  }
});
