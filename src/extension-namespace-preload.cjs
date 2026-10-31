const { contextBridge } = require("electron");

// Chromium exposes both browser.* and chrome.*. electron-chrome-extensions 4.9
// augments only chrome.*, so cross-browser extensions otherwise bypass its real
// implementations. This preload runs AFTER the adapter, in extension contexts
// only, and retains native browser-only methods and unrelated namespaces.
if (
  process.type === "service-worker" ||
  location.protocol === "chrome-extension:"
) {
  contextBridge.executeInMainWorld({
    func: () => {
      if (!globalThis.browser || !globalThis.chrome || browser === chrome)
        return;
      const adapted = [
        "action",
        "browserAction",
        "commands",
        "contextMenus",
        "cookies",
        "downloads",
        "extension",
        "i18n",
        "notifications",
        "permissions",
        "privacy",
        "runtime",
        "storage",
        "tabs",
        "topSites",
        "webNavigation",
        "webRequest",
        "windows",
      ];
      for (const name of adapted) {
        if (!chrome[name]) continue;
        const descriptor = Object.getOwnPropertyDescriptor(browser, name);
        if (descriptor && !descriptor.configurable) continue;
        const namespace = Object.create(null, {
          ...Object.getOwnPropertyDescriptors(browser[name] || {}),
          ...Object.getOwnPropertyDescriptors(chrome[name]),
        });
        Object.defineProperty(browser, name, {
          value: namespace,
          enumerable: true,
          configurable: true,
        });
      }
    },
  });
}
