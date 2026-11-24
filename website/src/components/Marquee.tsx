const ITEMS = ["Spaces", "Split view", "Peek", "Command palette", "Chrome extensions", "Calls that stay live", "Sidebar or top tabs", "Open source", "Native Chromium"];

export function Marquee() {
  const row = [...ITEMS, ...ITEMS];
  return (
    <div className="relative overflow-hidden border-y border-black/[0.06] bg-white py-5 [mask-image:linear-gradient(90deg,transparent,black_10%,black_90%,transparent)]" aria-hidden>
      <div className="marquee flex w-max gap-12 whitespace-nowrap font-display text-[22px] font-medium tracking-[-0.02em] text-ink/80">
        {row.map((x, i) => (
          <span key={i} className="flex items-center gap-12">
            {x}
            <span className="text-ink/20">✦</span>
          </span>
        ))}
      </div>
    </div>
  );
}
