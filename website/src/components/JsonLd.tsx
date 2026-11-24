import snapshot from "@/lib/release-snapshot.json";
import { collectReleases } from "@/lib/releases";
import { SITE, SITE_URL } from "@/lib/site";

/** Structured data so search engines know this page is about a free, downloadable browser. */
export function JsonLd() {
  const release = collectReleases(snapshot).release;
  const data = [
    {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: SITE.name,
      description: SITE.description,
      ...(SITE_URL ? {
        url: `${SITE_URL}/`,
        image: `${SITE_URL}/og.png`,
        downloadUrl: `${SITE_URL}/download/`,
      } : {}),
      applicationCategory: "BrowserApplication",
      operatingSystem: "macOS 14 or later, Windows 10 or later",
      ...(release ? { softwareVersion: release.version, datePublished: release.publishedAt } : {}),
      license: "https://www.gnu.org/licenses/gpl-3.0.html",
      isAccessibleForFree: true,
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      sameAs: [SITE.repo],
    },
    ...(SITE_URL ? [{
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: SITE.name,
      url: `${SITE_URL}/`,
    }] : []),
  ];
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }} />;
}
