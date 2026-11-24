# Wing website

The download site for Wing, with a clickable demo and a scroll tour. It uses Next.js static export, Tailwind CSS, and Motion. Use Node.js 22.13 or newer from a supported LTS release.

```sh
npm ci
npm run dev      # http://localhost:3000
npm test
npm run build    # writes the static site to out/
```

`npm run build` refreshes `src/lib/release-snapshot.json` from GitHub. Each installer or archive retains its own version and checksum links. The browser refreshes from the same feed and uses the snapshot when the API is unavailable or newer releases skip a platform.

The share image is `public/og.png`, a screenshot of the `/og/` page. After changing that page, run `npm run dev`, then `npm run og` (it needs Google Chrome and ImageMagick).

Deploy on Vercel with the project's root directory set to `website/`. Set `NEXT_PUBLIC_SITE_URL` to the HTTPS origin when the site has a custom domain or runs on another host. Otherwise the build uses Vercel’s project production hostname when available. Without a configured origin the export omits canonical links, absolute share image URLs, and sitemap entries.

- `src/demo/state.ts`: everything the demo window can do, as one reducer. The visitor's input and the scroll tour both go through it.
- `src/demo/Window.tsx`, `chrome.tsx`, `overlays.tsx`, `pages.tsx`: the window, its sidebar and toolbars, the palette, Peek and share picker, and the made-up sites inside it.
- `src/lib/releases.ts`, `platform.ts`: picking the right download for the visitor's machine.
