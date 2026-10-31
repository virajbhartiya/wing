const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  vm = require("node:vm");
const source = fs.readFileSync("src/renderer.js", "utf8");
function element(options = {}) {
  return {
    type: "button",
    disabled: false,
    tabIndex: 0,
    isConnected: true,
    id: "",
    getClientRects: () => [{}],
    matches: () => false,
    focus() {
      this.focused = true;
    },
    ...options,
  };
}
function setup(elements = []) {
  const opener = element({ id: "settings-button" }),
    modal = element({
      querySelectorAll: () => elements,
      setAttribute() {},
      innerHTML: "",
    }),
    overlay = {
      hidden: true,
      classes: new Set(),
      classList: {
        add: (name) => overlay.classes.add(name),
        remove: (name) => overlay.classes.delete(name),
      },
    };
  const nodes = {
    "#modal": modal,
    "#overlay": overlay,
    "#settings-button": opener,
    "#new-tab": element(),
    "#show-sidebar": element(),
    "#sidebar": element(),
  };
  const context = {
    document: {
      activeElement: opener,
      getElementById: (id) => nodes["#" + id],
    },
    getComputedStyle: (el) => ({ visibility: el.visibility || "visible" }),
    $: (id) => nodes[id],
    act() {},
    prepareOverlayBackdrop: async () => true,
    releaseOverlayBackdrop: async () => {},
    modalGeneration: 0,
    stopMetrics() {},
    render() {},
    state: null,
    modalType: null,
    themePreview: null,
    modalOpener: null,
    // Reduced motion closes synchronously, so focus assertions stay immediate.
    reducedMotion: { matches: true },
  };
  vm.createContext(context);
  const start = source.indexOf("function modalFocusable(");
  assert(
    start >= 0,
    "modal focus traversal needs a shared visibility-aware helper",
  );
  vm.runInContext(
    source.slice(start, source.indexOf("let backdropEpoch", start)) +
      source.slice(
        source.indexOf("function showModal("),
        source.indexOf("let metricsTimer", start),
      ),
    context,
  );
  vm.runInContext(
    source.slice(
      source.indexOf("function closeModal("),
      source.indexOf("function dialogHead("),
    ),
    context,
  );
  return { context, nodes, opener, modal, overlay };
}
test("modal traversal includes summary and excludes invisible, disabled and negative-tabindex controls", () => {
  const summary = element({ tagName: "SUMMARY" }),
    hidden = element({ getClientRects: () => [] }),
    disabled = element({ matches: () => true }),
    negative = element({ tabIndex: -1 }),
    invisible = element({ visibility: "hidden" });
  const { context } = setup([summary, hidden, disabled, negative, invisible]);
  assert.deepEqual([...context.modalFocusable()], [summary]);
});
test("opening a modal sets initial focus and closing restores its original opener across dialog replacement", () => {
  const input = element();
  const { context, opener } = setup([input]);
  context.showModal("settings", "settings");
  assert(input.focused);
  context.document.activeElement = input;
  context.showModal("another", "replacement");
  context.closeModal();
  assert(opener.focused);
});
test("empty modal receives focus and a removed opener falls back safely", () => {
  const { context, modal, opener, nodes } = setup();
  context.showModal("empty", "");
  assert(modal.focused);
  opener.isConnected = false;
  delete nodes["#settings-button"];
  context.closeModal();
  assert(nodes["#new-tab"].focused);
});
test("Tab wraps visible controls and recaptures focus that escaped the modal", () => {
  const first = element(),
    last = element({ tagName: "SUMMARY" });
  const { context, modal } = setup([first, last]);
  let listener;
  context.document.addEventListener = (_name, fn) => (listener = fn);
  const begin = source.indexOf('document.addEventListener("keydown"');
  vm.runInContext(
    source.slice(begin, source.indexOf('$("#overlay").onclick', begin)),
    context,
  );
  context.showModal("test", "");
  for (const [active, shiftKey, expected] of [
    [last, false, first],
    [first, true, last],
    [element(), false, first],
    [modal, true, last],
  ]) {
    first.focused = false;
    last.focused = false;
    context.document.activeElement = active;
    let prevented = false;
    listener({
      key: "Tab",
      shiftKey,
      target: { matches: () => false },
      preventDefault() {
        prevented = true;
      },
    });
    assert(prevented);
    assert(expected.focused);
  }
});
