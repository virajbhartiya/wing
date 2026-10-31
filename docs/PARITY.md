# Feature status

There are two runnable implementations. Their capabilities must not be combined into a misleading claim about one release.

| Capability | Native Wing, default | Electron UI prototype |
|---|---|---|
| Real Chromium pages | Yes, CEF Chrome runtime | Yes, WebContentsView |
| Native Chrome MV3 extension APIs | Fixture verified: worker, content script, storage, tabs, messaging, DNR, split APIs | No general compatibility claim |
| Chrome extension manager | Yes, native `chrome://extensions` | Not implemented |
| One-click Chrome Web Store installation | **Not working in observed unbranded build** | Not supported |
| Wing Spaces/sidebar | Yes, bundled first-party extension | Yes, custom browser shell |
| Native tab strip and toolbar | Retained for compatibility | Replaced by custom shell |
| Pins, move tabs, archive/restore | Yes | Yes |
| Folder organization | Native Chromium tab groups | Wing folders |
| Separate cookies by Space | No; Spaces share current Chromium profile | Yes, explicit profile partitions |
| Split and Peek | Native Chromium split verified; sidebar split controls; no Peek | Custom split and Peek |
| Command palette | Native omnibox + sidebar search | Custom commands and navigation |
| Tab sleeping | Chrome `tabs.discard`, soft budget | Explicit native-view eviction with protections |
| CPU and memory | Native Browser → Task Manager and tab diagnostics | Live in-app monitor |
| CSS Boosts | Not ported | Per-origin local CSS |
| Backup/import | Not implemented in native workspace UI | Validated JSON export/import |
| Browser engine updates | Manual rebuild with new pinned CEF | npm Electron update + package |
| Signed/notarized release | No | No |
| Other operating systems | Not built or verified | Not packaged or verified |
| Sync, Arc Max, Easels, Little Arc | Not implemented | Not implemented |

The native workspace preserves archive, Spaces and settings in extension local storage. Tab-to-Space remapping across startup uses URL matching; duplicate URLs and independently created windows require further testing. Complete crash recovery/session restoration is not claimed. Closing a tab through Chromium's own tab strip uses native history/reopen; it does not add to Wing's explicit sidebar archive.

## Installing extensions

1. Open Wing's **Extensions** button, or Browser → Extensions.
2. For an unpacked extension obtained from its official developer, use **Developer mode → Load unpacked** and choose its folder containing `manifest.json`.
3. Pin an extension from Chromium's puzzle-piece menu and use its native toolbar action.

The packaged engine successfully runs the included Manifest V3 fixture. This does not certify every extension, native-messaging application, DRM integration, Google sign-in flow or enterprise policy. Manifest V2 compatibility is not promised. The Web Store currently offers “Switch to Chrome” in this unbranded build; opening a Store page is not evidence that installation works.
