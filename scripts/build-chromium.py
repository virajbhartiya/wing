"""Build the pinned Chromium framework with Wing-owned product identity.

Run prepare-chromium.py --sync first. This reproduces the upstream engine;
it does not alter an installed browser. Wing owns the bundle, keychain and CDM
namespace. Signing, notarization and distribution qualification remain separate.
"""
import argparse
import fcntl
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
sys.path.insert(0, str(Path(__file__).resolve().parent))
from chromium_identity import apply_identity, configure_args, apply_host_api
from chromium_artifact import write_receipt

ROOT = Path(__file__).resolve().parent.parent
BUILD = Path(os.environ.get("WING_CHROMIUM_BUILD", ROOT.parent / (ROOT.name + "-chromium-build")))
PINS = json.loads(Path(os.environ.get("WING_CHROMIUM_SOURCES", ROOT / "native/chromium-sources.json")).read_text())


def run(command, env, cwd=ROOT):
    print("Running:", " ".join(map(str, command)), flush=True)
    child = subprocess.Popen(command, env=env, cwd=cwd, start_new_session=True)
    try:
        while True:
            if shutil.disk_usage(BUILD).free < 15 * 1024**3:
                raise RuntimeError("Stopped to preserve 15 GiB of disk reserve.")
            try:
                code = child.wait(timeout=2)
                if code:
                    raise RuntimeError(f"Build stage exited {code}")
                return
            except subprocess.TimeoutExpired:
                pass
    finally:
        if child.poll() is None:
            os.killpg(child.pid, signal.SIGTERM)
            try:
                child.wait(timeout=10)
            except subprocess.TimeoutExpired:
                os.killpg(child.pid, signal.SIGKILL)
                child.wait()


def omit_search_data_stub(source):
    """Git creates an empty directory for this intentionally omitted gitlink."""
    directory = source / "third_party/search_engines_data/resources_internal"
    if directory.is_symlink():
        raise RuntimeError("Refusing a linked omitted dependency.")
    if directory.exists():
        if any(directory.iterdir()):
            raise RuntimeError("Internal search data was downloaded; preserve it outside the source tree before patching.")
        directory.rmdir()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("stage", choices=["patch", "configure", "compile"])
    parser.add_argument("--jobs", type=int, default=2)
    parser.add_argument("--arch", choices=["arm64", "x64"], default="arm64")
    args = parser.parse_args()
    if not 1 <= args.jobs <= 4:
        parser.error("Use 1–4 compile jobs on this local recipe.")
    if BUILD.resolve() != BUILD or not (BUILD / ".wing-source-root").is_file():
        raise RuntimeError("Missing dedicated source root; run prepare-chromium.py --sync.")
    synced = BUILD / ".wing-source-synced"
    if not synced.exists() or synced.read_text().strip() != PINS["chromium"]["commit"]:
        raise RuntimeError("Pinned Chromium sync/hooks have not completed.")
    upstream = BUILD / "ardia"
    revision = subprocess.check_output(["git", "-C", str(upstream), "rev-parse", "HEAD"], text=True).strip()
    if revision != PINS["ardia"]["commit"]:
        raise RuntimeError("Upstream patch checkout does not match the manifest.")
    env = {**os.environ, "AC_CHROMIUM_BUILD": str(BUILD), "AC_REPO": str(upstream),
           "DEPOT_TOOLS_UPDATE": "0", "DEPOT_TOOLS_METRICS": "0",
           "PATH": str(BUILD / "depot_tools") + os.pathsep + os.environ["PATH"],
           "JOBS": str(args.jobs), "KEEP_GOING": "1", "TARGETS": "chrome_framework"}
    scripts = upstream / "engine/patches/build"
    locked = [str(upstream / "scripts/agent/locked"), "chromium", "--as", "wing-candidate", "--"]
    out_name = f"Release_GN_{args.arch}"
    with (BUILD / ".lock").open("w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        patched = BUILD / ".wing-patches-applied"
        if args.stage == "patch":
            if patched.exists():
                raise RuntimeError("Patch stages already completed; refusing to apply them again.")
            omit_search_data_stub(BUILD / "chromium_git/chromium/src")
            run(locked + ["python3", str(scripts / "03-helium.py"), "--apply"], env)
            run(locked + ["bash", str(scripts / "04-series.sh"), "--apply"], env)
            patched.write_text(PINS["ardia"]["commit"] + "\n")
        elif not patched.exists():
            raise RuntimeError("Run the patch stage first.")
        elif args.stage == "configure":
            if not (BUILD / "depot_tools/python3_bin_reldir.txt").exists():
                run([str(BUILD / "depot_tools/ensure_bootstrap")], env)
            source = BUILD / "chromium_git/chromium/src"
            apply_identity(source, os.environ.get("WING_DEVELOPER_TEAM_ID", ""))
            apply_host_api(source)
            output = source / "out/Release_GN_arm64"
            if args.arch == "arm64":
                run(locked + ["bash", str(scripts / "02-gn-args.sh"), "--apply"], env)
                configure_args(output / "args.gn")
            else:
                # Upstream's scripts only know arm64: same arguments, another CPU and folder.
                arm64_args = (output / "args.gn").read_text()
                if 'target_cpu="arm64"' not in arm64_args:
                    raise RuntimeError("Upstream arguments no longer name the arm64 target.")
                output = source / "out" / out_name
                output.mkdir(exist_ok=True)
                (output / "args.gn").write_text(arm64_args.replace('target_cpu="arm64"', f'target_cpu="{args.arch}"'))
            run(locked + ["gn", "gen", f"out/{out_name}"], env, cwd=source)
        else:
            if not (BUILD / "chromium_git/chromium/src/out" / out_name / "build.ninja").is_file():
                raise RuntimeError("Run the configure stage first.")
            metal = subprocess.run(["xcrun", "metal", "--version"], capture_output=True, text=True)
            if metal.returncode:
                raise RuntimeError("Metal compiler unavailable; install it with xcodebuild -downloadComponent MetalToolchain before compiling.")
            source = BUILD / "chromium_git/chromium/src"
            receipt = BUILD / ("wing-build-receipt.json" if args.arch == "arm64" else f"wing-build-receipt-{args.arch}.json")
            receipt.unlink(missing_ok=True)
            if args.arch == "arm64":
                run(locked + ["bash", str(scripts / "05-build.sh"), "--apply"], env)
            else:
                run(locked + ["autoninja", "-j", str(args.jobs), "-k", "1", "-C", f"out/{out_name}", "chrome_framework"], env, cwd=source)
            write_receipt(source, receipt, args.arch)


if __name__ == "__main__":
    main()
