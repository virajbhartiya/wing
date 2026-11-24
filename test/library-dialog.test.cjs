const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const vm = require("node:vm");

function startLibraryDialog() {
  const source = fs.readFileSync(require.resolve("../src/renderer.js"), "utf8");
  const start = source.search(/(?:async )?function openLibrary\(/);
  const end = source.indexOf("function renderLibraryList(", start);
  const requests = [];
  const status = { textContent: "" };
  const context = {
    modalGeneration: 0,
    modalType: null,
    libraryTab: null,
    libraryView: null,
    profile: "personal",
    state: { history: [] },
    window: { wing: { invoke() {
      return { then(resolve, reject) { requests.push({ resolve, reject }); } };
    } } },
    currentSpace: () => ({ profileId: context.profile }),
    showModal(type) {
      context.modalGeneration += 1;
      context.modalType = type;
    },
    dialogHead: () => "",
    renderLibraryList() {},
    $(selector) {
      if (selector === "#library-status") return status;
      return { focus() {}, querySelectorAll: () => [] };
    },
  };
  vm.createContext(context);
  vm.runInContext(source.slice(start, end), context);
  return { context, requests, status };
}

test("Library shows an inline error if its service rejects", async () => {
  const { context, requests, status } = startLibraryDialog();
  const opening = context.openLibrary("history");
  await Promise.resolve();
  assert.equal(typeof requests[0].reject, "function");
  requests[0].reject(Error("Browser services unavailable"));
  await opening;
  assert.match(status.textContent, /Browser services unavailable/);
});

test("a Library response after switching profiles cannot overwrite active history", async () => {
  const { context, requests } = startLibraryDialog();
  const opening = context.openLibrary("history");
  await Promise.resolve();
  const pendingView = context.libraryView;
  context.profile = "work";
  requests[0].resolve({ history: [{ id: "personal-browsing-record" }] });
  await opening;
  assert.deepEqual(context.state.history, []);
  assert.equal(pendingView.history, undefined);
});
