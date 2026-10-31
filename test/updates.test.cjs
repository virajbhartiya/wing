const test = require("node:test"),
  assert = require("node:assert/strict"),
  { EventEmitter } = require("node:events");
const { UpdateController, validFeed } = require("../src/updates.cjs");
test("updates fail closed for unsigned/unconfigured builds and reject unsafe feeds", () => {
  let checks = 0;
  const u = { checkForUpdates: () => checks++ };
  const c = new UpdateController({
    updater: u,
    app: { isPackaged: true },
    config: {
      signedRelease: false,
      updateFeed: "https://updates.example.test",
    },
  });
  c.check();
  c.start();
  assert.equal(checks, 0);
  assert.throws(() => c.install());
  assert.equal(validFeed("http://example.test"), false);
  assert.equal(validFeed("https://user:pass@example.test"), false);
});
test("signed update lifecycle prevents duplicate downloads and requires ready before restart", () => {
  const u = new EventEmitter();
  let checks = 0,
    installed = 0;
  u.setFeedURL = () => {};
  u.checkForUpdates = () => checks++;
  u.quitAndInstall = () => installed++;
  const c = new UpdateController({
    updater: u,
    app: { isPackaged: true },
    config: {
      signedRelease: true,
      updateFeed: "https://updates.example.test/mac",
    },
  });
  c.check();
  c.check();
  assert.equal(checks, 1);
  assert.throws(() => c.install());
  u.emit("update-downloaded");
  c.install();
  assert.equal(installed, 1);
  u.emit("error", Error("private url"));
  assert.equal(c.status.state, "error");
  assert.equal(c.status.message.includes("private"), false);
});
