const assert = require("node:assert/strict");
const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs");
const { once } = require("node:events");
const { webContents } = require("electron");
module.exports = async function engineTest(api) {
  let receiveExtension;
  const extensionProof = new Promise((resolve) => (receiveExtension = resolve));
  const server = http.createServer((req, res) => {
    if (req.url === "/report") {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        receiveExtension(JSON.parse(body));
        res.end("ok");
      });
      return;
    }
    res.setHeader("Content-Type", "text/html");
    res.end(
      `<!doctype html><title>Fixture ${req.url}</title><h1>Wing engine fixture</h1><a href="/second">Second</a>`,
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  const waitLoad = async (wc) => {
    if (wc.isLoading()) await once(wc, "did-stop-loading");
  };
  const checks = [];
  try {
    if (process.env.WING_FEATURES_TEST === "1") {
      await require("./features-engine-test.cjs")(api, base);
      assert.deepEqual(api.getShellErrors(), []);
      console.log("Settings, nested folders and native geometry qualification passed");
      return;
    }
    if (process.env.WING_RECENT_TABS_TEST === "1") {
      await require("./recent-tabs-engine-test.cjs")(api, base);
      assert.deepEqual(api.getShellErrors(), []);
      console.log("Recent tabs native input and overlay qualification passed");
      return;
    }
    const baseline = webContents.getAllWebContents().length;
    const installed = await api.extensionManager.install(
      "default",
      path.resolve("test/extensions/electron-probe"),
    );
    const extensionTab = api.openTab(base + "/");
    const proof = await Promise.race([
      extensionProof,
      new Promise((_, reject) =>
        setTimeout(
          () => reject(Error("Extension integration timed out")),
          20000,
        ),
      ),
    ]);
    for (const key of [
      "worker",
      "messaging",
      "storage",
      "tabs",
      "createRemoveTab",
      "commandsNamespace",
      "browserCreateRemoveTab",
      "dynamicDNR",
      "contentScript",
      "staticDNR",
      "dynamicDNRBlocked",
    ])
      assert.equal(
        proof[key],
        true,
        `Extension ${key}: ${JSON.stringify(proof)}`,
      );
    assert.equal(
      api.getState().tabs.filter((t) => t.url === base + "/peer").length,
      0,
      "Extension-created tab is removed from Wing model",
    );
    assert.equal(
      api.extensionManager.list("work").extensions.length,
      0,
      "Other profile cannot enumerate installed extension",
    );
    fs.writeFileSync(
      path.resolve("docs/extensions-electron-wing.json"),
      JSON.stringify(
        { engine: process.versions, at: new Date().toISOString(), ...proof },
        null,
        2,
      ),
    );
    await api.action("close-tab", { id: extensionTab.id });
    await api.extensionManager.uninstall("default", installed.extensions[0].id);
    checks.push(
      "MV3 worker/storage/messages/content/DNR and extension-driven tab creation/removal run through the production Wing adapter; profiles isolated",
    );

    const first = api.openTab(base + "/first");
    let view = api.views.get(first.id);
    await waitLoad(view.webContents);
    assert.equal(view.webContents.getURL(), base + "/first");
    const prefs = view.webContents.getLastWebPreferences();
    assert.equal(prefs.sandbox, true);
    assert.equal(prefs.nodeIntegration, false);
    assert.equal(prefs.contextIsolation, true);
    assert.ok(!prefs.preload);
    checks.push(
      "real HTTP navigation in sandboxed Chromium without a privileged preload",
    );
    await api.action("navigate", { url: base + "/second" });
    await waitLoad(view.webContents);
    assert.equal(view.webContents.navigationHistory.canGoBack(), true);
    await api.action("back");
    await waitLoad(view.webContents);
    assert.equal(view.webContents.getURL(), base + "/first");
    checks.push("back navigation preserves page history");
    const p = api.sessionFor("engine-a"),
      q = api.sessionFor("engine-b");
    await p.cookies.set({ url: base, name: "isolation", value: "a" });
    assert.equal(
      (await q.cookies.get({ url: base, name: "isolation" })).length,
      0,
    );
    assert.equal(
      (await p.cookies.get({ url: base, name: "isolation" }))[0].value,
      "a",
    );
    checks.push("profile cookie partitions are isolated");
    await api.action("settings", { maxLiveTabs: 4 });
    for (let n = 0; n < 12; n++) {
      const t = api.openTab(base + "/tab-" + n);
      await waitLoad(api.views.get(t.id).webContents);
      api.trimMemory();
    }
    assert.ok(
      api.views.size <= 4,
      `Expected <=4 live views, got ${api.views.size}`,
    );
    checks.push("actual browser caps 13 visited documents at four live views");
    assert.equal(api.views.has(first.id), false);
    await api.action("select-tab", { id: first.id });
    view = api.views.get(first.id);
    await waitLoad(view.webContents);
    assert.equal(view.webContents.getURL(), base + "/first");
    assert.ok(view.webContents.navigationHistory.canGoForward());
    checks.push("sleeping tab restores its URL and navigation history");
    const second = api.openTab(base + "/split");
    await waitLoad(api.views.get(second.id).webContents);
    await api.action("split", { id: first.id });
    api.trimMemory();
    assert.ok(api.views.has(first.id) && api.views.has(second.id));
    checks.push("both split panes survive memory cleanup");
    const originalBounds = api.testWindow.getBounds();
    // Offscreen/occluded native windows may legitimately use the production
    // fallback. Pixel qualification requires a window the compositor can paint.
    api.testWindow.show();
    api.testWindow.focus();
    await new Promise((resolve) => setTimeout(resolve, 500));
    let backdrop;
    // A busy compositor may miss the production's short capture deadline even
    // after show(). Retry the entire handoff, retaining the pixel requirement.
    for (let attempt = 0; attempt < 5; attempt++) {
      backdrop = await api.action("overlay", { open: true });
      if (backdrop.frames.length === 2 && backdrop.frames.every(frame => typeof frame.image === "string")) break;
      await api.action("overlay", {open:false});
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    assert(backdrop.frames.every(frame => typeof frame.image === "string"),
      "Both visible panes must produce pixels within five capture attempts");
    assert.equal(
      backdrop.frames.length,
      2,
      "Both native split panes are captured",
    );
    assert(
      api.views.get(first.id).getVisible() &&
        api.views.get(second.id).getVisible(),
      "Capture alone must not detach native content",
    );
    const { nativeImage } = require("electron");
    for (const frame of backdrop.frames) {
      const pixels = nativeImage.createFromDataURL(frame.image);
      assert(!pixels.isEmpty());
      assert(pixels.getSize().width <= 1600 && pixels.getSize().height <= 1000);
    }
    assert.equal(
      (await api.action("overlay", { open: true, ready: backdrop.token })).ok,
      true,
    );
    assert.equal(api.views.get(first.id).getVisible(), false);
    await api.action("overlay", { open: false });
    assert.equal(api.views.get(first.id).getVisible(), true);
    assert.equal(
      (await api.action("overlay", { open: true, ready: backdrop.token })).ok,
      false,
    );
    api.testWindow.hide();
    api.testWindow.setBounds(originalBounds);
    checks.push(
      "dialog backdrop captures bounded real Chromium pixels before detaching and rejects stale decode acknowledgements",
    );
    // Real WebContentsView geometry, not just a CSS representation of a split.
    const boundsFor = (id) => api.views.get(id).getBounds();
    let firstBounds = boundsFor(second.id),
      secondBounds = boundsFor(first.id);
    assert.equal(secondBounds.x, firstBounds.x + firstBounds.width + 8);
    assert.equal(firstBounds.height, secondBounds.height);
    await api.action("split-orientation", { orientation: "vertical" });
    firstBounds = boundsFor(second.id);
    secondBounds = boundsFor(first.id);
    assert.equal(secondBounds.y, firstBounds.y + firstBounds.height + 8);
    assert.equal(firstBounds.width, secondBounds.width);
    assert.equal(api.getState().settings.splitOrientation, "vertical");
    await api.action("split", {
      id: second.id,
      targetId: first.id,
      orientation: "horizontal",
    });
    assert.equal(api.getState().activeTabId, first.id);
    assert.equal(api.getSnapshot().splitId, second.id);
    firstBounds = boundsFor(first.id);
    secondBounds = boundsFor(second.id);
    assert.equal(secondBounds.x, firstBounds.x + firstBounds.width + 8);
    checks.push(
      "drag-target pairing and both split orientations set actual native pane bounds",
    );

    const thirdPane = api.openTab(base + "/third-pane", api.getState().activeSpaceId, {background:true});
    await api.action("split", {id:thirdPane.id});
    await waitLoad(api.views.get(thirdPane.id).webContents);
    assert.equal(api.getSnapshot().splitIds.length, 3);
    api.trimMemory();
    for (const id of [first.id, second.id, thirdPane.id]) assert(api.views.has(id), "Every visible split pane is protected");
    await api.action("split-ratio", {divider:0, ratio:.25});
    await api.action("split-ratio", {divider:1, ratio:.7});
    const savedWeights = [...api.getSnapshot().splitWeights];
    const paneIds = [...api.getSnapshot().splitIds];
    const thirdBounds = paneIds.map(boundsFor);
    assert.equal(thirdBounds[1].x, thirdBounds[0].x + thirdBounds[0].width + 8);
    assert.equal(thirdBounds[2].x, thirdBounds[1].x + thirdBounds[1].width + 8);
    const elsewhere = api.openTab(base + "/elsewhere");
    await waitLoad(api.views.get(elsewhere.id).webContents);
    await api.action("select-tab", {id:first.id});
    assert.deepEqual(api.getSnapshot().splitIds, paneIds);
    assert.deepEqual(api.getSnapshot().splitWeights, savedWeights);
    const restored = require("../src/model.cjs").validateState(JSON.parse(JSON.stringify(api.getState())));
    assert.equal(restored.splits.find(group=>group.tabIds.includes(first.id)).tabIds.length, 3);
    const pagesBeforeSeparate = api.getState().tabs.length;
    await api.action("split-remove-pane", {id:thirdPane.id});
    assert.equal(api.getState().tabs.length, pagesBeforeSeparate);
    assert.equal(api.getSnapshot().splitIds.length, 2);
    await api.action("close-tab", {id:thirdPane.id});
    await api.action("close-tab", {id:elsewhere.id});
    await api.action("split", {id:second.id,targetId:first.id,orientation:"horizontal"});
    checks.push("three real split panes retain membership and proportions across tab switches and workspace serialization; separating preserves the page");

    // Tabs on top: panes sit on the inset card below the toolbar and tab row.
    await api.action("tab-layout", { layout: "top" });
    assert.equal(boundsFor(first.id).x, 8);
    assert.equal(boundsFor(first.id).y, 88);
    assert.equal(boundsFor(second.id).y, 88);
    await api.action("sidebar");
    assert.equal(api.getState().settings.tabLayout, "sidebar");
    assert.equal(api.getState().sidebarHidden, false);
    assert.equal(boundsFor(first.id).x, api.getState().settings.sidebarWidth);
    assert.equal(boundsFor(first.id).y, 52);
    checks.push("moving tabs between the top bar and sidebar repositions real native panes");

    await api.action("sidebar");
    assert.equal(api.getState().sidebarHidden, true);
    assert.equal(boundsFor(first.id).x, 8);
    await api.action("sidebar-reveal", { visible: true });
    assert.equal(api.getSnapshot().sidebarRevealed, true);
    assert.equal(api.getState().sidebarHidden, true);
    assert.equal(Object.hasOwn(api.getState(), "sidebarRevealed"), false);
    assert.equal(boundsFor(first.id).x, api.getState().settings.sidebarWidth);
    await api.action("sidebar-reveal", { visible: false });
    assert.equal(boundsFor(first.id).x, 8);
    await api.action("sidebar-reveal", { visible: true, animate: true });
    await new Promise((resolve) => setTimeout(resolve, 45));
    const partialLeft = boundsFor(first.id).x;
    assert(
      partialLeft > 8 && partialLeft < api.getState().settings.sidebarWidth,
      "native page must pass through intermediate reveal bounds",
    );
    assert.equal(
      partialLeft,
      require("../src/interactions.cjs").sidebarRevealLeft({
        width: api.getState().settings.sidebarWidth,
        progress: api.getSnapshot().sidebarRevealProgress,
      }),
    );
    await api.action("sidebar-reveal", { visible: false, animate: true });
    await new Promise((resolve) => setTimeout(resolve, 240));
    assert.equal(boundsFor(first.id).x, 8);
    assert.equal(api.getSnapshot().sidebarRevealAnimating, false);
    await api.action("sidebar");
    checks.push(
      "hover reveal resizes native content while preserving the hidden preference and keeping reveal state ephemeral",
    );

    await api.action("favorite", { id: first.id });
    assert.equal(
      api.getState().tabs.find((t) => t.id === first.id).kind,
      "favorite",
    );
    const originalSpace = api.getState().activeSpaceId;
    await api.action("sidebar");
    await api.action("sidebar-reveal", { visible: true });
    await api.action("swipe-profile", { direction: 1 });
    assert.notEqual(api.getState().activeSpaceId, originalSpace);
    assert.equal(api.getSnapshot().sidebarRevealed, true);
    assert.equal(api.getState().sidebarHidden, true);
    const M = require("../src/model.cjs");
    assert(!M.visibleTabs(api.getState()).some((t) => t.id === first.id));
    const isolated = api.openTab(base + "/other-profile");
    await waitLoad(api.views.get(isolated.id).webContents);
    assert.equal(
      boundsFor(isolated.id).x,
      api.getState().settings.sidebarWidth,
    );
    const otherSpace = api.getState().activeSpaceId;
    await api.action("space", { id: originalSpace });
    assert.equal(api.getSnapshot().sidebarRevealed, true);
    assert.equal(boundsFor(first.id).x, api.getState().settings.sidebarWidth);
    await api.action("space", { id: otherSpace });
    assert.equal(api.getSnapshot().sidebarRevealed, true);
    assert.equal(
      boundsFor(isolated.id).x,
      api.getState().settings.sidebarWidth,
    );
    await assert.rejects(
      api.action("split", { id: first.id, targetId: isolated.id }),
      /same profile/,
    );
    await api.action("close-tab", { id: isolated.id });
    await api.action("swipe-profile", { direction: -1 });
    assert.equal(api.getState().activeSpaceId, originalSpace);
    assert.equal(api.getSnapshot().sidebarRevealed, true);
    assert.equal(boundsFor(first.id).x, api.getState().settings.sidebarWidth);
    await api.action("sidebar");
    checks.push(
      "hover-revealed sidebar stays visible through profile swipes and Space clicks with native page bounds preserved",
    );
    assert(M.visibleTabs(api.getState()).some((t) => t.id === first.id));
    await api.action("favorite", { id: first.id });
    assert.equal(
      api.getState().tabs.find((t) => t.id === first.id).kind,
      "pinned",
    );
    checks.push(
      "favorites remain scoped to their profile and cross-profile split requests are rejected",
    );
    // Exercise actual Chromium input dispatch through the production shell DOM,
    // bundled preload tracker and IPC with THREE profiles: two would hide sign bugs.
    const beforeWheelSpace = api.getState().activeSpaceId;
    await api.action("save-space", {
      name: "Wheel qualification",
      profileId: "new",
    });
    const thirdWheelSpace = api.getState().activeSpaceId;
    await api.action("space", { id: beforeWheelSpace });
    await api.action("sidebar");
    await api.action("sidebar-reveal", { visible: true });
    await new Promise((resolve) => setTimeout(resolve, 100));
    api.testWindow.show();
    api.testWindow.focus();
    api.testWindow.webContents.focus();
    await new Promise((resolve) => setTimeout(resolve, 150));
    const interactionRules = require("../src/interactions.cjs");
    const forwardSpace = interactionRules.nextProfileSpace(
      api.getState().spaces,
      beforeWheelSpace,
      1,
    );
    const backwardSpace = interactionRules.nextProfileSpace(
      api.getState().spaces,
      beforeWheelSpace,
      -1,
    );
    assert.notEqual(
      forwardSpace,
      backwardSpace,
      "three profiles must expose direction errors",
    );
    const wheel = (deltaX, deltaY) =>
      api.testWindow.webContents.sendInputEvent({
        type: "mouseWheel",
        x: 100,
        y: 210,
        deltaX,
        deltaY,
        canScroll: true,
      });
    const stroke = async (deltaX, deltaY) => {
      for (let index = 0; index < 12; index++) {
        wheel(deltaX, deltaY);
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
      await new Promise((resolve) => setTimeout(resolve, 70));
      assert.equal(
        api.getSnapshot().sidebarRevealed,
        true,
        "swiping must preserve hovered sidebar",
      );
    };
    api.testWindow.webContents.sendInputEvent({
      type: "mouseMove",
      x: 100,
      y: 210,
    });
    await stroke(-18, -13);
    assert.equal(
      api.getState().activeSpaceId,
      forwardSpace,
      "diagonal Chromium wheel input must switch in the expected direction",
    );
    for (let index = 0; index < 40; index++) {
      wheel(-5, -1);
      await new Promise((resolve) => setTimeout(resolve, 30));
      assert.equal(
        api.getState().activeSpaceId,
        forwardSpace,
        "momentum in the same routed gesture must not switch another profile",
      );
    }
    await stroke(24, 3); // Deliberate return starts while prior momentum is still latched.
    assert.equal(
      api.getState().activeSpaceId,
      beforeWheelSpace,
      "opposite stroke must return without idle delay",
    );
    assert.equal(boundsFor(first.id).x, api.getState().settings.sidebarWidth);
    await new Promise((resolve) => setTimeout(resolve, 360));
    await stroke(24, 3);
    assert.equal(
      api.getState().activeSpaceId,
      backwardSpace,
      "negative direction must select the distinct third profile",
    );
    await stroke(-24, -3);
    assert.equal(
      api.getState().activeSpaceId,
      beforeWheelSpace,
      "mirrored opposite stroke must also return",
    );
    await api.action("sidebar");
    await api.action("delete-space", { id: thirdWheelSpace });
    api.testWindow.hide();
    checks.push(
      "Chromium wheel input switches three profiles in both directions, immediate return works symmetrically, momentum does not repeat, and hovered sidebar remains visible",
    );
    await api.action("close-tab", { id: second.id, archive: true });
    assert.equal(api.views.has(second.id), false);
    await api.action("restore", { id: second.id });
    await waitLoad(api.views.get(second.id).webContents);
    assert.equal(
      api.views.get(second.id).webContents.getURL(),
      base + "/split",
    );
    checks.push(
      "archive destroys the renderer and restore recreates the document",
    );
    await require("./recent-tabs-engine-test.cjs")(api, base);
    checks.push("native Control-Tab previews a frozen MRU list, release commits, Escape cancels, and page-focused shortcuts reach the shell");
    await require("./features-engine-test.cjs")(api, base);
    checks.push("settings forms persist search and folder changes; Escape restores native page geometry; nested-folder removal and undo retain tabs");
    const before = api.getState().tabs.map((t) => t.id);
    for (const id of before) await api.action("close-tab", { id, archive: true });
    await new Promise((r) => setTimeout(r, 500));
    assert.equal(api.views.size, 0);
    assert.equal(webContents.getAllWebContents().length, baseline);
    checks.push(
      "closing all tabs returns WebContents count to the shell-only baseline",
    );
    const { importProfile } = require("../src/import-controller.cjs");
    const migrated = await importProfile({
      source: { name: "Fixture", browser: "chrome", browserName: "Chrome" },
      options: { cookies: true },
      state: api.getState(),
      sessionFor: api.sessionFor,
      vault: { removeProfile: async () => {} },
      persist: async () => {},
      read: async () => ({
        bookmarks: [],
        spaces: [],
        history: [],
        passwords: [],
        warnings: [],
        cookieVersion: 24,
        cookies: [
          {
            host_key: "127.0.0.1",
            name: "migration-fixture",
            value: "fixture-only",
            path: "/",
            is_secure: 0,
            is_httponly: 1,
            samesite: 1,
            has_expires: 0,
          },
        ],
      }),
    });
    const importedCookies = await api
      .sessionFor(migrated.profileId)
      .cookies.get({ name: "migration-fixture" });
    assert.equal(importedCookies[0]?.value, "fixture-only");
    assert.equal(
      (
        await api
          .sessionFor("default")
          .cookies.get({ name: "migration-fixture" })
      ).length,
      0,
    );
    await api.sessionFor(migrated.profileId).clearStorageData();
    checks.push(
      "profile migration imports cookies into a fresh Chromium partition without leaking into the existing profile",
    );
    assert.deepEqual(
      api.getShellErrors(),
      [],
      "shell renderer must remain free of runtime errors",
    );
    checks.push(
      "shell renderer reports no runtime errors throughout the browser lifecycle",
    );
    console.log(JSON.stringify({ passed: checks.length, checks }, null, 2));
  } finally {
    server.close();
  }
};
