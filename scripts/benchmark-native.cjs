const http = require("node:http"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, ".."),
  cache = fs.mkdtempSync(path.join(os.tmpdir(), "wing-native-bench-"));
let child, timer;
const samples = [];
function metrics() {
  const rows = execFileSync(
    "/bin/ps",
    ["-axo", "pid=,ppid=,rss=,pcpu=,comm="],
    { encoding: "utf8" },
  )
    .trim()
    .split("\n")
    .map((line) => {
      const [pid, ppid, rss, cpu, ...name] = line.trim().split(/\s+/);
      return {
        pid: +pid,
        ppid: +ppid,
        rssKB: +rss,
        cpuLifetimePercent: +cpu,
        name: name.join(" "),
      };
    });
  const ids = new Set([child.pid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows)
      if (ids.has(row.ppid) && !ids.has(row.pid)) {
        ids.add(row.pid);
        changed = true;
      }
  }
  const processes = rows.filter((row) => ids.has(row.pid));
  return {
    rssSumMB: processes.reduce((n, p) => n + p.rssKB, 0) / 1024,
    processes,
  };
}
function finish(code) {
  process.exitCode = code;
  clearTimeout(timer);
  child?.kill("SIGTERM");
  server.close();
  setTimeout(() => {
    fs.rmSync(cache, { recursive: true, force: true });
    process.exit(code);
  }, 1000);
}
const server = http.createServer((req, res) => {
  if (req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const data = JSON.parse(body);
      if (req.url === "/sample") {
        const sample = { ...data, ...metrics() };
        samples.push(sample);
        console.log(
          data.phase,
          Math.round(sample.rssSumMB) + " MB",
          data.tabs + " tabs",
        );
      }
      if (req.url === "/done") {
        const sorted = data.tabCreateLatenciesMs.slice().sort((a, b) => a - b);
        const report = {
          engine: "Wing CEF Chrome runtime",
          at: new Date().toISOString(),
          fixture: "60 tabs, six batches of ten, local static HTML",
          measurement:
            "Summed host and descendant RSS, shared pages can be counted more than once. CPU is ps lifetime average, not instantaneous.",
          medianTabCreateMs: sorted[30],
          p95TabCreateMs: sorted[57],
          ...data,
          samples,
        };
        fs.writeFileSync(
          path.join(root, "docs/benchmark-native.json"),
          JSON.stringify(report, null, 2),
        );
        const closed = samples.filter((s) => s.phase.startsWith("closed"));
        const passed = closed.length === 6 && closed.every((s) => s.tabs === 1);
        res.end("ok");
        finish(passed ? 0 : 1);
        return;
      }
      res.end("ok");
    });
    return;
  }
  res.setHeader("Content-Type", "text/html");
  res.end(
    "<!doctype html><title>Wing native lifecycle benchmark</title><h1>Chromium tab lifecycle</h1><p>This local fixture is used to measure sixty create/close cycles with a real MV3 extension.</p>",
  );
});
server.listen(0, "127.0.0.1", () => {
  child = spawn(
    path.join(
      root,
      "native/wing-build/host/Release/Wing.app/Contents/MacOS/Wing",
    ),
    [
      `--cache-path=${cache}`,
      `--url=http://127.0.0.1:${server.address().port}/benchmark`,
      `--load-extension=${path.join(root, "test/extensions/mv3-probe")}`,
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  child.stderr.on("data", (chunk) =>
    fs.appendFileSync("/tmp/wing-native-benchmark.log", chunk),
  );
  child.on("error", (e) => {
    console.error(e);
    finish(1);
  });
  timer = setTimeout(() => {
    console.error("Native lifecycle test timed out");
    finish(1);
  }, 90000);
});
