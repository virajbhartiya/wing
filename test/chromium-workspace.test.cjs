const test = require("node:test");
const assert = require("node:assert/strict");
const { ChromiumWorkspace } = require("../src/chromium-workspace.cjs");

test("native workspace keeps pin and split semantics across serialization", () => {
  const workspace = new ChromiumWorkspace();
  workspace.action("new-tab", { url: "https://a.example" });
  const a = workspace.state.activeTabId;
  workspace.action("new-tab", { url: "https://b.example" });
  const b = workspace.state.activeTabId;
  workspace.action("split", { id: a });
  workspace.action("pin", { id: b });
  workspace.action("split-ratio", { divider: 0, ratio: 0.3 });
  workspace.closed(a);
  workspace.closed(b);
  assert.equal(workspace.state.tabs.find((tab) => tab.id === a).closed, true);
  workspace.action("select-tab", { id: a });
  const restored = new ChromiumWorkspace(
    JSON.parse(JSON.stringify(workspace.state)),
  );
  assert.equal(restored.snapshot().splitIds.length, 2);
  const panes = restored.layout(1200, 800);
  assert.equal(panes.length, 2);
  assert.ok(panes[0].width < panes[1].width);
});
test("native search resolution and page events use the shared model without losing pin destinations", () => {
  const workspace = new ChromiumWorkspace();
  workspace.state.settings.siteSearches = [
    { name: "Docs", keyword: "docs", url: "https://example.com/search?q=%s" },
  ];
  workspace.action("new-tab", { url: "docs a b" });
  const tab = workspace.state.tabs.find(
    (tab) => tab.id === workspace.state.activeTabId,
  );
  assert.equal(tab.url, "https://example.com/search?q=a%20b");
  workspace.action("pin", { id: tab.id });
  workspace.pageChanged({
    id: tab.id,
    url: "https://example.com/next",
    title: "Next",
    canGoBack: true,
  });
  assert.equal(tab.homeURL, "https://example.com/search?q=a%20b");
  assert.equal(
    workspace.snapshot().tabs.find((t) => t.id === tab.id).canGoBack,
    true,
  );
  workspace.action("reset-pin", { id: tab.id });
  assert.equal(tab.url, tab.homeURL);
});
test("native split requests cannot cross profile identity", () => {
  const workspace = new ChromiumWorkspace();
  workspace.action("new-tab", { url: "https://a.example" });
  const a = workspace.state.activeTabId;
  workspace.action("space", { id: workspace.state.spaces[1].id });
  workspace.action("new-tab", { url: "https://b.example" });
  assert.throws(() => workspace.action("split", { id: a }), /profile/);
});
test("native Space creation isolates profiles and validates settings atomically", () => {
  const workspace = new ChromiumWorkspace();
  workspace.action("save-space", {
    name: "Research",
    profileId: "new",
    theme: "lavender",
  });
  const space = workspace.state.spaces.find(
    (s) => s.id === workspace.state.activeSpaceId,
  );
  assert.equal(space.name, "Research");
  assert.notEqual(space.profileId, "default");
  workspace.action("features-settings", {
    cleanCopy: false,
    siteSearches: [
      { name: "Docs", keyword: "d", url: "https://docs.example/?q=%s" },
    ],
  });
  assert.equal(workspace.state.settings.cleanCopy, false);
  assert.throws(
    () =>
      workspace.action("features-settings", {
        cleanCopy: true,
        routes: [{ type: "host", value: "x", spaceId: "missing" }],
      }),
    /route/,
  );
  assert.equal(workspace.state.settings.cleanCopy, false);
  workspace.action("new-tab", { url: "d test" });
  assert.equal(
    workspace.state.tabs.find((t) => t.id === workspace.state.activeTabId).url,
    "https://docs.example/?q=test",
  );
});
test("native bulk organization rejects another profile and restores through undo", () => {
  const workspace = new ChromiumWorkspace();
  workspace.action("new-tab", { url: "https://one.example" });
  const a = workspace.state.activeTabId;
  workspace.action("save-space", { name: "Other", profileId: "new" });
  workspace.action("new-tab", { url: "https://two.example" });
  const b = workspace.state.activeTabId;
  workspace.action("bulk-tabs", { ids: [a, b], operation: "pin" });
  assert.equal(workspace.state.tabs.find((t) => t.id === a).kind, "today");
  assert.equal(workspace.state.tabs.find((t) => t.id === b).kind, "pinned");
  workspace.action("organization-undo");
  assert.equal(workspace.state.tabs.find((t) => t.id === b).kind, "today");
});
test("native Peek is transient, promotes the same tab, and leaves the original selection intact", () => {
  const workspace = new ChromiumWorkspace();
  const original = workspace.state.activeTabId;
  workspace.action("peek", { url: "https://peek.example" });
  const peek = workspace.peekId;
  assert.equal(workspace.state.activeTabId, original);
  assert.equal(
    workspace.snapshot().tabs.some((t) => t.id === peek),
    false,
  );
  assert.equal(workspace.layout(1200, 800)[0].id, peek);
  workspace.action("promote-peek");
  assert.equal(workspace.state.activeTabId, peek);
  assert.equal(
    workspace.state.tabs.find((t) => t.id === peek).transient,
    undefined,
  );
  workspace.action("peek", { url: "https://closed.example" });
  const temporary = workspace.peekId;
  workspace.closed(temporary);
  assert.equal(
    workspace.state.archive.some((t) => t.id === temporary),
    false,
  );
  assert.equal(
    workspace.state.tabs.some((t) => t.id === temporary),
    false,
  );
});

test("native external links use routing rules and reject non-web schemes", () => {
  const workspace = new ChromiumWorkspace();
  const destination = workspace.state.spaces[1];
  workspace.state.settings.routes = [
    { type: "host", value: "example.com", spaceId: destination.id },
  ];
  workspace.action("external-url", { url: "https://docs.example.com/path" });
  assert.equal(workspace.state.activeSpaceId, destination.id);
  const count = workspace.state.tabs.length;
  assert.throws(
    () => workspace.action("external-url", { url: "file:///etc/passwd" }),
    /Only web links/,
  );
  assert.equal(workspace.state.tabs.length, count);
});

test("native media state is transient while automatic PiP preference survives restart", () => {
  const w = new ChromiumWorkspace();
  w.action("new-tab", { url: "https://video.example" });
  const id = w.state.activeTabId;
  w.action("features-settings", { automaticPictureInPicture: true });
  w.pageChanged({
    id,
    audible: true,
    muted: true,
    pictureInPicture: true,
    capturing: true,
  });
  const tab = w.snapshot().tabs.find((t) => t.id === id);
  assert.equal(tab.pictureInPicture, true);
  assert.equal(tab.capturing, true);
  assert.equal(tab.muted, true);
  const restored = new ChromiumWorkspace(JSON.parse(JSON.stringify(w.state)));
  assert.equal(restored.state.settings.automaticPictureInPicture, true);
  assert.equal(
    restored.snapshot().tabs.find((t) => t.id === id).pictureInPicture,
    undefined,
  );
  w.pageChanged({ id });
  assert.equal(w.snapshot().tabs.find((t) => t.id === id).capturing, false);
});
test("internal pages reuse an open tab in the current Space", () => {
  const workspace = new ChromiumWorkspace();
  workspace.action("new-tab", { url: "wing://history" });
  const history = workspace.state.activeTabId;
  assert.equal(
    workspace.state.tabs.find((t) => t.id === history).url,
    "chrome://history/",
  );
  workspace.action("new-tab", { url: "https://a.example" });
  const count = workspace.state.tabs.length;
  workspace.action("new-tab", { url: "wing://history" });
  assert.equal(workspace.state.activeTabId, history);
  assert.equal(workspace.state.tabs.length, count);
  workspace.action("new-tab", { url: "https://a.example" });
  assert.equal(workspace.state.tabs.length, count + 1);
});
test("a crashed page leaves the layout so Wing can show its own crash page", () => {
  const workspace = new ChromiumWorkspace();
  workspace.action("new-tab", { url: "https://a.example" });
  const id = workspace.state.activeTabId;
  workspace.pageChanged({ id, url: "https://a.example/", crashed: "crashed" });
  assert.equal(workspace.layout(1200, 800).length, 0);
  assert.equal(
    workspace.snapshot().tabs.find((t) => t.id === id).crashed,
    "crashed",
  );
  workspace.pageChanged({ id, url: "https://a.example/", crashed: "" });
  assert.equal(workspace.layout(1200, 800).length, 1);
});

test("separating a split view frees every page", () => {
  const workspace = new ChromiumWorkspace();
  workspace.action("new-tab", { url: "https://a.example" });
  const a = workspace.state.activeTabId;
  workspace.action("new-tab", { url: "https://b.example" });
  workspace.action("split", { id: a });
  assert.equal(workspace.state.splits.length, 1);
  workspace.action("split-dissolve", { id: a });
  assert.equal(workspace.state.splits.length, 0);
  assert.ok(workspace.state.tabs.some((tab) => tab.id === a && !tab.closed));
});

test("large native requests stay under the engine's message limit", () => {
  const { nativeMessages } = require("../src/native-messages.cjs");
  const data = {
    title: 'caf\u00e9 \ud83d\ude00 "quoted" \\'.repeat(20000),
  };
  const messages = nativeMessages(7, "sync", data);
  assert.ok(messages.length > 1);
  let text = "";
  messages.forEach((message, index) => {
    assert.equal(message.kind, "wing-request-part");
    assert.ok(Buffer.byteLength(message.json) < 64 * 1024);
    const part = JSON.parse(message.json);
    assert.equal(part.id, 7);
    assert.equal(part.index, index);
    assert.equal(part.count, messages.length);
    text += part.text;
  });
  assert.deepEqual(JSON.parse(text), { id: 7, action: "sync", data });
  const [small] = nativeMessages(8, "state", { title: "caf\u00e9" });
  assert.equal(small.kind, "wing-request");
  assert.deepEqual(JSON.parse(small.json).data, { title: "caf\u00e9" });
});

test("a profile with no Spaces left is removed without losing its data", () => {
  const M = require("../src/model.cjs");
  const saved = M.initialState();
  saved.profiles.push({ id: "imported", name: "Old (Chrome)" });
  saved.history.push({
    id: "h1",
    url: "https://a.test/",
    title: "A",
    at: 1,
    profileId: "imported",
  });
  const archived = M.newTab("gone-space", "https://a.test/");
  saved.archive.push(archived);
  const cleaned = new ChromiumWorkspace(saved);
  const { state } = cleaned;
  assert.deepEqual(cleaned.removedProfiles, ["imported"]);
  const ids = state.profiles.map((p) => p.id);
  assert.ok(!ids.includes("imported"));
  assert.ok(ids.includes("work"));
  assert.equal(state.history[0].profileId, state.spaces[0].profileId);
  assert.equal(state.archive[0].spaceId, state.activeSpaceId);

  const workspace = new ChromiumWorkspace();
  workspace.state.profiles.push({ id: "imported", name: "Old (Chrome)" });
  workspace.state.spaces.push({
    ...workspace.state.spaces[0],
    id: "imported-space",
    profileId: "imported",
  });
  workspace.action("delete-space", { id: "imported-space" });
  assert.ok(!workspace.state.profiles.some((p) => p.id === "imported"));
  assert.deepEqual(workspace.removedProfiles, ["imported"]);
});

test("a damaged workspace falls back to a backup, then a fresh start", async () => {
  const { openWorkspace, startupNotice } = require("../src/chromium-workspace.cjs");
  const M = require("../src/model.cjs");
  const good = M.initialState();
  const tried = [];
  const backups = [{ bad: true }, good];
  const opened = await openWorkspace({ workspace: { bad: true } }, async (after) => {
    tried.push(after);
    return { workspace: backups[after + 1] ?? null, index: after + 1 };
  });
  assert.deepEqual(tried, [-1, 0]);
  assert.equal(opened.recovery, "backup");
  assert.equal(opened.workspace.state.activeSpaceId, good.activeSpaceId);
  const fresh = await openWorkspace({ workspace: { bad: true } }, async () => ({
    workspace: null,
    index: 0,
  }));
  assert.equal(fresh.recovery, "fresh");
  assert.ok(fresh.workspace.state.spaces.length);
  const fine = await openWorkspace({ workspace: good }, async () => {
    throw Error("should not recover");
  });
  assert.equal(fine.recovery, null);
  assert.equal(startupNotice(null, false), null);
  assert.match(startupNotice(null, true), /close properly/);
  assert.match(startupNotice("backup", true), /backup/);
});

test("the command-line tool can open a link in a named Space", () => {
  const workspace = new ChromiumWorkspace();
  const target = workspace.state.spaces.find((s) => s.name === "Work");
  workspace.action("external-url", { url: "https://a.test/", space: "work" });
  const tab = workspace.state.tabs.find((t) => t.url === "https://a.test/");
  assert.equal(tab.spaceId, target.id);
});

test("Undo Close brings back a closed pinned tab at its last page", () => {
  const workspace = new ChromiumWorkspace();
  workspace.action("new-tab", { url: "https://home.test/" });
  const { activeTabId: id } = workspace.state;
  workspace.action("pin", { id });
  const tab = workspace.state.tabs.find((t) => t.id === id);
  tab.url = "https://home.test/deep";
  workspace.closed(id);
  assert.equal(tab.closed, true);
  workspace.action("restore", {});
  assert.equal(tab.url, "https://home.test/deep");
  assert.ok(!tab.closed);
  assert.equal(workspace.state.activeTabId, id);
});

test("developer helpers decode, format and swap origins", () => {
  const D = require("../src/dev-plan.cjs");
  const part = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const token = `Bearer ${part({ alg: "HS256" })}.${part({ sub: "é", exp: 5 })}.sig`;
  assert.deepEqual(D.decodeJWT(token).payload, { sub: "é", exp: 5 });
  assert.throws(() => D.decodeJWT("nope"), /JWT/);
  assert.equal(D.formatJSON('{"a":1}'), '{\n  "a": 1\n}');
  assert.throws(() => D.formatJSON("{"), /JSON/);
  assert.equal(D.curlCommand("https://a.test/it's"), "curl -L 'https://a.test/it'\\''s'");
  assert.equal(D.localURL("https://a.test/x?y=1#z", 3000), "http://localhost:3000/x?y=1#z");
  const plan = D.devPlan({}, "block", "*ads*, *track* ");
  assert.deepEqual(
    plan.calls[1][1].urlPatterns.map((p) => p.urlPattern),
    ["*://*ads*:*/*", "*://*:*/*ads*", "*://*track*:*/*", "*://*:*/*track*"],
  );
  assert.deepEqual(D.devPlan({}, "block", "").calls[1][1].urlPatterns, []);
});

test("duplicate cleanup keeps the active copy and leaves pinned tabs and splits", () => {
  const M = require("../src/model.cjs");
  const workspace = new ChromiumWorkspace();
  const open = (url) => {
    workspace.action("new-tab", { url });
    return workspace.state.activeTabId;
  };
  const older = open("https://a.example/page#one");
  const other = open("https://b.example/");
  const pinned = open("https://a.example/page");
  workspace.action("pin", { id: pinned });
  const active = open("https://a.example/page");
  assert.deepEqual(
    M.duplicateTabIds(workspace.state, workspace.state.activeSpaceId),
    [older],
  );
  assert.ok(other && active);
});
test("grouping by site files only sites with several tabs and can be undone", () => {
  const workspace = new ChromiumWorkspace();
  for (const url of ["https://www.a.example/1", "https://a.example/2", "https://b.example/"])
    workspace.action("new-tab", { url });
  workspace.action("group-by-site");
  const folder = workspace.state.folders.find((f) => f.name === "a.example");
  assert.equal(workspace.state.tabs.filter((t) => t.folderId === folder.id).length, 2);
  assert.equal(workspace.state.folders.some((f) => f.name === "b.example"), false);
  workspace.action("organization-undo");
  assert.equal(workspace.state.tabs.filter((t) => t.folderId === folder.id).length, 0);
});
test("throwaway Spaces disappear with their tabs, archive and history", () => {
  const M = require("../src/model.cjs");
  const workspace = new ChromiumWorkspace();
  workspace.action("save-space", { name: "Throwaway", profileId: "new", throwaway: true });
  const space = workspace.state.spaces.find((s) => s.throwaway);
  workspace.action("new-tab", { url: "https://secret.example" });
  workspace.state.history.push({ url: "https://secret.example", profileId: space.profileId });
  workspace.state.archive.push({ id: "x", url: "https://secret.example", spaceId: space.id });
  const removed = M.removeThrowawaySpaces(workspace.state);
  assert.deepEqual(removed, [space.profileId]);
  assert.equal(JSON.stringify(workspace.state).includes("secret.example"), false);
  assert.equal(workspace.state.spaces.some((s) => s.id === space.id), false);
  assert.ok(workspace.state.tabs.some((t) => t.id === workspace.state.activeTabId));
});
test("a link can name the Space it opens in", () => {
  const workspace = new ChromiumWorkspace();
  const first = workspace.state.activeSpaceId;
  workspace.action("save-space", { name: "Other", profileId: "new" });
  workspace.action("external-url", { url: "https://x.example/", spaceId: first });
  assert.equal(workspace.state.activeSpaceId, first);
});

test("a closed Favorite reopens on its current page and a pinned tab on its saved page", () => {
  const workspace = new ChromiumWorkspace();
  const open = (kind) => {
    workspace.action("new-tab", { url: "https://a.example/home" });
    const id = workspace.state.activeTabId;
    workspace.action(kind, { id });
    workspace.pageChanged({ id, url: "https://a.example/sub" });
    workspace.closed(id);
    workspace.action("select-tab", { id });
    return workspace.state.tabs.find((t) => t.id === id);
  };
  assert.equal(open("favorite").url, "https://a.example/sub");
  assert.equal(open("pin").url, "https://a.example/home");
});

test("a Space returns to the Favorite it was showing", () => {
  const workspace = new ChromiumWorkspace();
  const first = workspace.state.activeSpaceId;
  workspace.action("new-tab", { url: "https://today.example/" });
  workspace.action("new-tab", { url: "https://favorite.example/" });
  const favorite = workspace.state.activeTabId;
  workspace.action("favorite", { id: favorite });
  workspace.action("save-space", { name: "Other", profileId: "new" });
  workspace.action("new-tab", { url: "https://other.example/" });
  workspace.action("space", { id: first });
  assert.equal(workspace.state.activeTabId, favorite);
});

test("the profile shortcut returns to that profile's last Space", () => {
  const workspace = new ChromiumWorkspace();
  const first = workspace.state.activeSpaceId;
  const profile = workspace.state.spaces[0].profileId;
  workspace.action("save-space", { name: "Second", profileId: profile });
  const second = workspace.state.activeSpaceId;
  assert.notEqual(second, first);
  const other = workspace.state.profiles.findIndex((p) => p.id !== profile);
  workspace.action("space-index", { index: other });
  assert.notEqual(workspace.state.activeSpaceId, second);
  workspace.action("space-index", {
    index: workspace.state.profiles.findIndex((p) => p.id === profile),
  });
  assert.equal(workspace.state.activeSpaceId, second);
});

test("with no remembered tab, a Space opens its most recent tab even if that is a Favorite", () => {
  const workspace = new ChromiumWorkspace();
  const s = workspace.state;
  const first = s.activeSpaceId;
  workspace.action("new-tab", { url: "https://today.example/" });
  const today = s.activeTabId;
  workspace.action("new-tab", { url: "https://favorite.example/" });
  const favorite = s.activeTabId;
  workspace.action("favorite", { id: favorite });
  s.tabs.find((t) => t.id === today).lastActive = 1;
  s.tabs.find((t) => t.id === favorite).lastActive = Date.now() + 1000;
  workspace.action("save-space", { name: "Other", profileId: "new" });
  delete s.spaces.find((space) => space.id === first).lastTabId;
  workspace.action("space", { id: first });
  assert.equal(s.activeTabId, favorite);
});

test("closing the last open tab shows the home page instead of opening a Favorite", () => {
  const workspace = new ChromiumWorkspace();
  const s = workspace.state;
  s.tabs = s.tabs.filter((t) => t.kind === "favorite");
  workspace.action("new-tab", { url: "https://today.example/" });
  const today = s.activeTabId;
  workspace.closed(today);
  assert.equal(s.activeTabId, null);
  const favorite = s.tabs.find((t) => t.kind === "favorite");
  workspace.action("select-tab", { id: favorite.id });
  workspace.closed(favorite.id);
  assert.equal(s.activeTabId, null);
});

test("a tab keeps its site icon through closing, reopening and an empty report while loading", () => {
  const workspace = new ChromiumWorkspace();
  const s = workspace.state;
  workspace.action("new-tab", { url: "https://today.example/" });
  const id = s.activeTabId;
  const icon = "https://cdn.example/icon.svg";
  assert.equal(workspace.pageChanged({ id, url: "https://today.example/", favicon: icon }), true);
  workspace.closed(id, true);
  assert.equal(s.archive[0].favicon, icon);
  workspace.action("restore", {});
  const page = { id, url: "https://today.example/", favicon: "", loading: true };
  assert.equal(workspace.pageChanged(page), false);
  const restored = workspace.snapshot().tabs.find((t) => t.id === id);
  assert.equal(restored.favicon, icon);
  assert.equal(restored.faviconOrigin, "https://today.example");
  workspace.pageChanged({ id, url: "https://today.example/", favicon: "javascript:alert(1)" });
  assert.equal(s.tabs.find((t) => t.id === id).favicon, icon);
});

test("a dragged tab moves between Favorites, pinned tabs, folders and Today", () => {
  const workspace = new ChromiumWorkspace();
  const s = workspace.state;
  const open = (url) => {
    workspace.action("new-tab", { url });
    return s.activeTabId;
  };
  const a = open("https://a.example/"),
    b = open("https://b.example/");
  const tab = (id) => s.tabs.find((t) => t.id === id);
  workspace.action("place-tab", { id: b, kind: "favorite" });
  assert.equal(tab(b).kind, "favorite");
  workspace.action("place-tab", { id: a, kind: "favorite", beforeId: b });
  const favorites = s.tabs.filter((t) => t.kind === "favorite").map((t) => t.id);
  assert.ok(favorites.indexOf(a) === favorites.indexOf(b) - 1);
  workspace.action("save-folder", { name: "Work" });
  const folder = s.folders.at(-1).id;
  workspace.action("place-tab", { id: a, kind: "pinned", folderId: folder });
  assert.equal(tab(a).kind, "pinned");
  assert.equal(tab(a).folderId, folder);
  assert.equal(tab(a).spaceId, s.activeSpaceId);
  workspace.action("place-tab", { id: a, kind: "today", folderId: folder });
  assert.equal(tab(a).kind, "today");
  assert.equal(tab(a).folderId, null);
});

test("appearance modes persist and Follow system takes the Mac's current mode", () => {
  const workspace = new ChromiumWorkspace();
  const s = workspace.state;
  workspace.action("features-settings", { appearance: "dark", systemDark: false });
  assert.equal(s.settings.dark, true);
  workspace.action("features-settings", { appearance: "light", systemDark: true });
  assert.equal(s.settings.dark, false);
  workspace.action("features-settings", { appearance: "system", systemDark: true });
  assert.equal(s.settings.appearance, "system");
  assert.equal(s.settings.dark, true);
  const restored = new ChromiumWorkspace(JSON.parse(JSON.stringify(s)));
  assert.equal(restored.state.settings.appearance, "system");
});
