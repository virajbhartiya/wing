import { PAGES, SPACES } from "./data";

export type Layout = "sidebar" | "top";
export const CHAPTERS = ["hero", "spaces", "palette", "split", "peek", "extensions", "calls", "layout"] as const;
export type Chapter = (typeof CHAPTERS)[number];

export type DemoState = {
  space: number;
  tabs: string[][];
  active: string[];
  layout: Layout;
  split: null | { left: string; right: string; ratio: number };
  peek: null | { page: string };
  palette: { open: boolean; query: string; index: number };
  share: boolean;
  installed: boolean;
};

export type DemoAction =
  | { type: "space"; index: number }
  | { type: "tab"; id: string }
  | { type: "open"; page: string }
  | { type: "close"; id: string }
  | { type: "palette"; open: boolean }
  | { type: "query"; value: string }
  | { type: "paletteMove"; delta: number }
  | { type: "paletteOpenSelected" }
  | { type: "peek"; page: string }
  | { type: "promotePeek" }
  | { type: "closePeek" }
  | { type: "split"; right: string }
  | { type: "splitRatio"; ratio: number }
  | { type: "unsplit" }
  | { type: "layout"; value: Layout }
  | { type: "share"; open: boolean }
  | { type: "install" }
  | { type: "tour"; chapter: Chapter };

export type Result = { id: string; title: string; sub: string; kind: "tab" | "space" | "action"; action: DemoAction };

export const initialState: DemoState = {
  space: 0,
  tabs: SPACES.map((s) => [...s.tabs]),
  active: SPACES.map((s) => s.tabs[0]),
  layout: "sidebar",
  split: null,
  peek: null,
  palette: { open: false, query: "", index: 0 },
  share: false,
  installed: false,
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function spaceOf(s: DemoState, id: string) {
  const i = s.tabs.findIndex((t) => t.includes(id));
  if (i >= 0) return i;
  const fav = SPACES.findIndex((sp) => sp.favorites.includes(id));
  return fav >= 0 ? fav : s.space;
}

function setActive(s: DemoState, space: number, id: string): DemoState {
  const tabs = s.tabs.map((t, i) => (i === space && !t.includes(id) ? [...t, id] : t));
  const active = s.active.map((a, i) => (i === space ? id : a));
  return { ...s, space, tabs, active, split: space === s.space ? s.split : null, peek: null };
}

export function paletteResults(s: DemoState): Result[] {
  const all: Result[] = [
    ...s.tabs.flatMap((ids, si) =>
      ids.map((id): Result => ({ id, title: PAGES[id].title, sub: `${SPACES[si].name} · ${PAGES[id].host}`, kind: "tab", action: { type: "tab", id } })),
    ),
    ...SPACES.map((sp, i): Result => ({ id: `space-${i}`, title: `Switch to ${sp.name}`, sub: "Space", kind: "space", action: { type: "space", index: i } })),
    { id: "split", title: "Split view", sub: "Action · ⌃⌘\\", kind: "action", action: { type: "split", right: "dash" } },
    { id: "layout", title: s.layout === "sidebar" ? "Move tabs to the top" : "Move tabs to the sidebar", sub: "Action · ⌥⌘S", kind: "action", action: { type: "layout", value: s.layout === "sidebar" ? "top" : "sidebar" } },
  ];
  const q = s.palette.query.trim().toLowerCase();
  if (!q) return all.slice(0, 7);
  return all.filter((r) => r.title.toLowerCase().includes(q) || r.sub.toLowerCase().includes(q)).slice(0, 7);
}

export function chapterState(c: Chapter): DemoState {
  const base = { ...initialState, tabs: initialState.tabs.map((t) => [...t]), active: [...initialState.active] };
  switch (c) {
    case "hero":
      return base;
    case "spaces":
      return { ...base, space: 1 };
    case "palette":
      return { ...base, palette: { open: true, query: "", index: 0 } };
    case "split":
      return { ...base, split: { left: "docs", right: "dash", ratio: 0.5 } };
    case "peek":
      return { ...base, peek: { page: "changelog" } };
    case "extensions":
      return { ...base, space: 2, active: [base.active[0], base.active[1], "store"] };
    case "calls":
      return { ...base, space: 2, active: [base.active[0], base.active[1], "call"], share: true };
    case "layout":
      return { ...base, layout: "top", active: ["dash", base.active[1], base.active[2]] };
  }
}

export function demoReducer(s: DemoState, a: DemoAction): DemoState {
  switch (a.type) {
    case "space": {
      const space = clamp(a.index, 0, SPACES.length - 1);
      return space === s.space ? s : { ...s, space, split: null, peek: null, share: false };
    }
    case "tab":
    case "open": {
      const id = a.type === "tab" ? a.id : a.page;
      const space = a.type === "tab" ? spaceOf(s, id) : s.space;
      return { ...setActive(s, space, id), share: false };
    }
    case "close": {
      const t = s.tabs[s.space];
      if (t.length <= 1) return s;
      const rest = t.filter((x) => x !== a.id);
      const active = s.active[s.space] === a.id ? rest[Math.max(0, t.indexOf(a.id) - 1)] : s.active[s.space];
      return { ...s, tabs: s.tabs.map((x, i) => (i === s.space ? rest : x)), active: s.active.map((x, i) => (i === s.space ? active : x)), split: null };
    }
    case "palette":
      return { ...s, palette: { open: a.open, query: "", index: 0 } };
    case "query":
      return { ...s, palette: { ...s.palette, query: a.value, index: 0 } };
    case "paletteMove": {
      const n = paletteResults(s).length;
      if (!n) return s;
      return { ...s, palette: { ...s.palette, index: (((s.palette.index + a.delta) % n) + n) % n } };
    }
    case "paletteOpenSelected": {
      const r = paletteResults(s)[s.palette.index];
      const closed = { ...s, palette: { open: false, query: "", index: 0 } };
      return r ? demoReducer(closed, r.action) : closed;
    }
    case "peek":
      return { ...s, peek: { page: a.page }, palette: { ...s.palette, open: false } };
    case "promotePeek":
      return s.peek ? setActive(s, s.space, s.peek.page) : s;
    case "closePeek":
      return { ...s, peek: null };
    case "split": {
      const left = s.active[s.space];
      const right = a.right === left ? s.tabs[s.space].find((t) => t !== left) ?? a.right : a.right;
      return { ...s, split: { left, right, ratio: 0.5 }, peek: null };
    }
    case "splitRatio":
      return s.split ? { ...s, split: { ...s.split, ratio: clamp(a.ratio, 0.25, 0.75) } } : s;
    case "unsplit":
      return { ...s, split: null };
    case "layout":
      return { ...s, layout: a.value };
    case "share":
      return { ...s, share: a.open };
    case "install":
      return { ...s, installed: true };
    case "tour":
      return chapterState(a.chapter);
  }
}
