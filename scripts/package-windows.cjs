#!/usr/bin/env node
"use strict";
// Packages the Electron Wing for Windows from this Mac: a portable zip and a
// per-user installer for each architecture, in dist/windows/.
//
//   node scripts/package-windows.cjs            x64 and arm64
//   node scripts/package-windows.cjs --arch x64
//
// The builds are unsigned, so Windows SmartScreen warns on first run.
// The installer needs NSIS (brew install makensis).
const fs = require("node:fs/promises");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "dist", "windows");
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
const ignore = (file) => {
  const relative = file.replaceAll("\\", "/").replace(/^\/+/, "");
  return relative !== "" && !ALLOWED.has(relative.split("/")[0]);
};

async function main() {
  const flag = process.argv.indexOf("--arch");
  const arches = flag > 0 ? [process.argv[flag + 1]] : ["x64", "arm64"];
  const { packager } = await import("@electron/packager");
  const { version } = JSON.parse(
    await fs.readFile(path.join(ROOT, "package.json"), "utf8"),
  );
  execFileSync("npm", ["run", "-s", "build:preload"], {
    cwd: ROOT,
    stdio: "inherit",
  });
  await fs.rm(OUT, { recursive: true, force: true });
  await fs.mkdir(OUT, { recursive: true });
  const stage = await fs.mkdtemp(path.join(OUT, ".stage-"));
  for (const arch of arches) {
    const [folder] = await packager({
      dir: ROOT,
      name: "Wing",
      platform: "win32",
      arch,
      out: stage,
      appVersion: version,
      buildVersion: version,
      executableName: "Wing",
      icon: path.join(ROOT, "assets", "wing.ico"),
      win32metadata: {
        CompanyName: "Wing",
        FileDescription: "Wing",
        ProductName: "Wing",
        InternalName: "Wing",
        OriginalFilename: "Wing.exe",
      },
      asar: true,
      prune: true,
      ignore,
      beforeAsar: [
        async ({ buildPath }) =>
          fs.writeFile(
            path.join(buildPath, "src/release-config.json"),
            JSON.stringify({ signedRelease: false, updateFeed: null }),
          ),
      ],
    });
    const name = `Wing-${version}-windows-${arch}`;
    execFileSync("ditto", [
      "-c",
      "-k",
      "--keepParent",
      folder,
      path.join(OUT, `${name}.zip`),
    ]);
    execFileSync(
      "makensis",
      [
        "-V2",
        `-DSOURCE=${folder}`,
        `-DOUTFILE=${path.join(OUT, `${name}-setup.exe`)}`,
        `-DVERSION=${version}`,
        `-DICON=${path.join(ROOT, "assets", "wing.ico")}`,
        path.join(ROOT, "scripts", "windows-installer.nsi"),
      ],
      // makensis aborts with bad_alloc when the locale is unset.
      {
        stdio: "inherit",
        env: { ...process.env, LC_ALL: "en_US.UTF-8", LANG: "en_US.UTF-8" },
      },
    );
    console.log(`Built ${name}`);
  }
  await fs.rm(stage, { recursive: true, force: true });
  console.log(`Windows builds are in ${OUT}`);
}
main().catch((error) => {
  console.error(error);
  process.exit(1);
});
