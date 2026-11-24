/** A static export only emits canonical URLs when it knows the deployment origin. */
export function siteOrigin(explicit?: string, vercelProductionHost?: string) {
  const raw = explicit?.trim() || (vercelProductionHost ? `https://${vercelProductionHost}` : "");
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    const host = url.hostname.replace(/\.$/, "");
    if (
      url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" ||
      url.search || url.hash || /(^|\.)localhost$|^127\.|^0\.0\.0\.0$|^\[::1\]$/i.test(host)
    ) return undefined;
    return url.origin;
  } catch {
    return undefined;
  }
}

export const SITE_URL = siteOrigin(
  process.env.NEXT_PUBLIC_SITE_URL,
  process.env.VERCEL_PROJECT_PRODUCTION_URL,
);

export const SITE = {
  name: "Wing",
  title: "Wing — a calmer way to browse",
  description:
    "Wing is a free, open-source web browser for Mac with Spaces, split view, Peek and a command palette. It runs on native Chromium and supports Chrome extensions.",
  short: "A free, open-source browser for Mac. Spaces, split view and Peek on Chromium.",
  repo: "https://github.com/virajbhartiya/wing",
  keywords: [
    "Wing browser",
    "open source browser",
    "Mac browser",
    "Chromium browser",
    "Arc alternative",
    "browser with Spaces",
    "split view browser",
    "vertical tabs",
    "Chrome extensions",
    "macOS web browser",
    "privacy browser",
  ],
};
