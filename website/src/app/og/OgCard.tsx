"use client";
import { useReducer } from "react";
import { DemoWindow } from "@/demo/Window";
import { chapterState, demoReducer } from "@/demo/state";
import { Mark } from "@/components/Brand";

/** The 1200×630 share card. scripts/og-image.mjs screenshots this page into public/og.png. */
export function OgCard() {
  const [s, dispatch] = useReducer(demoReducer, { ...chapterState("palette"), palette: { open: true, query: "north", index: 0 } });
  return (
    <div id="og" className="relative h-[630px] w-[1200px] overflow-hidden bg-paper text-ink">
      <div className="absolute inset-0 bg-[radial-gradient(rgba(0,0,0,0.07)_1px,transparent_1px)] [background-size:18px_18px] [mask-image:radial-gradient(80%_80%_at_70%_60%,black,transparent)]" />
      <div className="absolute inset-0 bg-[radial-gradient(60%_70%_at_0%_0%,rgba(255,255,255,0.9),transparent_70%)]" />
      <div className="absolute left-[72px] top-[68px] z-10 w-[470px]">
        <div className="flex items-center gap-3 text-[30px] font-semibold tracking-tight">
          <span className="grid h-12 w-12 place-items-center rounded-[13px] bg-ink text-white">
            <Mark className="h-7 w-7" />
          </span>
          Wing
        </div>
        <h1 className="mt-16 font-display text-[78px] font-semibold leading-[0.95] tracking-[-0.05em]">
          A calmer way
          <br />
          to browse.
        </h1>
        <p className="mt-7 text-[23px] leading-[1.45] text-muted">Free, open-source browser for Mac. Spaces, split view and Peek on Chromium.</p>
        <div className="mt-9 flex gap-2.5 text-[16px] font-medium">
          {["Open source", "Chrome extensions", "Apple Silicon"].map((t) => (
            <span key={t} className="rounded-full bg-white px-3.5 py-1.5 shadow-[0_0_0_1px_rgba(0,0,0,0.08)]">
              {t}
            </span>
          ))}
        </div>
      </div>
      <div className="absolute left-[585px] top-[96px] w-[800px] [&>div]:!h-auto">
        <DemoWindow state={s} dispatch={dispatch} />
      </div>
    </div>
  );
}
