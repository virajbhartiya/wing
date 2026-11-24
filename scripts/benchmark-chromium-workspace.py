"""Measure tab switching and Stop in disposable native Chromium workspaces."""
import argparse
import http.server
import json
import os
from pathlib import Path
import signal
import subprocess
import tempfile
import threading

ROOT = Path(__file__).resolve().parents[1]
LATEST_PREVIEW = ROOT / "native/build/chromium-preview/latest.json"

SEED_WORKSPACE = """
const M = require('./src/model.cjs');
const state = M.initialState();
const count = Number(process.argv[1]), base = process.argv[2];
const spaceId = state.activeSpaceId;
state.settings.onboarded = true;
state.folders = Array.from({ length: Math.ceil(count / 10) }, (_, index) => ({
  id: 'benchmark-folder-' + index, spaceId, name: 'Benchmark folder ' + index,
}));
state.tabs = Array.from({ length: count }, (_, index) =>
  M.newTab(spaceId, base + '/page-' + index, {
    kind: 'pinned',
    folderId: state.folders[Math.floor(index / 10)].id,
  }));
state.activeTabId = state.tabs[0].id;
process.stdout.write(JSON.stringify(state));
"""

MEASURE = """
(async () => {
  window.__wingQualifying = true;
  const invoke = window.wing.invoke;
  async function waitFor(predicate, message) {
    const deadline = performance.now() + 10000;
    while (!predicate()) {
      if (performance.now() > deadline) throw Error(message);
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  }
  try {
    const start = performance.now();
    const first = await invoke('state');
    const initialSyncMs = performance.now() - start;
    const find = id => state.tabs.find(tab => tab.id === id);
    await waitFor(() => {
      const tab = find(first.activeTabId);
      return tab && !tab.loading && tab.title === 'Fast fixture';
    }, 'First fixture page did not load');
    const samples = [];
    for (const tab of first.tabs.slice(1, 21)) {
      const before = performance.now();
      await invoke('select-tab', { id: tab.id });
      await new Promise(resolve => requestAnimationFrame(resolve));
      samples.push(performance.now() - before);
    }
    samples.sort((left, right) => left - right);

    await invoke('new-tab', { url: BASE + '/slow' });
    const id = state.activeTabId;
    await waitFor(() => {
      const tab = find(id);
      return tab?.loading && tab.title === 'Slow fixture';
    }, 'Stalled subresource did not expose the loading state');
    const beforeStop = performance.now();
    await invoke('stop', { id });
    await waitFor(() => find(id)?.loading === false, 'Stop left the tab loading');
    const stopMs = performance.now() - beforeStop;
    post('result', JSON.stringify({
      pinnedTabs: first.tabs.length,
      initialSyncMs,
      switchMedianMs: (samples[9] + samples[10]) / 2,
      switchP95Ms: samples[18],
      stopMs,
    }));
  } catch (error) {
    post('result', JSON.stringify({ error: error.message }));
  }
})();
"""


def measure(executable, count):
    release_image = threading.Event()

    class Handler(http.server.BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def do_GET(self):
            if self.path == "/hold.svg":
                release_image.wait(35)
                content_type = "image/svg+xml"
                body = b'<svg xmlns="http://www.w3.org/2000/svg"/>'
            else:
                content_type = "text/html"
                body = (b'<!doctype html><title>Slow fixture</title><img src="/hold.svg">'
                        if self.path == "/slow" else
                        b'<!doctype html><title>Fast fixture</title><article>Wing fixture</article>')
            try:
                self.send_response(200)
                self.send_header("Content-Type", content_type)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):
                pass

    with (http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler) as server,
          tempfile.TemporaryDirectory(prefix="wing-workspace-benchmark-") as temporary):
        base = f"http://127.0.0.1:{server.server_port}"
        threading.Thread(target=server.serve_forever, daemon=True).start()
        directory = Path(temporary)
        profile = directory / "profile"
        profile.mkdir(mode=0o700)
        (profile / "wing-workspace.json").write_bytes(subprocess.check_output(
            ["node", "-e", SEED_WORKSPACE, str(count), base], cwd=ROOT))
        script = directory / "measure.js"
        script.write_text(f"const BASE = {json.dumps(base)};\n{MEASURE}")
        report = directory / "report.json"
        logs = directory / "browser.log"
        env = {**os.environ, "WING_CHROMIUM_TEST_PROFILE": str(profile),
               "WING_CHROMIUM_TEST_SCRIPT": str(script), "WING_CHROMIUM_TEST_REPORT": str(report)}
        try:
            with logs.open("w+") as log:
                child = subprocess.Popen(
                    [executable, "--disable-backgrounding-occluded-windows",
                     "--disable-background-networking", "--no-proxy-server"],
                    env=env, start_new_session=True, stdout=log, stderr=log)
                try:
                    code = child.wait(timeout=60)
                except subprocess.TimeoutExpired as error:
                    os.killpg(child.pid, signal.SIGKILL)
                    child.wait()
                    raise RuntimeError(f"{count}-tab benchmark timed out") from error
                if code != 0 or not report.exists():
                    raise RuntimeError(f"{count}-tab benchmark produced no report (exit {code})\n"
                                       + logs.read_text(errors="replace")[-4000:])
            result = json.loads(report.read_text())
            if "error" in result:
                raise RuntimeError(f"{count}-tab benchmark failed: {result['error']}")
            return result
        finally:
            release_image.set()
            server.shutdown()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--app", type=Path, help="preview app bundle, defaults to the latest arm64 build")
    args = parser.parse_args()
    app = args.app or Path(json.loads(LATEST_PREVIEW.read_text())["app"])
    executable = app.resolve() / "Contents/MacOS/Wing Chromium Preview"
    for count in (25, 250, 1000):
        print(json.dumps(measure(executable, count)), flush=True)


if __name__ == "__main__":
    main()
