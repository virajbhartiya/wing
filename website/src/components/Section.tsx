"use client";
import { motion, useReducedMotion } from "motion/react";

/** A feature: copy on one side, its interactive close-up on the other. */
export function Section({ id, eyebrow, title, body, children, reverse = false, stacked = false }: { id?: string; eyebrow: string; title: string; body: string; children: React.ReactNode; reverse?: boolean; stacked?: boolean }) {
  const reduce = useReducedMotion();
  const rise = (y: number, d = 0) => ({
    initial: reduce ? { opacity: 0 } : { opacity: 0, y },
    whileInView: { opacity: 1, y: 0 },
    viewport: { once: true, margin: "-80px" },
    transition: { duration: 0.8, delay: d, ease: [0.2, 0.7, 0.2, 1] as const },
  });
  const copy = (
    <motion.div {...rise(20)} className={stacked ? "mx-auto max-w-[720px] text-center" : "lg:max-w-[400px]"}>
      <div className="text-[13px] font-medium uppercase tracking-[0.16em] text-muted">{eyebrow}</div>
      <h2 className="mt-4 font-display text-[clamp(34px,4.6vw,58px)] font-semibold leading-[1] tracking-[-0.045em]">{title}</h2>
      <p className={`mt-5 text-[17px] leading-[1.6] text-muted ${stacked ? "mx-auto max-w-[540px]" : ""}`}>{body}</p>
    </motion.div>
  );
  return (
    <section id={id} className="px-5 py-20 sm:py-28">
      <div className={`mx-auto max-w-[1280px] ${stacked ? "" : `grid items-center gap-12 lg:gap-16 ${reverse ? "lg:grid-cols-[1fr_380px]" : "lg:grid-cols-[380px_1fr]"}`}`}>
        <div className={reverse && !stacked ? "lg:order-2" : ""}>{copy}</div>
        <motion.div {...rise(40, 0.1)} className={`min-w-0 ${stacked ? "mt-14" : ""}`}>
          {children}
        </motion.div>
      </div>
    </section>
  );
}
