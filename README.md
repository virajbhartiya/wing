<p align="center"><img src="assets/brand/readme-banner.png" alt="Wing, an open-source browser for Mac" width="100%"></p>

# Wing

An independent, open-source browser for Apple Silicon Macs, with Safari's layout and Arc's design: Spaces, a command palette, split view and Peek. It's a native AppKit app on Wing's own build of Chromium 156, with Chrome's extension system and built-in uBlock Origin Lite.

## Why Wing

Arc showed what a browser could feel like, then went into maintenance mode. Wing keeps those ideas in an open-source browser anyone can pick up. Wing has no account or analytics. You can opt in to layout sync through iCloud Drive.

## Install

Download the latest DMG for your Mac from [Releases](https://github.com/virajbhartiya/wing/releases), then drag Wing to Applications. Wing updates through Sparkle. Use **Settings → About → Check Now** to check on demand.

Early releases use Wing's own signing certificate and await Apple notarization. macOS may block the first launch. See [Apple's instructions](https://support.apple.com/en-us/102445) and the [known limitations](#known-limitations).

## What works

- Safari-style toolbar and top tab bar by default. Move tabs to an Arc-style sidebar in **Settings → Tabs** or with ⌥⌘S.
- Spaces can share a browser profile or use separate profiles to isolate cookies and logins. Each Space has its own colors and light/dark appearance. ⌃1–9 switches profiles; horizontal sidebar swipes move between them.
- Command palette (⌘T), horizontal/vertical resizable split panes, Peek and site styles. Drag onto the center of another sidebar tab to merge; drop at its top edge to reorder.
- Vertical and pinned tabs, favorites and folders. Favorites follow profile boundaries.
- Hide the sidebar with ⌘S and move to the left window edge to reveal it.
- Edit a Space to customize 13 interface color roles independently for light and dark, with live preview.
- Archive/restore, JSON workspace backup, downloads and a live process monitor.
- Closed tabs come back with their scroll position and back/forward list, for the 25 most recently closed tabs (Chromium keeps no more).
- Throwaway Spaces deleted at next launch, duplicate tab cleanup, grouping tabs by site into folders, a per-site ad-blocking switch, a Space picker for links from other apps, capture annotation, and an estimate of memory saved by sleeping tabs.
- A background tab budget that protects active pages, splits, audio, capture and typed input.
- **View → Translate Page Text…** opens an on-device translation into your preferred language on macOS 26. Install the source and target languages in macOS Language & Region settings. The original page stays open.

## Extensions and ad blocking

Wing uses Chromium's own extension and profile services, not a compatibility shim. Install from a Chrome Web Store link or load an unpacked folder in **Settings → Extensions**; extensions belong to the profile they were installed in.

uBlock Origin Lite ships with cookie-banner filtering enabled. Chromium gives its blocking rules up to ten seconds to initialize on a profile's first navigation. Open the protection dashboard from the command palette. Compatibility with other extensions is still being qualified, so verify the ones you rely on.

## Import from another browser

**Settings → Import browser** finds Arc, Chrome, Brave and Safari data. Choose a browser, then one or more of its profiles. Import bookmarks, history, Spaces and open tabs, supported session cookies and saved passwords into a new isolated Wing profile. Source browser data is read-only. Passwords are re-encrypted with Wing's OS-protected storage. Passkeys, device-bound/partitioned sessions and site database tokens are not transferred; some websites ask you to sign in again. Safari needs Full Disk Access, and its passwords come from a Passwords app CSV export. Extensions are listed for reinstalling. See `docs/PROFILE-IMPORT.md`.

## Your data

- Wing keeps hourly workspace backups in `wing-workspace-backups` in its profile folder, and one before each import. If the workspace is damaged, Wing keeps the damaged file and restores the newest usable backup.
- Deleting an imported profile's last Space removes that profile. Its cookies and site data are deleted the next time Wing starts; its history and archived tabs are kept.
- Help → Report a Problem opens a prefilled issue. Nothing is sent automatically.
- Optional iCloud Drive sync includes Spaces, folders, pinned tabs and Favorites. Optional crash-report sharing is configured separately in Settings.

## Known limitations

- Apple Silicon receives the current release. See each release's notes for the available Intel and Windows preview versions.
- Touch ID and platform passkeys require Apple signing. Physical security keys work on the current build.
- Import supports browser data and supported sessions. Some services require you to sign in again. See [profile import](docs/PROFILE-IMPORT.md).
- Wing supports one regular workspace window, plus private and mini windows. Translation covers up to 8,000 characters of readable page text in a separate panel.
- Extension and media compatibility vary by site and API. See [performance evidence](docs/PERFORMANCE.md) for the workloads used to evaluate the native build.

## Command line

```sh
ln -s /Applications/Wing.app/Contents/Resources/bin/wing ~/.local/bin/wing
wing https://example.com
wing --space Work :3000
wing --debug 9222
```

`wing --debug` starts Wing with remote debugging, so Playwright, Puppeteer or a coding agent can drive it over the Chrome DevTools Protocol. It exposes every profile to local processes, so use it only when you need it.

## Developer tools

From the command palette or Site Controls: view, delete and copy a site's cookies, view a page as a JSON tree, and reload unpacked extensions on demand or whenever their files change.

The **Develop** menu and the command palette hold the page tools: DevTools (⌥⌘I / ⌥⌘J), Hard Refresh (⇧⌘R or Shift-click Reload), View Page Source (⌥⌘U), Clear Data for This Site, and Open Page in Safari, Chrome or Firefox. Per-tab overrides cover cache, JavaScript, device size, color scheme, network speed and user agent. The palette also lists web servers listening on this machine as `localhost:PORT`. Self-signed certificates are accepted on localhost.

The command palette also has Block Requests, Copy as curl, Decode JWT from Clipboard, Format JSON from Clipboard, and Open This Page on localhost for each running dev server. Local and staging hosts get a badge in the address bar.

## How it's built

- **Engine:** Chromium 156 built from source with Helium's patches (de-Googled, MV2 kept) and the ArdiaCore framework, which exposes Chromium's browser, profile and extension services to a native host. Sources and commits are pinned in `native/chromium-sources.json`.
- **Host:** Objective-C++/AppKit in `native/chromium/`. It runs Wing's interface (`src/`) in a trusted internal tab and website tabs as separate unprivileged views. Privileged messages must come from that exact tab, frame and origin.
- **Updates:** Sparkle, with EdDSA-signed appcasts.

Wing started on Electron and then tried CEF; `docs/ARCHITECTURE.md` explains why neither shipped. The Electron app in `src/main.cjs` remains a development host (`npm run start:dev`).

## Build

Building the engine needs a Chromium checkout, full Xcode with its Metal toolchain, a large disk and several hours:

```sh
python3 scripts/prepare-chromium.py --sync
python3 scripts/build-chromium.py patch
python3 scripts/build-chromium.py configure
python3 scripts/build-chromium.py compile --jobs 2
```

Compilation writes `wing-build-receipt.json` only after the framework succeeds. Then package and qualify the app against that exact engine:

```sh
npm ci
npm test
export WING_CHROMIUM_BUILD=../wing-chromium-build-156
python3 scripts/build-chromium-preview.py --source-receipt $WING_CHROMIUM_BUILD/wing-build-receipt.json
npm run test:chromium-preview
npm run build:chromium-production
```

`npm run test:chromium-preview` drives the real app against loopback fixtures: first-page ad blocking, cookie-banner filtering, profile isolation, split geometry, downloads, import isolation and restart restoration. Results are in `docs/chromium-preview-qualification.json`.

## Release

`scripts/release-native.py` runs the tests and qualification, then builds a zip, a DMG and checksums in `dist/`. It refuses a dirty tree.

```sh
python3 scripts/release-native.py
python3 scripts/release-native.py --publish --notes notes.md
```

Add `--notarize` for Developer ID distribution. Set `WING_SIGN_IDENTITY` to the full installed **Developer ID Application** identity and `WING_NOTARY_PROFILE` to the name of a stored `notarytool` Keychain profile. The script verifies the stapled app, ZIP and disk image before replacing the previous build artifacts.

## License

GPL-3.0-only. Original Wing sources' MIT notice is in `LICENSE-MIT`; third-party terms, including Chromium, Helium, ArdiaCore, uBlock Origin and Sparkle, are in `THIRD_PARTY_NOTICES.md`.
