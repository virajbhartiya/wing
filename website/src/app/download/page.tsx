import type { Metadata } from "next";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { BuildTable } from "@/components/BuildTable";
import { SITE_URL } from "@/lib/site";

export const metadata: Metadata = {
  title: "Download",
  description: "Download Wing, the free and open-source browser, for Mac (Apple Silicon and Intel) and Windows. Disk images, zips, installers and SHA-256 checksums.",
  ...(SITE_URL ? { alternates: { canonical: "/download/" } } : {}),
  openGraph: {
    title: "Download Wing",
    description: "Free for Mac, with a preview for Windows.",
    ...(SITE_URL ? {
      url: "/download/",
      images: [{ url: "/og.png", width: 1200, height: 630, alt: "Wing — a calmer way to browse" }],
    } : {}),
  },
};

export default function Download() {
  return (
    <>
      <Nav />
      <main className="relative px-6 pb-28 pt-40">
        <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[600px] bg-[radial-gradient(50%_60%_at_50%_0%,rgba(0,0,0,0.04),transparent_70%)]" />
        <BuildTable />
      </main>
      <Footer />
    </>
  );
}
