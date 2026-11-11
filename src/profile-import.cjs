"use strict";
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { Worker } = require("node:worker_threads");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const exec = promisify(execFile);
const SOURCES = Object.freeze({
  wing: {
    name: "Wing (Electron)",
    root: "Wing",
    keychain: "Wing Safe Storage",
  },
  chrome: {
    name: "Chrome",
    root: "Google/Chrome",
    keychain: "Chrome Safe Storage",
  },
  brave: {
    name: "Brave",
    root: "BraveSoftware/Brave-Browser",
    keychain: "Brave Safe Storage",
  },
  arc: { name: "Arc", root: "Arc/User Data", keychain: "Arc Safe Storage" },
  // ~/Library/Safari, relative to ~/Library/Application Support.
  safari: { name: "Safari", root: "../Safari" },
});
function webURL(value) {
  try {
    const u = new URL(value);
    return /^https?:$/.test(u.protocol) ? u.href : null;
  } catch {
    return null;
  }
}
async function discoverProfiles(
  base = path.join(os.homedir(), "Library/Application Support"),
) {
  const profiles = [];
  for (const [browser, source] of Object.entries(SOURCES)) {
    const root = path.join(base, source.root);
    if (browser === "safari") {
      // macOS can deny reading this folder, so its existence is enough to offer it.
      if (await fs.stat(root).catch(() => null))
        profiles.push({
          id: "safari:Default",
          browser,
          browserName: source.name,
          directory: "Default",
          name: "Default",
        });
      continue;
    }
    if (browser === "wing") {
      try {
        const file = path.join(root, "workspace.json");
        if ((await fs.stat(file)).size > 16 * 1024 * 1024) continue;
        const state = require("./model.cjs").validateState(
          JSON.parse(await fs.readFile(file, "utf8")),
        );
        for (const profile of state.profiles) {
          const directory = "Partitions/wing-" + profile.id;
          profiles.push({
            id: `wing:${profile.id}`,
            browser,
            browserName: source.name,
            directory,
            profileId: profile.id,
            name: profile.name,
          });
        }
      } catch {}
      continue;
    }
    let cache = {};
    try {
      cache =
        JSON.parse(await fs.readFile(path.join(root, "Local State"), "utf8"))
          .profile?.info_cache || {};
    } catch {}
    let dirs;
    try {
      dirs = await fs.readdir(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const dir of dirs) {
      if (!dir.isDirectory() || !/^(Default|Profile \d+)$/.test(dir.name))
        continue;
      if (
        !(await fs
          .stat(path.join(root, dir.name, "Preferences"))
          .catch(() => null))
      )
        continue;
      profiles.push({
        id: `${browser}:${dir.name}`,
        browser,
        browserName: source.name,
        directory: dir.name,
        name: String(cache[dir.name]?.name || dir.name).slice(0, 100),
      });
    }
  }
  return profiles;
}
async function resolveSource(id, base) {
  const found = (await discoverProfiles(base)).find((p) => p.id === id);
  if (!found)
    throw Error(
      "That browser profile is no longer available. Refresh the list.",
    );
  const root = path.join(
    base || path.join(os.homedir(), "Library/Application Support"),
    SOURCES[found.browser].root,
  );
  return { ...found, root, path: path.join(root, found.directory) };
}
function readProfile(source, options) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, "profile-reader.cjs"), {
      workerData: { source, options },
    });
    const timer = setTimeout(() => {
      worker.terminate();
      reject(Error("Import timed out. Quit the source browser and try again."));
    }, 60000);
    worker.once("message", (m) => {
      clearTimeout(timer);
      m.error ? reject(Error(m.error)) : resolve(m);
    });
    worker.once("error", () => {
      clearTimeout(timer);
      reject(
        Error(
          "Could not read profile data. The source profile was not modified.",
        ),
      );
    });
    worker.once("exit", (code) => {
      clearTimeout(timer);
      if (code) reject(Error("Profile reader stopped unexpectedly."));
    });
  });
}
async function sourceKey(browser) {
  if (process.platform !== "darwin" || !SOURCES[browser])
    throw Error("Login migration currently supports macOS only.");
  let stdout;
  try {
    ({ stdout } = await exec(
      "/usr/bin/security",
      ["find-generic-password", "-s", SOURCES[browser].keychain, "-w"],
      { encoding: "buffer", timeout: 120000, maxBuffer: 4096 },
    ));
  } catch {
    throw Error(
      "Keychain access was denied or the browser key was unavailable. Allow the macOS prompt to import logins.",
    );
  }
  // security emits a single trailing newline. Never log or persist this secret.
  const secret = stdout.subarray(
    0,
    stdout.at(-1) === 10 ? stdout.length - 1 : stdout.length,
  );
  try {
    return crypto.pbkdf2Sync(secret, "saltysalt", 1003, 16, "sha1");
  } finally {
    stdout.fill(0);
  }
}
function decryptV10(value, key, host, version = 0) {
  const buffer = Buffer.from(value);
  if (buffer.subarray(0, 3).toString() !== "v10")
    throw Error("Unsupported source encryption");
  const decipher = crypto.createDecipheriv(
    "aes-128-cbc",
    key,
    Buffer.alloc(16, 32),
  );
  const plain = Buffer.concat([
    decipher.update(buffer.subarray(3)),
    decipher.final(),
  ]);
  try {
    let offset = 0;
    if (host !== undefined && version >= 24) {
      const expected = crypto.createHash("sha256").update(host).digest();
      if (
        plain.length < 32 ||
        !crypto.timingSafeEqual(plain.subarray(0, 32), expected)
      )
        throw Error("Cookie domain authentication failed");
      offset = 32;
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(
      plain.subarray(offset),
    );
  } finally {
    plain.fill(0);
    buffer.fill(0);
  }
}
function cookieDetails(row, key, version, now = Date.now() / 1000) {
  if (row.top_frame_site_key)
    throw Error("Partitioned cookies are not portable through this importer");
  const expires = Number(row.expires_utc) / 1000000 - 11644473600;
  if (row.has_expires && expires <= now) throw Error("Expired cookie");
  const domain = String(row.host_key || "");
  if (!domain || /[\s/:@]/.test(domain)) throw Error("Invalid cookie host");
  const encrypted = Buffer.from(row.encrypted_value || []);
  const value = encrypted.length
    ? decryptV10(encrypted, key, domain, version)
    : String(row.value || "");
  const details = {
    url: `${row.is_secure ? "https" : "http"}://${domain.replace(/^\./, "")}${row.path || "/"}`,
    name: row.name,
    value,
    path: row.path || "/",
    secure: !!row.is_secure,
    httpOnly: !!row.is_httponly,
    sameSite:
      { "-1": "unspecified", 0: "no_restriction", 1: "lax", 2: "strict" }[
        row.samesite
      ] || "unspecified",
  };
  if (domain.startsWith(".")) details.domain = domain;
  if (row.has_expires) details.expirationDate = expires;
  return details;
}
module.exports = {
  discoverProfiles,
  resolveSource,
  readProfile,
  sourceKey,
  decryptV10,
  cookieDetails,
  webURL,
};
