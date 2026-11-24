const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const vm = require("node:vm");
const M = require("../src/model.cjs");
const navigation = require("../src/navigation.cjs");

test("native workspace and Space exports send complete file-save requests", async () => {
  const source = fs.readFileSync(require.resolve("../src/chromium-preload.cjs"), "utf8");
  const start = source.indexOf('    if (action === "export")');
  const end = source.indexOf('    if (action === "close-peek")', start);
  const state = M.initialState();
  const space = state.spaces.find((space) => space.id === state.activeSpaceId);
  space.name = "Research & notes";
  const tab = M.newTab(space.id, "https://example.test/");
  tab.customTitle = "A < B";
  state.tabs.push(tab);
  const invoke = vm.runInNewContext("(async (action) => {" + source.slice(start, end) + "})", {
    workspace: { state },
    navigation,
    native(action, data) {
      assert.equal(action, "file-save");
      assert.equal(typeof data?.name, "string");
      assert.equal(typeof data?.text, "string");
      return data;
    },
  });
  const backup = await invoke("export");
  assert.equal(backup.name, "Wing-workspace.json");
  assert.deepEqual(JSON.parse(backup.text), JSON.parse(JSON.stringify(state)));
  const links = await invoke("export-space");
  assert.equal(links.name, "Wing-links.html");
  assert.match(links.text, /Research &amp; notes/);
  assert.match(links.text, /<a href="https:\/\/example\.test\/">A &lt; B<\/a>/);
});
