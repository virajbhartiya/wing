"""Sample macOS resource usage for an isolated benchmark process tree."""

import ctypes as C
from math import ceil
from statistics import median
from threading import Event, Thread
from time import monotonic, monotonic_ns, time_ns


def main_display_refresh_rate():
    quartz = C.CDLL("/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics")
    quartz.CGMainDisplayID.restype = C.c_uint32
    quartz.CGDisplayCopyDisplayMode.argtypes = [C.c_uint32]
    quartz.CGDisplayCopyDisplayMode.restype = C.c_void_p
    quartz.CGDisplayModeGetRefreshRate.argtypes = [C.c_void_p]
    quartz.CGDisplayModeGetRefreshRate.restype = C.c_double
    quartz.CGDisplayModeRelease.argtypes = [C.c_void_p]
    quartz.CGDisplayModeRelease.restype = None
    mode = quartz.CGDisplayCopyDisplayMode(quartz.CGMainDisplayID())
    if not mode:
        return None
    try:
        return quartz.CGDisplayModeGetRefreshRate(mode) or None
    finally:
        quartz.CGDisplayModeRelease(mode)


class CGRect(C.Structure):
    _fields_ = [(key, C.c_double) for key in ("x", "y", "width", "height")]


class WindowProbe:
    def __init__(self):
        quartz = C.CDLL("/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics")
        cf = C.CDLL("/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation")
        ptr = C.c_void_p
        self.windows = quartz.CGWindowListCopyWindowInfo
        self.windows.argtypes, self.windows.restype = [C.c_uint32, C.c_uint32], ptr
        self.rect = quartz.CGRectMakeWithDictionaryRepresentation
        self.rect.argtypes, self.rect.restype = [ptr, C.POINTER(CGRect)], C.c_bool
        self.count = cf.CFArrayGetCount
        self.count.argtypes, self.count.restype = [ptr], C.c_long
        self.item = cf.CFArrayGetValueAtIndex
        self.item.argtypes, self.item.restype = [ptr, C.c_long], ptr
        self.get = cf.CFDictionaryGetValue
        self.get.argtypes, self.get.restype = [ptr, ptr], ptr
        self.number = cf.CFNumberGetValue
        self.number.argtypes, self.number.restype = [ptr, C.c_long, ptr], C.c_bool
        self.release = cf.CFRelease
        self.release.argtypes, self.release.restype = [ptr], None
        self.owner, self.layer, self.bounds = (
            ptr.in_dll(quartz, name) for name in
            ("kCGWindowOwnerPID", "kCGWindowLayer", "kCGWindowBounds")
        )
        self.visible_at = None
        self.finished = Event()

    def has_window(self, windows, pid):
        number, rect = C.c_int(), CGRect()
        for index in range(self.count(windows)):
            window = self.item(windows, index)
            owner = self.get(window, self.owner)
            # kCFNumberIntType is 9. Limit the check to windows of the app.
            if not owner or not self.number(owner, 9, C.byref(number)) or number.value != pid:
                continue
            layer = self.get(window, self.layer)
            bounds = self.get(window, self.bounds)
            if (layer and self.number(layer, 9, C.byref(number)) and number.value == 0
                    and bounds and self.rect(bounds, C.byref(rect))
                    and rect.width >= 150 and rect.height >= 150):
                return True
        return False

    def collect(self, pid):
        while not self.finished.is_set():
            # kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements.
            windows = self.windows(1 | 16, 0)
            if not windows:
                return
            try:
                if self.has_window(windows, pid):
                    self.visible_at = monotonic()
                    return
            finally:
                self.release(windows)
            self.finished.wait(0.02)

    def start(self, pid):
        self.thread = Thread(target=self.collect, args=(pid,), daemon=True)
        self.thread.start()

    def stop(self):
        self.finished.set()
        self.thread.join()


class Rusage(C.Structure):
    _fields_ = [("uuid", C.c_uint8 * 16)] + [
        (name, C.c_uint64) for name in (
            "user_ns", "system_ns", "package_wakeups", "interrupt_wakeups",
            "pageins", "wired_bytes", "resident_bytes", "footprint_bytes",
            "start_abstime", "exit_abstime",
        )
    ]


class ProcessSampler:
    def __init__(self, pid):
        self.pid = pid
        self.libproc = C.CDLL("/usr/lib/libproc.dylib")
        self.libproc.proc_listchildpids.argtypes = [C.c_int, C.c_void_p, C.c_int]
        self.libproc.proc_pid_rusage.argtypes = [C.c_int, C.c_int, C.c_void_p]
        self.finished = Event()
        self.thread = Thread(target=self.collect, daemon=True)
        self.samples = []

    def snapshot(self):
        usage = {}
        pending = [self.pid]
        seen = set()
        children = (C.c_int * 1024)()
        while pending:
            pid = pending.pop()
            if pid in seen:
                continue
            seen.add(pid)
            count = self.libproc.proc_listchildpids(pid, children, C.sizeof(children))
            pending.extend(child for child in children[:max(0, count)] if child > 0)
            stat = Rusage()
            if self.libproc.proc_pid_rusage(pid, 0, C.byref(stat)) == 0:
                usage[(pid, stat.start_abstime)] = stat
        return usage

    def collect(self):
        previous_time = monotonic_ns()
        previous_wall = time_ns() / 1e6
        previous = self.snapshot()
        while not self.finished.wait(0.25):
            now = monotonic_ns()
            wall = time_ns() / 1e6
            current = self.snapshot()
            elapsed = (now - previous_time) / 1e9
            stable = current.keys() & previous.keys()
            if stable:
                cpu = sum(
                    current[key].user_ns + current[key].system_ns
                    - previous[key].user_ns - previous[key].system_ns for key in stable
                )
                wakeups = sum(current[key].interrupt_wakeups - previous[key].interrupt_wakeups
                              for key in stable)
                footprint = sum(stat.footprint_bytes for stat in current.values())
                self.samples.append((previous_wall, wall, 100 * cpu / (elapsed * 1e9),
                                     wakeups / elapsed, footprint / (2 ** 20), len(current)))
            previous, previous_time, previous_wall = current, now, wall

    def start(self):
        self.thread.start()

    def stop(self):
        self.finished.set()
        self.thread.join()

    def summarize(self, start_ms, end_ms):
        samples = [sample for sample in self.samples if start_ms <= sample[0] and sample[1] <= end_ms]
        if not samples:
            return {"samples": 0}
        _, _, cpu, wakeups, footprint, processes = zip(*samples)
        return {
            "samples": len(samples),
            "medianCpuPercentOneCore": round(median(cpu), 2),
            "p95CpuPercentOneCore": round(sorted(cpu)[ceil(0.95 * len(cpu)) - 1], 2),
            "maxCpuPercentOneCore": round(max(cpu), 2),
            "medianInterruptWakeupsPerSecond": round(median(wakeups), 2),
            "medianPhysicalFootprintMiB": round(median(footprint), 2),
            "medianProcessCount": median(processes),
        }
