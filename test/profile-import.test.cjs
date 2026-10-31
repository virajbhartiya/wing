const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const P = require("../src/profile-import.cjs");
const { importProfile } = require("../src/import-controller.cjs");
const { PasswordVault } = require("../src/password-vault.cjs");
const M = require("../src/model.cjs");
const key = Buffer.alloc(16, 7);
function encrypted(text, host) {
  const c = crypto.createCipheriv("aes-128-cbc", key, Buffer.alloc(16, 32));
  return Buffer.concat([
    Buffer.from("v10"),
    c.update(
      Buffer.concat([
        host
          ? crypto.createHash("sha256").update(host).digest()
          : Buffer.alloc(0),
        Buffer.from(text),
      ]),
    ),
    c.final(),
  ]);
}
test("v10 migration verifies domain binding and rejects unknown encryption", () => {
  assert.equal(
    P.decryptV10(encrypted("fixture-secret"), key),
    "fixture-secret",
  );
  assert.equal(
    P.decryptV10(encrypted("cookie", ".example.com"), key, ".example.com", 24),
    "cookie",
  );
  assert.throws(() =>
    P.decryptV10(
      encrypted("cookie", ".example.com"),
      key,
      ".attacker.test",
      24,
    ),
  );
  assert.throws(() => P.decryptV10(Buffer.from("v20unknown"), key));
});
test("cookie migration preserves host-only scope, expiry and rejects partitioned sessions", () => {
  const row = {
    host_key: "example.com",
    name: "s",
    path: "/",
    is_secure: 1,
    is_httponly: 1,
    samesite: 1,
    value: "fixture",
    has_expires: 0,
  };
  const out = P.cookieDetails(row, key, 24);
  assert.equal(out.domain, undefined);
  assert.equal(out.httpOnly, true);
  assert.equal(out.sameSite, "lax");
  assert.throws(() =>
    P.cookieDetails(
      { ...row, top_frame_site_key: "https://top.test" },
      key,
      24,
    ),
  );
  assert.throws(() =>
    P.cookieDetails({ ...row, has_expires: 1, expires_utc: 1 }, key, 24),
  );
});
test("profile discovery only admits recognized browser directories, never arbitrary paths", async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "wing-import-test-"));
  try {
    const root = path.join(base, "Google/Chrome/Default");
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(path.join(root, "Preferences"), "{}");
    assert.equal((await P.discoverProfiles(base))[0].id, "chrome:Default");
    await assert.rejects(P.resolveSource("chrome:../../secret", base));
  } finally {
    await fs.rm(base, { recursive: true, force: true });
  }
});
test("imports rebase onto concurrent workspace changes, preserve source and roll back failed destination", async () => {
  const state = M.initialState(),
    latest = structuredClone(state);
  latest.tabs.push(
    M.newTab(latest.activeSpaceId, "https://during-import.test"),
  );
  const fixture = {
    bookmarks: [
      {
        url: "https://example.com",
        title: "Example",
        folder: "Research",
        kind: "pinned",
      },
    ],
    spaces: [],
    history: [],
    cookies: [
      {
        host_key: "example.com",
        name: "s",
        path: "/",
        value: "fixture",
        is_secure: 1,
      },
    ],
    passwords: [],
    cookieVersion: 24,
    warnings: [],
  };
  let flushed = false,
    cleared = false;
  const ses = {
    cookies: {
      set: async () => {},
      flushStore: async () => {
        flushed = true;
      },
    },
    clearStorageData: async () => {
      cleared = true;
    },
  };
  const args = {
    source: { name: "Personal", browser: "chrome", browserName: "Chrome" },
    options: { bookmarks: true, cookies: true },
    state,
    getState: () => latest,
    sessionFor: () => ses,
    vault: { removeProfile: async () => {} },
    read: async () => structuredClone(fixture),
  };
  const imported = await importProfile({ ...args, persist: async () => {} });
  assert.equal(imported.report.cookies, 1);
  assert.ok(flushed);
  assert.equal(state.profiles.length, 2);
  assert.ok(
    imported.state.tabs.some((t) => t.url === "https://during-import.test/"),
  );
  assert.equal(imported.state.folders.at(-1).name, "Research");
  await assert.rejects(
    importProfile({
      ...args,
      persist: async () => {
        throw Error("disk full");
      },
    }),
  );
  assert.ok(cleared);
});
test("vault writes ciphertext, scopes credentials by exact origin/profile and fails closed if locked", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wing-vault-test-"));
  const storage = {
    isEncryptionAvailable: () => true,
    encryptString: (s) => {
      const c = crypto.createCipheriv(
        "aes-256-gcm",
        Buffer.alloc(32, 2),
        Buffer.alloc(12, 3),
      );
      const ciphertext = Buffer.concat([c.update(s, "utf8"), c.final()]);
      return Buffer.concat([c.getAuthTag(), ciphertext]);
    },
    decryptString: (b) => {
      const d = crypto.createDecipheriv(
        "aes-256-gcm",
        Buffer.alloc(32, 2),
        Buffer.alloc(12, 3),
      );
      d.setAuthTag(b.subarray(0, 16));
      return Buffer.concat([d.update(b.subarray(16)), d.final()]).toString();
    },
  };
  try {
    const v = new PasswordVault(root, storage);
    await v.import("one", [
      {
        url: "https://example.com/login",
        username: "fixture",
        password: "not-a-real-password",
      },
    ]);
    assert.equal(
      (await fs.readFile(v.file("one"))).includes(
        Buffer.from("not-a-real-password"),
      ),
      false,
    );
    assert.equal((await v.forOrigin("one", "https://example.com")).length, 1);
    assert.equal(
      (await v.forOrigin("one", "https://sub.example.com")).length,
      0,
    );
    assert.equal((await v.forOrigin("two", "https://example.com")).length, 0);
    storage.isEncryptionAvailable = () => false;
    await assert.rejects(v.import("one", []));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
test("read-only worker reads bookmarks and SQLite history without modifying source", async () => {
  const { DatabaseSync } = require("node:sqlite");
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wing-reader-test-"));
  try {
    await fs.writeFile(
      path.join(root, "Bookmarks"),
      JSON.stringify({
        roots: {
          bookmark_bar: {
            name: "Favorites",
            children: [
              { name: "Example", url: "https://example.com" },
              { name: "Blocked", url: "javascript:alert(1)" },
            ],
          },
        },
      }),
    );
    const db = new DatabaseSync(path.join(root, "History"));
    db.exec(
      "CREATE TABLE urls (url TEXT,title TEXT,last_visit_time INTEGER);INSERT INTO urls VALUES ('https://example.com','Example',13300000000000000)",
    );
    db.close();
    const before = await fs.readFile(path.join(root, "History"));
    const result = await P.readProfile(
      { path: root, browser: "chrome" },
      { bookmarks: true, history: true },
    );
    assert.equal(result.bookmarks.length, 1);
    assert.equal(result.history.length, 1);
    assert.deepEqual(await fs.readFile(path.join(root, "History")), before);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
test("Arc Spaces retain profile boundaries, folder hierarchy and tab kind", () => {
  const { arcSpaces } = require("../src/profile-reader.cjs");
  const data = {
    sidebar: {
      containers: [
        {
          spaces: [
            "s",
            {
              id: "s",
              title: "Research",
              profile: { custom: { _0: { directoryBasename: "Profile 2" } } },
              newContainerIDs: [
                { pinned: true },
                "root",
                { unpinned: true },
                "today",
              ],
            },
          ],
          items: [
            "root",
            { id: "root", childrenIds: ["folder"] },
            "folder",
            { id: "folder", title: "Reading", childrenIds: ["tab"] },
            "tab",
            {
              id: "tab",
              data: {
                tab: { savedURL: "https://example.com", savedTitle: "Example" },
              },
            },
            "today",
            { id: "today", childrenIds: ["fresh"] },
            "fresh",
            {
              id: "fresh",
              data: {
                tab: { savedURL: "https://fresh.test", savedTitle: "Fresh" },
              },
            },
          ],
        },
      ],
    },
  };
  assert.equal(arcSpaces(data, "Default").length, 0);
  const spaces = arcSpaces(data, "Profile 2");
  assert.equal(spaces[0].name, "Research");
  assert.equal(spaces[0].rows[0].folder, "Reading");
  assert.equal(spaces[0].rows[1].kind, "today");
});
test("SQLite password rows are read by the migration worker", async () => {
  const { DatabaseSync } = require("node:sqlite");
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "wing-import-password-reader-"),
  );
  try {
    const db = new DatabaseSync(path.join(directory, "Login Data"));
    db.exec(
      "CREATE TABLE logins(origin_url TEXT,username_value TEXT,password_value BLOB,blacklisted_by_user INTEGER)",
    );
    db.prepare("INSERT INTO logins VALUES(?,?,?,0)").run(
      "https://fixture.example/",
      "fixture-user",
      encrypted("fixture-secret"),
    );
    db.close();
    const result = await P.readProfile(
      { path: directory, browser: "chrome" },
      { passwords: true },
    );
    assert.equal(result.passwords.length, 1);
    assert.deepEqual(result.warnings, []);
    assert.equal(
      P.decryptV10(result.passwords[0].password_value, key),
      "fixture-secret",
    );
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("legacy Wing profile import remaps nested folders, pin destinations, archives and split geometry without changing the source", async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "wing-legacy-import-"));
  try {
    const source = M.initialState(),
      profileId = source.profiles[0].id;
    const space = source.spaces.find((s) => s.profileId === profileId);
    const root = path.join(base, "Wing");
    await fs.mkdir(path.join(root, "password-vault"), { recursive: true });
    source.folders.push(
      {
        id: "parent-folder",
        spaceId: space.id,
        name: "Research",
        collapsed: false,
      },
      {
        id: "child-folder",
        spaceId: space.id,
        name: "Reading",
        parentId: "parent-folder",
        collapsed: true,
      },
    );
    const a = M.newTab(space.id, "https://legacy.example/a", {
      kind: "pinned",
      folderId: "child-folder",
    });
    const b = M.newTab(space.id, "https://legacy.example/b", {
      kind: "pinned",
      folderId: "child-folder",
    });
    a.customTitle = true;
    a.title = "Saved research";
    a.url = "https://legacy.example/current";
    source.tabs.push(a, b);
    source.splits.push({
      id: "legacy-split",
      tabIds: [a.id, b.id],
      orientation: "vertical",
      weights: [0.3, 0.7],
    });
    const archived = M.newTab(space.id, "https://legacy.example/archived");
    source.archive.push({ ...archived, archivedAt: Date.now() });
    source.history.push({
      id: "legacy-history",
      url: a.url,
      title: a.title,
      profileId,
      at: 123456789,
    });
    const bytes = JSON.stringify(source);
    await fs.writeFile(path.join(root, "workspace.json"), bytes);
    const vaultBytes = encrypted(
      JSON.stringify({
        version: 1,
        entries: [
          {
            origin: "https://legacy.example",
            username: "fixture-user",
            password: "fixture-password",
          },
        ],
      }),
    );
    await fs.writeFile(
      path.join(root, "password-vault", profileId + ".vault"),
      vaultBytes,
    );
    const found = (await P.discoverProfiles(base)).find(
      (p) => p.id === `wing:${profileId}`,
    );
    assert.ok(found);
    await assert.rejects(P.resolveSource("wing:../../outside", base));
    const resolved = await P.resolveSource(found.id, base);
    let savedCredentials;
    const result = await importProfile({
      source: resolved,
      options: { bookmarks: true, tabs: true, history: true, passwords: true },
      state: M.initialState(),
      getKey: async () => Buffer.from(key),
      vault: {
        import: async (_id, items) => {
          savedCredentials = structuredClone(items);
          return items.length;
        },
        removeProfile: async () => {},
      },
      persist: async () => {},
      sessionFor: () => {
        throw Error("No cookie import requested");
      },
    });
    const imported = result.state.tabs.find(
      (t) => t.title === "Saved research",
    );
    assert.notEqual(imported.id, a.id);
    assert.equal(imported.homeURL, a.homeURL);
    assert.equal(imported.url, a.url);
    assert.equal(
      result.state.folders.find((f) => f.id === imported.folderId).name,
      "Reading",
    );
    const group = result.state.splits.find((s) =>
      s.tabIds.includes(imported.id),
    );
    assert.deepEqual(group.weights, [0.3, 0.7]);
    assert.equal(group.orientation, "vertical");
    assert.equal(result.report.archivedTabs, 1);
    assert.ok(
      result.state.archive.some(
        (t) => t.url === archived.url && t.id !== archived.id,
      ),
    );
    assert.equal(
      result.state.history.find((h) => h.profileId === result.profileId).at,
      123456789,
    );
    assert.equal(savedCredentials[0].password, "fixture-password");
    assert.equal(result.report.passwords, 1);
    assert.equal(
      await fs.readFile(path.join(root, "workspace.json"), "utf8"),
      bytes,
    );
    assert.deepEqual(
      await fs.readFile(
        path.join(root, "password-vault", profileId + ".vault"),
      ),
      vaultBytes,
    );
    M.validateState(result.state);
  } finally {
    await fs.rm(base, { recursive: true, force: true });
  }
});

test("an unsupported legacy Wing vault aborts before workspace persistence and rolls back its fresh destination", async () => {
  let persisted = false,
    removed = false;
  await assert.rejects(
    importProfile({
      source: { browser: "wing", name: "Legacy", browserName: "Wing" },
      options: { passwords: true },
      state: M.initialState(),
      getKey: async () => Buffer.from(key),
      read: async () => ({
        bookmarks: [],
        spaces: [],
        history: [],
        cookies: [],
        passwords: [],
        warnings: [],
        encryptedVault: Buffer.from("unsupported"),
      }),
      vault: {
        import: async () => {
          throw Error("Must not import");
        },
        removeProfile: async () => {
          removed = true;
        },
      },
      persist: async () => {
        persisted = true;
      },
    }),
    /could not be unlocked/,
  );
  assert.equal(persisted, false);
  assert.equal(removed, true);
});

test("legacy Wing import respects independent saved-tab and open-tab choices", () => {
  const { appendWingProfile } = require("../src/wing-profile-migration.cjs");
  const source = M.initialState(),
    destination = M.initialState();
  const profileId = source.profiles[0].id;
  const space = source.spaces.find((s) => s.profileId === profileId);
  source.folders.push({
    id: "excluded-folder",
    spaceId: space.id,
    name: "Not selected",
    collapsed: false,
  });
  const target = { id: "fresh-import", name: "Imported" };
  destination.profiles.push(target);
  const result = appendWingProfile(destination, source, profileId, target, {
    tabs: true,
    bookmarks: false,
  });
  const ids = new Set(result.spaces.map((s) => s.id));
  assert.equal(
    destination.tabs.filter((t) => ids.has(t.spaceId) && t.kind !== "today")
      .length,
    0,
  );
  assert.equal(destination.folders.filter((f) => ids.has(f.spaceId)).length, 0);
});
