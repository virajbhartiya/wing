#!/usr/bin/env node
"use strict";

// Build alongside the installed app, then swap only after packaging succeeds.
// No profile, browser state, signing credentials, or native vendor tree is copied.
const fs = require("node:fs/promises");
const path = require("node:path");
const ROOT = path.resolve(__dirname, "..");
const RELEASE = path.join(ROOT, "release");
const ALLOWED = new Set([
  "src",
  "assets",
  "node_modules",
  "package.json",
  "package-lock.json",
  "LICENSE",
  "LICENSE-MIT",
  "THIRD_PARTY_NOTICES.md",
]);
function ignore(file) {
  const relative = file.replaceAll("\\", "/").replace(/^\/+/, "");
  return relative !== "" && !ALLOWED.has(relative.split("/")[0]);
}
async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}
async function main() {
  if (process.platform !== "darwin")
    throw Error("This package target requires macOS.");
  const signedRelease = process.env.WING_RELEASE === "1";
  const identity = process.env.WING_SIGN_IDENTITY;
  const notaryProfile = process.env.WING_NOTARY_PROFILE;
  const updateFeed = process.env.WING_UPDATE_FEED;
  if (
    signedRelease &&
    (!identity?.startsWith("Developer ID Application:") ||
      !notaryProfile ||
      !require("../src/updates.cjs").validFeed(updateFeed))
  )
    throw Error(
      "Signed release requires WING_SIGN_IDENTITY (Developer ID Application), WING_NOTARY_PROFILE, and an HTTPS WING_UPDATE_FEED.",
    );
  const { packager } = await import("@electron/packager");
  const manifest = JSON.parse(
    await fs.readFile(path.join(ROOT, "package.json"), "utf8"),
  );
  await fs.mkdir(RELEASE, { recursive: true });
  const stage = await fs.mkdtemp(path.join(RELEASE, ".wing-electron-"));
  const destination = path.join(RELEASE, "Wing.app");
  const previousRoot = path.join(RELEASE, "previous-builds");
  const previous = path.join(previousRoot, `${path.basename(stage)}.app`);
  let previousMoved = false;
  try {
    const outputs = await packager({
      dir: ROOT,
      name: "Wing",
      platform: "darwin",
      arch: "arm64",
      out: stage,
      appBundleId: "org.wingbrowser.Wing",
      appVersion: manifest.version,
      buildVersion: manifest.version,
      osxSign: signedRelease ? { identity } : undefined,
      beforeAsar: [
        async ({ buildPath }) => {
          await fs.writeFile(
            path.join(buildPath, "src/release-config.json"),
            JSON.stringify({
              signedRelease,
              updateFeed: signedRelease ? updateFeed : null,
            }),
          );
        },
      ],
      icon: path.join(ROOT, "assets", "wing.icns"),
      executableName: "Wing",
      asar: true,
      prune: true,
      ignore,
      overwrite: false,
      extendInfo: {
        CFBundleURLTypes: [
          {
            CFBundleURLName: "Web addresses",
            CFBundleTypeRole: "Viewer",
            CFBundleURLSchemes: ["http", "https"],
          },
        ],
        NSCameraUsageDescription:
          "Websites can request your permission to use the camera.",
        NSMicrophoneUsageDescription:
          "Websites can request your permission to use the microphone.",
      },
    });
    if (outputs.length !== 1) throw Error("Expected one macOS arm64 package.");
    const packagedApp = path.join(outputs[0], "Wing.app");
    if (!(await exists(path.join(packagedApp, "Contents", "MacOS", "Wing")))) {
      throw Error("Packager did not produce the expected Wing executable.");
    }
    if (signedRelease) {
      const { notarize } = await import("@electron/notarize");
      await notarize({ appPath: packagedApp, keychainProfile: notaryProfile });
      const { execFile } = require("node:child_process");
      const run = require("node:util").promisify(execFile);
      await run("/usr/bin/xcrun", ["stapler", "validate", packagedApp]);
      await run("/usr/bin/codesign", [
        "--verify",
        "--deep",
        "--strict",
        packagedApp,
      ]);
      const zip = path.join(RELEASE, `Wing-${manifest.version}-mac-arm64.zip`);
      await run("/usr/bin/ditto", [
        "-c",
        "-k",
        "--sequesterRsrc",
        "--keepParent",
        packagedApp,
        zip,
      ]);
      console.log(`Signed and notarized update archive: ${zip}`);
    }
    if (await exists(destination)) {
      await fs.mkdir(previousRoot, { recursive: true });
      await fs.rename(destination, previous);
      previousMoved = true;
    }
    try {
      await fs.rename(packagedApp, destination);
    } catch (error) {
      if (previousMoved) await fs.rename(previous, destination);
      throw error;
    }
    console.log(`Built: ${destination}`);
    if (previousMoved) console.log(`Previous app preserved: ${previous}`);
    console.log(
      signedRelease
        ? "Signed, notarized release with configured update feed."
        : "Local build. Signed updates require release credentials and an HTTPS feed.",
    );
  } finally {
    await fs.rm(stage, { recursive: true, force: true });
  }
}
if (require.main === module)
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
module.exports = { ignore };
