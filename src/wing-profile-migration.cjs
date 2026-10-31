"use strict";
const M = require("./model.cjs");

// Copy one validated legacy profile into fresh identities. No source identifiers
// or session partitions are reused, including nested folders and split backups.
function appendWingProfile(
  destination,
  saved,
  sourceProfile,
  profile,
  options,
) {
  const source = M.validateState(structuredClone(saved));
  const spaces = source.spaces.filter((s) => s.profileId === sourceProfile);
  if (!spaces.length) throw Error("The Wing source profile has no Spaces.");
  const spaceMap = new Map(spaces.map((s) => [s.id, M.id()]));
  const folders = options.bookmarks
    ? source.folders.filter((f) => spaceMap.has(f.spaceId))
    : [];
  const folderMap = new Map(folders.map((f) => [f.id, M.id()]));
  const selected = (t) =>
    spaceMap.has(t.spaceId) &&
    !t.transient &&
    (t.kind === "today" ? options.tabs : options.bookmarks);
  const tabs = source.tabs.filter(selected);
  const archive = source.archive.filter(selected);
  const tabMap = new Map([...tabs, ...archive].map((t) => [t.id, M.id()]));
  const groupMap = new Map();
  const group = (value) => {
    if (!value || !value.tabIds.every((id) => tabMap.has(id))) return undefined;
    if (!groupMap.has(value.id)) groupMap.set(value.id, M.id());
    return {
      ...value,
      id: groupMap.get(value.id),
      tabIds: value.tabIds.map((id) => tabMap.get(id)),
    };
  };
  const copyTab = (tab) => {
    const value = {
      ...tab,
      id: tabMap.get(tab.id),
      spaceId: spaceMap.get(tab.spaceId),
      folderId: folderMap.get(tab.folderId) || null,
    };
    delete value.splitBackup;
    const backup = group(tab.splitBackup);
    if (backup) value.splitBackup = backup;
    return value;
  };
  const importedSpaces = spaces.map((s) => ({
    ...s,
    id: spaceMap.get(s.id),
    profileId: profile.id,
  }));
  destination.spaces.push(...importedSpaces);
  destination.folders.push(
    ...folders.map((f) => ({
      ...f,
      id: folderMap.get(f.id),
      spaceId: spaceMap.get(f.spaceId),
      parentId: folderMap.get(f.parentId) || null,
    })),
  );
  destination.tabs.push(...tabs.map(copyTab));
  destination.archive.push(...archive.map(copyTab));
  const liveIds = new Set(tabs.map((t) => t.id));
  destination.splits.push(
    ...source.splits
      .filter((s) => s.tabIds.every((id) => liveIds.has(id)))
      .map(group),
  );
  return {
    spaces: importedSpaces,
    tabs: tabs.filter((t) => t.kind === "today").length,
    bookmarks: tabs.filter((t) => t.kind !== "today").length,
    archivedTabs: archive.length,
  };
}
module.exports = { appendWingProfile };
