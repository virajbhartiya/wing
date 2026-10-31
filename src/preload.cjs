const { contextBridge, ipcRenderer } = require("electron");
const theme = require("./themes.cjs");
const swipe = require("./interactions.cjs").createSwipeTracker();
contextBridge.exposeInMainWorld("wing", {
  navigation: {
    calculate: (input) => require("./navigation.cjs").calculate(input),
    rankResults: (query, items) =>
      require("./navigation.cjs").rankResults(query, items),
  },
  theme: {
    fields: theme.COLOR_FIELDS,
    resolve: (space, dark) => theme.resolveColors(space, dark),
  },
  swipeGesture: (deltaX, deltaY, time) => swipe.push({ deltaX, deltaY, time }),
  swipeUpdate: (deltaX, deltaY, time) => swipe.update({ deltaX, deltaY, time }),
  swipeReset: () => swipe.reset(),
  invoke: (action, data = {}) =>
    ipcRenderer.invoke("wing:action", action, data),
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
  },
});

// This bundled preload is attached only to the trusted Wing shell.
require("electron-chrome-extensions/browser-action").injectBrowserAction();
