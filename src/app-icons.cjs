"use strict";
const path = require("node:path");
const { APP_ICONS } = require("./interactions.cjs");
const iconFile = (id) =>
  path.join(__dirname, "../assets/icons", `${APP_ICONS.includes(id) ? id : APP_ICONS[0]}.png`);
// macOS only lets a running app change its Dock icon, not the icon on disk.
function applyAppIcon(id) {
  const { app, nativeImage } = require("electron");
  if (!app.dock) return;
  const icon = nativeImage.createFromPath(iconFile(id));
  if (!icon.isEmpty()) app.dock.setIcon(icon);
}
module.exports = { APP_ICONS, iconFile, applyAppIcon };
