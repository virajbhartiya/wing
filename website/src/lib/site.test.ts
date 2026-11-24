import { describe, expect, it } from "vitest";
import { siteOrigin } from "./site";

describe("siteOrigin", () => {
  it("prefers the configured HTTPS origin", () => {
    expect(siteOrigin(" https://wing.test/ ", "wing-production.vercel.app"))
      .toBe("https://wing.test");
  });

  it("can use the Vercel production hostname", () => {
    expect(siteOrigin(undefined, "wing-production.vercel.app"))
      .toBe("https://wing-production.vercel.app");
  });

  it.each([
    undefined,
    "http://localhost:3000",
    "https://localhost.",
    "https://127.0.0.1",
    "https://[::1]",
    "https://wing.test/path",
    "https://wing.test/?preview=true",
    "not a URL",
  ])("does not emit a canonical origin for %s", (value) => {
    expect(siteOrigin(value)).toBeUndefined();
  });
});
