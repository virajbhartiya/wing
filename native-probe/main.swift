// A deliberately small AppKit/WebKit feasibility and lifecycle probe.
// It is not a second browser and does not claim feature parity with Wing.
import AppKit
import WebKit
import Darwin

final class WeakWebView {
    weak var value: WKWebView?
    init(_ value: WKWebView) { self.value = value }
}

@MainActor
final class Probe: NSObject, WKNavigationDelegate {
    var continuation: CheckedContinuation<Void, Never>?
    let store = WKWebsiteDataStore.nonPersistent()
    var latencies: [Double] = []
    var samples: [[String: Any]] = []
    let started = CFAbsoluteTimeGetCurrent()

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        continuation?.resume(); continuation = nil
    }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        fputs("WebKit probe failed: \(error)\n", stderr); exit(1)
    }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        fputs("WebKit probe failed: \(error)\n", stderr); exit(1)
    }
    func mainRSSMB() -> Double {
        var info = mach_task_basic_info()
        var count = mach_msg_type_number_t(MemoryLayout<mach_task_basic_info>.size / MemoryLayout<natural_t>.size)
        let result = withUnsafeMutablePointer(to: &info) {
            $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
                task_info(mach_task_self_, task_flavor_t(MACH_TASK_BASIC_INFO), $0, &count)
            }
        }
        return result == KERN_SUCCESS ? Double(info.resident_size) / 1048576 : -1
    }
    func sample(_ label: String, retained: Int) {
        samples.append(["label": label, "atMs": Int((CFAbsoluteTimeGetCurrent()-started)*1000), "retainedWKWebViews": retained, "hostRSSMB": mainRSSMB()])
    }
    func load() async -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = store
        let view = WKWebView(frame: NSRect(x:0,y:0,width:800,height:600), configuration: configuration)
        view.navigationDelegate = self
        let start = CFAbsoluteTimeGetCurrent()
        await withCheckedContinuation { (c: CheckedContinuation<Void,Never>) in
            continuation = c
            view.loadHTMLString("<!doctype html><title>Wing lifecycle fixture</title><style>body{font:16px system-ui;background:#ddd5eb}</style><h1>Deterministic lifecycle fixture</h1><p>Real WebKit rendering, isolated session, no network.</p>", baseURL:nil)
        }
        latencies.append((CFAbsoluteTimeGetCurrent()-start)*1000)
        return view
    }
    func run() async {
        var warm: WKWebView? = await load()
        warm?.navigationDelegate = nil; warm = nil
        try? await Task.sleep(nanoseconds: 2_000_000_000)
        latencies=[]; sample("warm baseline", retained:0)
        for batch in 1...6 {
            var views: [WKWebView] = []
            var references: [WeakWebView] = []
            for _ in 0..<10 {
                let view = await load(); views.append(view); references.append(WeakWebView(view))
            }
            sample("batch \(batch): 10 live pages", retained:references.filter{$0.value != nil}.count)
            for view in views { view.stopLoading(); view.navigationDelegate=nil; view.uiDelegate=nil; view.removeFromSuperview() }
            views.removeAll()
            try? await Task.sleep(nanoseconds: 1_200_000_000)
            let remaining=references.filter{$0.value != nil}.count
            sample("batch \(batch): references released", retained:remaining)
            if remaining != 0 { fputs("Unexpected retained WKWebView objects: \(remaining)\n",stderr);exit(1) }
            references.removeAll()
        }
        try? await Task.sleep(nanoseconds: 3_000_000_000)
        sample("idle end",retained:0);latencies.sort()
        let report: [String:Any] = ["date":ISO8601DateFormatter().string(from:Date()),"platform":"macOS AppKit + WKWebView","os":ProcessInfo.processInfo.operatingSystemVersionString,"cycles":60,"loadLatencyMs":["median":latencies[30],"p95":latencies[57]],"samples":samples,"limitations":["Host RSS excludes WebKit networking/GPU/content XPC processes. Do not compare it with Electron total working set.","Unattached views and a static local document do not measure smoothness or normal web browsing.","WebKit process reuse differs from Chromium. This is feasibility evidence, not an engine ranking.","Weak references returning to nil prove WKWebView object release, not that all WebKit caches or subprocess allocations are gone."]]
        do {
            let data=try JSONSerialization.data(withJSONObject:report,options:[.prettyPrinted,.sortedKeys])
            let output=CommandLine.arguments.dropFirst().first ?? "docs/webkit-probe.json"
            try data.write(to:URL(fileURLWithPath:output),options:.atomic)
            print(String(data:data,encoding:.utf8)!)
        } catch {fputs("\(error)\n",stderr);exit(1)}
        NSApplication.shared.terminate(nil)
    }
}
let application=NSApplication.shared
application.setActivationPolicy(.prohibited)
Task { @MainActor in let probe=Probe(); await probe.run() }
application.run()
