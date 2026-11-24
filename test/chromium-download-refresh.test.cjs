const assert = require("node:assert/strict");
const fs = require("node:fs");
const { createRequire } = require("node:module");
const test = require("node:test");
const vm = require("node:vm");

async function drain() {
  await new Promise(setImmediate);
  await new Promise(setImmediate);
}

async function startShell() {
  const preload = require.resolve("../src/chromium-preload.cjs");
  const timers = new Set();
  const requests = [];
  const snapshots = [];
  let onNative;
  const receive = (kind, data) => onNative({ detail: { kind, data } });
  const window = {
    addEventListener(type, callback) {
      if (type === "wing-native") onNative = callback;
    },
    __wingNativePost(kind, body) {
      assert.equal(kind, "wing-request");
      const request = JSON.parse(body);
      requests.push(request);
      if (request.action === "service") return;
      const result = request.action === "bootstrap"
        ? { workspace: null, version: "test" }
        : { ok: true };
      queueMicrotask(() => receive("response", { id: request.id, result }));
    },
  };
  const classList = { add() {}, toggle() {} };
  vm.runInNewContext(fs.readFileSync(preload, "utf8"), {
    window,
    document: {
      documentElement: { classList },
      body: { classList },
      querySelector: () => null,
    },
    innerWidth: 1200,
    innerHeight: 800,
    require: (id) => id === "./chromium-actions.cjs"
      ? { installBrowserActions() {} }
      : createRequire(preload)(id),
    setInterval() {},
    setTimeout(callback, delay) {
      const timer = { callback, delay };
      timers.add(timer);
      return timer;
    },
    clearTimeout(timer) {
      timers.delete(timer);
    },
    requestAnimationFrame: (callback) => setImmediate(callback),
    structuredClone,
  });
  window.wing.onState((state) => snapshots.push(state));
  await drain();
  return {
    invoke: window.wing.invoke,
    receive,
    respond(request, data) {
      receive("response", { id: request.id, ...data });
    },
    async fireTimer(delay) {
      const timer = [...timers].find((timer) => timer.delay === delay);
      assert.ok(timer, `no timer scheduled at ${delay} ms`);
      timers.delete(timer);
      timer.callback();
      await drain();
    },
    services: () => requests.filter((request) => request.action === "service"),
    state: () => snapshots.at(-1),
    requests,
  };
}

test("a stalled background download refresh leaves tab actions responsive", async () => {
  const shell = await startShell();
  await shell.fireTimer(2500);
  assert.equal(shell.services().length, 1);

  const action = shell.invoke("new-tab", { url: "https://example.test/" });
  const completed = await Promise.race([action.then(() => true), drain().then(() => false)]);
  assert.equal(completed, true, "tab creation must finish while the service is still stalled");
  assert.equal(shell.services()[0].data.method, "downloads");
});

test("download refreshes coalesce and polling recovers from a failed request", async () => {
  const shell = await startShell();
  await shell.fireTimer(2500);
  const request = shell.services()[0];
  for (let i = 0; i < 3; i++)
    shell.receive("service-event", { profileId: "default" });
  await drain();
  assert.equal(shell.services().length, 1);
  shell.respond(request, { result: [{ id: "one", status: "progressing" }] });
  await drain();
  assert.equal(shell.services().length, 2, "a single follow-up covers the events during the request");
  shell.respond(shell.services()[1], { error: "Browser services unavailable" });
  await drain();
  await shell.fireTimer(700);
  assert.equal(shell.services().length, 3, "polling resumes after rejection");
  shell.respond(shell.services()[2], { result: [{ id: "one", status: "completed" }] });
  await drain();
  assert.equal(shell.state().downloads[0].status, "completed");
  assert.equal(shell.requests.filter((request) => request.action === "sync").length, 0);
});

test("switching profiles clears old downloads and drops late refresh results", async () => {
  const shell = await startShell();
  await shell.fireTimer(2500);
  shell.respond(shell.services()[0], { result: [{ id: "personal", status: "progressing" }] });
  await drain();
  assert.equal(shell.state().downloads[0].id, "personal");
  await shell.fireTimer(700);
  const oldRequest = shell.services()[1];
  await shell.invoke("space-index", { index: 1 });
  assert.equal(shell.state().downloads.length, 0);
  const workRequest = shell.services()[2];
  assert.equal(workRequest.data.profile, "work");
  shell.respond(workRequest, { result: [{ id: "work", status: "completed" }] });
  await drain();
  shell.respond(oldRequest, { result: [{ id: "personal", status: "completed" }] });
  await drain();
  assert.equal(shell.state().downloads[0].id, "work");
});

test("reading Library leaves tabs responsive and tags live history with its profile", async () => {
  const shell = await startShell();
  const library = shell.invoke("library-data");
  await drain();
  const request = shell.services()[0];
  const action = shell.invoke("new-tab", { url: "https://example.test/" });
  const completed = await Promise.race([action.then(() => true), drain().then(() => false)]);
  shell.respond(request, {
    result: { history: [{ id: "one", url: "https://example.test/" }], downloads: [] },
  });
  const data = await library;
  assert.equal(data.history[0].profileId, "default", "History filters records by profile");
  assert.equal(completed, true, "tab creation must not wait for Library");
});
