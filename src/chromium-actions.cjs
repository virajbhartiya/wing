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
            const label = action.badgeText || action.name.slice(0, 1);
            if (button.textContent !== label) button.textContent = label;
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
