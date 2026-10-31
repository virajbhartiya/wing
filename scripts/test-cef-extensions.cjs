const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const wing = process.argv.includes("--wing");
const mode = process.argv.includes("--alloy") ? "alloy" : "chrome";
const root = path.resolve(__dirname, "..");
const cache = fs.mkdtempSync(path.join(os.tmpdir(), "wing-cef-extension-"));
let child;
const server = http.createServer((req, res) => {
  if (req.url === "/report") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const proof = JSON.parse(body);
      const report = {
        engine: "CEF Chrome runtime",
        mode,
        at: new Date().toISOString(),
        ...proof,
      };
      fs.writeFileSync(
        path.join(root, `docs/extensions-${wing ? "wing-" : ""}${mode}.json`),
        JSON.stringify(report, null, 2),
      );
      console.log(JSON.stringify(report, null, 2));
      res.end("ok");
      const valid = [
        "split",
        "worker",
        "storage",
        "tabs",
        "messaging",
        "contentScript",
        "declarativeNetRequest",
      ].every((k) => proof[k] === true);
      finish(valid ? 0 : 1);
    });
    return;
  }
  res.setHeader("Content-Type", "text/html");
  res.end(
    "<!doctype html><title>Wing extension compatibility</title><h1>Manifest V3 integration test</h1><p>Testing real Chromium extension APIs on this local fixture.</p>",
  );
});
let timer;
let finished = false;
function finish(code) {
  if (finished) return;
  finished = true;
  process.exitCode = code;
  clearTimeout(timer);
  child?.kill("SIGTERM");
  server.close();
  setTimeout(() => {
    fs.rmSync(cache, { recursive: true, force: true });
    process.exit(code);
  }, 1000).unref();
}
server.listen(0, "127.0.0.1", () => {
  const args = ["--enable-logging=stderr",
    `--url=http://127.0.0.1:${server.address().port}`,
    `--load-extension=${path.join(root, "test/extensions/mv3-probe")}`,
    `--cache-path=${cache}`,
  ];
  if (mode === "alloy") args.push("--use-alloy-style");
  child = spawn(
    path.join(
      root,
      wing
        ? "native/wing-build/host/Release/Wing.app/Contents/MacOS/Wing"
        : "native/build/tests/cefsimple/Release/cefsimple.app/Contents/MacOS/cefsimple",
    ),
    args,
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  child.stderr.on("data", (c) =>
    fs.appendFileSync("/tmp/wing-extension-test.log", c),
  );
  child.on("exit", (code, signal) => { if(code !== null || signal) { console.error("Browser exited",code,signal); finish(1); } });
  child.on("error", (e) => {
    console.error(e);
    finish(1);
  });
  timer = setTimeout(() => {
    console.error(
      "Extension execution timed out; inspect /tmp/wing-extension-test.log",
    );
    finish(1);
  }, 45000);
});
