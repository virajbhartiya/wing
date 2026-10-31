// Shared interaction rules kept independent from Electron and DOM event handlers.
function sidebarVisible({ hidden, revealed }) {
  return !hidden || Boolean(revealed);
}

function sidebarRevealLeft({ width, progress }) {
  const fraction = Math.max(
    0,
    Math.min(1, Number.isFinite(progress) ? progress : 0),
  );
  return Math.round(8 + (Math.max(8, width) - 8) * fraction);
}
function createSidebarRevealMotion({ initial = 1, duration = 180 } = {}) {
  let from = initial,
    target = initial,
    started = 0,
    span = 0;
  const sample = (time) => {
    const elapsed = span
      ? Math.max(0, Math.min(1, (time - started) / span))
      : 1;
    const eased = 1 - Math.pow(1 - elapsed, 3);
    return { progress: from + (target - from) * eased, active: elapsed < 1 };
  };
  return {
    get target() {
      return target;
    },
    sample,
    start({ to, time, animate = true }) {
      from = sample(time).progress;
      target = Math.max(0, Math.min(1, to));
      started = time;
      span = animate ? duration * Math.abs(target - from) : 0;
      return sample(time);
    },
  };
}

function splitBounds({
  width,
  height,
  left,
  top = 52,
  gap = 8,
  ratio = 0.5,
  orientation = "horizontal",
}) {
  const availableWidth = Math.max(1, Math.round(width - left - gap));
  const availableHeight = Math.max(1, Math.round(height - top - gap));
  const fraction = Math.max(
    0.25,
    Math.min(0.75, Number.isFinite(ratio) ? ratio : 0.5),
  );
  const vertical = orientation === "vertical";
  const extent = (vertical ? availableHeight : availableWidth) - gap;
  const first = Math.max(1, Math.round(extent * fraction));
  const second = Math.max(1, extent - first);
  return vertical
    ? [
        { x: left, y: top, width: availableWidth, height: first },
        {
          x: left,
          y: top + first + gap,
          width: availableWidth,
          height: second,
        },
      ]
    : [
        { x: left, y: top, width: first, height: availableHeight },
        {
          x: left + first + gap,
          y: top,
          width: second,
          height: availableHeight,
        },
      ];
}

function createSwipeTracker({ threshold = 70, gestureWindow = 300 } = {}) {
  let accumulated = 0,
    previousTime = -Infinity,
    committed = false;
  let horizontal = false,
    intentX = 0,
    intentY = 0;
  let committedDirection = 0,
    reversalDistance = 0,
    reversalSamples = 0;
  let reversalStarted = 0,
    reversalLast = -Infinity;
  let last = { direction: 0, progress: 0, phase: "idle", handled: false };
  function reset() {
    accumulated = 0;
    previousTime = -Infinity;
    committed = horizontal = false;
    intentX = intentY = 0;
    committedDirection = reversalDistance = reversalSamples = 0;
    reversalStarted = 0;
    reversalLast = -Infinity;
    last = { direction: 0, progress: 0, phase: "idle", handled: false };
  }
  function update({ deltaX, deltaY, time = Date.now() }) {
    if (![deltaX, deltaY, time].every(Number.isFinite))
      return { ...last, direction: 0, handled: false };
    if (time < previousTime || time - previousTime > gestureWindow) reset();
    previousTime = time;
    // Once horizontal intent is established, ordinary finger jitter must not
    // erase progress. A substantial vertical turn still allows native scrolling.
    const verticalTurn =
      Math.abs(deltaY) > 12 && Math.abs(deltaY) > Math.abs(deltaX) * 2;
    if (committed) {
      const opposite = Math.sign(deltaX) === -committedDirection;
      const deliberate =
        Math.abs(deltaX) >= 8 && Math.abs(deltaX) > Math.abs(deltaY) * 1.1;
      // Trackpads can begin the return stroke before the preceding momentum has
      // gone idle. Require distance AND several sustained opposite samples; a
      // single large bounce or tiny elastic jitter must not unlock the latch.
      if (
        verticalTurn ||
        (deliberate && !opposite) ||
        time - reversalLast > 160
      ) {
        reversalDistance = reversalSamples = 0;
      }
      if (!verticalTurn && deliberate && opposite) {
        if (!reversalSamples) reversalStarted = time;
        reversalLast = time;
        reversalDistance += deltaX;
        reversalSamples++;
        const progress = Math.max(
          -1,
          Math.min(1, reversalDistance / threshold),
        );
        if (
          reversalSamples >= 3 &&
          time - reversalStarted >= 40 &&
          Math.abs(reversalDistance) >= threshold
        ) {
          committedDirection = Math.sign(reversalDistance);
          reversalDistance = reversalSamples = 0;
          return (last = {
            direction: committedDirection,
            progress,
            phase: "committed",
            handled: true,
          });
        }
        return (last = {
          direction: 0,
          progress,
          phase: "tracking",
          handled: true,
        });
      }
      return (last = {
        direction: 0,
        progress: 0,
        phase: "committed",
        handled: !verticalTurn && deltaX !== 0,
      });
    }
    if (verticalTurn) {
      accumulated = intentX = intentY = 0;
      horizontal = false;
      return (last = {
        direction: 0,
        progress: 0,
        phase: "idle",
        handled: false,
      });
    }
    if (!horizontal) {
      intentX += deltaX;
      intentY += deltaY;
      if (Math.max(Math.abs(intentX), Math.abs(intentY)) < 8)
        return (last = {
          direction: 0,
          progress: 0,
          phase: "idle",
          handled: false,
        });
      if (Math.abs(intentX) <= Math.abs(intentY) * 1.1) {
        intentX = intentY = 0;
        return (last = {
          direction: 0,
          progress: 0,
          phase: "idle",
          handled: false,
        });
      }
      horizontal = true;
      accumulated = intentX;
    } else accumulated += deltaX;
    const progress = Math.max(-1, Math.min(1, accumulated / threshold));
    if (Math.abs(accumulated) < threshold)
      return (last = {
        direction: 0,
        progress,
        phase: progress ? "tracking" : "idle",
        handled: true,
      });
    committed = true;
    committedDirection = Math.sign(accumulated);
    return (last = {
      direction: committedDirection,
      progress,
      phase: "committed",
      handled: true,
    });
  }
  return { push: (event) => update(event).direction, update, reset };
}

function nextProfileSpace(spaces, activeSpaceId, direction) {
  const index = spaces.findIndex((space) => space.id === activeSpaceId);
  if (index < 0 || !Number.isFinite(direction) || direction === 0)
    return activeSpaceId;
  const step = Math.sign(direction);
  const profile = spaces[index].profileId;
  for (let offset = 1; offset < spaces.length; offset++) {
    const candidate =
      spaces[(index + step * offset + spaces.length) % spaces.length];
    if (candidate.profileId !== profile) return candidate.id;
  }
  return activeSpaceId;
}

// ⌃N targets the Nth profile. Staying in that profile keeps the current Space.
function spaceForProfile(state, index) {
  const profile = state.profiles[index];
  if (!profile) return null;
  const active = state.spaces.find((s) => s.id === state.activeSpaceId);
  if (active?.profileId === profile.id) return active;
  return state.spaces.find((s) => s.profileId === profile.id) || null;
}

// ⌘1–8 follow the on-screen order; ⌘9 is always the last tab.
function tabForShortcut(tabs, splits, index) {
  const rank = { favorite: 0, pinned: 1, today: 2 };
  const ordered = tabs
    .filter(
      (t) =>
        !t.closed &&
        !(splits || []).some(
          (g) => g.tabIds.includes(t.id) && g.tabIds[0] !== t.id,
        ),
    )
    .map((t, i) => [t, i])
    .sort((a, b) => rank[a[0].kind] - rank[b[0].kind] || a[1] - b[1])
    .map(([t]) => t);
  return index === 8 ? ordered.at(-1) : ordered[index];
}

// New workspaces get this choice in onboarding instead.
function shouldAskDefaultBrowser({ packaged, isDefault, settings }) {
  return (
    !!packaged &&
    !isDefault &&
    settings.onboarded !== false &&
    !settings.defaultBrowserPromptOff
  );
}
module.exports = {
  shouldAskDefaultBrowser,
  spaceForProfile,
  tabForShortcut,
  sidebarVisible,
  sidebarRevealLeft,
  createSidebarRevealMotion,
  splitBounds,
  createSwipeTracker,
  nextProfileSpace,
};
