var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};

// src/themes.cjs
var require_themes = __commonJS({
  "src/themes.cjs"(exports2, module2) {
    "use strict";
    var COLOR_FIELDS = Object.freeze(
      [
        { key: "sidebar", label: "Sidebar & frame", cssVar: "--base" },
        { key: "frame", label: "Frame gradient", cssVar: "--base2" },
        { key: "accent", label: "Accent & icons", cssVar: "--accent" },
        { key: "text", label: "Main text", cssVar: "--ink" },
        { key: "muted", label: "Secondary text", cssVar: "--muted" },
        { key: "hover", label: "Hovered controls", cssVar: "--hover" },
        { key: "selected", label: "Selected tabs", cssVar: "--selected" },
        { key: "surface", label: "Home & content background", cssVar: "--surface" },
        {
          key: "elevated",
          label: "Cards & search field",
          cssVar: "--wing-surface"
        },
        { key: "modal", label: "Menus & command bar", cssVar: "--modal" },
        { key: "border", label: "Borders & separators", cssVar: "--border" },
        { key: "focus", label: "Keyboard focus", cssVar: "--wing-focus" },
        { key: "danger", label: "Destructive actions", cssVar: "--wing-danger" }
      ].map(Object.freeze)
    );
    var LIGHT = Object.freeze({
      text: "#1f1d2b",
      muted: "#5f5c6e",
      hover: "#ffffff4d",
      selected: "#ffffffd9",
      surface: "#ffffff",
      elevated: "#ffffff",
      modal: "#ffffff",
      border: "#1f1d2b14",
      danger: "#c4314b"
    });
    var DARK = Object.freeze({
      text: "#f2f1f6",
      muted: "#a9a6b8",
      hover: "#ffffff12",
      selected: "#ffffff24",
      surface: "#1c1c1f",
      elevated: "#ffffff0d",
      modal: "#26262b",
      border: "#ffffff17",
      danger: "#ff8fa0"
    });
    var PALETTES = {
      lavender: ["#d9d4f5", "#e9d5ef", "#5b4bd6", "#2a2540", "#38234a", "#b3a6ff"],
      sage: ["#cfe3d2", "#e0ecc9", "#2f7d4f", "#1f2f26", "#2b3a20", "#8fd6a8"],
      peach: ["#f6d5c3", "#f7e3b8", "#b4552a", "#3b2a22", "#40301c", "#f2b08c"],
      ocean: ["#c7e0f2", "#cfd9f7", "#1f6fa8", "#1c2c3a", "#202a48", "#8cc8ee"],
      rose: ["#f3cfe0", "#f0d7f0", "#b03a78", "#3a2330", "#38243e", "#f0a0c8"],
      graphite: ["#dcdfe6", "#e7e3ec", "#4a5a78", "#25272e", "#2c2833", "#aebbd6"]
    };
    var PRESETS = Object.freeze(
      Object.fromEntries(
        Object.entries(PALETTES).map(([key, c]) => [
          key,
          Object.freeze({
            light: Object.freeze({
              ...LIGHT,
              sidebar: c[0],
              frame: c[1],
              accent: c[2],
              focus: c[2]
            }),
            dark: Object.freeze({
              ...DARK,
              sidebar: c[3],
              frame: c[4],
              accent: c[5],
              focus: c[5]
            })
          })
        ])
      )
    );
    var knownKeys = new Set(COLOR_FIELDS.map(({ key }) => key));
    function plainObject(value) {
      return value !== null && typeof value === "object" && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
    }
    function normalizeCustomColors(input) {
      if (input === void 0) return { light: {}, dark: {} };
      if (!plainObject(input) || Object.keys(input).some((key) => !["light", "dark"].includes(key)))
        throw Error("Invalid color settings: expected light and dark palettes");
      const output = { light: {}, dark: {} };
      for (const mode of ["light", "dark"]) {
        if (!Object.hasOwn(input, mode)) continue;
        const palette = input[mode];
        if (!plainObject(palette)) throw Error(`Invalid ${mode} color palette`);
        for (const [key, value] of Object.entries(palette)) {
          if (!knownKeys.has(key) || typeof value !== "string" || !/^#[\da-f]{6}([\da-f]{2})?$/i.test(value))
            throw Error(`Invalid color for ${key}: use #RRGGBB or #RRGGBBAA`);
          output[mode][key] = value.toLowerCase();
        }
      }
      return output;
    }
    function resolveColors(space, dark = false) {
      const mode = dark ? "dark" : "light";
      const preset = PRESETS[space?.theme] || PRESETS.lavender;
      const colors = {
        ...preset[mode],
        ...normalizeCustomColors(space?.colors)[mode]
      };
      const tokens = Object.fromEntries(
        COLOR_FIELDS.map(({ key, cssVar }) => [cssVar, colors[key]])
      );
      Object.assign(tokens, {
        "--wing-panel": colors.sidebar,
        "--wing-frame": colors.frame,
        "--wing-accent": colors.accent,
        "--wing-text": colors.text,
        "--wing-muted": colors.muted,
        "--wing-hover": colors.hover,
        "--wing-selected": colors.selected,
        "--wing-bg": colors.surface,
        "--wing-modal": colors.modal,
        "--wing-line": colors.border,
        "--danger": colors.danger
      });
      return tokens;
    }
    module2.exports = {
      COLOR_FIELDS,
      PRESETS,
      normalizeCustomColors,
      resolveColors
    };
  }
});

// src/interactions.cjs
var require_interactions = __commonJS({
  "src/interactions.cjs"(exports2, module2) {
    function sidebarVisible({ hidden, revealed }) {
      return !hidden || Boolean(revealed);
    }
    function sidebarRevealLeft({ width, progress }) {
      const fraction = Math.max(
        0,
        Math.min(1, Number.isFinite(progress) ? progress : 0)
      );
      return Math.round(8 + (Math.max(8, width) - 8) * fraction);
    }
    function createSidebarRevealMotion({ initial = 1, duration = 180 } = {}) {
      let from = initial, target = initial, started = 0, span = 0;
      const sample = (time) => {
        const elapsed = span ? Math.max(0, Math.min(1, (time - started) / span)) : 1;
        const eased = 1 - Math.pow(1 - elapsed, 3);
        return { progress: from + (target - from) * eased, active: elapsed < 1 };
      };
      return {
        get target() {
          return target;
        },
        sample,
        start({ to, time, animate = true }) {
          from = sample(time).progress;
          target = Math.max(0, Math.min(1, to));
          started = time;
          span = animate ? duration * Math.abs(target - from) : 0;
          return sample(time);
        }
      };
    }
    function splitBounds({
      width,
      height,
      left,
      top = 52,
      gap = 8,
      ratio = 0.5,
      orientation = "horizontal"
    }) {
      const availableWidth = Math.max(1, Math.round(width - left - gap));
      const availableHeight = Math.max(1, Math.round(height - top - gap));
      const fraction = Math.max(
        0.25,
        Math.min(0.75, Number.isFinite(ratio) ? ratio : 0.5)
      );
      const vertical = orientation === "vertical";
      const extent = (vertical ? availableHeight : availableWidth) - gap;
      const first = Math.max(1, Math.round(extent * fraction));
      const second = Math.max(1, extent - first);
      return vertical ? [
        { x: left, y: top, width: availableWidth, height: first },
        {
          x: left,
          y: top + first + gap,
          width: availableWidth,
          height: second
        }
      ] : [
        { x: left, y: top, width: first, height: availableHeight },
        {
          x: left + first + gap,
          y: top,
          width: second,
          height: availableHeight
        }
      ];
    }
    function createSwipeTracker({ threshold = 70, gestureWindow = 300 } = {}) {
      let accumulated = 0, previousTime = -Infinity, committed = false;
      let horizontal = false, intentX = 0, intentY = 0;
      let committedDirection = 0, reversalDistance = 0, reversalSamples = 0;
      let reversalStarted = 0, reversalLast = -Infinity;
      let last = { direction: 0, progress: 0, phase: "idle", handled: false };
      function reset() {
        accumulated = 0;
        previousTime = -Infinity;
        committed = horizontal = false;
        intentX = intentY = 0;
        committedDirection = reversalDistance = reversalSamples = 0;
        reversalStarted = 0;
        reversalLast = -Infinity;
        last = { direction: 0, progress: 0, phase: "idle", handled: false };
      }
      function update({ deltaX, deltaY, time = Date.now() }) {
        if (![deltaX, deltaY, time].every(Number.isFinite))
          return { ...last, direction: 0, handled: false };
        if (time < previousTime || time - previousTime > gestureWindow) reset();
        previousTime = time;
        const verticalTurn = Math.abs(deltaY) > 12 && Math.abs(deltaY) > Math.abs(deltaX) * 2;
        if (committed) {
          const opposite = Math.sign(deltaX) === -committedDirection;
          const deliberate = Math.abs(deltaX) >= 8 && Math.abs(deltaX) > Math.abs(deltaY) * 1.1;
          if (verticalTurn || deliberate && !opposite || time - reversalLast > 160) {
            reversalDistance = reversalSamples = 0;
          }
          if (!verticalTurn && deliberate && opposite) {
            if (!reversalSamples) reversalStarted = time;
            reversalLast = time;
            reversalDistance += deltaX;
            reversalSamples++;
            const progress2 = Math.max(
              -1,
              Math.min(1, reversalDistance / threshold)
            );
            if (reversalSamples >= 3 && time - reversalStarted >= 40 && Math.abs(reversalDistance) >= threshold) {
              committedDirection = Math.sign(reversalDistance);
              reversalDistance = reversalSamples = 0;
              return last = {
                direction: committedDirection,
                progress: progress2,
                phase: "committed",
                handled: true
              };
            }
            return last = {
              direction: 0,
              progress: progress2,
              phase: "tracking",
              handled: true
            };
          }
          return last = {
            direction: 0,
            progress: 0,
            phase: "committed",
            handled: !verticalTurn && deltaX !== 0
          };
        }
        if (verticalTurn) {
          accumulated = intentX = intentY = 0;
          horizontal = false;
          return last = {
            direction: 0,
            progress: 0,
            phase: "idle",
            handled: false
          };
        }
        if (!horizontal) {
          intentX += deltaX;
          intentY += deltaY;
          if (Math.max(Math.abs(intentX), Math.abs(intentY)) < 8)
            return last = {
              direction: 0,
              progress: 0,
              phase: "idle",
              handled: false
            };
          if (Math.abs(intentX) <= Math.abs(intentY) * 1.1) {
            intentX = intentY = 0;
            return last = {
              direction: 0,
              progress: 0,
              phase: "idle",
              handled: false
            };
          }
          horizontal = true;
          accumulated = intentX;
        } else accumulated += deltaX;
        const progress = Math.max(-1, Math.min(1, accumulated / threshold));
        if (Math.abs(accumulated) < threshold)
          return last = {
            direction: 0,
            progress,
            phase: progress ? "tracking" : "idle",
            handled: true
          };
        committed = true;
        committedDirection = Math.sign(accumulated);
        return last = {
          direction: committedDirection,
          progress,
          phase: "committed",
          handled: true
        };
      }
      return { push: (event) => update(event).direction, update, reset };
    }
    function nextProfileSpace(spaces, activeSpaceId, direction) {
      const index = spaces.findIndex((space) => space.id === activeSpaceId);
      if (index < 0 || !Number.isFinite(direction) || direction === 0)
        return activeSpaceId;
      const step = Math.sign(direction);
      const profile = spaces[index].profileId;
      for (let offset = 1; offset < spaces.length; offset++) {
        const candidate = spaces[(index + step * offset + spaces.length) % spaces.length];
        if (candidate.profileId !== profile) return candidate.id;
      }
      return activeSpaceId;
    }
    function spaceForProfile(state, index) {
      const profile = state.profiles[index];
      if (!profile) return null;
      const active = state.spaces.find((s) => s.id === state.activeSpaceId);
      if (active?.profileId === profile.id) return active;
      return state.spaces.find((s) => s.profileId === profile.id) || null;
    }
    function tabForShortcut(tabs, splits, index) {
      const rank = { favorite: 0, pinned: 1, today: 2 };
      const ordered = tabs.filter(
        (t) => !t.closed && !(splits || []).some(
          (g) => g.tabIds.includes(t.id) && g.tabIds[0] !== t.id
        )
      ).map((t, i) => [t, i]).sort((a, b) => rank[a[0].kind] - rank[b[0].kind] || a[1] - b[1]).map(([t]) => t);
      return index === 8 ? ordered.at(-1) : ordered[index];
    }
    function shouldAskDefaultBrowser({ packaged, isDefault, settings }) {
      return !!packaged && !isDefault && settings.onboarded !== false && !settings.defaultBrowserPromptOff;
    }
    module2.exports = {
      shouldAskDefaultBrowser,
      spaceForProfile,
      tabForShortcut,
      sidebarVisible,
      sidebarRevealLeft,
      createSidebarRevealMotion,
      splitBounds,
      createSwipeTracker,
      nextProfileSpace
    };
  }
});

// src/navigation.cjs
var require_navigation = __commonJS({
  "src/navigation.cjs"(exports2, module2) {
    "use strict";
    var TRACKING = /^(utm_.+|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid|igshid|igsh|vero_id|_hsenc|_hsmi)$/i;
    function cleanURL(input) {
      const url = new URL(input);
      if (!["http:", "https:"].includes(url.protocol)) return input;
      for (const key of [...url.searchParams.keys()])
        if (TRACKING.test(key)) url.searchParams.delete(key);
      return url.href;
    }
    var DOCUMENTS = {
      "doc.new": "https://docs.google.com/document/create",
      "sheet.new": "https://sheets.google.com/create",
      "slides.new": "https://slides.google.com/create",
      "form.new": "https://forms.google.com/create",
      "figma.new": "https://www.figma.com/new",
      "notion.new": "https://www.notion.so/new"
    };
    function validateSearch(engine) {
      if (!engine || !/^[a-z0-9_-]{1,20}$/i.test(engine.keyword) || typeof engine.name !== "string" || !engine.name.trim())
        throw Error("Give the search a name and a short keyword.");
      const template = String(engine.url || "");
      if (!template.includes("%s"))
        throw Error("Search URL must contain %s for the query.");
      const url = new URL(template.replaceAll("%s", "query"));
      if (url.protocol !== "https:" || url.username || url.password)
        throw Error("Use an HTTPS search URL without credentials.");
      return {
        name: engine.name.trim().slice(0, 80),
        keyword: engine.keyword.toLowerCase(),
        url: template.slice(0, 4e3)
      };
    }
    function resolveInput(input, settings = {}) {
      const value = String(input || "").trim();
      if (DOCUMENTS[value]) return DOCUMENTS[value];
      const match = value.match(/^([\w-]+)\s+(.+)$/s);
      const engines = (settings.siteSearches || []).map(validateSearch);
      const engine = match && engines.find((e) => e.keyword === match[1].toLowerCase());
      if (engine) return engine.url.replaceAll("%s", encodeURIComponent(match[2]));
      return value;
    }
    function routeURL(input, routes, spaces, fallback) {
      const url = new URL(input);
      if (!["http:", "https:"].includes(url.protocol))
        throw Error("Only web links can be routed.");
      for (const rule of routes || []) {
        if (!spaces.some((s) => s.id === rule.spaceId)) continue;
        const value = String(rule.value || "").trim();
        if (!value) continue;
        if (rule.type === "host" && (url.hostname === value || url.hostname.endsWith("." + value)) || rule.type === "equals" && url.href === value || rule.type === "contains" && url.href.includes(value))
          return rule.spaceId;
      }
      return spaces.some((s) => s.id === fallback) ? fallback : spaces[0]?.id;
    }
    function calculate(input) {
      if (typeof input !== "string" || input.length > 200 || !/[+*/%^()-]/.test(input))
        return null;
      const tokens = input.match(/(?:\d+(?:\.\d*)?|\.\d+)|[()+*/%^-]/g) || [];
      if (tokens.join("") !== input.replace(/\s/g, "")) return null;
      let i = 0;
      function atom() {
        const t = tokens[i++];
        if (t === "+") return atom();
        if (t === "-") return -atom();
        if (t === "(") {
          const n = expr(0);
          if (tokens[i++] !== ")") throw Error();
          return n;
        }
        if (t === void 0 || !/^\d|^\.\d/.test(t)) throw Error();
        return Number(t);
      }
      const precedence = { "+": 1, "-": 1, "*": 2, "/": 2, "%": 2, "^": 3 };
      function expr(min) {
        let left = atom();
        while ((precedence[tokens[i]] || 0) > min) {
          const op = tokens[i++], right = expr(precedence[op] - (op === "^" ? 1 : 0));
          left = op === "+" ? left + right : op === "-" ? left - right : op === "*" ? left * right : op === "/" ? left / right : op === "%" ? left % right : left ** right;
        }
        return left;
      }
      try {
        const result = expr(0);
        return i === tokens.length && Number.isFinite(result) ? Number(result.toPrecision(12)) : null;
      } catch {
        return null;
      }
    }
    var ENGINE_TERM = [
      [/^(www\.)?google\.[a-z.]+$/, /^\/search$/, "q"],
      [/^(www\.)?bing\.com$/, /^\/search$/, "q"],
      [/^(html\.)?duckduckgo\.com$/, /^\/(html\/?)?$/, "q"],
      [/^search\.brave\.com$/, /^\/search$/, "q"],
      [/^search\.yahoo\.com$/, /^\/search/, "p"],
      [/^(www\.)?ecosia\.org$/, /^\/search$/, "q"],
      [/^kagi\.com$/, /^\/search$/, "q"]
    ];
    function searchTerm(url) {
      const rule = ENGINE_TERM.find(
        ([host, path]) => host.test(url.hostname) && path.test(url.pathname)
      );
      return rule ? url.searchParams.get(rule[2]) || "" : "";
    }
    function isRedirect(url) {
      return /^(www\.)?google\.[a-z.]+$/.test(url.hostname) && url.pathname === "/url" || /^(l|lm)\.(facebook|instagram)\.com$/.test(url.hostname);
    }
    function pageKey(value) {
      return String(value).trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/#.*$/, "").replace(/\/$/, "");
    }
    var ADDRESS = /^(https?:\/\/\S+|localhost(:\d+)?(\/\S*)?|[\w-]+(\.[\w-]+)*\.[a-z]{2,}(:\d+)?([/?#]\S*)?)$/i;
    var MAX_ROWS_PER_SITE = 3;
    function rankResults(query, items, now = Date.now()) {
      const text = String(query || "").trim();
      const tokens = text.toLowerCase().split(/\s+/).filter(Boolean);
      if (!tokens.length) return [];
      const isAddress = ADDRESS.test(text);
      const typedKey = pageKey(text);
      const seen = /* @__PURE__ */ new Map();
      const sites = /* @__PURE__ */ new Map();
      for (const item of items) {
        let host = "", rest = String(item.url || "").toLowerCase(), title = String(item.title || ""), term = "", home = false;
        const open = item.kind === "tab" || item.kind === "saved";
        try {
          const url = new URL(item.url);
          host = url.hostname.replace(/^www\./, "");
          rest = (url.pathname + url.search).toLowerCase();
          home = url.pathname === "/" && !url.search;
          if (tokens.length === 1 && !isAddress && host.split(".").some((l) => l.startsWith(tokens[0]))) {
            const site = sites.get(host) || {
              url: url.origin + "/",
              title: host,
              visits: 0,
              at: 0
            };
            site.visits += item.visits || 0;
            site.at = Math.max(site.at, item.at || 0);
            sites.set(host, site);
          }
          if (!open) {
            if (isRedirect(url)) continue;
            term = searchTerm(url);
            if (term) {
              if (term.trim().toLowerCase() === text.toLowerCase()) continue;
              host = "";
              rest = "";
              title = term;
            }
          }
          if (/^https?:\/\//i.test(title)) title = pageKey(title);
        } catch {
        }
        const key = term ? "search:" + term.trim().toLowerCase() : pageKey(item.url);
        if (isAddress && !open && key === typedKey) continue;
        const lowerTitle = title.toLowerCase();
        const labels = host.split(".").slice(0, -1);
        const hostStart = (token) => !!host && ((host + rest).startsWith(token) || labels.some((l) => l.startsWith(token)));
        let match = 0;
        for (const [i, token] of tokens.entries()) {
          const score2 = i === 0 && hostStart(token) ? 100 : lowerTitle.startsWith(token) ? 70 : new RegExp(
            `(^|[^\\p{L}\\p{N}])${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
            "u"
          ).test(lowerTitle) ? 50 : host.includes(token) ? 40 : lowerTitle.includes(token) ? 30 : rest.includes(token) ? 15 : 0;
          if (!score2) {
            match = 0;
            break;
          }
          match += score2 / (i + 1);
        }
        if (!match) continue;
        const days = Math.max(0, (now - (item.at || 0)) / 864e5);
        const score = match + (hostStart(tokens[0]) ? home ? 40 : -Math.min(30, rest.length / 4) : 0) + { tab: 30, saved: 26, bookmark: 20, history: 0 }[item.kind || "history"] + Math.log2((item.visits || 0) + 1) * 6 + Math.min(item.typed || 0, 10) * 3 + (item.at ? 18 * Math.exp(-days / 7) : 0);
        const previous = seen.get(key);
        if (previous && (previous.open || !open)) {
          previous.score = Math.max(previous.score, score) + (previous.open && !open ? Math.log2((item.visits || 0) + 1) * 6 : 0);
          continue;
        }
        const used = (item.visits || 0) >= 2 || (item.typed || 0) > 0 || item.kind === "bookmark";
        seen.set(key, {
          ...item,
          title,
          term,
          host: term ? "" : host,
          open,
          score,
          topHit: isAddress ? open && key === typedKey : tokens.length === 1 && tokens[0].length >= 2 && hostStart(tokens[0]) && (open || home && used)
        });
      }
      for (const [host, site] of sites) {
        const key = pageKey(site.url);
        if (seen.has(key)) continue;
        const days = Math.max(0, (now - site.at) / 864e5);
        seen.set(key, {
          kind: "history",
          ...site,
          term: "",
          host,
          open: false,
          score: 140 + Math.log2(site.visits + 1) * 6 + (site.at ? 18 * Math.exp(-days / 7) : 0),
          topHit: tokens[0].length >= 2 && site.visits >= 2
        });
      }
      const perSite = /* @__PURE__ */ new Map();
      return [...seen.values()].sort((a, b) => b.score - a.score).filter((row) => {
        if (row.open || !row.host) return true;
        const count = (perSite.get(row.host) || 0) + 1;
        perSite.set(row.host, count);
        return count <= MAX_ROWS_PER_SITE;
      });
    }
    module2.exports = {
      rankResults,
      cleanURL,
      validateSearch,
      resolveInput,
      routeURL,
      calculate,
      DOCUMENTS
    };
  }
});

// node_modules/electron-chrome-extensions/dist/cjs/browser-action.js
var require_browser_action = __commonJS({
  "node_modules/electron-chrome-extensions/dist/cjs/browser-action.js"(exports2, module2) {
    "use strict";
    var __defProp = Object.defineProperty;
    var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
    var __getOwnPropNames2 = Object.getOwnPropertyNames;
    var __hasOwnProp = Object.prototype.hasOwnProperty;
    var __export = (target, all) => {
      for (var name in all)
        __defProp(target, name, { get: all[name], enumerable: true });
    };
    var __copyProps = (to, from, except, desc) => {
      if (from && typeof from === "object" || typeof from === "function") {
        for (let key of __getOwnPropNames2(from))
          if (!__hasOwnProp.call(to, key) && key !== except)
            __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
      }
      return to;
    };
    var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
    var browser_action_exports = {};
    __export(browser_action_exports, {
      injectBrowserAction: () => injectBrowserAction
    });
    module2.exports = __toCommonJS(browser_action_exports);
    var import_electron = require("electron");
    var injectBrowserAction = () => {
      const actionMap = /* @__PURE__ */ new Map();
      const observerCounts = /* @__PURE__ */ new Map();
      const internalEmitter = process;
      const invoke = (name, partition, ...args) => {
        return import_electron.ipcRenderer.invoke("crx-msg-remote", partition, name, ...args);
      };
      const __browserAction__ = {
        addEventListener(name, listener) {
          internalEmitter.addListener(`-actions-${name}`, listener);
        },
        removeEventListener(name, listener) {
          internalEmitter.removeListener(`-actions-${name}`, listener);
        },
        getAction(extensionId) {
          return actionMap.get(extensionId);
        },
        async getState(partition) {
          const state = await invoke("browserAction.getState", partition);
          for (const action of state.actions) {
            actionMap.set(action.id, action);
          }
          queueMicrotask(() => internalEmitter.emit("-actions-update", state));
          return state;
        },
        activate: (partition, details) => {
          return invoke("browserAction.activate", partition, details);
        },
        addObserver(partition) {
          let count = observerCounts.has(partition) ? observerCounts.get(partition) : 0;
          count = count + 1;
          observerCounts.set(partition, count);
          if (count === 1) {
            invoke("browserAction.addObserver", partition);
          }
        },
        removeObserver(partition) {
          let count = observerCounts.has(partition) ? observerCounts.get(partition) : 0;
          count = Math.max(count - 1, 0);
          observerCounts.set(partition, count);
          if (count === 0) {
            invoke("browserAction.removeObserver", partition);
            observerCounts.delete(partition);
          }
        }
      };
      import_electron.ipcRenderer.on("browserAction.update", () => {
        for (const partition of observerCounts.keys()) {
          __browserAction__.getState(partition);
        }
      });
      function mainWorldScript() {
        const DEFAULT_PARTITION = "_self";
        const browserAction = globalThis.browserAction || __browserAction__;
        class BrowserActionElement extends HTMLButtonElement {
          get id() {
            return this.getAttribute("id") || "";
          }
          set id(id) {
            this.setAttribute("id", id);
          }
          get tab() {
            const tabId = parseInt(this.getAttribute("tab") || "", 10);
            return typeof tabId === "number" && !isNaN(tabId) ? tabId : -1;
          }
          set tab(tab) {
            this.setAttribute("tab", `${tab}`);
          }
          get partition() {
            return this.getAttribute("partition");
          }
          set partition(partition) {
            if (partition) {
              this.setAttribute("partition", partition);
            } else {
              this.removeAttribute("partition");
            }
          }
          get alignment() {
            return this.getAttribute("alignment") || "";
          }
          set alignment(alignment) {
            this.setAttribute("alignment", alignment);
          }
          static get observedAttributes() {
            return ["id", "tab", "partition", "alignment"];
          }
          constructor() {
            super();
            this.addEventListener("click", this.onClick.bind(this));
            this.addEventListener("contextmenu", this.onContextMenu.bind(this));
          }
          connectedCallback() {
            if (this.isConnected) {
              this.update();
            }
          }
          disconnectedCallback() {
            if (this.updateId) {
              cancelAnimationFrame(this.updateId);
              this.updateId = void 0;
            }
            if (this.pendingIcon) {
              this.pendingIcon = void 0;
            }
          }
          attributeChangedCallback() {
            if (this.isConnected) {
              this.update();
            }
          }
          activate(event) {
            const rect = this.getBoundingClientRect();
            browserAction.activate(this.partition || DEFAULT_PARTITION, {
              eventType: event.type,
              extensionId: this.id,
              tabId: this.tab,
              alignment: this.alignment,
              anchorRect: {
                x: rect.left,
                y: rect.top,
                width: rect.width,
                height: rect.height
              }
            });
          }
          onClick(event) {
            this.activate(event);
          }
          onContextMenu(event) {
            event.stopImmediatePropagation();
            event.preventDefault();
            this.activate(event);
          }
          getBadge() {
            let badge = this.badge;
            if (!badge) {
              this.badge = badge = document.createElement("div");
              badge.className = "badge";
              badge.part = "badge";
              this.appendChild(badge);
            }
            return badge;
          }
          update() {
            if (this.updateId) return;
            this.updateId = requestAnimationFrame(this.updateCallback.bind(this));
          }
          updateIcon(info) {
            const iconSize = 32;
            const resizeType = 2;
            const searchParams = new URLSearchParams({
              tabId: `${this.tab}`,
              partition: `${this.partition || DEFAULT_PARTITION}`
            });
            if (info.iconModified) {
              searchParams.append("t", info.iconModified);
            }
            const iconUrl = `crx://extension-icon/${this.id}/${iconSize}/${resizeType}?${searchParams.toString()}`;
            const bgImage = `url(${iconUrl})`;
            if (this.pendingIcon) {
              this.pendingIcon.onload = this.pendingIcon.onerror = () => {
              };
              this.pendingIcon = void 0;
            }
            const img = this.pendingIcon = new Image();
            img.onerror = () => {
              if (this.isConnected) {
                this.classList.toggle("no-icon", true);
                if (this.title) {
                  this.dataset.letter = this.title.charAt(0);
                }
                this.pendingIcon = void 0;
              }
            };
            img.onload = () => {
              if (this.isConnected) {
                this.classList.toggle("no-icon", false);
                this.style.backgroundImage = bgImage;
                this.pendingIcon = void 0;
              }
            };
            img.src = iconUrl;
          }
          updateCallback() {
            this.updateId = void 0;
            const action = browserAction.getAction(this.id);
            const activeTabId = this.tab;
            const tabInfo = activeTabId > -1 ? action.tabs[activeTabId] : {};
            const info = { ...tabInfo, ...action };
            this.title = typeof info.title === "string" ? info.title : "";
            this.updateIcon(info);
            if (info.text) {
              const badge = this.getBadge();
              badge.textContent = info.text;
              badge.style.color = "#fff";
              badge.style.backgroundColor = info.color;
            } else if (this.badge) {
              this.badge.remove();
              this.badge = void 0;
            }
          }
        }
        customElements.define("browser-action", BrowserActionElement, { extends: "button" });
        class BrowserActionListElement extends HTMLElement {
          constructor() {
            super();
            this.observing = false;
            this.fetchState = async () => {
              try {
                await browserAction.getState(this.partition || DEFAULT_PARTITION);
              } catch {
                console.error(
                  `browser-action-list failed to update [tab: ${this.tab}, partition: '${this.partition}']`
                );
              }
            };
            this.update = (state) => {
              const tabId = typeof this.tab === "number" && this.tab >= 0 ? this.tab : state.activeTabId || -1;
              for (const action of state.actions) {
                let browserActionNode = this.shadowRoot?.querySelector(
                  `[id=${action.id}]`
                );
                if (!browserActionNode) {
                  const node = document.createElement("button", {
                    is: "browser-action"
                  });
                  node.id = action.id;
                  node.className = "action";
                  node.alignment = this.alignment;
                  node.part = "action";
                  browserActionNode = node;
                  this.shadowRoot?.appendChild(browserActionNode);
                }
                if (this.partition) browserActionNode.partition = this.partition;
                if (this.alignment) browserActionNode.alignment = this.alignment;
                browserActionNode.tab = tabId;
              }
              const actionNodes = Array.from(
                this.shadowRoot?.querySelectorAll(".action")
              );
              for (const actionNode of actionNodes) {
                if (!state.actions.some((action) => action.id === actionNode.id)) {
                  actionNode.remove();
                }
              }
            };
            const shadowRoot = this.attachShadow({ mode: "open" });
            const style = document.createElement("style");
            style.textContent = `
:host {
  display: flex;
  flex-direction: row;
  gap: 5px;
}

.action {
  width: 28px;
  height: 28px;
  background-color: transparent;
  background-position: center;
  background-repeat: no-repeat;
  background-size: 70%;
  border: none;
  border-radius: 4px;
  padding: 0;
  position: relative;
  outline: none;
}

.action:hover {
  background-color: var(--browser-action-hover-bg, rgba(255, 255, 255, 0.3));
}

.action.no-icon::after {
  content: attr(data-letter);
  text-transform: uppercase;
  font-size: .7rem;
  background-color: #757575;
  color: white;
  border-radius: 4px;
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 80%;
  height: 80%;
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
}

.badge {
  box-shadow: 0px 0px 1px 1px var(--browser-action-badge-outline, #444);
  box-sizing: border-box;
  max-width: 100%;
  height: 12px;
  padding: 0 2px;
  border-radius: 2px;
  position: absolute;
  bottom: 1px;
  right: 0;
  pointer-events: none;
  line-height: 1.5;
  font-size: 9px;
  font-weight: 400;
  overflow: hidden;
  white-space: nowrap;
}`;
            shadowRoot.appendChild(style);
          }
          get tab() {
            const tabId = parseInt(this.getAttribute("tab") || "", 10);
            return typeof tabId === "number" && !isNaN(tabId) ? tabId : null;
          }
          set tab(tab) {
            if (typeof tab === "number") {
              this.setAttribute("tab", `${tab}`);
            } else {
              this.removeAttribute("tab");
            }
          }
          get partition() {
            return this.getAttribute("partition");
          }
          set partition(partition) {
            if (partition) {
              this.setAttribute("partition", partition);
            } else {
              this.removeAttribute("partition");
            }
          }
          get alignment() {
            return this.getAttribute("alignment") || "";
          }
          set alignment(alignment) {
            this.setAttribute("alignment", alignment);
          }
          static get observedAttributes() {
            return ["tab", "partition", "alignment"];
          }
          connectedCallback() {
            if (this.isConnected) {
              this.startObserving();
              this.fetchState();
            }
          }
          disconnectedCallback() {
            this.stopObserving();
          }
          attributeChangedCallback(name, oldValue, newValue) {
            if (oldValue === newValue) return;
            if (this.isConnected) {
              this.fetchState();
            }
          }
          startObserving() {
            if (this.observing) return;
            browserAction.addEventListener("update", this.update);
            browserAction.addObserver(this.partition || DEFAULT_PARTITION);
            this.observing = true;
          }
          stopObserving() {
            if (!this.observing) return;
            browserAction.removeEventListener("update", this.update);
            browserAction.removeObserver(this.partition || DEFAULT_PARTITION);
            this.observing = false;
          }
        }
        customElements.define("browser-action-list", BrowserActionListElement);
      }
      if (process.contextIsolated) {
        import_electron.contextBridge.exposeInMainWorld("browserAction", __browserAction__);
        if ("executeInMainWorld" in import_electron.contextBridge) {
          import_electron.contextBridge.executeInMainWorld({
            func: mainWorldScript
          });
        } else {
          import_electron.webFrame.executeJavaScript(`(${mainWorldScript}());`);
        }
      } else {
        mainWorldScript();
      }
    };
  }
});

// src/preload.cjs
var { contextBridge, ipcRenderer } = require("electron");
var theme = require_themes();
var swipe = require_interactions().createSwipeTracker();
contextBridge.exposeInMainWorld("wing", {
  navigation: {
    calculate: (input) => require_navigation().calculate(input),
    rankResults: (query, items) => require_navigation().rankResults(query, items)
  },
  theme: {
    fields: theme.COLOR_FIELDS,
    resolve: (space, dark) => theme.resolveColors(space, dark)
  },
  swipeGesture: (deltaX, deltaY, time) => swipe.push({ deltaX, deltaY, time }),
  swipeUpdate: (deltaX, deltaY, time) => swipe.update({ deltaX, deltaY, time }),
  swipeReset: () => swipe.reset(),
  invoke: (action, data = {}) => ipcRenderer.invoke("wing:action", action, data),
  onState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("wing:state", listener);
    return () => ipcRenderer.removeListener("wing:state", listener);
  },
  onOverlay: (callback) => {
    const listener = (_event, message) => callback(message);
    ipcRenderer.on("wing:overlay", listener);
    return () => ipcRenderer.removeListener("wing:overlay", listener);
  },
  onCommand: (callback) => {
    ipcRenderer.on("wing:command", (_event, command) => callback(command));
  }
});
require_browser_action().injectBrowserAction();
