"use strict";
const TRACKING =
  /^(utm_.+|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid|igshid|igsh|vero_id|_hsenc|_hsmi)$/i;
function cleanURL(input) {
  const url = new URL(input);
  if (!["http:", "https:"].includes(url.protocol)) return input;
  for (const key of [...url.searchParams.keys()])
    if (TRACKING.test(key)) url.searchParams.delete(key);
  return url.href;
}
const DOCUMENTS = {
  "doc.new": "https://docs.google.com/document/create",
  "sheet.new": "https://sheets.google.com/create",
  "slides.new": "https://slides.google.com/create",
  "form.new": "https://forms.google.com/create",
  "figma.new": "https://www.figma.com/new",
  "notion.new": "https://www.notion.so/new",
};
function validateSearch(engine) {
  if (
    !engine ||
    !/^[a-z0-9_-]{1,20}$/i.test(engine.keyword) ||
    typeof engine.name !== "string" ||
    !engine.name.trim()
  )
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
    url: template.slice(0, 4000),
  };
}
function resolveInput(input, settings = {}) {
  const value = String(input || "").trim();
  if (DOCUMENTS[value]) return DOCUMENTS[value];
  const match = value.match(/^([\w-]+)\s+(.+)$/s);
  const engines = (settings.siteSearches || []).map(validateSearch);
  const engine =
    match && engines.find((e) => e.keyword === match[1].toLowerCase());
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
    if (
      (rule.type === "host" &&
        (url.hostname === value || url.hostname.endsWith("." + value))) ||
      (rule.type === "equals" && url.href === value) ||
      (rule.type === "contains" && url.href.includes(value))
    )
      return rule.spaceId;
  }
  return spaces.some((s) => s.id === fallback) ? fallback : spaces[0]?.id;
}
// Bounded arithmetic parser: never evaluate input as JavaScript.
function calculate(input) {
  if (
    typeof input !== "string" ||
    input.length > 200 ||
    !/[+*/%^()-]/.test(input)
  )
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
    if (t === undefined || !/^\d|^\.\d/.test(t)) throw Error();
    return Number(t);
  }
  const precedence = { "+": 1, "-": 1, "*": 2, "/": 2, "%": 2, "^": 3 };
  function expr(min) {
    let left = atom();
    while ((precedence[tokens[i]] || 0) > min) {
      const op = tokens[i++],
        right = expr(precedence[op] - (op === "^" ? 1 : 0));
      left =
        op === "+"
          ? left + right
          : op === "-"
            ? left - right
            : op === "*"
              ? left * right
              : op === "/"
                ? left / right
                : op === "%"
                  ? left % right
                  : left ** right;
    }
    return left;
  }
  try {
    const result = expr(0);
    return i === tokens.length && Number.isFinite(result)
      ? Number(result.toPrecision(12))
      : null;
  } catch {
    return null;
  }
}
const ENGINE_TERM = [
  [/^(www\.)?google\.[a-z.]+$/, /^\/search$/, "q"],
  [/^(www\.)?bing\.com$/, /^\/search$/, "q"],
  [/^(html\.)?duckduckgo\.com$/, /^\/(html\/?)?$/, "q"],
  [/^search\.brave\.com$/, /^\/search$/, "q"],
  [/^search\.yahoo\.com$/, /^\/search/, "p"],
  [/^(www\.)?ecosia\.org$/, /^\/search$/, "q"],
  [/^kagi\.com$/, /^\/search$/, "q"],
];
// A past search: its words are what you would look for, not the engine's address.
function searchTerm(url) {
  const rule = ENGINE_TERM.find(
    ([host, path]) => host.test(url.hostname) && path.test(url.pathname),
  );
  return rule ? url.searchParams.get(rule[2]) || "" : "";
}
// Click-through hops that only ever bounce you somewhere else.
function isRedirect(url) {
  return (
    (/^(www\.)?google\.[a-z.]+$/.test(url.hostname) &&
      url.pathname === "/url") ||
    /^(l|lm)\.(facebook|instagram)\.com$/.test(url.hostname)
  );
}
function pageKey(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/#.*$/, "")
    .replace(/\/$/, "");
}
const ADDRESS =
  /^(https?:\/\/\S+|localhost(:\d+)?(\/\S*)?|[\w-]+(\.[\w-]+)*\.[a-z]{2,}(:\d+)?([/?#]\S*)?)$/i;
const MAX_ROWS_PER_SITE = 3;
// Ranks open tabs, saved tabs, bookmarks and history for the command bar. A
// typed address always goes to that address. Otherwise a site's home page wins,
// then title words, then anywhere; often-visited and recent pages rise. Only a
// home page you really use, or an open tab, may take over ↵ as the top hit.
function rankResults(query, items, now = Date.now()) {
  const text = String(query || "").trim();
  const tokens = text.toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return [];
  const isAddress = ADDRESS.test(text);
  const typedKey = pageKey(text);
  const seen = new Map();
  const sites = new Map();
  for (const item of items) {
    let host = "",
      rest = String(item.url || "").toLowerCase(),
      title = String(item.title || ""),
      term = "",
      home = false;
    const open = item.kind === "tab" || item.kind === "saved";
    try {
      const url = new URL(item.url);
      host = url.hostname.replace(/^www\./, "");
      rest = (url.pathname + url.search).toLowerCase();
      home = url.pathname === "/" && !url.search;
      if (
        tokens.length === 1 &&
        !isAddress &&
        host.split(".").some((l) => l.startsWith(tokens[0]))
      ) {
        const site = sites.get(host) || {
          url: url.origin + "/",
          title: host,
          visits: 0,
          at: 0,
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
    } catch {}
    const key = term ? "search:" + term.trim().toLowerCase() : pageKey(item.url);
    // The address row already goes here.
    if (isAddress && !open && key === typedKey) continue;
    const lowerTitle = title.toLowerCase();
    // "wiki" should find en.wikipedia.org, but not the registry suffix ".org".
    const labels = host.split(".").slice(0, -1);
    const hostStart = (token) =>
      !!host &&
      ((host + rest).startsWith(token) ||
        labels.some((l) => l.startsWith(token)));
    let match = 0;
    for (const [i, token] of tokens.entries()) {
      const score =
        i === 0 && hostStart(token)
          ? 100
          : lowerTitle.startsWith(token)
            ? 70
            : new RegExp(
                  `(^|[^\\p{L}\\p{N}])${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
                  "u",
                ).test(lowerTitle)
              ? 50
              : host.includes(token)
                ? 40
                : lowerTitle.includes(token)
                  ? 30
                  : rest.includes(token)
                    ? 15
                    : 0;
      if (!score) {
        match = 0;
        break;
      }
      match += score / (i + 1);
    }
    if (!match) continue;
    const days = Math.max(0, (now - (item.at || 0)) / 86400000);
    const score =
      match +
      (hostStart(tokens[0]) ? (home ? 40 : -Math.min(30, rest.length / 4)) : 0) +
      { tab: 30, saved: 26, bookmark: 20, history: 0 }[item.kind || "history"] +
      Math.log2((item.visits || 0) + 1) * 6 +
      Math.min(item.typed || 0, 10) * 3 +
      (item.at ? 18 * Math.exp(-days / 7) : 0);
    const previous = seen.get(key);
    // One row per page: an open or saved tab beats a bookmark or history entry.
    if (previous && (previous.open || !open)) {
      previous.score =
        Math.max(previous.score, score) +
        (previous.open && !open ? Math.log2((item.visits || 0) + 1) * 6 : 0);
      continue;
    }
    const used =
      (item.visits || 0) >= 2 || (item.typed || 0) > 0 || item.kind === "bookmark";
    seen.set(key, {
      ...item,
      title,
      term,
      host: term ? "" : host,
      open,
      score,
      topHit: isAddress
        ? open && key === typedKey
        : tokens.length === 1 &&
          tokens[0].length >= 2 &&
          hostStart(tokens[0]) &&
          (open || (home && used)),
    });
  }
  // Only deep pages of a site in history: still offer the site itself.
  for (const [host, site] of sites) {
    const key = pageKey(site.url);
    if (seen.has(key)) continue;
    const days = Math.max(0, (now - site.at) / 86400000);
    seen.set(key, {
      kind: "history",
      ...site,
      term: "",
      host,
      open: false,
      score:
        140 +
        Math.log2(site.visits + 1) * 6 +
        (site.at ? 18 * Math.exp(-days / 7) : 0),
      topHit: tokens[0].length >= 2 && site.visits >= 2,
    });
  }
  const perSite = new Map();
  return [...seen.values()]
    .sort((a, b) => b.score - a.score)
    .filter((row) => {
      if (row.open || !row.host) return true;
      const count = (perSite.get(row.host) || 0) + 1;
      perSite.set(row.host, count);
      return count <= MAX_ROWS_PER_SITE;
    });
}
module.exports = {
  rankResults,
  cleanURL,
  validateSearch,
  resolveInput,
  routeURL,
  calculate,
  DOCUMENTS,
};
