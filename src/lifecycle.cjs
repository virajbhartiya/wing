/** Choose background renderers to discard, without discarding a document at risk.
 * The cap is deliberately soft: audio, capture, drafts and loading beat the cap.
 * State/bookmarks remain intact; a discarded page reloads when selected.
 */
function evictionCandidates(
  entries,
  { activeIds = [], maxLive = 8, idleMs = 10 * 60_000, now = Date.now() } = {},
) {
  const protectedIds = new Set(activeIds);
  const eligible = entries
    .filter(
      (e) =>
        !protectedIds.has(e.id) &&
        !e.audible &&
        !e.loading &&
        !e.hasInput &&
        !e.capturing,
    )
    .sort((a, b) => a.lastActive - b.lastActive);
  let live = entries.length;
  return eligible
    .filter((e) => {
      if (live > maxLive || now - e.lastActive > idleMs) {
        live--;
        return true;
      }
      return false;
    })
    .map((e) => e.id);
}
/** Coalesce bursts without extending the deadline indefinitely. */
function coalescer(callback, delay = 16) {
  let timer = null;
  return {
    schedule() {
      if (timer === null)
        timer = setTimeout(() => {
          timer = null;
          callback();
        }, delay);
    },
    cancel() {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
  };
}
module.exports = { evictionCandidates, coalescer };
