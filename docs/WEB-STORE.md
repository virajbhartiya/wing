# Web Store link installation

Settings → Extensions → paste a Chrome Web Store link → Review & install.

Wing downloads CRX3 packages from Google's update service over HTTPS, follows only Google delivery hosts, verifies the extension signing proof and the requested extension ID, then extracts into a private Wing-managed directory. It rejects unsigned/other CRX versions, non-MV3 manifests, identity mismatches, symlinks, path traversal, duplicate files, and oversized archives. A native permission dialog appears before the extension loads in the selected profile. Cancellation/failure removes the staged files. The ordinary store site's “Add to Chrome” button is not integrated.

The official uBlock Origin Lite package (ID ddkjiahejlhfcafbddmgiahcphecmpfh, version 2026.1021.1354) successfully downloaded and passed signature verification and extraction during qualification. This verifies package installation infrastructure, not uBlock's blocking functionality: the previously recorded runtime blocking failure remains unresolved. Wing must not claim full Chrome extension support. Electron supports a subset of APIs, supplemented by the adapter.

Extensions currently remain at their installed version; automatic extension updates are not implemented. Browser auto-updates are separate.
