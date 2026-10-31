# Wing Workspace

The October 2026 redesign replaces the serif marketing-style new-tab page with a functional workspace. The start page uses live, profile-scoped favorites and open tabs. It never invents recent activity or sends history to a remote service.

## Reference study

- [Linear's interface refresh](https://linear.app/now/behind-the-latest-design-refresh): reduced navigation emphasis, predictable control placement, and clear hierarchy. Applied through compact chrome, restrained dividers, and consistent dialog typography.
- [Twenty](https://twenty.com/): workspace/favorites organization and dense, readable records. Applied to open-tab rows, secondary domains, and compact favorite cards.
- [PostHog](https://posthog.com/): a distinct product identity and direct tool-oriented navigation. Wing uses an original geometric mark and direct labels rather than adopting PostHog's artwork or mascot.
- [Arc](https://arc.net/) and [Dia](https://www.diabrowser.com/): spatial tab organization and profile context. Wing retains its vertical sidebar, per-profile Spaces, split panes, and sidebar swipe switching. No AI capability is implied by this design.

## Foundations

Current direction: Arc's design system on a Safari layout. Each Space colors the whole frame with a gradient, the page floats as a rounded card, and tabs are soft translucent shapes. The toolbar and top tab row follow Safari; tabs can move to the sidebar. This supersedes the cool-neutral and restrained-accent notes below.

System sans-serif typography throughout. Four-pixel spacing scale; compact 6–10px control radii; 120/180ms interactions with reduced-motion support. No remote fonts, decorative animation, or full-window backdrop blur. Light surfaces use cool neutrals; dark surfaces use graphite. Accent is reserved for focus, selection, and state.

`src/themes.cjs` owns 13 semantic colors, separately configurable per Space in light and dark appearance. Existing custom overrides remain intact. Built-in lavender is now a restrained cool-neutral preset; graphite is the default for new Spaces. `src/design-system.css` owns shared typography, spacing, radii, and motion. `src/styles.css` owns layout, including geometry synchronized with native WebContentsView bounds.

`assets/wing-mark.svg` is the original canonical mark. `scripts/make-icon.py` derives the app SVG, PNG, iconset, and ICNS using librsvg and Pillow. UI instances use the same SVG as a current-color mask.

## Quality checks

Modal focus starts inside the dialog, includes visible disclosure summaries, wraps on Tab, and returns to the original opener. Interrupted resize gestures release page overlays and pointer capture, and resize updates are coalesced per animation frame. Engine qualification now fails if shell runtime errors occur.

This is a visual and interaction release, not a browser-readiness certification. Web Store installation, broad extension compatibility, signing, notarization, and a production update channel remain release blockers. uBlock Origin Lite still fails the recorded blocking qualification.
