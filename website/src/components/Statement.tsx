"use client";
import { motion, useScroll, useTransform, type MotionValue } from "motion/react";
import { useRef } from "react";

const TEXT = "Most browsers turned into a pile of tabs. Wing gives every part of your life its own room, keeps your calls alive, and stays out of your way.";

function Word({ word, i, n, p }: { word: string; i: number; n: number; p: MotionValue<number> }) {
  const opacity = useTransform(p, [i / n, (i + 1) / n], [0.14, 1]);
  return (
    <motion.span style={{ opacity }} className="inline-block whitespace-pre">
      {word}{" "}
    </motion.span>
  );
}

/** A statement that fills in word by word as you scroll through it. */
export function Statement() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 0.85", "end 0.45"] });
  const words = TEXT.split(" ");
  return (
    <section className="px-5 py-32 sm:py-44">
      <div ref={ref} className="mx-auto max-w-[1040px] font-display text-[clamp(30px,4.6vw,60px)] font-semibold leading-[1.08] tracking-[-0.04em]">
        {words.map((w, i) => (
          <Word key={i} word={w} i={i} n={words.length} p={scrollYProgress} />
        ))}
      </div>
    </section>
  );
}
