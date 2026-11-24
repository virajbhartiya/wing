import Link from "next/link";
import { GitHub, Mark } from "./Brand";
import { NavDownload } from "./DownloadButton";

export function Nav() {
  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-black/[0.05] bg-paper/80 backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-[1200px] items-center gap-7 px-5">
        <Link href="/" className="flex items-center gap-2 text-[16px] font-semibold tracking-tight">
          <Mark className="h-[18px] w-[18px]" /> Wing
        </Link>
        <nav className="flex gap-6 text-[14px] text-muted max-sm:hidden">
          <Link href="/#spaces" className="hover:text-ink">Features</Link>
          <Link href="/#open-source" className="hover:text-ink">Open source</Link>
          <Link href="/download/" className="hover:text-ink">Download</Link>
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <a href="https://github.com/virajbhartiya/wing" className="grid h-8 w-8 place-items-center rounded-full text-muted transition hover:bg-black/[0.05] hover:text-ink" aria-label="Wing on GitHub">
            <GitHub />
          </a>
          <NavDownload />
        </div>
      </div>
    </header>
  );
}
