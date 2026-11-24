// Keep a fallback for every build, even when GitHub is unavailable at runtime.
import { readFile, writeFile } from "node:fs/promises";
import { collectReleases, RELEASES_API } from "../src/lib/releases.ts";

const out = new URL("../src/lib/release-snapshot.json", import.meta.url);
try {
  const saved = await readFile(out, "utf8");
  const res = await fetch(RELEASES_API, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "wing-website-build" },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
  const live = await res.json();
  if (!Array.isArray(live)) throw new Error("GitHub returned an invalid release feed");
  const { snapshot } = collectReleases(live, JSON.parse(saved));
  if (!snapshot.length) throw new Error("GitHub returned no downloadable builds");
  const next = JSON.stringify(snapshot, null, 2) + "\n";
  if (next !== saved) await writeFile(out, next);
  console.log(`release snapshot: ${snapshot.map((release) => release.tag_name).join(", ")}`);
} catch (e) {
  console.warn(`release snapshot kept as is (${e.message})`);
}
