# Wing performance: memory, CPU, UI speed, startup

## Why

Wing should feel instant and stay light with dozens of tabs open: low memory, little CPU and GPU when idle, fast ⌘T and tab switching, and quick launches. This is the first of the feature projects (then search & history, tab automation, developer tools, focus & reading).

## Baseline (measured 5 Nov 2026)

Measured with a new repeatable benchmark on this M-series Mac, in an isolated test profile. Twenty "heavy" local pages, each with 4,000 animated elements, a 250 ms busy timer and about 16 MB of JavaScript data. The Intel engine build was compiling at the same time, so the timings are pessimistic.

| Measure | Result |
|---|---|
| Launch to usable shell | 1.56 s |
| ⌘T palette on screen | 14 ms median, 41 ms p95 |
| Switch tab | 31 ms median, 48 ms p95 |
| New tab (request to state) | 17 ms median, 37 ms p95 |
| Memory, no pages | 1.04 GB (extensions 389 MB, renderers 233 MB, main 180 MB, GPU 114 MB) |
| Memory, 20 heavy tabs | 2.9 GB (≈105 MB per tab) |
| Idle CPU, 20 heavy tabs | 21% of one core (background pages 13%, GPU 6.6%) |
| Manual "memory cleanup" | slept 5 of 7 live pages, took 8.8 s |

Your real Wing right after launch: 739 MB in 12 processes, idle CPU ≈ 0, with a camera service (60 MB) running though no camera is in use.

## Where the cost is

1. **Background pages keep running.** Chromium throttles hidden tabs, but busy pages still use 13% of a core between them. Tabs only sleep after 5 minutes idle or when over the live-tab budget, checked once a minute.
2. **Extension processes.** Full uBlock Origin keeps a background page with all filter lists in memory: about 200 MB, 389 MB in the first seconds after launch. Wing's own "services" page stays open permanently for occasional jobs (downloads, permissions, history and cookie calls).
3. **Services nobody asked for.** The camera service starts with no camera use.
4. **Slow cleanup.** Sleeping tabs checks one page at a time, waiting up to 5 s each.
5. **UI latency is already fine** (⌘T 14 ms, switch 31 ms). The work here is keeping it there.

## Plan, in order

1. **Make the benchmark permanent.** `npm run benchmark:wing` runs the scenario above and writes `docs/benchmark-wing.json`. Every later step reports before/after numbers from it.
2. **Freeze, then sleep, background tabs.** After 1 minute in the background, a tab is *frozen*: timers and animation stop, and the memory stays, so switching back is instant. After the idle time (setting, default 10 minutes), or under memory pressure, it is *slept* (discarded), as today. Protected as now: the active tab and its split, audio, calls/capture, picture-in-picture, pages with unsaved typing, DevTools. Plus anything you exempt per site.
3. **React to memory pressure.** When macOS reports memory pressure, sleep the least recently used background tabs right away instead of waiting for the next minute.
4. **Faster cleanup.** Check pages in parallel, so cleanup takes about a second, not about nine.
5. **Open the services page only when needed.** Start it on demand and close it after 30 s idle.
6. **Stop the camera service starting at launch.** Find what starts it and defer it until a page asks.
7. **Lighter ad blocking (your call, see below).**
8. **Startup.** Measure launch with a real-sized profile and keep restoring background tabs lazily. Paint the shell before loading extensions and the services page.

Targets (from the benchmark): no-pages memory under 700 MB, 20-tab memory under 1.5 GB after a minute in the background, idle CPU with 20 tabs under 3% of a core, ⌘T and tab switch at or below today's numbers, launch under 1 s.

## Not in scope

- Rewriting the engine or replacing Chromium.
- Sync, AI, and the other feature projects.

## Decisions for you

- **Ad blocker:** keep full uBlock Origin (strongest filtering, ≈200 MB) or switch to uBlock Origin Lite (built into Chromium's request blocking, near-zero memory, but slightly weaker: no custom cosmetic filters or element picker).
- **Freezing background tabs:** a frozen site stops receiving updates until you switch back, so Slack or Gmail open in a background tab would not update its unread badge. Options: freeze everything except an exempt list (pre-filled with Gmail, Slack, WhatsApp, Discord), or never freeze and only sleep.
- **Sleep timing:** default 10 minutes in the background, adjustable in Settings.

## Left to the builder

How freezing is wired into the engine (Chromium's page lifecycle freeze, exposed through the ArdiaCore API if needed), the benchmark's exact format, and how memory pressure is detected (macOS dispatch memory-pressure source).
