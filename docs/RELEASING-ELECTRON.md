# Signed macOS release and updates

Local `npm run package` builds remain unsigned and never contact an update server. A release build uses Developer ID signing, Apple's notary service, stapling, signature verification, and a ZIP suitable for Squirrel.Mac. Packaging failure preserves the last installed Wing.app.

Configure these environment variables on a trusted macOS build machine:

- `WING_RELEASE=1`
- `WING_SIGN_IDENTITY`: the full `Developer ID Application: …` identity already installed in Keychain.
- `WING_NOTARY_PROFILE`: a Keychain profile previously stored with `xcrun notarytool store-credentials`. No Apple credentials belong in this repository.
- `WING_UPDATE_FEED`: your HTTPS Squirrel.Mac endpoint. Its response must be HTTP 204 when current, or JSON containing the `url` of a newer signed ZIP and optional `name`, `notes`, `pub_date`.

Run `npm ci`, `npm test`, `npm run check`, `npm run test:engine`, then `npm run package`. Upload the ZIP only after verifying the stapled app. Serve only newer versions; retain rollback artifacts. Publishing/uploading is deliberately separate from packaging.

The app checks on startup and every six hours only for configured signed releases. Settings exposes status, manual checks, and restart after an update has downloaded. Squirrel enforces signature continuity. No ATS exceptions or certificate bypasses are used. The current local build is not a signed release; no feed has been published.

References: https://www.electronjs.org/docs/latest/api/auto-updater/ and https://www.electronjs.org/docs/latest/tutorial/updates
