// All mutations are serialized: concurrent panel events cannot overwrite storage.
import { initialWorkspace, safeURL, restoreURL, discardCandidates } from "./workspace.js";
import {captureSession, checkpoint, exportWorkspace, importWorkspace, restoreSession} from './recovery.mjs';
const home = chrome.runtime.getURL('home.html');
let booted = false;
let closingWindow = false;
let queue = Promise.resolve();
const normalTabs = async () => (await chrome.tabs.query({})).filter(t => !t.incognito);
async function read() {
  const {workspace} = await chrome.storage.local.get('workspace');
  const state = workspace || initialWorkspace();
  if (!booted) {
    const {runStarted} = await chrome.storage.session.get('runStarted');
    if (!runStarted) {
      // Preserve recovery before startup-created tabs can replace the old session.
      state.startupRecovery = state.lastSession || state.startupRecovery;
      state.restoredSessionIds = [];
      state.assignments = {};
      await chrome.storage.local.set({workspace:state});
      await chrome.storage.session.set({runStarted:Date.now()});
    }
    booted = true;
  }
  return state;
}
function record(state,tabs) {
  if (!closingWindow) checkpoint(state,captureSession(state,tabs,home));
}
async function reconcile(state) {
  const tabs = await normalTabs();
  const ids = new Set(tabs.map((t) => String(t.id)));
  for (const id of Object.keys(state.assignments))
    if (!ids.has(id)) delete state.assignments[id];
  for (const tab of tabs) {
    if (!state.assignments[tab.id])
      state.assignments[tab.id] = state.activeSpace;
  }
  return tabs;
}
// Recovery is fetched explicitly; avoid cloning thousands of saved tab records
// across the extension boundary for every sidebar interaction.
function publicState(state, tabs) {
  const {lastSession, startupRecovery, recoveryHistory, lastTabs,
    restoredSessionIds, ...visible} = state;
  return {...visible, tabs};
}
async function snapshot() {
  const state = await read();
  const tabs = await reconcile(state);
  record(state,tabs);
  state.lastTabs = tabs.map((t) => ({
    id: t.id,
    url: t.url,
    spaceId: state.assignments[t.id],
  }));
  await chrome.storage.local.set({ workspace: state });
  return publicState(state, tabs);
}
async function dispatch(message) {
  const state = await read();
  const tabs = await reconcile(state);
  const { action, data = {} } = message;
  if (action === "state") return publicState(state, tabs);
  if (action === 'export') return exportWorkspace(state);
  if (action === 'recovery') return {snapshots:[state.startupRecovery,state.lastSession,...(state.recoveryHistory||[])].filter((x,i,a)=>x&&a.findIndex(s=>s?.id===x.id)===i)};
  if (action === 'import') {
    const imported=importWorkspace(data.backup,home);
    await chrome.storage.local.set({beforeImport:exportWorkspace(state),workspace:imported});
    return publicState(imported, tabs);
  }
  if (action === 'restore-session') {
    const saved=[state.startupRecovery,state.lastSession,...(state.recoveryHistory||[])].find(x=>x?.id===data.id);
    if (!saved) throw Error('Recovery snapshot no longer exists');
    await restoreSession(chrome,state,saved,home,s=>chrome.storage.local.set({workspace:s}));
  }
  if (action !== "trim") closingWindow = false;
  if (action === "space") {
    if (!state.spaces.some((s) => s.id === data.id))
      throw Error("Unknown Space");
    state.activeSpace = data.id;
    const tab = tabs
      .filter((t) => state.assignments[t.id] === data.id)
      .sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
    if (tab) {
      await chrome.tabs.update(tab.id, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true });
    }
  }
  if (action === "add-space") {
    const space = {
      id: crypto.randomUUID(),
      name: String(data.name || "New Space")
        .trim()
        .slice(0, 50),
      color: ["lavender", "sage", "peach", "ocean"].includes(data.color)
        ? data.color
        : "lavender",
    };
    state.spaces.push(space);
    state.activeSpace = space.id;
  }
  if (action === "delete-space") {
    if (state.spaces.length < 2) throw Error("Keep at least one Space");
    state.spaces = state.spaces.filter((s) => s.id !== data.id);
    if (state.activeSpace === data.id) state.activeSpace = state.spaces[0].id;
    for (const id of Object.keys(state.assignments))
      if (state.assignments[id] === data.id)
        state.assignments[id] = state.activeSpace;
    // Saved tabs must reference a surviving Space too, or a later recovery
    // would reject the entire snapshot during validation.
    for (const snapshot of [state.lastSession, state.startupRecovery,
      ...(state.recoveryHistory || [])]) {
      for (const window of snapshot?.windows || []) {
        for (const tab of window.tabs) {
          if (tab.spaceId === data.id) tab.spaceId = state.activeSpace;
        }
      }
    }
    for (const tab of state.archive) {
      if (tab.spaceId === data.id) tab.spaceId = state.activeSpace;
    }
  }
  if (action === "new-tab") {
    const tab = await chrome.tabs.create({ url: safeURL(data.url) });
    state.assignments[tab.id] = state.activeSpace;
  }
  if (action === "activate") {
    const tab = tabs.find((t) => t.id === data.id);
    if (tab) {
      await chrome.tabs.update(tab.id, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true });
    }
  }
  if (action === "split") {
    const source = tabs.find((t) => t.id === data.id);
    if (!source) throw Error("This tab is no longer open");
    if (source.splitViewId != null && source.splitViewId !== -1) {
      await chrome.tabs.unsplit(source.splitViewId);
    } else {
      const created = await chrome.tabs.create({
        splitWithTabId: source.id,
        url: chrome.runtime.getURL("home.html"),
      });
      state.assignments[created.id] = state.assignments[source.id];
    }
  }
  if (action === "pin") {
    const tab = tabs.find((t) => t.id === data.id);
    if (tab) await chrome.tabs.update(tab.id, { pinned: !tab.pinned });
  }
  if (action === "move") {
    if (
      state.spaces.some((s) => s.id === data.spaceId) &&
      tabs.some((t) => t.id === data.id)
    )
      state.assignments[data.id] = data.spaceId;
  }
  if (action === "archive") {
    const tab = tabs.find((t) => t.id === data.id);
    if (tab) {
      state.archive.unshift({
        id: crypto.randomUUID(),
        title: tab.title,
        url: tab.url,
        spaceId: state.assignments[tab.id],
        at: Date.now(),
      });
      state.archive = state.archive.slice(0, 500);
      // Commit the recovery path before destroying the live tab. Quota or disk
      // failures leave the original open; a close failure leaves a safe copy.
      record(state, tabs);
      await chrome.storage.local.set({workspace: state});
      await chrome.tabs.remove(tab.id);
    }
  }
  if (action === "restore") {
    const tab = state.archive.find((t) => t.id === data.id);
    if (tab) {
      const live = await chrome.tabs.create({
        url: restoreURL(tab.url, chrome.runtime.getURL("home.html")),
      });
      state.assignments[live.id] = state.spaces.some(
        (s) => s.id === tab.spaceId,
      )
        ? tab.spaceId
        : state.activeSpace;
      state.archive = state.archive.filter((t) => t.id !== data.id);
    }
  }
  if (action === "trim") {
    // Chromium makes the final discard-safety decision (forms, capture, etc.).
    for (const tab of discardCandidates(tabs.filter(t=>!t.incognito), state.budget))
      await chrome.tabs.discard(tab.id).catch(() => {});
  }
  if (action === "settings") {
    if ([4, 8, 16].includes(data.budget)) state.budget = data.budget;
    if (typeof data.dark === "boolean") state.dark = data.dark;
  }
  if (action === "group") {
    const ids = tabs
      .filter((t) => state.assignments[t.id] === state.activeSpace && !t.pinned)
      .map((t) => t.id);
    const windows = [
      ...new Set(tabs.filter((t) => ids.includes(t.id)).map((t) => t.windowId)),
    ];
    for (const windowId of windows) {
      const groupId = await chrome.tabs.group({
        tabIds: tabs
          .filter((t) => t.windowId === windowId && ids.includes(t.id))
          .map((t) => t.id),
      });
      await chrome.tabGroups.update(groupId, {
        title: state.spaces.find((s) => s.id === state.activeSpace).name,
        color: "purple",
      });
    }
  }
  const finalTabs = await normalTabs();
  record(state,finalTabs);
  state.lastTabs = finalTabs.map((t) => ({
    id: t.id,
    url: t.url,
    spaceId: state.assignments[t.id],
  }));
  await chrome.storage.local.set({ workspace: state });
  return publicState(state, finalTabs);
}
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (
    sender.id !== chrome.runtime.id ||
    !sender.url?.startsWith(chrome.runtime.getURL(""))
  )
    return;
  const task = queue.then(() => dispatch(message));
  queue = task.catch(() => {});
  task.then(reply, (error) => reply({ error: error.message }));
  return true;
});
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  chrome.alarms.create("memory", { periodInMinutes: 2 });
  queue = queue.then(snapshot).catch(console.error);
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "memory") {
    queue = queue.then(() => dispatch({ action: "trim" })).catch(console.error);
  }
});
chrome.tabs.onRemoved.addListener((_id,info) => {
  if(info.isWindowClosing){closingWindow=true;clearTimeout(navigationSave);return;}
  queue=queue.then(snapshot).catch(console.error);
});
chrome.tabs.onCreated.addListener(()=>{
  closingWindow=false;
  queue=queue.then(snapshot).catch(console.error);
});
chrome.runtime.onStartup.addListener(()=>{
  chrome.alarms.create('memory',{periodInMinutes:2});
  chrome.sidePanel.setPanelBehavior({openPanelOnActionClick:true});
  queue=queue.then(read).catch(console.error);
});
let navigationSave;
chrome.tabs.onUpdated.addListener((_id,change)=>{
 if(change.url||change.pinned!==undefined){
  clearTimeout(navigationSave);
  navigationSave=setTimeout(()=>{queue=queue.then(snapshot).catch(console.error)},500);
 }
});
