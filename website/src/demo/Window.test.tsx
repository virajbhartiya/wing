import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

afterEach(cleanup);
import { useReducer } from "react";
import { DemoWindow } from "./Window";
import { demoReducer, initialState } from "./state";

beforeAll(() => {
  // jsdom has no IntersectionObserver: report every observed window as fully on screen.
  globalThis.IntersectionObserver = class {
    constructor(private cb: IntersectionObserverCallback) {}
    observe(el: Element) {
      this.cb([{ target: el, isIntersecting: true, intersectionRatio: 1 } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
    }
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  } as unknown as typeof IntersectionObserver;
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
});

function Harness() {
  const [s, d] = useReducer(demoReducer, initialState);
  return (
    <>
      <DemoWindow state={s} dispatch={d} />
      <output data-testid="active">{`${s.space}:${s.active[s.space]}`}</output>
    </>
  );
}

const key = (k: string, opts: KeyboardEventInit = {}, target: EventTarget = window) => act(() => void target.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, ...opts })));

describe("DemoWindow", () => {
  it("opens the palette with ⌘K, filters, and opens the result", async () => {
    render(<Harness />);
    key("k", { metaKey: true });
    const input = await screen.findByLabelText("Search tabs, Spaces and actions");
    fireEvent.change(input, { target: { value: "dash" } });
    const palette = input.closest('[role="dialog"]') as HTMLElement;
    expect(within(palette).getByRole("button", { name: /Launch dashboard/ })).toBeTruthy();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByTestId("active").textContent).toBe("0:dash");
  });
  it("doesn't treat typing in the palette as shortcuts", async () => {
    render(<Harness />);
    key("k", { metaKey: true });
    const input = await screen.findByLabelText("Search tabs, Spaces and actions");
    key("2", { ctrlKey: true }, input);
    expect(screen.getByTestId("active").textContent).toBe("0:docs");
  });
  it("Peeks on shift-click and closes on Escape", async () => {
    render(<Harness />);
    const link = document.querySelector('[data-link="changelog"]')!;
    fireEvent.click(link, { shiftKey: true });
    expect(await screen.findByRole("dialog", { name: "Peek" })).toBeTruthy();
    key("Escape");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Peek" })).toBeNull(), { timeout: 3000 });
  });
});
