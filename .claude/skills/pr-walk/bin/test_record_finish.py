"""Tests for Walk.finish, run as a graduated walk runs it: a script in a git checkout, ended by w.finish(<feature>).

    python3 -I -m unittest discover -s .claude/skills/pr-walk/bin -p 'test_record_finish.py'

Each test writes a made-up walk script into a temp git repo and runs it with python3 -I; the walk's changes, steps
and checks come from a JSON file, so no browser runs.
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

BIN = Path(__file__).resolve().parent

try:
    import playwright  # noqa: F401  record.py imports it
    NO_PLAYWRIGHT = ""
except ImportError:
    NO_PLAYWRIGHT = "record.py needs Playwright, which this Python lacks"

WALK_SCRIPT = f"""
import json, sys
from pathlib import Path
sys.path.insert(0, {str(BIN)!r})
from record import Walk
spec = json.loads(Path(sys.argv[1]).read_text())
w = Walk(Path(sys.argv[2]), {{"number": 0}}, {{"after": sys.argv[3]}}, "made up")
for c in spec["changes"]:
    w.change(c["id"], c["id"], "made-up claim")
    if c.get("status"):
        w.status(c["id"], c["status"], c.get("reason", ""))
w.data["steps"] = spec.get("steps", [])
w.data["checks"] = spec.get("checks", [])
w.finish(Path(spec["feature"]), stamp=spec.get("stamp", True))
"""

FEATURE = """# Made-up feature

What the user sees.

## Sub-features

- One.

## Gotchas

- None.
"""

STAMP = re.compile(r"^Last walked \(walk_made_up\.py\): \d{4}-\d{2}-\d{2} UTC at ([0-9a-f]{9}), (passed|failed)\.$",
                   re.MULTILINE)


def check(change: str, ok: bool, kind: str = "must") -> dict:
    return {"change": change, "role": "Accountant", "expect": "3 rows", "seen": "3 rows" if ok else "2 rows",
            "ok": ok, "kind": kind}


def step(change: str, pin_kind: str | None = None) -> dict:
    pins = [{"box": None, "text": "made-up note", "kind": pin_kind, "evidence": "seen"}] if pin_kind else []
    return {"id": "s01", "change": change, "pins": pins}


@unittest.skipIf(NO_PLAYWRIGHT, NO_PLAYWRIGHT)
class FinishEndsAGraduatedWalk(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.repo = Path(tmp.name)
        self.feature = self.repo / "features/made-up.md"
        self.feature.parent.mkdir()
        self.feature.write_text(FEATURE)
        (self.repo / "walk_made_up.py").write_text(WALK_SCRIPT)
        for args in (["init", "-q"], ["add", "."], ["-c", "user.name=t", "-c", "user.email=t@example.com",
                                                     "commit", "-qm", "made-up feature"]):
            subprocess.run(["git", "-C", str(self.repo), *args], check=True)
        self.head = subprocess.run(["git", "-C", str(self.repo), "rev-parse", "--short=9", "HEAD"],
                                   capture_output=True, text=True, check=True).stdout.strip()

    def finish(self, changes: list[dict], steps=(), checks=(), stamp: bool = True):
        spec = self.repo / "spec.json"
        spec.write_text(json.dumps({"changes": changes, "steps": list(steps), "checks": list(checks),
                                    "feature": str(self.feature), "stamp": stamp}))
        out = self.repo / "out"
        r = subprocess.run([sys.executable, "-I", str(self.repo / "walk_made_up.py"), str(spec), str(out), "env-1"],
                           capture_output=True, text=True, cwd=self.repo, timeout=120)
        walk = json.loads((out / "walk.json").read_text()) if (out / "walk.json").exists() else None
        return r, walk

    def test_each_change_rolls_up_from_its_own_checks_and_pins(self):
        r, walk = self.finish(
            [{"id": "ok"}, {"id": "bad_check"}, {"id": "must_pin"}, {"id": "nit_only"},
             {"id": "skipped", "status": "not_walked", "reason": "no Gemini key on an env"},
             {"id": "stopped", "status": "failed", "reason": "walk stopped: TimeoutError"},
             {"id": "untouched"}],
            steps=[step("ok"), step("must_pin", "must"), step("nit_only", "nit"), step("stopped")],
            checks=[check("ok", True), check("bad_check", False), check("bad_check", True),
                    check("nit_only", False, kind="nit"), check("stopped", True)])
        got = {c["id"]: (c["status"], c["reason"]) for c in walk["changes"]}
        self.assertEqual(got, {
            "ok": ("seen", ""),
            "bad_check": ("failed", "Accountant: expected 3 rows, saw 2 rows"),
            "must_pin": ("failed", ""),
            "nit_only": ("seen", ""),
            "skipped": ("not_walked", "no Gemini key on an env"),
            "stopped": ("failed", "walk stopped: TimeoutError"),
            "untouched": ("not_walked", ""),
        })
        self.assertEqual(r.returncode, 1, r.stderr)
        self.assertIn(str(self.repo / "out/walk.json"), r.stdout)
        self.assertIn("FAILED", r.stdout)

    def test_a_walk_with_a_seen_change_and_no_failed_one_passes_and_stamps_before_the_first_section(self):
        r, walk = self.finish([{"id": "ok"}, {"id": "skipped", "status": "not_walked", "reason": "no key"}],
                              steps=[step("ok")], checks=[check("ok", True)])
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("PASSED", r.stdout)
        text = self.feature.read_text()
        stamp = STAMP.search(text)
        self.assertIsNotNone(stamp, text)
        self.assertEqual(stamp.groups(), (self.head, "passed"))
        self.assertIn(f"What the user sees.\n\n{stamp.group(0)}\n\n## Sub-features", text)

    def test_a_walk_with_no_seen_change_fails(self):
        r, _ = self.finish([{"id": "skipped", "status": "not_walked", "reason": "no key"}])
        self.assertEqual(r.returncode, 1, r.stderr)
        self.assertEqual(STAMP.search(self.feature.read_text()).group(2), "failed")

    def test_a_rerun_replaces_its_own_stamp_and_keeps_another_walks(self):
        other = "Last walked (walk_other.py): 2026-01-01 UTC at aaaaaaaaa, passed."
        mine = "Last walked (walk_made_up.py): 2026-01-01 UTC at bbbbbbbbb, passed."
        self.feature.write_text(FEATURE.replace("## Sub-features", f"{other}\n\n{mine}\n\n## Sub-features"))
        r, _ = self.finish([{"id": "bad"}], checks=[check("bad", False)])
        self.assertEqual(r.returncode, 1, r.stderr)
        text = self.feature.read_text()
        self.assertEqual([m.groups() for m in STAMP.finditer(text)], [(self.head, "failed")])
        self.assertIn(other, text)
        self.assertNotIn("bbbbbbbbb", text)

    def test_stamp_false_leaves_the_feature_file_as_it_was_and_still_gives_the_verdict(self):
        r, walk = self.finish([{"id": "ok"}], checks=[check("ok", True)], stamp=False)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(walk["changes"][0]["status"], "seen")
        self.assertEqual(self.feature.read_text(), FEATURE)


if __name__ == "__main__":
    unittest.main()
