"use strict";
const assert = require("node:assert/strict");

module.exports = async function featuresEngineTest(api, base) {
  const shell = api.testWindow.webContents;
  const evaluate = (script) => shell.executeJavaScript(script);
  const waitFor = async (condition, label) => {
    const deadline = Date.now() + 4000;
    while (!(await condition())) {
      if (Date.now() > deadline) throw Error(`Feature interaction: ${label}`);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  };
  const tab = api.openTab(base + "/features");
  await waitFor(
    () => !api.views.get(tab.id).webContents.isLoading(),
    "page loaded",
  );
  api.testWindow.show();
  await evaluate("window.wingFeatures.showPreferences()");
  await waitFor(
    () => evaluate("!!document.querySelector('#toolbar-hidden')"),
    "preferences visible",
  );
  await evaluate("document.querySelector('#toolbar-hidden').click()");
  await waitFor(
    () => api.getState().settings.toolbarHidden,
    "toolbar setting saved",
  );
  shell.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
  await waitFor(
    () => evaluate("document.querySelector('#overlay').hidden"),
    "Escape closes preferences",
  );
  await waitFor(
    () => api.views.get(tab.id).getBounds().y === 8,
    "native page fills hidden toolbar",
  );
  await api.action("features-settings", { toolbarHidden: false });
  assert.equal(api.views.get(tab.id).getBounds().y, 52);

  await evaluate(
    "window.wingFeatures.showPreferences(); document.querySelector('#search-settings').click()",
  );
  await evaluate(`(() => {
    const form = document.querySelector('#site-search-form');
    form.elements.name.value = 'Fixture search';
    form.elements.keyword.value = 'fixture';
    form.elements.url.value = 'https://example.com/search?q=%s';
    form.requestSubmit();
  })()`);
  await waitFor(
    () =>
      api
        .getState()
        .settings.siteSearches?.some((item) => item.keyword === "fixture"),
    "search form saved",
  );
  await evaluate("closeModal(); window.wingFeatures.editFolder()");
  await evaluate(`(() => {
    const form = document.querySelector('#folder-edit-form');
    form.elements.name.value = 'Parent fixture';
    form.requestSubmit();
  })()`);
  await waitFor(
    () =>
      api.getState().folders.some((folder) => folder.name === "Parent fixture"),
    "folder form saved",
  );
  const parent = api
    .getState()
    .folders.find((folder) => folder.name === "Parent fixture");
  await api.action("save-folder", {
    name: "Child fixture",
    parentId: parent.id,
  });
  const child = api
    .getState()
    .folders.find((folder) => folder.name === "Child fixture");
  await api.action("bulk-tabs", {
    ids: [tab.id],
    operation: "folder",
    folderId: child.id,
  });
  await evaluate("closeModal()");
  await waitFor(
    () =>
      evaluate(
        `!!document.querySelector('[data-folder="${parent.id}"] [data-folder="${child.id}"] [data-tab="${tab.id}"]')`,
      ),
    "nested sidebar preserves hierarchy",
  );
  await api.action("remove-folder", { id: parent.id });
  assert.equal(tab.folderId, null);
  await api.action("organization-undo");
  assert.equal(tab.folderId, child.id);
  assert.equal(
    api.getState().folders.find((folder) => folder.id === child.id).parentId,
    parent.id,
  );
  assert.deepEqual(api.getShellErrors(), []);
};
