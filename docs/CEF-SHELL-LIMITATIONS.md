# CEF custom shell experiment

The native host's `--experimental-shell` flag composes a frameless Chrome-style CEF BrowserView with an Alloy-style sidebar. It is an engine experiment, not the primary Wing application. `--use-native` overrides it. The stock native host remains useful for extension compatibility diagnostics.

## Observed on 2026-10-24, macOS arm64, CEF 156.0.8

- A custom frameless window starts and remains alive with `about:blank`.
- An authored local Manifest V3 fixture passes service worker, storage, tabs query, messaging, content scripts, and declarativeNetRequest checks.
- Creating another tab with an explicit original `windowId` opens a separate stock Chromium window. Source window ID: 235172661; result window ID: 235172664. Raw fixture evidence: [cef-custom-shell-probe.json](cef-custom-shell-probe.json).
- The existing fixture's `tabs.create({splitWithTabId})` path traps inside the CEF framework. LLDB reproduced `EXC_BREAKPOINT`; stripped framework symbols prevent claiming a precise failed assertion. The same framework's stock native host previously passed the split fixture.
- The Alloy sidebar initially encountered `ERR_BLOCKED_BY_CLIENT` while navigating to Wing's private extension page. The host's own request handler allowed the navigation. A subsequent user screenshot confirmed that the sidebar rendered after bounded retries were added. This is consistent with asynchronous extension registration at startup, rather than permanent Alloy incompatibility. The experimental host retries only its bundled shell resource up to four times at 500 ms intervals and stops if the browser closes. No privileged resources were broadly exposed through web-accessible resources.

These results disqualify this composition as a replacement for the shipping browser shell. They do not establish general CEF extension incompatibility; the limitation is the combination of custom Views hosting and native Chrome tab semantics.

## Explanation from upstream source

[CEF ChromeBrowserHostImpl](https://github.com/chromiumembedded/cef/blob/master/libcef/browser/chrome/chrome_browser_host_impl.cc) changes a Views-hosted normal browser into a trusted popup to omit native browser controls. Its comments also describe Views hosting as having a single ChromeBrowserHostImpl.

[Chromium OpenTabHelper](https://github.com/chromium/chromium/blob/main/chrome/browser/extensions/open_tab_helper.cc) routes extension tab creation through navigation. [Browser navigator](https://github.com/chromium/chromium/blob/main/chrome/browser/ui/navigator/browser_navigator.cc) requires tab-strip support, or an empty model, to add a tab to an existing window. Otherwise it selects or creates a normal browser window. This explains the observed cross-window result; it is not proof of the exact split crash cause.

A full CEF/Chromium integration would need supported engine changes and new compatibility tests for multi-tab custom Views hosting. Cropping native Chrome controls, reparenting private native views, or treating extension-created tabs as replacement windows would not preserve the API behavior and is not an acceptable production solution.
