// Renders /og/ in headless Chrome and saves it as public/og.png (1200×630).
// Usage: npm run og -- [base URL, default http://localhost:3000]
import { execFileSync } from "node:child_process";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const base = process.argv[2] ?? "http://localhost:3000";
const chrome = ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find(existsSync);
if (!chrome) throw new Error("Chrome not found");
const dir = mkdtempSync(join(tmpdir(), "wing-og-"));
const shot = join(dir, "og@2x.png");
execFileSync(chrome, [
  "--headless=new",
  "--hide-scrollbars",
  "--force-device-scale-factor=2",
  "--window-size=1200,630",
  "--virtual-time-budget=4000",
  `--user-data-dir=${dir}`,
  `--screenshot=${shot}`,
  `${base}/og/`,
]);
const out = new URL("../public/og.png", import.meta.url).pathname;
execFileSync("magick", [shot, "-resize", "1200x630", "-strip", out]);
console.log(`wrote ${out}`);
