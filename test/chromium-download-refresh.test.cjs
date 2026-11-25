const assert = require("node:assert/strict");
const fs = require("node:fs");
const { createRequire } = require("node:module");
const test = require("node:test");
const vm = require("node:vm");

async function drain() {
  await new Promise(setImmediate);
  await new Promise(setImmediate);
}

async function startShell({
  holdMetadata = false,
  holdPersistence = false,
  rejectSelection = false,
} = {}) {
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
      if (request.action === "service" ||
          (holdMetadata && request.action === "page-metadata") ||
          (holdPersistence && request.action === "persist-workspace"))
        return;
      const result = request.action === "bootstrap"
        ? { workspace: null, version: "test" }
        : { ok: !(rejectSelection && request.action === "select-workspace-tab") };
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
    hasTimer: (delay) => [...timers].some((timer) => timer.delay === delay),
    services: () => requests.filter((request) => request.action === "service"),
    state: () => snapshots.at(-1),
    snapshotCount: () => snapshots.length,
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

test("rapid tab selection shows the new pages before coalescing the workspace write", async () => {
  const shell = await startShell();
  await shell.invoke("new-tab", { url: "https://one.test/" });
  const firstId = shell.state().activeTabId;
  await shell.invoke("new-tab", { url: "https://two.test/" });
  const secondId = shell.state().activeTabId;
  const syncSince = (index) =>
    shell.requests.slice(index).filter((request) => request.action === "sync");
  const selectionsSince = (index) =>
    shell.requests.slice(index).filter((request) => request.action === "select-workspace-tab");
  const index = shell.requests.length;

  await shell.invoke("select-tab", { id: firstId });
  assert.equal(shell.state().activeTabId, firstId);
  await shell.invoke("tab-index", { index: -1 });
  assert.equal(shell.state().activeTabId, secondId);
  assert.equal(syncSince(index).length, 0);
  assert.deepEqual(
    selectionsSince(index).map(({ data }) => [data.id, data.panes.map((pane) => pane.id)]),
    [[firstId, [firstId]], [secondId, [secondId]]],
  );
  for (const { data } of selectionsSince(index))
    assert.deepEqual(Object.keys(data).sort(),
      ["anchor", "id", "lastActive", "panes", "spaceId", "url"]);

  await shell.fireTimer(3000);
  assert.equal(syncSince(index).length, 0);
  const writes = shell.requests.slice(index).filter(({ action }) => action === "persist-workspace");
  assert.equal(writes.length, 1);

  await shell.invoke("select-tab", { id: firstId });
  assert.equal(shell.hasTimer(3000), true);
  await shell.invoke("pin", { id: firstId });
  assert.equal(shell.hasTimer(3000), false);
  const { data } = syncSince(index).at(-1);
  assert.equal(data.persist, true);
  assert.equal(data.workspace.activeTabId, firstId);
  assert.equal(data.workspace.tabs.find((tab) => tab.id === firstId).kind, "pinned");
});

test("switching stays responsive during a save and schedules the newer selection", async () => {
  const shell = await startShell({ holdPersistence: true });
  await shell.invoke("new-tab", { url: "https://one.test/" });
  const firstId = shell.state().activeTabId;
  await shell.invoke("new-tab", { url: "https://two.test/" });
  await shell.fireTimer(3000);
  const pendingSave = shell.requests.find(({ action }) => action === "persist-workspace");
  assert.ok(pendingSave);
  const selection = shell.invoke("select-tab", { id: firstId });
  assert.equal(await Promise.race([selection.then(() => true), drain().then(() => false)]), true);
  assert.equal(shell.state().activeTabId, firstId);
  assert.equal(shell.hasTimer(3000), true);
  shell.respond(pendingSave, { result: true });
  await drain();
  assert.equal(shell.hasTimer(3000), true);
});

test("a tab selection cache mismatch falls back to a full workspace sync", async () => {
  const shell = await startShell({ rejectSelection: true });
  await shell.invoke("new-tab", { url: "https://one.test/" });
  const id = shell.state().activeTabId;
  const index = shell.requests.length;
  await shell.invoke("select-tab", { id });
  const updates = shell.requests.slice(index);
  assert.deepEqual(updates.map(({ action }) => action), ["select-workspace-tab", "sync"]);
  assert.equal(updates[1].data.workspace.activeTabId, id);
  assert.equal(updates[1].data.deferPersist, true);
});

test("opening a new page and editing the address do not wait for a workspace save", async () => {
  const shell = await startShell();
  await shell.invoke("new-tab", { url: "https://one.test/" });
  const id = shell.state().activeTabId;
  await shell.invoke("navigate", { id, url: "https://two.test/" });

  const requests = shell.requests.filter(({ action }) => action === "sync");
  assert.deepEqual(
    requests.map(({ data }) => [data.persist, data.deferPersist]),
    [[false, true], [false, true]],
  );
  assert.equal(shell.state().tabs.find((tab) => tab.id === id).url, "https://two.test/");
  assert.equal(shell.hasTimer(3000), true);
});

test("page metadata notifications update the shell without synchronizing native layout", async () => {
  const shell = await startShell();
  const url = "https://example.test/";
  await shell.invoke("new-tab", { url });
  const id = shell.state().activeTabId;
  const start = shell.requests.length;
  const snapshotCount = shell.snapshotCount();
  shell.receive("page", { id, url, title: "A new title", favicon: url + "icon.png" });
  shell.receive("page", { id, url, title: "Most recent title", favicon: url + "icon.png" });
  await drain();

  assert.equal(shell.state().tabs.find((tab) => tab.id === id).title, "Most recent title");
  assert.equal(shell.snapshotCount(), snapshotCount + 1);
  assert.equal(shell.requests.slice(start).filter((request) => request.action === "sync").length, 0);
  const metadata = shell.requests.slice(start).filter(({ action }) => action === "page-metadata");
  assert.deepEqual(metadata.at(-1).data, {
    id, url, title: "Most recent title", favicon: url + "icon.png", faviconOrigin: new URL(url).origin,
  });
  await shell.fireTimer(3000);
  const saved = shell.requests.slice(start).filter(({ action }) => action === "persist-workspace");
  assert.equal(saved.length, 1);
  assert.deepEqual(saved[0].data, {});
});

test("page progress and Peek title updates stay local while a real navigation saves immediately", async () => {
  const shell = await startShell({ holdMetadata: true });
  const url = "https://example.test/";
  await shell.invoke("new-tab", { url });
  const id = shell.state().activeTabId;
  await shell.invoke("peek", { url });
  const peekId = shell.state().peek.id;
  const start = shell.requests.length;
  shell.receive("page", { id: peekId, url, title: "Peek title" });
  shell.receive("page", { id, url, title: "Fresh title" });
  shell.receive("page", { id, url, title: "Fresh title", progress: 0.5, loading: true });
  await drain();
  assert.equal(shell.state().peek.title, "Peek title");
  assert.equal(shell.state().tabs.find((tab) => tab.id === id).progress, 0.5);
  assert.deepEqual(shell.requests.slice(start).map(({ action }) => action), ["page-metadata"]);
  assert.equal(shell.hasTimer(3000), true);

  const next = url + "next";
  shell.receive("page", { id, url: next, title: "New page" });
  await drain();
  const save = shell.requests.at(-1);
  assert.equal(save.action, "sync");
  assert.equal(save.data.persist, true);
  assert.equal(save.data.workspace.tabs.find((tab) => tab.id === id).url, next);
  assert.equal(shell.hasTimer(3000), false);
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
