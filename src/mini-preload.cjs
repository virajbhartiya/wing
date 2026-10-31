const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("mini", {
  run: (name, value) => ipcRenderer.invoke("mini:action", name, value),
  onState: (listener) =>
    ipcRenderer.on("mini:state", (_event, state) => listener(state)),
  onFocusAddress: (listener) =>
    ipcRenderer.on("mini:focus-address", () => listener()),
});
