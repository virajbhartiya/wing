"use strict";
const crypto = require("node:crypto");
function folderDescendants(state, id) {
  const found = new Set([id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const f of state.folders)
      if (found.has(f.parentId) && !found.has(f.id)) {
        found.add(f.id);
        changed = true;
      }
  }
  return found;
}
function saveFolder(state, data) {
  const name = String(data.name || "")
    .trim()
    .slice(0, 80);
  if (!name) throw Error("Enter a folder name.");
  const old = state.folders.find((f) => f.id === data.id);
  const spaceId = old?.spaceId || state.activeSpaceId;
  const parentId = data.parentId || null;
  if (
    parentId &&
    !state.folders.some((f) => f.id === parentId && f.spaceId === spaceId)
  )
    throw Error("Choose a folder in this Space.");
  if (old && folderDescendants(state, old.id).has(parentId))
    throw Error("A folder cannot contain itself.");
  if (old) Object.assign(old, { name, parentId });
  else
    state.folders.push({
      id: crypto.randomUUID(),
      spaceId,
      name,
      parentId,
      collapsed: false,
    });
}
function removeFolder(state, id) {
  const ids = folderDescendants(state, id);
  state.tabs.forEach((t) => {
    if (ids.has(t.folderId)) t.folderId = null;
  });
  state.folders = state.folders.filter((f) => !ids.has(f.id));
}
// Organizational undo deliberately excludes history, passwords, site styles and
// settings. Restoring a folder must never roll back an unrelated visited URL.
class OrganizationJournal {
  constructor(limit = 30) {
    this.limit = limit;
    this.undoStack = [];
    this.redoStack = [];
  }
  capture(state) {
    return {
      folders: structuredClone(state.folders),
      splitTitles: (state.splits || []).map((group) => ({
        id: group.id,
        title: group.title,
      })),
      tabs: state.tabs.map((t) => ({
        id: t.id,
        kind: t.kind,
        folderId: t.folderId,
        spaceId: t.spaceId,
        customTitle: t.customTitle,
        customIcon: t.customIcon,
        homeURL: t.homeURL,
        title: t.title,
      })),
    };
  }
  record(state) {
    this.undoStack.push(this.capture(state));
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
  }
  apply(state, snapshot) {
    state.folders = snapshot.folders.filter((f) =>
      state.spaces.some((s) => s.id === f.spaceId),
    );
    const order = new Map(snapshot.tabs.map((t, i) => [t.id, i]));
    for (const saved of snapshot.tabs) {
      const tab = state.tabs.find((t) => t.id === saved.id);
      if (tab && state.spaces.some((s) => s.id === saved.spaceId)) {
        const { title, ...organization } = saved;
        // Only replace the displayed title when undo changes a custom name.
        // An unrelated navigation's latest page title must survive undo.
        if (tab.customTitle !== saved.customTitle)
          tab.title = saved.customTitle || title;
        Object.assign(tab, organization);
      }
    }
    for (const saved of snapshot.splitTitles) {
      const group = (state.splits || []).find((group) => group.id === saved.id);
      if (group) group.title = saved.title;
    }
    state.tabs.sort(
      (a, b) => (order.get(a.id) ?? 1e6) - (order.get(b.id) ?? 1e6),
    );
  }
  undo(state) {
    const s = this.undoStack.pop();
    if (!s) return false;
    this.redoStack.push(this.capture(state));
    this.apply(state, s);
    return true;
  }
  redo(state) {
    const s = this.redoStack.pop();
    if (!s) return false;
    this.undoStack.push(this.capture(state));
    this.apply(state, s);
    return true;
  }
}
module.exports = {
  folderDescendants,
  saveFolder,
  removeFolder,
  OrganizationJournal,
};
