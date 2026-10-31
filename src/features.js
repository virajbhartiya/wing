"use strict";
// Trusted-shell controls. Remote web pages never load this script.
(() => {
  const selected = new Set();
  let anchor = null;
  const command = (label, run, detail = "Browser action") => ({
    label,
    detail,
    glyph: "settings",
    run,
  });
  const perform = (name, data = {}) => {
    closeModal();
    return act(name, data);
  };
  function options(items, value) {
    return items
      .map(
        ([id, name]) =>
          `<option value="${esc(id)}" ${id === value ? "selected" : ""}>${esc(name)}</option>`,
      )
      .join("");
  }
  function showPreferences() {
    const s = state.settings;
    showModal(
      "features",
      `<div class="dialog-content">${dialogHead("Browsing & workspace")}<label class="setting-row"><span>Appearance</span><select id="appearance">${options(
        [
          ["system", "Follow system"],
          ["light", "Light"],
          ["dark", "Dark"],
        ],
        s.appearance || (s.dark ? "dark" : "light"),
      )}</select></label><label class="setting-row"><span>Hide top toolbar</span><input id="toolbar-hidden" type="checkbox" ${s.toolbarHidden ? "checked" : ""}></label><label class="setting-row"><span>Collapse pinned section</span><input id="pins-collapsed" type="checkbox" ${s.pinnedCollapsed ? "checked" : ""}></label><label class="setting-row"><span>Remove tracking parameters when copying links</span><input id="clean-copy" type="checkbox" ${s.cleanCopy !== false ? "checked" : ""}></label>${window.wing.engine === "chromium" ? `<label class="setting-row"><span>Automatic picture-in-picture<small>Let eligible playing videos follow you when switching tabs.</small></span><input id="automatic-pip" type="checkbox" ${s.automaticPictureInPicture ? "checked" : ""}></label>` : ""}<div class="setting-row"><span>Download folder<small>${esc(s.downloadDirectory || "Ask when downloading")}</small></span><button id="download-directory" class="secondary">Choose folder</button></div><div class="setting-row"><span>Default web browser</span><button id="make-default" class="secondary">Set Wing as default</button></div><div class="dialog-actions"><button id="search-settings" class="secondary">Site searches</button><button id="routing-settings" class="secondary">Link routing</button><button id="folders-settings" class="secondary">Folders</button></div></div>`,
    );
    $("#appearance").onchange = (e) =>
      act("features-settings", { appearance: e.target.value });
    $("#toolbar-hidden").onchange = (e) =>
      act("features-settings", { toolbarHidden: e.target.checked });
    $("#pins-collapsed").onchange = (e) =>
      act("features-settings", { pinnedCollapsed: e.target.checked });
    $("#clean-copy").onchange = (e) =>
      act("features-settings", { cleanCopy: e.target.checked });
    if ($("#automatic-pip"))
      $("#automatic-pip").onchange = (e) =>
        act("features-settings", {
          automaticPictureInPicture: e.target.checked,
        });
    $("#download-directory").onclick = () =>
      act("features-directory").then(showPreferences);
    $("#make-default").onclick = async () => {
      const r = await act("default-browser");
      toast(
        r?.ok
          ? "Default-browser request sent to macOS."
          : "macOS could not set the default browser.",
      );
    };
    $("#search-settings").onclick = showSearches;
    $("#routing-settings").onclick = showRoutes;
    $("#folders-settings").onclick = showFolders;
  }
  function showSearches() {
    const engines = state.settings.siteSearches || [];
    showModal(
      "searches",
      `<form class="dialog-content" id="site-search-form">${dialogHead("Site searches")}<p>Enter a keyword, then a space and your query in the command bar. For example: <strong>yt cats</strong>.</p>${engines.map((e, i) => `<div class="setting-row"><span>${esc(e.name)}<small>${esc(e.keyword)} · ${esc(e.url)}</small></span><button type="button" class="secondary" data-remove-search="${i}">Remove</button></div>`).join("")}<label class="field"><span>Name</span><input name="name" required maxlength="80" placeholder="YouTube"></label><label class="field"><span>Keyword</span><input name="keyword" required pattern="(?:[a-zA-Z0-9_]|-){1,20}" placeholder="yt"></label><label class="field"><span>HTTPS search URL (%s is the query)</span><input name="url" required placeholder="https://www.youtube.com/results?search_query=%s"></label><div class="dialog-actions"><button class="primary">Add search</button></div></form>`,
    );
    $("#site-search-form").onsubmit = async (e) => {
      e.preventDefault();
      const item = Object.fromEntries(new FormData(e.target));
      const r = await act("features-settings", {
        siteSearches: [
          ...engines.filter((x) => x.keyword !== item.keyword),
          item,
        ],
      });
      if (!r?.error) showSearches();
    };
    document.querySelectorAll("[data-remove-search]").forEach(
      (b) =>
        (b.onclick = async () => {
          await act("features-settings", {
            siteSearches: engines.filter(
              (_, i) => i !== Number(b.dataset.removeSearch),
            ),
          });
          showSearches();
        }),
    );
  }
  function showRoutes() {
    const routes = state.settings.routes || [];
    showModal(
      "routes",
      `<form class="dialog-content" id="routes-form">${dialogHead("Link routing")}<p>Route external links to a Space. Rules are checked from top to bottom.</p>${routes.map((r, i) => `<div class="setting-row"><span>${esc(r.type)} ${esc(r.value)}<small>${esc(state.spaces.find((s) => s.id === r.spaceId)?.name || "Removed Space")}</small></span><button type="button" class="secondary" data-remove-route="${i}">Remove</button></div>`).join("")}<label class="field"><span>Match</span><select name="type">${options(
        [
          ["host", "Domain and subdomains"],
          ["equals", "Exact URL"],
          ["contains", "URL contains"],
        ],
        "host",
      )}</select></label><label class="field"><span>Domain or URL</span><input name="value" required placeholder="github.com"></label><label class="field"><span>Destination Space</span><select name="spaceId">${options(
        state.spaces.map((s) => [s.id, s.name]),
        state.activeSpaceId,
      )}</select></label><div class="dialog-actions"><button class="primary">Add route</button></div></form>`,
    );
    $("#routes-form").onsubmit = async (e) => {
      e.preventDefault();
      const r = await act("features-settings", {
        routes: [...routes, Object.fromEntries(new FormData(e.target))],
      });
      if (!r?.error) showRoutes();
    };
    document.querySelectorAll("[data-remove-route]").forEach(
      (b) =>
        (b.onclick = async () => {
          await act("features-settings", {
            routes: routes.filter(
              (_, i) => i !== Number(b.dataset.removeRoute),
            ),
          });
          showRoutes();
        }),
    );
  }
  async function showSiteControls() {
    const data = await act("site-controls");
    if (!data?.origin || !/^https?:/.test(data.origin)) {
      toast("Open a website first.");
      return;
    }
    showModal(
      "site-controls",
      `<div class="dialog-content">${dialogHead("Site controls")}<p>${esc(data.origin)}</p>${data.permissions
        .map(
          (p) =>
            `<label class="setting-row"><span>${esc(p.permission)}</span><select data-permission="${p.permission}">${options(
              [
                ["ask", "Ask"],
                ["allow", "Allow"],
                ["block", "Block"],
              ],
              p.value,
            )}</select></label>`,
        )
        .join(
          "",
        )}<p>Permission changes apply to new requests. Reload the page to apply them to an existing session.</p><div class="dialog-actions"><button id="site-reload" class="secondary">Reload</button><button id="clear-site-data" class="danger">Clear this site’s data</button></div></div>`,
    );
    document.querySelectorAll("[data-permission]").forEach(
      (el) =>
        (el.onchange = () =>
          act("site-permission", {
            permission: el.dataset.permission,
            value: el.value,
          })),
    );
    $("#clear-site-data").onclick = () => perform("clear-site-data");
    $("#site-reload").onclick = () => perform("reload");
  }
  function editFolder(folder = null) {
    showModal(
      "folder-edit",
      `<form class="dialog-content" id="folder-edit-form">${dialogHead(folder ? "Edit folder" : "New folder")}<label class="field"><span>Name</span><input name="name" value="${esc(folder?.name || "")}" required maxlength="80"></label><label class="field"><span>Parent folder</span><select name="parentId">${options([["", "Top level"], ...state.folders.filter((f) => f.spaceId === state.activeSpaceId && f.id !== folder?.id).map((f) => [f.id, f.name])], folder?.parentId || "")}</select></label><div class="dialog-actions"><button class="primary">Save folder</button></div></form>`,
    );
    $("#folder-edit-form").onsubmit = async (e) => {
      e.preventDefault();
      const r = await act("save-folder", {
        ...Object.fromEntries(new FormData(e.target)),
        id: folder?.id,
      });
      if (!r?.error) showFolders();
    };
  }
  function showFolders() {
    const folders = state.folders.filter(
      (f) => f.spaceId === state.activeSpaceId,
    );
    showModal(
      "folders",
      `<div class="dialog-content">${dialogHead("Folders")}<p>Removing a folder keeps its tabs.</p>${folders.map((f) => `<div class="setting-row"><span>${esc(f.name)}<small>${esc(state.folders.find((p) => p.id === f.parentId)?.name || "Top level")}</small></span><button class="secondary" data-edit-folder="${f.id}">Edit</button><button class="secondary" data-delete-folder="${f.id}">Remove</button></div>`).join("")}<div class="dialog-actions"><button id="create-folder" class="primary">New folder</button><button id="undo-folder" class="secondary">Undo</button></div></div>`,
    );
    $("#create-folder").onclick = () => editFolder();
    $("#undo-folder").onclick = async () => {
      await act("organization-undo");
      showFolders();
    };
    document
      .querySelectorAll("[data-edit-folder]")
      .forEach(
        (b) =>
          (b.onclick = () =>
            editFolder(folders.find((f) => f.id === b.dataset.editFolder))),
      );
    document.querySelectorAll("[data-delete-folder]").forEach(
      (b) =>
        (b.onclick = async () => {
          await act("remove-folder", { id: b.dataset.deleteFolder });
          showFolders();
        }),
    );
  }
  function selectionUI() {
    for (const el of document.querySelectorAll(".tab[data-tab]"))
      el.classList.toggle("multi-selected", selected.has(el.dataset.tab));
    let bar = $("#selection-actions");
    if (!selected.size) {
      bar?.remove();
      return;
    }
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "selection-actions";
      bar.setAttribute("role", "toolbar");
      bar.setAttribute("aria-label", "Selected tab actions");
      document.body.append(bar);
    }
    bar.innerHTML = `<span>${selected.size} selected</span>${[
      ["pin", "Pin"],
      ["unpin", "Unpin"],
      ["copy", "Copy links"],
      ["close", "Close"],
    ]
      .map(([op, label]) => `<button data-bulk="${op}">${label}</button>`)
      .join(
        "",
      )}<button id="selection-cancel" aria-label="Clear selection">×</button>`;
    bar.querySelectorAll("[data-bulk]").forEach(
      (b) =>
        (b.onclick = async () => {
          await act("bulk-tabs", {
            ids: [...selected],
            operation: b.dataset.bulk,
          });
          selected.clear();
          selectionUI();
        }),
    );
    $("#selection-cancel").onclick = () => {
      selected.clear();
      selectionUI();
    };
  }
  document.addEventListener(
    "click",
    (e) => {
      const tab = e.target.closest(".tab[data-tab]");
      if (!tab || e.target.closest("button")) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey) {
        e.preventDefault();
        e.stopImmediatePropagation();
        const id = tab.dataset.tab;
        if (e.shiftKey && anchor) {
          const ids = tabsForSpace().map((t) => t.id),
            a = ids.indexOf(anchor),
            b = ids.indexOf(id);
          if (a >= 0 && b >= 0)
            ids
              .slice(Math.min(a, b), Math.max(a, b) + 1)
              .forEach((id) => selected.add(id));
        } else {
          selected.has(id) ? selected.delete(id) : selected.add(id);
          anchor = id;
        }
        selectionUI();
      } else if (e.target.closest(".tab-icon")) {
        const t = state.tabs.find((t) => t.id === tab.dataset.tab);
        if (t?.kind !== "today") {
          e.preventDefault();
          e.stopImmediatePropagation();
          act("reset-pin-id", { id: t.id });
        }
      }
    },
    true,
  );
  document.addEventListener("dblclick", (e) => {
    const el = e.target.closest(".tab-title");
    const t =
      el &&
      state.tabs.find((t) => t.id === el.closest("[data-tab]").dataset.tab);
    if (t) {
      e.preventDefault();
      openRename(t.id, t.title);
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && selected.size) {
      selected.clear();
      selectionUI();
    }
  });
  window.wing.onState(() => {
    for (const id of selected)
      if (!state?.tabs.some((t) => t.id === id)) selected.delete(id);
    selectionUI();
  });
  window.wingFeatures = {
    showPreferences,
    showSearches,
    showRoutes,
    showSiteControls,
    showFolders,
    editFolder,
    commands: () => [
      ...(window.wing.engine === "chromium"
        ? [
            command(
              "uBlock Origin settings",
              () => perform("protection-settings"),
              "Filters, exceptions and privacy controls",
            ),
          ]
        : []),
      ...(window.wing.engine === "chromium"
        ? [
            command("Picture-in-picture", () => perform("picture-in-picture")),
            command("Close picture-in-picture", () =>
              perform("picture-in-picture", { close: true }),
            ),
            command("Stop sharing this page", () => perform("stop-sharing")),
            command("Capture full page", () => perform("capture-full-page")),
            command("Capture a region", () => window.wingCapture.open()),
            command("Copy visible page image", () =>
              perform("capture-page", { destination: "clipboard" }),
            ),
          ]
        : []),
      command("Browsing & workspace settings", showPreferences),
      command("Site controls", showSiteControls),
      command("Site searches", showSearches),
      command("Link routing", showRoutes),
      command("Manage folders", showFolders),
      ...[
        ["Print page", "print-page"],
        ["Save page as HTML", "save-page"],
        ["Save page as PDF", "save-pdf"],
        ["Capture visible page", "capture-page"],
        ["Copy clean URL", "copy-clean-url"],
        ["Reset pinned tab", "reset-pin"],
        ["Export Space links", "export-space"],
        ["Undo organization", "organization-undo"],
        ["Redo organization", "organization-redo"],
      ].map(([label, name]) => command(label, () => perform(name))),
      command("Find in page", () => {
        closeModal();
        $("#find-bar").hidden = false;
        $("#find-input").focus();
      }),
      command("Reload page", () => perform("reload")),
      command("Developer tools", () => perform("devtools")),
      command("Restore closed tab", () => perform("restore")),
      command("Clear today", () => perform("clear-today")),
    ],
    downloads(records) {
      return (
        records
          .filter(
            (d) => !d.profileId || d.profileId === currentSpace().profileId,
          )
          .map(
            (d) =>
              `<div class="download-entry"><strong>${esc(d.name)}</strong><small>${esc(d.paused ? "Paused" : d.status)} · ${(d.received / 1048576).toFixed(1)} MB${d.total ? " / " + (d.total / 1048576).toFixed(1) + " MB" : ""}</small><div>${(d.status === "progressing" ? (d.paused ? ["resume", "cancel"] : ["pause", "cancel"]) : d.status === "completed" ? ["open", "show"] : ["retry"]).map((op) => `<button class="secondary" data-download-id="${d.id}" data-download-op="${op}">${esc(op[0].toUpperCase() + op.slice(1))}</button>`).join("")}</div></div>`,
          )
          .join("") || '<div class="empty">No downloads in this profile.</div>'
      );
    },
  };
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-download-op]");
    if (b)
      act("download-control", {
        id: b.dataset.downloadId,
        operation: b.dataset.downloadOp,
      });
  });
})();
