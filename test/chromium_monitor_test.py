import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('monitor', Path(__file__).resolve().parent.parent / 'scripts/monitor-chromium.py')
monitor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(monitor)


class ChromiumMonitor(unittest.TestCase):
    def test_reads_latest_progress_after_warnings(self):
        with tempfile.TemporaryDirectory() as directory:
            log = Path(directory) / 'build.log'
            log.write_text('[2/100] 3.4s F CXX first.o\n[3/99] 1h2m3.4s S CXX next.o\nwarning: sample\n')
            self.assertEqual(monitor.latest_progress(log), {
                'completed': 3, 'total': 99, 'elapsed': '1h2m3.4s', 'step': 'CXX next.o'})

    def test_live_build_is_not_reported_complete(self):
        self.assertIsNone(monitor.outcome({'stage':'compile','state':'running'}, True))

    def test_exit_without_final_status_is_reported(self):
        self.assertEqual(monitor.outcome({'stage':'compile','state':'running'}, False)[0], 'stopped')

    def test_failure_survives_process_exit(self):
        self.assertEqual(monitor.outcome({'stage':'qualify','state':'failed'}, False)[0], 'failed')

    def test_staged_build_does_not_claim_signed_release(self):
        result = monitor.outcome({'stage':'stage-production','state':'passed'}, False)
        self.assertEqual(result[0], 'passed')
        self.assertIn('signing is separate', result[1])
