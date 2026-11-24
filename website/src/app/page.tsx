import { Nav } from "@/components/Nav";
import { Hero } from "@/components/Hero";
import { Marquee } from "@/components/Marquee";
import { Statement } from "@/components/Statement";
import { Section } from "@/components/Section";
import { Bento, CardVignette, PaletteVignette, SpacesVignette } from "@/components/vignettes";
import { OpenSource } from "@/components/OpenSource";
import { FinalCta } from "@/components/FinalCta";
import { Footer } from "@/components/Footer";
import { JsonLd } from "@/components/JsonLd";

export default function Home() {
  return (
    <>
      <JsonLd />
      <Nav />
      <main>
        <Hero />
        <Marquee />
        <Statement />
        <Section id="spaces" eyebrow="Spaces" title="A room for each part of your life." body="Work, Personal, Studio. Each Space keeps its own tabs, favorites and logins, and tints the window so you always know where you are.">
          <SpacesVignette />
        </Section>
        <Section stacked eyebrow="Command palette" title="Everything is one keystroke away." body="Every tab in every Space, every action, and the web. Press ⌘K, type a few letters, press Enter.">
          <div className="mx-auto max-w-[1000px]">
            <PaletteVignette />
          </div>
        </Section>
        <Section reverse eyebrow="Split view" title="Two pages. One window." body="Put the docs next to the dashboard. Drag the divider to give either side more room, or drag any tab onto the page.">
          <CardVignette chapter="split" tint="#e3e6ec" hint="Drag the divider" />
        </Section>
        <Section eyebrow="Peek" title="Look without leaving." body="Shift-click a link and it floats over the page you're on. Keep it as a tab, or let it go.">
          <CardVignette chapter="peek" tint="#ebe5dc" hint="Open it as a tab, or press Esc and shift-click a link" />
        </Section>
        <section className="px-5 py-20 sm:py-28">
          <h2 className="mx-auto mb-12 max-w-[720px] text-center font-display text-[clamp(34px,4.6vw,58px)] font-semibold leading-[1] tracking-[-0.045em]">And everything else you&apos;d expect.</h2>
          <Bento />
        </section>
        <OpenSource />
        <FinalCta />
      </main>
      <Footer />
    </>
  );
}
