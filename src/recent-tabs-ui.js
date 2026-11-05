/* The native process owns selection and key-release semantics. This view only
 * presents the frozen list and sends pointer intent through the trusted bridge. */
(() => {
  let selectedId = null;
  let rowsKey = "";
  let latest = null;
  // A quick Control-Tab tap switches straight back without ever drawing the bar.
  let showTimer = null;
  const SHOW_DELAY = 150;
  const reset = () => {
    clearTimeout(showTimer);
    showTimer = null;
    latest = null;
    selectedId = null;
    rowsKey = "";
  };
  const present = () => {
    if (!latest) return;
    if (modalType !== "recent-tabs") {
      showModal(
        "recent-tabs",
        '<div class="recent-tabs"><div class="recent-tabs-list" role="listbox" aria-label="Recent tabs" tabindex="0"><span class="recent-tabs-glider" aria-hidden="true"></span><div class="recent-tabs-tiles"></div></div><div class="recent-tabs-title" aria-hidden="true"></div></div>',
      );
      $("#modal").classList.add("recent-tabs-modal");
      rowsKey = "";
    }
    const list = document.querySelector(".recent-tabs-list");
    const tiles = document.querySelector(".recent-tabs-tiles");
    if (!list || !tiles) return;
    const key = latest.tabs.map((tab) => `${tab.id}:${tab.title}`).join("|");
    if (rowsKey !== key) {
      tiles.innerHTML = latest.tabs
        .map(
          (tab, index) =>
            `<div class="recent-tabs-row" id="recent-tab-${index}" role="option" aria-selected="false" aria-label="${esc(tab.title || host(tab.url))}" data-recent-tab="${esc(tab.id)}"><span class="recent-tabs-icon">${tabIcon(tab)}</span></div>`,
        )
        .join("");
      rowsKey = key;
    }
    selectedId = latest.selectedId;
    for (const row of tiles.children) {
      const selected = row.dataset.recentTab === selectedId;
      row.setAttribute("aria-selected", String(selected));
      if (!selected) continue;
      list.setAttribute("aria-activedescendant", row.id);
      const glider = list.querySelector(".recent-tabs-glider");
      // The first placement jumps; later moves glide between tiles.
      glider.classList.toggle("placed", glider.dataset.placed === "1");
      glider.dataset.placed = "1";
      glider.style.transform = `translateX(${row.offsetLeft}px)`;
      row.scrollIntoView({ block: "nearest", inline: "nearest" });
      const tab = latest.tabs.find((t) => t.id === selectedId);
      document.querySelector(".recent-tabs-title").textContent =
        tab?.title || host(tab?.url || "");
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
  };
  window.wing.onCommand((message) => {
    if (message.type === "recent-tabs-close") {
      if (modalType === "recent-tabs") {
        closeModal({ returnToPage: true });
      }
      reset();
      return;
    }
    if (message.type !== "recent-tabs") return;
    latest = message;
    if (modalType === "recent-tabs") present();
    else if (!showTimer) showTimer = setTimeout(present, SHOW_DELAY);
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
      if ((modalType === "recent-tabs" || showTimer) && event.key === "Control") {
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
      if ((modalType === "recent-tabs" || showTimer) && event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        window.wing.invoke("recent-tabs-cancel");
      }
    },
    true,
  );
})();
