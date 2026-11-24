"use client";
import { useRelease } from "@/lib/useRelease";
import { formatSize, RELEASES_URL, type Build } from "@/lib/releases";
import { Apple, WindowsLogo } from "./Brand";
import { DownloadButtons } from "./DownloadButton";

const KIND: Record<Build["kind"], string> = { dmg: "Disk image (.dmg)", zip: "Zip archive", setup: "Installer (.exe)" };
const LINK = "underline decoration-black/25 underline-offset-4 hover:text-ink";

function Row({ build }: { build: Build }) {
  return (
    <a href={build.url} download className="group flex items-center justify-between gap-4 border-t border-black/[0.06] px-5 py-3.5 text-[14px] transition hover:bg-black/[0.03]">
      <span>{KIND[build.kind]}</span>
      <span className="flex items-center gap-4 text-muted">
        <span>{build.version}</span>
        <span className="max-sm:hidden">{formatSize(build.size)}</span>
        <span aria-hidden="true" className="text-ink/70 transition group-hover:translate-y-0.5 group-hover:text-ink">↓</span>
      </span>
    </a>
  );
}

function Card({ title, note, icon, builds, early = false }: { title: string; note: string; icon: React.ReactNode; builds: Build[]; early?: boolean }) {
  const releases = [...new Map(builds.map((build) => [build.releaseUrl, build])).values()];
  return (
    <div className="overflow-hidden rounded-2xl border border-black/[0.07] bg-white">
      <div className="flex items-start gap-3 px-5 pb-4 pt-5">
        <span className="mt-0.5 text-ink/80">{icon}</span>
        <div>
          <div className="flex items-center gap-2 text-[16px] font-medium">
            {title}
            {early && <span className="rounded-full border border-black/15 px-2 py-px text-[11px] font-normal text-muted">Early</span>}
          </div>
          <div className="text-[13px] text-muted">{note}</div>
        </div>
      </div>
      {builds.length ? (
        <>
          {builds.map((build) => <Row key={build.kind} build={build} />)}
          <ul className="space-y-1.5 border-t border-black/[0.06] px-5 py-3 text-[13px] text-muted">
            {releases.map((build) => (
              <li key={build.releaseUrl} className="flex flex-wrap gap-x-4 gap-y-1">
                <a href={build.releaseUrl} className={LINK}>{build.version} release notes</a>
                {build.checksumUrl ? (
                  <a href={build.checksumUrl} className={LINK} aria-label={`SHA-256 checksums for ${title} ${build.version}`}>
                    SHA-256 checksums
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="border-t border-black/[0.06] px-5 py-3.5 text-[14px] text-muted">No build is available for this platform.</p>
      )}
    </div>
  );
}

export function BuildTable() {
  const release = useRelease();
  const buildsFor = (os: Build["os"], arch: Build["arch"]) =>
    release.builds.filter((build) => build.os === os && build.arch === arch)
      .sort((a, b) => Number(a.kind === "zip") - Number(b.kind === "zip"));
  return (
    <div className="mx-auto max-w-[920px]">
      <div className="text-center">
        <h1 className="font-display text-[clamp(44px,7vw,88px)] font-semibold leading-[0.95] tracking-[-0.05em]">Download Wing</h1>
        <p className="mt-5 text-[16px] text-muted">
          Latest release {release.version} ·{" "}
          <a href={release.url} className={LINK}>
            Release notes
          </a>
        </p>
        <div className="mt-10">
          <DownloadButtons />
        </div>
      </div>

      <div className="mt-20 grid gap-4 md:grid-cols-2">
        <Card title="Mac · Apple Silicon" note="M1 and later · macOS 14 or newer" icon={<Apple className="h-5 w-5" />} builds={buildsFor("mac", "arm64")} />
        <Card title="Mac · Intel" note="macOS 14 or newer · hardware testing pending" icon={<Apple className="h-5 w-5" />} builds={buildsFor("mac", "x64")} />
        <Card title="Windows · x64" note="Windows 10 and 11" icon={<WindowsLogo className="h-5 w-5" />} builds={buildsFor("windows", "x64")} early />
        <Card title="Windows · Arm" note="Snapdragon and other Arm PCs" icon={<WindowsLogo className="h-5 w-5" />} builds={buildsFor("windows", "arm64")} early />
      </div>

      <div className="mt-16 grid gap-10 md:grid-cols-2">
        <div>
          <h2 className="text-[18px] font-medium">Installing on a Mac</h2>
          <ol className="mt-4 space-y-2.5 text-[14px] leading-6 text-muted">
            <li>1. Open the disk image or extract the zip, then move Wing to Applications.</li>
            <li>2. Open Wing. macOS may block this first launch because the build has yet to be notarized by Apple.</li>
            <li>3. Verify your download, then use System Settings → Privacy &amp; Security → Open Anyway. <a href="https://support.apple.com/en-us/102445" className={LINK}>Apple’s instructions</a></li>
          </ol>
        </div>
        <div>
          <h2 className="text-[18px] font-medium">Installing on Windows</h2>
          <ol className="mt-4 space-y-2.5 text-[14px] leading-6 text-muted">
            <li>1. Run the installer, or extract the portable zip and open Wing.exe.</li>
            <li>2. The preview is unsigned. If SmartScreen prompts after you verify the file, use More info → Run anyway where available.</li>
            <li>3. Download newer Windows previews manually. See the matching release notes for feature availability.</li>
          </ol>
        </div>
      </div>

      <div className="mt-16 rounded-2xl border border-black/[0.07] bg-white p-6 text-[14px] leading-6 text-muted">
        <span className="text-ink">Check your download.</span> Compare the hash of the exact file you downloaded against the checksum linked for your platform and version. Use <code className="font-mono text-[12.5px] text-ink/80">shasum -a 256 &lt;file&gt;</code> on Mac or <code className="font-mono text-[12.5px] text-ink/80">Get-FileHash -Algorithm SHA256 &lt;file&gt;</code> in PowerShell. Older versions are on{" "}
        <a href={RELEASES_URL} className={LINK}>
          GitHub Releases
        </a>
        .
      </div>
    </div>
  );
}
