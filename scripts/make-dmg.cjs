#!/usr/bin/env node
"use strict";
// Wraps release/Wing.app in a drag-to-Applications disk image. --install also
// replaces /Applications/Wing.app. Browser profiles live elsewhere and are untouched.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const ROOT = path.resolve(__dirname, "..");
const app = path.join(ROOT, "release", "Wing.app");
const { version } = require("../package.json");
if (!fs.existsSync(app)) throw Error("Run npm run package first.");
// Packaging leaves a stale ad-hoc signature, which Apple silicon can refuse elsewhere.
if (!process.env.WING_SIGN_IDENTITY)
  execFileSync("/usr/bin/codesign", ["--force", "--deep", "--sign", "-", app]);
execFileSync("/usr/bin/codesign", ["--verify", "--deep", "--strict", app]);
const output = path.join(ROOT, "release", `Wing-${version}-mac-arm64.dmg`);
const stage = fs.mkdtempSync(path.join(os.tmpdir(), "wing-dmg-"));
try {
  execFileSync("/usr/bin/ditto", [app, path.join(stage, "Wing.app")]);
  fs.symlinkSync("/Applications", path.join(stage, "Applications"));
  fs.rmSync(output, { force: true });
  execFileSync("/usr/bin/hdiutil", [
    "create",
    "-quiet",
    "-volname",
    "Wing",
    "-srcfolder",
    stage,
    "-format",
    "UDZO",
    output,
  ]);
} finally {
  fs.rmSync(stage, { recursive: true, force: true });
}
console.log(output);
if (process.argv.includes("--install")) {
  const installed = "/Applications/Wing.app",
    staged = "/Applications/.Wing-installing.app";
  fs.rmSync(staged, { recursive: true, force: true });
  execFileSync("/usr/bin/ditto", [app, staged]);
  fs.rmSync(installed, { recursive: true, force: true });
  fs.renameSync(staged, installed);
  console.log(installed);
}
