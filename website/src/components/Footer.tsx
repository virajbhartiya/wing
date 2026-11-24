import Link from "next/link";
import { GitHub, Mark } from "./Brand";

export function Footer() {
  return (
    <footer className="border-t border-black/[0.06] px-6 py-12 text-[13px] text-muted">
      <div className="mx-auto flex max-w-[1200px] flex-wrap items-center gap-x-8 gap-y-4">
        <span className="flex items-center gap-2 font-semibold text-ink">
          <Mark className="h-4 w-4" /> Wing
        </span>
        <Link href="/download/" className="hover:text-ink">Download</Link>
        <a href="https://github.com/virajbhartiya/wing/releases" className="hover:text-ink">Releases</a>
        <a href="https://github.com/virajbhartiya/wing/issues" className="hover:text-ink">Report a problem</a>
        <a href="https://github.com/virajbhartiya/wing" className="flex items-center gap-1.5 hover:text-ink">
          <GitHub className="h-3.5 w-3.5" /> Source
        </a>
        <span className="ml-auto max-sm:ml-0">Free software under GPL-3.0.</span>
      </div>
    </footer>
  );
}
