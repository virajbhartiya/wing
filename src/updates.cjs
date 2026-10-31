"use strict";
function validFeed(value) {
  if (typeof value !== "string") return false;
  try {
    const u = new URL(value);
    return u.protocol === "https:" && !u.username && !u.password && !u.hash;
  } catch {
    return false;
  }
}
class UpdateController {
  constructor({ updater, app, config, onStatus = () => {} }) {
    this.updater = updater;
    this.app = app;
    this.onStatus = onStatus;
    this.timer = null;
    this.enabled =
      app.isPackaged &&
      config.signedRelease === true &&
      validFeed(config.updateFeed);
    this.status = {
      state: this.enabled ? "idle" : "unconfigured",
      message: this.enabled
        ? "Updates ready."
        : "This local build has no signed update channel.",
    };
    if (!this.enabled) return;
    updater.setFeedURL({ url: config.updateFeed });
    for (const [event, state, message] of [
      ["checking-for-update", "checking", "Checking for updates…"],
      ["update-available", "downloading", "Downloading a signed update…"],
      ["update-not-available", "current", "Wing is up to date."],
      ["update-downloaded", "ready", "Update ready. Restart Wing to install."],
    ])
      updater.on(event, () => this.set({ state, message }));
    updater.on("error", () =>
      this.set({
        state: "error",
        message: "Update check failed. Your current installation is unchanged.",
      }),
    );
  }
  set(value) {
    this.status = value;
    this.onStatus(value);
  }
  check() {
    if (!this.enabled) return this.status;
    if (["checking", "downloading", "ready"].includes(this.status.state))
      return this.status;
    this.set({ state: "checking", message: "Checking for updates…" });
    try {
      this.updater.checkForUpdates();
    } catch {
      this.set({ state: "error", message: "Update check failed." });
    }
    return this.status;
  }
  start() {
    if (!this.enabled) return;
    this.timer = setInterval(() => this.check(), 6 * 60 * 60 * 1000);
    this.timer.unref();
    this.check();
  }
  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }
  install() {
    if (this.status.state !== "ready")
      throw Error("No verified update is ready.");
    this.updater.quitAndInstall();
  }
}
module.exports = { UpdateController, validFeed };
