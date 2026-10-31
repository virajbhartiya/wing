const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
test("interrupted resize releases page overlay and removes gesture listeners", () => {
  const source = fs.readFileSync("src/renderer.js", "utf8");
  const fn = source.slice(
    source.indexOf("function resizer("),
    source.indexOf('resizer($("#sidebar-resize")'),
  );
  for (const event of ["pointercancel", "lostpointercapture"]) {
    const listeners = new Map();
    const calls = [];
    const element = {
      addEventListener(k, fn) {
        listeners.set(k, fn);
      },
      removeEventListener(k) {
        listeners.delete(k);
      },
      setPointerCapture() {},
      hasPointerCapture() {
        return false;
      },
      releasePointerCapture() {},
    };
    const context = {
      prepareOverlayBackdrop: () => calls.push(["overlay", { open: true }]),
      releaseOverlayBackdrop: () => calls.push(["overlay", { open: false }]),
      requestAnimationFrame: () => 1,
      cancelAnimationFrame() {},
    };
    vm.createContext(context);
    vm.runInContext(fn + ";this.resizer = resizer;", context);
    context.resizer(element, () => {});
    listeners.get("pointerdown")({
      pointerId: 1,
      button: 0,
      preventDefault() {},
    });
    listeners.get(event)?.({ pointerId: 1 });
    assert.equal(
      calls.at(-1)[1].open,
      false,
      event + " must restore page views",
    );
    assert.equal(listeners.has("pointermove"), false);
  }
});
