const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync(require.resolve("../src/renderer.js"), "utf8");
const context = vm.createContext({
  URL,
  icon: (name) => `<svg data-icon="${name}"></svg>`,
  esc: (value) =>
    String(value).replace(
      /[&<>"']/g,
      (ch) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[ch],
    ),
});
vm.runInContext(
  source.slice(
    source.indexOf("function tabIcon("),
    source.indexOf("function tabHTML("),
  ),
  context,
);
test("sleeping tabs keep their recognizable website icon", () => {
  const markup = context.tabIcon({
    url: "https://example.com",
    favicon: "https://example.com/icon.png",
    sleeping: true,
  });
  assert.match(markup, /icon\.png/);
});
test("unvisited websites get first-party icons and a legible fallback", () => {
  const markup = context.tabIcon({
    url: "https://example.com/page",
    title: "Example",
  });
  assert.match(markup, /https:\/\/example\.com\/favicon.ico/);
  assert.match(markup, /site-monogram/);
  assert.doesNotMatch(markup, /google.com|duckduckgo.com/);
});
test("page-discovered icons are durable and cross-origin navigation clears stale identity", () => {
  const main = fs.readFileSync(require.resolve("../src/main.cjs"), "utf8");
  const tab = { id: "tab", url: "https://example.com/article" };
  let listener,
    durable = 0;
  const runtime = new Map();
  const host = vm.createContext({
    URL,
    runtime,
    state: { tabs: [tab] },
    tab,
    isPeek: false,
    update() {},
    publish: (persist = true) => {
      if (persist) durable++;
    },
    on: (_event, fn) => (listener = fn),
  });
  vm.runInContext(
    main.slice(
      main.indexOf("function faviconURL("),
      main.indexOf("function wireContents("),
    ),
    host,
  );
  const start = main.indexOf('  on("page-favicon-updated"');
  vm.runInContext(
    main.slice(start, main.indexOf('  on("did-navigate"', start)),
    host,
  );
  listener(null, ["javascript:alert(1)", "https://example.com/site.png"]);
  assert.equal(tab.favicon, "https://example.com/site.png");
  assert.equal(durable, 1);
  assert.equal(
    JSON.parse(JSON.stringify(tab)).favicon,
    tab.favicon,
    "the favicon belongs to saved tab state",
  );
  runtime.set(tab.id, { sleeping: true });
  assert.match(context.tabIcon({ ...tab, ...runtime.get(tab.id) }), /site.png/);
  host.clearTabFaviconForNavigation(tab, "https://example.com/next");
  assert.equal(tab.favicon, "https://example.com/site.png");
  host.clearTabFaviconForNavigation(tab, "https://other.example/");
  assert.equal(tab.favicon, undefined);
  assert.equal(tab.faviconOrigin, undefined);
});
test("broken favicon images hide cleanly and expose the monogram fallback", () => {
  let errorHandler;
  const icon = {
    hidden: false,
    parentElement: {
      classList: {
        remove: () => {
          icon.removed = true;
        },
      },
    },
    matches: (selector) => selector === "img.site-favicon",
  };
  icon.src = "https://example.com/gone.png";
  const loadedIcons = new Set([icon.src]);
  const renderer = vm.createContext({
    loadedIcons,
    document: {
      addEventListener: (name, callback, capture) => {
        if (name === "error") {
          assert.equal(capture, true);
          errorHandler = callback;
        }
      },
    },
  });
  const start = source.indexOf("// Resource errors do not bubble");
  vm.runInContext(source.slice(start), renderer);
  errorHandler({ target: icon });
  assert.equal(icon.hidden, true);
  assert.equal(icon.removed, true);
  assert.equal(loadedIcons.has(icon.src), false, "a broken icon is not drawn eagerly again");
});
test("favicon sources reject unsafe URLs and use the current origin after a domain change", () => {
  const markup = context.tabIcon({
    url: "https://new.example/path",
    favicon: "https://old.example/old.png",
    faviconOrigin: "https://old.example",
  });
  assert.match(markup, /https:\/\/new.example\/favicon.ico/);
  assert.doesNotMatch(markup, /old.png/);
  assert.doesNotMatch(
    context.tabIcon({
      url: "https://example.com",
      favicon: "javascript:alert(1)",
    }),
    /javascript:/,
  );
});
