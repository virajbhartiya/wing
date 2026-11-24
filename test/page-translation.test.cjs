const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const vm = require("node:vm");

function translationPanel(request) {
  const source = fs.readFileSync(require.resolve("../src/renderer.js"), "utf8");
  const start = source.indexOf("async function translatePageText()");
  const end = source.indexOf('// "Follow system"', start);
  const status = { textContent: "" };
  const text = { textContent: "", hidden: true };
  const copy = { hidden: true };
  const actions = [];
  const ui = {
    modalGeneration: 0,
    current: () => ({ id: "fixture", url: "https://example.test/" }),
    dialogHead: () => "",
    esc: (value) => value,
    showModal: () => { ui.modalGeneration++; },
    $: (selector) => ({
      "#translation-status": status,
      "#translation-text": text,
      "#translation-copy": copy,
    })[selector],
    act: (action, data) => actions.push([action, data.text]),
    window: {
      wing: { invoke: (action, data) => {
        assert.equal(action, "translate-page");
        assert.equal(data.id, "fixture");
        return request;
      } },
    },
  };
  vm.runInNewContext(source.slice(start, end), ui);
  return { ui, text, copy, status, actions };
}

test("page translation displays literal translated text and lets readers copy it", async () => {
  const translation = "<profile> et <langue>";
  const { ui, text, copy, status, actions } = translationPanel(
    Promise.resolve({ translation, truncated: true }),
  );
  await ui.translatePageText();
  assert.equal(text.textContent, translation);
  assert.equal(text.hidden, false);
  assert.match(status.textContent, /first 8,000 characters/);
  assert.equal(copy.hidden, false);
  copy.onclick();
  assert.deepEqual(actions, [["copy-text", translation]]);
});

test("a translation that finishes after closing the panel leaves the next view alone", async () => {
  const { ui, text, copy } = translationPanel(Promise.resolve({ translation: "Fixture" }));
  const pending = ui.translatePageText();
  ui.modalGeneration++;
  await pending;
  assert.equal(text.hidden, true);
  assert.equal(copy.hidden, true);
});
