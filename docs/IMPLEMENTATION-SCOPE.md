# Wing: Arc and Ardia feature and interaction program

Started 2026-10-24. Scope was requested while research was in progress; no numbered 48-item list had yet been delivered. This ledger makes the 48 workstreams explicit. A workstream is complete only when its UI, persistence, cancellation, keyboard behavior and relevant real-engine checks work. Existing implementation is credited; a menu item or mock is not completion.

Reference: [Arc resources](https://resources.arc.net/), [Ardia](https://ardia.dev/), [Ardia release notes](https://ardia.dev/release-notes/), [Ardia implementation ledger](https://github.com/mantrakp04/ardia/blob/main/docs/dia-feature-parity.md). Ardia's documented claims have not been independently qualified in Wing. Arc's official site announces desktop shutdown on December 22, 2026. Retired Arc Notes and Ask on Page are historical references, not claims about current Arc.

| # | Workstream and acceptance boundary | Starting state |
|---|---|---|
| 1 | Multiple normal windows, per-window active page and geometry, shared profile workspaces | Missing |
| 2 | Private windows with memory-only cookies, history, permissions and downloads metadata | Missing |
| 3 | Little Wing quick windows, profile selection, promote without losing page context | Missing |
| 4 | OS default browser, external URLs, external application protocols | Missing |
| 5 | URL routing to Spaces/profiles with explicit fallback | Missing |
| 6 | Full Web Store installation and representative extension compatibility | Partial; adapter limitations |
| 7 | Extension enable/disable, options, updates, toolbar pinning and shortcuts | Partial |
| 8 | Native messaging/password-manager extension integration | Unqualified |
| 9 | Full uBlock Origin, tracker and cookie-banner filtering; de-Googled engine; private opt-in crash reporting | Engine change required; Lite test currently fails |
| 10 | Password creation, save/update, generation, management and site-specific fill | Import and explicit fill only |
| 11 | Address/payment autofill and device authentication | Missing |
| 12 | Passkeys and OS credential integration | Unqualified; platform/signing dependencies |
| 13 | Persistent per-site permissions, revocation, site data and certificate controls | Session prompts only |
| 14 | Screen/window/tab sharing chooser, capture indicators and stop/switch sharing | Unqualified |
| 15 | Persistent downloads, pause/resume/cancel/retry and destination preference | Session list only |
| 16 | Print, save page, PDF workflows and local document opening | Missing shell controls |
| 17 | Session/crash recovery with navigation history, layouts and restore UI | Atomic workspace persistence exists |
| 18 | Encrypted cross-device sync and mobile handoff/client | Missing; separate service/client scope |
| 19 | Signed/notarized releases, published update feed, channel selection and rollback | Tooling exists; credentials/feed absent |
| 20 | Repeatable whole-browser performance, power, endurance and compatibility qualification | Lifecycle measurements exist |
| 21 | Durable 2–3-pane split groups, reorder/resize, pin/move, restore and remove pane | Temporary pair only |
| 22 | Peek modifier-click, dismissal, navigation, promotion to tab/split with context retained | Basic overlay exists |
| 23 | MRU tab switcher with held-key preview, release commit and cancel | Sidebar-order cycling |
| 24 | Command palette covering actions, history/bookmarks/tabs, profile context and calculator | Eleven commands and tab/Space matching |
| 25 | Custom search engines, site-search shortcuts and document-creation shortcuts | Google/DuckDuckGo only |
| 26 | Rebindable keyboard shortcuts and webpage/text-field conflict handling | Fixed shortcuts |
| 27 | Persistent pins/favorites: close vs remove, icon reset, rename/custom icons | Close archives saved destination |
| 28 | Tab multi-select and bulk move/pin/close/copy | Missing |
| 29 | Nested folders, rename/move/reorder, previews and active-child visibility | Flat folders, remove only |
| 30 | Predictable drag/drop: pin/unpin, groups, split targets, reorder and cancellation | Basic tab drop/reorder |
| 31 | Workspace undo/redo for organization and destructive actions | Text undo only |
| 32 | Profile management and independent Space switching, shared-profile contexts | Core separation exists |
| 33 | Per-profile archive settings, protected activity, searchable recovery and bulk restore | Global timing and archive |
| 34 | Optional top toolbar/sidebar address, focus mode and collapsible pinned section | Sidebar hide/reveal exists |
| 35 | Automatic appearance, gradients, custom icons and theme controls | Per-Space light/dark color roles exist |
| 36 | Site and folder previews with explicit integration consent | Missing |
| 37 | Live calendar countdown/join workflow | Missing; account integration |
| 38 | GitHub live folders and review/PR status | Missing; account integration |
| 39 | Automatic picture-in-picture and return-to-tab behavior | Unqualified |
| 40 | Persistent media mini-player, playback controls and capture indicators | Audio mute only |
| 41 | Visual Boost editor, element zapper, CSS/JS controls and per-site management | Local CSS editor only |
| 42 | Region/full-page capture, copy/export and portrait framing | Internal overlay snapshots only |
| 43 | Local visual canvas/Easels with captures, text, links and export | Missing |
| 44 | Clean link copy, bulk URLs, native sharing and portable Space/folder/split export | Raw URL and whole-workspace JSON only |
| 45 | Broader browser migration, open tabs, layouts and extensions with skip reporting | Arc/Chrome partial import |
| 46 | Page translation with clear provider/privacy controls | Missing |
| 47 | Optional AI summaries, tidy titles/downloads/tabs and instant links | Missing; provider/model dependency |
| 48 | Onboarding, searchable settings, accessibility and interaction acceptance suite | Focus/reduced-motion foundations exist |

## Interaction acceptance, required across workstreams

- Mouse, keyboard, touchpad and context menu lead to the same durable action.
- Escape cancels transient work and restores focus; modifier keys do not hijack page editing.
- Drag previews reflect the actual outcome, support cancellation, and avoid accidental splits.
- Close, remove, unload and archive are distinct; saved destinations survive closing.
- Tabs retain profile identity; cross-profile search results identify their destination.
- Split groups survive navigation away, restart, pinning and moving as a unit.
- Long titles, empty spaces, errors, loading, audio/capture and sleeping states remain understandable.
- Undo covers organizational changes; explicit deletion/data clearing has a concrete confirmation.
- Modal and native-page geometry remain synchronized; focus is never stranded behind an overlay.
- Reduced motion and screen-reader names/states are verified, including custom controls.
- No network/provider-dependent feature is reported as operational without its dependencies.

## Reproduced regressions

`node --test test/arc-interaction-regressions.test.cjs` initially failed all three checks: closing a pin removed its destination, Ctrl+Tab used sidebar order, and returning to a tab lost its split. Fixes are delegated after reproduction as required by the user's AGENTS instructions.

## Engine constraint

The current production host is Electron. Full uBlock Origin and de-Googling must be qualified against a suitable Chromium build; an extension label or a small hand-written blocklist does not meet this requirement. Ardia documents its patched Chromium framework and retained browser services. Disk availability increased from 9.8 GiB at initial inspection to approximately 137 GiB after the user's cleanup. Source preparation now uses a dedicated ignored root, pinned revisions and a 15 GiB free-space stop threshold. User backups and existing releases must not be deleted to make room.

## Implementation evidence, 2026-10-24

The starting-state column above is the baseline, not a current completion score. The following work has landed in source; this does not close the full program.

- Persistent pins/favorites, durable two/three-pane groups and MRU switching have regression and real Electron-engine coverage. Split groups support shared organization and restored geometry. MRU native modifier-release behavior still needs a physical-key check on macOS.
- Search shortcuts, routing rules, clean URLs, calculator, nested folders, selection/bulk actions, organizational undo, site controls, download controls and print/save/capture entry points are integrated. Several have unit coverage; their complete interaction acceptance and native Chromium migration remain open. Native full-page PNG capture is now qualified below; region selection, clipboard export and portrait framing are implemented in the native shell; see the additional qualification below.
- The isolated full-uBO Electron test fails actual request blocking. The reported destroyed-WebContents exception in that fixture now has a regression test and guarded cleanup.
- The replacement Chromium framework is checksum-verified. Its isolated native full-uBlock qualification passes network blocking, cosmetic filtering, official cookie-list filtering, explicit exceptions and restart persistence. Four scenarios exit cleanly. The separate Wing native preview now also passes first-page blocking, default bundled cookie filtering and dashboard access. Updates and universal real-site cookie coverage remain unqualified. See `FULL-UBLOCK-ENGINE.md` and the qualification reports.
- Source preparation is reproducible through `scripts/prepare-chromium.py` and `native/chromium-sources.json`. This is source staging, not a completed Wing engine build or app migration.

The initial native full-uBO gate and isolated Wing host integration gate have passed. The native preview reuses the existing interface and workspace model, with profile isolation, pinned splits, real navigation, close/reopen and restart qualification. It requires a disposable profile and mock keychain; it is not a production migration. The next gates are the reproducible source build, Wing engine identity, complete host API migration and hands-on interaction qualification. Release signing, external-account features, sync/mobile, all 48 interaction checks and the privacy-network audit remain required. The shared implementation passes 152 unit tests; the last Electron engine run passed 20 checks. Fourteen Python release/source-build checks pass. This test count is evidence for implemented behavior, not a count of completed workstreams.

### Native migration checkpoint

The host now implements browser-service history/downloads/bookmarks, persistent site controls, extension management and install prompts, file export entry points, native context menus, site CSS, overlay snapshots, process metrics, transient Peek, DevTools layout, automatic idle-tab archiving with draft/media/split protection, native password/autofill prompts, and the isolated browser importer. Startup tests exposed component-document replacement during Chromium registry initialization; owned service/readiness documents recover within a deadline while browsing remains blocked until full uBO reports populated engines.

The new source APIs for download directories, cookie flushing and password-store imports await compilation and real-engine qualification. The Chromium build has completed sync/patch/configuration and is compiling in `../wing-chromium-build`, outside the app's npm dependency tree. This is not completion of all 48 workstreams. Multi-window/private browsing, full interaction/device coverage, signed release/update delivery, source-engine qualification and the separately listed service/account features remain open.

Native rendering checks now inspect window attachment and hidden ancestors, in addition to pane bounds and navigation. This caught Chromium hiding inactive split panes; the host explicitly restores all displayed pane views after tab activation. Startup initializes Chromium widget visibility and shell focus. Website pixels, command-bar typing and Enter, settings, Escape restoration, sidebar toggling, and clean keyboard quit have been checked manually on the final preview; broader interaction acceptance remains open.

### Further native migration work

- Extension side panels use real Chromium extension views, resize native page panes, and close on owning-tab/profile changes. A component-extension fixture qualifies document rendering, geometry and cleanup. Broad third-party extension compatibility is still unqualified.
- Persistent-profile packaging now rejects upstream prebuilt engines, stale host inputs, missing restart qualification and unsafe persistence reports. The production path uses a dedicated `Wing/Chromium` profile, real keychain storage, and no test bridges. It has not yet been executed against a completed Wing source build.
- The staged application registers HTTP/HTTPS URL handling and implements the settings action that asks macOS to make Wing the default. The preview refuses this operation.
- External application links have native confirmation and cancellation, with origin checks and cleanup on navigation/tab closure.
- This machine has no Developer ID Application identity or configured signed-release update feed. Signing/notarization and update distribution cannot be completed until those dependencies exist. Existing Electron session cookies and credentials are not automatically migrated by staging the new application.

The latest native qualification passes 24 initial-run checks and five restart checks, including floating-video cleanup protection and favorite-tile media state. Its recorded host-input hashes match the current source tree. The external-protocol cancellation fixture never launches another app; the extension fixture exercises a real component extension, including owner closure. The complete program remains open: multi-window/private browsing, device/sharing coverage, automatic Electron credential migration, production keychain qualification, updates/signing and the separately listed account/cloud features are not marked complete.

### Legacy Wing data migration

The explicit profile importer now discovers Electron Wing profiles from their validated workspace and reads each profile's own partition. It remaps Spaces, nested folders, pin destinations, split groups/weights and archived tabs into a fresh native profile while preserving the source. The real native fixture verifies cookies and layouts through process restart. Unit tests cover v10 password-vault decryption, fresh identity mapping, source preservation, concurrent workspace rebasing and rollback on unsupported vault data. Source-engine qualification now additionally requires the imported password to persist as ciphertext in Chromium's password database; that gate has not yet run against the still-compiling source engine. No real user profile or Keychain secret was accessed during these fixture tests.

### Device chooser and full-page capture

The native device chooser shows Chromium's live device list, requires explicit selection, supports refresh/settings/cancellation, and closes when its owning document changes or closes. Duplicate device names retain distinct engine indices. A real WebUSB request is cancelled in the native fixture and rejects access in the page; selecting physical USB, serial or Bluetooth devices remains unqualified.

The native command palette now exports full-page PNG images using Chromium layout metrics and screenshot capture, without resizing or scrolling the live page. Oversized documents return an explicit error instead of silently cropping. Qualification decodes the PNG, verifies offscreen document content is included, and checks viewport/scroll preservation. Region selection, portrait framing and clipboard export have since been added; see the additional qualification below.

The expanded native suite has a five-minute scenario deadline and retains individual operation deadlines. Its latest run passed 22 initial checks and five restart checks. The initial two-minute whole-suite deadline timed out once during concurrent source compilation; the subsequent runs passed. An early syntax-only check of the source password-import API stopped at a not-yet-generated Chromium header, so compilation and password-store qualification remain pending the complete build.

### Capture editor and media controls

The native capture editor operates on an in-memory screenshot. Mouse/touch dragging and labelled pixel-coordinate fields choose a rectangle; Escape cancels and restores the underlying page. Users can save a PNG, copy it to the clipboard, or add a 9:16 portrait frame. The native exporter validates PNG headers, dimensions and encoded size before decoding. Qualification runs the real editor, exports selected pixels through the native decoder, checks portrait dimensions, checks Escape cancellation and rejects malformed input. The test does not replace the user's clipboard. Native save-dialog cancellation keeps the editor open.

Picture-in-picture now uses Chromium's native video control API and reports its live state to the sidebar. Opening and closing a real canvas-stream video are qualified. Automatic picture-in-picture is opt-in through Browsing & workspace settings and persists through restart; its eligibility and automatic transitions across real sites are not yet qualified. Floating video tabs are excluded from background cleanup and archiving; the real-engine test switches away from a floating video, runs memory cleanup and verifies its native page remains alive and undiscarded. Camera/microphone activity is displayed separately from the clickable screen/tab-sharing stop indicator, because the engine's stop API only covers display capture. Physical-device and screen-sharing chooser coverage remain open.

### Source build configuration correction, 2026-10-25

The first source compile stopped in `cdm_storage_id.cc`: the inherited configuration enabled CDM storage IDs while Wing disabled RLZ. Chromium's macOS storage-ID implementation requires RLZ machine identification. Wing now explicitly disables `enable_cdm_storage_id` alongside RLZ while leaving library CDM support enabled. A regression test reproduces the incompatible inherited settings and verifies the override is idempotent. Hardware-bound DRM compatibility remains unqualified; this correction is not a claim that protected streaming services work. Existing compiled objects are retained for the incremental restart.

During monitoring, a syntax-only compile of the native profile API exposed two capturing lambdas rejected by Chromium's `base::BindOnce`. The cookie-flush and password-import callbacks now bind their state explicitly through stateless lambdas. The exact pinned compiler command passes syntax checking against generated Chromium headers (exit 0); the full build and password persistence qualification are still required. Compilation was stopped cleanly before applying the generated-source correction and resumes incrementally.
