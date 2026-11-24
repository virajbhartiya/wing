import { renderHook, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { useRelease } from "./useRelease";

vi.mock("./release-snapshot.json", async () => ({
  default: [(await import("./fixture-release.json")).default],
}));

it("keeps older Intel and Windows downloads when the latest release is Apple Silicon only", async () => {
  const originalFetch = globalThis.fetch;
  const releaseUrl = "https://github.com/virajbhartiya/wing/releases/tag/v0.2.0-native.20";
  const assetsUrl = "https://github.com/virajbhartiya/wing/releases/download/v0.2.0-native.20";
  globalThis.fetch = vi.fn(async () => Response.json([{
    tag_name: "v0.2.0-native.20",
    html_url: releaseUrl,
    published_at: "2026-11-25T00:00:00Z",
    assets: [{
      name: "Wing-0.2.0-native.20-arm64.dmg",
      size: 227897029,
      browser_download_url: `${assetsUrl}/Wing-0.2.0-native.20-arm64.dmg`,
    }, {
      name: "SHA256SUMS",
      size: 180,
      browser_download_url: `${assetsUrl}/SHA256SUMS`,
    }],
  }]));
  try {
    const { result } = renderHook(() => useRelease());
    await waitFor(() => expect(result.current.version).toBe("0.2.0-native.20"));
    expect(result.current.builds).toEqual(expect.arrayContaining([
      expect.objectContaining({
        os: "mac", arch: "arm64", kind: "dmg", version: "0.2.0-native.20",
        releaseUrl, checksumUrl: `${assetsUrl}/SHA256SUMS`,
      }),
      expect.objectContaining({
        os: "mac", arch: "x64", kind: "dmg", version: "0.2.0-native.17",
        checksumUrl: expect.stringMatching(/v0\.2\.0-native\.17\/SHA256SUMS$/),
      }),
      expect.objectContaining({
        os: "windows", arch: "x64", kind: "setup", version: "0.2.0-native.17",
        checksumUrl: expect.stringMatching(/v0\.2\.0-native\.17\/SHA256SUMS-windows$/),
      }),
    ]));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
