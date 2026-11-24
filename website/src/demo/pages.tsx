import type { ReactNode } from "react";
import type { PageKind } from "./data";
import { Camera, Check, Mic, Phone, Play, Screen } from "./Icons";

/** A link inside a fake page. Click opens it as a tab, shift-click (or long-press) opens it in Peek. */
function L({ to, children, className = "" }: { to: string; children: ReactNode; className?: string }) {
  return (
    <a href="#" data-link={to} className={`underline decoration-black/20 underline-offset-[3px] hover:decoration-black/60 ${className}`}>
      {children}
    </a>
  );
}

const Shell = ({ children, className = "" }: { children: ReactNode; className?: string }) => (
  <div className={`h-full overflow-hidden bg-[#fbfbf9] text-[#17181b] ${className}`}>{children}</div>
);

function Nav({ brand, items, serif = false }: { brand: string; items: string[]; serif?: boolean }) {
  return (
    <div className="flex items-center justify-between px-10 pt-7">
      <div className={`${serif ? "font-serif text-[26px]" : "text-[17px] font-semibold tracking-tight"}`}>{brand}</div>
      <div className="flex gap-7 text-[13px] text-black/55">
        {items.map((i) => (
          <span key={i}>{i}</span>
        ))}
      </div>
    </div>
  );
}

function Docs() {
  return (
    <Shell className="flex">
      <aside className="w-[200px] shrink-0 border-r border-black/[0.06] px-5 pt-6 text-[13px]">
        <div className="mb-5 flex items-center gap-2 font-semibold">
          <span className="grid h-6 w-6 place-items-center rounded-md bg-[#17181b] text-[11px] text-white">N</span> Northwind
        </div>
        <div className="mb-4 flex h-8 items-center rounded-lg bg-black/[0.04] px-2.5 text-[12px] text-black/40">Search docs… <span className="ml-auto">⌘/</span></div>
        {[
          ["Start", ["Getting started", "Deploying", "Environments"]],
          ["Operate", ["Rollbacks", "Webhooks", "CLI"]],
        ].map(([group, items]) => (
          <div key={group as string} className="mb-4">
            <div className="mb-1.5 px-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-black/35">{group}</div>
            {(items as string[]).map((x) => (
              <div key={x} className={`mb-0.5 rounded-md px-2 py-1.5 ${x === "Deploying" ? "bg-black/[0.06] font-medium" : "text-black/55"}`}>
                {x}
              </div>
            ))}
          </div>
        ))}
      </aside>
      <main className="min-w-0 flex-1 px-12 pt-9">
        <div className="text-[12px] text-black/40">Guides / Start</div>
        <h1 className="mt-2 text-[34px] font-semibold tracking-tight">Deploying</h1>
        <p className="mt-3 max-w-[560px] text-[15px] leading-7 text-black/70">
          Every push to <code className="rounded bg-black/[0.06] px-1.5 py-0.5 text-[13px]">main</code> builds a preview. Promote it when the checks pass, or read{" "}
          <L to="changelog">what changed in 4.2</L> before you ship.
        </p>
        <div className="mt-5 max-w-[560px] overflow-hidden rounded-xl bg-[#17181b] font-mono text-[13px] leading-6 text-white/80">
          <div className="flex gap-1.5 border-b border-white/[0.07] px-4 py-2.5">
            {[0, 1, 2].map((i) => (
              <span key={i} className="h-2.5 w-2.5 rounded-full bg-white/15" />
            ))}
          </div>
          <div className="px-5 py-4">
            <div>
              <span className="text-white/40">$</span> northwind deploy --prod
            </div>
            <div className="text-white/45">✓ Built in 14.2s</div>
            <div className="text-white/45">✓ 38 checks passed</div>
            <div>→ Live at northwind.so</div>
          </div>
        </div>
        <div className="mt-5 flex max-w-[560px] gap-3 rounded-xl border border-black/[0.07] bg-white p-4 text-[14px] leading-6 text-black/65">
          <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-black/[0.07] text-[11px] font-semibold">i</span>
          <span>
            Watch the rollout on the <L to="dash">launch dashboard</L>. Shift-click any link to Peek at it without leaving this page.
          </span>
        </div>
        <h2 className="mt-7 text-[19px] font-semibold tracking-tight">Promote a preview</h2>
        <p className="mt-2 max-w-[560px] text-[15px] leading-7 text-black/70">
          Open the preview, check it, then run <code className="rounded bg-black/[0.06] px-1.5 py-0.5 text-[13px]">northwind promote</code>. The{" "}
          <L to="review">open pull request</L> links to it automatically.
        </p>
      </main>
      <aside className="w-[170px] shrink-0 pt-24 text-[12.5px] text-black/45">
        <div className="mb-2 font-medium text-black/70">On this page</div>
        {["Build a preview", "Watch the rollout", "Promote a preview", "Roll back"].map((x, i) => (
          <div key={x} className={`border-l py-1 pl-3 ${i === 0 ? "border-black/60 text-black/80" : "border-black/10"}`}>
            {x}
          </div>
        ))}
      </aside>
    </Shell>
  );
}

function Dashboard() {
  const bars = [32, 44, 38, 52, 61, 58, 72, 69, 81, 88, 84, 96];
  return (
    <Shell>
      <Nav brand="Northwind" items={["Overview", "Releases", "Regions", "Incidents"]} />
      <div className="px-10 pt-8">
        <h1 className="text-[28px] font-semibold tracking-tight">Launch week</h1>
        <p className="mt-1 text-[13px] text-black/45">All regions · updated just now</p>
        <div className="mt-6 grid grid-cols-4 gap-3">
          {[
            ["Active users", "48,210", "+18.4%"],
            ["p95 latency", "112 ms", "−9 ms"],
            ["Deploys", "36", "this week"],
            ["Uptime", "99.99%", "steady"],
          ].map(([k, v, d]) => (
            <div key={k} className="rounded-xl border border-black/[0.07] bg-white p-4">
              <div className="text-[12px] text-black/45">{k}</div>
              <div className="mt-1 text-[24px] font-semibold tracking-tight">{v}</div>
              <div className="text-[12px] text-black/45">{d}</div>
            </div>
          ))}
        </div>
        <div className="mt-4 flex h-[210px] items-end gap-2.5 rounded-xl border border-black/[0.07] bg-white p-5">
          {bars.map((h, i) => (
            <div key={i} className="demo-bar flex-1 rounded-t-md bg-[#17181b]" style={{ height: `${h}%`, opacity: 0.25 + (i / bars.length) * 0.75, animationDelay: `${i * 40}ms` }} />
          ))}
        </div>
      </div>
    </Shell>
  );
}

function Review() {
  return (
    <Shell>
      <div className="border-b border-black/[0.06] px-10 py-6">
        <div className="text-[13px] text-black/45">northwind / api · pull 482</div>
        <h1 className="mt-1 text-[24px] font-semibold tracking-tight">Faster cold start for edge workers</h1>
        <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-[#17181b] px-3 py-1 text-[12px] font-medium text-white">
          <Check size={12} /> All checks passed
        </div>
      </div>
      <div className="px-10 pt-6 font-mono text-[12.5px] leading-6">
        {[
          ["-", "const pool = await createPool({ size: 16 })"],
          ["+", "const pool = lazyPool({ size: 16, warm: 2 })"],
          [" ", "export async function handle(req) {"],
          ["+", "  await pool.ready"],
          [" ", "  return route(req, pool)"],
          [" ", "}"],
        ].map(([s, l], i) => (
          <div key={i} className={`rounded px-3 ${s === "+" ? "bg-black/[0.07]" : s === "-" ? "bg-black/[0.03] text-black/40 line-through" : "text-black/60"}`}>
            <span className="mr-3 text-black/30">{s}</span>
            {l}
          </div>
        ))}
        <p className="mt-6 font-sans text-[14px] text-black/60">
          Benchmarks in the <L to="docs">deploy guide</L>.
        </p>
      </div>
    </Shell>
  );
}

function Mail() {
  return (
    <Shell className="flex">
      <aside className="w-[190px] shrink-0 border-r border-black/[0.06] px-5 pt-7 text-[13px] text-black/55">
        <div className="mb-5 text-[15px] font-semibold text-black">Postbox</div>
        {["Inbox", "Starred", "Sent", "Drafts"].map((x, i) => (
          <div key={x} className={`mb-1 rounded-md px-2 py-1.5 ${i === 0 ? "bg-black/[0.06] font-medium text-black" : ""}`}>
            {x}
          </div>
        ))}
      </aside>
      <main className="flex-1 pt-4">
        {[
          ["Mara Ellis", "Launch checklist", "Last call on the release notes before 3pm."],
          ["Northwind", "Deploy succeeded", "Production is live in all regions."],
          ["Jun Park", "Standup moved", "Let's do 10:30 in Huddle today."],
          ["Forge", "Review requested", "Faster cold start for edge workers."],
        ].map(([f, s, p], i) => (
          <div key={s} className={`border-b border-black/[0.05] px-8 py-4 ${i < 3 ? "" : "opacity-60"}`}>
            <div className="flex justify-between text-[13px]">
              <span className={i < 3 ? "font-semibold" : ""}>{f}</span>
              <span className="text-black/35">{9 + i}:0{i} AM</span>
            </div>
            <div className="text-[14px]">{s}</div>
            <div className="text-[13px] text-black/45">{p}</div>
          </div>
        ))}
      </main>
    </Shell>
  );
}

function Article() {
  return (
    <Shell>
      <Nav brand="Longform" items={["Essays", "Interviews", "Archive"]} serif />
      <article className="mx-auto max-w-[600px] pt-12">
        <div className="text-[12px] uppercase tracking-[0.16em] text-black/40">Essay · 9 min</div>
        <h1 className="mt-3 font-serif text-[46px] leading-[1.05] tracking-tight">The case for a quieter web.</h1>
        <div className="mt-6 h-[150px] rounded-xl bg-[linear-gradient(180deg,#d9d6cf,#b8b3aa_55%,#8f8a80)] shadow-inner" />
        <p className="mt-6 font-serif text-[18px] leading-8 text-black/70">
          We open forty tabs and keep none of them. The browser became a pile instead of a place. What if each part of your life had its own
          room, and the doors closed behind you?
        </p>
        <p className="mt-4 font-serif text-[18px] leading-8 text-black/70">
          Start with <L to="recipe">dinner</L>, then put on <L to="music">something slow</L>.
        </p>
      </article>
    </Shell>
  );
}

function Recipe() {
  return (
    <Shell>
      <Nav brand="Larder" items={["Recipes", "Pantry", "Plans"]} serif />
      <div className="grid grid-cols-[1.1fr_1fr] gap-10 px-10 pt-10">
        <div>
          <div className="text-[12px] uppercase tracking-[0.16em] text-black/40">20 minutes · serves 2</div>
          <h1 className="mt-3 font-serif text-[40px] leading-[1.05]">Weeknight sesame noodles</h1>
          <ol className="mt-6 space-y-3 text-[14px] leading-6 text-black/70">
            <li>1. Boil the noodles until just tender.</li>
            <li>2. Whisk tahini, soy, vinegar and chili oil.</li>
            <li>3. Toss with cucumber and scallions. Eat warm.</li>
          </ol>
        </div>
        <div className="aspect-square rounded-2xl bg-[radial-gradient(circle_at_40%_35%,#e9e4dc,#b9b1a5_60%,#8c8478)]" />
      </div>
    </Shell>
  );
}

function Music() {
  return (
    <Shell className="flex flex-col items-center justify-center bg-[#f2f1ee]">
      <div className="h-[230px] w-[230px] rounded-2xl bg-[conic-gradient(from_200deg,#17181b,#55565b,#c9c7c2,#17181b)] shadow-[0_30px_60px_-20px_rgba(0,0,0,0.45)]" />
      <div className="mt-6 text-[20px] font-semibold tracking-tight">Low Light</div>
      <div className="text-[13px] text-black/45">Tidepool · Night Swims</div>
      <div className="mt-5 flex items-end gap-[3px]">
        {Array.from({ length: 28 }, (_, i) => (
          <span key={i} className="demo-eq w-[3px] rounded-full bg-black/70" style={{ height: 6 + ((i * 7) % 20), animationDelay: `${(i % 7) * 90}ms` }} />
        ))}
      </div>
      <div className="mt-5 grid h-11 w-11 place-items-center rounded-full bg-[#17181b] text-white">
        <Play size={16} />
      </div>
    </Shell>
  );
}

function Design() {
  return (
    <Shell className="flex bg-[#ececea]">
      <aside className="w-[180px] shrink-0 border-r border-black/[0.06] bg-[#f7f7f5] px-4 pt-5 text-[12px] text-black/55">
        <div className="mb-4 text-[13px] font-semibold text-black">Brand v3</div>
        {["Logo", "Type scale", "Icons", "Launch post", "Banner"].map((x, i) => (
          <div key={x} className={`mb-1 rounded px-2 py-1.5 ${i === 0 ? "bg-black/[0.07] text-black" : ""}`}>
            {x}
          </div>
        ))}
      </aside>
      <div className="grid flex-1 place-items-center">
        <div className="relative grid h-[300px] w-[420px] place-items-center rounded-xl bg-[#111214] shadow-xl">
          <svg viewBox="212 230 608 550" className="h-24 w-24 text-white">
            <path d="M262 730C330 500 500 340 770 280C730 520 540 700 262 730Z" fill="currentColor" />
          </svg>
          <div className="absolute -inset-[3px] rounded-[14px] border border-dashed border-black/30" />
          <span className="absolute -top-6 left-0 text-[11px] text-black/45">Frame · 840 × 600</span>
        </div>
      </div>
    </Shell>
  );
}

function Call({ onShare }: { onShare?: () => void }) {
  const people = ["Mara", "Jun", "Ola", "You"];
  return (
    <div className="flex h-full flex-col bg-[#121316] text-white">
      <div className="flex items-center justify-between px-6 pt-5 text-[13px]">
        <span className="font-medium">Standup</span>
        <span className="flex items-center gap-2 text-white/55">
          <span className="h-2 w-2 animate-pulse rounded-full bg-white" /> 12:04
        </span>
      </div>
      <div className="grid flex-1 grid-cols-2 gap-3 p-5">
        {people.map((p, i) => (
          <div key={p} className="relative grid place-items-center overflow-hidden rounded-xl bg-[#1e2024]">
            <div className={`grid h-16 w-16 place-items-center rounded-full text-[20px] font-semibold ${i === 1 ? "demo-speaking bg-white text-black" : "bg-white/10"}`}>{p[0]}</div>
            <span className="absolute bottom-3 left-3 text-[12px] text-white/60">{p}</span>
          </div>
        ))}
      </div>
      <div className="flex justify-center gap-3 pb-5">
        {[Mic, Camera].map((I, i) => (
          <span key={i} className="grid h-10 w-10 place-items-center rounded-full bg-white/10">
            <I size={16} />
          </span>
        ))}
        <button data-share onClick={onShare} className="flex h-10 items-center gap-2 rounded-full bg-white px-4 text-[13px] font-medium text-black">
          <Screen size={15} /> Share screen
        </button>
        <span className="grid h-10 w-10 place-items-center rounded-full bg-white/10">
          <Phone size={16} />
        </span>
      </div>
    </div>
  );
}

function Store({ installed, onInstall }: { installed: boolean; onInstall?: () => void }) {
  return (
    <Shell>
      <Nav brand="Extensions" items={["Discover", "Productivity", "Privacy", "Themes"]} />
      <div className="flex items-start gap-8 px-10 pt-10">
        <div className="grid h-24 w-24 shrink-0 place-items-center rounded-3xl bg-[#17181b] text-[40px] font-semibold text-white">Q</div>
        <div className="flex-1">
          <h1 className="text-[28px] font-semibold tracking-tight">Quiet Mode</h1>
          <p className="mt-1 text-[14px] text-black/55">Hides feeds, autoplay and comment sections. 1.2M users.</p>
          <button
            data-install
            onClick={onInstall}
            className={`mt-5 inline-flex h-10 items-center gap-2 rounded-full px-5 text-[14px] font-medium transition ${installed ? "bg-black/[0.07] text-black" : "bg-[#17181b] text-white hover:bg-black"}`}
          >
            {installed ? (
              <>
                <Check size={15} /> Added to Wing
              </>
            ) : (
              "Add to Wing"
            )}
          </button>
        </div>
      </div>
      <div className="mt-10 grid grid-cols-3 gap-3 px-10">
        {["Password manager", "Reader view", "Dark everywhere"].map((x) => (
          <div key={x} className="rounded-xl border border-black/[0.07] bg-white p-4 text-[13px]">
            <div className="mb-3 h-9 w-9 rounded-xl bg-black/[0.08]" />
            {x}
          </div>
        ))}
      </div>
    </Shell>
  );
}

function Changelog() {
  return (
    <Shell>
      <div className="px-8 pt-7">
        <div className="text-[12px] uppercase tracking-[0.14em] text-black/40">Changelog</div>
        <h1 className="mt-2 text-[26px] font-semibold tracking-tight">Northwind 4.2</h1>
        <ul className="mt-5 space-y-3 text-[14px] leading-6 text-black/70">
          <li>— Previews build 40% faster.</li>
          <li>— Rollbacks keep your environment variables.</li>
          <li>— New webhook for promoted deploys.</li>
          <li>— The CLI remembers your last project.</li>
        </ul>
      </div>
    </Shell>
  );
}

export function PageView({ kind, installed, onShare, onInstall }: { kind: PageKind; installed: boolean; onShare?: () => void; onInstall?: () => void }) {
  switch (kind) {
    case "docs":
      return <Docs />;
    case "dashboard":
      return <Dashboard />;
    case "review":
      return <Review />;
    case "mail":
      return <Mail />;
    case "article":
      return <Article />;
    case "recipe":
      return <Recipe />;
    case "music":
      return <Music />;
    case "design":
      return <Design />;
    case "call":
      return <Call onShare={onShare} />;
    case "store":
      return <Store installed={installed} onInstall={onInstall} />;
    case "changelog":
      return <Changelog />;
  }
}
