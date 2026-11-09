"""Tests devenv_schema.py: does an env need a migrate before a test run? No bench, no DB, no network.

Run: python3 -I scripts/devenv/test_devenv_schema.py
"""

from __future__ import annotations

import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCHEMA = Path(__file__).resolve().parent / "devenv_schema.py"
NEEDED = 10  # exit code of `check` when a migrate is needed


class MigrateCheck(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.app = Path(self._tmp.name) / "app"
        self.stamp = Path(self._tmp.name) / "bench" / ".migrated-schema"
        self.write("nirmaan_stack/hooks.py", "app_name = 'nirmaan_stack'\n")
        self.write("nirmaan_stack/patches.txt", "[post_model_sync]\n")
        self.write("nirmaan_stack/nirmaan_stack/doctype/widget/widget.json", '{"name": "Widget"}')
        self.write("nirmaan_stack/api/widgets.py", "def f(): pass\n")

    def tearDown(self):
        self._tmp.cleanup()

    def write(self, rel, text):
        f = self.app / rel
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(text)

    def run_cli(self, cmd):
        return subprocess.run([sys.executable, "-I", str(SCHEMA), cmd, str(self.app), str(self.stamp)],
                              capture_output=True, text=True)

    def check(self):
        return self.run_cli("check")

    def record(self):
        r = self.run_cli("record")
        self.assertEqual(r.returncode, 0, r.stderr)

    def test_an_env_with_no_record_of_its_last_migrate_needs_one(self):
        r = self.check()
        self.assertEqual(r.returncode, NEEDED, r.stderr)
        self.assertIn("no record", r.stdout)

    def test_no_migrate_is_needed_right_after_one(self):
        self.record()
        r = self.check()
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)

    def test_a_changed_doctype_json_needs_a_migrate_and_is_named(self):
        self.record()
        self.write("nirmaan_stack/nirmaan_stack/doctype/widget/widget.json", '{"name": "Widget", "fields": []}')
        r = self.check()
        self.assertEqual(r.returncode, NEEDED)
        self.assertIn("nirmaan_stack/nirmaan_stack/doctype/widget/widget.json", r.stdout)

    def test_a_new_doctype_needs_a_migrate(self):
        self.record()
        self.write("nirmaan_stack/nirmaan_stack/doctype/gadget/gadget.json", '{"name": "Gadget"}')
        self.assertEqual(self.check().returncode, NEEDED)

    def test_a_removed_doctype_needs_a_migrate(self):
        self.record()
        (self.app / "nirmaan_stack/nirmaan_stack/doctype/widget/widget.json").unlink()
        self.assertEqual(self.check().returncode, NEEDED)

    def test_a_changed_patches_txt_needs_a_migrate(self):
        self.record()
        self.write("nirmaan_stack/patches.txt", "[post_model_sync]\nnirmaan_stack.patches.v3_0.x\n")
        r = self.check()
        self.assertEqual(r.returncode, NEEDED)
        self.assertIn("nirmaan_stack/patches.txt", r.stdout)

    def test_a_changed_hooks_py_needs_a_migrate(self):
        self.record()
        self.write("nirmaan_stack/hooks.py", "app_name = 'nirmaan_stack'\ndoc_events = {}\n")
        self.assertEqual(self.check().returncode, NEEDED)

    def test_a_change_to_other_code_needs_no_migrate(self):
        self.record()
        self.write("nirmaan_stack/api/widgets.py", "def f(): return 1\n")
        self.write("nirmaan_stack/nirmaan_stack/doctype/widget/widget.py", "class Widget: pass\n")
        self.assertEqual(self.check().returncode, 0)


if __name__ == "__main__":
    unittest.main()
