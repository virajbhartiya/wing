"use strict";

function profileOf(state) {
  return state.spaces.find((space) => space.id === state.activeSpaceId)
    ?.profileId;
}

function orderedTabs(state) {
  const profile = profileOf(state);
  if (!profile) return [];
  const spaces = new Set(
    state.spaces
      .filter((space) => space.profileId === profile)
      .map((space) => space.id),
  );
  return state.tabs
    .filter((tab) => spaces.has(tab.spaceId) && !tab.closed)
    .sort((a, b) => {
      if (a.id === state.activeTabId) return -1;
      if (b.id === state.activeTabId) return 1;
      return (b.lastActive || 0) - (a.lastActive || 0);
    });
}

// Preview never changes tab activity. A gesture owns its ordering until Control
// is released, even if a background title update or pointer event arrives.
class TabSwitcher {
  constructor() {
    this.reset();
  }
  reset() {
    this.ids = [];
    this.index = 0;
    this.origin = null;
    this.profile = null;
  }
  get active() {
    return this.profile !== null && this.ids.length > 0;
  }
  reconcile(state) {
    if (this.profile !== profileOf(state)) {
      this.reset();
      return false;
    }
    const live = new Set(orderedTabs(state).map((tab) => tab.id));
    const selected = this.ids[this.index];
    this.ids = this.ids.filter((id) => live.has(id));
    const index = this.ids.indexOf(selected);
    this.index = index < 0 ? Math.min(this.index, this.ids.length - 1) : index;
    return this.ids.length > 0;
  }
  snapshot(state) {
    if (!this.reconcile(state)) return null;
    return {
      ids: [...this.ids],
      selectedId: this.ids[this.index],
      originId: this.origin,
    };
  }
  step(state, direction) {
    if (!this.active) {
      this.ids = orderedTabs(state).map((tab) => tab.id);
      this.origin = state.activeTabId;
      this.profile = profileOf(state);
      this.index = 0;
      if (this.ids.length < 2) {
        this.reset();
        return null;
      }
    } else if (!this.reconcile(state)) return null;
    this.index =
      (this.index + (direction < 0 ? -1 : 1) + this.ids.length) %
      this.ids.length;
    return this.snapshot(state);
  }
  select(state, id) {
    if (!this.reconcile(state)) return false;
    const index = this.ids.indexOf(id);
    if (index < 0) return false;
    this.index = index;
    return true;
  }
  commit(state) {
    const selected = this.snapshot(state)?.selectedId || null;
    this.reset();
    return selected;
  }
  cancel() {
    const origin = this.origin;
    this.reset();
    return origin;
  }
}

module.exports = { orderedTabs, TabSwitcher };
