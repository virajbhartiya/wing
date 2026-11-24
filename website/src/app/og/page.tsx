import type { Metadata } from "next";
import { OgCard } from "./OgCard";

export const metadata: Metadata = { title: "Share card", robots: { index: false, follow: false } };

export default function Og() {
  return <OgCard />;
}
