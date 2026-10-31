"""Build/run a disposable AppKit host against a checksum-pinned ArdiaCore engine.

No user profiles, installed apps, or keychain items are read or modified.
Downloads ~104 MB; temporary build/profile files are removed on exit.
"""
import hashlib
import http.server
import json
import os
from pathlib import Path
import plistlib
import shutil
import signal
import subprocess
import tarfile
import tempfile
import threading
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parent.parent
VERSION = "0.2.40-nightly.8"
TREE = "6b96c16ab2ccc3b93ee28278ec0ed495aad7009a"
ENGINE_URL = f"https://github.com/mantrakp04/ardia/releases/download/v{VERSION}/ArdiaCore-{TREE[:12]}.tar.xz"
ENGINE_SHA = "f3a4b15b5254285b2d718040946e569971742d7a9c8378e55d78b6818889688c"
HEADER_URL = f"https://raw.githubusercontent.com/mantrakp04/ardia/v{VERSION}/engine/ardiacore/src/ardia/core/public/ArdiaCore.h"
HEADER_SHA = "2784940cd0af5300d1923827c3aa16ee554e09e93b440d4a8088ab51f65833c5"
UBO_URL = "https://github.com/gorhill/uBlock/releases/download/1.75.0/uBlock0_1.75.0.chromium.zip"
COOKIE_URL = "https://raw.githubusercontent.com/uBlockOrigin/uAssets/77cb1ef921d8acab50ac5881fbb0692ce7a7d800/thirdparties/easylist-cookies.txt"
COOKIE_SHA = "f57aef05a78461e56de1469b192ce3afaa887c1d7cb8103b81d32d5685e535f6"
UBO_COMPONENT_KEY = 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAv1MPdIgJjIsN4Y0N/20GDNPfN4J//aknk5dsH8Y1LBxSnz3Jp/BT187Gub5cv6lee5CUVDmVBa3Yiqow8GMna5KwX+ZP+yc1pt/ewzyNxm2BzoQPgWz+1DgZaahz56/szi1EEtWVYxd3wNxFN4wPDqwV6aqlnV4R3RnxlF1ocw1kDgJ+8BxR1EY+MB+H8bymdef+xB3TNifBZIVmZt81cC3UMOG6KWRTU1wtIXsW+ZqSv5zaeFHLkjG4MPB7EfcMGrvO80ElJBZZLdrTmYOL4uUPsz2Wy6GiPWzpDmzzI9RfsZm11sLiJo63blcPF0Cz3sM0wQfxJPPcQuqkZDReswIDAQAB'
UBO_SHA = "393cf95709d1074d4022970e9014e434395c53a822387f1e25f43be97cf4b582"


def download(url, destination, expected):
    print(f"Fetching {url}", flush=True)
    with urllib.request.urlopen(url, timeout=60) as response, destination.open("wb") as output:
        shutil.copyfileobj(response, output)
    if hashlib.sha256(destination.read_bytes()).hexdigest() != expected:
        raise RuntimeError(f"Checksum mismatch: {destination.name}")


def run(*args):
    result = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if result.returncode:
        raise RuntimeError(f"{args[0]} exited {result.returncode}: {result.stderr.decode(errors='replace')}")


def main():
    report = {"engineSource": ENGINE_URL, "engineSHA256": ENGINE_SHA, "headerSHA256": HEADER_SHA,
              "extensionSource": UBO_URL, "extensionSHA256": UBO_SHA, "scenarios": []}
    with tempfile.TemporaryDirectory(prefix="wing-ardiacore-ubo-") as directory:
        work = Path(directory)
        archive = work / "engine.tar.xz"
        cached = ROOT / "native/vendor/ardiacore/ArdiaCore-6b96c16ab2cc.tar.xz"
        if cached.exists() and hashlib.sha256(cached.read_bytes()).hexdigest() == ENGINE_SHA:
            shutil.copy2(cached, archive)
        else:
            download(ENGINE_URL, archive, ENGINE_SHA)
        with tarfile.open(archive) as source:
            source.extractall(work, filter="data")
        download(HEADER_URL, work / "ArdiaCore.h", HEADER_SHA)
        cached_ubo = ROOT / "native/vendor/ardiacore/uBlock0_1.75.0.chromium.zip"
        if cached_ubo.exists() and hashlib.sha256(cached_ubo.read_bytes()).hexdigest() == UBO_SHA:
            shutil.copy2(cached_ubo, work / "ubo.zip")
        else:
            download(UBO_URL, work / "ubo.zip", UBO_SHA)
        with zipfile.ZipFile(work / "ubo.zip") as source:
            for name in source.namelist():
                if Path(name).is_absolute() or ".." in Path(name).parts:
                    raise RuntimeError("Unsafe extension archive")
            source.extractall(work / "ubo")
        manifest_path = work / "ubo/uBlock0.chromium/manifest.json"
        manifest = json.loads(manifest_path.read_text())
        manifest["key"] = UBO_COMPONENT_KEY
        manifest_path.write_text(json.dumps(manifest,indent=2))
        report["extensionPackaging"] = "Only manifest key added, required by Chromium ComponentLoader; all uBO code and filter assets unchanged. Public key from pinned Ardia ubo.sh."
        download(COOKIE_URL,work / "cookies.txt",COOKIE_SHA)
        cookie_list = (work / "cookies.txt").read_bytes()
        report["cookieList"] = {"source":COOKIE_URL,"sha256":COOKIE_SHA,"delivery":"Official list served over local fixture HTTP, imported via uBO dashboard; no user filter imitates its rules."}
        app = work / "Wing Engine Qualification.app"
        contents = app / "Contents"
        (contents / "MacOS").mkdir(parents=True)
        (contents / "Frameworks").mkdir()
        framework = contents / "Frameworks" / "Chromium Framework.framework"
        shutil.move(work / "Chromium Framework.framework", framework)
        binary = framework / "Versions/Current/Chromium Framework"
        executable = contents / "MacOS/Qualification"
        run("xcrun", "clang++", "-std=c++20", "-O2", "-arch", "arm64", "-mmacosx-version-min=14.0", "-fobjc-arc",
            "-I" + str(work), str(ROOT / "scripts/ardiacore-ubo-host.mm"), str(binary), "-framework", "AppKit", "-o", str(executable))
        with (contents / "Info.plist").open("wb") as output:
            plistlib.dump({"CFBundleExecutable":"Qualification", "CFBundleIdentifier":"org.wingbrowser.EngineQualification",
                "CFBundleName":"Wing Engine Qualification", "CFBundlePackageType":"APPL", "CFBundleVersion":"1",
                "CFBundleShortVersionString":"1.0", "LSMinimumSystemVersion":"14.0", "LSBackgroundOnly":True,
                "NSHighResolutionCapable":True, "NSSupportsAutomaticGraphicsSwitching":True}, output)
        entitlements = work / "test-entitlements.plist"
        with entitlements.open("wb") as output:
            plistlib.dump({"com.apple.security.cs.allow-jit":True,"com.apple.security.cs.disable-library-validation":True}, output)
        # Ad-hoc signing applies solely to this disposable test bundle; sandbox stays on.
        for item in (framework / "Versions/Current/Libraries").glob("*.dylib"):
            run("codesign", "--force", "--timestamp=none", "--options", "runtime", "--sign", "-", str(item))
        helpers = framework / "Versions/Current/Helpers"
        for item in helpers.iterdir():
            if item.is_file() or item.suffix == ".app":
                run("codesign", "--force", "--timestamp=none", "--options", "runtime", "--sign", "-", "--entitlements", str(entitlements), str(item))
        for item in [framework, app]:
            run("codesign", "--force", "--timestamp=none", "--options", "runtime", "--sign", "-", "--entitlements", str(entitlements), str(item))
        run("codesign", "--verify", "--deep", "--strict", str(app))
        seen = []

        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self, *_args):
                pass

            def do_GET(self):
                seen.append({"host":self.headers.get("Host"),"path":self.path})
                self.send_response(200)
                if self.path == "/cookies.txt":
                    self.send_header("Content-Type", "text/plain")
                    body = cookie_list
                elif self.path == "/image.svg":
                    self.send_header("Content-Type", "image/svg+xml")
                    body = b'<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'
                else:
                    self.send_header("Content-Type", "text/html")
                    body = ("<!doctype html><title>Wing fixture</title><div id=wing-fixture-ad>Ad</div><div id=cookie-banner>Cookie notice</div><script>window.results={};"
                            "for(const [key,host] of [['ad','doubleclick.net'],['control','wing-safe.invalid']]){"
                            "const i=new Image();i.onload=()=>results[key]='loaded';i.onerror=()=>results[key]='blocked';"
                            f"i.src='http://'+host+':{self.server.server_port}/image.svg';"
                            "}</script>").encode()
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

        with http.server.ThreadingHTTPServer(("127.0.0.1",0),Handler) as server:
            thread = threading.Thread(target=server.serve_forever,daemon=True)
            thread.start()
            try:
                for enabled,mode in [(False,""),(True,""),(True,"configure"),(True,"persisted")]:
                    seen.clear()
                    output = work / f"report-{enabled}.json"
                    env = {**os.environ,"WING_UBO_PROFILE":str(work / f"profile-{enabled}"),"WING_UBO_MODE":mode,"WING_UBO_COOKIE_URL":f"http://127.0.0.1:{server.server_port}/cookies.txt",
                        "WING_UBO_EXTENSION":str(work / "ubo/uBlock0.chromium") if enabled else "",
                        "WING_UBO_URL":f"http://wing-fixture.invalid:{server.server_port}/fixture","WING_UBO_REPORT":str(output)}
                    child = subprocess.Popen([str(executable)],env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True)
                    try:
                        stdout,stderr = child.communicate(timeout=35)
                    except subprocess.TimeoutExpired:
                        os.killpg(child.pid,signal.SIGTERM)
                        try: stdout,stderr = child.communicate(timeout=5)
                        except subprocess.TimeoutExpired:
                            os.killpg(child.pid,signal.SIGKILL)
                            stdout,stderr = child.communicate()
                    process = subprocess.CompletedProcess(child.args,child.returncode,stdout,stderr)
                    result = json.loads(output.read_text()) if output.exists() else {"error":"No report produced"}
                    result.update(enabled=enabled,mode=mode,exitCode=process.returncode,stderr=process.stderr.decode(errors="replace")[-16000:],seen=list(seen))
                    report["scenarios"].append(result)
                    print(json.dumps(result,indent=2),flush=True)
            finally:
                server.shutdown()
        for scenario in report["scenarios"]:
            value = scenario.get("evaluation")
            for _ in range(2):
                if isinstance(value,str):
                    try: value=json.loads(value)
                    except ValueError: break
            scenario["results"] = value
        a,b,c,d=report["scenarios"]
        report["networkPassed"] = a.get("results",{}).get("ad")=="loaded" and b.get("results",{}).get("ad")=="blocked" and all(x.get("results",{}).get("control")=="loaded" for x in [a,b])
        report["cosmeticPassed"] = a.get("results",{}).get("cosmeticDisplay")=="block" and c.get("results",{}).get("cosmeticDisplay")=="none"
        report["exceptionPassed"] = b.get("results",{}).get("ad")=="blocked" and c.get("results",{}).get("ad")=="loaded"
        report["cookieListPassed"] = a.get("results",{}).get("cookieDisplay")=="block" and c.get("results",{}).get("cookieDisplay")=="none"
        report["persistencePassed"] = c.get("results")==d.get("results") and json.loads(d.get("filterSettings","{}" )).get("content")==json.loads(c.get("filterSettings","{}" )).get("content")
        report["passed"] = all(report[k] for k in ["networkPassed","cosmeticPassed","exceptionPassed","cookieListPassed","persistencePassed"]) and all(x["exitCode"]==0 for x in report["scenarios"])
        report["scope"] = "Network/cosmetic/cookie-list/exception/persistence spike with full uBlock Origin; only component identity manifest key added. Not Wing integration, real-site cookie coverage, update qualification, or a production release."
        (ROOT / "docs/full-ubo-ardiacore-qualification.json").write_text(json.dumps(report,indent=2)+"\n")
        return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
