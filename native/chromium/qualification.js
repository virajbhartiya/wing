(async () => {
  // Fresh test profiles would otherwise greet the run with first-run onboarding.
  window.__wingQualifying = true;
  if (document.querySelector(".onboarding")) closeModal();
  const assert = (condition, message) => {
    if (!condition) throw Error(message);
  };
  const invoke = window.wing.invoke,
    checks = [];
  const snapshot = () => invoke("state");
  const waitFor = async (condition, message) => {
    const deadline = Date.now() + 20000;
    while (!(await condition())) {
      if (Date.now() > deadline) throw Error(message);
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
  };
  const evaluate = async (id, code) => {
    let value = await invoke("native-evaluate", {
      id,
      script: `try { post('result', JSON.stringify(${code})); } catch { post('result', 'null'); }`,
    });
    for (let i = 0; i < 2 && typeof value === "string"; i++) {
      try {
        value = JSON.parse(value);
      } catch {
        break;
      }
    }
    return value;
  };
  const initial = await snapshot();
  assert(initial.tabs.length > 0, "workspace model bootstraps");
  assert(document.querySelector("#sidebar"), "existing Wing sidebar rendered");
  assert(
    (await invoke("native-diagnostics")).shellInternal,
    "UI window is internal",
  );
  checks.push(
    "shared workspace and existing Wing interface start in an internal UI window",
  );
  if (WING_TEST.sourceEngine)
    assert(
      (await invoke("native-diagnostics")).downloadDirectoryAPI,
      "Wing source framework provides native profile APIs",
    );
  const rejected = await new Promise((resolve, reject) => {
    const id = 90000001;
    const receive = (event) => {
      if (event.detail.kind !== "response" || event.detail.data.id !== id)
        return;
      clearTimeout(timer);
      window.removeEventListener("wing-native", receive);
      resolve(event.detail.data);
    };
    const timer = setTimeout(() => {
      window.removeEventListener("wing-native", receive);
      reject(Error("Malformed request was not rejected"));
    }, 2000);
    window.addEventListener("wing-native", receive);
    window.__wingNativePost(
      "wing-request",
      JSON.stringify({
        id,
        action: "sync",
        data: { workspace: { tabs: [null], spaces: [] }, panes: [] },
      }),
    );
  });
  assert(
    rejected.error === "Invalid workspace layout",
    "native boundary rejects malformed workspace",
  );
  checks.push("native bridge rejects malformed workspace data before mutation");
  // The engine drops page messages over 64 KB, so large requests are sent in
  // parts. This one is still malformed, so answering proves it was reassembled.
  const oversized = await new Promise((resolve, reject) => {
    const id = 90000002;
    const receive = (event) => {
      if (event.detail.kind !== "response" || event.detail.data.id !== id)
        return;
      clearTimeout(timer);
      window.removeEventListener("wing-native", receive);
      resolve(event.detail.data);
    };
    const timer = setTimeout(() => {
      window.removeEventListener("wing-native", receive);
      reject(Error("Oversized request was not answered"));
    }, 2000);
    window.addEventListener("wing-native", receive);
    const text = JSON.stringify({
      id,
      action: "sync",
      data: {
        workspace: { tabs: [null], spaces: [] },
        panes: [],
        padding: "x".repeat(70000),
      },
    });
    const count = Math.ceil(text.length / 30000);
    for (let index = 0; index < count; index++)
      window.__wingNativePost(
        "wing-request-part",
        JSON.stringify({
          id,
          index,
          count,
          text: text.slice(index * 30000, (index + 1) * 30000),
        }),
      );
  });
  assert(
    oversized.error === "Invalid workspace layout",
    "native boundary reassembles oversized requests",
  );
  checks.push("native bridge accepts requests over the engine message limit");
  if (WING_TEST.phase === "restart") {
    assert(
      initial.settings.automaticPictureInPicture === true,
      "automatic picture-in-picture preference survives restart",
    );
    assert(
      initial.splits.length === 2 && initial.splits[0].tabIds.length === 2,
      "split survives process restart",
    );
    assert(
      initial.tabs.filter(
        (tab) =>
          tab.kind === "pinned" && initial.splits[0].tabIds.includes(tab.id),
      ).length === 2,
      "saved destinations survive restart",
    );
    await waitFor(
      async () =>
        (await invoke("native-diagnostics")).tabs.filter((tab) => tab.visible)
          .length === 2,
      "both native panes restored",
    );
    checks.push(
      "pinned split membership and both native panes restore after restart",
    );
    await waitFor(
      async () =>
        (await evaluate(
          initial.activeTabId,
          'getComputedStyle(document.querySelector("h1")).color',
        )) === "rgb(10, 20, 30)",
      "site CSS applies to a fresh restored document",
    );

    const importedTab = initial.tabs.find(
      (t) => t.url === WING_TEST.base + "/imported",
    );
    assert(importedTab, "imported bookmark survives restart");
    await invoke("select-tab", { id: importedTab.id });
    await waitFor(
      async () =>
        (await invoke("native-diagnostics")).tabs.some(
          (t) => t.id === importedTab.id && t.visible,
        ),
      "imported profile reopens",
    );
    await waitFor(
      async () =>
        (await evaluate(importedTab.id, "document.cookie"))?.includes(
          "imported-session=fixture-account",
        ),
      "imported cookie survives engine restart",
    );
    await invoke("select-tab", { id: initial.activeTabId });
    checks.push("imported bookmark and profile cookie survive engine restart");
    const legacyTab = initial.tabs.find(
      (t) => t.url === WING_TEST.base + "/legacy-a",
    );
    assert(
      legacyTab &&
        initial.splits.some(
          (g) =>
            g.tabIds.includes(legacyTab.id) && g.orientation === "vertical",
        ),
      "legacy split persists after native restart",
    );
    await invoke("select-tab", { id: legacyTab.id });
    await waitFor(
      async () =>
        (await invoke("native-diagnostics")).tabs.some(
          (t) => t.id === legacyTab.id && t.visible,
        ),
      "legacy profile completes protection startup on restart",
    );
    await waitFor(
      async () =>
        (await evaluate(legacyTab.id, "document.cookie"))?.includes(
          "legacy-session=legacy-fixture-account",
        ),
      "legacy migrated cookie survives restart",
    );
    await invoke("select-tab", { id: initial.activeTabId });
    checks.push("legacy Wing layout and account cookie survive native restart");
    post(
      "result",
      JSON.stringify({
        passed: true,
        checks,
        chromium: initial.versions.chrome,
      }),
    );
    return;
  }
  await invoke("new-tab", { url: WING_TEST.base + "/first" });
  const first = (await snapshot()).activeTabId;
  await waitFor(
    async () =>
      (await snapshot()).tabs.find((tab) => tab.id === first)?.title ===
      "Fixture /first",
    "first page title arrives",
  );
  await waitFor(
    async () => (await evaluate(first, "window.fixture")).control === "loaded",
    "control image loaded",
  );
  await waitFor(
    async () =>
      (await evaluate(
        first,
        'getComputedStyle(document.querySelector("#cookie-banner")).display',
      )) === "none",
    "bundled cookie filter applies after content scripts initialize",
  );
  const filtering = await evaluate(
    first,
    '({...window.fixture, cookie:getComputedStyle(document.querySelector("#cookie-banner")).display})',
  );
  assert(
    filtering.ad === "blocked" && filtering.cookie === "none",
    "full uBlock and bundled cookie list protect the first page: " +
      JSON.stringify(filtering),
  );
  checks.push(
    "full uBlock blocks the first page ad request and bundled cookie-list cosmetics apply",
  );
  assert(
    (await evaluate(first, "typeof window.__wingNativePost")) === "undefined",
    "ordinary web page has no privileged bridge",
  );
  const controls = await invoke("site-controls");
  assert(
    controls.origin === WING_TEST.base,
    "site controls use the active document origin",
  );
  await invoke("site-permission", {
    permission: "notifications",
    value: "block",
  });
  assert(
    (await invoke("site-controls")).permissions.find(
      (p) => p.permission === "notifications",
    ).value === "block",
    "native content setting persists",
  );
  assert(
    (await invoke("extension-capabilities")).available,
    "native Chrome extension installer is available",
  );
  const library = await invoke("library-data");
  assert(
    Array.isArray(library.downloads) && Array.isArray(library.bookmarks),
    "Chromium library services respond",
  );
  assert(
    library.history.some((h) => h.url === WING_TEST.base + "/first"),
    "native profile history contains the visited page",
  );
  checks.push(
    "profile-scoped Chromium history, bookmarks, downloads and real content settings respond",
  );
  if ((await invoke("native-diagnostics")).downloadDirectoryAPI)
    await invoke("download-directory", { path: WING_TEST.downloads });
  const download = await invoke("download-start", {
    url: WING_TEST.base + "/download",
  });
  await waitFor(
    async () =>
      (await invoke("library-data")).downloads.some(
        (d) => d.id === String(download.id) && d.status === "completed",
      ),
    "native download completes",
  );
  assert(
    (await invoke("library-data")).downloads
      .find((d) => d.id === String(download.id))
      .path.startsWith(WING_TEST.downloads + "/"),
    "download stays in isolated selected directory",
  );
  checks.push(
    "native download writes into the selected isolated directory and library tracks completion",
  );

  await evaluate(
    first,
    '(document.body.style.minHeight="2400px", window.scrollTo(0, 300), true)',
  );
  const beforeCapture = await evaluate(
    first,
    "({scroll:scrollY, height:innerHeight, content:document.documentElement.scrollHeight})",
  );
  const visibleCapture = await invoke("capture-page", { inspectCapture: true });
  const fullCapture = await invoke("capture-full-page", {
    inspectCapture: true,
  });
  assert(
    fullCapture.height >= beforeCapture.content &&
      fullCapture.height > visibleCapture.height,
    "full-page PNG contains content below the viewport",
  );
  assert(
    (await evaluate(first, "scrollY")) === beforeCapture.scroll &&
      (await evaluate(first, "innerHeight")) === beforeCapture.height,
    "capture preserves live viewport and scroll position",
  );
  await evaluate(
    first,
    '(document.body.style.minHeight="", window.scrollTo(0, 0), true)',
  );
  checks.push(
    "full-page PNG captures offscreen content without resizing or scrolling the live page",
  );

  // Exercise the actual editor and decoder, while preserving the user's clipboard.
  const savedInvoke = window.wing.invoke;
  let exportedCapture;
  window.wing.invoke = async (action, data) => {
    if (action === "image-export") {
      exportedCapture = await savedInvoke(action, {
        ...data,
        inspectCapture: true,
      });
      return exportedCapture;
    }
    return savedInvoke(action, data);
  };
  try {
    await window.wingCapture.open();
    const root = document.querySelector(".capture-editor");
    assert(root, "region editor opens with a real native screenshot");
    for (const [name, value] of Object.entries({
      x: 10,
      y: 12,
      width: 100,
      height: 80,
    })) {
      const input = root.querySelector(`[data-crop="${name}"]`);
      input.value = value;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
    root.querySelector("#capture-portrait").checked = true;
    root.querySelector('[data-export="clipboard"]').click();
    await waitFor(
      () => exportedCapture,
      "region export reaches native PNG decoder",
    );
    assert(
      exportedCapture.width === 164 && exportedCapture.height === 292,
      "selected pixels get the requested portrait frame",
    );
    await waitFor(
      () => !document.querySelector(".capture-editor"),
      "successful region export closes editor",
    );
    await window.wingCapture.open();
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    // Dialogs fade out before their content is removed.
    await waitFor(
      () => !document.querySelector(".capture-editor"),
      "Escape cancels region selection",
    );
    let rejected = false;
    try {
      await savedInvoke("image-export", {
        png: "bm90LWFuLWltYWdl",
        destination: "clipboard",
        inspectCapture: true,
      });
    } catch {
      rejected = true;
    }
    assert(
      rejected,
      "native export rejects non-image data before changing clipboard",
    );
  } finally {
    window.wing.invoke = savedInvoke;
  }
  checks.push(
    "region capture exports selected pixels in a portrait frame, cancels on Escape, and rejects malformed images",
  );

  await invoke("native-evaluate", {
    id: first,
    userGesture: true,
    script: `
    window.pipCanvas=document.createElement('canvas'); pipCanvas.width=320;pipCanvas.height=180;
    const context=pipCanvas.getContext('2d'); context.fillStyle='green';context.fillRect(0,0,320,180);
    window.pipVideo=document.createElement('video');pipVideo.muted=true;pipVideo.playsInline=true;
    pipVideo.srcObject=pipCanvas.captureStream(5);document.body.append(pipVideo);
    window.pipDraw=setInterval(()=>{context.fillRect(0,0,320,180)},100);
    pipVideo.play();`,
  });
  await waitFor(
    async () => (await evaluate(first, "pipVideo.readyState")) >= 2,
    "local fixture video is playing",
  );
  await invoke("picture-in-picture");
  await waitFor(
    async () =>
      (await snapshot()).tabs.find((t) => t.id === first)?.pictureInPicture,
    "native picture-in-picture state reaches the sidebar",
  );
  assert(
    await evaluate(first, "document.pictureInPictureElement === pipVideo"),
    "real video enters picture-in-picture",
  );
  await invoke("favorite", { id: first });
  await waitFor(
    () =>
      document
        .querySelector(`.favorite[data-tab="${first}"]`)
        ?.getAttribute("data-pip") === "true",
    "favorite tabs retain the picture-in-picture indicator",
  );
  await invoke("favorite", { id: first });
  await invoke("new-tab", { url: WING_TEST.base + "/pip-background" });
  const pipBackground = (await snapshot()).activeTabId;
  await waitFor(
    async () =>
      (await snapshot()).tabs.find((t) => t.id === pipBackground)?.title ===
      "Fixture /pip-background",
    "background comparison page loads",
  );
  await invoke("trim-memory");
  const floatingPage = (await invoke("native-diagnostics")).tabs.find(
    (t) => t.id === first,
  );
  assert(
    floatingPage && !floatingPage.discarded,
    "a floating video is protected from background memory cleanup",
  );
  await invoke("select-tab", { id: first });
  await invoke("close-tab", { id: pipBackground });
  await invoke("picture-in-picture", { close: true });
  await waitFor(
    async () =>
      !(await snapshot()).tabs.find((t) => t.id === first)?.pictureInPicture,
    "closing picture-in-picture clears runtime state",
  );
  await evaluate(
    first,
    "(clearInterval(pipDraw),pipVideo.srcObject.getTracks().forEach(t=>t.stop()),pipVideo.remove(),true)",
  );
  await invoke("features-settings", { automaticPictureInPicture: true });
  assert(
    (await snapshot()).settings.automaticPictureInPicture,
    "automatic picture-in-picture preference persists",
  );
  checks.push(
    "native video picture-in-picture opens, reports state, and closes; automatic mode is configurable",
  );

  await invoke("protection-settings");
  const dashboard = (await snapshot()).activeTabId;
  await waitFor(
    async () =>
      (await snapshot()).tabs
        .find((tab) => tab.id === dashboard)
        ?.url.startsWith("chrome-extension://"),
    "protection settings opens",
  );
  await waitFor(
    async () =>
      (await evaluate(
        dashboard,
        'typeof vAPI !== "undefined" && typeof vAPI.messaging.send',
      )) === "function",
    "real uBlock settings document loaded",
  );
  await invoke("close-tab", { id: dashboard });
  await waitFor(
    async () => !(await snapshot()).tabs.some((tab) => tab.id === dashboard),
    "settings tab closes",
  );
  await invoke("select-tab", { id: first });
  checks.push("real uBlock dashboard is accessible through the Wing host");
  await invoke("native-evaluate", {
    id: first,
    script:
      "document.cookie='wing-profile=personal;path=/';post('result',JSON.stringify(document.cookie))",
  });
  await invoke("navigate", { url: WING_TEST.base + "/second" });
  await waitFor(
    async () =>
      (await snapshot()).tabs.find((tab) => tab.id === first)?.title ===
      "Fixture /second",
    "navigation updates title",
  );
  await invoke("back");
  await waitFor(
    async () =>
      (await snapshot()).tabs.find((tab) => tab.id === first)?.url ===
      WING_TEST.base + "/first",
    "native back history restored",
  );
  checks.push(
    "native navigation, title events, back history and unprivileged page boundary",
  );
  await invoke("native-evaluate", {
    id: first,
    userGesture: true,
    script: "location.href='wing-qualification-no-app://example'",
  });
  await waitFor(
    async () => (await invoke("native-diagnostics")).externalAppRequests === 1,
    "external protocol requests receive a native confirmation sheet",
  );
  await invoke("native-cancel-external", { id: first });
  assert(
    (await invoke("native-diagnostics")).externalAppRequests === 0,
    "external protocol cancellation removes the pending request",
  );
  checks.push(
    "external application protocol requests require confirmation and cancel without launching an app",
  );
  const deviceURL = new URL(WING_TEST.base + "/device");
  deviceURL.hostname = "localhost";
  await invoke("new-tab", { url: deviceURL.href });
  const deviceTab = (await snapshot()).activeTabId;
  await waitFor(
    async () =>
      (await snapshot()).tabs.find((t) => t.id === deviceTab)?.title ===
      "Fixture /device",
    "secure-context device fixture loads",
  );
  await invoke("native-evaluate", {
    id: deviceTab,
    userGesture: true,
    script:
      "window.deviceResult='pending';navigator.usb.requestDevice({filters:[]}).then(()=>window.deviceResult='accepted',e=>window.deviceResult=e.name)",
  });
  await waitFor(
    async () => (await invoke("native-diagnostics")).deviceChoosers === 1,
    "WebUSB requests open a native device chooser",
  );
  await invoke("native-cancel-device", { id: deviceTab });
  await waitFor(
    async () =>
      ["NotFoundError", "AbortError"].includes(
        await evaluate(deviceTab, "window.deviceResult"),
      ),
    "cancelling the native chooser rejects the website request without granting access",
  );
  assert(
    (await invoke("native-diagnostics")).deviceChoosers === 0,
    "cancel releases the device chooser",
  );
  await invoke("close-tab", { id: deviceTab });
  await invoke("select-tab", { id: first });
  checks.push(
    "real WebUSB request opens the native device chooser and cancellation rejects access",
  );
  await invoke("new-tab", { url: WING_TEST.base + "/split" });
  const second = (await snapshot()).activeTabId;
  await waitFor(
    async () =>
      (await snapshot()).tabs.find((tab) => tab.id === second)?.title ===
      "Fixture /split",
    "second page title arrives",
  );
  await invoke("split", { id: first });
  await invoke("pin", { id: second });
  await invoke("split-ratio", { divider: 0, ratio: 0.35 });
  const panes = (await invoke("native-diagnostics")).tabs
    .filter((tab) => tab.visible)
    .sort((a, b) => a.x - b.x);
  assert(
    panes.length === 2 && panes[0].width < panes[1].width,
    "native split bounds match resized group",
  );
  checks.push("two native pages share a pinned, resized persistent split");
  assert(
    panes.every((pane) => pane.attachedToWindow && !pane.hidden),
    "native panes must be attached to the visible window without hidden ancestors: " +
      JSON.stringify(panes),
  );
  await invoke("select-tab", { id: first });
  const installedFixture = await invoke("native-test-extension", {
    id: first,
    operation: "load",
  });
  assert(
    installedFixture.extensionId.length === 32,
    "fixture extension loads in the actual profile",
  );
  await waitFor(
    async () =>
      (
        await invoke("native-test-extension", {
          id: first,
          operation: "open",
          extensionId: installedFixture.extensionId,
        })
      ).ok,
    "extension side panel becomes available",
  );
  await waitFor(async () => {
    const panel = (await invoke("native-diagnostics")).extensionSidebar;
    return panel.visible && panel.title === "Wing extension side panel fixture";
  }, "real extension document renders in the docked side panel");
  assert(
    (await invoke("native-diagnostics")).tabs.find((t) => t.id === first)
      .width < panes.find((t) => t.id === first).width,
    "side panel resizes page rather than covering it",
  );
  await invoke("select-tab", { id: second });
  assert(
    !(await invoke("native-diagnostics")).extensionSidebar.open,
    "side panel closes when its owning tab changes",
  );
  await invoke("select-tab", { id: first });
  await invoke("native-test-extension", {
    id: first,
    operation: "open",
    extensionId: installedFixture.extensionId,
  });
  await invoke("native-test-extension", { id: first, operation: "close" });
  assert(
    !(await invoke("native-diagnostics")).extensionSidebar.open,
    "explicit side panel close releases the extension view",
  );
  await invoke("new-tab", { url: WING_TEST.base + "/panel-owner" });
  const panelOwner = (await snapshot()).activeTabId;
  await waitFor(
    async () =>
      (await snapshot()).tabs.find((t) => t.id === panelOwner)?.title ===
      "Fixture /panel-owner",
    "temporary side panel owner loads",
  );
  assert(
    (
      await invoke("native-test-extension", {
        id: panelOwner,
        operation: "open",
        extensionId: installedFixture.extensionId,
      })
    ).ok,
    "extension panel opens on a second owner",
  );
  await invoke("close-tab", { id: panelOwner });
  await waitFor(
    async () => !(await invoke("native-diagnostics")).extensionSidebar.open,
    "closing the owning page destroys its extension panel",
  );
  await invoke("select-tab", { id: first });
  checks.push(
    "real extension side panel renders, resizes pages, and closes on dismissal, owning-tab change or closure",
  );
  const preview = await invoke("overlay", { open: true });
  assert(!preview.frames.length, "overlays no longer screenshot the page");
  await invoke("overlay", { open: true, ready: preview.token });
  assert(
    (await invoke("native-diagnostics")).tabs.filter((tab) => tab.visible)
      .length === 2,
    "an overlay keeps both split panes live beneath it",
  );
  await invoke("overlay", { open: false });
  assert(
    (await invoke("native-diagnostics")).tabs.filter((t) => t.visible)
      .length === 2,
    "overlay close restores split geometry",
  );
  const stale = await invoke("overlay", { open: true, ready: preview.token });
  assert(stale.cancelled, "stale overlay commit cannot hide restored pages");
  await invoke("boost", { css: "h1 { color: rgb(10, 20, 30) !important; }" });
  await waitFor(
    async () =>
      (await evaluate(
        second,
        'getComputedStyle(document.querySelector("h1")).color',
      )) === "rgb(10, 20, 30)",
    "native site CSS applies",
  );
  const metrics = await invoke("metrics");
  assert(
    metrics.processes.length > 0 &&
      metrics.processes.some((p) => p.workingSetKB > 0),
    "native process metrics are measured",
  );
  checks.push(
    "overlay open/commit/cancel retains split geometry, site CSS applies, and native process metrics are real",
  );

  const personal = (await snapshot()).activeSpaceId;
  const work = initial.spaces.find((space) => space.profileId === "work").id;
  await invoke("space", { id: work });
  await invoke("new-tab", { url: WING_TEST.base + "/isolated" });
  const isolated = (await snapshot()).activeTabId;
  await waitFor(
    async () =>
      (await snapshot()).tabs.find((tab) => tab.id === isolated)?.title ===
      "Fixture /isolated",
    "second profile opened",
  );
  assert(
    !(await evaluate(isolated, "document.cookie")).includes("wing-profile="),
    "profiles do not share cookies",
  );
  assert(
    (await invoke("site-controls")).permissions.find(
      (p) => p.permission === "notifications",
    ).value !== "block",
    "permission changes do not leak across profiles",
  );
  await invoke("space", { id: personal });
  await invoke("select-tab", { id: first });
  await waitFor(
    async () =>
      (await invoke("native-diagnostics")).tabs.filter((tab) => tab.visible)
        .length === 2,
    "split revisiting restores both views",
  );
  assert(
    (await evaluate(first, "document.cookie")).includes(
      "wing-profile=personal",
    ),
    "original profile cookies remain",
  );
  checks.push(
    "profile cookie isolation and split restoration after Space switching",
  );
  await invoke("peek", { url: WING_TEST.base + "/peek" });
  const peekId = (await snapshot()).peek.id;
  await waitFor(
    async () =>
      (await invoke("native-diagnostics")).tabs.some(
        (t) => t.id === peekId && t.visible,
      ),
    "Peek mounts its native page",
  );
  await invoke("select-tab", { id: first });
  await waitFor(
    async () =>
      !(await invoke("native-diagnostics")).tabs.some((t) => t.id === peekId),
    "selecting a tab closes the transient native page",
  );
  assert(!(await snapshot()).peek, "Peek state closes with the native page");
  await invoke("peek", { url: WING_TEST.base + "/promote" });
  const promotedId = (await snapshot()).peek.id;
  await waitFor(
    async () =>
      (await invoke("native-diagnostics")).tabs.some(
        (t) => t.id === promotedId && t.visible,
      ),
    "second Peek mounts",
  );
  await invoke("promote-peek");
  assert(
    (await snapshot()).activeTabId === promotedId,
    "promotion retains the same native tab",
  );
  await invoke("close-tab", { id: promotedId });
  await invoke("select-tab", { id: first });
  checks.push(
    "native Peek closes on selection and promotes without replacing its tab",
  );
  await invoke("devtools");
  await waitFor(
    async () =>
      (await invoke("native-diagnostics")).tabs.find((t) => t.id === first)
        ?.devToolsVisible,
    "docked DevTools mounts",
  );
  await invoke("devtools", { close: true });
  await waitFor(
    async () =>
      !(await invoke("native-diagnostics")).tabs.find((t) => t.id === first)
        ?.devToolsVisible,
    "DevTools closes and restores page layout",
  );
  checks.push("native docked DevTools opens and closes within the page pane");
  await invoke("new-tab", { url: WING_TEST.base + "/draft" });
  const draft = (await snapshot()).activeTabId;
  await waitFor(
    async () =>
      (await snapshot()).tabs.find((t) => t.id === draft)?.title ===
      "Fixture /draft",
    "draft fixture loads",
  );
  await evaluate(
    draft,
    "(document.querySelector('input').value='unsaved draft')",
  );
  await invoke("new-tab", { url: WING_TEST.base + "/sleep" });
  const sleeper = (await snapshot()).activeTabId;
  await waitFor(
    async () =>
      (await snapshot()).tabs.find((t) => t.id === sleeper)?.title ===
      "Fixture /sleep",
    "sleep fixture loads",
  );
  await waitFor(
    async () => !(await snapshot()).tabs.find((t) => t.id === sleeper)?.loading,
    "sleep fixture finishes loading before discard",
  );
  // An editor nobody typed in must not keep a page awake; a typed one must.
  await evaluate(
    sleeper,
    "(document.body.append(Object.assign(document.createElement('div'),{contentEditable:'true'})),true)",
  );
  await invoke("new-tab", { url: WING_TEST.base + "/editor" });
  const editor = (await snapshot()).activeTabId;
  await waitFor(
    async () =>
      (await snapshot()).tabs.find((t) => t.id === editor)?.title ===
      "Fixture /editor",
    "editor fixture loads",
  );
  await evaluate(
    editor,
    "(()=>{const e=Object.assign(document.createElement('div'),{contentEditable:'true',textContent:'unsaved draft'});document.body.append(e);return e.dispatchEvent(new Event('input',{bubbles:true}))})()",
  );
  await invoke("select-tab", { id: first });
  await invoke("trim-memory");
  await waitFor(
    async () =>
      (await invoke("native-diagnostics")).tabs.find((t) => t.id === sleeper)
        ?.discarded,
    "clean background page sleeps",
  );
  const lifecycle = (await invoke("native-diagnostics")).tabs;
  assert(
    !lifecycle.find((t) => t.id === editor)?.discarded,
    "typed editor remains live",
  );
  assert(
    !lifecycle.find((t) => t.id === draft)?.discarded,
    "unsaved input remains live",
  );
  assert(
    !lifecycle.find((t) => t.id === first)?.discarded,
    "active split remains live",
  );
  await invoke("select-tab", { id: sleeper });
  await waitFor(
    async () =>
      !(await invoke("native-diagnostics")).tabs.find((t) => t.id === sleeper)
        ?.discarded,
    "sleeping page wakes on selection",
  );
  await invoke("select-tab", { id: first });
  await waitFor(
    async () => !(await snapshot()).tabs.find((t) => t.id === sleeper)?.loading,
    "woken page finishes loading before automatic archive",
  );
  await invoke("native-archive-idle", { now: Date.now() + 13 * 3600000 });
  await waitFor(
    async () => (await snapshot()).archive.some((t) => t.id === sleeper),
    "idle clean tab archives only after its native page closes",
  );
  assert(
    (await snapshot()).tabs.some((t) => t.id === draft),
    "automatic archive protects unfinished forms",
  );
  assert(
    (await snapshot()).tabs.some((t) => t.id === first),
    "automatic archive protects active split",
  );
  checks.push(
    "automatic archive closes idle native pages while protecting active splits and unfinished forms",
  );
  await invoke("close-tab", { id: draft });
  await invoke("select-tab", { id: first });
  checks.push(
    "native memory trimming sleeps clean background pages, protects drafts and active splits, and wakes on selection",
  );
  await invoke("native-evaluate", {
    id: first,
    userGesture: true,
    script: `window.open(${JSON.stringify(WING_TEST.base + "/child")}, '_blank')`,
  });
  await waitFor(
    async () =>
      (await snapshot()).tabs.some((t) => t.url === WING_TEST.base + "/child"),
    "page-created tab enters workspace",
  );
  const child = (await snapshot()).tabs.find(
    (t) => t.url === WING_TEST.base + "/child",
  );
  await waitFor(
    async () =>
      (await invoke("native-diagnostics")).tabs.some(
        (t) => t.id === child.id && t.url === child.url,
      ),
    "page-created tab survives workspace handoff",
  );
  await invoke("select-tab", { id: child.id });
  await waitFor(
    async () =>
      (await snapshot()).tabs.find((t) => t.id === child.id)?.title ===
      "Fixture /child",
    "page-created tab loads normally",
  );
  await invoke("close-tab", { id: child.id });
  await invoke("select-tab", { id: first });
  checks.push(
    "page-created tabs retain their native contents across workspace registration",
  );
  const sources = await invoke("browser-profiles");
  assert(
    sources.profiles.length === 3 &&
      sources.profiles.some((p) => p.id === "chrome:Default") &&
      sources.profiles.some((p) => p.id === "wing:default"),
    "import helper discovers only the fixture source",
  );
  const imported = await invoke("browser-import", {
    source: "chrome:Default",
    options: { bookmarks: true, cookies: true },
  });
  assert(
    imported.report.bookmarks === 1 && imported.report.cookies === 1,
    "native importer transfers bookmarks and cookies",
  );
  await waitFor(
    async () =>
      (await snapshot()).tabs.some(
        (t) => t.url === WING_TEST.base + "/imported",
      ),
    "imported workspace reaches UI",
  );
  const importedTab = (await snapshot()).tabs.find(
    (t) => t.url === WING_TEST.base + "/imported",
  );
  await invoke("select-tab", { id: importedTab.id });
  await waitFor(
    async () =>
      (await snapshot()).tabs.find((t) => t.id === importedTab.id)?.title ===
      "Fixture /imported",
    "imported profile loads fixture",
  );
  assert(
    (await evaluate(importedTab.id, "document.cookie")).includes(
      "imported-session=fixture-account",
    ),
    "imported cookie is available only in new profile",
  );
  assert(
    !(await evaluate(importedTab.id, "document.cookie")).includes(
      "wing-profile=personal",
    ),
    "import remains isolated from existing signed-in profile",
  );
  await invoke("space", { id: personal });
  await invoke("select-tab", { id: first });
  checks.push(
    "short-lived importer transfers fixture cookies and bookmarks into a fresh profile while preserving the source",
  );
  const legacyImport = await invoke("browser-import", {
    source: "wing:default",
    options: {
      bookmarks: true,
      tabs: true,
      cookies: true,
      passwords: WING_TEST.sourceEngine,
    },
  });
  assert(
    legacyImport.report.bookmarks === 2 &&
      legacyImport.report.cookies === 1 &&
      legacyImport.report.archivedTabs === 1,
    "legacy Wing data imports through the native host",
  );
  if (WING_TEST.sourceEngine)
    assert(
      legacyImport.report.passwords === 1,
      "legacy encrypted vault is imported into Chromium's password store",
    );
  const legacyState = await snapshot();
  const legacyTab = legacyState.tabs.find(
    (t) => t.url === WING_TEST.base + "/legacy-a",
  );
  const legacyGroup = legacyState.splits.find((g) =>
    g.tabIds.includes(legacyTab.id),
  );
  assert(
    legacyGroup.orientation === "vertical" && legacyGroup.weights[0] === 0.4,
    "legacy split layout survives the private import pipe and native merge",
  );
  const legacyFolder = legacyState.folders.find(
    (f) => f.id === legacyTab.folderId,
  );
  assert(
    legacyState.folders.find((f) => f.id === legacyFolder.parentId)?.name ===
      "Legacy research",
    "legacy nested folder hierarchy survives migration",
  );
  assert(
    legacyState.archive.some(
      (t) => t.url === WING_TEST.base + "/legacy-archived",
    ),
    "legacy archived tabs remain recoverable",
  );
  await invoke("select-tab", { id: legacyTab.id });
  await waitFor(
    async () =>
      (await invoke("native-diagnostics")).tabs.some(
        (t) => t.id === legacyTab.id && t.visible,
      ),
    "legacy profile completes protection startup before opening its pages",
  );
  await waitFor(
    async () =>
      (await evaluate(legacyTab.id, "document.cookie"))?.includes(
        "legacy-session=legacy-fixture-account",
      ),
    "legacy account cookie reaches only its fresh native profile",
  );
  await invoke("select-tab", { id: first });
  checks.push(
    "legacy Wing Spaces, nested folders, pinned splits, archive and cookies migrate without overwriting source profiles",
  );
  await invoke("close-tab", { id: first });
  await waitFor(
    async () =>
      (await snapshot()).tabs
        .filter((tab) => [first, second].includes(tab.id))
        .every((tab) => tab.closed),
    "closing saved split releases pages but keeps destinations",
  );
  await invoke("select-tab", { id: first });
  await waitFor(
    async () =>
      (await invoke("native-diagnostics")).tabs.filter((tab) => tab.visible)
        .length === 2,
    "saved split reopens both native pages",
  );
  checks.push(
    "closing a saved split preserves its destinations and reopening recreates pages",
  );
  // Developer overrides reach the page through the DevTools protocol.
  await invoke("new-tab", { url: WING_TEST.base + "/dev" });
  const devTab = (await snapshot()).activeTabId;
  await waitFor(
    async () => (await evaluate(devTab, "document.readyState")) === "complete",
    "developer test page loads",
  );
  const devApplied = await invoke("dev", { id: devTab, tool: "scheme", value: "dark" });
  assert(devApplied.ok && /dark/.test(devApplied.message), "scheme override reports");
  assert(
    await evaluate(devTab, "matchMedia('(prefers-color-scheme: dark)').matches"),
    "scheme override reaches the page",
  );
  await invoke("dev", { id: devTab, tool: "device", value: "iphone" });
  await waitFor(
    async () => (await evaluate(devTab, "screen.width")) === 390,
    "device override resizes the page",
  );
  await invoke("dev", { id: devTab, tool: "device" });
  await invoke("dev", { id: devTab, tool: "agent", value: "firefox" });
  await waitFor(
    async () => /Firefox/.test(await evaluate(devTab, "navigator.userAgent")),
    "user agent override reaches the page",
  );
  await invoke("dev", { id: devTab, tool: "agent" });
  await waitFor(
    async () => !/Firefox/.test(await evaluate(devTab, "navigator.userAgent")),
    "user agent override clears",
  );
  await invoke("dev", { id: devTab, tool: "cache" });
  await invoke("dev", { id: devTab, tool: "cache" });
  await invoke("dev", { id: devTab, tool: "network", value: "fast3g" });
  await invoke("dev", { id: devTab, tool: "network" });
  await invoke("dev-reload", { id: devTab });
  checks.push("developer overrides apply and clear on the native engine");
  for (const path of ["/visible-a", "/visible-b"]) {
    await invoke("new-tab", { url: WING_TEST.base + path });
    const id = (await snapshot()).activeTabId;
    await waitFor(
      async () => (await evaluate(id, "location.pathname")) === path,
      `${path} loads`,
    );
    await waitFor(
      async () => (await evaluate(id, "document.visibilityState")) === "visible",
      `${path} becomes visible when activated`,
    );
  }
  checks.push("each newly activated page tab becomes visible");
  const { servers } = await invoke("local-servers");
  const basePort = Number(new URL(WING_TEST.base).port);
  assert(
    servers.some((server) => server.port === basePort),
    `local servers lists the test server: ${JSON.stringify(servers)}`,
  );
  checks.push("local servers are listed through the tool bridge");
  // Pull Requests is a shell page, so it must never get a native page.
  await invoke("pulls-open");
  let pullsState = await snapshot();
  const pullsTab = pullsState.tabs.find((tab) => tab.url === "wing://pulls");
  assert(pullsTab && pullsState.activeTabId === pullsTab.id, "pull requests tab opens");
  assert(
    !(await invoke("native-diagnostics")).tabs.some((tab) => tab.id === pullsTab.id),
    "pull requests has no native page",
  );
  await invoke("pulls-open");
  pullsState = await snapshot();
  assert(
    pullsState.tabs.filter((tab) => tab.url === "wing://pulls").length === 1,
    "pull requests tab is not duplicated",
  );
  await invoke("select-tab", { id: devTab });
  checks.push("pull requests opens as a single shell tab");
  // A mini window stays out of the tab list and honors the chosen profile.
  const tabsBeforeMini = (await snapshot()).tabs.length;
  const miniState = await snapshot();
  const miniSpace = miniState.spaces[miniState.spaces.length - 1];
  await invoke("mini-window", { url: WING_TEST.base + "/mini" });
  await invoke("native-minis", { close: true });
  await window.wing.invoke("features-settings", { linksInMini: true });
  await invoke("external-url", { url: WING_TEST.base + "/mini-link" });
  await waitFor(
    async () =>
      (await invoke("native-minis")).windows.some(
        (mini) => mini.url === WING_TEST.base + "/mini-link" && mini.visible,
      ),
    "external link opens in a mini window",
  );
  const [miniWindow] = (await invoke("native-minis")).windows;
  const expectedProfile = miniState.spaces.find((s) => s.id === miniWindow.spaceId)?.profileId;
  assert(
    miniWindow.profile.endsWith(expectedProfile),
    `mini window uses its space's profile: ${JSON.stringify(miniWindow)} ${miniSpace.id}`,
  );
  assert((await snapshot()).tabs.length === tabsBeforeMini, "mini window adds no tab");
  await waitFor(
    async () =>
      (await invoke("library-data")).history.some(
        (entry) => entry.url === WING_TEST.base + "/mini-link",
      ),
    "mini window visit reaches history",
  );
  await invoke("mini-expand", {
    url: WING_TEST.base + "/mini-link",
    spaceId: miniWindow.spaceId,
  });
  await waitFor(
    async () => {
      const state = await snapshot();
      return state.tabs.find((tab) => tab.id === state.activeTabId)?.url ===
        WING_TEST.base + "/mini-link";
    },
    "mini window expands into a tab",
  );
  await invoke("native-minis", { close: true });
  await waitFor(
    async () => (await invoke("native-minis")).windows.length === 0,
    "mini windows close cleanly",
  );
  await invoke("features-settings", { linksInMini: false });
  checks.push("mini window opens links, keeps its profile, records history and expands");
  await invoke("features-settings", { appIcon: "ocean" });
  assert((await snapshot()).settings.appIcon === "ocean", "app icon setting saves");
  const iconLoaded = await new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image.naturalWidth > 0);
    image.onerror = () => resolve(false);
    image.src = "../assets/icons/ocean.png";
  });
  assert(iconLoaded, "app icon previews load in the native shell");
  checks.push("app icon setting saves and its previews load");
  // The restart phase expects the saved split to be what was on screen.
  await invoke("select-tab", { id: first });
  await waitFor(
    async () =>
      (await invoke("native-diagnostics")).tabs.filter((tab) => tab.visible).length === 2,
    "saved split is back on screen",
  );
  post(
    "result",
    JSON.stringify({
      passed: true,
      checks,
      chromium: initial.versions.chrome,
      legacyPasswordProfileId: WING_TEST.sourceEngine
        ? legacyImport.profileId
        : undefined,
    }),
  );
})().catch(async (error) => {
  let diagnostics;
  try {
    diagnostics = await window.wing.invoke("native-diagnostics");
  } catch {}
  post(
    "result",
    JSON.stringify({
      passed: false,
      error: String(error),
      stack: error.stack,
      diagnostics,
      toast: document.querySelector("#toast")?.textContent,
    }),
  );
});
