> **Decision update:** This document records the initial research and Electron prototype. The later Chrome-extension requirement supersedes its engine choice. Native Wing now uses CEF Chrome runtime; see [ARCHITECTURE.md](ARCHITECTURE.md) and [PARITY.md](PARITY.md).

# Arc research and Wing design decisions

Research date: 23 October 2026. The installed Arc application reports version 1.169.0. This is a focused review of public engineering/product materials and observable desktop behavior, not an exhaustive archive of every blog, video, release, or proprietary implementation detail.

## Evidence about the stack

- **Rendering and compatibility:** Arc's official FAQ identifies Chromium as its engine and describes Chrome-extension compatibility. Wing also uses Chromium, through Electron; Electron does **not** provide all of Chrome's product integrations or extension compatibility. [Arc FAQ](https://arc.net/faq)
- **macOS application architecture:** Arc engineer Victoria Kirst describes a Swift/C++ browser, Chromium exposed through Swift bindings, and a product UI using SwiftUI, AppKit and The Composable Architecture. The same interview distinguishes their TypeScript/Node/Next.js web stack from the desktop client. This is a first-person engineering account from 2023, not verification of every current component. [Engineering interview](https://stackoverflow.blog/2023/03/28/the-next-gen-web-browser-has-no-tabs-only-spaces-ep-549/)
- **Windows investment:** The Browser Company's public Swift/WinRT project generates Swift language bindings for Windows Runtime. Its open-source organization also contains Swift toolchain and WinUI work. This establishes the native interop work; it does not expose Arc's complete browser source. [Swift/WinRT](https://github.com/thebrowsercompany/swift-winrt), [organization](https://github.com/thebrowsercompany)
- **Installed bundle:** Read-only inspection found ArcCore, FirebaseFirestoreInternal, Lottie, Sentry, Sparkle, absl, gRPC and OpenSSL-related frameworks. These establish bundled dependencies, not which features currently use them, whether telemetry is enabled, or the architecture of a remote backend. No proprietary source or user browsing database was copied.
- **Current lifecycle:** Arc's public homepage currently announces a 22 December 2026 sunset. This is time-sensitive public information, not a reason to copy its infrastructure. [Arc homepage](https://arc.net/)

## Interaction model

| Area | Observed or documented Arc behavior | Wing implementation / decision |
| --- | --- | --- |
| Browser chrome | Sidebar-first organization; compact toolbar; content occupies most of the window | Narrow resizable sidebar, compact controls, content-first layout |
| Command bar | Search/navigation combined with tab and action discovery | Keyboard navigation, exact-command matching, URL/search dispatch, tab and Space switching |
| Favorites | Persistent destinations shared within a profile | Profile-scoped favorites; lazy page creation |
| Pinned tabs | Persistent saved destination, with the ability to reset navigation | Separate home URL; explicit pin, rename, reset and archive actions |
| Today tabs | Temporary working set that can be automatically archived | Configurable 12h, 24h, 7d, or never; archive restoration |
| Spaces | Separate tab collections, visual identity and icon | Editable name/icon, six color themes, shared or separate profile |
| Profiles | Separate cookies, logins, history and preferences from visual Spaces | Electron persistent session partitions; history filtered by profile; no password manager |
| Folders | Organize related durable tabs | Collapsible folders; drag to folder or use the context menu; one level |
| Split View | Multiple pages visible in the same window | Two live native views, draggable divider, focused-pane controls; no persistent split groups yet |
| Peek | Temporary link preview above the original context | Cross-host links from pins; link context menu; Shift-click target-new-window path; close or open as tab |
| Focus | Sidebar can be hidden while browsing | Cmd+S and toolbar toggle |
| Customization | Boosts and visual themes | Per-origin CSS styles; no shared Boost service or arbitrary JS editor |
| Library | History, archive, downloads and creative artifacts | Searchable history/archive and session downloads |
| Creative tools | Easels and live captures | Not implemented |
| Assistance | Arc Max contains optional AI features | Not implemented; no silent data transfer to an AI service |

The local UI inspection covered sidebar layout, favorite tiles, Space dock, toolbar, new-tab command bar and focus mode. The app was placed on a public website for observation. Personal tabs were not imported or reproduced in Wing.

## Public product sources

- [Spaces](https://resources.arc.net/hc/en-us/articles/19228064149143-Spaces-Distinct-Browsing-Areas): visual contexts with separate pinned/unpinned tabs and themes. Wing keeps this distinction instead of treating Spaces as cookie partitions.
- [Profiles](https://resources.arc.net/hc/en-us/articles/19227964556183-Profiles-Separate-Work-Personal-Browsing): session identity can span multiple Spaces. Wing follows that relationship.
- [Command bar actions](https://start.arc.net/command-bar-actions): navigation and browser actions share a keyboard entry point.
- [Focus and multitasking](https://start.arc.net/find-focus): sidebar hiding and split-view workflows. Wing's split is deliberately limited to two panes in this release.
- [Multitasking guide](https://start.arc.net/master-multitasking): Little Arc and automatic mini players are distinct from Peek; Wing does not claim to implement them.
- [Creative tools](https://start.arc.net/paint-the-internet): Easels and live captures are substantial separate products, not just bookmarks with another name.
- [Arc Max](https://resources.arc.net/hc/en-us/articles/19335160678679-Arc-Max-Boost-Your-Browsing-with-AI): optional AI summaries and organization features; this is beyond Wing's local core.
- [Historical release notes](https://start.arc.net/release-notes): document the evolution of archiving, Peek, split views, CSS/JS customization, and tab suspension.
- [2024–2026 release notes](https://resources.arc.net/hc/en-us/articles/20498293324823-Arc-for-macOS-2024-2026-Release-Notes): show changes to sync, live folders and AI features as well as continuing Chromium updates.

Some help-center page opens redirected to an inaccessible Zendesk login; their publicly indexed text was available in search. That limits completeness. No claim is made that every feature from historical documentation remains present today.

## Why this stack, and what we would change

Wing uses Electron 45, Chromium 156, a plain JavaScript application layer and CSS. It does not recreate Swift merely because Arc uses Swift. There is no framework virtual DOM, client router, bundler, animation library or production npm dependency in the shell. The browser engine remains the largest cost.

Alternatives considered:

- **Swift/AppKit + WKWebView:** attractive for native macOS integration and potentially lower shell overhead, but changes the engine to WebKit and loses Chromium compatibility. A fair performance comparison requires equivalent workloads; none was performed.
- **Swift + Chromium/CEF:** closer to Arc's native approach, but adds a large embedding, build, release and security-update maintenance burden.
- **Tauri/system webview:** small distribution, but engine behavior varies by platform and would require substantial native integration for a complete browser.
- **Electron WebContentsView:** maintained Chromium distribution, native view composition, profile partitions and explicit content lifecycle. Chosen for a functional maintainable first release; not asserted to outperform native Arc.

Electron explicitly prefers WebContentsView over the changing webview-tag API for this use case. [Embedding guidance](https://az.electronjs.org/docs/latest/tutorial/web-embeds), [WebContentsView API](https://www.electronjs.org/docs/latest/api/web-contents-view)

Remote pages have no privileged preload, no Node integration, context isolation and sandboxing. The trusted local shell has a narrow validated IPC bridge, and remote navigation is restricted to HTTP(S). [Electron security guidance](https://github.com/electron/electron/blob/main/docs/tutorial/security.md?plain=1)

## Improvements over a literal copy

1. Keep favorite and pinned pages unloaded until visited. A bookmark should not automatically cost a renderer.
2. Use an explicit soft live-tab budget with conservative protection for ongoing work.
3. Preserve small, bounded navigation histories for sleeping tabs; destroy native renderers rather than merely hide every visited page forever.
4. Coalesce state events, patch unchanged sidebar subtrees only when necessary, avoid repeated native bounds changes, and write state asynchronously.
5. Make resource use visible in a performance panel. No polling runs while that panel is closed.
6. Use short transitions for feedback, respect reduced-motion preferences, and avoid perpetual home-screen animations.
7. Own the visual identity and wording. Wing is independent; no Arc assets, proprietary code, accounts, sync APIs or branding are bundled.
