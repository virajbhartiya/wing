"use strict";
const AppIcons = require("./app-icons.cjs");
const {
  dialog,
  clipboard,
  shell,
  nativeTheme,
  desktopCapturer,
  app,
} = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const N = require("./navigation.cjs");
const O = require("./organization.cjs");
const Splits = require("./splits.cjs");
const ALLOWED_PERMISSIONS = new Set([
  "media",
  "geolocation",
  "notifications",
  "clipboard-read",
  "fullscreen",
]);
function createBrowserFeatures(api) {
  const journal = new O.OrganizationJournal(),
    items = new Map(),
    sessionGrants = new Map();
  const downloadPaths = new Set();
  const state = () => api.state();
  const commit = () => api.publish(true);
  const currentOrigin = () => {
    try {
      return new URL(api.contents()?.getURL()).origin;
    } catch {
      return null;
    }
  };
  function permissionKey(profile, origin, permission) {
    return JSON.stringify([profile, origin, permission]);
  }
  function configureSession(profile, ses) {
    ses.setPermissionCheckHandler((_wc, permission, origin) => {
      try {
        return (
          (state().sitePermissions?.[
            permissionKey(profile, new URL(origin).origin, permission)
          ] ||
            sessionGrants.get(
              permissionKey(profile, new URL(origin).origin, permission),
            )) === "allow"
        );
      } catch {
        return false;
      }
    });
    ses.setPermissionRequestHandler(
      async (wc, permission, callback, details) => {
        if (!wc || !ALLOWED_PERMISSIONS.has(permission)) return callback(false);
        if (permission === "fullscreen") return callback(true);
        let origin;
        try {
          origin = new URL(details.requestingUrl || wc.getURL()).origin;
        } catch {
          return callback(false);
        }
        if (!/^https?:/.test(origin)) return callback(false);
        const key = permissionKey(profile, origin, permission),
          saved = state().sitePermissions?.[key] || sessionGrants.get(key);
        if (saved) {
          if (saved === "allow") api.permissionGranted?.(wc, permission);
          return callback(saved === "allow");
        }
        const requestingPage = wc.getURL();
        try {
          const result = await dialog.showMessageBox(api.window(), {
            type: "question",
            message: `Allow ${origin} to use ${permission}?`,
            detail: "You can change this decision in Site controls.",
            buttons: ["Block", "Allow"],
            defaultId: 0,
            cancelId: 0,
            checkboxLabel: "Remember for this site",
            checkboxChecked: false,
          });
          if (wc.isDestroyed() || wc.getURL() !== requestingPage)
            return callback(false);
          if (result.checkboxChecked) {
            state().sitePermissions ||= {};
            state().sitePermissions[key] =
              result.response === 1 ? "allow" : "block";
            commit();
          }
          sessionGrants.set(key, result.response === 1 ? "allow" : "block");
          if (result.response === 1) api.permissionGranted?.(wc, permission);
          callback(result.response === 1);
        } catch {
          callback(false);
        }
      },
    );
    ses.setDisplayMediaRequestHandler(async (request, callback) => {
      try {
        if (!request.userGesture) return callback({});
        const sources = await desktopCapturer.getSources({
          types: ["window", "screen"],
          thumbnailSize: { width: 0, height: 0 },
        });
        if (!sources.length) return callback({});
        const result = await dialog.showMessageBox(api.window(), {
          type: "question",
          message: "Choose what to share",
          detail: `${request.securityOrigin} requested screen sharing.`,
          buttons: ["Cancel", ...sources.map((s) => s.name)],
          defaultId: 0,
          cancelId: 0,
        });
        callback(
          result.response > 0 ? { video: sources[result.response - 1] } : {},
        );
      } catch {
        callback({});
      }
    });
    ses.on("will-download", (_event, item) => {
      const record = {
        id: crypto.randomUUID(),
        profileId: profile,
        url: item.getURL(),
        name: item.getFilename(),
        received: 0,
        total: item.getTotalBytes(),
        status: "progressing",
        path: "",
        at: Date.now(),
        paused: false,
      };
      const destination = state().settings.downloadDirectory;
      if (
        destination &&
        path.isAbsolute(destination) &&
        fs.existsSync(destination)
      ) {
        const filename = path.basename(record.name),
          extension = path.extname(filename);
        const stem = filename.slice(0, filename.length - extension.length);
        let target = path.join(destination, filename),
          index = 1;
        while (fs.existsSync(target) || downloadPaths.has(target)) {
          target = path.join(destination, `${stem} (${index++})${extension}`);
        }
        item.setSavePath(target);
        downloadPaths.add(target);
      }
      api.downloads.unshift(record);
      api.downloads.splice(500);
      items.set(record.id, item);
      const update = () => {
        record.received = item.getReceivedBytes();
        record.status = item.getState();
        record.paused = item.isPaused();
        record.path = item.getSavePath();
        state().downloadHistory = api.downloads.map((d) => ({ ...d }));
        commit();
      };
      item.on("updated", update);
      item.once("done", (_event, status) => {
        record.status = status;
        record.path = item.getSavePath();
        items.delete(record.id);
        downloadPaths.delete(record.path);
        state().downloadHistory = api.downloads.map((d) => ({ ...d }));
        commit();
        api.send({
          type: "toast",
          message:
            status === "completed"
              ? `Downloaded ${record.name}`
              : `Download ${status}`,
        });
      });
      update();
    });
  }
  async function handle(name, data) {
    const s = state(),
      wc = api.contents(),
      tab = api.tab();
    switch (name) {
      case "features-settings": {
        const next = {};
        for (const key of [
          "cleanCopy",
          "toolbarHidden",
          "pinnedCollapsed",
          "onboarded",
          "linksInMini",
        ])
          if (typeof data[key] === "boolean") next[key] = data[key];
        if (AppIcons.APP_ICONS.includes(data.appIcon)) {
          next.appIcon = data.appIcon;
          AppIcons.applyAppIcon(data.appIcon);
        }
        if (["system", "light", "dark"].includes(data.appearance)) {
          next.appearance = data.appearance;
          next.dark =
            data.appearance === "system"
              ? nativeTheme.shouldUseDarkColors
              : data.appearance === "dark";
        }
        if (data.siteSearches)
          next.siteSearches = data.siteSearches
            .slice(0, 50)
            .map(N.validateSearch);
        if (data.routes) {
          if (!Array.isArray(data.routes) || data.routes.length > 100)
            throw Error("Too many link routes.");
          next.routes = data.routes.map((r) => {
            if (
              !["host", "equals", "contains"].includes(r.type) ||
              !String(r.value || "").trim() ||
              !s.spaces.some((x) => x.id === r.spaceId)
            )
              throw Error("Invalid link route.");
            return {
              type: r.type,
              value: String(r.value).trim().slice(0, 4000),
              spaceId: r.spaceId,
            };
          });
        }
        if (
          data.defaultSpaceId &&
          s.spaces.some((x) => x.id === data.defaultSpaceId)
        )
          next.defaultSpaceId = data.defaultSpaceId;
        Object.assign(s.settings, next);
        api.layout();
        commit();
        return { ok: true };
      }
      case "features-directory": {
        const r = await dialog.showOpenDialog(api.window(), {
          properties: ["openDirectory", "createDirectory"],
        });
        if (!r.canceled) {
          s.settings.downloadDirectory = r.filePaths[0];
          commit();
        }
        return { ok: true };
      }
      case "download-control": {
        const record = api.downloads.find((d) => d.id === data.id),
          item = items.get(data.id);
        if (!record) throw Error("Download no longer exists.");
        if (data.operation === "retry") {
          if (!/^https?:/.test(record.url))
            throw Error("This download cannot be retried.");
          api.session(record.profileId).downloadURL(record.url);
        } else if (data.operation === "open" && record.status === "completed") {
          const error = await shell.openPath(record.path);
          if (error) throw Error(error);
        } else if (data.operation === "show" && record.path)
          shell.showItemInFolder(record.path);
        else if (item) {
          if (data.operation === "pause") item.pause();
          else if (data.operation === "resume" && item.canResume())
            item.resume();
          else if (data.operation === "cancel") item.cancel();
          else throw Error("Download cannot perform that action.");
          record.paused = item.isPaused();
          commit();
        } else throw Error("This download is no longer active.");
        return { ok: true };
      }
      case "site-controls": {
        const origin = currentOrigin(),
          profile = api.profile();
        return {
          origin,
          permissions: [...ALLOWED_PERMISSIONS]
            .filter((p) => p !== "fullscreen")
            .map((permission) => ({
              permission,
              value:
                s.sitePermissions?.[
                  permissionKey(profile, origin, permission)
                ] || "ask",
            })),
          zoom: wc?.getZoomFactor() || 1,
        };
      }
      case "site-permission": {
        const origin = currentOrigin();
        if (
          !origin ||
          !/^https?:/.test(origin) ||
          !ALLOWED_PERMISSIONS.has(data.permission) ||
          !["ask", "allow", "block"].includes(data.value)
        )
          throw Error("Invalid site permission.");
        s.sitePermissions ||= {};
        const key = permissionKey(api.profile(), origin, data.permission);
        sessionGrants.delete(key);
        if (data.value === "ask") delete s.sitePermissions[key];
        else s.sitePermissions[key] = data.value;
        commit();
        return { ok: true };
      }
      case "clear-site-data": {
        const origin = currentOrigin();
        if (!origin || !/^https?:/.test(origin))
          throw Error("Open a website first.");
        const r = await dialog.showMessageBox(api.window(), {
          type: "warning",
          message: `Clear stored data for ${origin}?`,
          detail:
            "This signs you out and removes this site’s local data. Other sites are unaffected.",
          buttons: ["Cancel", "Clear site data"],
          cancelId: 0,
          defaultId: 0,
        });
        if (r.response === 1) {
          await wc.session.clearStorageData({ origin });
          wc.reload();
        }
        return { ok: true };
      }
      case "print-page":
        if (!wc) throw Error("Open a page first.");
        wc.print({}, (success, reason) => {
          if (!success && reason) api.send({ type: "toast", message: reason });
        });
        return { ok: true };
      case "save-page":
      case "save-pdf":
      case "capture-page": {
        if (!wc) throw Error("Open a page first.");
        const ext =
          name === "save-pdf"
            ? "pdf"
            : name === "capture-page"
              ? "png"
              : "html";
        const r = await dialog.showSaveDialog(api.window(), {
          defaultPath: `${(wc.getTitle() || "Page").replace(/[^\w -]/g, "").slice(0, 80)}.${ext}`,
        });
        if (r.canceled) return { ok: true };
        if (name === "save-pdf")
          fs.writeFileSync(
            r.filePath,
            await wc.printToPDF({ printBackground: true }),
          );
        else if (name === "capture-page")
          fs.writeFileSync(r.filePath, (await wc.capturePage()).toPNG());
        else await wc.savePage(r.filePath, "HTMLComplete");
        return { ok: true };
      }
      case "copy-clean-url":
        clipboard.writeText(N.cleanURL(tab?.url || wc?.getURL()));
        return { ok: true };
      case "copy-text":
        clipboard.writeText(String(data.text || "").slice(0, 100000));
        return { ok: true };
      case "reset-pin":
        if (tab && tab.kind !== "today") {
          api.navigate(tab.homeURL, tab.id);
          api.activate(tab.id);
          api.layout();
          commit();
        }
        return { ok: true };
      case "reset-pin-id": {
        const target = s.tabs.find((t) => t.id === data.id);
        if (target && target.kind !== "today") {
          api.navigate(target.homeURL, target.id);
          api.activate(target.id);
          api.layout();
          commit();
        }
        return { ok: true };
      }
      case "save-folder":
        journal.record(s);
        O.saveFolder(s, data);
        commit();
        return { ok: true };
      case "remove-folder":
        journal.record(s);
        O.removeFolder(s, data.id);
        commit();
        return { ok: true };
      case "organization-undo":
      case "organization-redo":
        journal[name === "organization-undo" ? "undo" : "redo"](s);
        api.resetViews?.();
        api.layout();
        commit();
        return { ok: true };
      case "bulk-tabs": {
        const ids = new Set(
            (Array.isArray(data.ids) ? data.ids : []).flatMap((id) =>
              Splits.members(s, id).map((t) => t.id),
            ),
          ),
          tabs = s.tabs.filter(
            (t) => ids.has(t.id) && api.profile(t) === api.profile(),
          );
        if (!tabs.length) return { ok: true };
        if (data.operation === "copy") {
          clipboard.writeText(tabs.map((t) => N.cleanURL(t.url)).join("\n"));
          return { ok: true };
        }
        if (data.operation === "close") {
          for (const t of tabs) api.closeTab(t.id);
          return { ok: true };
        }
        if (!["pin", "unpin", "folder"].includes(data.operation))
          throw Error("Unknown bulk action.");
        const folder =
          data.operation === "folder"
            ? s.folders.find(
                (f) => f.id === data.folderId && f.spaceId === s.activeSpaceId,
              )
            : null;
        if (data.operation === "folder" && !folder)
          throw Error("Choose a folder in this Space.");
        journal.record(s);
        if (data.operation === "pin" || data.operation === "unpin")
          for (const t of tabs) {
            t.kind = data.operation === "pin" ? "pinned" : "today";
            t.homeURL = t.url;
            if (t.kind === "today") t.folderId = null;
          }
        else if (data.operation === "folder") {
          for (const t of tabs) {
            t.folderId = folder.id;
            t.homeURL = t.url;
            t.kind = "pinned";
            t.spaceId = folder.spaceId;
          }
        } else throw Error("Unknown bulk action.");
        commit();
        return { ok: true };
      }
      case "tab-icon": {
        const t = s.tabs.find((t) => t.id === data.id);
        if (t) {
          journal.record(s);
          t.customIcon = String(data.icon || "").slice(0, 8);
          commit();
        }
        return { ok: true };
      }
      case "default-browser":
        return {
          ok:
            app.setAsDefaultProtocolClient("http") &&
            app.setAsDefaultProtocolClient("https"),
        };
      case "export-space": {
        const space = s.spaces.find((x) => x.id === s.activeSpaceId),
          tabs = s.tabs.filter((t) => t.spaceId === space.id);
        const r = await dialog.showSaveDialog(api.window(), {
          defaultPath: "Wing-links.html",
        });
        if (!r.canceled) {
          const esc = (x) =>
            String(x).replace(
              /[&<>"']/g,
              (c) =>
                ({
                  "&": "&amp;",
                  "<": "&lt;",
                  ">": "&gt;",
                  '"': "&quot;",
                  "'": "&#39;",
                })[c],
            );
          fs.writeFileSync(
            r.filePath,
            `<!doctype html><meta charset="utf-8"><title>${esc(space.name)}</title><h1>${esc(space.name)}</h1><ul>${tabs
              .filter((t) => /^https?:/.test(t.url))
              .map(
                (t) =>
                  `<li><a href="${esc(N.cleanURL(t.url))}">${esc(t.customTitle || t.title)}</a></li>`,
              )
              .join("")}</ul>`,
          );
        }
        return { ok: true };
      }
      default:
        return null;
    }
  }
  nativeTheme.on("updated", () => {
    if (state().settings.appearance === "system") {
      state().settings.dark = nativeTheme.shouldUseDarkColors;
      commit();
    }
  });
  return { handle, configureSession, journal };
}
module.exports = { createBrowserFeatures };
