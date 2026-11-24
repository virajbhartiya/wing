import Link from "next/link";
import { Mark } from "./Brand";
import { DownloadButtons } from "./DownloadButton";

export function FinalCta() {
  return (
    <section className="px-5 py-32 text-center sm:py-40">
      <div className="mx-auto grid h-24 w-24 place-items-center rounded-[26px] bg-gradient-to-b from-[#2b2d33] to-[#111214] text-white shadow-[0_24px_60px_-18px_rgba(0,0,0,0.55),inset_0_1px_0_rgba(255,255,255,0.15)]">
        <Mark className="h-12 w-12" />
      </div>
      <h2 className="mt-10 font-display text-[clamp(44px,8vw,104px)] font-semibold leading-[0.95] tracking-[-0.055em]">Get Wing.</h2>
      <p className="mx-auto mt-5 max-w-[440px] text-[17px] leading-7 text-muted">Free for Mac, with an early build for Windows.</p>
      <div className="mt-10">
        <DownloadButtons />
      </div>
      <p className="mx-auto mt-8 max-w-[480px] text-[12.5px] leading-5 text-muted">
        Mac builds have yet to be notarized by Apple. See the first-launch steps and choose the build for your machine.{" "}
        <Link href="/download/" className="underline decoration-black/25 underline-offset-4 hover:text-ink">
          Install help
        </Link>
      </p>
    </section>
  );
}
