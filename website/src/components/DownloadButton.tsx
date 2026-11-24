"use client";
import Link from "next/link";
import { useRecommended } from "@/lib/useRelease";
import { DOWNLOAD_PAGE, recommended } from "@/lib/releases";
import { Apple, WindowsLogo } from "./Brand";

const pill = "inline-flex items-center justify-center gap-2.5 rounded-full font-medium transition duration-200 ease-wing active:scale-[0.97]";

/** The main button for the visitor's machine, plus the other platform next to it. */
export function DownloadButtons({ compact = false }: { compact?: boolean }) {
  const r = useRecommended();
  const onWindows = r.platform.os === "windows";
  const macHref = recommended(r.release, { os: "mac", arch: r.platform.os === "mac" ? r.platform.arch : "arm64" }).href;
  const winHref = recommended(r.release, { os: "windows", arch: onWindows ? r.platform.arch : "x64" }).href;
  const size = compact ? "h-11 px-5 text-[14px]" : "h-[52px] px-7 text-[15px]";
  const primary = `${pill} ${size} bg-ink text-white shadow-[0_8px_24px_-8px_rgba(0,0,0,0.45)] hover:-translate-y-0.5 hover:shadow-[0_14px_30px_-10px_rgba(0,0,0,0.5)]`;
  const secondary = `${pill} ${size} bg-white text-ink shadow-[0_0_0_1px_rgba(0,0,0,0.1)] hover:-translate-y-0.5 hover:shadow-[0_0_0_1px_rgba(0,0,0,0.2),0_10px_24px_-12px_rgba(0,0,0,0.3)]`;
  const macBtn = (
    <a key="mac" href={macHref} download className={onWindows ? secondary : primary}>
      <Apple className="h-[18px] w-[18px]" /> Download for Mac
    </a>
  );
  const winBtn = (
    <a key="win" href={winHref} download={winHref !== DOWNLOAD_PAGE} className={onWindows ? primary : secondary}>
      <WindowsLogo className="h-4 w-4" /> {onWindows ? "Download for Windows" : "Windows"}
      <span className="rounded-full bg-current/10 px-1.5 text-[11px] opacity-70">early</span>
    </a>
  );
  return <div className="flex flex-wrap items-center justify-center gap-3">{onWindows ? [winBtn, macBtn] : [macBtn, winBtn]}</div>;
}

export function NavDownload() {
  const r = useRecommended();
  const href = r.href;
  const cls = `${pill} h-8 bg-ink px-3.5 text-[13px] text-white hover:bg-black`;
  return href === DOWNLOAD_PAGE ? (
    <Link href={href} className={cls}>
      Download
    </Link>
  ) : (
    <a href={href} download className={cls}>
      Download
    </a>
  );
}
