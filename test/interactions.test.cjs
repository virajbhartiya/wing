const test = require("node:test");
const assert = require("node:assert/strict");
const I = require("../src/interactions.cjs");
test("hidden sidebar reveals at the left edge without changing the saved preference", () => {
  const hidden = { hidden: true, revealed: false };
  assert.equal(I.sidebarVisible(hidden), false);
  assert.equal(I.sidebarVisible({ ...hidden, revealed: true }), true);
  assert.equal(hidden.hidden, true);
});
test("both split orientations tile the content and preserve an eight pixel gap", () => {
  for (const orientation of ["horizontal", "vertical"]) {
    const panes = I.splitBounds({
      width: 1200,
      height: 800,
      left: 256,
      top: 52,
      gap: 8,
      ratio: 0.4,
      orientation,
    });
    assert.equal(panes.length, 2);
    const [a, b] = panes;
    if (orientation === "horizontal") {
      assert.equal(b.x, a.x + a.width + 8);
      assert.equal(a.height, b.height);
      assert.equal(b.x + b.width, 1192);
    } else {
      assert.equal(b.y, a.y + a.height + 8);
      assert.equal(a.width, b.width);
      assert.equal(b.y + b.height, 792);
    }
  }
});
test("a swipe selects a different profile and vertical scrolling does not trigger it", () => {
  const tracker = I.createSwipeTracker();
  assert.equal(tracker.push({ deltaX: 3, deltaY: 90, time: 1000 }), 0);
  assert.equal(tracker.push({ deltaX: 80, deltaY: 2, time: 1100 }), 1);
  assert.equal(tracker.push({ deltaX: 80, deltaY: 2, time: 1200 }), 0);
  const spaces = [
    { id: "a", profileId: "p" },
    { id: "b", profileId: "p" },
    { id: "c", profileId: "q" },
  ];
  assert.equal(I.nextProfileSpace(spaces, "a", 1), "c");
});

test("one continuous trackpad gesture switches only once even after cooldown", () => {
  const tracker = I.createSwipeTracker();
  let switches = 0;
  for (let time = 0; time < 1800; time += 30) {
    switches += Math.abs(tracker.push({ deltaX: 20, deltaY: 1, time }));
  }
  assert.equal(
    switches,
    1,
    "momentum must not bounce through multiple profiles",
  );
  assert.equal(
    tracker.push({ deltaX: 80, deltaY: 0, time: 2300 }),
    1,
    "a fresh gesture can switch again",
  );
});

test("swipe progress follows input and reversal before commitment can cancel it", () => {
  const tracker = I.createSwipeTracker();
  assert.equal(
    tracker.update({ deltaX: 35, deltaY: 0, time: 0 }).progress,
    0.5,
  );
  assert.equal(
    tracker.update({ deltaX: -35, deltaY: 0, time: 20 }).progress,
    0,
  );
  assert.equal(
    tracker.update({ deltaX: 0, deltaY: 10, time: 30 }).phase,
    "idle",
  );
  assert.equal(
    tracker.update({ deltaX: 80, deltaY: 0, time: 40 }).direction,
    1,
  );
  assert.equal(
    tracker.update({ deltaX: -100, deltaY: 0, time: 60 }).direction,
    0,
    "reversing momentum cannot commit twice",
  );
});
test("vertical momentum cannot rearm a committed swipe, but a settled new gesture can", () => {
  const tracker = I.createSwipeTracker();
  assert.equal(tracker.push({ deltaX: -80, deltaY: 0, time: 0 }), -1);
  for (let time = 100; time < 2000; time += 100)
    assert.equal(tracker.push({ deltaX: 0, deltaY: 20, time }), 0);
  assert.equal(tracker.push({ deltaX: 100, deltaY: 0, time: 2100 }), 0);
  assert.equal(tracker.push({ deltaX: 100, deltaY: 0, time: 2500 }), 1);
});
test("explicit reset removes feedback and invalid input does not emit a second commit", () => {
  const tracker = I.createSwipeTracker();
  tracker.push({ deltaX: 90, deltaY: 0, time: 0 });
  assert.equal(
    tracker.update({ deltaX: NaN, deltaY: 0, time: 10 }).direction,
    0,
  );
  tracker.reset();
  assert.equal(
    tracker.update({ deltaX: 14, deltaY: 0, time: 20 }).progress,
    0.2,
  );
});

test("sidebar swipe feedback coalesces per frame and momentum produces one profile action", async () => {
  const vm = require("node:vm"),
    fs = require("node:fs");
  const source = fs.readFileSync("src/renderer.js", "utf8");
  for (const reduced of [false, true]) {
    const tracker = I.createSwipeTracker(),
      frames = new Map(),
      timers = new Map(),
      styles = new Map(),
      classes = new Set(),
      calls = [];
    let wheel,
      stateListener,
      time = 0,
      sequence = 0,
      prevented = 0;
    const sidebar = {
      style: { setProperty: (key, value) => styles.set(key, value) },
      classList: {
        add: (...names) => names.forEach((n) => classes.add(n)),
        remove: (...names) => names.forEach((n) => classes.delete(n)),
      },
      addEventListener: (_type, fn) => (wheel = fn),
    };
    const context = {
      window: {
        matchMedia: () => ({ matches: reduced, addEventListener() {} }),
        wing: {
          swipeUpdate: (deltaX, deltaY, time) =>
            tracker.update({ deltaX, deltaY, time }),
          swipeReset: () => tracker.reset(),
          onState: (fn) => (stateListener = fn),
        },
      },
      $: () => sidebar,
      performance: { now: () => time },
      modalType: null,
      dragged: null,
      state: {
        activeSpaceId: "a",
        spaces: [
          { id: "a", profileId: "a" },
          { id: "b", profileId: "b" },
        ],
        settings: { sidebarWidth: 256 },
      },
      requestAnimationFrame: (fn) => {
        const id = ++sequence;
        frames.set(id, fn);
        return id;
      },
      cancelAnimationFrame: (id) => frames.delete(id),
      setTimeout: (fn) => {
        const id = ++sequence;
        timers.set(id, fn);
        return id;
      },
      clearTimeout: (id) => timers.delete(id),
      act: async (name, data) => calls.push({ name, data }),
    };
    context.currentSpace = () =>
      context.state.spaces.find(
        (space) => space.id === context.state.activeSpaceId,
      );
    context.render = () => {};
    vm.createContext(context);
    vm.runInContext(
      source.slice(
        source.indexOf("let profileSwipeFrame ="),
        source.indexOf("function resizer("),
      ),
      context,
    );
    vm.runInContext(
      source.slice(
        source.indexOf("window.wing.onState("),
        source.indexOf("window.wing.onCommand("),
      ),
      context,
    );
    const push = (deltaX, deltaY = 0) => {
      time += 30;
      wheel({
        deltaX,
        deltaY,
        deltaMode: 0,
        ctrlKey: false,
        preventDefault() {
          prevented++;
        },
      });
    };
    push(15);
    push(15);
    assert.equal(frames.size, reduced ? 0 : 1);
    for (const [id, callback] of frames) {
      frames.delete(id);
      callback();
    }
    if (!reduced) assert.match(styles.get("--profile-swipe-offset"), /^-13\.7/);
    for (let i = 0; i < 60; i++) push(20);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].name, "swipe-profile");
    const count = prevented;
    push(0, 40);
    assert.equal(prevented, count, "vertical scrolling must not be prevented");
    await Promise.resolve();
    assert.equal(
      vm.runInContext("profileSwipeDirection", context),
      1,
      "IPC completion must not clear arrival direction before state acknowledgement",
    );
    stateListener({ activeSpaceId: "b" });
    assert.equal(vm.runInContext("profileSwipeDirection", context), 0);
    assert.equal(styles.get("--profile-swipe-offset"), "0px");
    assert.equal(classes.has("profile-swipe-enter"), !reduced);
    push(-24);
    push(-24);
    for (const [id, callback] of frames) {
      frames.delete(id);
      callback();
    }
    push(20); // Returning to original momentum cancels a partial reverse stroke.
    assert.equal(
      styles.get("--profile-swipe-offset"),
      "0px",
      "aborted reversal settles without waiting for idle",
    );
  }
});

test("sidebar reveal computes continuous intermediate geometry and clamps overshoot", () => {
  assert.equal(I.sidebarRevealLeft({ width: 256, progress: 0 }), 8);
  assert.equal(I.sidebarRevealLeft({ width: 256, progress: 0.5 }), 132);
  assert.equal(I.sidebarRevealLeft({ width: 256, progress: 1 }), 256);
  assert.equal(I.sidebarRevealLeft({ width: 256, progress: 2 }), 256);
});
test("hidden sidebar has a real offscreen layout rather than leaving HTML under the native page", () => {
  const css = require("node:fs").readFileSync(
    require("node:path").join(__dirname, "../src/styles.css"),
    "utf8",
  );
  assert.match(
    css,
    /sidebar-hidden[^{}]*#sidebar\s*\{[^}]*transform:/,
    "hiding must move the sidebar offscreen",
  );
});

test("sidebar reveal reverses continuously and reduced motion settles immediately", () => {
  const motion = I.createSidebarRevealMotion({ initial: 0, duration: 180 });
  assert.equal(motion.start({ to: 1, time: 0 }).progress, 0);
  const middle = motion.sample(90);
  assert(middle.progress > 0 && middle.progress < 1);
  assert(middle.active);
  assert.equal(
    motion.start({ to: 0, time: 90 }).progress,
    middle.progress,
    "reversal must start from displayed progress",
  );
  assert(motion.sample(120).progress < middle.progress);
  assert.equal(motion.sample(300).progress, 0);
  assert.deepEqual(motion.start({ to: 1, time: 301, animate: false }), {
    progress: 1,
    active: false,
  });
});
test("sidebar frame handling uses matching split geometry and rejects stale animation frames", () => {
  const vm = require("node:vm"),
    fs = require("node:fs");
  const source = fs.readFileSync("src/renderer.js", "utf8");
  const values = new Map(),
    classes = new Map();
  const sidebar = {},
    edge = {},
    divider = { style: {}, classList: { toggle() {} } };
  const context = {
    state: {
      settings: { sidebarWidth: 256 },
      splitOrientation: "vertical",
      splitRatio: 0.5,
    },
    innerWidth: 1200,
    innerHeight: 800,
    document: {
      documentElement: { style: { setProperty: (k, v) => values.set(k, v) } },
      body: { classList: { toggle: (k, v) => classes.set(k, v) } },
    },
    $: (selector) =>
      ({
        "#sidebar": sidebar,
        "#sidebar-edge": edge,
        "#split-divider": divider,
      })[selector],
  };
  vm.createContext(context);
  vm.runInContext(
    source.slice(
      source.indexOf("let sidebarFrameSequence"),
      source.indexOf("function render()"),
    ),
    context,
  );
  context.applySidebarReveal({
    sequence: 2,
    frame: 10,
    progress: 0.5,
    animating: true,
    hidden: true,
    revealed: true,
  });
  assert.equal(values.get("--sidebar-left"), "132px");
  assert.equal(divider.style.left, "132px");
  assert.equal(divider.style.width, "1060px");
  context.applySidebarReveal({
    sequence: 1,
    frame: 50,
    progress: 0,
    animating: false,
    hidden: true,
    revealed: false,
  });
  context.applySidebarReveal({
    sequence: 2,
    frame: 9,
    progress: 0,
    animating: false,
    hidden: true,
    revealed: false,
  });
  assert.equal(values.get("--sidebar-left"), "132px");
  assert.equal(context.state.sidebarRevealed, true);
  context.applySidebarReveal({
    sequence: 2,
    frame: 11,
    progress: 0,
    animating: false,
    hidden: true,
    revealed: false,
  });
  assert.equal(sidebar.inert, true);
  assert.equal(edge.hidden, false);
  assert.equal(divider.style.left, "8px");
});

test("a horizontally dominant diagonal trackpad gesture switches profiles", () => {
  const tracker = I.createSwipeTracker();
  const actions = [];
  for (let time = 0; time < 120; time += 20)
    actions.push(tracker.push({ deltaX: 18, deltaY: 13, time }));
  assert.equal(
    actions.filter(Boolean).length,
    1,
    "normal diagonal finger travel must not be discarded on every sample",
  );
});
test("horizontal intent survives a small vertical jitter sample", () => {
  const tracker = I.createSwipeTracker();
  assert.equal(tracker.push({ deltaX: 35, deltaY: 1, time: 0 }), 0);
  assert.equal(tracker.push({ deltaX: 1, deltaY: 2, time: 20 }), 0);
  assert.equal(tracker.push({ deltaX: 40, deltaY: 2, time: 40 }), 1);
});

test("a deliberate opposite swipe can return immediately without waiting for momentum idle", () => {
  for (const sign of [1, -1]) {
    const tracker = I.createSwipeTracker();
    assert.equal(tracker.push({ deltaX: sign * 90, deltaY: 2, time: 0 }), sign);
    // A decaying tail must not switch a second time.
    for (let i = 1; i <= 4; i++)
      assert.equal(
        tracker.push({ deltaX: sign * (5 - i), deltaY: 0, time: i * 20 }),
        0,
      );
    // Fresh, deliberate movement in the other direction starts before the
    // 300 ms idle cutoff. Both directions must work symmetrically.
    const directions = [120, 145, 170, 195].map((time) =>
      tracker.push({ deltaX: -sign * 24, deltaY: 3, time }),
    );
    assert.deepEqual(directions.filter(Boolean), [-sign]);
  }
});

test("tiny elastic reversal and isolated large opposite sample do not unlock momentum latch", () => {
  for (const sign of [1, -1]) {
    const tracker = I.createSwipeTracker();
    assert.equal(tracker.push({ deltaX: sign * 90, deltaY: 0, time: 0 }), sign);
    assert.equal(tracker.push({ deltaX: -sign * 100, deltaY: 0, time: 20 }), 0);
    for (let time = 40; time < 800; time += 20)
      assert.equal(tracker.push({ deltaX: -sign * 2, deltaY: 0, time }), 0);
    for (let time = 800; time < 1000; time += 20)
      assert.equal(tracker.push({ deltaX: sign * 20, deltaY: 0, time }), 0);
  }
});
test("three profiles distinguish forward and backward navigation and wrap symmetrically", () => {
  const spaces = [
    { id: "a", profileId: "one" },
    { id: "a2", profileId: "one" },
    { id: "b", profileId: "two" },
    { id: "c", profileId: "three" },
  ];
  assert.equal(I.nextProfileSpace(spaces, "a", 1), "b");
  assert.equal(I.nextProfileSpace(spaces, "a", -1), "c");
  assert.equal(I.nextProfileSpace(spaces, "b", -1), "a2");
  assert.equal(I.nextProfileSpace(spaces, "b", 1), "c");
  assert.equal(I.nextProfileSpace(spaces, "c", 1), "a");
});
test("control-number targets a profile and keeps the current Space inside it", () => {
  const state = {
    activeSpaceId: "b",
    profiles: [{ id: "one" }, { id: "two" }],
    spaces: [
      { id: "a", profileId: "one" },
      { id: "b", profileId: "one" },
      { id: "c", profileId: "two" },
    ],
  };
  assert.equal(I.spaceForProfile(state, 0).id, "b");
  assert.equal(I.spaceForProfile(state, 1).id, "c");
  assert.equal(I.spaceForProfile(state, 2), null);
});
test("command-number follows on-screen tab order and nine means last", () => {
  const tabs = [
    { id: "t1", kind: "today" },
    { id: "f", kind: "favorite" },
    { id: "p", kind: "pinned" },
    { id: "t2", kind: "today" },
    { id: "t3", kind: "today" },
  ];
  const splits = [{ tabIds: ["t2", "t3"] }];
  assert.equal(I.tabForShortcut(tabs, splits, 0).id, "f");
  assert.equal(I.tabForShortcut(tabs, splits, 2).id, "t1");
  assert.equal(I.tabForShortcut(tabs, splits, 8).id, "t2");
  assert.equal(I.tabForShortcut(tabs, splits, 6), undefined);
});
