const { test } = require("node:test");
const assert = require("node:assert/strict");
const { evictionCandidates, coalescer } = require("../src/lifecycle.cjs");
test("LRU cap evicts oldest inactive pages, preserving current and split pages", () => {
  const entries = Array.from({ length: 20 }, (_, i) => ({
    id: String(i),
    lastActive: i,
  }));
  const evicted = evictionCandidates(entries, {
    activeIds: ["0", "1"],
    maxLive: 8,
    idleMs: Infinity,
  });
  assert.deepEqual(
    evicted,
    Array.from({ length: 12 }, (_, i) => String(i + 2)),
  );
});
test("audio, capture, loading and user input are never silently discarded", () => {
  const entries = [
    { id: "a", audible: true },
    { id: "b", capturing: true },
    { id: "c", loading: true },
    { id: "d", hasInput: true },
    { id: "e" },
  ].map((e) => ({ ...e, lastActive: 0 }));
  assert.deepEqual(evictionCandidates(entries, { maxLive: 1, now: 1000000 }), [
    "e",
  ]);
});
test("idle budget evicts old background pages even below the live cap", () => {
  assert.deepEqual(
    evictionCandidates(
      [
        { id: "old", lastActive: 0 },
        { id: "new", lastActive: 999 },
      ],
      { now: 1000, idleMs: 500 },
    ),
    ["old"],
  );
});
test("100 notifications are coalesced and pending work can be cancelled", async () => {
  let calls = 0;
  const scheduler = coalescer(() => calls++, 5);
  for (let i = 0; i < 100; i++) scheduler.schedule();
  await new Promise((r) => setTimeout(r, 15));
  assert.equal(calls, 1);
  scheduler.schedule();
  scheduler.cancel();
  await new Promise((r) => setTimeout(r, 15));
  assert.equal(calls, 1);
});
