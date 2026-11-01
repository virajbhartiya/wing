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
