import copy
import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from chromium_distribution import verify_qualification

class ChromiumDistributionTest(unittest.TestCase):
    def setUp(self):
        self.receipt = {'kind':'wing-source', 'binarySHA256':'qualified-engine'}
        self.inputs = {'native/chromium/main.mm':'qualified-host'}
        self.report = {'passed':True, 'engine':self.receipt, 'hostInputs':self.inputs,
                       'scenarios':[{'phase':phase, 'passed':True, 'exitCode':0,
                                     'sourceProfilePreserved':True, 'privateWorkspaceFile':True}
                                    for phase in ('initial','restart')]}
    def test_exact_qualified_engine_and_host_can_stage(self):
        verify_qualification(self.report, self.receipt, self.inputs)
    def test_prebuilt_engine_cannot_stage_persistent_profiles(self):
        with self.assertRaises(RuntimeError):
            verify_qualification(self.report, {'kind':'upstream-prebuilt'}, self.inputs)
    def test_changed_host_or_engine_requires_requalification(self):
        with self.assertRaises(RuntimeError):
            verify_qualification(self.report, self.receipt, {'native/chromium/main.mm':'changed'})
        with self.assertRaises(RuntimeError):
            verify_qualification(self.report, {**self.receipt,'binarySHA256':'changed'}, self.inputs)
    def test_incomplete_restart_or_unsafe_persistence_blocks_staging(self):
        for field, value in [('passed',False),('exitCode',2),('privateWorkspaceFile',False),('sourceProfilePreserved',False)]:
            report = copy.deepcopy(self.report)
            report['scenarios'][1][field] = value
            with self.subTest(field=field), self.assertRaises(RuntimeError):
                verify_qualification(report, self.receipt, self.inputs)
