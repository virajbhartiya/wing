"use client";
import { useEffect, useState } from "react";
import snapshot from "./release-snapshot.json";
import { collectReleases, recommended, RELEASES_API, type Release, type Recommendation } from "./releases";
import { readPlatform, type Platform } from "./platform";

const fallback = collectReleases(snapshot).release!;
let live: Promise<Release | null> | null = null;

function fetchLatest() {
  live ??= fetch(RELEASES_API, { headers: { Accept: "application/vnd.github+json" } })
    .then((r) => (r.ok ? r.json() : null))
    .then((releases) => Array.isArray(releases) ? collectReleases(releases, snapshot).release : null)
    .catch(() => null);
  return live;
}

/** Use the snapshot immediately and refresh each build independently when GitHub answers. */
export function useRelease(): Release {
  const [release, setRelease] = useState(fallback);
  useEffect(() => {
    let on = true;
    fetchLatest().then((r) => on && r && setRelease(r));
    return () => {
      on = false;
    };
  }, []);
  return release;
}

const DEFAULT: Platform = { os: "mac", arch: "unknown" };

export function usePlatform(): Platform {
  const [p, setP] = useState(DEFAULT);
  useEffect(() => {
    readPlatform().then(setP);
  }, []);
  return p;
}

export function useRecommended(): Recommendation & { release: Release; platform: Platform } {
  const release = useRelease();
  const platform = usePlatform();
  return { ...recommended(release, platform), release, platform };
}
