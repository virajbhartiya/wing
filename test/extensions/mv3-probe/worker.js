chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message.type !== "wing-probe") return;
  Promise.all([
    chrome.storage.local.set({ probe: "persisted" }),
    chrome.tabs.query({}),
  ])
    .then(async ([, tabs]) => {
      const value = await chrome.storage.local.get("probe");
      const peer = await chrome.tabs.create({
        url: new URL("/fixture", sender.url).href,
        splitWithTabId: sender.tab.id,
      });
      const sourceTab = await chrome.tabs.get(sender.tab.id);
      const split =
        peer.splitViewId >= 0 && peer.splitViewId === sourceTab.splitViewId;
      await chrome.tabs.unsplit(peer.splitViewId);
      await chrome.tabs.remove(peer.id);
      reply({
        split,
        worker: true,
        storage: value.probe === "persisted",
        tabs: tabs.length > 0,
        messaging: !!sender.tab,
        extensionId: chrome.runtime.id,
      });
    })
    .catch((error) => reply({ error: error.message }));
  return true;
});
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message.type !== "wing-benchmark") return;
  (async () => {
    const base = new URL(sender.url).origin;
    const samples = [];
    const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const sample = async (phase) => {
      const tabs = await chrome.tabs.query({});
      await fetch(base + "/sample", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phase, tabs: tabs.length }),
      });
    };
    await pause(1000);
    await sample("baseline");
    for (let batch = 0; batch < 6; batch++) {
      const ids = [];
      for (let i = 0; i < 10; i++) {
        const start = performance.now();
        const tab = await chrome.tabs.create({
          url: base + "/fixture",
          active: false,
        });
        ids.push(tab.id);
        samples.push(performance.now() - start);
      }
      await pause(1000);
      await sample("loaded-" + batch);
      await chrome.tabs.remove(ids);
      await pause(1000);
      await sample("closed-" + batch);
    }
    await pause(3000);
    await sample("idle");
    await fetch(base + "/done", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tabCreateLatenciesMs: samples }),
    });
    reply({ ok: true });
  })().catch((error) => reply({ error: error.message }));
  return true;
});
