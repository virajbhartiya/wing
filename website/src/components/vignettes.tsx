"use client";
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useId, useReducer, useRef, useState, type Dispatch } from "react";
import { FRAME, PageCard, Scaled, useShortcuts } from "@/demo/Window";
import { Sidebar } from "@/demo/chrome";
import { PaletteBody } from "@/demo/overlays";
import { PageView } from "@/demo/pages";
import { SPACES } from "@/demo/data";
import { chapterState, demoReducer, initialState, paletteResults, type DemoAction, type DemoState } from "@/demo/state";
import { Camera, Check, Mic, Puzzle, Screen, SidebarIcon, Star, Tab, Window as WindowIcon } from "@/demo/Icons";

/** Soft canvas each vignette sits on. */
export function Stage({ children, tint = "#eceae5", className = "" }: { children: React.ReactNode; tint?: string; className?: string }) {
  return (
    <motion.div
      animate={{ backgroundColor: tint }}
      transition={{ duration: 0.5 }}
      className={`relative overflow-hidden rounded-[28px] shadow-[inset_0_0_0_1px_rgba(0,0,0,0.05)] ${className}`}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(rgba(0,0,0,0.07)_1px,transparent_1px)] [background-size:18px_18px] [mask-image:radial-gradient(70%_70%_at_50%_40%,black,transparent)]" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(80%_60%_at_20%_0%,rgba(255,255,255,0.7),transparent_70%)]" />
      <div className="relative">{children}</div>
    </motion.div>
  );
}

function useDemo(init: DemoState) {
  const [s, dispatch] = useReducer(demoReducer, init);
  const [touched, setTouched] = useState(false);
  const act: Dispatch<DemoAction> = useCallback((a) => {
    setTouched(true);
    dispatch(a);
  }, []);
  return { s, dispatch, act, touched, setTouched };
}

function useInView<T extends HTMLElement>(threshold = 0.4) {
  const ref = useRef<T>(null);
  const [inView, set] = useState(false);
  useEffect(() => {
    const io = new IntersectionObserver(([e]) => set(e.isIntersecting), { threshold });
    if (ref.current) io.observe(ref.current);
    return () => io.disconnect();
  }, [threshold]);
  return [ref, inView] as const;
}

/** Plays a list of actions on a loop while on screen, until the visitor takes over. */
function useAutoplay(script: [number, DemoAction][], dispatch: Dispatch<DemoAction>, on: boolean) {
  const reduce = useReducedMotion();
  useEffect(() => {
    if (!on || reduce) return;
    let i = 0;
    let t = 0;
    const next = () => {
      const [wait, a] = script[i % script.length];
      t = window.setTimeout(() => {
        dispatch(a);
        i++;
        next();
      }, wait);
    };
    next();
    return () => clearTimeout(t);
  }, [on, reduce, script, dispatch]);
}

export function Hint({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-4 flex justify-center">
      <span className="inline-flex items-center gap-2 rounded-full bg-white/80 px-3.5 py-1.5 text-[13px] text-ink/70 shadow-[0_0_0_1px_rgba(0,0,0,0.06)] backdrop-blur">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ink" />
        {children}
      </span>
    </div>
  );
}

/* ───────────── Spaces: a close-up of the sidebar and page, tinted by Space ───────────── */

const SPACE_SCRIPT: [number, DemoAction][] = [
  [2200, { type: "space", index: 1 }],
  [2200, { type: "space", index: 2 }],
  [2200, { type: "space", index: 0 }],
];

export function SpacesVignette() {
  const { s, dispatch, act, touched } = useDemo(initialState);
  const [ref, inView] = useInView<HTMLDivElement>();
  useAutoplay(SPACE_SCRIPT, dispatch, inView && !touched);
  const id = useId();
  return (
    <div ref={ref}>
      <Stage tint={FRAME[s.space]}>
        <div className="px-6 pt-8 sm:px-10 sm:pt-10">
          <div className="mb-6 flex flex-wrap justify-center gap-2">
            {SPACES.map((sp, i) => (
              <button
                key={sp.name}
                type="button"
                onClick={() => act({ type: "space", index: i })}
                className={`relative h-10 rounded-full px-5 text-[14px] font-medium transition-colors ${i === s.space ? "text-white" : "text-ink/60 hover:text-ink"}`}
              >
                {i === s.space && <motion.span layoutId={`${id}-sp`} className="absolute inset-0 rounded-full bg-ink" transition={{ type: "spring", stiffness: 450, damping: 34 }} />}
                <span className="relative">
                  {sp.glyph} {sp.name}
                </span>
              </button>
            ))}
          </div>
          <LayoutGroup id={id}>
            <Scaled w={980} h={500} className="mx-auto">
              <div className="flex h-[540px] w-[980px] overflow-hidden rounded-t-[14px] bg-white/30 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.35),0_0_0_1px_rgba(0,0,0,0.06)] backdrop-blur">
                <Sidebar s={s} dispatch={act} />
                <div className="flex min-w-0 flex-1 flex-col pt-2">
                  <PageCard s={s} dispatch={act} />
                </div>
              </div>
            </Scaled>
          </LayoutGroup>
        </div>
      </Stage>
      <Hint>Click a Space, swipe the sidebar, or open a tab</Hint>
    </div>
  );
}

/* ───────────── Command palette: just the palette, floating ───────────── */

const QUERIES = ["dash", "noodles", "studio", "split"];

export function PaletteVignette() {
  const { s, dispatch, touched, setTouched } = useDemo({ ...initialState, palette: { open: true, query: "", index: 0 } });
  const [toast, setToast] = useState<string | null>(null);
  const [ref, inView] = useInView<HTMLDivElement>();
  const input = useRef<HTMLInputElement>(null);
  const reduce = useReducedMotion();

  const live = useRef(s);
  live.current = s;
  const act: Dispatch<DemoAction> = useCallback(
    (a) => {
      if (a.type === "paletteOpenSelected") {
        const cur = live.current;
        const r = paletteResults(cur)[cur.palette.index];
        setToast(r ? (r.kind === "tab" ? `Opened ${r.title}` : r.title) : "Searching the web");
        dispatch({ type: "query", value: "" });
        window.setTimeout(() => setToast(null), 1600);
        return;
      }
      if (a.type === "palette") return;
      dispatch(a);
    },
    [dispatch],
  );

  // Types a few searches on its own until the visitor clicks into it.
  useEffect(() => {
    if (!inView || touched || reduce) return;
    let q = 0;
    let c = 0;
    let t = 0;
    const tick = () => {
      const word = QUERIES[q % QUERIES.length];
      if (c <= word.length) {
        dispatch({ type: "query", value: word.slice(0, c) });
        c++;
        t = window.setTimeout(tick, c === 1 ? 900 : 120);
      } else {
        t = window.setTimeout(() => {
          act({ type: "paletteOpenSelected" });
          q++;
          c = 0;
          t = window.setTimeout(tick, 1200);
        }, 900);
      }
    };
    t = window.setTimeout(tick, 600);
    return () => clearTimeout(t);
  }, [inView, touched, reduce, dispatch, act]);

  return (
    <div ref={ref}>
      <Stage tint="#e9e8e4">
        <div className="relative flex min-h-[460px] items-start justify-center px-4 pb-16 pt-14 sm:min-h-[520px] sm:pt-20">
          <div className="pointer-events-none absolute inset-x-10 top-10 bottom-0 overflow-hidden rounded-t-2xl opacity-40 blur-[3px] [mask-image:linear-gradient(black,transparent)]">
            <PageView kind="docs" installed={false} />
          </div>
          <motion.div
            onPointerDown={() => {
              setTouched(true);
              input.current?.focus({ preventScroll: true });
            }}
            className="relative w-full max-w-[620px] overflow-hidden rounded-2xl bg-[#fbfbf9] text-left text-ink shadow-[0_40px_100px_-20px_rgba(0,0,0,0.35),0_0_0_1px_rgba(0,0,0,0.08)]"
          >
            <LayoutGroup id="palette-vignette">
              <PaletteBody s={s} dispatch={act} inputRef={input} />
            </LayoutGroup>
          </motion.div>
          <AnimatePresence>
            {toast && (
              <motion.div
                initial={{ opacity: 0, y: 12, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8 }}
                className="absolute bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-full bg-ink px-4 py-2 text-[13px] text-white shadow-lg"
              >
                <Check size={14} /> {toast}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </Stage>
      <Hint>Click in and type: “noodles”, “dash”, “split”</Hint>
    </div>
  );
}

/* ───────────── Split view and Peek: the page card on its own ───────────── */

export function CardVignette({ chapter, tint, hint }: { chapter: "split" | "peek"; tint: string; hint: string }) {
  const { s, dispatch, act } = useDemo(chapterState(chapter));
  const [ref, inView] = useInView<HTMLDivElement>(0.5);
  useShortcuts(s, dispatch, inView);
  const id = useId();
  const changed = JSON.stringify(s) !== JSON.stringify(chapterState(chapter));
  return (
    <div ref={ref}>
      <Stage tint={tint}>
        <div className="p-5 sm:p-10">
          <LayoutGroup id={id}>
            <Scaled w={980} h={560} className="mx-auto">
              <div className="flex h-[560px] w-[980px] flex-col rounded-[16px] bg-white/40 pl-2 pt-2 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.35),0_0_0_1px_rgba(0,0,0,0.06)]">
                <PageCard s={s} dispatch={act} />
              </div>
            </Scaled>
          </LayoutGroup>
        </div>
      </Stage>
      <div className="flex items-center justify-center gap-2">
        <Hint>{hint}</Hint>
        {changed && (
          <button type="button" onClick={() => dispatch({ type: "tour", chapter })} className="mt-4 rounded-full px-3 py-1.5 text-[13px] text-muted hover:bg-black/[0.05] hover:text-ink">
            Reset
          </button>
        )}
      </div>
    </div>
  );
}

/* ───────────── The bento grid ───────────── */

function Tile({ children, className = "", dark = false }: { children: React.ReactNode; className?: string; dark?: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.7, ease: [0.2, 0.7, 0.2, 1] }}
      className={`relative flex flex-col overflow-hidden rounded-[24px] p-7 ${dark ? "bg-ink text-white" : "bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.06)]"} ${className}`}
    >
      {children}
    </motion.div>
  );
}

function TileText({ title, body, dark = false }: { title: string; body: string; dark?: boolean }) {
  return (
    <div className="mt-auto pt-6">
      <h3 className="font-display text-[22px] font-semibold tracking-[-0.03em]">{title}</h3>
      <p className={`mt-1.5 text-[14.5px] leading-6 ${dark ? "text-white/55" : "text-muted"}`}>{body}</p>
    </div>
  );
}

function ExtensionsTile() {
  const [added, setAdded] = useState(false);
  return (
    <Tile className="md:col-span-3">
      <LayoutGroup id="ext">
        <div className="flex h-11 items-center gap-2 rounded-xl bg-[#ecebe8] px-3 text-black/55">
          <div className="flex h-7 flex-1 items-center justify-center rounded-lg bg-white/70 text-[12.5px]">extensions.gallery</div>
          <Star size={15} />
          <Puzzle size={15} />
          <div className="grid h-6 w-6 place-items-center">
            {added && <motion.span layoutId="q" className="grid h-5 w-5 place-items-center rounded-md bg-ink text-[10px] font-bold text-white" transition={{ type: "spring", stiffness: 320, damping: 24 }}>Q</motion.span>}
          </div>
        </div>
        <div className="mt-4 flex items-center gap-4 rounded-2xl bg-[#f6f6f4] p-4">
          <div className="grid h-14 w-14 shrink-0 place-items-center">
            {!added && <motion.span layoutId="q" className="grid h-14 w-14 place-items-center rounded-2xl bg-ink text-[24px] font-semibold text-white" transition={{ type: "spring", stiffness: 320, damping: 24 }}>Q</motion.span>}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-semibold">Quiet Mode</div>
            <div className="truncate text-[13px] text-muted">Hides feeds and autoplay</div>
          </div>
          <button
            type="button"
            onClick={() => setAdded((v) => !v)}
            className={`h-9 shrink-0 rounded-full px-4 text-[13px] font-medium transition ${added ? "bg-black/[0.06] text-ink" : "bg-ink text-white hover:-translate-y-0.5"}`}
          >
            {added ? "Remove" : "Add to Wing"}
          </button>
        </div>
      </LayoutGroup>
      <TileText title="Chrome extensions on Mac." body="Install from the Chrome Web Store. Compatibility varies by extension." />
    </Tile>
  );
}

function CallsTile() {
  const [picking, setPicking] = useState(false);
  const [sharing, setSharing] = useState<string | null>(null);
  const opts = [
    { icon: Tab, label: "This tab" },
    { icon: WindowIcon, label: "A window" },
    { icon: Screen, label: "Entire screen" },
  ];
  return (
    <Tile dark className="md:col-span-3">
      <div className="relative grid grid-cols-3 gap-2">
        {["M", "J", "O"].map((p, i) => (
          <div key={p} className="grid aspect-[4/3] place-items-center rounded-xl bg-white/[0.07]">
            <span className={`grid h-10 w-10 place-items-center rounded-full text-[15px] font-semibold ${i === 1 ? "demo-speaking bg-white text-black" : "bg-white/10"}`}>{p}</span>
          </div>
        ))}
        <AnimatePresence>
          {picking && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.97 }}
              className="absolute inset-0 grid grid-cols-3 gap-2 rounded-xl bg-[#fbfbf9] p-2 text-ink"
            >
              {opts.map((o) => (
                <button
                  key={o.label}
                  type="button"
                  onClick={() => {
                    setSharing(o.label);
                    setPicking(false);
                  }}
                  className="flex flex-col items-center justify-center gap-2 rounded-lg text-[12.5px] font-medium transition hover:bg-black/[0.05]"
                >
                  <o.icon size={18} /> {o.label}
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <span className="grid h-9 w-9 place-items-center rounded-full bg-white/10">
          <Mic size={15} />
        </span>
        <span className="grid h-9 w-9 place-items-center rounded-full bg-white/10">
          <Camera size={15} />
        </span>
        <button type="button" onClick={() => (sharing ? setSharing(null) : setPicking((v) => !v))} className="ml-auto flex h-9 items-center gap-2 rounded-full bg-white px-4 text-[13px] font-medium text-black">
          <Screen size={14} /> {sharing ? `Stop sharing ${sharing.toLowerCase()}` : "Share screen"}
        </button>
      </div>
      <TileText dark title="Calls stay live. You pick what's shared." body="Meet, Zoom and Teams keep running while you switch tabs. Share one tab, one window or everything." />
    </Tile>
  );
}

function LayoutTile() {
  const [top, setTop] = useState(false);
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.metaKey && e.altKey && e.code === "KeyS") {
        e.preventDefault();
        setTop((v) => !v);
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);
  const bar = "rounded-md bg-black/[0.09]";
  return (
    <Tile className="md:col-span-2">
      <button type="button" onClick={() => setTop((v) => !v)} aria-label="Switch between sidebar and top tabs" className="group block w-full text-left">
        <div className={`flex h-40 gap-2 rounded-2xl bg-[#e8e2f0] p-2 transition-colors ${top ? "flex-col" : "flex-row"}`}>
          <motion.div layout className={`flex gap-1.5 ${top ? "h-6 flex-row" : "w-1/4 flex-col pt-1"}`} transition={{ type: "spring", stiffness: 300, damping: 30 }}>
            {[0, 1, 2].map((i) => (
              <motion.span layout key={i} className={`${bar} ${top ? "h-full flex-1" : "h-4 w-full"} ${i === 0 ? "!bg-white" : ""}`} />
            ))}
          </motion.div>
          <motion.div layout className="flex-1 rounded-lg bg-white shadow-sm" transition={{ type: "spring", stiffness: 300, damping: 30 }} />
        </div>
      </button>
      <div className="mt-3 flex items-center gap-2 text-[12.5px] text-muted">
        <SidebarIcon size={14} /> Click it, or press ⌥⌘S
      </div>
      <TileText title="Sidebar or top tabs." body="Safari's toolbar to start, Arc-style sidebar when you want it." />
    </Tile>
  );
}

const KEYCAPS: { keys: string[]; label: string; test: (e: KeyboardEvent) => boolean }[] = [
  { keys: ["⌘", "K"], label: "Palette", test: (e) => e.metaKey && e.key.toLowerCase() === "k" },
  { keys: ["⌃", "1"], label: "Spaces", test: (e) => e.ctrlKey && /^[1-9]$/.test(e.key) },
  { keys: ["⇧", "click"], label: "Peek", test: (e) => e.key === "Shift" },
];

function KeysTile() {
  const [lit, setLit] = useState<number | null>(null);
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const i = KEYCAPS.findIndex((k) => k.test(e));
      if (i >= 0) setLit(i);
    };
    const up = () => setLit(null);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);
  return (
    <Tile className="md:col-span-2">
      <div className="flex flex-col gap-2.5">
        {KEYCAPS.map((k, i) => (
          <div key={k.label} className="flex items-center gap-3">
            <div className="flex gap-1.5">
              {k.keys.map((key) => (
                <kbd
                  key={key}
                  className={`grid h-10 min-w-10 place-items-center rounded-[10px] px-2.5 font-sans text-[15px] transition-all duration-150 ${lit === i ? "translate-y-0.5 bg-ink text-white shadow-none" : "bg-[#f3f3f1] shadow-[inset_0_-2px_0_rgba(0,0,0,0.08),0_0_0_1px_rgba(0,0,0,0.07)]"}`}
                >
                  {key}
                </kbd>
              ))}
            </div>
            <span className="text-[13.5px] text-muted">{k.label}</span>
          </div>
        ))}
      </div>
      <TileText title="Built for the keyboard." body="Press one of these now." />
    </Tile>
  );
}

function PrivacyTile() {
  return (
    <Tile dark className="md:col-span-2">
      <div className="font-display text-[44px] font-semibold leading-[0.95] tracking-[-0.05em]">
        No account.
        <br />
        <span className="text-white/35">No analytics.</span>
      </div>
      <TileText dark title="Nothing phones home." body="Bug reports open a prefilled issue that you send yourself." />
    </Tile>
  );
}

export function Bento() {
  return (
    <div className="mx-auto grid max-w-[1200px] gap-4 md:grid-cols-6">
      <ExtensionsTile />
      <CallsTile />
      <LayoutTile />
      <KeysTile />
      <PrivacyTile />
    </div>
  );
}
