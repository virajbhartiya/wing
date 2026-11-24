"use client";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, type Dispatch } from "react";
import { PAGES } from "./data";
import { paletteResults, type DemoAction, type DemoState } from "./state";
import { Close, Expand, Screen, Search, Tab, Window } from "./Icons";
import { PageView } from "./pages";

type Props = { s: DemoState; dispatch: Dispatch<DemoAction> };

const spring = { type: "spring", stiffness: 520, damping: 38 } as const;

export function Palette({ s, dispatch }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const reduce = useReducedMotion();
  const mounted = useRef(false);
  useEffect(() => {
    if (mounted.current && s.palette.open) input.current?.focus({ preventScroll: true });
    mounted.current = true;
  }, [s.palette.open]);
  return (
    <AnimatePresence>
      {s.palette.open && (
        <motion.div key="palette" className="absolute inset-0 z-30" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.14 }}>
          <div className="absolute inset-0 bg-black/10" onClick={() => dispatch({ type: "palette", open: false })} />
          <motion.div
            role="dialog"
            aria-label="Command palette"
            initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.98, y: -4 }}
            transition={spring}
            className="absolute left-1/2 top-[86px] w-[600px] -translate-x-1/2 overflow-hidden rounded-2xl bg-[#fbfbf9] text-[#17181b] shadow-[0_40px_100px_-20px_rgba(0,0,0,0.35),0_0_0_1px_rgba(0,0,0,0.08)]"
          >
            <PaletteBody s={s} dispatch={dispatch} inputRef={input} />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** The palette's search field, results and footer, shared by the window and the standalone palette. */
export function PaletteBody({ s, dispatch, inputRef }: Props & { inputRef?: React.RefObject<HTMLInputElement | null> }) {
  const results = paletteResults(s);
  const input = inputRef;
  return (
    <>
      <div className="flex h-14 items-center gap-3 border-b border-black/[0.06] px-5">
        <Search size={17} className="text-black/45" />
        <input
          ref={input}
          data-palette
          value={s.palette.query}
          onChange={(e) => dispatch({ type: "query", value: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              dispatch({ type: "paletteMove", delta: e.key === "ArrowDown" ? 1 : -1 });
            } else if (e.key === "Enter") {
              e.preventDefault();
              dispatch({ type: "paletteOpenSelected" });
            }
          }}
          placeholder="Search tabs, Spaces and actions"
          aria-label="Search tabs, Spaces and actions"
          className="flex-1 bg-transparent text-[16px] outline-none placeholder:text-black/35 focus-visible:outline-none"
        />
        <span className="text-[12px] text-black/40">New tab</span>
      </div>
      <div className="p-2">
        <div className="px-3 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-black/40">{s.palette.query ? "Results" : "Open tabs and actions"}</div>
        {results.length === 0 && <div className="px-3 py-4 text-[13px] text-black/45">Search the web for “{s.palette.query}”</div>}
        {results.map((r, i) => (
          <button
            key={r.id}
            type="button"
            onMouseEnter={() => i !== s.palette.index && dispatch({ type: "paletteMove", delta: i - s.palette.index })}
            onClick={() => dispatch({ type: "paletteOpenSelected" })}
            className={`relative flex h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-[13.5px] ${i === s.palette.index ? "bg-black/[0.06]" : ""}`}
          >
            {i === s.palette.index && <motion.span layoutId="pal-sel" className="absolute left-0 top-2 h-7 w-[3px] rounded-full bg-[#17181b]" transition={spring} />}
            <span className="grid h-6 w-6 place-items-center rounded-md bg-black/[0.07] text-[11px] font-semibold">{r.kind === "tab" ? PAGES[r.id].glyph : r.kind === "space" ? "◐" : "⌘"}</span>
            <span className="font-medium">{r.title}</span>
            <span className="truncate text-black/40">{r.sub}</span>
            {i === s.palette.index && <span className="ml-auto rounded border border-black/15 px-1.5 text-[11px] text-black/50">↵</span>}
          </button>
        ))}
      </div>
      <div className="flex gap-4 border-t border-black/[0.06] px-5 py-2.5 text-[11.5px] text-black/45">
        <span>↑ ↓ Select</span>
        <span>↵ Open</span>
        <span className="ml-auto">esc Close</span>
      </div>
    </>
  );
}

export function Peek({ s, dispatch }: Props) {
  const reduce = useReducedMotion();
  return (
    <AnimatePresence>
      {s.peek && (
        <motion.div key="peek" className="absolute inset-0 z-20" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.16 }}>
          <div className="absolute inset-0 bg-black/25" onClick={() => dispatch({ type: "closePeek" })} />
          <motion.div
            role="dialog"
            aria-label="Peek"
            initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.92, y: 24 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.95, y: 16 }}
            transition={{ type: "spring", stiffness: 380, damping: 30 }}
            className="absolute inset-x-[7%] bottom-[22px] top-[48px] flex flex-col overflow-hidden rounded-[14px] bg-[#ecebe8] shadow-[0_40px_120px_-20px_rgba(0,0,0,0.45),0_0_0_1px_rgba(0,0,0,0.06)]"
          >
            <div className="flex h-10 shrink-0 items-center gap-2 px-3 text-[12.5px] text-black/65">
              <span className="truncate">{PAGES[s.peek.page].host}</span>
              <button type="button" onClick={() => dispatch({ type: "promotePeek" })} className="ml-auto flex h-7 items-center gap-1.5 rounded-md px-2 hover:bg-black/[0.07]" aria-label="Open as a tab">
                <Expand size={13} /> Open as tab
              </button>
              <button type="button" onClick={() => dispatch({ type: "closePeek" })} className="grid h-7 w-7 place-items-center rounded-md hover:bg-black/[0.07]" aria-label="Close Peek">
                <Close size={14} />
              </button>
            </div>
            <div className="mx-1.5 mb-1.5 min-h-0 flex-1 overflow-hidden rounded-[10px]">
              <PageView kind={PAGES[s.peek.page].kind} installed={s.installed} />
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function SharePicker({ s, dispatch }: Props) {
  const options = [
    { icon: Tab, title: "This tab", sub: "Only Standup — Huddle" },
    { icon: Window, title: "A window", sub: "Pick one app window" },
    { icon: Screen, title: "Entire screen", sub: "Everything you see" },
  ];
  return (
    <AnimatePresence>
      {s.share && (
        <motion.div key="share" className="absolute inset-0 z-20 grid place-items-center bg-black/30" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.div
            role="dialog"
            aria-label="Choose what to share"
            initial={{ scale: 0.94, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.96, opacity: 0 }}
            transition={spring}
            className="w-[440px] rounded-2xl bg-[#fbfbf9] p-5 text-[#17181b] shadow-2xl"
          >
            <div className="text-[15px] font-semibold">huddle.video wants to share your screen</div>
            <div className="mt-1 text-[13px] text-black/50">Wing asks first. Choose exactly what they see.</div>
            <div className="mt-4 grid grid-cols-3 gap-2">
              {options.map((o) => (
                <button key={o.title} type="button" onClick={() => dispatch({ type: "share", open: false })} className="rounded-xl border border-black/[0.08] p-3 text-left transition hover:border-black/30 hover:bg-black/[0.03]">
                  <o.icon size={18} />
                  <div className="mt-3 text-[13px] font-medium">{o.title}</div>
                  <div className="text-[11.5px] text-black/45">{o.sub}</div>
                </button>
              ))}
            </div>
            <div className="mt-4 flex justify-end">
              <button type="button" onClick={() => dispatch({ type: "share", open: false })} className="h-8 rounded-lg px-3 text-[13px] text-black/60 hover:bg-black/[0.05]">
                Cancel
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function LiveCall({ s, dispatch }: Props) {
  const show = s.space === 2 && s.tabs[2].includes("call") && s.active[2] !== "call";
  return (
    <AnimatePresence>
      {show && (
        <motion.button
          type="button"
          initial={{ opacity: 0, y: 10, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 10, scale: 0.95 }}
          onClick={() => dispatch({ type: "tab", id: "call" })}
          className="absolute bottom-4 right-4 z-10 flex h-9 items-center gap-2 rounded-full bg-[#17181b] px-3.5 text-[12px] font-medium text-white shadow-[0_10px_30px_-6px_rgba(0,0,0,0.6),0_0_0_1px_rgba(255,255,255,0.1)]"
        >
          <span className="h-2 w-2 animate-pulse rounded-full bg-white" /> Standup is still live
        </motion.button>
      )}
    </AnimatePresence>
  );
}
