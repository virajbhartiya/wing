"""Launch the native migration preview with a fresh, isolated test profile."""
import json
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parent.parent


def main():
    receipt = ROOT / "native/build/chromium-preview/latest.json"
    if not receipt.is_file():
        raise SystemExit("Build the preview first: npm run build:chromium-preview")
    build = json.loads(receipt.read_text())
    app = Path(build["app"]).resolve()
    if not app.is_relative_to(ROOT / "native/build/chromium-preview"):
        raise SystemExit("Preview receipt points outside the dedicated build directory.")
    executable = app / "Contents/MacOS/Wing Chromium Preview"
    if not build.get("qualificationOnly") or not executable.is_file():
        raise SystemExit("Invalid preview receipt; rebuild the native preview.")
    profile = tempfile.mkdtemp(prefix="wing-chromium-preview-")
    print(f"Isolated preview profile: {profile}", flush=True)
    print("Qualification preview: this uses a mock keychain. Do not store real credentials.", flush=True)
    environment = {**os.environ, "WING_CHROMIUM_TEST_PROFILE": profile}
    environment.pop("WING_CHROMIUM_TEST_SCRIPT", None)
    raise SystemExit(subprocess.call([str(executable)], env=environment))


if __name__ == "__main__":
    main()
