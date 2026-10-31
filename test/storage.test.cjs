const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { WorkspaceStore } = require("../src/storage.cjs");
test("burst writes commit the newest revision atomically", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wing-store-"));
  try {
    const file = path.join(dir, "workspace.json"),
      store = new WorkspaceStore(file);
    const writes = [];
    for (let i = 0; i < 100; i++) writes.push(store.write({ revision: i }));
    await Promise.all(writes);
    assert.equal(JSON.parse(fs.readFileSync(file)).revision, 99);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test("shutdown final state wins over a pending asynchronous write", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wing-store-"));
  try {
    const file = path.join(dir, "workspace.json"),
      store = new WorkspaceStore(file);
    const pending = store.write({ revision: 1 });
    store.flushSync({ revision: 2 });
    await pending;
    assert.equal(JSON.parse(fs.readFileSync(file)).revision, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
