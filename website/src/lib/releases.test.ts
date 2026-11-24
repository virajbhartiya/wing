import { describe, expect, it } from "vitest";
import fixture from "./fixture-release.json";
import { parseRelease, recommended, CLOUDFRONT } from "./releases";

const release = parseRelease(fixture);

describe("parseRelease", () => {
  it("reads every build from a native.17 release", () => {
    expect(release.version).toBe("0.2.0-native.17");
    expect(release.builds).toHaveLength(8);
  });
  it("classifies Mac and Windows assets", () => {
    const dmg = release.builds.find((b) => b.name === "Wing-0.2.0-native.17-arm64.dmg");
    expect(dmg).toMatchObject({ os: "mac", arch: "arm64", kind: "dmg" });
    const setup = release.builds.find((b) => b.name === "Wing-0.2.0-windows-x64-setup.exe");
    expect(setup).toMatchObject({ os: "windows", arch: "x64", kind: "setup" });
    const winZip = release.builds.find((b) => b.name === "Wing-0.2.0-windows-arm64.zip");
    expect(winZip).toMatchObject({ os: "windows", arch: "arm64", kind: "zip" });
  });
  it("finds both checksum files", () => {
    expect(release.checksums.mac).toMatch(/\/SHA256SUMS$/);
    expect(release.checksums.windows).toMatch(/\/SHA256SUMS-windows$/);
  });
});

describe("recommended", () => {
  it("defaults an unknown Mac to Apple Silicon", () => {
    const r = recommended(release, { os: "mac", arch: "unknown" });
    expect(r.label).toBe("Download for Mac");
    expect(r.build?.name).toBe("Wing-0.2.0-native.17-arm64.dmg");
  });
  it("gives Intel Macs the x64 DMG", () => {
    expect(recommended(release, { os: "mac", arch: "x64" }).build?.name).toBe("Wing-0.2.0-native.17-x64.dmg");
  });
  it("gives Windows the installer", () => {
    const r = recommended(release, { os: "windows", arch: "x64" });
    expect(r.label).toBe("Download for Windows");
    expect(r.build?.name).toBe("Wing-0.2.0-windows-x64-setup.exe");
  });
  it("sends a missing build to the downloads page", () => {
    const thin = { ...release, builds: release.builds.filter((b) => !(b.os === "windows" && b.arch === "arm64")) };
    const r = recommended(thin, { os: "windows", arch: "arm64" });
    expect(r.href).toBe("/download/");
    expect(r.build).toBeUndefined();
  });
  it("falls back to CloudFront for Macs without release data", () => {
    expect(recommended(null, { os: "mac", arch: "unknown" }).href).toBe(`${CLOUDFRONT}/Wing-arm64.dmg`);
    expect(recommended(null, { os: "mac", arch: "x64" }).href).toBe(`${CLOUDFRONT}/Wing-x64.dmg`);
  });
  it("sends other platforms to the downloads page", () => {
    expect(recommended(release, { os: "other", arch: "unknown" })).toMatchObject({ href: "/download/", label: "Download" });
  });
});
