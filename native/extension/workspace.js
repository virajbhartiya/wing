export function initialWorkspace() {
  return {
    version: 1,
    spaces: [
      { id: "personal", name: "Personal", color: "lavender" },
      { id: "work", name: "Work", color: "sage" },
    ],
    activeSpace: "personal",
    assignments: {},
    archive: [],
    budget: 8,
    dark: false,
  };
}
export function safeURL(value) {
  const text = String(value || "").trim();
  if (!text || text === "chrome://newtab/") return "chrome://newtab/";
  if (/^https?:\/\//i.test(text)) return new URL(text).href;
  if (/^(localhost|127\.0\.0\.1)(:\d+)?([/?#]|$)/.test(text))
    return new URL("http://" + text).href;
  if (/^[\w.-]+\.[a-z]{2,}(:\d+)?([/?#]\S*)?$/i.test(text))
    return new URL("https://" + text).href;
  if (/^[a-z][a-z\d+.-]*:/i.test(text))
    throw Error("Only web addresses are accepted here");
  return "https://www.google.com/search?q=" + encodeURIComponent(text);
}
export function discardCandidates(tabs, budget) {
  const live = tabs.filter((t) => !t.discarded);
  const count = Math.max(0, live.length - budget);
  return live
    .filter(
      (t) =>
        !t.active &&
        !t.audible &&
        !t.pinned &&
        (t.splitViewId == null || t.splitViewId === -1) &&
        t.autoDiscardable !== false &&
        t.status !== "loading" &&
        /^https?:/.test(t.url || ""),
    )
    .sort((a, b) => (a.lastAccessed || 0) - (b.lastAccessed || 0))
    .slice(0, count);
}
export function restoreURL(value, extensionHome) {
  if (value === extensionHome) return "chrome://newtab/";
  if (
    /^chrome:\/\/(newtab|extensions|downloads|history|discards|settings)\/?$/.test(
      value,
    )
  )
    return value;
  return safeURL(value);
}
