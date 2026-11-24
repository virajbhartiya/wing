import { describe, expect, it } from "vitest";
import { chapterState, CHAPTERS, demoReducer, initialState, paletteResults, type DemoState } from "./state";

const run = (s: DemoState, ...actions: Parameters<typeof demoReducer>[1][]) => actions.reduce(demoReducer, s);

describe("demoReducer", () => {
  it("keeps each Space's own active tab", () => {
    const s = run(initialState, { type: "tab", id: "review" }, { type: "space", index: 1 }, { type: "space", index: 0 });
    expect(s.space).toBe(0);
    expect(s.active[0]).toBe("review");
    expect(s.active[1]).toBe("article");
  });
  it("clamps Space switches", () => {
    expect(run(initialState, { type: "space", index: 9 }).space).toBe(2);
    expect(run(initialState, { type: "space", index: -3 }).space).toBe(0);
  });
  it("switches Space when a tab from another Space is chosen", () => {
    const s = run(initialState, { type: "tab", id: "music" });
    expect(s.space).toBe(1);
    expect(s.active[1]).toBe("music");
  });
  it("filters the palette and resets the selection", () => {
    const s = run(initialState, { type: "palette", open: true }, { type: "paletteMove", delta: 2 }, { type: "query", value: "DASH" });
    expect(s.palette.index).toBe(0);
    expect(paletteResults(s)[0].title).toBe("Launch dashboard");
  });
  it("wraps the palette selection", () => {
    const s = run(initialState, { type: "palette", open: true }, { type: "paletteMove", delta: -1 });
    expect(s.palette.index).toBe(paletteResults(s).length - 1);
  });
  it("opens the selected result and closes the palette", () => {
    const s = run(initialState, { type: "palette", open: true }, { type: "query", value: "noodles" }, { type: "paletteOpenSelected" });
    expect(s.palette.open).toBe(false);
    expect(s.space).toBe(1);
    expect(s.active[1]).toBe("recipe");
  });
  it("promotes Peek into a tab", () => {
    const s = run(initialState, { type: "peek", page: "changelog" }, { type: "promotePeek" });
    expect(s.peek).toBeNull();
    expect(s.active[0]).toBe("changelog");
    expect(s.tabs[0]).toContain("changelog");
  });
  it("clamps the split divider", () => {
    const s = run(initialState, { type: "split", right: "dash" });
    expect(run(s, { type: "splitRatio", ratio: 0.05 }).split?.ratio).toBe(0.25);
    expect(run(s, { type: "splitRatio", ratio: 0.99 }).split?.ratio).toBe(0.75);
  });
  it("lands every tour chapter on the same state whatever came before", () => {
    const messy = run(initialState, { type: "space", index: 2 }, { type: "palette", open: true }, { type: "peek", page: "changelog" }, { type: "layout", value: "top" });
    for (const c of CHAPTERS) expect(demoReducer(messy, { type: "tour", chapter: c })).toEqual(chapterState(c));
  });
});
