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
          for (const action of result.extensions) {
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
        } finally {
          this.busy = false;
        }
      };
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
