"use client";
import { motion } from "motion/react";
import { useRef, type Dispatch } from "react";
import { PAGES, SPACES } from "./data";
import type { DemoAction, DemoState } from "./state";
import { Archive, Back, Close, Forward, Globe, Plus, Puzzle, Reload, SidebarIcon, SplitIcon, Spark, Star } from "./Icons";

type Props = { s: DemoState; dispatch: Dispatch<DemoAction> };

export const TAB_MIME = "text/x-wing-tab";

function Lights() {
  return (
    <div className="flex gap-2">
      {[0, 1, 2].map((i) => (
        <span key={i} className="h-3 w-3 rounded-full bg-black/[0.13]" />
      ))}
    </div>
  );
}

export function Favicon({ id, dark = false }: { id: string; dark?: boolean }) {
  return (
    <span className={`grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[5px] text-[10px] font-semibold ${dark ? "bg-white/80 text-black/70 shadow-[0_0_0_0.5px_rgba(0,0,0,0.1)]" : "bg-white text-black shadow-[0_0_0_0.5px_rgba(0,0,0,0.12)]"}`}>
      {PAGES[id].glyph}
    </span>
  );
}

function IconButton({ children, label, onClick, active = false }: { children: React.ReactNode; label: string; onClick?: () => void; active?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`grid h-7 w-7 place-items-center rounded-md text-black/60 transition-colors duration-150 hover:bg-black/[0.08] hover:text-black ${active ? "bg-black/[0.1] text-black" : ""}`}
    >
      {children}
    </button>
  );
}

export function Toolbar({ s, dispatch, leading }: Props & { leading?: React.ReactNode }) {
  const id = s.active[s.space];
  return (
    <div className="flex h-11 items-center gap-1 px-2">
      {leading}
      <IconButton label="Back">
        <Back />
      </IconButton>
      <IconButton label="Forward">
        <Forward />
      </IconButton>
      <IconButton label="Reload">
        <Reload size={15} />
      </IconButton>
      <button
        type="button"
        onClick={() => dispatch({ type: "palette", open: true })}
        className="mx-auto flex h-[30px] w-[46%] min-w-[260px] items-center justify-center gap-2 rounded-lg bg-black/[0.07] text-[12.5px] text-black/75 transition-colors hover:bg-black/[0.1]"
      >
        <Globe size={13} />
        <motion.span key={id} initial={{ opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18 }}>
          {PAGES[id].host}
        </motion.span>
      </button>
      <IconButton label="Bookmark">
        <Star size={15} />
      </IconButton>
      <div className="relative">
        <IconButton label="Extensions">
          <Puzzle size={15} />
        </IconButton>
        {s.installed && (
          <motion.span
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", stiffness: 500, damping: 18 }}
            className="absolute -right-0.5 -top-0.5 grid h-3.5 w-3.5 place-items-center rounded-[4px] bg-black text-[8px] font-bold text-white"
          >
            Q
          </motion.span>
        )}
      </div>
      <IconButton label="Split view" active={!!s.split} onClick={() => dispatch(s.split ? { type: "unsplit" } : { type: "split", right: s.tabs[s.space].find((t) => t !== id) ?? id })}>
        <SplitIcon size={15} />
      </IconButton>
      <IconButton label="Move tabs" onClick={() => dispatch({ type: "layout", value: s.layout === "sidebar" ? "top" : "sidebar" })}>
        <Spark size={14} />
      </IconButton>
    </div>
  );
}

function TabRow({ id, s, dispatch }: Props & { id: string }) {
  const on = s.active[s.space] === id;
  return (
    <motion.div
      layout
      layoutId={`tab-${id}`}
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -8 }}
      transition={{ type: "spring", stiffness: 420, damping: 34 }}
      className="group relative"
    >
      <div
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(TAB_MIME, id);
          e.dataTransfer.effectAllowed = "move";
        }}
        onClick={() => dispatch({ type: "tab", id })}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && dispatch({ type: "tab", id })}
        className={`flex h-9 cursor-default items-center gap-2.5 rounded-lg px-2.5 text-[13px] transition-colors duration-150 ${on ? "bg-white text-black shadow-[0_1px_2px_rgba(0,0,0,0.08),0_0_0_0.5px_rgba(0,0,0,0.06)]" : "text-black/65 hover:bg-black/[0.06]"}`}
      >
        <Favicon id={id} dark={!on} />
        <span className="truncate">{PAGES[id].title}</span>
        <button
          type="button"
          aria-label={`Close ${PAGES[id].title}`}
          onClick={(e) => {
            e.stopPropagation();
            dispatch({ type: "close", id });
          }}
          className="ml-auto hidden h-5 w-5 shrink-0 place-items-center rounded text-black/50 hover:bg-black/10 group-hover:grid"
        >
          <Close size={12} />
        </button>
      </div>
    </motion.div>
  );
}

export function Sidebar({ s, dispatch }: Props) {
  const sp = SPACES[s.space];
  const wheel = useRef({ x: 0, at: 0 });
  return (
    <motion.div
      className="flex h-full w-[240px] shrink-0 flex-col px-2.5 pb-2.5"
      onWheel={(e) => {
        if (Math.abs(e.deltaX) < Math.abs(e.deltaY)) return;
        const w = wheel.current;
        const now = performance.now();
        if (now - w.at < 450) return;
        w.x += e.deltaX;
        if (Math.abs(w.x) > 60) {
          dispatch({ type: "space", index: s.space + Math.sign(w.x) });
          w.x = 0;
          w.at = now;
        }
      }}
      onPanEnd={(_, info) => {
        if (Math.abs(info.offset.x) > 50 && Math.abs(info.offset.x) > Math.abs(info.offset.y)) dispatch({ type: "space", index: s.space - Math.sign(info.offset.x) });
      }}
      style={{ touchAction: "pan-y" }}
    >
      <div className="flex h-11 items-center justify-between pl-1.5">
        <Lights />
        <IconButton label="Move tabs to the top" onClick={() => dispatch({ type: "layout", value: "top" })}>
          <SidebarIcon size={15} />
        </IconButton>
      </div>
      <motion.div key={s.space} initial={{ opacity: 0, x: 14 }} animate={{ opacity: 1, x: 0 }} transition={{ type: "spring", stiffness: 380, damping: 32 }} className="flex min-h-0 flex-1 flex-col">
        <div className="flex h-9 items-center gap-2 px-2 text-[13px] font-semibold text-black/90">
          <span className="text-black/60">{sp.glyph}</span>
          {sp.name}
        </div>
        <div className="mt-1 grid grid-cols-3 gap-1.5">
          {sp.favorites.map((f) => (
            <button
              key={f}
              type="button"
              aria-label={PAGES[f].title}
              onClick={() => dispatch({ type: "tab", id: f })}
              className={`grid h-11 place-items-center rounded-lg transition-colors ${s.active[s.space] === f ? "bg-white shadow-[0_1px_2px_rgba(0,0,0,0.08)]" : "bg-black/[0.06] hover:bg-black/[0.1]"}`}
            >
              <Favicon id={f} />
            </button>
          ))}
        </div>
        <div className="my-3 h-px bg-black/[0.08]" />
        <button type="button" onClick={() => dispatch({ type: "palette", open: true })} className="flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-[13px] text-black/50 hover:bg-black/[0.06]">
          <Plus size={14} /> New Tab <span className="ml-auto text-[11px] text-black/30">⌘T</span>
        </button>
        <div className="mt-1 flex flex-col gap-0.5">
          {s.tabs[s.space].map((id) => (
            <TabRow key={id} id={id} s={s} dispatch={dispatch} />
          ))}
        </div>
      </motion.div>
      <div className="mt-2 flex items-center gap-1 border-t border-black/[0.08] pt-2.5">
        <IconButton label="Archive">
          <Archive size={14} />
        </IconButton>
        <div className="mx-auto flex items-center gap-1">
          {SPACES.map((x, i) => (
            <button
              key={x.name}
              type="button"
              aria-label={`Switch to ${x.name}`}
              onClick={() => dispatch({ type: "space", index: i })}
              className={`relative flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] transition-colors ${i === s.space ? "text-black" : "text-black/40 hover:text-black/80"}`}
            >
              {i === s.space && <motion.span layoutId="space-pill" className="absolute inset-0 rounded-md bg-white shadow-[0_1px_2px_rgba(0,0,0,0.08)]" transition={{ type: "spring", stiffness: 500, damping: 36 }} />}
              <span className="relative">{x.glyph}</span>
              {i === s.space && <span className="relative font-medium">{x.name}</span>}
            </button>
          ))}
        </div>
        <IconButton label="New Space">
          <Plus size={14} />
        </IconButton>
      </div>
    </motion.div>
  );
}

export function TopBar({ s, dispatch }: Props) {
  return (
    <div>
      <Toolbar
        s={s}
        dispatch={dispatch}
        leading={
          <div className="mr-2 flex items-center gap-3 pl-2">
            <Lights />
            <IconButton label="Move tabs to the sidebar" onClick={() => dispatch({ type: "layout", value: "sidebar" })}>
              <SidebarIcon size={15} />
            </IconButton>
            <button
              type="button"
              onClick={() => dispatch({ type: "space", index: (s.space + 1) % SPACES.length })}
              className="flex h-7 items-center gap-1.5 rounded-md bg-black/[0.08] px-2.5 text-[12px] font-medium text-black/85 hover:bg-black/[0.12]"
            >
              {SPACES[s.space].glyph} {SPACES[s.space].name}
            </button>
          </div>
        }
      />
      <div className="flex h-9 items-center gap-1 px-2">
        {s.tabs[s.space].map((id) => {
          const on = s.active[s.space] === id;
          return (
            <motion.button
              layout
              key={id}
              type="button"
              draggable
              onDragStart={(e) => (e as unknown as React.DragEvent).dataTransfer?.setData(TAB_MIME, id)}
              onClick={() => dispatch({ type: "tab", id })}
              className={`flex h-7 min-w-0 flex-1 items-center justify-center gap-2 rounded-md px-3 text-[12px] transition-colors ${on ? "bg-white text-black shadow-[0_1px_2px_rgba(0,0,0,0.08)]" : "text-black/55 hover:bg-black/[0.06]"}`}
            >
              <Favicon id={id} dark={!on} />
              <span className="truncate">{PAGES[id].title}</span>
            </motion.button>
          );
        })}
        <IconButton label="New tab" onClick={() => dispatch({ type: "palette", open: true })}>
          <Plus size={14} />
        </IconButton>
      </div>
    </div>
  );
}
