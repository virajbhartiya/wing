"use strict";
// This private component page has no externally-connectable or web-accessible
// resources. The native host additionally authenticates its exact tab and URL.
const permissionTypes = {
  media: ["microphone", "camera"],
  geolocation: ["location"],
  notifications: ["notifications"],
  "clipboard-read": ["clipboard"],
};
const httpURL = (value) => {
  const url = new URL(value);
  if (!/^https?:$/.test(url.protocol)) throw Error("Open a website first.");
  return url;
};
const download = async (id) => {
  const items = await chrome.downloads.search({ id: Number(id) });
  if (!items.length) throw Error("Download no longer exists.");
  return items[0];
};
const handlers = {
  async ping() {
    return { ok: true };
  },
  async "import-cookie"({ cookie }) {
    const result = await chrome.cookies.set(cookie);
    if (!result) throw Error("Cookie was rejected.");
    return { ok: true };
  },
  async library() {
    const [history, downloads, bookmarks] = await Promise.all([
      chrome.history.search({ text: "", startTime: 0, maxResults: 1000 }),
      chrome.downloads.search({ orderBy: ["-startTime"], limit: 500 }),
      chrome.bookmarks.getTree(),
    ]);
    return {
      history: history.map((h) => ({ ...h, at: h.lastVisitTime })),
      downloads: downloads.map((d) => ({
        id: String(d.id),
        url: d.url,
        name: d.filename.split(/[\\/]/).pop(),
        path: d.filename,
        status:
          d.state === "complete"
            ? "completed"
            : d.state === "in_progress"
              ? "progressing"
              : d.state,
        received: d.bytesReceived,
        total: d.totalBytes,
        paused: d.paused,
        at: Date.parse(d.startTime),
        error: d.error,
      })),
      bookmarks,
    };
  },
  async "download-start"({ url }) {
    return { id: await chrome.downloads.download({ url: httpURL(url).href }) };
  },
  async "download-control"({ id, operation }) {
    const item = await download(id);
    switch (operation) {
      case "pause":
        await chrome.downloads.pause(item.id);
        break;
      case "resume":
        await chrome.downloads.resume(item.id);
        break;
      case "cancel":
        await chrome.downloads.cancel(item.id);
        break;
      case "show":
        await chrome.downloads.show(item.id);
        break;
      case "open":
        await chrome.downloads.open(item.id);
        break;
      case "retry":
        await chrome.downloads.download({ url: httpURL(item.url).href });
        break;
      default:
        throw Error("Unknown download action.");
    }
    return { ok: true };
  },
  async "site-controls"({ url }) {
    const origin = httpURL(url).origin;
    const permissions = await Promise.all(
      Object.entries(permissionTypes).map(async ([permission, types]) => {
        const values = await Promise.all(
          types.map((type) =>
            chrome.contentSettings[type].get({ primaryUrl: origin }),
          ),
        );
        return {
          permission,
          value: values.some((v) => v.setting === "block")
            ? "block"
            : values.every((v) => v.setting === "allow")
              ? "allow"
              : "ask",
        };
      }),
    );
    return { origin, permissions };
  },
  async "site-permission"({ url, permission, value }) {
    const origin = httpURL(url).origin;
    if (
      !permissionTypes[permission] ||
      !["ask", "allow", "block"].includes(value)
    )
      throw Error("Invalid permission.");
    await Promise.all(
      permissionTypes[permission].map((type) =>
        chrome.contentSettings[type].set({
          primaryPattern: origin + "/*",
          setting: value,
        }),
      ),
    );
    return { ok: true };
  },
  async "clear-site-data"({ url }) {
    await chrome.browsingData.remove(
      { origins: [httpURL(url).origin] },
      {
        cookies: true,
        localStorage: true,
        indexedDB: true,
        cacheStorage: true,
        serviceWorkers: true,
      },
    );
    return { ok: true };
  },
  // GitHub sets logged_in=yes for a signed-in session in this profile.
  async "github-signed-in"() {
    const cookie = await chrome.cookies.get({
      url: "https://github.com",
      name: "logged_in",
    });
    return { signedIn: cookie?.value === "yes" };
  },
  async "extensions-list"() {
    return chrome.management.getAll();
  },
  async "extensions-enabled"({ id, enabled }) {
    if (id === chrome.runtime.id)
      throw Error("Wing browser services cannot be disabled.");
    await chrome.management.setEnabled(String(id), !!enabled);
    return { ok: true };
  },
  async "extensions-remove"({ id }) {
    if (id === chrome.runtime.id)
      throw Error("Wing browser services cannot be removed.");
    await chrome.management.uninstall(String(id), { showConfirmDialog: true });
    return { ok: true };
  },
};
Object.defineProperty(window, "wingService", {
  value: async (method, args) => {
    if (!Object.hasOwn(handlers, method))
      throw Error("Unknown browser service.");
    return handlers[method](args || {});
  },
});
const changed = () =>
  window.__wingServicePost?.(
    "wing-service-event",
    JSON.stringify({ type: "library-changed" }),
  );
chrome.downloads.onCreated.addListener(changed);
chrome.downloads.onChanged.addListener(changed);
chrome.downloads.onErased.addListener(changed);
// This page is an implementation detail; keep it out of the user's history.
const forgetSelf = (item) => {
  if (!item || item.url.startsWith(location.origin))
    chrome.history.deleteUrl({ url: item?.url || location.href });
};
chrome.history.onVisited.addListener(forgetSelf);
forgetSelf();
