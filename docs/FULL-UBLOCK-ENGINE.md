# Full uBlock Origin engine qualification

Wing's current Electron engine does not pass full uBlock Origin qualification. Installing an extension is not evidence that its filters execute. `node scripts/qualify-full-ubo.cjs` downloads the checksum-pinned, unmodified official uBO 1.75.0 Chromium MV2 release, starts separate disposable profiles with and without it, and loads a loopback fixture. DNS substitution is process-local: neither test image contacts the advertised domain. The control and doubleclick images both load with uBO installed. See `full-ubo-electron-qualification.json`.

The installed extension starts a background page, but the extension adapter cannot inject its APIs into that non-isolated context, `browserAction.setBadgeBackgroundColor` is unavailable, and webNavigation is absent. This is an engine/extension-host compatibility failure, not a missing blocklist setting. uBO Lite is not substituted. Cookie-banner filtering is not qualified by this result.

`python3 scripts/qualify-ardiacore-ubo.py` builds an original, disposable AppKit host against a pinned ArdiaCore framework, loads the same full uBO with only a manifest public-key identity added, and repeats the same request comparison. This is a candidate-engine proof, not a Wing release. No installed app or existing browser profile is used. The host keeps the Chromium sandbox enabled and uses temporary mock-keychain profiles. The report is `full-ubo-ardiacore-qualification.json` and records a passing ad-blocked/control-loaded comparison. The original archive without component identity triggers Chromium ComponentLoader’s mandatory-key CHECK; this failure is preserved in `full-ubo-ardiacore-unpackaged.json`. The minimal packaging change is explicit in the passing report. A managed-storage schema warning remains because the official extension’s schema is not a compiled-in component resource.

## Architecture choice

| Approach | Browser services and full uBO | Cost and scope |
| --- | --- | --- |
| Current Electron + Chrome API adapter | Partial extension API; the fixture fails | Retains current JS shell, but API shims do not establish MV2/network-filter correctness |
| Chromium content-only embedder | Rendering/network engine without Chrome's full browser-service layer | Stripping to this layer removes precisely the extension/profile services that need rebuilding |
| Direct Chromium browser fork | Can retain Chrome extension system, but current upstream MV2 policy still needs patches | Wing owns shell patches, native integration, de-Googling, MV2 maintenance and every security update rebase |
| ArdiaCore patched Chromium framework | Preserves Chrome browser/profile/extension services and adds a narrow AppKit API; Helium/ungoogled patches retain MV2 | Best candidate for a custom Wing shell, subject to actual fixture and migration qualification; still requires engine updates and patch audits |

The recommended direction is a native shell around a patched Chromium browser-service framework, not an arbitrary stripped content shell. ArdiaCore provides a concrete starting point. Its native Objective-C API does not require adopting Ardia's React Native UI. A standalone host uses `runWithArgc:argv:delegate:`, profile/window/tab objects, NSView attachment, and native delegates. Electron and this framework should not be loaded together in one process.

The trusted local UI can receive native state through evaluate and send commands through the tab message delegate. The header has a delegate overload carrying frame/main/origin. Every privileged command must require the exact trusted shell tab, main frame and expected origin; validate its schema and navigation state. The engine's pageScript is global: remote pages must never receive privileged commands just because they can send a message with a matching kind. Native tabs remain separate unprivileged views.

The evaluate API accepts a function body with a `post` argument; completion requires `post("result", JSON.stringify(value))`, rather than returning an expression. The pageScript must evaluate to an installer function receiving `post(kind, jsonString)` and returning a receive function `(kind, jsonString) => {}`. The pinned renderer and page-channel implementations are the source of this contract.

## Wing native integration preview

`native/chromium/main.mm` now hosts Wing's existing local interface and shared workspace model without Electron. The trusted UI uses an internal window and a separate profile; privileged messages require its exact tab, main frame, committed URL and origin. Website tabs use independent Wing profile namespaces. Workspace writes use a private temporary file, fsync and atomic rename.

Full uBO 1.75 and a pinned official EasyList cookie list are bundled from checksum-verified sources in `native/ublock-sources.json`. New website profiles do not navigate until the extension's real dashboard `getLists` RPC confirms populated network and cosmetic engines. Component registration can reload extension pages during profile startup; the host reopens only its owned readiness page and waits again. The normal uBlock dashboard is accessible through Wing's command bar.

`npm run test:chromium-preview` exercises the actual native host twice against loopback fixtures. It checks first-page ad blocking, default cookie-banner filtering, dashboard access, real navigation, profile isolation, pinned split view geometry, close/reopen and process restart restoration. See `chromium-preview-qualification.json`. This adds app integration evidence to the separate standalone engine qualification; it does not establish all extension compatibility or production readiness.

The preview still requires a disposable profile and mock keychain. The source-built framework still needs completion and qualification. Remaining gates include complete API/interaction acceptance, accessibility, the engine privacy audit, security updates, signing and release endurance. Existing installed Wing applications are not replaced.

## Source build and provenance

Candidate: Ardia tag `v0.2.40-nightly.8`, engine tree `6b96c16ab2ccc3b93ee28278ec0ed495aad7009a`, Chromium `155.0.8059.84`, Helium `0.19.4`, helium-macos `0.19.4.1`. Archive/header SHA256 values are pinned in the runner and `docs/ardiacore-provenance.json` (also copied beside the local vendor binary). A verified archive is retained locally for reuse; vendor binaries should not be committed.

The pinned upstream Mac recipe reports approximately 45 GB total with no symbols, official ThinLTO/PGO, and a 13 GB output directory. Therefore 60 GiB free may accommodate that exact lean recipe with approximately 15 GiB headroom; this is an upstream observation, not a guaranteed ceiling on this machine. A general Chromium build guide asks for at least 100 GB on Linux. Do not infer that every stripped browser build needs only 45 GB. A source run should monitor free space between sync/patch/GN/build, stop before exhausting disk, use a fresh dedicated build root, and constrain concurrent compilation on this 16 GiB RAM machine.

Upstream stages are sync, Helium patches/substitutions, Ardia patches/layers, GN args, then chrome_framework. Scripts require the upstream lock and explicit --apply. The pinned build defines symbol_level=0, blink_symbol_level=0, v8_symbol_level=0 and is_component_build=false. Wing must replace Ardia branding, bundle/keychain identities and deliberate CDM identity choices before distributing its own source-built engine; those are product decisions, not cosmetic search-and-replace.

Ardia's own API/source files are Apache-2.0; Helium-derived engine and distributed combined application are GPL-3.0. Keep upstream license/NOTICE, credits and corresponding-source materials, and provide corresponding source for the distributed combined product. The source archive accompanies the engine release. Full uBO is GPL-3.0. This candidate changes Wing's distribution obligations.

The source workflow uses `native/chromium-sources.json`, `scripts/prepare-chromium.py` and `scripts/build-chromium.py`. Source sync/hooks and the pinned Helium/Ardia patch stages have completed. Configuration applies Wing-owned bundle/keychain/CDM identity and native APIs for download destinations, cookie flushing and encrypted password imports. The dedicated root is `../wing-chromium-build`; it lives outside the npm project so Chromium cannot accidentally resolve Wing's Node dependency types. The build preserves a 15 GiB free-space reserve, defaults to two compile jobs and uses upstream locks. Apple’s Metal Toolchain is required and checked before compilation.

Compilation remains in progress. A successful compile creates `wing-build-receipt.json` in that root. `scripts/build-chromium-preview.py --source-receipt ../wing-chromium-build/wing-build-receipt.json` verifies the binary, header and Wing inputs before packaging. The normal preview command still uses the checksum-pinned upstream framework. Its source-only profile APIs are explicitly unavailable; this distinction is retained in `engine-provenance.json` inside each app. Neither build path changes installed browsers or existing profiles.

The native host also contains a private component extension for Chromium history, bookmarks, downloads, permissions and extension management. A checksum-pinned Node helper runs only for browser import, reusing Wing's tested read-only importer. Cookies/passwords pass through private process pipes into the native profile APIs, never through the UI bridge. The native import fixture uses synthetic source files and checks that their hashes are unchanged.


## Privacy work still required

Ardia's engine disables background Google services through patches and domain substitution, but deliberately retains Google Chrome Web Store/extension update endpoints and security-component updates. It is inaccurate to describe the stock candidate as having no Google connections. Wing must define which user-initiated and security update connections remain, audit the exact source/build and validate requests. Command-line switches alone cannot establish “compiled out.”

The native fixture also exercises real dashboard messaging to save a cosmetic rule and a network exception, reload filters, and restart the same disposable profile. Those cases pass: the custom element hides, the previously blocked request is allowed, and both effects persist. Cookie-list qualification additionally imports the checksum-pinned official EasyList Cookie Notices body through the dashboard from a loopback fixture endpoint; the fixture cookie banner is hidden, and this behavior persists after restart with no list refetch. These checks now pass. The main fixture uses a DNS-mapped hostname: localhost did not exercise generic cosmetic filtering correctly. This is distinct from universal real-site coverage. Updates, permissions, product integration, broad cookie-site behavior and release shutdown still need dedicated qualification before shipping. Crashpad is disabled in the upstream engine configuration; any Wing opt-in reporting should submit an explicit allowlisted diagnostic payload, never raw crash dumps promised to exclude arbitrary sites/search strings. Retained crash diagnostics and all logging also require inspection.

## Primary sources

- [Pinned engine build/patch explanation](https://github.com/mantrakp04/ardia/blob/v0.2.40-nightly.8/docs/engine-build.md)
- [Pinned native API](https://github.com/mantrakp04/ardia/blob/v0.2.40-nightly.8/engine/ardiacore/src/ardia/core/public/ArdiaCore.h)
- [Pinned release and corresponding source](https://github.com/mantrakp04/ardia/releases/tag/v0.2.40-nightly.8)
- [Official full uBO release](https://github.com/gorhill/uBlock/releases/tag/1.75.0)
- [Chromium macOS build instructions](https://github.com/chromium/chromium/blob/main/docs/mac_build_instructions.md)
- [Chromium Linux build resource requirements](https://github.com/chromium/chromium/blob/main/docs/linux/build_instructions.md)
