import type { Metadata, Viewport } from "next";
import "./globals.css";
import { SITE, SITE_URL } from "@/lib/site";

export const metadata: Metadata = {
  ...(SITE_URL ? { metadataBase: new URL(SITE_URL), alternates: { canonical: "/" } } : {}),
  title: { default: SITE.title, template: "%s · Wing" },
  description: SITE.description,
  applicationName: SITE.name,
  keywords: SITE.keywords,
  authors: [{ name: "Wing contributors", url: SITE.repo }],
  creator: "Wing contributors",
  category: "technology",
  openGraph: {
    type: "website",
    siteName: SITE.name,
    title: SITE.title,
    description: SITE.short,
    locale: "en_US",
    ...(SITE_URL ? {
      url: "/",
      images: [{ url: "/og.png", width: 1200, height: 630, alt: "Wing — a calmer way to browse. A Wing window with the command palette open." }],
    } : {}),
  },
  twitter: {
    card: SITE_URL ? "summary_large_image" : "summary",
    title: SITE.title,
    description: SITE.short,
    ...(SITE_URL ? { images: [{ url: "/og.png", alt: "Wing — a calmer way to browse" }] } : {}),
  },
  robots: { index: true, follow: true, googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 } },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icon.svg", type: "image/svg+xml" },
    ],
    apple: [{ url: "/apple-icon.png", sizes: "180x180" }],
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = { themeColor: "#fbfbfa", colorScheme: "light", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
