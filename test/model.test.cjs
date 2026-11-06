const { test } = require("node:test");
const assert = require("node:assert/strict");
const m = require("../src/model.cjs");
test("addresses, local development URLs, searches and blocked schemes", () => {
  assert.equal(m.normalizeURL("example.com/path"), "https://example.com/path");
  assert.equal(m.normalizeURL("localhost:3000"), "http://localhost:3000/");
  assert.equal(
    m.normalizeURL("hello world"),
    "https://www.google.com/search?q=hello%20world",
  );
  for (const url of [
    "javascript:alert(1)",
    "file:///etc/passwd",
    "data:text/html,hi",
    "chrome://settings",
  ])
    assert.throws(() => m.normalizeURL(url));
});
test("only Chromium's password, history and clear-data pages are allowed", () => {
  assert.equal(m.normalizeURL("wing://passwords"), "chrome://password-manager/passwords");
  assert.equal(m.normalizeURL("wing://history"), "chrome://history/");
  assert.equal(m.normalizeURL("chrome://settings/clearBrowserData"), "chrome://settings/clearBrowserData");
  for (const url of ["chrome://settings/", "chrome://flags", "chrome://password-manager/../flags", "chrome://history/<script>"])
    assert.throws(() => m.normalizeURL(url));
});
test("spaces separate tabs; favorites follow profile boundaries", () => {
  const s = m.initialState();
  assert.equal(m.visibleTabs(s).length, 5);
  m.selectSpace(s, s.spaces[1].id);
  assert.equal(m.visibleTabs(s).length, 0);
  s.spaces[1].profileId = "default";
  assert.equal(m.visibleTabs(s).length, 3);
  m.activate(s, s.tabs[0].id);
  assert.equal(s.activeSpaceId, s.spaces[1].id);
});
test("auto archive protects active, pinned, favorite and split tabs", () => {
  const s = m.initialState(),
    old = Date.now() - 24 * 3600000;
  s.tabs.forEach((t) => (t.lastActive = old));
  const t = m.newTab(s.activeSpaceId, "https://example.com/", {
    lastActive: old,
  });
  s.tabs.push(t);
  assert.deepEqual(m.autoArchive(s, Date.now(), [t.id]), []);
  assert.deepEqual(m.autoArchive(s), [t.id]);
  assert.equal(s.tabs.length, 5);
  m.restoreTab(s, t.id);
  assert.equal(s.activeTabId, t.id);
  assert.equal(s.archive.length, 0);
});
test("moving a tab across spaces validates folder ownership", () => {
  const s = m.initialState(),
    t = s.tabs.at(-1),
    dest = s.spaces[1];
  s.folders.push({ id: "f", spaceId: dest.id, name: "Research" });
  m.moveTab(s, t.id, dest.id, "f");
  assert.equal(t.kind, "pinned");
  assert.equal(t.folderId, "f");
  assert.equal(s.activeSpaceId, dest.id);
  m.moveTab(s, t.id, s.spaces[0].id, "f");
  assert.equal(t.folderId, null);
});
test("workspace round trip and invalid import rejection", () => {
  const s = m.initialState();
  assert.deepEqual(m.validateState(JSON.parse(JSON.stringify(s))), s);
  s.tabs[0].url = "file:///tmp/a";
  assert.throws(() => m.validateState(s));
  assert.throws(() => m.validateState({ version: 2 }));
});
test("archiving final tab leaves a valid empty workspace", () => {
  const s = m.initialState();
  s.tabs.slice().forEach((t) => m.archiveTab(s, t.id));
  assert.equal(s.activeTabId, null);
  assert.equal(s.archive.length, 5);
  m.restoreTab(s, s.archive[0].id);
  assert.ok(s.activeTabId);
});
test("import validates archived URLs, unique identities and collection shapes", () => {
  let s = m.initialState();
  s.archive = [{ ...s.tabs[0], url: "javascript:alert(1)" }];
  assert.throws(() => m.validateState(s));
  s = m.initialState();
  s.tabs.push({ ...s.tabs[0] });
  assert.throws(() => m.validateState(s));
  s = m.initialState();
  s.folders = "bad";
  assert.throws(() => m.validateState(s));
  s = m.initialState();
  s.activeSpaceId = "missing";
  assert.throws(() => m.validateState(s));
});
test("import clamps layout values and rejects invalid saved styles", () => {
  let s = m.initialState();
  s.settings.sidebarWidth = 999999;
  assert.equal(m.validateState(s).settings.sidebarWidth, 360);
  s = m.initialState();
  s.boosts = { "file:///private": "body{}" };
  assert.throws(() => m.validateState(s));
});

test("workspace import rejects cyclic, missing and cross-space folder parents", () => {
  const s = m.initialState();
  s.folders = [
    { id: "a", name: "A", spaceId: s.activeSpaceId, parentId: null },
    { id: "b", name: "B", spaceId: s.activeSpaceId, parentId: "a" },
  ];
  assert.equal(m.validateState(s).folders.length, 2);
  s.folders[0].parentId = "b";
  assert.throws(() => m.validateState(s));
  s.folders[0].parentId = "missing";
  assert.throws(() => m.validateState(s));
  s.folders[0].parentId = null;
  s.folders[0].spaceId = s.spaces[1].id;
  assert.throws(() => m.validateState(s));
});
test("tab position defaults to the top bar and page frame follows it", () => {
  const s = m.initialState();
  assert.equal(s.settings.tabLayout, "top");
  delete s.settings.tabLayout;
  assert.equal(m.validateState(s).settings.tabLayout, "top");
  s.settings.tabLayout = "sidebar";
  assert.equal(m.validateState(s).settings.tabLayout, "sidebar");
  assert.deepEqual(m.splits.frame({ tabLayout: "top" }, 256), { left: 8, top: 88, margin: 8 });
  assert.deepEqual(m.splits.frame({ tabLayout: "sidebar" }, 256), { left: 256, top: 52, margin: 8 });
  assert.deepEqual(
    m.splits.bounds({ width: 1000, height: 700, left: 0, top: 88, margin: 0, weights: [1] })[0],
    { x: 0, y: 88, width: 1000, height: 612 },
  );
});
test("reordering Spaces keeps profile shortcuts in the same order", () => {
  const s = m.initialState();
  const [personal, work] = s.spaces;
  m.reorderSpace(s, work.id, personal.id);
  assert.deepEqual(s.spaces.map((x) => x.id), [work.id, personal.id]);
  assert.deepEqual(s.profiles.map((p) => p.id), ["work", "default"]);
  m.reorderSpace(s, work.id, undefined);
  assert.deepEqual(s.spaces.map((x) => x.id), [personal.id, work.id]);
  assert.deepEqual(s.profiles.map((p) => p.id), ["default", "work"]);
});
test("Space icons keep whole emoji and fall back when empty", () => {
  assert.equal(m.spaceIcon("🏳️‍🌈x"), "🏳️‍🌈");
  assert.equal(m.spaceIcon("Work"), "W");
  assert.equal(m.spaceIcon("  "), "✳");
});
test("the mini player turns on once for layouts saved before it, then keeps the choice", () => {
  const old = m.initialState();
  delete old.settings.miniPlayerIntroduced;
  old.settings.automaticPictureInPicture = false;
  const migrated = m.validateState(JSON.parse(JSON.stringify(old)));
  assert.equal(migrated.settings.automaticPictureInPicture, true);
  migrated.settings.automaticPictureInPicture = false;
  assert.equal(m.validateState(migrated).settings.automaticPictureInPicture, false);
  assert.equal(m.initialState().settings.automaticPictureInPicture, true);
});
