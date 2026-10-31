"""Prepare pinned engine sources in Wing's dedicated ignored build directory.

Without --sync, fetches only build tools and patch sources. --sync additionally
fetches Chromium/dependencies and runs their hooks. Never resets or deletes an
existing checkout. This prepares source; it does not build or install a browser.
"""
import argparse
import fcntl
import json
import os
from pathlib import Path
import platform
import shutil
import signal
import subprocess
import time

ROOT = Path(__file__).resolve().parent.parent
BUILD = ROOT.parent / (ROOT.name + "-chromium-build")
PINS = json.loads((ROOT / "native/chromium-sources.json").read_text())
RESERVE = 15 * 1024**3


def run(args, cwd, env=None):
    print("Running:", " ".join(map(str, args)), flush=True)
    child = subprocess.Popen(args, cwd=cwd, env=env, start_new_session=True)
    try:
        while child.poll() is None:
            if shutil.disk_usage(BUILD).free < RESERVE:
                raise RuntimeError("Stopped: preserving 15 GiB of free disk space.")
            time.sleep(2)
        if child.returncode:
            raise RuntimeError(f"Command exited {child.returncode}: {args[0]}")
    finally:
        if child.poll() is None:
            os.killpg(child.pid, signal.SIGTERM)
            try:
                child.wait(timeout=10)
            except subprocess.TimeoutExpired:
                os.killpg(child.pid, signal.SIGKILL)
                child.wait()


def git_value(directory, *args):
    return subprocess.check_output(["git", "-C", str(directory), *args], text=True).strip()


def checkout(name):
    pin, destination = PINS[name], BUILD / name
    if destination.exists():
        if destination.is_symlink() or not (destination / ".git").is_dir():
            raise RuntimeError(f"Refusing unrecognized source directory: {destination}")
        if git_value(destination, "remote", "get-url", "origin") != pin["url"]:
            raise RuntimeError(f"Source remote differs for {name}")
        if git_value(destination, "status", "--porcelain"):
            raise RuntimeError(f"Preserving local changes in {destination}")
        head = subprocess.run(["git", "-C", str(destination), "rev-parse", "--verify", "HEAD"], capture_output=True, text=True)
        if head.returncode and not (destination / ".git/HEAD").is_file():
            raise RuntimeError(f"Invalid repository: {destination}")
        if not head.returncode and head.stdout.strip() != pin["commit"]:
            raise RuntimeError(f"Existing {name} is not at its pinned commit")
        if not head.returncode:
            return
    else:
        destination.mkdir()
        run(["git", "init", "--quiet"], destination)
        run(["git", "remote", "add", "origin", pin["url"]], destination)
    run(["git", "fetch", "--depth=1", "origin", pin["commit"]], destination)
    run(["git", "-c", "advice.detachedHead=false", "checkout", "FETCH_HEAD"], destination)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sync", action="store_true")
    args = parser.parse_args()
    if platform.system() != "Darwin" or platform.machine() != "arm64":
        raise RuntimeError("This source recipe targets macOS arm64.")
    if BUILD.resolve() != BUILD:
        raise RuntimeError("Build directory must not traverse symlinks.")
    if BUILD.exists() and not (BUILD / ".wing-source-root").is_file():
        raise RuntimeError("Existing directory lacks Wing's ownership marker.")
    BUILD.mkdir(parents=True, exist_ok=True)
    (BUILD / ".wing-source-root").touch()
    with (BUILD / ".lock").open("w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        free = shutil.disk_usage(BUILD).free / 1024**3
        print(f"Dedicated source root: {BUILD}; {free:.1f} GiB free", flush=True)
        if free < (65 if args.sync else 16):
            raise RuntimeError("Insufficient space with build and system reserve.")
        for name in ["depot_tools", "helium", "helium-macos", "ardia"]:
            checkout(name)
        if not args.sync:
            return
        if (BUILD / ".wing-patches-applied").exists():
            raise RuntimeError("Preserving patched Chromium source; sync requires a fresh source root.")
        workspace = BUILD / "chromium_git/chromium"
        workspace.mkdir(parents=True, exist_ok=True)
        pin = PINS["chromium"]
        config = "solutions = " + repr([{
            "managed": False, "name": "src", "url": pin["url"] + "@" + pin["commit"],
            "custom_vars": {"checkout_pgo_profiles": True, "source_tarball": False},
            "custom_deps": {"src/third_party/search_engines_data/resources_internal": None}, "deps_file": "DEPS", "safesync_url": ""
        }]) + "\ntarget_os = ['mac']\n"
        gclient = workspace / ".gclient"
        if gclient.exists() and gclient.read_text() != config:
            raise RuntimeError("Refusing to replace an existing gclient configuration.")
        gclient.write_text(config)
        env = {**os.environ, "DEPOT_TOOLS_UPDATE": "0", "DEPOT_TOOLS_METRICS": "0",
               "PATH": str(BUILD / "depot_tools") + os.pathsep + os.environ["PATH"]}
        run([str(BUILD / "depot_tools/ensure_bootstrap")], BUILD, env)
        run(["gclient", "sync", "--no-history", "--nohooks", "-j", "4"], workspace, env)
        if git_value(workspace / "src", "rev-parse", "HEAD") != pin["commit"]:
            raise RuntimeError("Chromium revision does not match manifest.")
        run(["gclient", "runhooks"], workspace, env)
        (BUILD / ".wing-source-synced").write_text(pin["commit"] + "\n")
        print("Pinned sources ready. No engine patches or build have run.")


if __name__ == "__main__":
    main()
