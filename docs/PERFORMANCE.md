# Performance evidence and limits

Wing ships the AppKit host with source-built Chromium. The Electron, CEF and WebKit results below describe earlier prototypes.

All measurements ran on macOS Apple Silicon with controlled local fixtures. The prototype reports are committed beside this document.

## Native Chromium everyday browsing

New-tab and address commands reach native layout before the coalesced workspace save. Ordinary tab selection sends the active tab, its activity timestamp and pane layout. Space changes, reopening saved tabs and changes to a saved tab's address still use a full sync. A serial native queue encodes and atomically saves workspace snapshots. Normal quit drains queued writes and flushes the latest selection, navigation and page metadata. Title and favicon updates share the next scheduled shell frame with loading progress. The command bar reuses its history and bookmark index during a session.

In two paired M3 preview runs with 72 saved tabs, 14 live pages, and 5,000 history records, median new-tab command through the next shell animation callback improved from 39.2 to 28.8 ms. Address navigation improved from 30.5 to 22.9 ms on the same measure. Enter hid the command bar in 0.6 ms, down from 142.6 ms. The fixed-load title-update fixture produced about 181 updates per run. Its median process-tree CPU moved from 1.56% to 0.89% of one core. These short local tests measure shell responsiveness and metadata work.

With 10,040 synthetic results, command-bar ranking took 2.9 ms per query after indexing, down from 14.0 ms. The one-time index build took 21 ms in that run.

## Native Chromium workspace

On macOS 26.6.2, a disposable profile restored 25, 250 or 1,000 pinned tabs in folders. After the first loopback page loaded, the test selected 20 tabs in order and measured from the selection call through the next animation frame. Only the visited tabs were opened by the engine. From the repository root, run `python3 scripts/benchmark-chromium-workspace.py` against the latest preview or pass `--app` to select a previous preview.

| Pinned tabs | Baseline median | Updated median | Baseline p95 | Updated p95 |
| ---: | ---: | ---: | ---: | ---: |
| 25 | 17 ms | 17 ms | 82 ms | 20 ms |
| 250 | 69 ms | 17 ms | 124 ms | 32 ms |
| 1,000 | 268 ms | 34 ms | 319 ms | 117 ms |

The updated renderer reuses existing sidebar and strip rows when selection or page metadata changes. In the same workload, a stalled image kept the load indicator active until Stop cleared it. The updated build cleared the indicator within 27 ms at all three workspace sizes. These are single-run samples on one Mac. Streaming, video calls, energy use, and memory under sustained pressure still need a real-site workload.

The current runner reports first visits and then selects the same pages after they have finished loading. Both timings end on the shell's next animation callback. For a paired comparison, build each revision's preview and keep both app paths. This runs three rounds with alternating build order. The JSON lines include the executable digest and macOS version.

```sh
npm run benchmark:workspace -- --baseline-app "/path/to/older/Wing Chromium Preview.app" --rounds 3
```

In three paired rounds at 1,000 pinned tabs on the same Apple M3, the median of first-visit selections moved from 66.5 to 50.6 ms and the median of warm selections moved from 32.7 to 25.2 ms. The medians of each run's p95 were approximately 133 ms for first visits and 34 ms for warm selections on both builds. The original preview was built from `ee74542`.

In a later three-round comparison against the preview immediately before background saves and smaller selection messages, the median of first-visit selections at 1,000 pinned tabs went from **31.2 to 16.7 ms**. The median of the run p95s went from 49.9 to 33.7 ms. Already-loaded selections stayed at one 60 Hz shell frame, with medians of 16.7 and 16.6 ms.

## Native Chromium resources

```sh
npm run benchmark:resources
npm run benchmark:resources -- --fixture mixed --tabs 1 10 20 100 200
npm run test:memory-saver
```

Each resource run restores a disposable workspace and visits every loopback page. The default checkpoints are 1, 10, 20, 100, and 200 visited tabs. Each phase reports saved, loaded, frozen, and discarded tab counts. The run closes the extra pages and measures the remaining tab again. The mixed fixture adds DOM work and background timers. Use `--sample-seconds 60` for longer idle samples and rely on the phase tab counts to see when freezing or discarding changed the workload.

At each checkpoint the harness samples CPU, interrupt wakeups, and macOS physical footprint for the browser and its descendants. CPU is expressed as a percentage of one core. The roughly 250 ms intervals can miss short spikes and accounting for CPU and wakeups excludes processes that start or exit between samples. The OS compositor and processes outside the browser's descendant tree are outside this measurement.

In two paired runs with 20 loaded static pages, each idle phase lasted eight seconds. Per-run idle medians were 0.06–0.10% of one core before background saves and smaller selection messages, and 0.07–0.10% afterward. During scripted sidebar scrolling with all 20 pages loaded, sampled CPU p95 was 0.84–0.88% before and 0.44–0.55% afterward. The short fixture shows similar idle CPU and lower scrolling p95 in both pairs.

The sidebar benchmark changes the scroll position from the shell's animation callbacks. This measures callback cadence under different tab loads. Use `--refresh-hz 120` to set the late-callback threshold on a 120 Hz display when macOS reports a variable rate. Real wheel or trackpad input and displayed frames require a separate capture.

Launch timing starts at process spawn. The harness polls the macOS WindowServer roughly every 20 ms for the first onscreen browser window and records when the loopback server receives the restored page's First Contentful Paint beacon. New-tab and warm-reveal timings include both the page's timestamp and beacon receipt when the page reports them. The warm-reveal marker waits for page visibility and two animation callbacks. These timings describe the qualification preview on local fixtures.

Memory Saver is off by default and can be enabled from the Performance panel. It checks up to 16 pages per maintenance pass and works toward a soft budget of 32 loaded pages. A page must have spent at least five minutes in the background. The existing critical-pressure cleanup remains available at any tab count. The memory saver check advances the maintenance clock in an isolated preview and verifies that recent and edited pages remain loaded, eligible pages sleep, and a sleeping page can reload.

On an Apple M3 with 16 GB of RAM and macOS 26.6.2, one 200-tab static run measured 8.34 GiB with every page loaded and 1.83 GiB after maintenance reached 32 loaded pages. All 200 tabs remained in the workspace. The process tree measured 595 MiB after closing back to one tab. The test simulated elapsed idle time across maintenance passes.

One run of the official Speedometer 3.1 suite scored 49.4 with a reported confidence interval of ±4.9 in the native preview at a viewport of 1,184 by 672 pixels. Use repeated, interleaved runs with the same viewport for comparisons. [Speedometer 3.1 instructions](https://browserbench.org/Speedometer3.1/instructions.html)

## Native Chromium cold launch

Three interleaved fresh-process launches per build on the 16 GB Apple M3 measured a median of **370 to 323 ms** to an onscreen window and **810 to 631 ms** to the restored page's First Contentful Paint beacon. The first paint improved in all three pairs. Window appearance improved in two, and the WindowServer poll adds roughly one sampling interval of uncertainty. The fixture uses one saved loopback page and a disposable profile for each launch.

Preview traces include engine readiness, window ordering, workspace read, first shell sync, profile load, protection staging, navigation hold and first document commit. In all three candidate runs, the 34 MB blocker finished staging before the first browsing profile loaded. The engine continued to hold navigation until the rules were ready. Its reported first-navigation wait was 141–184 ms in the candidate runs, and native qualification verified that the initial page's ad request was blocked. The browser services extension registers on first use.

```sh
npm run benchmark:resources -- --baseline-app "/path/to/older/Wing Chromium Preview.app" --tabs 1 --sample-seconds 1 --rounds 3
```

## Benchmark gaps against Ardia

Ardia publishes an externally driven benchmark with rotated browser order and results for opening a link from another app, new-window paint, settled idle CPU and wakeups, and power during idle, scrolling, tab switching and video. Its public results use different Macs and browser builds from these Wing runs. Wing still needs a same-Mac comparison on the same pages, with external input to visible paint, settled idle and power, plus display-level frame timing under real wheel or trackpad input with 200 loaded tabs. Wing's 200-tab fixture records tab lifecycle, browser-process CPU and shell animation callbacks. [Ardia benchmark results](https://ardia.dev/benchmarks/) · [Ardia methodology](https://github.com/ardia-browser/ardia/blob/main/docs/perf/vs-browsers.md)

## Native CEF diagnostic browser

`npm run benchmark:native` opens sixty native Chromium tabs in six batches of ten, using a real Manifest V3 worker. It samples the browser process and descendants using `ps`. Each close batch must return to one fixture tab. The bundled Wing extension is loaded too.

Latest successful run: 813 MB summed RSS baseline; 1.62–1.89 GB with eleven tabs; 797 MB final idle. All six closed batches returned to one tab. See [raw native report](benchmark-native.json) for the latest run, exact values, process details and timings.

RSS sums may double-count shared pages. `ps` CPU percentages are lifetime averages, not instantaneous CPU samples. Tab-create promise latency is not page-load or paint latency. Process caches may persist after tab closure. The test checks that live tabs return to baseline; it does not inspect every C++ allocation. Native Chromium's additional browser and extension services impose costs that the minimalist Electron fixture does not include.

## Electron browser engine

`npm run benchmark` creates sixty actual native Chromium WebContentsViews, ten concurrently, and destroys every batch. In the recorded run:

- Median local-document load: 55.31 ms; p95: 102.52 ms.
- Warm baseline: 245.33 MB summed working set.
- Ten live pages: up to 1,067.45 MB.
- Final idle: 240.88 MB; 0.01% sampled CPU.
- Every cleanup returned to zero remote webContents and three base engine processes.

This harness does not include the complete browser UI. [Raw report](benchmark.json).

The separate actual-application engine suite verifies real URL loading, no Wing privileged preload in pages (the extension adapter uses a separate session preload), history navigation, cookie partition isolation, the live-tab cap, sleeping-history restore, split protection, archive/restore and closing all views back to the shell-only baseline.

## AppKit/WebKit probe

`npm run benchmark:webkit` compiles and runs the native Swift/AppKit/WKWebView lifecycle probe. Sixty local documents; median 49.44 ms; p95 77.76 ms. Weak WKWebView references returned to nil after every cleanup. Host RSS was approximately 64 MB at baseline and 68 MB at the end.

**This excludes WebKit's content/network/GPU XPC processes**, unlike the Chromium process totals. The views are unattached. It cannot substantiate “WebKit uses one quarter of the memory” or establish UI smoothness. [Raw report](webkit-probe.json).

## Implemented resource controls

Native diagnostic host:

- Browser-native `tabs.discard`, rather than destroying and rebuilding a webview ourselves.
- Soft budget of 4 / 8 / 16 live tabs; two-minute alarm and explicit user-triggered trim.
- Never select active, split, audible, pinned, loading, already discarded, non-web or `autoDiscardable=false` tabs. Chromium retains its own final discard-safety checks. A soft budget can be exceeded by protected tabs.
- Event-driven sidebar updates coalesced at 100 ms. No continuously polling performance panel or background animation.
- Service-worker architecture lets the workspace controller suspend when idle.
- Local storage mutations serialized to prevent parallel UI requests overwriting each other.

Electron prototype:

- Lazy view creation, explicit child destruction, listener cleanup and detached hidden views.
- Conservative input/audio/capture/loading/split protection; form state preservation is not guaranteed for every programmatic page.
- Bounded per-tab navigation histories and archive/history records.
- Runtime state events coalesced; runtime-only changes do not rewrite the workspace file.
- Atomic serialized persistence; quit waits for in-flight writes before final flush.
- Diagnostic polling exists only while the monitor is open.
- Shell `backgroundThrottling` is disabled to avoid compositing stalls behind native page views. This can affect the window's frame scheduling, so universal background timer throttling is **not** claimed.
- Static gradients, short opacity/color transitions, reduced-motion handling and memoized sidebar markup.

## Before claiming production optimization

Run multi-hour workloads with large SPAs, video calls, media playback, downloads and extensions; collect allocation traces, renderer heaps, frame times, energy impact and memory-pressure behavior. Test repeated profiles/windows, back-forward caches, suspend/resume, permission capture, IME and crash recovery. Compare Arc and Wing on identical workloads and process accounting. No such exhaustive comparison has been completed here.

One intermediate native benchmark timed out during first-page startup. A clean rerun completed all sixty cycles; the timeout has not been attributed conclusively. Do not use the passing rerun to claim exhaustive startup reliability.
