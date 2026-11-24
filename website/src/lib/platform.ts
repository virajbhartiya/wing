export type OS = "mac" | "windows" | "other";
export type Arch = "arm64" | "x64" | "unknown";
export type Platform = { os: OS; arch: Arch };

/** `uaArch` is `navigator.userAgentData` high-entropy `architecture` ("arm" | "x86"), when the browser offers it. */
export function detectPlatform(ua: string, uaArch?: string): Platform {
  const hinted: Arch | undefined = uaArch === "arm" ? "arm64" : uaArch === "x86" ? "x64" : undefined;
  if (/iPhone|iPad|iPod|Android/i.test(ua)) return { os: "other", arch: "unknown" };
  if (/Macintosh|Mac OS X/i.test(ua)) return { os: "mac", arch: hinted ?? "unknown" };
  if (/Windows/i.test(ua)) return { os: "windows", arch: hinted ?? (/ARM64/i.test(ua) ? "arm64" : "x64") };
  return { os: "other", arch: "unknown" };
}

export async function readPlatform(): Promise<Platform> {
  const nav = navigator as Navigator & {
    userAgentData?: { getHighEntropyValues(h: string[]): Promise<{ architecture?: string }> };
  };
  let arch: string | undefined;
  try {
    arch = (await nav.userAgentData?.getHighEntropyValues(["architecture"]))?.architecture;
  } catch {}
  return detectPlatform(navigator.userAgent, arch);
}
