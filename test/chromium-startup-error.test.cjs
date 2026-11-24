const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const vm = require("node:vm");

test("a failed browser startup shows a persistent error with recovery guidance", async () => {
  const renderer = fs.readFileSync(require.resolve("../src/renderer.js"), "utf8");
  const start = renderer.indexOf('window.wing.invoke("state").then(');
  const end = renderer.indexOf("// Resource errors", start);
  assert.ok(start >= 0 && end > start, "renderer startup found");
  const escapeStart = renderer.indexOf("function esc(value)");
  const escapeEnd = renderer.indexOf("const palettes", escapeStart);
  const error = {
    hidden: true,
    innerHTML: "",
  };
  const home = { hidden: false };
  const elements = { "#page-error": error, "#home": home };
  const result = vm.runInNewContext(renderer.slice(start, end), {
    window: {
      wing: {
        async invoke() {
          throw Error("Workspace could not be opened: <invalid>");
        },
      },
    },
    $: (selector) => elements[selector],
    icon: () => "",
    esc: vm.runInNewContext(renderer.slice(escapeStart, escapeEnd) + "\nesc"),
  });
  await result;
  assert.equal(error.hidden, false);
  assert.equal(home.hidden, true);
  assert.match(error.innerHTML, /role="alert"/);
  assert.match(error.innerHTML, /Workspace could not be opened: &lt;invalid&gt;/);
  assert.match(error.innerHTML, /quit and reopen Wing/i);
});
