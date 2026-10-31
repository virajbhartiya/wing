/** Real Chromium lifecycle test; no remote sites, personal sessions, or UI automation.
 * Creates sandboxed, unattached native views, loads local documents, destroys them,
 * then samples the app process tree. Reports observations, not a proof of no leaks.
 */
const { app, WebContentsView, webContents, session } = require("electron");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { performance } = require("node:perf_hooks");
const data = fs.mkdtempSync(path.join(os.tmpdir(), "wing-benchmark-"));
app.setPath("userData", data);
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
function sample(label) {
  const processes = app.getAppMetrics();
  return {
    label,
    atMs: Math.round(performance.now()),
    webContents: webContents.getAllWebContents().length,
    processCount: processes.length,
    workingSetMB: +(
      processes.reduce((n, p) => n + p.memory.workingSetSize, 0) / 1024
    ).toFixed(2),
    cpuPercent: +processes
      .reduce((n, p) => n + p.cpu.percentCPUUsage, 0)
      .toFixed(2),
    mainHeapMB: +(process.memoryUsage().heapUsed / 1048576).toFixed(2),
  };
}
app
  .whenReady()
  .then(async () => {
    const results = [],
      timings = [];
    const fixture = path.join(data, "fixture.html");
    fs.writeFileSync(
      fixture,
      "<!doctype html><title>Wing lifecycle fixture</title><style>body{font:16px system-ui;background:#ddd5eb}</style><h1>Deterministic lifecycle fixture</h1><p>Real Chromium rendering, isolated session, no network.</p>",
    );
    // Warm up Chromium before establishing a baseline.
    const warm = new WebContentsView({
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        partition: "benchmark",
      },
    });
    await warm.webContents.loadFile(fixture);
    warm.webContents.close();
    await pause(2000);
    results.push(sample("warm baseline"));
    for (let batch = 1; batch <= 6; batch++) {
      const views = [];
      for (let n = 0; n < 10; n++) {
        const start = performance.now(),
          view = new WebContentsView({
            webPreferences: {
              sandbox: true,
              contextIsolation: true,
              nodeIntegration: false,
              partition: "benchmark",
            },
          });
        await view.webContents.loadFile(fixture);
        timings.push(performance.now() - start);
        views.push(view);
      }
      results.push(sample(`batch ${batch}: 10 live pages`));
      for (const view of views) view.webContents.close();
      views.length = 0;
      await pause(1200);
      results.push(sample(`batch ${batch}: all destroyed`));
      if (webContents.getAllWebContents().length !== 0)
        throw Error("WebContents retained after closing views");
    }
    await pause(3000);
    results.push(sample("idle end"));
    timings.sort((a, b) => a - b);
    const report = {
      date: new Date().toISOString(),
      platform: process.platform,
      arch: process.arch,
      electron: process.versions.electron,
      chromium: process.versions.chrome,
      cycles: 60,
      fixture: "local static HTML; 10 concurrent views; same in-memory profile",
      loadLatencyMs: {
        median: +timings[30].toFixed(2),
        p95: +timings[57].toFixed(2),
      },
      results,
      limitations: [
        "Synthetic document, not representative of heavy web apps.",
        "Working sets can double-count shared memory.",
        "A short stress run cannot rule out long-duration leaks.",
        "Unattached views test lifecycle, not animation frame rate.",
      ],
    };
    fs.mkdirSync(path.join(__dirname, "../docs"), { recursive: true });
    fs.writeFileSync(
      path.join(__dirname, "../docs/benchmark.json"),
      JSON.stringify(report, null, 2),
    );
    console.log(JSON.stringify(report, null, 2));
    app.quit();
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
app.on("will-quit", () => {
  try {
    fs.rmSync(data, { recursive: true, force: true });
  } catch {}
});
