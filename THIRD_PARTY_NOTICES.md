# Wing distribution licenses

The primary Electron-based Wing application includes `electron-chrome-extensions`
4.9.0 under its GPL option. This combined distribution is provided under
**GNU GPL version 3**, whose complete text is in `LICENSE`. The original Wing
code remains available under its preserved MIT notice in `LICENSE-MIT`; retaining
that notice does not remove the GPL conditions on the combined distribution.
Contributions to the combined application are distributed under GPL-3.0-only
unless a file carries a separate applicable notice.

When distributing a built application, provide its complete corresponding source,
including the exact dependency lockfile and build scripts, under the applicable
license terms. This local build does not establish a public source-download URL.

## Included components

- **electron-chrome-extensions 4.9.0** — GPL version 3 option. Its full GPL text
  is copied verbatim to the root `LICENSE`; upstream dual-license notices are
  retained in the installed dependency. No patron license is asserted.
- **Electron 45.0.0** — MIT; bundles Chromium and other components under their
  own licenses. Electron's license and Chromium notices remain in the packaged
  application resources.
- Production npm dependencies retain their own license files inside the packaged
  application's `node_modules` directory in `app.asar`. Exact versions and
  integrity hashes are recorded in `package-lock.json`.

## Separate native diagnostic build

The optional `Wing Native.app` is built from the CEF-based host and bundled
first-party extension; it does not include the Electron extension adapter.
Wing's original MIT notice is included as `Licenses/Wing-MIT.txt`. CEF-derived
host files preserve their BSD notices; the native package also includes CEF's
BSD license, Chromium credits, and Sparkle's license. Their respective terms
continue to apply.

## Web Store archive reader

The Web Store installer uses yauzl (MIT) and its dependencies. Their license files are included with the packaged npm modules. Wing’s CRX3 verification and restricted extraction implementation are part of the Wing source.

## Reader

Reader uses Mozilla Readability 0.6.0 (Apache-2.0), copied unmodified from
Chromium's `third_party/readability` into `native/chromium/reader/`. Its
license is included as `native/chromium/reader/LICENSE-Readability.md` and is
packaged with the application.

## Chromium migration preview

The separate native preview contains the pinned ArdiaCore Chromium framework,
Helium-derived patches and full uBlock Origin. Their upstream licenses and
corresponding-source obligations remain applicable; see
`docs/FULL-UBLOCK-ENGINE.md` and the pinned source manifests. The native preview
does not load Electron or its extension adapter.

The browser importer includes an official Node.js runtime, used only in a
short-lived helper process. Its exact version and archive checksum are recorded
in `native/node-import-sources.json`; the complete upstream Node license is
bundled as `Resources/import-helper/NODE-LICENSE`. The helper modules are Wing
sources. Cookie-list provenance is recorded in `native/ublock-sources.json`.
