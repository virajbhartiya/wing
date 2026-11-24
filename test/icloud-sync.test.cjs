const test = require("node:test");
const assert = require("node:assert/strict");
const M = require("../src/model.cjs");
const S = require("../src/icloud-sync.cjs");

const clone = (value) => JSON.parse(JSON.stringify(value));
const pinned = (state) =>
  state.tabs.filter((t) => t.kind === "pinned").map((t) => t.homeURL);

test("a fresh Mac adopts matching Spaces instead of doubling them", () => {
  const a = M.initialState(),
    b = M.initialState();
  assert.notEqual(a.spaces[0].id, b.spaces[0].id);
  const changed = S.merge(b, S.layoutOf(a), null);
  assert.equal(changed, true);
  assert.deepEqual(
    b.spaces.map((s) => s.id),
    a.spaces.map((s) => s.id),
  );
  assert.deepEqual(pinned(b), pinned(a));
  assert.doesNotThrow(() => M.validateState(b));
});

test("pins added on either Mac survive a merge", () => {
  const a = M.initialState();
  const b = clone(a);
  const base = S.layoutOf(a);
  const space = a.spaces[0].id;
  a.tabs.push(M.newTab(space, "https://news.ycombinator.com", { kind: "pinned" }));
  b.tabs.push(M.newTab(space, "https://lobste.rs", { kind: "pinned" }));
  S.merge(b, S.layoutOf(a), base);
  assert.ok(pinned(b).includes("https://news.ycombinator.com/"));
  assert.ok(pinned(b).includes("https://lobste.rs/"));
  assert.doesNotThrow(() => M.validateState(b));
});

test("a pin removed on the other Mac is removed here", () => {
  const a = M.initialState();
  const b = clone(a);
  const base = S.layoutOf(a);
  const gone = a.tabs.find((t) => t.kind === "pinned" && t.id !== a.activeTabId);
  a.tabs = a.tabs.filter((t) => t !== gone);
  S.merge(b, S.layoutOf(a), base);
  assert.ok(!pinned(b).includes(gone.homeURL));
});

test("a Space renamed there is renamed here; local renames stay otherwise", () => {
  const a = M.initialState();
  const b = clone(a);
  const base = S.layoutOf(a);
  a.spaces[0].name = "Home";
  b.spaces[1].name = "Office";
  S.merge(b, S.layoutOf(a), base);
  assert.equal(b.spaces[0].name, "Home");
  assert.equal(b.spaces[1].name, "Office");
});

test("a merge with nothing new changes nothing", () => {
  const a = M.initialState();
  const layout = S.layoutOf(a);
  assert.equal(S.merge(a, layout, layout), false);
});

test("throwaway Space folders and pinned URLs stay out of the iCloud layout", () => {
  const state = M.initialState();
  const throwaway = { ...state.spaces[0], id: "disposable", throwaway: true };
  const retained = state.spaces[0].id;
  state.spaces.push(throwaway);
  state.folders.push(
    { id: "private-folder", spaceId: throwaway.id, name: "Private" },
    { id: "retained-folder", spaceId: retained, name: "Retained" },
  );
  state.tabs.push(
    M.newTab(throwaway.id, "https://private.example/", { kind: "pinned" }),
    M.newTab(throwaway.id, "https://favorite.example/", { kind: "favorite" }),
    M.newTab(retained, "https://retained.example/", { kind: "pinned" }),
  );

  const layout = S.layoutOf(state);
  assert.ok(!layout.spaces.some((space) => space.id === throwaway.id));
  assert.deepEqual(layout.folders.map((folder) => folder.id), ["retained-folder"]);
  assert.ok(!layout.items.some((item) => item.spaceId === throwaway.id));
  assert.ok(layout.items.some((item) => item.url === "https://retained.example/"));
});

test("older sync layouts with orphan records keep local throwaway content intact", () => {
  const state = M.initialState();
  const throwaway = { ...state.spaces[0], id: "disposable", throwaway: true };
  const retained = state.spaces[0].id;
  const base = S.layoutOf(state);
  const localFolder = { id: "local-private", spaceId: throwaway.id, name: "Local" };
  const localTab = M.newTab(throwaway.id, "https://local.example/", {
    kind: "pinned",
    folderId: localFolder.id,
  });
  state.spaces.push(throwaway);
  state.folders.push(localFolder);
  state.tabs.push(localTab);

  const remote = clone(base);
  remote.folders.push(
    { id: localFolder.id, spaceId: throwaway.id, name: "Old copy", parentId: null },
    { id: "remote-private", spaceId: throwaway.id, name: "Remote only", parentId: null },
    { id: "shared-folder", spaceId: retained, name: "Shared", parentId: null },
  );
  remote.items.push(
    {
      key: `${throwaway.id}|pinned|https://remote.example/`,
      spaceId: throwaway.id,
      kind: "pinned",
      url: "https://remote.example/",
      title: "Remote",
      folderId: null,
    },
    {
      key: `${retained}|favorite|https://shared.example/`,
      spaceId: retained,
      kind: "favorite",
      url: "https://shared.example/",
      title: "Shared",
      folderId: null,
    },
  );
  const beforeLocal = clone({ localFolder, localTab });
  assert.equal(S.validLayout(remote), true, "older layouts remain readable");
  assert.equal(S.merge(state, remote, base), true);
  assert.deepEqual(state.folders.filter((f) => f.spaceId === throwaway.id), [
    beforeLocal.localFolder,
  ]);
  assert.deepEqual(state.tabs.filter((t) => t.spaceId === throwaway.id), [
    beforeLocal.localTab,
  ]);
  assert.ok(state.folders.some((f) => f.id === "shared-folder"));
  assert.ok(state.tabs.some((t) => t.url === "https://shared.example/"));
  assert.doesNotThrow(() => M.validateState(state));
});

test("orphan sync records do not attach to a matching local Space", () => {
  const state = M.initialState();
  const remote = S.layoutOf(state);
  const spaceId = state.spaces[0].id;
  remote.spaces = remote.spaces.filter((space) => space.id !== spaceId);
  remote.items = [{
    key: `${spaceId}|pinned|https://orphan.example/`,
    spaceId,
    kind: "pinned",
    url: "https://orphan.example/",
    title: "Old pin",
    folderId: null,
  }, ...remote.items.filter((item) => item.spaceId !== spaceId)];
  assert.equal(S.merge(state, remote, null), false);
  assert.ok(!state.tabs.some((tab) => tab.url === "https://orphan.example/"));
});

test("an invalid sync file is ignored", () => {
  const a = M.initialState();
  const before = JSON.stringify(a);
  assert.equal(S.merge(a, { spaces: "x" }, null), false);
  assert.equal(
    S.merge(a, { spaces: [], folders: [], items: [{ key: "x" }] }, null),
    false,
  );
  assert.equal(JSON.stringify(a), before);
});
