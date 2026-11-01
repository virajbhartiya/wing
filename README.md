# Wing

An independent, open-source desktop browser for Apple Silicon Macs, with Safari's layout and Arc's design: Spaces, a command palette, split view and Peek. It runs on a native Chromium engine, so Chrome extensions install directly from the Chrome Web Store.

Early build: releases are not yet signed with a Developer ID or notarized, and there are no automatic updates. Touch ID and iCloud passkeys need Apple signing.

## Install

Download the latest DMG from [Releases](https://github.com/virajbhartiya/wing/releases), drag Wing to Applications, then right-click it and choose Open.

## Build

Building the engine needs a Chromium checkout, a large disk and several hours. See `docs/ARCHITECTURE.md`.

```sh
npm ci
npm test
export WING_CHROMIUM_BUILD=../wing-chromium-build-156
python3 scripts/build-chromium-preview.py --source-receipt $WING_CHROMIUM_BUILD/wing-build-receipt.json
npm run test:chromium-preview
npm run build:chromium-production
```

## Release

`scripts/release-native.py` runs the tests and qualification, then builds a zip, a DMG and checksums in `dist/`. It refuses a dirty tree.

```sh
python3 scripts/release-native.py
python3 scripts/release-native.py --publish --notes notes.md
```

## Your data

- Wing keeps hourly workspace backups in `wing-workspace-backups` in its profile folder, and one before each import. If the workspace is damaged, Wing keeps the damaged file and restores the newest usable backup.
- Deleting an imported profile's last Space removes that profile. Its cookies and site data are deleted the next time Wing starts; its history and archived tabs are kept.
- Help → Report a Problem opens a prefilled issue. Nothing is sent automatically.

## Command line

```sh
ln -s /Applications/Wing.app/Contents/Resources/bin/wing ~/.local/bin/wing
wing https://example.com
wing --space Work :3000
wing --debug 9222
```

`wing --debug` starts Wing with remote debugging, so Playwright, Puppeteer or a coding agent can drive it over the Chrome DevTools Protocol. It exposes every profile to local processes, so use it only when you need it.

## What works

Tabs come back with their scroll position and back/forward list, for the 25 most recently closed tabs. Chromium keeps no more than that. Also: throwaway Spaces deleted at next launch, duplicate tab cleanup, grouping tabs by site into folders, a per-site ad-blocking switch, a Space picker for links from other apps, capture annotation, and an estimate of memory saved by sleeping tabs.

- Safari-style toolbar and top tab bar by default. Move tabs to an Arc-style sidebar in **Settings → Tabs** or with ⌥⌘S.
- ⌃1–9 switches profiles.
- Custom window chrome, vertical tabs, pinned tabs, favorites and folders.
- Spaces with independent persistent profile partitions, colors and dark appearance.
- Keyboard command palette, navigation, horizontal/vertical resizable split panes, Peek and site styles. Drag onto the center of another sidebar tab to merge; drop at its top edge to reorder. Choose split direction with the split control.
- Favorite toolbar star and Favorites drop area; favorites follow profile boundaries.
- Hide the sidebar with ⌘S and move to the left window edge to reveal it temporarily. Horizontal sidebar swipes switch to the next/previous profile.
- Edit a Space to customize 13 interface color roles independently for light and dark appearance, with live preview, hexadecimal alpha values and preset reset.
- Archive/restore, JSON workspace backup, downloads and a live process monitor.
- Background tab lifecycle budget protecting active pages, splits, audio, capture and typed input.
- Unpacked Chrome extensions through `electron-chrome-extensions`, registered against Wing's actual tab model. Manage them in **Settings → Extensions**; extension actions appear in the toolbar. Installations persist per profile and their source folders must remain available.

## Profile import and login migration

**Settings → Import browser** finds Arc, Chrome and Safari data. Choose a browser, then one or more of its profiles. Import bookmarks, history, Spaces and open tabs, supported session cookies, and saved passwords into a new isolated Wing profile. Source browser data is read-only. Passwords are re-encrypted using Wing’s OS-protected storage and can be filled explicitly on the exact HTTPS site from Settings. Passkeys, device-bound/partitioned sessions and site database tokens are not transferred; some websites require signing in again. Safari needs Full Disk Access, and its passwords come from a Passwords app CSV export. Extensions are listed for reinstalling. See `docs/PROFILE-IMPORT.md`.

Command-T preserves a bounded, memory-only page backdrop behind the palette. Sidebar hover reveal animates HTML and native page bounds together; trackpad momentum switches profiles once per gesture.

## Extension compatibility

The real production-engine fixture verifies MV3 service workers, storage, messaging, content scripts, tab enumeration/create/remove, dynamic request blocking, and static blocking after the extension explicitly enables its ruleset. It also checks profile isolation. See `docs/extensions-electron-wing.json`.

**This is not universal Chrome compatibility.** Web Store links can be installed from Settings → Extensions with CRX3 signature verification and a permission review; the store webpage’s own install button is not integrated. Some Chromium APIs remain unsupported, including complete native Chrome window/tab-group semantics. In the tested Electron engine, a static DNR ruleset marked `enabled: true` in its manifest was initially inactive; explicit activation from the extension worked. Verify an extension's behavior before relying on it. An unmodified official uBlock Origin Lite release starts after the namespace compatibility fix, but failed its blocking qualification; it is not currently supported reliably. See `docs/ubol-electron-qualification.json`. Native messaging, DRM, password-manager integration and arbitrary popular extensions have not been qualified.

## Developer tools

From the command palette or Site Controls: view, delete and copy a site's cookies, view a page as a JSON tree, and reload unpacked extensions on demand or whenever their files change.

The **Develop** menu and the command palette hold the page tools: DevTools (⌥⌘I / ⌥⌘J), Reload Ignoring Cache (⇧⌘R), View Page Source (⌥⌘U), Clear Data for This Site, and Open Page in Safari, Chrome or Firefox. Per-tab overrides cover cache, JavaScript, device size, color scheme, network speed and user agent. The palette also lists web servers listening on this machine as `localhost:PORT`. Self-signed certificates are accepted on localhost.

The command palette also has Block Requests, Copy as curl, Decode JWT from Clipboard, Format JSON from Clipboard, and Open This Page on localhost for each running dev server. Local and staging hosts get a badge in the address bar.

## Verify

```sh
npm test                  # model, persistence, lifecycle and extension-manager tests
npm run check
npm run test:engine       # real sandboxed pages + production extension adapter
npm run benchmark         # isolated view lifecycle benchmark; not a whole-browser energy test
```

The engine suite covers navigation/history, cookie isolation, memory budget enforcement, sleeping-page recovery, split protection, extension-driven tab removal, and renderer-count return to baseline. It does not establish absence of memory leaks or long-session reliability.

## Design and engine research

`src/design-system.css` defines semantic color, type, spacing, radius, focus and motion tokens. `docs/DESIGN-SYSTEM.md` describes interaction principles. The application does not load remote UI fonts or run perpetual decorative animations.

The previous Objective-C++/CEF Chrome runtime host remains an **engine diagnostic**, built with `npm run build:native` into `release/Wing Native.app`. Its stock Chrome window supports more native APIs but is not Wing's intended interface. CEF's experimental custom window is opt-in (`--experimental-shell`); a second tab escapes into stock UI and split creation crashed inside CEF. See `docs/CEF-SHELL-LIMITATIONS.md`. It is not the primary app.

The intended replacement is a native host around a patched Chromium **browser-service framework**, retaining Chrome's extension/profile services. A checksum-pinned ArdiaCore candidate is tested separately from Wing by `python3 scripts/qualify-ardiacore-ubo.py`. The existing Electron host fails the corresponding full-uBlock blocking test. See [engine evidence](docs/FULL-UBLOCK-ENGINE.md) and the [48-workstream implementation ledger](docs/IMPLEMENTATION-SCOPE.md); qualification is not a completed app migration.

The isolated native migration preview now runs the existing Wing interface directly on this framework, with shared workspace persistence, profiles, pinned splits and full uBlock Origin. Build and run its integration qualification with:

```sh
python3 scripts/build-chromium-preview.py --source-receipt ../wing-chromium-build/wing-build-receipt.json
npm run test:chromium-preview
npm run start:chromium-preview
```

The runner uses a disposable profile and checks first-page blocking, bundled cookie filtering, uBlock settings, browser services, downloads, import isolation, navigation, split geometry, overlays and restart restoration. Results are recorded in `docs/chromium-preview-qualification.json`. The preview requires an explicit `WING_CHROMIUM_TEST_PROFILE` and mock keychain; it is not a daily-use replacement. Several native host operations remain unmigrated and report that explicitly.

`npm run migrate:chromium` runs configuration, source compilation, packaging and native qualification in sequence, recording its current stage in `docs/chromium-migration-build-status.json`. It stops on a failed gate.

Pinned source preparation and compilation use the dedicated sibling directory `../wing-chromium-build`, outside npm dependency resolution, with a disk reserve and conservative concurrency. Full Xcode and its Metal Toolchain component are required:

```sh
python3 scripts/prepare-chromium.py --sync
python3 scripts/build-chromium.py patch
python3 scripts/build-chromium.py configure
python3 scripts/build-chromium.py compile --jobs 2
```

Configuration applies Wing-owned bundle, keychain and CDM identities and the native profile APIs. Compilation writes `../wing-chromium-build/wing-build-receipt.json` only after the framework succeeds. Package that exact engine with:

```sh
python3 scripts/build-chromium-preview.py --source-receipt ../wing-chromium-build/wing-build-receipt.json
npm run test:chromium-preview
```

The receipt verifies the framework, API header and Wing patch inputs. Preview builds require this receipt, because the host is written against the pinned source engine rather than the older vendored upstream binary. Set `WING_CHROMIUM_BUILD` to use a source tree other than `../wing-chromium-build`. Source compilation, the source-engine integration qualification, privacy-network audit, current security baseline and release qualification must all pass before distributing a replacement. Existing profiles and installed apps are preserved.

## Release status

Signing, notarization, and Electron automatic-update tooling are implemented, but this local build has no Developer ID release credentials or published update feed. Full extension compatibility and extended endurance qualification remain unfinished. Keep an established browser available. See `docs/RELEASING-ELECTRON.md`.

The combined Electron distribution is GPL-3.0-only because its extension adapter is GPLv3. Original Wing sources' MIT notice is preserved in `LICENSE-MIT`; third-party terms are in `THIRD_PARTY_NOTICES.md`. No public repository or release has been published from this workspace.

### Persistent-profile Chromium staging

`npm run build:chromium-production` stages a separate `Wing.app` under `native/build/chromium-production/`. It requires a completed Wing source-engine receipt and passing initial/restart qualification of the exact engine and host inputs. The prebuilt upstream framework cannot be packaged in this mode.

The staged application uses `~/Library/Application Support/Wing/Chromium`, real Wing keychain storage, and registered HTTP/HTTPS handlers. It ignores test environments and does not enable the mock keychain. Choosing “Make default” in settings requests macOS registration; packaging does not change the default browser. Existing Electron profiles are not automatically converted; workspace import and Wing/Arc/Chrome profile import remain explicit actions. Legacy Wing import preserves nested folders, saved split layouts, archive entries and profile cookies; its encrypted password-vault path is supported for the v10 format and requires the source-built password-store API.

This is staging, not a signed release: the source engine and production credential path still need qualification, and distribution requires a Developer ID identity, notarization, and a configured update channel. The isolated preview and its disposable profile remain available through `npm run start:chromium-preview`.
