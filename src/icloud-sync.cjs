// Layout sync between Macs through one small file in iCloud Drive: Spaces,
// folders, pinned tabs and Favorites. History, open tabs, passwords and
// profiles never leave the Mac.
//
// Each Mac remembers the layout it last agreed with ("base"). Merging is
// three-way against it, so additions and removals made on either Mac survive.
const M = require("./model.cjs");

const KINDS = new Set(["pinned", "favorite"]);
const itemKey = (tab) => `${tab.spaceId}|${tab.kind}|${tab.homeURL || tab.url}`;

function layoutOf(state) {
  return {
    spaces: state.spaces
      .filter((s) => !s.throwaway)
      .map((s) => ({
        id: s.id,
        name: s.name,
        icon: s.icon,
        theme: s.theme,
        ...(s.colors ? { colors: s.colors } : {}),
        profile:
          state.profiles.find((p) => p.id === s.profileId)?.name || "Personal",
      })),
    folders: state.folders.map((f) => ({
      id: f.id,
      name: f.name,
      spaceId: f.spaceId,
      parentId: f.parentId ?? null,
    })),
    items: state.tabs
      .filter((t) => KINDS.has(t.kind) && !t.transient)
      .map((t) => ({
        key: itemKey(t),
        spaceId: t.spaceId,
        kind: t.kind,
        url: t.homeURL || t.url,
        title: t.title,
        folderId: t.folderId ?? null,
      })),
  };
}

function fingerprint(layout) {
  return JSON.stringify(layout || null);
}

function validLayout(value) {
  const text = (v, max) => typeof v === "string" && v.length > 0 && v.length <= max;
  const ident = (v) => text(v, 100) && /^[\w-]+$/.test(v);
  if (!value || typeof value !== "object") return false;
  for (const key of ["spaces", "folders", "items"])
    if (!Array.isArray(value[key]) || value[key].length > 5000) return false;
  return (
    value.spaces.every(
      (s) =>
        ident(s.id) && text(s.name, 100) && text(s.icon, 10) &&
        M.themes.includes(s.theme) && text(s.profile, 100),
    ) &&
    value.folders.every(
      (f) =>
        ident(f.id) && text(f.name, 100) && ident(f.spaceId) &&
        (f.parentId === null || ident(f.parentId)),
    ) &&
    value.items.every((i) => {
      try {
        return (
          ident(i.spaceId) && KINDS.has(i.kind) && text(i.title, 300) &&
          text(i.url, 20000) && M.normalizeURL(i.url) === i.url &&
          (i.folderId === null || ident(i.folderId)) &&
          i.key === `${i.spaceId}|${i.kind}|${i.url}`
        );
      } catch {
        return false;
      }
    })
  );
}

// The first time two Macs meet, Spaces and folders with the same name are the
// same thing: adopt the remote ids so the merge pairs them instead of doubling.
function adopt(state, remote) {
  const taken = new Set();
  const renameSpace = (from, to) => {
    for (const s of state.spaces) if (s.id === from) s.id = to;
    for (const t of [...state.tabs, ...state.archive])
      if (t.spaceId === from) t.spaceId = to;
    for (const f of state.folders) if (f.spaceId === from) f.spaceId = to;
    for (const h of state.history || []) if (h.spaceId === from) h.spaceId = to;
    for (const r of state.settings.routes || [])
      if (r.spaceId === from) r.spaceId = to;
    if (state.activeSpaceId === from) state.activeSpaceId = to;
    if (state.settings.defaultSpaceId === from) state.settings.defaultSpaceId = to;
  };
  for (const r of remote.spaces) {
    if (state.spaces.some((s) => s.id === r.id)) {
      taken.add(r.id);
      continue;
    }
    const local = state.spaces.find(
      (s) => !taken.has(s.id) && !s.throwaway &&
        s.name.toLowerCase() === r.name.toLowerCase() &&
        !remote.spaces.some((x) => x.id === s.id),
    );
    if (!local) continue;
    renameSpace(local.id, r.id);
    taken.add(r.id);
  }
  for (const r of remote.folders) {
    if (state.folders.some((f) => f.id === r.id)) continue;
    const local = state.folders.find(
      (f) => f.spaceId === r.spaceId && f.name === r.name &&
        !remote.folders.some((x) => x.id === f.id),
    );
    if (!local) continue;
    for (const f of state.folders) if (f.parentId === local.id) f.parentId = r.id;
    for (const t of state.tabs) if (t.folderId === local.id) t.folderId = r.id;
    local.id = r.id;
  }
}

// Three-way merge of one list, by identity: what the other Mac changed since
// base wins, local changes stay, and a removal on either side removes.
function mergeList(local, remote, base, keyOf) {
  const L = new Map(local.map((x) => [keyOf(x), x]));
  const R = new Map(remote.map((x) => [keyOf(x), x]));
  const B = new Map((base || []).map((x) => [keyOf(x), x]));
  const out = new Map();
  for (const [key, r] of R) {
    const l = L.get(key), b = B.get(key);
    if (l) out.set(key, b && fingerprint(r) === fingerprint(b) ? l : r);
    else if (!b) out.set(key, r); // added there
  }
  for (const [key, l] of L)
    if (!R.has(key) && !B.has(key)) out.set(key, l); // added here
  return out;
}

// Applies the remote layout to state. Returns true when anything changed.
function merge(state, remote, base) {
  if (!validLayout(remote)) return false;
  const before = fingerprint(layoutOf(state));
  if (!base || !validLayout(base)) adopt(state, remote);
  const local = layoutOf(state);

  // Spaces: added or renamed there show up here; removing a Space never syncs,
  // since that would close its open tabs.
  const spaces = mergeList(local.spaces, remote.spaces, base?.spaces, (s) => s.id);
  for (const [id, s] of spaces) {
    const existing = state.spaces.find((x) => x.id === id);
    const fields = {
      name: s.name,
      icon: s.icon,
      theme: s.theme,
      ...(s.colors ? { colors: M.normalizeCustomColors(s.colors) } : {}),
    };
    if (existing) {
      Object.assign(existing, fields);
      if (!s.colors) delete existing.colors;
      continue;
    }
    const profile =
      state.profiles.find((p) => p.name === s.profile) ||
      state.profiles.find((p) => p.id === state.spaces[0]?.profileId) ||
      state.profiles[0];
    state.spaces.push({ id, ...fields, profileId: profile.id });
  }
  const spaceIds = new Set(state.spaces.map((s) => s.id));

  const folders = mergeList(local.folders, remote.folders, base?.folders, (f) => f.id);
  const keptFolders = state.folders.filter((f) => folders.has(f.id) || !spaceIds.has(f.spaceId));
  for (const [id, f] of folders) {
    if (!spaceIds.has(f.spaceId)) continue;
    const existing = keptFolders.find((x) => x.id === id);
    if (existing) Object.assign(existing, { name: f.name, parentId: f.parentId });
    else keptFolders.push({ id, name: f.name, spaceId: f.spaceId, parentId: f.parentId });
  }
  const folderIds = new Set(keptFolders.map((f) => f.id));
  for (const f of keptFolders)
    if (f.parentId !== null && f.parentId !== undefined && !folderIds.has(f.parentId))
      f.parentId = null;
  state.folders = keptFolders;

  const items = mergeList(local.items, remote.items, base?.items, (i) => i.key);
  const order = new Map(remote.items.map((i, index) => [i.key, index]));
  const synced = [];
  for (const tab of [...state.tabs]) {
    if (!KINDS.has(tab.kind) || tab.transient) continue;
    const item = items.get(itemKey(tab));
    if (!item) {
      // Removed on the other Mac. The page in front stays as an ordinary tab,
      // so nothing the user is reading disappears.
      if (tab.id === state.activeTabId) {
        tab.kind = "today";
        tab.folderId = null;
      } else state.tabs = state.tabs.filter((t) => t !== tab);
      continue;
    }
    tab.title = item.title;
    tab.folderId = item.folderId && folderIds.has(item.folderId) ? item.folderId : null;
    items.delete(itemKey(tab));
    synced.push(tab);
  }
  for (const item of items.values()) {
    if (!spaceIds.has(item.spaceId)) continue;
    const tab = M.newTab(item.spaceId, item.url, {
      kind: item.kind,
      title: item.title,
      folderId: item.folderId && folderIds.has(item.folderId) ? item.folderId : null,
    });
    state.tabs.push(tab);
    synced.push(tab);
  }
  // Follow the other Mac's order for pinned tabs and Favorites both Macs have.
  const rank = new Map();
  let last = -1;
  for (const tab of synced) {
    const index = order.get(itemKey(tab));
    last = index ?? last + 0.001;
    rank.set(tab, last);
  }
  const slots = [];
  state.tabs.forEach((tab, index) => {
    if (synced.includes(tab)) slots.push(index);
  });
  const sorted = [...synced].sort((a, b) => rank.get(a) - rank.get(b));
  slots.forEach((slot, i) => (state.tabs[slot] = sorted[i]));

  return fingerprint(layoutOf(state)) !== before;
}

module.exports = { layoutOf, fingerprint, merge, validLayout };
