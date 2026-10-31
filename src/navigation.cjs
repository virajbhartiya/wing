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
// Ranks open tabs, saved tabs, bookmarks and history for the command bar the
// way Safari does: a host that starts with the query wins, then title words,
// then anywhere; often-visited, recently-used and open pages rise.
function rankResults(query, items, now = Date.now()) {
  const tokens = String(query || "")
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!tokens.length) return [];
  const seen = new Map();
  for (const item of items) {
    let host = "",
      rest = String(item.url || "").toLowerCase();
    try {
      const url = new URL(item.url);
      host = url.hostname.replace(/^www\./, "");
      rest = (url.pathname + url.search).toLowerCase();
    } catch {}
    const title = String(item.title || "").toLowerCase();
    // "wiki" should find en.wikipedia.org, but not the registry suffix ".org".
    const labels = host.split(".").slice(0, -1);
    const hostStart = (token) =>
      host.startsWith(token) || labels.some((l) => l.startsWith(token));
    let match = 0;
    for (const [i, token] of tokens.entries()) {
      const score =
        i === 0 && hostStart(token)
          ? 100
          : title.startsWith(token)
            ? 70
            : new RegExp(
                  `(^|[^\\p{L}\\p{N}])${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
                  "u",
                ).test(title)
              ? 50
              : host.includes(token)
                ? 40
                : title.includes(token)
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
      { tab: 30, saved: 26, bookmark: 20, history: 0 }[item.kind || "history"] +
      Math.log2((item.visits || 0) + 1) * 6 +
      Math.min(item.typed || 0, 10) * 3 +
      (item.at ? 18 * Math.exp(-days / 7) : 0);
    const open = item.kind === "tab" || item.kind === "saved";
    const previous = seen.get(item.url);
    // One row per page: an open or saved tab beats a bookmark or history entry.
    if (previous && (previous.open || !open)) {
      previous.score =
        Math.max(previous.score, score) +
        (previous.open && !open ? Math.log2((item.visits || 0) + 1) * 6 : 0);
      continue;
    }
    seen.set(item.url, {
      ...item,
      open,
      score,
      topHit: tokens.length === 1 && hostStart(tokens[0]),
    });
  }
  return [...seen.values()].sort((a, b) => b.score - a.score);
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
