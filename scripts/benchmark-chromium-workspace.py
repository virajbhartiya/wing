"""Benchmark the native Chromium preview in disposable workspaces."""
import argparse
import hashlib
import http.server
import json
import os
from pathlib import Path
import platform
import plistlib
import re
import signal
import subprocess
import tempfile
import threading
import time
from urllib.parse import parse_qs, urlsplit

from chromium_benchmark_metrics import ProcessSampler, WindowProbe, main_display_refresh_rate

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
    const waitLoaded = id => waitFor(() => {
      const tab = find(id);
      return tab && !tab.loading && tab.title === 'Fast fixture';
    }, 'Fixture page did not load');
    await waitLoaded(first.activeTabId);
    const tabs = first.tabs.slice(1, 21);
    async function sampleSelections() {
      const samples = [];
      for (const tab of tabs) {
        const before = performance.now();
        await invoke('select-tab', { id: tab.id });
        await new Promise(resolve => requestAnimationFrame(resolve));
        samples.push(performance.now() - before);
      }
      samples.sort((left, right) => left - right);
      return { median: (samples[9] + samples[10]) / 2, p95: samples[18] };
    }
    const firstVisits = await sampleSelections();

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

    for (const tab of tabs) {
      await invoke('select-tab', { id: tab.id });
      await waitLoaded(tab.id);
    }
    const warm = await sampleSelections();
    post('result', JSON.stringify({
      pinnedTabs: first.tabs.length,
      initialSyncMs,
      switchMedianMs: firstVisits.median,
      switchP95Ms: firstVisits.p95,
      warmSwitchMedianMs: warm.median,
      warmSwitchP95Ms: warm.p95,
      stopMs,
    }));
  } catch (error) {
    post('result', JSON.stringify({ error: error.message }));
  }
})();
"""


def measure(executable, count, *, resources=None, timeout=60):
    release_image = threading.Event()
    paint_events = {}

    class Handler(http.server.BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def do_POST(self):
            url = urlsplit(self.path)
            if url.path.startswith(("/paint/page-", "/reveal/page-")):
                mark = parse_qs(url.query).get("markMs", [""])[0]
                if mark.isdecimal():
                    paint_events.setdefault(url.path, []).append(
                        (time.monotonic(), time.time_ns() / 1e6, int(mark)))
            self.send_response(204)
            self.end_headers()

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
                if resources and self.path.startswith("/page-"):
                    body += (b'<input aria-label="Draft"><select aria-label="Preference">'
                             b'<option value="one">One</option><option value="two">Two</option>'
                             b'</select><script src="/fixture.js"></script>')
                if resources and self.path == "/fixture.js":
                    content_type = "text/javascript"
                    body = (b'const beacon = (kind, ms) => navigator.sendBeacon('
                            b'"/" + kind + location.pathname + "?markMs=" + Math.round(performance.timeOrigin + ms));'
                            b'new PerformanceObserver(list => {'
                            b'const first = list.getEntries().find(entry => entry.name === "first-contentful-paint");'
                            b'if(first) beacon("paint", first.startTime);'
                            b'}).observe({type:"paint",buffered:true});'
                            b'const reveal = () => {if(!document.hidden) requestAnimationFrame(() => '
                            b'requestAnimationFrame(ms => beacon("reveal", ms)));};'
                            b'document.addEventListener("visibilitychange", reveal);')
                    if resources["fixture"] == "mixed":
                        body += (b'const text = "Wing fixture ".repeat(30);'
                                 b'for(let i=0;i<180;i++)document.body.append(Object.assign('
                                 b'document.createElement("p"),{textContent:text}));'
                                 b'const data = new Uint8Array(512 * 1024);'
                                 b'setInterval(() => data.fill((data[0]+1)%256),250);')
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
        seed = json.loads(subprocess.check_output(
            ["node", "-e", SEED_WORKSPACE, str(count), base], cwd=ROOT))
        if resources:
            seed["settings"].update(tabLayout="sidebar", archiveHours=0)
            seed["folders"] = []
            for tab in seed["tabs"]:
                tab.update(kind="today", folderId=None)
        (profile / "wing-workspace.json").write_text(json.dumps(seed))
        script = directory / "measure.js"
        workload = (ROOT / "scripts/chromium-resource-fixture.js").read_text() if resources else MEASURE
        script.write_text(f"const BASE = {json.dumps(base)};\n"
                          f"const OPTIONS = {json.dumps(resources)};\n{workload}")
        report = directory / "report.json"
        logs = directory / "browser.log"
        env = {**os.environ, "WING_CHROMIUM_TEST_PROFILE": str(profile),
               "WING_CHROMIUM_TEST_SCRIPT": str(script), "WING_CHROMIUM_TEST_REPORT": str(report)}
        try:
            with logs.open("w+") as log:
                window = WindowProbe() if resources else None
                started = time.monotonic()
                child = subprocess.Popen(
                    [executable, "--disable-backgrounding-occluded-windows",
                     "--disable-background-networking", "--no-proxy-server"],
                    env=env, start_new_session=True, stdout=log, stderr=log)
                sampler = ProcessSampler(child.pid) if resources else None
                try:
                    if window:
                        window.start(child.pid)
                    if sampler:
                        sampler.start()
                    try:
                        code = child.wait(timeout=timeout)
                    except subprocess.TimeoutExpired as error:
                        os.killpg(child.pid, signal.SIGKILL)
                        child.wait()
                        raise RuntimeError(f"{count}-tab benchmark timed out") from error
                    except KeyboardInterrupt:
                        if child.poll() is None:
                            os.killpg(child.pid, signal.SIGKILL)
                            child.wait()
                        raise
                finally:
                    if window:
                        window.stop()
                    if sampler:
                        sampler.stop()
                if code != 0 or not report.exists():
                    raise RuntimeError(f"{count}-tab benchmark produced no report (exit {code})\n"
                                       + logs.read_text(errors="replace")[-4000:])
            result = json.loads(report.read_text())
            if "error" in result:
                raise RuntimeError(f"{count}-tab benchmark failed: {result['error']}")
            browser_log = logs.read_text(errors="replace")
            trace = re.findall(r"(?m)^Wing startup (\d+\.\d+) ([\w-]+)$", browser_log)
            if trace:
                result["startupTrace"] = [{"phase": phase, "sinceMainMs": float(ms)}
                                          for ms, phase in trace]
            rule_waits = re.findall(r"\[ardiacore\] held (\d+) navigations .*?, the first "
                                    r"(\d+) ms \(ready (\d+) ms after the hold began\)", browser_log)
            if rule_waits:
                result["protectionWaits"] = [
                    {"heldNavigations": int(count), "firstNavigationWaitMs": int(first),
                     "rulesReadyAfterHoldMs": int(ready)} for count, first, ready in rule_waits
                ]
            if sampler:
                result["launchToWindowOnScreenMs"] = (
                    round((window.visible_at - started) * 1000, 2) if window.visible_at else None
                )
                first_paint = paint_events.get("/paint/page-0")
                result["launchToFirstContentfulPaintBeaconMs"] = (
                    round((first_paint[0][0] - started) * 1000, 2) if first_paint else None
                )
                for action in result["interactions"]:
                    path = action.pop("beacon")
                    start_ms = action.pop("startMs")
                    events = [(wall, mark) for _, wall, mark in paint_events.get(path, ())
                              if wall >= start_ms and mark >= start_ms]
                    action["pageMarkMs"] = events[0][1] - start_ms if events else None
                    action["beaconMs"] = round(events[0][0] - start_ms, 2) if events else None
                for phase in result["phases"]:
                    phase["resources"] = sampler.summarize(phase["startMs"], phase["endMs"])
            return result
        finally:
            release_image.set()
            server.shutdown()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--app", type=Path, help="preview app bundle, defaults to the latest arm64 build")
    parser.add_argument("--baseline-app", type=Path, help="interleave a second preview with --app")
    parser.add_argument("--suite", choices=("workspace", "resources"), default="workspace")
    parser.add_argument("--rounds", type=int, default=1)
    parser.add_argument("--tabs", type=int, nargs="+", help="workspace sizes, or resource checkpoints up to 200")
    parser.add_argument("--fixture", choices=("static", "mixed"), default="static")
    parser.add_argument("--sample-seconds", type=float, default=4, help="resource sampling window per phase")
    parser.add_argument("--refresh-hz", type=float, help="display target for late-frame counts when macOS has no fixed rate")
    parser.add_argument("--memory-saver-check", action="store_true",
                        help="simulate aged background tabs and check that automatic maintenance preserves active and edited pages")
    args = parser.parse_args()
    if args.rounds < 1 or not 1 <= args.sample_seconds <= 120:
        parser.error("use one or more rounds and a sampling window of 1 to 120 seconds")
    if args.refresh_hz is not None and not 24 <= args.refresh_hz <= 500:
        parser.error("set --refresh-hz to a display rate between 24 and 500")
    if args.baseline_app and args.memory_saver_check:
        parser.error("run the feature check against a preview that implements Memory Saver")
    if not args.app and not LATEST_PREVIEW.exists():
        parser.error("build the Chromium preview first or specify --app")
    variants = [("candidate", args.app or Path(json.loads(LATEST_PREVIEW.read_text())["app"]))]
    if args.baseline_app:
        variants.insert(0, ("baseline", args.baseline_app))
    builds = []
    for label, app in variants:
        executable = app.resolve() / "Contents/MacOS/Wing Chromium Preview"
        if not executable.is_file():
            parser.error(f"preview executable missing: {executable}")
        with (app / "Contents/Info.plist").open("rb") as info:
            version = plistlib.load(info)
        with executable.open("rb") as binary:
            digest = hashlib.file_digest(binary, "sha256").hexdigest()
        builds.append((executable, {"variant": label, "build": version["CFBundleVersion"],
                                   "hostExecutableSHA256": digest}))
    counts = sorted(set(args.tabs or ([25, 250, 1000] if args.suite == "workspace" else [1, 10, 20, 100, 200])))
    if args.suite == "workspace" and args.memory_saver_check:
        parser.error("the memory saver check is part of the resources suite")
    if args.suite == "workspace" and (counts[0] < 21 or counts[-1] > 10000):
        parser.error("workspace sizes must be between 21 and 10,000 tabs")
    if args.suite == "resources" and (counts[0] < 1 or counts[-1] > 200):
        parser.error("resource checkpoints must be between 1 and 200")
    if args.memory_saver_check and counts[-1] < 34:
        parser.error("the memory saver check needs at least 34 tabs")
    display_hz = main_display_refresh_rate()
    host = {"machine": platform.machine(), "macOS": platform.mac_ver()[0],
            "model": subprocess.check_output(["sysctl", "-n", "hw.model"], text=True).strip(),
            "memoryBytes": int(subprocess.check_output(["sysctl", "-n", "hw.memsize"])),
            "mainDisplayHz": display_hz}
    for round_number in range(1, args.rounds + 1):
        order = builds if round_number % 2 else builds[::-1]
        for executable, build in order:
            context = {"round": round_number, **build, "host": host}
            if args.suite == "workspace":
                for count in counts:
                    print(json.dumps({**context, **measure(executable, count)}), flush=True)
            else:
                options = {"checkpoints": counts, "fixture": args.fixture,
                           "sampleMs": args.sample_seconds * 1000, "memorySaverCheck": args.memory_saver_check,
                           "refreshHz": args.refresh_hz or display_hz}
                result = measure(executable, counts[-1], resources=options,
                                 timeout=180 + (len(counts) + 5) * args.sample_seconds)
                print(json.dumps({**context, "fixture": args.fixture, **result}), flush=True)


if __name__ == "__main__":
    main()
