const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const source = fs.readFileSync(
  require("node:path").join(__dirname, "../native/extension/workspace.js"),
  "utf8",
);
const modulePromise = import(
  "data:text/javascript;base64," + Buffer.from(source).toString("base64")
);
test("native URL policy rejects privileged schemes and normalizes web navigation", async () => {
  const { safeURL } = await modulePromise;
  assert.equal(safeURL("example.com"), "https://example.com/");
  assert.equal(safeURL("localhost:8080/test"), "http://localhost:8080/test");
  assert.equal(safeURL(""), "chrome://newtab/");
  for (const value of [
    "javascript:alert(1)",
    "file:///etc/passwd",
    "chrome://settings",
    "data:text/html,hello",
  ])
    assert.throws(() => safeURL(value));
  assert.equal(
    safeURL("a thought"),
    "https://www.google.com/search?q=a%20thought",
  );
});
test("native discard budget protects active, media, pins, loading and protected tabs", async () => {
  const { discardCandidates } = await modulePromise;
  const tabs = Array.from({ length: 9 }, (_, id) => ({
    id,
    url: "https://example.com",
    lastAccessed: id,
    status: "complete",
  }));
  tabs[0].active = true;
  tabs[1].audible = true;
  tabs[2].pinned = true;
  tabs[3].autoDiscardable = false;
  tabs[4].status = "loading";
  tabs[5].discarded = true;
  assert.deepEqual(
    discardCandidates(tabs, 4).map((t) => t.id),
    [6, 7, 8],
  );
  assert.deepEqual(discardCandidates(tabs, 8), []);
});
test("native initial workspaces have independent mutable state", async () => {
  const { initialWorkspace } = await modulePromise;
  const a = initialWorkspace(),
    b = initialWorkspace();
  a.spaces[0].name = "Changed";
  assert.equal(b.spaces[0].name, "Personal");
  assert.equal(a.budget, 8);
});
test("native discard never evicts either member of a split view", async () => {
  const { discardCandidates } = await modulePromise;
  const tabs = [
    { id: 1, url: "https://example.com", active: true, splitViewId: 7 },
    { id: 2, url: "https://example.org", active: false, splitViewId: 7 },
    { id: 3, url: "https://example.net", active: false, splitViewId: -1 },
  ];
  assert.deepEqual(
    discardCandidates(tabs, 1).map((t) => t.id),
    [3],
  );
});
test("native archive restores known browser pages without admitting arbitrary privileged URLs", async () => {
  const { restoreURL } = await modulePromise;
  const home = "chrome-extension://wing/home.html";
  assert.equal(restoreURL(home, home), "chrome://newtab/");
  assert.equal(
    restoreURL("chrome://extensions/", home),
    "chrome://extensions/",
  );
  assert.equal(
    restoreURL("https://example.com/", home),
    "https://example.com/",
  );
  assert.throws(() => restoreURL("chrome://crash", home));
  assert.throws(() => restoreURL("chrome-extension://other/page.html", home));
});
