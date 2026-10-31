/* The native process owns selection and key-release semantics. This view only
 * presents the frozen list and sends pointer intent through the trusted bridge. */
(() => {
  let selectedId = null;
  let rowsKey = "";
  window.wing.onCommand((message) => {
    if (message.type === "recent-tabs-close") {
      if (modalType === "recent-tabs") {
        closeModal();
        requestAnimationFrame(() => {
          if (!modalType) window.wing.invoke("recent-tabs-focus");
        });
      }
      selectedId = null;
      rowsKey = "";
      return;
    }
    if (message.type !== "recent-tabs") return;
    const key = message.tabs.map((tab) => `${tab.id}:${tab.title}`).join("|");
    if (modalType !== "recent-tabs") {
      showModal(
        "recent-tabs",
        '<div class="recent-tabs"><h2>Recent tabs</h2><div class="recent-tabs-list" role="listbox" aria-label="Recent tabs" tabindex="0"></div><p>Hold Control to browse · release to switch · Esc to cancel</p></div>',
      );
      rowsKey = "";
    }
    const list = document.querySelector(".recent-tabs-list");
    if (!list) return;
    if (rowsKey !== key) {
      list.innerHTML = message.tabs
        .map(
          (tab, index) =>
            `<div class="recent-tabs-row" id="recent-tab-${index}" role="option" aria-selected="false" data-recent-tab="${esc(tab.id)}"><span class="recent-tabs-icon">${tabIcon(tab)}</span><span><strong>${esc(tab.title)}</strong><small>${esc(host(tab.url))}</small></span></div>`,
        )
        .join("");
      rowsKey = key;
    }
    selectedId = message.selectedId;
    for (const row of list.children) {
      const selected = row.dataset.recentTab === selectedId;
      row.setAttribute("aria-selected", String(selected));
      if (selected) {
        list.setAttribute("aria-activedescendant", row.id);
        row.scrollIntoView({ block: "nearest" });
      }
    }
    list.onmousemove = (event) => {
      const row = event.target.closest("[data-recent-tab]");
      if (row && row.dataset.recentTab !== selectedId) {
        selectedId = row.dataset.recentTab;
        window.wing.invoke("recent-tabs-preview", { id: selectedId });
      }
    };
    list.onclick = (event) => {
      const row = event.target.closest("[data-recent-tab]");
      if (row)
        window.wing.invoke("recent-tabs-commit", { id: row.dataset.recentTab });
    };
  });
  document.addEventListener(
    "click",
    (event) => {
      if (
        modalType !== "recent-tabs" ||
        event.target !== document.querySelector("#overlay")
      )
        return;
      event.stopImmediatePropagation();
      window.wing.invoke("recent-tabs-cancel");
    },
    true,
  );
  // Chromium on macOS may deliver modifier changes to the renderer rather than
  // before-input-event. Keep release behavior identical on both input paths.
  document.addEventListener(
    "keyup",
    (event) => {
      if (modalType === "recent-tabs" && event.key === "Control") {
        event.preventDefault();
        event.stopImmediatePropagation();
        window.wing.invoke("recent-tabs-commit");
      }
    },
    true,
  );
  document.addEventListener(
    "keydown",
    (event) => {
      if (modalType === "recent-tabs" && event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        window.wing.invoke("recent-tabs-cancel");
      }
    },
    true,
  );
})();
