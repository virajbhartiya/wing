# Implementation record and next release gates

1. Inspected installed Arc and researched public engineering, help, release and product sources. Findings: RESEARCH.md.
2. Built and exercised a Chromium/Electron custom UI prototype: Spaces, isolated profiles, pins, folders, split, Peek, command palette, CSS styles, archive, downloads, persistence and diagnostics.
3. Added pure-state/lifecycle/persistence tests and real engine integration tests. Measured 60 Chromium native-view lifecycles and 60 AppKit/WKWebView lifecycles.
4. User made Chrome extensions a hard requirement. Reconsidered AppKit/WebKit, Chromium source, Electron, Tauri 2, Tauri 3 alpha and CEF. Decision: ARCHITECTURE.md.
5. Built a native Objective-C++ CEF Chrome-runtime application with sandboxed helpers, Cocoa menus, an isolated persistent data root and a bundled original Wing workspace extension.
6. Ran actual MV3 integration probes. Chrome style passed; Alloy style failed tab enumeration. Retained full native Chrome UI rather than sacrificing extension compatibility for an unsupported embedding design.
7. Measured native Chromium tab churn, packaged both builds, and documented limitations separately.

## Remaining release gates

- Direct Web Store installation and representative third-party extension compatibility, including native messaging.
- Full custom split/Peek/sidebar layout preserving native extension behavior; likely Chromium integration beyond current CEF Views surface.
- Reliable restore and multi-window/profile acceptance suite, tab-to-Space identity across crashes and session restore.
- Long-running memory/CPU/energy and video conferencing workloads, allocation traces, scrolling/frame-time profiling, wake/sleep behavior.
- Accessibility review, IME, drag interactions and all keyboard shortcuts.
- Signed/notarized builds, update channel, security patch SLA, distribution and rollback.

The delivered artifact is an alpha, not completion of these release gates or a complete replacement for Arc.
