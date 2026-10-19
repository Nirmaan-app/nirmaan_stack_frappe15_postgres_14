"""CU-B AC2 (a): tests never write the real capture log (extraction._capture_path under frappe.flags.in_test)."""
import os
import tempfile
from unittest import mock

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.services.boq_rate_master import extraction

REAL = os.path.join(frappe.utils.get_bench_path(), "logs", extraction.CAPTURE_FILENAME)


def _size(path):
    return os.path.getsize(path) if os.path.exists(path) else 0


class TestCaptureGuard(FrappeTestCase):

    def test_the_test_flag_is_set_under_the_bench_runner(self):
        # Guards the premise the guard rests on: `bench run-tests` sets frappe.flags.in_test.
        self.assertTrue(frappe.flags.in_test)

    def test_under_tests_the_capture_goes_to_a_temp_file_never_the_real_log(self):
        path = extraction._capture_path()
        self.assertNotEqual(os.path.realpath(path), os.path.realpath(REAL))
        self.assertTrue(path.startswith(tempfile.gettempdir()))
        self.addCleanup(lambda: os.path.exists(path) and os.remove(path))
        before = _size(REAL)
        self.assertEqual(extraction._capture_write({"probe": "CU-B AC2a"}), path)
        self.assertEqual(_size(REAL), before, "the real capture log gained nothing")
        with open(path, encoding="utf-8") as fh:
            self.assertIn("CU-B AC2a", fh.read())

    def test_without_the_flag_the_real_logs_path_is_used(self):
        # Negative: outside tests the bench logs directory is the target (patched to a temp bench here).
        bench = tempfile.mkdtemp()
        os.makedirs(os.path.join(bench, "logs"))
        self.addCleanup(lambda: __import__("shutil").rmtree(bench, True))
        with mock.patch.dict(extraction.frappe.flags, {"in_test": False}), \
                mock.patch.object(extraction.frappe.utils, "get_bench_path", return_value=bench):
            self.assertEqual(extraction._capture_path(), os.path.join(bench, "logs", extraction.CAPTURE_FILENAME))
