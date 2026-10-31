# Current engine decision (2026-10-24)

Primary Wing now uses Electron 45 + sandboxed WebContentsView + electron-chrome-extensions 4.9.0, with an original browser shell. Actual production-adapter testing established MV3 worker/storage/content/messaging/tab APIs and dynamic DNR support. Static DNR needs explicit extension-side ruleset activation in the tested engine. Web Store installation and universal extension compatibility are not claimed.

This replaces the earlier decision below. The CEF native host preserved extension APIs but exposed stock Chrome UI. Its custom Views host cannot safely use the normal tab model: a second tab leaves the custom frame; split creation caused SIGTRAP within CEF. Evidence: `CEF-SHELL-LIMITATIONS.md` and `cef-custom-shell-probe.json`. Electron gives Wing ownership of tab, split, overlay and lifecycle behavior without unsupported native view surgery. Both runtimes use Chromium156 in this environment; the wrapper alone does not determine resource use.

The custom renderer has a narrow trusted IPC bridge. Remote pages remain sandboxed, context isolated, without Node integration or Wing's preload. The extension adapter adds its own session/worker preload for Chrome APIs; profile sessions are separate from the shell session. The adapter's source license determines GPLv3 distribution terms.

Primary references: [Electron extension API limitations](https://www.electronjs.org/docs/latest/api/extensions/), [extension adapter documentation](https://github.com/samuelmaddock/electron-browser-shell/tree/master/packages/electron-chrome-extensions), plus local executable test evidence in `extensions-electron-wing.json`.

---

## Previous engine decision, retained as research history

# Engine decision: Chrome extensions are a hard requirement

The initial Electron implementation is retained as a **UI and lifecycle prototype**. The default packaged browser is now **Objective-C++ / AppKit + CEF's windowed Chrome runtime**, with Wing's workspace UI shipped as a bundled Manifest V3 extension. This is an early browser implementation, not an assertion of Arc parity.

## Options examined

| Option | Benefits | Material limits for Wing | Decision |
|---|---|---|---|
| AppKit + WKWebView | Native macOS controls; system engine updates; modern profile data stores; small host | Safari/WebKit extensions are not interchangeable with the full Chrome extension platform | Built a real lifecycle probe; rejected as the primary engine because of Chrome extensions |
| SwiftUI/AppKit + Chromium source | Maximum control over native UI and browser integration; closest to Arc's public architecture | Large source/toolchain footprint, continual security rebases, extensive native glue and distribution work | Long-term route to full custom UI with Chrome fidelity; not falsely represented as completed |
| Electron + WebContentsView | Mature native view composition, isolated sessions, straightforward split panes, fast implementation | Official extension API is a subset; arbitrary Web Store extensions are unsupported | Working polished prototype; not the extension-capable release |
| Tauri 2 + WRY | Small host and Rust application layer; native webviews | macOS uses WebKit, so does not meet the required Chrome extension model | Rejected for default browser |
| Tauri 3 alpha + CEF | Possible shared Chromium runtime behind Tauri | Alpha integration does not remove CEF Chrome-vs-Alloy constraints; adds another layer | Investigated, not shipped |
| CEF Alloy embedding | Flexible page composition, offscreen/native embedding | Our MV3 fixture ran content scripts and DNR, but `chrome.tabs.query` returned no tabs; native Chrome extension UI unavailable | Rejected for a general extension compatibility claim |
| CEF windowed Chrome runtime | Actual Chromium tabs, extension manager, MV3 workers, permissions, toolbar actions | Native Chrome window structure; only one Chrome-style BrowserView per CEF Views window; direct Web Store install currently unsupported in tested build | **Selected for native Wing alpha** |

AppKit is a UI framework; Chromium and WebKit are browser engines. Electron and Tauri are application hosts. Comparing these as equivalent choices hides the important boundaries.

## Native release boundaries

- `native/host`: Objective-C++ lifecycle, Cocoa menus, Chromium commands, separate Wing data root and bundled extension loading. Based on the BSD-licensed CEF sample, with notices preserved.
- `native/extension`: original Wing home and Spaces sidebar. Browser-native tab operations through Chrome extension APIs, serialized storage mutations, local archive, tab groups, themes and conservative discard budget. No Node runtime or HTTP backend.
- `native/cef-lock.json`: exact official binary distribution, upstream SHA-1, size and recorded SHA-256. Build script validates both before extracting.
- Chrome runtime owns remote page isolation, permission dialogs, extensions and navigation. Wing does not inject a privileged bridge into arbitrary pages.
- The bundled extension has no host permissions or content scripts. It can see tab metadata and manage tabs; these are necessary for a browser workspace. Its messages are accepted only from its own extension pages.
- Content security policy forbids remote scripts and inline script execution. Titles and URLs are HTML-escaped in the UI.
- `~/Library/Application Support/Wing Native/Default` contains the native profile. Cache paths are canonicalized before CEF initialization so `/var` versus `/private/var` aliases cannot silently force an in-memory profile.
- Spaces are **organizational**, not cookie-isolation boundaries, in this native alpha. Use Chromium's profile facilities for isolation; profile workflows have not received complete acceptance testing.
- Source is MIT except inherited CEF host portions and third-party dependencies, which retain their licenses. Neither Arc branding nor proprietary Arc source is included.

## Why retain native Chrome UI?

The local CEF header explicitly limits a Chrome-style Views window to one Chrome-style BrowserView. Alloy views can coexist, but the tab API failed in the Alloy fixture. Replacing all native tabs with individually embedded Alloy views would trade away the user's explicit extension requirement. Native Wing therefore retains the native tab strip and toolbar while its Spaces sidebar supplies organization. Chromium 156 also supplies native split browsing; this was verified with two real websites and is exposed through Wing’s native menu. Its current extension split API lets the sidebar create/separate splits and lets the discard policy protect both panes. It is not the earlier Electron shell with a new engine silently substituted.

## Primary sources

- [Arc FAQ: Chromium and Chrome extensions](https://arc.net/faq)
- [Arc engineer interview: Swift, C++, SwiftUI/AppKit and Chromium](https://stackoverflow.blog/2023/03/28/the-next-gen-web-browser-has-no-tabs-only-spaces-ep-549/)
- [AppKit](https://developer.apple.com/documentation/appkit)
- [WebKit profile APIs](https://webkit.org/blog/14423/building-profiles-with-new-webkit-api/)
- [WebKit 18.4 extension APIs](https://webkit.org/blog/16574/webkit-features-in-safari-18-4/)
- [Tauri 2 system webviews](https://v2.tauri.app/reference/webview-versions/)
- [Tauri 3 alpha CEF integration](https://v3.tauri.app/develop/cef/)
- [Electron extension limitations](https://www.electronjs.org/docs/latest/api/extensions)
- [CEF architecture and runtime styles](https://chromiumembedded.github.io/cef/architecture)
- [CEF general usage](https://chromiumembedded.github.io/cef/general_usage)
- [CEF issue: extension UI unavailable in Alloy](https://github.com/chromiumembedded/cef/issues/3859)
- [CEF issue: runtime extension loading](https://github.com/chromiumembedded/cef/issues/3877)
- [Chrome Side Panel API](https://developer.chrome.com/docs/extensions/reference/api/sidePanel)
- [Chromium sidebar alignment preference](https://chromium.googlesource.com/chromium/src/+/HEAD/chrome/common/pref_names.h)

Research was bounded to representative primary documentation, engineering interviews, release notes, public source and hands-on local behavior. It is not a claim to have read every Arc publication or reverse-engineered its private internals.

- [Chrome 155+ Split View extension API](https://developer.chrome.com/blog/split-view-api-extensions?hl=en)
