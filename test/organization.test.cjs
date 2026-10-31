const test = require("node:test"),
  assert = require("node:assert/strict"),
  M = require("../src/model.cjs"),
  O = require("../src/organization.cjs");
test("nested folders reject cycles and cross-space parents", () => {
  const s = M.initialState();
  O.saveFolder(s, { name: "A" });
  const a = s.folders[0];
  O.saveFolder(s, { name: "B", parentId: a.id });
  const b = s.folders[1];
  assert.throws(() => O.saveFolder(s, { id: a.id, name: "A", parentId: b.id }));
  s.activeSpaceId = s.spaces[1].id;
  assert.throws(() => O.saveFolder(s, { name: "C", parentId: a.id }));
});
test("folder deletion keeps child tabs and undo does not roll back navigation", () => {
  const s = M.initialState(),
    j = new O.OrganizationJournal();
  O.saveFolder(s, { name: "Research" });
  s.tabs[0].folderId = s.folders[0].id;
  j.record(s);
  O.removeFolder(s, s.folders[0].id);
  s.tabs[0].url = "https://example.com/new";
  assert.equal(j.undo(s), true);
  assert.equal(s.folders.length, 1);
  assert.equal(s.tabs[0].url, "https://example.com/new");
  assert.equal(j.redo(s), true);
  assert.equal(s.folders.length, 0);
});

test("undo restores saved destinations and split titles while preserving page navigation", () => {
  const s = M.initialState(),
    j = new O.OrganizationJournal();
  s.tabs = ["a", "b"].map((id) =>
    M.newTab(s.activeSpaceId, `https://${id}.example`, { id, kind: "pinned" }),
  );
  const group = M.splits.join(s, "a", "b");
  group.title = "Original";
  j.record(s);
  group.title = "Renamed";
  s.tabs[0].url = "https://a.example/new";
  s.tabs[0].homeURL = s.tabs[0].url;
  s.tabs[0].title = "New page title";
  j.undo(s);
  assert.equal(group.title, "Original");
  assert.equal(s.tabs[0].homeURL, "https://a.example/");
  assert.equal(s.tabs[0].url, "https://a.example/new");
  assert.equal(s.tabs[0].title, "New page title");
});
