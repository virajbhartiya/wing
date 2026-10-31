"use strict";
const assert = require("node:assert/strict");

module.exports = async function recentTabsEngineTest(api, base) {
  const shell = api.testWindow.webContents;
  const waitFor = async (condition, label) => {
    const deadline = Date.now() + 4000;
    while (!(await condition())) {
      if (Date.now() > deadline) throw Error(`Recent tabs: ${label}`);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  };
  const tabs = ["recent-a", "recent-b", "recent-c"].map((name) =>
    api.openTab(`${base}/${name}`),
  );
  const [a, b, c] = tabs;
  await waitFor(
    () => tabs.every((tab) => !api.views.get(tab.id).webContents.isLoading()),
    "fixture pages load",
  );
  await api.action("select-tab", { id: a.id });
  for (const tab of api.getState().tabs) tab.lastActive = 0;
  a.lastActive = 300;
  b.lastActive = 100;
  c.lastActive = 200;
  api.testWindow.show();
  shell.focus();
  const key = (type, keyCode, modifiers = []) =>
    shell.sendInputEvent({ type, keyCode, modifiers });
  const selected = () =>
    shell.executeJavaScript(
      'document.querySelector(".recent-tabs-row[aria-selected=true]")?.dataset.recentTab',
    );
  key("keyDown", "Tab", ["control"]);
  await waitFor(
    async () => (await selected()) === c.id,
    "first preview is most recently used tab",
  );
  assert.equal(
    api.getState().activeTabId,
    a.id,
    "preview does not activate page",
  );
  key("keyDown", "Tab", ["control"]);
  await waitFor(
    async () => (await selected()) === b.id,
    "second preview follows frozen MRU order",
  );
  // sendInputEvent supports accelerator keys, not standalone modifier releases
  // on macOS. Exercise the renderer's real modifier-release listener instead.
  await shell.executeJavaScript(
    'document.dispatchEvent(new KeyboardEvent("keyup", {key:"Control", bubbles:true}))',
  );
  await waitFor(
    () => api.getState().activeTabId === b.id,
    "release commits selected page",
  );
  await waitFor(
    async () =>
      await shell.executeJavaScript(
        'document.querySelector("#overlay").hidden',
      ),
    "overlay closes after commit",
  );

  // Exercise the same interceptor while the native website, not the shell, owns focus.
  const page = api.views.get(b.id).webContents;
  page.focus();
  page.sendInputEvent({
    type: "keyDown",
    keyCode: "Tab",
    modifiers: ["control"],
  });
  await waitFor(
    async () => !!(await selected()),
    "page-focused shortcut opens switcher",
  );
  key("keyDown", "Escape", ["control"]);
  await waitFor(
    async () =>
      await shell.executeJavaScript(
        'document.querySelector("#overlay").hidden',
      ),
    "Escape dismisses switcher",
  );
  assert.equal(
    api.getState().activeTabId,
    b.id,
    "Escape preserves original page",
  );
  for (const tab of tabs) await api.action("close-tab", { id: tab.id });
  api.testWindow.hide();
};
