"use client";
import { motion, useReducedMotion } from "motion/react";
import { DownloadButtons } from "./DownloadButton";
import { LiveWindow } from "./LiveWindow";
import type { DemoAction } from "@/demo/state";

const SCRIPT: [number, DemoAction][] = [
  [1800, { type: "space", index: 1 }],
  [1600, { type: "space", index: 2 }],
  [1600, { type: "space", index: 0 }],
  [1400, { type: "palette", open: true }],
  ...[..."dash"].map((_, i): [number, DemoAction] => [160, { type: "query", value: "dash".slice(0, i + 1) }]),
  [800, { type: "paletteOpenSelected" }],
  [1800, { type: "split", right: "docs" }],
  [2600, { type: "unsplit" }],
  [1000, { type: "peek", page: "changelog" }],
  [2400, { type: "closePeek" }],
  [1400, { type: "tour", chapter: "hero" }],
];

export function Hero() {
  const reduce = useReducedMotion();
  const rise = (d: number) => ({
    initial: reduce ? { opacity: 0 } : { opacity: 0, y: 18 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.7, delay: d, ease: [0.2, 0.7, 0.2, 1] as const },
  });
  return (
    <section className="relative px-5 pb-24 pt-36 text-center sm:pt-44">
      <motion.div {...rise(0)} className="mb-7 inline-flex items-center gap-2 rounded-full bg-white px-3.5 py-1.5 text-[13px] text-ink/75 shadow-[0_0_0_1px_rgba(0,0,0,0.07)]">
        <span className="rounded-full bg-ink px-1.5 py-px text-[10.5px] font-semibold text-white">Free</span>
        Open-source browser for Mac
      </motion.div>
      <motion.h1 {...rise(0.06)} className="mx-auto max-w-[980px] font-display text-[clamp(46px,8.4vw,112px)] font-semibold leading-[0.95] tracking-[-0.05em]">
        A calmer way
        <br /> to browse.
      </motion.h1>
      <motion.p {...rise(0.14)} className="mx-auto mt-7 max-w-[560px] text-[clamp(16px,1.5vw,19px)] leading-[1.55] text-muted">
        Spaces, split view and Peek in a native Chromium browser for Mac. Try them in the interactive demo below.
      </motion.p>
      <motion.div {...rise(0.22)} className="mt-10">
        <DownloadButtons />
      </motion.div>
      <motion.div
        initial={reduce ? { opacity: 0 } : { opacity: 0, y: 60, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 1, delay: 0.35, ease: [0.2, 0.7, 0.2, 1] }}
        className="relative mx-auto mt-20 max-w-[1200px]"
      >
        <div className="pointer-events-none absolute -inset-x-4 -bottom-10 top-[18%] -z-10 rounded-[40px] bg-[linear-gradient(180deg,#e7e6ee,#ece8e1)] sm:-inset-x-10" />
        <div className="pointer-events-none absolute -inset-x-4 -bottom-10 top-[18%] -z-10 rounded-[40px] bg-[radial-gradient(rgba(0,0,0,0.06)_1px,transparent_1px)] [background-size:18px_18px] [mask-image:linear-gradient(transparent,black_30%,black_70%,transparent)] sm:-inset-x-10" />
        <LiveWindow chapter="hero" hint="Press ⌘K · shift-click a link · drag a tab onto the page" script={SCRIPT} />
      </motion.div>
    </section>
  );
}
