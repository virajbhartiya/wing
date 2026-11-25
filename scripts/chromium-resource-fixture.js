(async () => {
  window.__wingQualifying = true;
  const invoke = window.wing.invoke;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
  const diagnostics = async () =>
    (await invoke("native-diagnostics")).tabs.filter((tab) =>
      tab.url.startsWith(BASE + "/page-"),
    );
  const waitFor = async (check, message) => {
    const deadline = performance.now() + 15000;
    while (!(await check())) {
      if (performance.now() >= deadline) throw Error(message);
      await sleep(30);
    }
  };
  const waitLoaded = (id) =>
    waitFor(() => {
      const tab = state.tabs.find((entry) => entry.id === id);
      return tab?.title === "Fast fixture" && !tab.loading;
    }, "Fixture page did not load");
  const phases = [];
  const countTabs = async () => {
    const tabs = await diagnostics();
    return {
      saved: state.tabs.length,
      loaded: tabs.filter((tab) => !tab.discarded).length,
      frozen: tabs.filter((tab) => !tab.discarded && tab.frozen).length,
      discarded: tabs.filter((tab) => tab.discarded).length,
    };
  };
  async function measure(name, scroll = null) {
    const before = await countTabs();
    const startMs = Date.now();
    let frameTiming = null;
    if (scroll) {
      scroll.scrollTop = 0;
      const max = scroll.scrollHeight - scroll.clientHeight;
      if (max < 50) throw Error("Sidebar is too short to benchmark scrolling");
      const first = await frame();
      let last = first;
      let distance = 0;
      const gaps = [];
      while (last - first < OPTIONS.sampleMs) {
        const position = (last - first) / OPTIONS.sampleMs;
        scroll.scrollTop = max * (1 - Math.abs(1 - 2 * position));
        distance = Math.max(distance, scroll.scrollTop);
        const next = await frame();
        gaps.push(next - last);
        last = next;
      }
      if (distance < 50) throw Error("Sidebar did not scroll");
      gaps.sort((a, b) => a - b);
      const percentile = (p) => gaps[Math.ceil(p * gaps.length) - 1];
      const lateThresholdMs = OPTIONS.refreshHz ? 1500 / OPTIONS.refreshHz : null;
      frameTiming = {
        callbacksPerSecond: 1000 * gaps.length / (last - first),
        p50Ms: percentile(0.5),
        p95Ms: percentile(0.95),
        p99Ms: percentile(0.99),
        maxMs: gaps.at(-1),
        lateThresholdMs,
        lateCallbacks: lateThresholdMs ? gaps.filter((gap) => gap > lateThresholdMs).length : null,
        callbacks: gaps.length,
        distancePx: distance,
      };
    } else {
      await sleep(OPTIONS.sampleMs);
    }
    const endMs = Date.now();
    phases.push({ name, startMs, endMs, before, after: await countTabs(), frameTiming });
  }
  try {
    const started = performance.now();
    const initial = await invoke("state");
    const ids = initial.tabs.map((tab) => tab.id);
    await waitLoaded(ids[0]);
    const scroller = document.querySelector("#tab-scroll");
    await measure("restored-one");
    if (scroller && scroller.scrollHeight - scroller.clientHeight >= 50)
      await measure("scroll-one-loaded", scroller);
    for (let index = 1; index < ids.length; index++) {
      const id = ids[index];
      await invoke("select-tab", { id });
      await waitLoaded(id);
      if (OPTIONS.checkpoints.includes(index + 1)) await measure(`visited-${index + 1}`);
    }
    if (scroller && scroller.scrollHeight - scroller.clientHeight >= 50)
      await measure("scroll-after-visiting-all", scroller);

    if (OPTIONS.memorySaverCheck) {
      const draft = ids[1];
      const selection = ids[2];
      const current = ids.at(-1);
      for (const [id, selector, value] of [[draft, "input", "unsaved"], [selection, "select", "two"]]) {
        const changed = await invoke("native-evaluate", {
          id,
          script: `const field=document.querySelector(${JSON.stringify(selector)});
            field.value=${JSON.stringify(value)};
            post('result', JSON.stringify(field.value===${JSON.stringify(value)}));`,
        });
        if (changed !== true && changed !== "true")
          throw Error("Fixture field could not be edited");
      }
      const runMaintenance = (idleAdvanceMs) =>
        invoke("native-memory-maintenance", { idleAdvanceMs });
      const future = 6 * 60 * 1000;
      await invoke("settings", { memorySaver: false });
      if ((await runMaintenance(future)).discarded)
        throw Error("Maintenance discarded a page with Memory Saver disabled");
      await invoke("settings", { memorySaver: true });
      const allRecentlyVisited = performance.now() - started < 5 * 60 * 1000;
      if ((await runMaintenance(0)).discarded && allRecentlyVisited)
        throw Error("Maintenance discarded recent tabs");
      for (let i = 0; i < Math.ceil(ids.length / 16); i++) {
        const result = await runMaintenance(future);
        if (!result.discarded) break;
      }
      const maintained = await diagnostics();
      const isLoaded = (id) => maintained.some((tab) => tab.id === id && !tab.discarded);
      if (![draft, selection, current].every(isLoaded))
        throw Error("Maintenance discarded an edited or active page");
      const clean = ids.find((id) => maintained.some((tab) => tab.id === id && tab.discarded));
      if (!clean) throw Error("Maintenance did not discard an old clean page");
      if (maintained.filter((tab) => !tab.discarded).length !== 32)
        throw Error("Maintenance did not reach its 32-tab budget");
      await measure("after-memory-saver");
      await invoke("select-tab", { id: clean });
      await waitFor(async () => (await diagnostics()).some((tab) =>
        tab.id === clean && tab.visible && !tab.discarded), "Discarded page did not reopen");
      await waitLoaded(clean);
    }

    const keep = state.activeTabId;
    await invoke("bulk-tabs", { operation: "close", ids: ids.filter((id) => id !== keep) });
    await waitFor(() => state.tabs.length === 1, "Workspace did not return to one saved tab");
    await waitFor(async () => (await diagnostics()).length === 1, "Native tabs did not close");
    await measure("closed-back-to-one");
    const originalPath = new URL(state.tabs[0].url).pathname;
    const createdPath = "/page-benchmark-new";
    const newTabStart = Date.now();
    await invoke("new-tab", { url: BASE + createdPath });
    await waitLoaded(state.activeTabId);
    await sleep(1000);
    const warmRevealStart = Date.now();
    await invoke("select-tab", { id: keep });
    await sleep(1000);
    const interactions = [
      { name: "new-tab-first-contentful-paint", startMs: newTabStart, beacon: "/paint" + createdPath },
      { name: "warm-reveal-two-frames", startMs: warmRevealStart, beacon: "/reveal" + originalPath },
    ];
    post("result", JSON.stringify({ savedTabs: ids.length, phases, interactions }));
  } catch (error) {
    post("result", JSON.stringify({ error: error.message }));
  }
})();
