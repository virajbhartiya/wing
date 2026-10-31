"use strict";
// Drives real Electron on a scratch profile over CDP, then searches that profile
// for what a private window saw. A normal tab is the control: its marker must be
// found, which proves the search can see what the browser saves.
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const PORT = 9400 + (process.pid % 500);
const secret = "wingsecret" + crypto.randomBytes(8).toString("hex");
const control = "wingcontrol" + crypto.randomBytes(8).toString("hex");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(check, label, timeout = 15000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = await check().catch(() => null);
    if (value) return value;
    if (Date.now() > deadline) throw Error("Timed out: " + label);
    await sleep(100);
  }
}
const targets = async () =>
  (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const findTarget = (test, label) =>
  waitFor(async () => (await targets()).find(test), label);
async function evaluate(target, expression) {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = () => reject(Error("CDP connection failed"));
  });
  try {
    const reply = await new Promise((resolve, reject) => {
      socket.onmessage = (event) => resolve(JSON.parse(event.data));
      socket.onclose = () => reject(Error("Target closed"));
      socket.send(
        JSON.stringify({
          id: 1,
          method: "Runtime.evaluate",
          params: { expression, awaitPromise: true, returnByValue: true },
        }),
      );
    });
    if (reply.result?.exceptionDetails)
      throw Error(JSON.stringify(reply.result.exceptionDetails));
    return reply.result?.result?.value;
  } finally {
    socket.close();
  }
}
const privatePartitions = (data) => {
  const dir = path.join(data, "Partitions");
  return fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((name) => name.includes("private"))
    : [];
};
// A target can report its URL before its document commits.
async function loadedPage(url, label) {
  const target = await findTarget((t) => t.url === url, label);
  await waitFor(
    () =>
      evaluate(
        target,
        `location.href === ${JSON.stringify(url)} && document.readyState === "complete"`,
      ),
    label + " loaded",
  );
  return target;
}
const submitAddress = (shell, url) =>
  evaluate(
    shell,
    `address.value = ${JSON.stringify(url)}; bar.requestSubmit();`,
  );
function filesIn(dir) {
  const found = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return found; // Helper processes may remove a directory during the search.
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...filesIn(full));
    else if (entry.isFile()) found.push(full);
  }
  return found;
}
function filesContaining(dir, text) {
  const forms = [Buffer.from(text), Buffer.from(text, "utf16le")];
  return filesIn(dir).filter((file) => {
    try {
      const bytes = fs.readFileSync(file);
      return (
        forms.some((form) => bytes.includes(form)) || file.includes(text)
      );
    } catch {
      return false; // A file removed during the search holds nothing.
    }
  });
}

async function run() {
  const seenCookies = [];
  const server = http.createServer((req, res) => {
    if (req.url === "/favicon.ico") return res.writeHead(404).end();
    seenCookies.push(req.headers.cookie || "");
    if (req.url.startsWith("/asset")) {
      res.writeHead(200, {
        "content-type": "text/plain",
        "cache-control": "public, max-age=86400",
      });
      return res.end(secret);
    }
    const marker = req.url.includes(secret) ? secret : control;
    res.writeHead(200, {
      "content-type": "text/html",
      // Cookie values are encrypted on disk, but names are searchable.
      "set-cookie": `${marker}=1; Max-Age=86400; Path=/`,
    });
    res.end(`<!doctype html><title>${marker}</title><p>${marker}</p>`);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "wing-private-test-"));
  const temp = path.join(data, "tmp");
  fs.mkdirSync(temp);
  const child = spawn(
    require("electron"),
    [".", `--user-data-dir=${data}`, `--remote-debugging-port=${PORT}`],
    {
      cwd: path.join(__dirname, ".."),
      env: { ...process.env, WING_DATA_DIR: data, TMPDIR: temp },
      stdio: "ignore",
    },
  );
  const exited = new Promise((resolve) => child.once("exit", resolve));
  try {
    const main = await findTarget(
      (t) => t.url.endsWith("/src/index.html"),
      "main shell",
    );
    await waitFor(
      () => evaluate(main, "!!window.wing && document.readyState === 'complete'"),
      "shell ready",
    );
    const invoke = (name, payload = {}) =>
      evaluate(main, `wing.invoke(${JSON.stringify(name)}, ${JSON.stringify(payload)})`);
    const privateShells = async () =>
      (await targets()).filter((t) => t.url.endsWith("/src/private.html"));

    // The palette command opens a window instead of answering with an error.
    await evaluate(
      main,
      `(async () => {
        openPalette();
        const input = document.querySelector("#palette-input");
        input.value = "New Private Window";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 300));
        const index = paletteResults.findIndex(
          (result) => result.label === "New Private Window",
        );
        if (index < 0) throw Error("The palette has no private window command");
        runResult(index);
      })()`,
    );
    const shell = await findTarget(
      (t) => t.url.endsWith("/src/private.html"),
      "private shell",
    );
    await waitFor(
      () => evaluate(shell, "document.readyState === 'complete'"),
      "private preload",
    );

    // Everything a site can store, written while the window is working.
    const pageURL = `${base}/page-${secret}`;
    await submitAddress(shell, pageURL);
    const page = await loadedPage(pageURL, "private page");
    const stored = await evaluate(
      page,
      `(async () => {
        localStorage.setItem("wing", ${JSON.stringify(secret)});
        sessionStorage.setItem("wing", ${JSON.stringify(secret)});
        await new Promise((resolve, reject) => {
          const open = indexedDB.open("wing-db", 1);
          open.onupgradeneeded = () => open.result.createObjectStore("s");
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const tx = open.result.transaction("s", "readwrite");
            tx.objectStore("s").put(${JSON.stringify(secret)}, "k");
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
          };
        });
        await fetch("/asset", { cache: "force-cache" });
        return {
          cookie: document.cookie,
          local: localStorage.getItem("wing"),
          agent: navigator.userAgent,
        };
      })()`,
    );
    assert.match(stored.cookie, new RegExp(secret), "cookies must work in the window");
    assert.equal(stored.local, secret, "localStorage must work in the window");
    assert.doesNotMatch(stored.agent, /Electron|wing-browser/);
    assert.equal(
      await waitFor(
        () => evaluate(shell, "document.querySelector('#address').value"),
        "address bar updated",
      ),
      pageURL,
    );

    // The cookie is sent back during the session, so the session really works.
    seenCookies.length = 0;
    await evaluate(page, "fetch('/asset2').then((r) => r.text())");
    assert.ok(
      seenCookies.some((c) => c.includes(secret)),
      "cookie must be sent while the window is open",
    );

    // A second private window and a normal tab see none of it.
    await invoke("private-window");
    const second = await waitFor(
      async () => (await privateShells()).find((t) => t.id !== shell.id),
      "second private shell",
    );
    await waitFor(
      () => evaluate(second, "document.readyState === 'complete'"),
      "second preload",
    );
    const secondURL = `${base}/second-${secret}`;
    await submitAddress(second, secondURL);
    const secondPage = await loadedPage(secondURL, "second page");
    assert.equal(
      await evaluate(secondPage, "localStorage.getItem('wing')"),
      null,
      "private windows must not share storage",
    );

    // The control: a normal tab that the same search has to find afterwards.
    const normalURL = `${base}/normal-${control}`;
    await invoke("new-tab", { url: normalURL });
    const normal = await loadedPage(normalURL, "normal tab");
    assert.equal(
      await evaluate(normal, "localStorage.getItem('wing')"),
      null,
      "normal tabs must not see private storage",
    );
    assert.doesNotMatch(
      await evaluate(normal, "document.cookie"),
      new RegExp(secret),
      "normal tabs must not see private cookies",
    );

    // Chromium delays storage writes. Once the normal tab's write reaches disk,
    // the private writes made before it would have too, had they been persistent.
    await evaluate(normal, `localStorage.setItem("wing", ${JSON.stringify(control)})`);
    await waitFor(
      async () =>
        filesContaining(data, control).some(
          (file) => path.basename(file) !== "workspace.json",
        ),
      "normal storage flushed to disk",
      45000,
    );

    await evaluate(second, "window.close()").catch(() => {});
    await evaluate(shell, "window.close()").catch(() => {});
    await waitFor(
      async () => (await privateShells()).length === 0,
      "private windows closed",
    );
    await waitFor(
      async () =>
        !(await targets()).some(
          (t) => t.url === pageURL || t.url === secondURL,
        ),
      "private pages destroyed",
    );

    const openLeak = filesContaining(data, secret);
    assert.deepEqual(openLeak, [], "found on disk after the window closed");
    assert.deepEqual(privatePartitions(data), [], "private partition on disk");

    // SIGTERM quits through the main window's close handler, like ⌘Q; a page's
    // window.close() would skip the final workspace save.
    child.kill("SIGTERM");
    await Promise.race([
      exited,
      sleep(15000).then(() => {
        throw Error("Wing did not quit");
      }),
    ]);

    const workspace = fs.readFileSync(path.join(data, "workspace.json"), "utf8");
    assert.ok(workspace.includes(control), "control: normal history must be saved");
    assert.ok(!workspace.includes(secret), "private visit reached workspace.json");
    assert.ok(
      filesContaining(data, control).length > 0,
      "control: the search must find the normal visit",
    );
    assert.deepEqual(filesContaining(data, secret), [], "found on disk after quit");
    assert.deepEqual(privatePartitions(data), [], "private partition on disk");
    console.log(
      `private-window: no trace in ${filesIn(data).length} profile files; control found`,
    );
  } finally {
    child.kill();
    await Promise.race([exited, sleep(5000)]);
    server.close();
    server.closeAllConnections();
    fs.rmSync(data, { recursive: true, force: true });
  }
}
run().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
