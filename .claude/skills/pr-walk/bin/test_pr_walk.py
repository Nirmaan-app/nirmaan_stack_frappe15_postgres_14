"""Tests for the pr-walk tools, run as their users run them (python3 -I <script> ...): no frappe, no network.

    python3 -I -m unittest discover -s .claude/skills/pr-walk/bin -p 'test_pr_walk.py'

The saved walks, reference pages and template come from the folder named by PR_WALK_INPUTS (default
~/claude-artifacts/pr-walk-1734-inputs). They hold production figures, so they stay outside the repo; the tests that
need them skip, saying why, on a machine without them. The broken walks are made up here, in a temp dir.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

BIN = Path(__file__).resolve().parent
INPUTS = Path(os.environ.get("PR_WALK_INPUTS", "~/claude-artifacts/pr-walk-1734-inputs")).expanduser()
WALKS = {1731: INPUTS / "walks/pr-1731/walk7", 1732: INPUTS / "walks/pr-1732/walk5"}
TEMPLATE_BIN = INPUTS / "template/assets/bin"
NO_INPUTS = f"no pr-walk inputs at {INPUTS} (set PR_WALK_INPUTS to the folder with walks/, pages/ and template/)"

try:
    import PIL  # noqa: F401  sheet.py needs Pillow
    NO_PILLOW = ""
except ImportError:
    NO_PILLOW = "sheet.py needs Pillow, which this Python lacks"


def run(script: str, *args: str | Path) -> subprocess.CompletedProcess:
    return subprocess.run([sys.executable, "-I", str(BIN / script), *map(str, args)],
                          capture_output=True, text=True, timeout=300)


def made_up_walk(folder: Path, **step_fields) -> Path:
    """A one-step walk of a made-up PR, with the step's fields overridden by step_fields."""
    (folder / "shots").mkdir(parents=True)
    (folder / "shots/s01.jpg").write_bytes(b"\xff\xd8\xff\xd9")
    step = {"id": "s01", "change": "c1", "side": "after", "role": "Accountant", "user": "test.user@example.com",
            "caption": "Open the made-up report", "shot": "shots/s01.jpg", "size": [1280, 800],
            "click": {"x": 10, "y": 20, "w": 120, "h": 32}, "clicked": True,
            "pins": [{"box": {"x": 40, "y": 60, "w": 200, "h": 24}, "text": "Made-up note", "kind": "nit",
                      "evidence": "seen"}],
            "url": "http://made-up.localhost/report"}
    step.update(step_fields)
    walk = {"pr": {"number": 9999, "title": "Made-up PR", "url": "https://example.com/pr/9999", "author": "tester",
                   "head": "aaaaaaa", "base": "bbbbbbb"},
            "envs": {"after": "pr-9999", "before": "pr-9999-base"}, "data_note": "made up",
            "walked_at": "2026-01-01T00:00:00Z",
            "changes": [{"id": "c1", "title": "Made-up change", "claim": "It shows", "status": "seen", "reason": ""}],
            "steps": [step], "checks": []}
    (folder / "walk.json").write_text(json.dumps(walk))
    return folder


class BuildPageRebuildsSavedWalks(unittest.TestCase):
    @unittest.skipUnless(INPUTS.is_dir(), NO_INPUTS)
    def test_both_saved_walks_rebuild_byte_identical_to_their_reference_pages(self):
        with tempfile.TemporaryDirectory() as tmp:
            for pr, walk in WALKS.items():
                with self.subTest(pr=pr):
                    out = Path(tmp) / f"pr-{pr}-walk.html"
                    r = run("build_page.py", walk, out, "--terms", BIN / f"terms_pr_{pr}.json")
                    self.assertEqual(r.returncode, 0, r.stderr)
                    self.assertEqual(out.read_bytes(), (INPUTS / f"pages/pr-{pr}-walk.html").read_bytes())


class BuildPageRefusesBadBoxes(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(lambda: subprocess.run(["rm", "-rf", str(self.tmp)]))

    def build(self, **step_fields) -> subprocess.CompletedProcess:
        return run("build_page.py", made_up_walk(self.tmp / "walk", **step_fields), self.tmp / "out.html")

    def assert_refused(self, r: subprocess.CompletedProcess, why: str) -> None:
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("refused", r.stderr)
        self.assertIn("step s01 ('Open the made-up report')", r.stderr)
        self.assertIn(why, r.stderr)
        self.assertFalse((self.tmp / "out.html").exists())

    def test_a_walk_with_sized_boxes_builds(self):
        r = self.build()
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("<title>PR 9999 Walk</title>", (self.tmp / "out.html").read_text())

    def test_a_click_box_saved_as_width_and_height_is_refused(self):
        self.assert_refused(self.build(click={"x": 10, "y": 20, "width": 120, "height": 32}),
                            "click box needs numeric x, y, w, h")

    def test_a_pin_box_with_no_height_is_refused(self):
        pin = {"box": {"x": 40, "y": 60, "w": 200, "h": 0}, "text": "Made-up note", "kind": "nit", "evidence": "seen"}
        self.assert_refused(self.build(pins=[pin]), "pin 1 box w=200 h=0")

    def test_a_step_that_clicked_with_no_click_box_is_refused(self):
        self.assert_refused(self.build(click=None, clicked=True), "click box lost")


@unittest.skipUnless(INPUTS.is_dir(), NO_INPUTS)
@unittest.skipIf(NO_PILLOW, NO_PILLOW)
class SheetTilesSavedWalks(unittest.TestCase):
    def test_sheet_builds_a_tile_per_screen_for_both_saved_walks(self):
        screens = {1731: 49, 1732: 34}
        with tempfile.TemporaryDirectory() as tmp:
            for pr, walk in WALKS.items():
                with self.subTest(pr=pr):
                    out = Path(tmp) / f"pr-{pr}-sheet.jpg"
                    r = run("sheet.py", walk, out)
                    self.assertEqual(r.returncode, 0, r.stderr)
                    self.assertIn(f"{screens[pr]} screens", r.stdout)
                    self.assertEqual(out.read_bytes()[:3], b"\xff\xd8\xff")


@unittest.skipUnless(INPUTS.is_dir(), NO_INPUTS)
class ToolsEqualTheTemplate(unittest.TestCase):
    def test_record_build_page_and_sheet_equal_the_global_templates(self):
        for name in ("record.py", "build_page.py", "sheet.py"):
            with self.subTest(name=name):
                self.assertTrue((BIN / name).is_file(), f"{name} is missing from {BIN}")
                self.assertEqual((BIN / name).read_bytes(), (TEMPLATE_BIN / name).read_bytes(),
                                 f"{name} differs from {TEMPLATE_BIN / name}")


if __name__ == "__main__":
    unittest.main()
