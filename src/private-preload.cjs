const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("privateWing", {
  run: (name, value) => ipcRenderer.invoke("private:action", name, value),
  onState: (listener) =>
    ipcRenderer.on("private:state", (_event, state) => listener(state)),
  onFocusAddress: (listener) =>
    ipcRenderer.on("private:focus-address", () => listener()),
});
