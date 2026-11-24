"use client";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";
import { DemoWindow } from "@/demo/Window";
import { chapterState, demoReducer, type Chapter, type DemoAction } from "@/demo/state";
import { Reload } from "@/demo/Icons";

type Script = [number, DemoAction][];

/** A live Wing window that starts on one feature. With a script, it plays itself until the visitor touches it. */
export function LiveWindow({ chapter, hint, script }: { chapter: Chapter; hint: string; script?: Script }) {
  const [s, dispatch] = useReducer(demoReducer, chapter, chapterState);
  const [touched, setTouched] = useState(false);
  const [inView, setInView] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const onInteract = useCallback(() => setTouched(true), []);

  useEffect(() => {
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), { threshold: 0.5 });
    if (box.current) io.observe(box.current);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!script || touched || reduce || !inView) return;
    let i = 0;
    let t = 0;
    const next = () => {
      const [wait, action] = script[i % script.length];
      t = window.setTimeout(() => {
        dispatch(action);
        i++;
        next();
      }, wait);
    };
    next();
    return () => clearTimeout(t);
  }, [script, touched, reduce, inView]);

  const changed = JSON.stringify(s) !== JSON.stringify(chapterState(chapter));

  return (
    <div ref={box}>
      <DemoWindow state={s} dispatch={dispatch} onInteract={onInteract} />
      <div className="mt-5 flex items-center justify-center gap-2 text-[13px]">
        <span className="inline-flex items-center gap-2 rounded-full bg-white px-3.5 py-1.5 text-ink/75 shadow-[0_0_0_1px_rgba(0,0,0,0.07)]">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ink" />
          {touched || !script ? hint : "Playing on its own. Click anywhere to take over."}
        </span>
        {changed && (touched || !script) && (
          <button
            type="button"
            onClick={() => dispatch({ type: "tour", chapter })}
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-muted transition hover:bg-black/[0.05] hover:text-ink"
          >
            <Reload size={13} /> Reset
          </button>
        )}
      </div>
    </div>
  );
}
