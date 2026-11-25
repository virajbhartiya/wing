const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const vm = require("node:vm");

function fixture() {
  const work = { traversal: 0, templates: 0, insertions: 0 };
  const document = {};
  class Element {
    constructor(label, styles = []) {
      this.label = label;
      this.children = [];
      this.parent = null;
      this.attrs = new Map();
      this.listeners = new Map();
      const classes = new Set(styles);
      this.classList = {
        get 0() {
          return classes.values().next().value;
        },
        add: (name) => classes.add(name),
        remove: (name) => classes.delete(name),
        contains: (name) => classes.has(name),
        toggle: (name, on) => (on ? classes.add(name) : classes.delete(name)),
      };
    }
    get firstElementChild() {
      work.traversal++;
      return this.children[0] || null;
    }
    get lastElementChild() {
      work.traversal++;
      return this.children.at(-1) || null;
    }
    get nextElementSibling() {
      work.traversal++;
      const siblings = this.parent.children;
      return siblings[siblings.indexOf(this) + 1] || null;
    }
    get attributes() {
      return [...this.attrs].map(([name, value]) => ({ name, value }));
    }
    get childNodes() {
      return this.children;
    }
    getAttribute(name) {
      return this.attrs.get(name);
    }
    setAttribute(name, value) {
      this.attrs.set(name, value);
    }
    contains(child) {
      for (let current = child; current; current = current.parent)
        if (current === this) return true;
      return false;
    }
    querySelector(selector) {
      const name = selector.slice(1);
      for (const child of this.children) {
        if (child.classList.contains(name)) return child;
        const found = child.querySelector(selector);
        if (found) return found;
      }
      return null;
    }
    insertBefore(child, before) {
      work.insertions++;
      child.remove();
      const index = before
        ? this.children.indexOf(before)
        : this.children.length;
      assert.ok(index >= 0, "insertion reference belongs to its parent");
      this.children.splice(index, 0, child);
      child.parent = this;
    }
    replaceChildren(...children) {
      for (const child of [...this.children]) child.remove();
      for (const child of children) this.insertBefore(child, null);
    }
    remove() {
      if (!this.parent) return;
      this.parent.children.splice(this.parent.children.indexOf(this), 1);
      this.parent = null;
    }
    focus() {
      document.activeElement = this;
    }
    addEventListener(name, callback) {
      this.listeners.set(name, callback);
    }
  }
  const root = new Element("root");
  document.createElement = (type) => {
    assert.equal(type, "template");
    work.templates++;
    const content = new Element("fragment");
    return {
      content,
      set innerHTML(value) {
        const { id, folder, title, collapsed } = JSON.parse(value);
        const row = new Element(id, folder ? ["folder"] : ["tab"]);
        row.setAttribute("title", title);
        if (folder) {
          const header = new Element("header");
          header.setAttribute("aria-expanded", String(!collapsed));
          header.replaceChildren(new Element(title));
          row.replaceChildren(header, new Element("children"));
        } else {
          row.replaceChildren(
            new Element("icon", ["site-icon"]),
            new Element("close", ["tab-close"]),
          );
        }
        content.replaceChildren(row);
      },
    };
  };
  const source = fs.readFileSync(require.resolve("../src/renderer.js"), "utf8");
  const context = vm.createContext({ document, $: () => root });
  vm.runInContext(
    source.slice(
      source.indexOf("const renderedTabIds"),
      source.indexOf("const current ="),
    ),
    context,
  );
  return {
    root,
    document,
    work,
    Element,
    render: (rows) => context.patchTabRows("#pinned", rows),
    reset: () =>
      Object.assign(work, { traversal: 0, templates: 0, insertions: 0 }),
  };
}

function tab(id, { active = false, loading = false, title = id } = {}) {
  return {
    key: `tab:${id}`,
    tabId: id,
    active,
    loading,
    content: [title],
    html: () => JSON.stringify({ id, title }),
  };
}

function folder(id, children, collapsed = false) {
  return {
    key: `folder:${id}`,
    content: [id, collapsed],
    children,
    html: () => JSON.stringify({ id, folder: true, title: id, collapsed }),
  };
}

test("selection in a large keyed tab tree skips structural DOM work", () => {
  const { root, work, render, reset } = fixture();
  const rows = (selected) =>
    Array.from({ length: 10 }, (_, group) =>
      folder(
        String(group),
        Array.from({ length: 100 }, (_, index) => {
          const id = String(group * 100 + index);
          return tab(id, { active: id === selected, loading: id === selected });
        }),
      ),
    );
  render(rows("0"));
  const first = root.children[0].children[1].children[0];
  const last = root.children[9].children[1].children[99];
  reset();
  render(rows("999"));
  assert.equal(first.classList.contains("active"), false);
  assert.equal(last.classList.contains("active"), true);
  assert.equal(last.children[0].classList.contains("is-loading"), true);
  assert.deepEqual(work, { traversal: 0, templates: 0, insertions: 0 });
});

test("keyed tab reconciliation preserves focus, rename and folder child placement", () => {
  const { root, document, Element, render } = fixture();
  render([folder("folder", [tab("one"), tab("two")])]);
  const folderNode = root.children[0];
  const children = folderNode.children[1];
  const [one, two] = children.children;
  const rename = new Element("rename", ["tab-rename"]);
  one.insertBefore(rename, null);
  render([folder("folder", [tab("two"), tab("one", { title: "new" })])]);
  assert.deepEqual(children.children, [one, two]);
  assert.equal(one.getAttribute("title"), "one");

  rename.remove();
  one.children[1].focus();
  render([
    folder("folder", [tab("two"), tab("one", { title: "new" }), tab("three")]),
  ]);
  const three = children.children[2];
  assert.equal(root.children[0], folderNode);
  assert.equal(folderNode.children[1], children);
  assert.deepEqual(children.children, [two, one, three]);
  assert.equal(one.getAttribute("title"), "new");
  assert.equal(document.activeElement, one.children[1]);
  assert.equal(three.classList.contains("entering"), true);
  three.listeners.get("animationend")({ animationName: "tab-enter" });
  assert.equal(three.classList.contains("entering"), false);

  render([folder("folder", [tab("one")], true)]);
  assert.equal(folderNode.children[0].getAttribute("aria-expanded"), "false");
  assert.deepEqual(children.children, [one]);
});

test("top tabs skip sidebar projection and switching back shows current rows", () => {
  const source = fs.readFileSync(require.resolve("../src/renderer.js"), "utf8");
  const patches = [],
    projections = [],
    scrolls = [],
    frames = [];
  let pullRequests = 0;
  const state = {
    activeTabId: "pinned",
    spaces: [{ id: "work", profileId: "primary", name: "Work" }],
    profiles: [{ id: "primary", name: "Primary" }],
    folders: [{ id: "folder", spaceId: "work", name: "Folder" }],
    settings: { tabLayout: "top" },
    tabs: [
      {
        id: "pinned",
        title: "Saved",
        kind: "pinned",
        folderId: "folder",
        url: "https://saved.test",
      },
      { id: "today", title: "Today", kind: "today", url: "https://today.test" },
      {
        id: "favorite",
        title: "Favorite",
        kind: "favorite",
        url: "https://favorite.test",
      },
    ],
  };
  const elements = new Map();
  const $ = (selector) => {
    if (!elements.has(selector))
      elements.set(selector, {
        classList: { toggle() {}, contains: () => false },
        dataset: {},
        hidden: true,
        style: { setProperty() {} },
        setAttribute() {},
        removeAttribute() {},
        scrollIntoView: () => scrolls.push(selector),
      });
    return elements.get(selector);
  };
  const noop = () => {};
  const context = vm.createContext({
    state,
    $,
    document: { body: $("body"), documentElement: $("html") },
    window: { wing: { theme: { resolve: () => ({}) } } },
    current: () => state.tabs.find((row) => row.id === state.activeTabId),
    currentSpace: () => state.spaces[0],
    tabsForSpace: () => state.tabs,
    sidebarTabTitle: (tab) => tab.title,
    tabRow: (tab, _group, title, options) => {
      projections.push({ id: tab.id, options });
      return { ...tab, title, active: tab.id === state.activeTabId };
    },
    patchTabRows: (selector, rows) => patches.push({ selector, rows }),
    renderPrFolder: () => pullRequests++,
    requestAnimationFrame: (fn) => frames.push(fn),
    closeFind: noop,
    noteLayoutMode: noop,
    applySidebarReveal: noop,
    patchHTML: noop,
    renderDownloadsButton: noop,
    renderMediaPlayer: noop,
    syncSystemAppearance: noop,
    positionSplitDivider: noop,
    refreshPulls: noop,
    renderLibraryList: noop,
    environmentOf: () => null,
    esc: String,
    tabIcon: () => "",
    icon: () => "",
    host: (url) => url,
    systemAppearanceChecked: true,
    modalType: null,
    themePreview: null,
  });
  vm.runInContext(
    source.slice(
      source.indexOf("let renderedActiveTab"),
      source.indexOf("// Safari-style toolbar button"),
    ),
    context,
  );
  const render = () => {
    context.render();
    while (frames.length) frames.shift()();
  };

  render();
  assert.deepEqual(
    patches.splice(0).map(({ selector }) => selector),
    ["#strip-tabs"],
  );
  assert.equal(projections.splice(0).length, state.tabs.length);
  assert.deepEqual(scrolls.splice(0), ["#strip-tabs .tab.active"]);
  assert.equal(pullRequests, 1);

  state.tabs[0].title = "Updated while hidden";
  state.activeTabId = "today";
  render();
  assert.deepEqual(
    patches.splice(0).map(({ selector }) => selector),
    ["#strip-tabs"],
  );
  assert.deepEqual(scrolls.splice(0), ["#strip-tabs .tab.active"]);

  state.settings.tabLayout = "sidebar";
  render();
  assert.deepEqual(
    patches.map(({ selector }) => selector),
    ["#favorites", "#pinned", "#today"],
  );
  assert.equal(patches[1].rows[0].children[0].title, "Updated while hidden");
  assert.equal(patches[2].rows[0].active, true);
  assert.deepEqual(scrolls.splice(0), ["#sidebar .tab.active"]);

  state.sidebarHidden = true;
  state.sidebarRevealed = false;
  state.activeTabId = "pinned";
  render();
  assert.deepEqual(scrolls, []);
  state.sidebarRevealed = true;
  render();
  assert.deepEqual(scrolls.splice(0), ["#sidebar .tab.active"]);
  render();
  assert.deepEqual(scrolls, []);

  state.settings.tabLayout = "top";
  patches.length = 0;
  render();
  assert.deepEqual(
    patches.map(({ selector }) => selector),
    ["#strip-tabs"],
  );
  assert.deepEqual(scrolls, ["#strip-tabs .tab.active"]);
  assert.equal(pullRequests, 7);
});
