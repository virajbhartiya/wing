# Arc, Chrome and Safari migration

Open Settings → Import browser. Wing discovers profiles under macOS Application Support using each browser's Local State and profile directories. Select a source and data categories. Every import creates a new isolated Wing profile; it never merges cookies into an existing account or changes the source.

Implemented:

- Chrome and Arc bookmarks/folders; up to 5,000 bookmarks per source.
- Arc Spaces, folders, favorite/pinned/open tabs, matched to their original profile. Chrome open and pinned tabs come from the latest session file, keeping the URL and pinned state; titles load when the tab opens.
- Safari bookmarks (with Reading List), up to 5,000 recent history entries, tabs from SafariTabs.db, and cookies from Cookies.binarycookies. macOS requires Full Disk Access for Wing. Safari passwords are in iCloud Keychain, which other apps cannot read: export a CSV from the Passwords app and choose it during import. Wing never copies or deletes that file, so delete it yourself.
- Installed Chrome and Arc extensions are listed in the import report for reinstalling; they are not installed automatically because each needs a permission review.
- Up to 5,000 recent history entries.
- Supported unpartitioned session cookies, preserving host-only/domain scope, HttpOnly, Secure, SameSite and expiry. Expired/unsupported/rejected cookies are counted as skipped.
- Saved passwords from Login Data and Login Data For Account. Chromium macOS v10 encryption is decrypted using the source browser's Safe Storage Keychain item, then re-encrypted in Wing's OS-protected vault. No plaintext password CSV is created. Use Settings → Fill saved login on the exact HTTPS website; the user chooses the account and Wing never submits the form automatically.

The source SQLite files are opened read-only in a worker with transactions; no database snapshots containing plaintext credentials are written. Keychain access happens only after starting a credential import, can prompt macOS, and denial fails the import without changing the source. New destination cookies/vault are removed if commit fails. Workspace data is rebased at completion so concurrent browsing changes survive.

This is not an “all logins guaranteed” transfer. Passkeys, device-bound session credentials, partitioned cookies, Local Storage/IndexedDB tokens, client certificates, payment information, and source password-manager cloud accounts are not copied. Sites can reject transferred cookies. New/unsupported encryption is rejected instead of guessing. The app reports counts and skips; sign in again where needed.

Quit the source browser first for freshest persisted data. Development/unsigned Wing builds may trigger Keychain access prompts again when the app is rebuilt. A consistently signed release is required before treating this as a stable password manager.

Validation uses synthetic credentials only: cryptographic v10/domain-binding tests, source immutability, profile isolation, atomic encrypted vault writes, rollback and concurrent workspace edits. Actual user login migration has not been performed automatically.

Primary format references:
- https://raw.githubusercontent.com/chromium/chromium/140.0.7339.0/components/os_crypt/sync/os_crypt_mac.mm
- https://raw.githubusercontent.com/chromium/chromium/main/net/extras/sqlite/sqlite_persistent_cookie_store.cc
- https://www.electronjs.org/docs/latest/api/safe-storage
