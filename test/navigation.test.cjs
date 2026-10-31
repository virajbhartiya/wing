const test = require("node:test"),
  assert = require("node:assert/strict");
const N = require("../src/navigation.cjs");
test("clean copy removes tracking while preserving functional parameters and fragments", () => {
  assert.equal(
    N.cleanURL("https://example.com/?q=cat&utm_source=x&fbclid=y#result"),
    "https://example.com/?q=cat#result",
  );
  assert.equal(
    N.cleanURL("https://example.com/?token=abc&ref=order"),
    "https://example.com/?token=abc&ref=order",
  );
});
test("site searches encode query data and reject executable/non-HTTPS templates", () => {
  const e = N.validateSearch({
    keyword: "yt",
    name: "YouTube",
    url: "https://youtube.com/results?search_query=%s",
  });
  assert.equal(
    N.resolveInput("yt cats & dogs", { siteSearches: [e] }),
    "https://youtube.com/results?search_query=cats%20%26%20dogs",
  );
  assert.throws(() => N.validateSearch({ ...e, url: "javascript:%s" }));
  assert.throws(() => N.validateSearch({ ...e, url: "https://example.com/" }));
});
test("routing uses host boundaries and ignores deleted destinations", () => {
  const spaces = [{ id: "work" }, { id: "home" }],
    rules = [{ type: "host", value: "example.com", spaceId: "work" }];
  assert.equal(
    N.routeURL("https://sub.example.com/", rules, spaces, "home"),
    "work",
  );
  assert.equal(
    N.routeURL("https://notexample.com/", rules, spaces, "home"),
    "home",
  );
  assert.equal(
    N.routeURL("https://example.com/", rules, [spaces[1]], "home"),
    "home",
  );
});
test("calculator parses arithmetic without executing expressions", () => {
  assert.equal(N.calculate("(2+3)*4"), 20);
  assert.equal(N.calculate("2^3^2"), 512);
  assert.equal(N.calculate("1/0"), null);
  assert.equal(N.calculate("process.exit()"), null);
  assert.equal(N.calculate("2+"), null);
  assert.equal(N.calculate("4%3"), 1);
});

test("command bar ranks a typed host first and keeps one row per page", () => {
  const now = Date.parse("2026-10-25T12:00:00Z");
  const ranked = N.rankResults(
    "git",
    [
      {
        kind: "history",
        title: "Digital garden",
        url: "https://example.com/digit",
        visits: 80,
        at: now,
      },
      {
        kind: "history",
        title: "GitHub",
        url: "https://github.com/",
        visits: 20,
        typed: 4,
        at: now - 86400000,
      },
      {
        kind: "tab",
        id: "t1",
        title: "Pull requests",
        url: "https://github.com/pulls",
        at: now,
      },
      {
        kind: "history",
        title: "Pull requests",
        url: "https://github.com/pulls",
        visits: 3,
      },
      { kind: "bookmark", title: "Docs", url: "https://example.org/notes" },
    ],
    now,
  );
  assert.deepEqual(
    ranked.map((r) => [r.kind, r.url]),
    [
      ["tab", "https://github.com/pulls"],
      ["history", "https://github.com/"],
      ["history", "https://example.com/digit"],
    ],
  );
  assert.equal(ranked[0].topHit, true);
  assert.equal(ranked[2].topHit, false);
  assert.equal(
    N.rankResults("mdn grid", [
      { title: "CSS grid · MDN", url: "https://developer.mozilla.org/" },
    ]).length,
    1,
  );
  assert.equal(
    N.rankResults("a(b", [{ title: "x", url: "https://x.com" }]).length,
    0,
  );
  assert.deepEqual(
    N.rankResults("  ", [{ title: "x", url: "https://x.com" }]),
    [],
  );
});
