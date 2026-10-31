"use strict";
const { randomUUID } = require("node:crypto");
const profileOf = (state, tab) =>
  state.spaces.find((space) => space.id === tab?.spaceId)?.profileId;
const groupFor = (state, tabId = state.activeTabId) =>
  (state.splits || []).find((group) => group.tabIds.includes(tabId)) || null;
function members(state, tabId) {
  const ids = groupFor(state, tabId)?.tabIds || [tabId];
  return ids
    .map((id) => state.tabs.find((tab) => tab.id === id))
    .filter(Boolean);
}
function setKind(state, tabId, kind) {
  if (!["today", "pinned", "favorite"].includes(kind))
    throw Error("Unknown tab kind");
  for (const tab of members(state, tabId)) {
    tab.kind = kind;
    tab.homeURL = tab.url;
    if (kind === "favorite" || kind === "today") tab.folderId = null;
  }
}
function normalized(weights) {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  return weights.map((weight) => weight / total);
}
function validate(state) {
  const groups = state.splits || [];
  if (!Array.isArray(groups) || groups.length > 5000)
    throw Error("Invalid split groups");
  const seen = new Set(),
    identities = new Set();
  for (const group of groups) {
    if (
      !group ||
      typeof group.id !== "string" ||
      !/^[\w-]{1,100}$/.test(group.id) ||
      identities.has(group.id) ||
      !Array.isArray(group.tabIds) ||
      group.tabIds.length < 2 ||
      group.tabIds.length > 3 ||
      !["horizontal", "vertical"].includes(group.orientation) ||
      !Array.isArray(group.weights) ||
      (group.title !== undefined &&
        (typeof group.title !== "string" || group.title.length > 200)) ||
      group.weights.length !== group.tabIds.length ||
      group.weights.some((w) => !Number.isFinite(w) || w <= 0) ||
      Math.abs(group.weights.reduce((a, b) => a + b, 0) - 1) > 1e-6
    )
      throw Error("Invalid split group");
    identities.add(group.id);
    const tabs = group.tabIds.map((id) =>
      state.tabs.find((tab) => tab.id === id),
    );
    if (
      tabs.some((tab) => !tab || tab.url === "wing://home") ||
      new Set(tabs.map((tab) => profileOf(state, tab))).size !== 1
    )
      throw Error("Invalid split tabs or profile");
    for (const id of group.tabIds) {
      if (seen.has(id)) throw Error("Tab belongs to multiple split groups");
      seen.add(id);
    }
  }
  return groups.map((group) => ({
    ...group,
    tabIds: [...group.tabIds],
    weights: [...group.weights],
  }));
}
function reconcile(state) {
  state.splits = (state.splits || []).flatMap((group) => {
    const first = state.tabs.find((tab) => tab.id === group.tabIds[0]);
    const retained = group.tabIds
      .map((id, index) => ({
        tab: state.tabs.find((tab) => tab.id === id),
        weight: group.weights[index],
      }))
      .filter(
        ({ tab }) =>
          tab &&
          tab.url !== "wing://home" &&
          profileOf(state, tab) === profileOf(state, first),
      );
    return retained.length < 2
      ? []
      : [
          {
            ...group,
            tabIds: retained.map(({ tab }) => tab.id),
            weights: normalized(retained.map(({ weight }) => weight)),
          },
        ];
  });
}
function removeTab(state, tabId) {
  state.splits = (state.splits || []).flatMap((group) => {
    const indices = group.tabIds
      .map((id, i) => (id === tabId ? -1 : i))
      .filter((i) => i >= 0);
    return indices.length < 2
      ? []
      : [
          {
            ...group,
            tabIds: indices.map((i) => group.tabIds[i]),
            weights: normalized(indices.map((i) => group.weights[i])),
          },
        ];
  });
}
function join(state, targetId, sourceId, orientation) {
  const target = state.tabs.find((tab) => tab.id === targetId),
    source = state.tabs.find((tab) => tab.id === sourceId);
  if (
    !target ||
    !source ||
    target === source ||
    [target, source].some((tab) => tab.url === "wing://home")
  )
    throw Error("Choose two different website tabs");
  if (profileOf(state, target) !== profileOf(state, source))
    throw Error("Split tabs must belong to the same profile");
  reconcile(state);
  let group = groupFor(state, targetId);
  if (group?.tabIds.includes(sourceId)) {
    const previous = [...group.tabIds],
      weights = [...group.weights];
    group.tabIds = [targetId, ...previous.filter((id) => id !== targetId)];
    group.weights = group.tabIds.map((id) => weights[previous.indexOf(id)]);
    if (["horizontal", "vertical"].includes(orientation))
      group.orientation = orientation;
    return group;
  }
  const sourceMembers = members(state, sourceId);
  if ((group?.tabIds.length || 1) + sourceMembers.length > 3)
    throw Error("A split can contain up to three pages");
  for (const member of sourceMembers) removeTab(state, member.id);
  group = groupFor(state, targetId);
  for (const member of sourceMembers) {
    delete member.closed;
    member.kind = target.kind;
    member.spaceId = target.spaceId;
    member.folderId = target.folderId;
  }
  delete target.closed;
  if (group) {
    group.tabIds.push(...sourceMembers.map((tab) => tab.id));
    group.weights = group.tabIds.map(() => 1 / group.tabIds.length);
  } else {
    const tabIds = [targetId, ...sourceMembers.map((tab) => tab.id)];
    group = {
      id: randomUUID(),
      tabIds,
      weights: tabIds.map(() => 1 / tabIds.length),
      orientation: orientation || "horizontal",
    };
    (state.splits ||= []).push(group);
  }
  if (["horizontal", "vertical"].includes(orientation))
    group.orientation = orientation;
  return group;
}
function visibleIds(state, tabId = state.activeTabId) {
  const group = groupFor(state, tabId);
  return (group?.tabIds || [tabId]).filter((id) =>
    state.tabs.some((tab) => tab.id === id && !tab.closed),
  );
}
function resize(state, tabId, divider, fraction) {
  const group = groupFor(state, tabId);
  if (
    !group ||
    !Number.isInteger(divider) ||
    divider < 0 ||
    divider >= group.tabIds.length - 1 ||
    !Number.isFinite(fraction)
  )
    return;
  const before = group.weights.slice(0, divider).reduce((a, b) => a + b, 0),
    pair = group.weights[divider] + group.weights[divider + 1],
    minimum = Math.min(0.15, pair / 3);
  const first = Math.max(minimum, Math.min(pair - minimum, fraction - before));
  group.weights[divider] = first;
  group.weights[divider + 1] = pair - first;
}
// Page area for the current tab position: an inset card on the Space color.
// renderer.js pageFrame() mirrors this.
function frame(settings, sidebarLeft) {
  if (settings.tabLayout === "top")
    return { left: 8, top: settings.toolbarHidden ? 52 : 88, margin: 8 };
  return { left: sidebarLeft, top: settings.toolbarHidden ? 8 : 52, margin: 8 };
}
function bounds({
  width,
  height,
  left,
  top = 52,
  gap = 8,
  margin = gap,
  weights = [0.5, 0.5],
  orientation = "horizontal",
}) {
  const availableWidth = Math.max(1, Math.round(width - left - margin)),
    availableHeight = Math.max(1, Math.round(height - top - margin));
  const vertical = orientation === "vertical",
    extent = Math.max(
      weights.length,
      (vertical ? availableHeight : availableWidth) -
        gap * (weights.length - 1),
    );
  const fractions = normalized(weights);
  let offset = 0,
    used = 0;
  return fractions.map((fraction, index) => {
    const size =
      index === fractions.length - 1
        ? extent - used
        : Math.max(1, Math.round(extent * fraction));
    const result = vertical
      ? { x: left, y: top + offset, width: availableWidth, height: size }
      : { x: left + offset, y: top, width: size, height: availableHeight };
    offset += size + gap;
    used += size;
    return result;
  });
}
module.exports = {
  members,
  setKind,
  groupFor,
  validate,
  reconcile,
  removeTab,
  join,
  visibleIds,
  resize,
  frame,
  bounds,
};
