# Performance evidence and limits

The primary build now uses Electron. These engine-only measurements are not evidence that its complete UI is faster than Arc.

All measurements were made locally on macOS Apple Silicon, using controlled local fixtures. Raw reports are committed beside this document. These are short lifecycle tests, not an Arc-versus-Wing benchmark and not proof of the absence of leaks.

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

Primary Electron application:

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
