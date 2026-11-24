"use client";
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from "motion/react";
import { useEffect, useId, useLayoutEffect, useRef, useState, type Dispatch } from "react";
import { PAGES } from "./data";
import type { DemoAction, DemoState } from "./state";
import { Sidebar, TAB_MIME, Toolbar, TopBar } from "./chrome";
import { LiveCall, Palette, Peek, SharePicker } from "./overlays";
import { PageView } from "./pages";

export const DESIGN_W = 1200;
export const DESIGN_H = 740;
/** Each Space tints the window frame, as in the app. Kept soft on purpose. */
export const FRAME = ["#e3e6ec", "#e8e2f0", "#ebe5dc"];

// Only the demo window that is most on screen answers keyboard shortcuts.
const visible = new Map<string, number>();
const subscribers = new Set<() => void>();
function topDemo() {
  let best: string | null = null;
  let ratio = 0.3;
  for (const [id, r] of visible) if (r > ratio) [best, ratio] = [id, r];
  return best;
}
function useIsTopDemo(id: string, ref: React.RefObject<HTMLElement | null>) {
  const [top, setTop] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setTop(topDemo() === id);
    subscribers.add(update);
    const io = new IntersectionObserver(
      ([e]) => {
        visible.set(id, e.intersectionRatio);
        subscribers.forEach((f) => f());
      },
      { threshold: [0, 0.2, 0.4, 0.6, 0.8, 1] },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      visible.delete(id);
      subscribers.delete(update);
      subscribers.forEach((f) => f());
    };
  }, [id, ref]);
  return top;
}

type Props = {
  state: DemoState;
  dispatch: Dispatch<DemoAction>;
  /** Called on any input from the visitor, so the page can stop its own animation. */
  onInteract?: () => void;
};

const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

export function useShortcuts(s: DemoState, dispatch: Dispatch<DemoAction>, active: boolean, onInteract?: () => void) {
  const ref = useRef(s);
  ref.current = s;
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const st = ref.current;
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      let a: DemoAction | null = null;
      if (mod && (k === "k" || k === "t") && !e.altKey) a = { type: "palette", open: !st.palette.open || k === "t" };
      else if (e.key === "Escape") {
        if (st.palette.open) a = { type: "palette", open: false };
        else if (st.share) a = { type: "share", open: false };
        else if (st.peek) a = { type: "closePeek" };
        else if (st.split) a = { type: "unsplit" };
      } else if (typing(e.target)) return;
      else if (e.metaKey && e.altKey && (k === "s" || e.code === "KeyS")) a = { type: "layout", value: st.layout === "sidebar" ? "top" : "sidebar" };
      else if (e.ctrlKey && /^[1-3]$/.test(e.key)) a = { type: "space", index: Number(e.key) - 1 };
      if (!a) return;
      e.preventDefault();
      onInteract?.();
      dispatch(a);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, dispatch, onInteract]);
}

function useScale(ref: React.RefObject<HTMLDivElement | null>, designW = DESIGN_W) {
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setScale(Math.min(1, e.contentRect.width / designW)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, designW]);
  return scale;
}

function Pane({ id, s, dispatch }: { id: string; s: DemoState; dispatch: Dispatch<DemoAction> }) {
  return (
    <PageView
      kind={PAGES[id].kind}
      installed={s.installed}
      onShare={() => dispatch({ type: "share", open: true })}
      onInstall={() => dispatch({ type: "install" })}
    />
  );
}

function Card({ s, dispatch }: { s: DemoState; dispatch: Dispatch<DemoAction> }) {
  const reduce = useReducedMotion();
  const card = useRef<HTMLDivElement>(null);
  const press = useRef<{ t: number; to: string | null; fired: boolean }>({ t: 0, to: null, fired: false });
  const [drop, setDrop] = useState(false);
  const prevSpace = useRef(s.space);
  const dir = s.space === prevSpace.current ? 0 : s.space > prevSpace.current ? 1 : -1;
  useEffect(() => {
    prevSpace.current = s.space;
  }, [s.space]);
  const id = s.active[s.space];

  const linkFrom = (t: EventTarget | null) => (t instanceof Element ? (t.closest("[data-link]") as HTMLElement | null) : null);

  return (
    <div
      ref={card}
      className="relative mb-2 mr-2 min-h-0 flex-1 overflow-hidden rounded-[10px] bg-[#fbfbf9] shadow-[0_1px_3px_rgba(0,0,0,0.12),0_0_0_0.5px_rgba(0,0,0,0.06)]"
      onClick={(e) => {
        const link = linkFrom(e.target);
        if (!link) return;
        e.preventDefault();
        if (press.current.fired) return void (press.current.fired = false);
        const to = link.dataset.link!;
        dispatch(e.shiftKey ? { type: "peek", page: to } : { type: "open", page: to });
      }}
      onPointerDown={(e) => {
        const link = linkFrom(e.target);
        if (!link || e.pointerType === "mouse") return;
        press.current.fired = false;
        press.current.to = link.dataset.link!;
        press.current.t = window.setTimeout(() => {
          press.current.fired = true;
          dispatch({ type: "peek", page: press.current.to! });
        }, 450);
      }}
      onPointerUp={() => clearTimeout(press.current.t)}
      onPointerCancel={() => clearTimeout(press.current.t)}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(TAB_MIME)) return;
        e.preventDefault();
        setDrop(true);
      }}
      onDragLeave={() => setDrop(false)}
      onDrop={(e) => {
        setDrop(false);
        const tab = e.dataTransfer.getData(TAB_MIME);
        if (tab) dispatch({ type: "split", right: tab });
      }}
    >
      {s.split ? (
        <SplitPanes s={s} dispatch={dispatch} card={card} />
      ) : (
        <AnimatePresence initial={false} custom={dir} mode="popLayout">
          <motion.div
            key={`${s.space}-${id}`}
            custom={dir}
            variants={{
              enter: (d: number) => (reduce || !d ? { opacity: 0 } : { x: `${d * 30}%`, opacity: 0 }),
              center: { x: 0, opacity: 1 },
              exit: (d: number) => (reduce || !d ? { opacity: 0 } : { x: `${d * -30}%`, opacity: 0 }),
            }}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ type: "spring", stiffness: 300, damping: 34, opacity: { duration: 0.18 } }}
            className="absolute inset-0"
          >
            <Pane id={id} s={s} dispatch={dispatch} />
          </motion.div>
        </AnimatePresence>
      )}
      <AnimatePresence>
        {drop && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="pointer-events-none absolute inset-y-3 right-3 z-30 grid w-[calc(50%-18px)] place-items-center rounded-lg border-2 border-dashed border-black/30 bg-black/[0.06] text-[13px] font-medium text-black/60"
          >
            Drop to split
          </motion.div>
        )}
      </AnimatePresence>
      <LiveCall s={s} dispatch={dispatch} />
      <Peek s={s} dispatch={dispatch} />
      <SharePicker s={s} dispatch={dispatch} />
    </div>
  );
}

function SplitPanes({ s, dispatch, card }: { s: DemoState; dispatch: Dispatch<DemoAction>; card: React.RefObject<HTMLDivElement | null> }) {
  const split = s.split!;
  return (
    <motion.div className="absolute inset-0 flex gap-0 bg-[#00000012]" initial={{ opacity: 0.4 }} animate={{ opacity: 1 }}>
      <motion.div layout className="min-w-0 overflow-hidden rounded-[8px]" style={{ flexBasis: `${split.ratio * 100}%` }} transition={{ type: "spring", stiffness: 400, damping: 40 }}>
        <Pane id={split.left} s={s} dispatch={dispatch} />
      </motion.div>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize split"
        className="group relative w-2 shrink-0 cursor-col-resize touch-none"
        onPointerDown={(e) => {
          const el = card.current;
          if (!el) return;
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          const move = (ev: PointerEvent) => {
            const r = el.getBoundingClientRect();
            dispatch({ type: "splitRatio", ratio: (ev.clientX - r.left) / r.width });
          };
          const up = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
          };
          window.addEventListener("pointermove", move);
          window.addEventListener("pointerup", up);
        }}
      >
        <span className="absolute left-1/2 top-1/2 h-10 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-black/25 transition group-hover:bg-black/60" />
      </div>
      <motion.div layout initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ type: "spring", stiffness: 340, damping: 34 }} className="min-w-0 flex-1 overflow-hidden rounded-[8px]">
        <Pane id={split.right} s={s} dispatch={dispatch} />
      </motion.div>
    </motion.div>
  );
}

export function DemoWindow({ state: s, dispatch, onInteract }: Props) {
  const outer = useRef<HTMLDivElement>(null);
  const scale = useScale(outer);
  const id = useId();
  const keysActive = useIsTopDemo(id, outer);
  const act: Dispatch<DemoAction> = (a) => {
    onInteract?.();
    dispatch(a);
  };
  useShortcuts(s, dispatch, keysActive, onInteract);

  return (
    <div ref={outer} className="w-full" style={{ height: DESIGN_H * scale }}>
      <LayoutGroup id={id}>
      <div style={{ zoom: scale, width: DESIGN_W, height: DESIGN_H }}>
      <motion.div
        className="relative overflow-hidden rounded-[14px] text-left text-black shadow-[0_50px_120px_-40px_rgba(20,20,40,0.45),0_20px_40px_-30px_rgba(20,20,40,0.3),0_0_0_1px_rgba(0,0,0,0.08),inset_0_1px_0_rgba(255,255,255,0.7)]"
        style={{ width: DESIGN_W, height: DESIGN_H }}
        animate={{ backgroundColor: FRAME[s.space] }}
        transition={{ duration: 0.4 }}
        onPointerDownCapture={() => onInteract?.()}
      >
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(160deg,rgba(255,255,255,0.55),rgba(255,255,255,0)_45%,rgba(0,0,0,0.04))]" />
        <div className="relative flex h-full">
          <AnimatePresence initial={false}>
            {s.layout === "sidebar" && (
              <motion.div key="sb" initial={{ width: 0, opacity: 0 }} animate={{ width: 240, opacity: 1 }} exit={{ width: 0, opacity: 0 }} transition={{ type: "spring", stiffness: 360, damping: 38 }} className="h-full shrink-0 overflow-hidden">
                <Sidebar s={s} dispatch={act} />
              </motion.div>
            )}
          </AnimatePresence>
          <div className={`flex min-w-0 flex-1 flex-col ${s.layout === "top" ? "pl-2" : ""}`}>
            {s.layout === "sidebar" ? <Toolbar s={s} dispatch={act} /> : <TopBar s={s} dispatch={act} />}
            <Card s={s} dispatch={act} />
          </div>
        </div>
        <Palette s={s} dispatch={act} />
      </motion.div>
      </div>
      </LayoutGroup>
    </div>
  );
}

/** Lays out children at a fixed design size and zooms them down to fit narrower screens. */
export function Scaled({ w, h, children, className = "" }: { w: number; h: number; children: React.ReactNode; className?: string }) {
  const outer = useRef<HTMLDivElement>(null);
  const scale = useScale(outer, w);
  return (
    <div ref={outer} className={`w-full ${className}`} style={{ height: h * scale, maxWidth: w }}>
      <div className="text-left" style={{ zoom: scale, width: w, height: h }}>{children}</div>
    </div>
  );
}

export { Card as PageCard };
