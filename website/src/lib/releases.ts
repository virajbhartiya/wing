import type { Platform } from "./platform";

export const REPO = "virajbhartiya/wing";
export const RELEASES_URL = `https://github.com/${REPO}/releases`;
export const RELEASES_API = `https://api.github.com/repos/${REPO}/releases?per_page=30`;
export const CLOUDFRONT = "https://d1lddjdfjkgl7p.cloudfront.net";
export const DOWNLOAD_PAGE = "/download/";

export type Build = {
  os: "mac" | "windows";
  arch: "arm64" | "x64";
  kind: "dmg" | "zip" | "setup";
  name: string;
  url: string;
  size: number;
  version: string;
  releaseUrl: string;
  checksumUrl?: string;
};

export type Release = {
  version: string;
  tag: string;
  url: string;
  publishedAt?: string;
  builds: Build[];
  checksums: { mac?: string; windows?: string };
};

export type GitHubRelease = {
  tag_name: string;
  html_url: string;
  published_at?: string;
  draft?: boolean;
  prerelease?: boolean;
  assets: { name: string; size: number; browser_download_url: string }[];
};

function classify(name: string): Pick<Build, "os" | "arch" | "kind"> | null {
  const arch = /arm64/.test(name) ? "arm64" : /x64/.test(name) ? "x64" : null;
  if (!name.startsWith("Wing-") || !arch) return null;
  if (/windows/i.test(name)) {
    if (name.endsWith("-setup.exe")) return { os: "windows", arch, kind: "setup" };
    if (name.endsWith(".zip")) return { os: "windows", arch, kind: "zip" };
    return null;
  }
  if (name.endsWith(".dmg")) return { os: "mac", arch, kind: "dmg" };
  if (name.endsWith(".zip")) return { os: "mac", arch, kind: "zip" };
  return null;
}

export function parseRelease(json: GitHubRelease): Release {
  const version = json.tag_name.replace(/^v/, "");
  const builds: Build[] = [];
  const checksums: Release["checksums"] = {};
  for (const a of json.assets) {
    if (a.name === "SHA256SUMS") checksums.mac = a.browser_download_url;
    else if (a.name === "SHA256SUMS-windows") checksums.windows = a.browser_download_url;
    else {
      const c = classify(a.name);
      if (c) builds.push({
        ...c,
        name: a.name,
        url: a.browser_download_url,
        size: a.size,
        version,
        releaseUrl: json.html_url,
      });
    }
  }
  return {
    version,
    tag: json.tag_name,
    url: json.html_url,
    publishedAt: json.published_at,
    builds: builds.map((build) => ({ ...build, checksumUrl: checksums[build.os] })),
    checksums,
  };
}

/** Pick the newest published artifact of each kind, with metadata from that artifact's release. */
export function collectReleases(
  live: readonly GitHubRelease[],
  fallback: readonly GitHubRelease[] = [],
) {
  const byTag = new Map(fallback.map((release) => [release.tag_name, release]));
  for (const release of live) byTag.set(release.tag_name, release);
  const newestFirst = [...byTag.values()].sort(
    (a, b) =>
      (b.published_at ?? "").localeCompare(a.published_at ?? "") ||
      b.tag_name.localeCompare(a.tag_name, "en", { numeric: true }),
  );
  const builds = new Map<string, Build>();
  const snapshot: GitHubRelease[] = [];
  let latest: Release | null = null;
  for (const raw of newestFirst) {
    if (raw.draft || raw.prerelease || !Array.isArray(raw.assets)) continue;
    const parsed = parseRelease(raw);
    const assetUrls = new Set<string>();
    for (const build of parsed.builds) {
      const key = `${build.os}:${build.arch}:${build.kind}`;
      if (builds.has(key)) continue;
      builds.set(key, build);
      assetUrls.add(build.url);
      if (build.checksumUrl) assetUrls.add(build.checksumUrl);
    }
    if (assetUrls.size === 0) continue;
    latest ??= parsed;
    snapshot.push({
      tag_name: raw.tag_name,
      html_url: raw.html_url,
      published_at: raw.published_at,
      assets: raw.assets
        .filter((asset) => assetUrls.has(asset.browser_download_url))
        .map(({ name, size, browser_download_url }) => ({ name, size, browser_download_url })),
    });
  }
  return { release: latest && { ...latest, builds: [...builds.values()] }, snapshot };
}

export function findBuild(release: Release | null, os: Build["os"], arch: Build["arch"], kind: Build["kind"]) {
  return release?.builds.find((b) => b.os === os && b.arch === arch && b.kind === kind);
}

export type Recommendation = { label: string; detail: string; href: string; build?: Build };

export function recommended(release: Release | null, p: Platform): Recommendation {
  if (p.os === "mac") {
    const arch = p.arch === "x64" ? "x64" : "arm64";
    const detail = arch === "x64" ? "Intel" : "Apple Silicon";
    const build = findBuild(release, "mac", arch, "dmg");
    return { label: "Download for Mac", detail, href: build?.url ?? `${CLOUDFRONT}/Wing-${arch}.dmg`, build };
  }
  if (p.os === "windows") {
    const arch = p.arch === "arm64" ? "arm64" : "x64";
    const build = findBuild(release, "windows", arch, "setup");
    if (build) return { label: "Download for Windows", detail: arch === "arm64" ? "Arm" : "x64", href: build.url, build };
  }
  return { label: "Download", detail: "Mac and Windows", href: DOWNLOAD_PAGE };
}

export function formatSize(bytes: number) {
  return `${Math.round(bytes / 1e6)} MB`;
}
