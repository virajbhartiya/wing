import { GitHub } from "./Brand";

const FACTS = [
  ["Native Chromium", "A real Chromium engine, not a wrapper around the system web view."],
  ["No account or analytics", "Wing checks for updates. Crash reporting is optional, and you choose when to send a bug report."],
  ["Local workspace backups", "Wing keeps hourly backups in your profile folder and can recover from a damaged workspace file."],
  ["Drive it from code", "wing --debug opens the DevTools Protocol to Playwright, Puppeteer or your coding agent."],
];

export function OpenSource() {
  return (
    <section id="open-source" className="bg-ink px-5 py-28 text-white sm:py-36">
      <div className="mx-auto grid max-w-[1200px] gap-14 md:grid-cols-[1.1fr_1fr]">
        <div className="min-w-0">
          <h2 className="font-display text-[clamp(34px,5.2vw,64px)] font-semibold leading-[1] tracking-[-0.045em]">Free. Open. Yours to read.</h2>
          <p className="mt-6 max-w-[480px] text-[17px] leading-7 text-white/60">Every line of Wing is on GitHub under GPL-3.0. Read it, build it yourself, or send a fix.</p>
          <a href="https://github.com/virajbhartiya/wing" className="mt-8 inline-flex h-11 items-center gap-2 rounded-full bg-white px-5 text-[14px] font-medium text-ink transition hover:-translate-y-0.5">
            <GitHub /> View on GitHub
          </a>
          <pre className="mt-10 overflow-x-auto rounded-2xl bg-white/[0.06] p-5 font-mono text-[13px] leading-6 text-white/75">
            <span className="text-white/35">$ </span>git clone https://github.com/virajbhartiya/wing{"\n"}
            <span className="text-white/35">$ </span>cd wing && npm ci && npm test
          </pre>
        </div>
        <div className="grid content-start gap-px overflow-hidden rounded-2xl bg-white/[0.08]">
          {FACTS.map(([t, d]) => (
            <div key={t} className="bg-ink p-6">
              <div className="text-[15px] font-medium">{t}</div>
              <div className="mt-1.5 text-[14px] leading-6 text-white/55">{d}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
