"use strict";
// The Electron toolbar element depends on its preload IPC. The native host
// supplies the same UI slot using actual Chromium extension action states.
function installBrowserActions(wing) {
  class NativeBrowserActions extends HTMLElement {
    connectedCallback() {
      if (this.unsubscribe) return;
      this.buttons = new Map();
      this.style.display = "flex";
      this.style.gap = "4px";
      this.refresh = async () => {
        if (this.busy || !this.isConnected || document.hidden) return;
        this.busy = true;
        try {
          const result = await wing.invoke("extension-actions");
          if (!this.isConnected) return;
          const present = new Set();
          // Only pinned extensions sit in the toolbar (the first three until
          // the person picks); every extension is under the puzzle button.
          let pins = null;
          try {
            pins = JSON.parse(localStorage.getItem("wing.extensionPins"));
          } catch {}
          if (!Array.isArray(pins)) pins = null;
          const all = result.extensions,
            shown = all.filter((a, i) => (pins ? pins.includes(a.id) : i < 3));
          if (!this.overflow) {
            this.overflow = document.createElement("button");
            this.overflow.className = "icon-button extension-overflow";
            this.overflow.title = "Extensions";
            this.overflow.setAttribute("aria-label", "Extensions");
            this.overflow.innerHTML =
              '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4.5a2 2 0 1 1 4 0V6h4a1 1 0 0 1 1 1v4h-1.5a2 2 0 1 0 0 4H18v4a1 1 0 0 1-1 1h-4v-1.5a2 2 0 1 0-4 0V20H5a1 1 0 0 1-1-1v-4h1.5a2 2 0 1 0 0-4H4V7a1 1 0 0 1 1-1h4z"/></svg><span class="extension-dot" hidden></span>';
            this.overflow.onclick = () =>
              this.dispatchEvent(new Event("open-menu"));
          }
          // A badge on a hidden extension still deserves a glance.
          this.overflow.querySelector(".extension-dot").hidden = !all.some(
            (a) => a.badgeText && !shown.includes(a),
          );
          this.overflow.hidden = all.length === 0;
          for (const action of shown) {
            present.add(action.id);
            let button = this.buttons.get(action.id);
            if (!button) {
              button = document.createElement("button");
              button.className = "icon-button";
              button.onclick = () =>
                wing
                  .invoke("extension-action", { extensionId: action.id })
                  .catch(() => {});
              this.buttons.set(action.id, button);
              this.append(button);
            }
            const title = action.title || action.name;
            button.title = title;
            button.setAttribute("aria-label", title);
            button.disabled = !action.enabled;
            // The extension's own icon, with its badge over the corner; the
            // initial only when the extension has no usable icon.
            const icon = /^data:image\/(png|jpeg|gif|webp|svg\+xml);/.test(action.icon || "")
              ? action.icon
              : "";
            const key = `${icon}|${action.badgeText}|${action.badgeColor}|${action.badgeTextColor}`;
            if (button.dataset.key !== key) {
              button.dataset.key = key;
              button.replaceChildren();
              button.classList.add("extension-action");
              if (icon) {
                const image = document.createElement("img");
                image.src = icon;
                image.alt = "";
                image.draggable = false;
                button.append(image);
              } else button.append(document.createTextNode(action.name.slice(0, 1)));
              if (action.badgeText) {
                const badge = document.createElement("span");
                badge.className = "extension-badge";
                badge.textContent = action.badgeText;
                if (/^#[0-9a-f]{6,8}$/i.test(action.badgeColor || ""))
                  badge.style.background = action.badgeColor;
                if (/^#[0-9a-f]{6,8}$/i.test(action.badgeTextColor || ""))
                  badge.style.color = action.badgeTextColor;
                button.append(badge);
              }
            }
          }
          for (const [id, button] of this.buttons) {
            if (!present.has(id)) {
              button.remove();
              this.buttons.delete(id);
            }
          }
          // Keep pinned buttons in list order, the puzzle button last.
          for (const action of shown) this.append(this.buttons.get(action.id));
          this.append(this.overflow);
        } finally {
          this.busy = false;
        }
      };
      this.addEventListener("pins-changed", () => this.refresh().catch(() => {}));
      this.unsubscribe = wing.onState(() => this.refresh().catch(() => {}));
      this.timer = setInterval(() => this.refresh().catch(() => {}), 2000);
      this.refresh().catch(() => {});
    }
    disconnectedCallback() {
      this.unsubscribe?.();
      this.unsubscribe = null;
      clearInterval(this.timer);
    }
  }
  customElements.define("browser-action-list", NativeBrowserActions);
}
module.exports = { installBrowserActions };
