import { describe, expect, it } from "vitest";
import { detectPlatform } from "./platform";

const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const WIN = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";

describe("detectPlatform", () => {
  it("can't tell a Mac's chip from the UA alone", () => expect(detectPlatform(MAC)).toEqual({ os: "mac", arch: "unknown" }));
  it("uses client hints on a Mac", () => {
    expect(detectPlatform(MAC, "x86")).toEqual({ os: "mac", arch: "x64" });
    expect(detectPlatform(MAC, "arm")).toEqual({ os: "mac", arch: "arm64" });
  });
  it("treats Windows as x64 unless hints say arm", () => {
    expect(detectPlatform(WIN)).toEqual({ os: "windows", arch: "x64" });
    expect(detectPlatform(WIN, "arm")).toEqual({ os: "windows", arch: "arm64" });
  });
  it("calls phones and Linux other", () => {
    expect(detectPlatform("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)").os).toBe("other");
    expect(detectPlatform("Mozilla/5.0 (Linux; Android 15; Pixel 9)").os).toBe("other");
    expect(detectPlatform("Mozilla/5.0 (X11; Linux x86_64)").os).toBe("other");
  });
});
