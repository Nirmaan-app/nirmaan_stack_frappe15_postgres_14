"""Tests for asset_pin_search.py: every pin class on a scratch tree, then the four real Electrical mints.

Stdlib only, like the script:  python3 scripts/test_asset_pin_search.py
The real-mint tests read this repository's history (git); they need the four mint commits below.
"""

import ast
import io
import json
import re
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import asset_pin_search as aps  # noqa: E402

REPO = Path(__file__).resolve().parent.parent
E = "rate_master_electrical_all_v"
H = "rate_master_hvac_all_v"


def _asset(n_items, n_configs=1):
    return json.dumps({"items": [{"item_uid": "u%d" % i, "kind": "k"} for i in range(n_items)],
                       "category_configs": [{"category_id": "c%d" % i} for i in range(n_configs)]})


PY_TEST = '''
import os
CURRENT_EALL_ASSET = "rate_master_electrical_all_v4.json"
EALL_ITEMS = 2
# CURRENT_EALL_ASSET = "rate_master_electrical_all_v4.json"   (a comment is never a pin)


def _load(name):
    return name


def _without_x(cfg):
    return cfg


class TestNowVsWas(object):
    @classmethod
    def setUpClass(cls):
        cls.now = _load(CURRENT_EALL_ASSET)
        cls.was = _load("rate_master_electrical_all_v3.json")

    def test_nothing_else_moved(self):
        self.assertEqual(_without_x(self.now), self.was)

    def test_current_is_named(self):
        self.assertEqual(CURRENT_EALL_ASSET, "rate_master_electrical_all_v4.json")


class TestFrozen(object):
    _NOW_ASSET = "rate_master_electrical_all_v4.json"   # deliberately frozen: a historical pin, never a MUST

    def test_frozen(self):
        self.assertTrue(self._NOW_ASSET)


def test_scan():
    ns = [int(m) for m in os.listdir(".")]
    assertEqual(max(ns), 4)
    assertFalse(os.path.exists("rate_master_electrical_all_v5.json"))
    assertEqual(max(sizes), 4.5)   # a measurement that starts with the old version number is not a scan pin
'''

TS_TEST = '''
const ELEC = readAsset("rate_master_electrical_all_v");
describe("served vs stored", () => {
  it("the same uids", () => {
    expect(new Set(storedItems(ELEC).map((it) => it.item_uid))).toEqual(SERVED);
  });
  it("the catalogue size", () => {
    expect(SERVED.size).toBe(2);
  });
});
const CASES = [
  { label: "Electrical", prefix: "rate_master_electrical_all_v" },
];
'''


class ScratchTree(unittest.TestCase):
    """A tree with Electrical v3 / v4 (2 items) / v5 (3 items) and one HVAC asset; the tests pin v4 in every class."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        data = self.root / aps.DATA_DIR
        data.mkdir(parents=True)
        (data / (E + "3.json")).write_text(_asset(2))
        (data / (E + "4.json")).write_text(_asset(2))
        (data / (E + "5.json")).write_text(_asset(3))
        (data / (H + "9.json")).write_text(_asset(5))
        self.py = self.root / "nirmaan_stack/api/boq/test_x.py"
        self.py.parent.mkdir(parents=True)
        self.py.write_text(PY_TEST)
        self.ts = self.root / "frontend/src/pages/pricing/x.test.ts"
        self.ts.parent.mkdir(parents=True)
        self.ts.write_text(TS_TEST)

    def tearDown(self):
        self.tmp.cleanup()

    def _find(self, discipline="Electrical", new=5):
        head, found = aps.search(self.root, discipline, new)
        return head, {(f.cls, Path(f.path).name, f.line) for f in found}, found

    def test_the_pair_is_the_new_version_and_the_one_before_it(self):
        head, _, _ = self._find()
        self.assertEqual((head["old"], head["new"]), (E + "4.json", E + "5.json"))
        self.assertEqual((head["old_facts"]["items"], head["new_facts"]["items"]), (2, 3))

    def test_each_must_class_is_found_on_its_line(self):
        _, got, _ = self._find()
        lines = PY_TEST.split("\n")
        at = lambda s: next(i + 1 for i, ln in enumerate(lines) if s in ln)   # noqa: E731
        self.assertIn(("const", "test_x.py", at('CURRENT_EALL_ASSET = "rate')), got)
        self.assertIn(("assert", "test_x.py", at("self.assertEqual(CURRENT_EALL_ASSET")), got)
        self.assertIn(("scan-max", "test_x.py", at("max(ns), 4")), got)
        self.assertIn(("not-exists", "test_x.py", at("assertFalse(os.path.exists")), got)
        self.assertIn(("count", "test_x.py", at("EALL_ITEMS = 2")), got)

    def test_the_prefix_reader_and_the_lines_its_variable_feeds(self):
        """The class ELR-3a missed: a reader of the latest asset by bare file prefix (no version in it)."""
        _, got, _ = self._find()
        self.assertIn(("prefix", "x.test.ts", 2), got)
        self.assertIn(("prefix", "x.test.ts", 5), got)
        self.assertIn(("count-literal", "x.test.ts", 8), got)
        # a prefix inside a table of cases (RateMasterDataViewer.dom.test.tsx's shape), not assigned to a name
        self.assertIn(("prefix", "x.test.ts", 12), got)

    def test_a_now_vs_was_comparison_and_its_normaliser(self):
        _, _, found = self._find()
        by = {(f.cls, f.test) for f in found}
        self.assertIn(("compares", "TestNowVsWas.test_nothing_else_moved"), by)
        self.assertIn(("normaliser", "_without_x"), by)

    def test_NEGATIVE_a_comment_and_a_deliberately_frozen_name_are_never_a_must(self):
        _, _, found = self._find()
        musts = {(f.line, f.cls) for f in found if f.cls in aps.MUST and f.path.endswith("test_x.py")}
        lines = PY_TEST.split("\n")
        for i, ln in enumerate(lines):
            if ln.strip().startswith("#") or "_NOW_ASSET =" in ln:
                self.assertNotIn(i + 1, {m[0] for m in musts}, ln)
        self.assertNotIn(next(i + 1 for i, ln in enumerate(lines) if "max(sizes)" in ln), {m[0] for m in musts})
        frozen = next(i + 1 for i, ln in enumerate(lines) if "_NOW_ASSET =" in ln)
        self.assertIn(("old-name", frozen), {(f.cls, f.line) for f in found})

    def test_NEGATIVE_the_other_discipline_sees_none_of_it(self):
        (self.root / aps.DATA_DIR / (H + "10.json")).write_text(_asset(5))
        _, _, found = self._find("HVAC", 10)
        self.assertEqual([f for f in found if f.cls in aps.MUST], [])

    def test_NEGATIVE_a_count_the_mint_did_not_change_is_not_a_pin(self):
        (self.root / aps.DATA_DIR / (E + "5.json")).write_text(_asset(2))
        _, got, _ = self._find()
        self.assertFalse({"count", "count-literal"} & {c for c, _, _ in got})

    def test_exit_status_is_1_until_every_must_pin_has_moved_then_0(self):
        argv = ["--discipline", "Electrical", "--new-version", "5", "--root", str(self.root)]
        with redirect_stdout(io.StringIO()):
            self.assertEqual(aps.main(argv), 1)
            moved = PY_TEST.replace(E + "4.json", E + "5.json").replace("EALL_ITEMS = 2", "EALL_ITEMS = 3")
            moved = moved.replace("max(ns), 4)", "max(ns), 5)").replace('exists("' + E + '5.json")', 'exists("' + E + '6.json")')
            self.py.write_text(moved)
            self.assertEqual(aps.main(argv), 0)

    def test_a_version_that_is_not_on_disk_is_refused_by_name(self):
        with self.assertRaises(SystemExit) as cm:
            aps.search(self.root, "Electrical", 7)
        self.assertIn(E + "7.json", str(cm.exception))


# --- the four real mints (TOOL-1 AC3) ------------------------------------------------------------------------------

# (slice, new version, mint commit, follow-up commits that moved more pins of the same mint)
MINTS = [("ELR-1", 67, "9f5364011", []), ("ELR-2", 68, "05c944f94", ["1085190fb"]),
         ("ELR-3a", 69, "0a4ea1002", ["93f6aa776"]), ("ELR-4a", 70, "a799c49e0", ["7164c3472"])]

# Hunks of those commits that are NOT asset pins, each with the reason (TOOL-1 P4). Everything else a mint commit
# changed in a test file must be found by the script at the mint's parent.
NOT_ASSET_PINS = {
    ("9f5364011", "frontend/src/pages/boq-wizard/rate-helper/adp4b.dom.test.ts"): "product: the Derivation card rule (owner Q4)",
    ("9f5364011", "frontend/src/pages/pricing/rate-master/rateMasterDataViewer.test.ts"): "product: viewer source pins",
    ("9f5364011", "nirmaan_stack/api/boq/test_spec_reader.py"): "product: integral numbers in downloads (owner R-NUM B)",
    ("9f5364011", "TestF25Slice1BackBoxField.test_f25s1_07_every_other_config_item_and_golden_is_byte_equal_to_v56"):
        "no-op normaliser: the class reads v57 by name (_NOW_ASSET), never the latest asset",
    ("9f5364011", "TestF25Slice2BareBox.test_f25s2_05_every_other_config_item_and_golden_is_byte_equal_to_v57"):
        "no-op normaliser: the class reads v58 by name, never the latest asset",
    ("05c944f94", "frontend/src/pages/boq-wizard/rate-helper/pricingSheetHelper.test.ts"): "product: pw1 working-line wording",
    ("0a4ea1002", "frontend/src/pages/pricing/rate-master/PricingInputImpactPanel.test.ts"): "a new describe block for v69",
    ("0a4ea1002", "nirmaan_stack/api/boq/test_elr3a_assembly_inputs.py"): "new tests (the slice's own file)",
    ("a799c49e0", "frontend/src/pages/boq-wizard/rate-helper/elr4aBlankPlate.test.ts"): "new tests (the slice's own file)",
    ("a799c49e0", "frontend/src/pages/pricing/rate-master/attributeRuleOrder.elr4a.test.ts"): "new tests (the slice's own file)",
    ("7164c3472", "frontend/src/pages/boq-wizard/rate-helper/elr4aBlankPlate.test.ts"): "a type cast for tsc",
}


def _git(*a):
    return subprocess.run(["git", "-C", str(REPO), *a], capture_output=True, check=True).stdout.decode("utf-8", "replace")


def _hunks(commit):
    """(path, old start, old length) of every hunk in a test file, against the commit's parent."""
    out, path = [], None
    for ln in _git("show", "--format=", "-U0", commit).splitlines():
        if ln.startswith("+++ "):
            path = ln[6:] if ln.startswith("+++ b/") else None
        m = re.match(r"@@ -(\d+)(?:,(\d+))? \+", ln)
        if m and path and aps.is_test_file(path):
            out.append((path, int(m.group(1)), max(int(m.group(2) if m.group(2) is not None else 1), 1)))
    return out


def _units(commit, path, start, length):
    """The defs a hunk sits in, at the commit's parent; empty for a file the commit created (new tests, not a pin)."""
    r = subprocess.run(["git", "-C", str(REPO), "show", "%s^:%s" % (commit, path)], capture_output=True)
    if r.returncode != 0:
        return set()
    src = r.stdout.decode("utf-8", "replace").replace("\r\n", "\n")
    if not path.endswith(".py"):
        return {"<file>"}
    encl = aps._enclosing_map(ast.parse(src))
    return {encl.get(n, "<module>") for n in range(start, start + length)}


class RealMints(unittest.TestCase):
    """At each mint's parent with the minted asset beside it -- the state a slice is in right after a mint -- the
    script lists every asset pin the slice then moved (the mint commit and its follow-ups), and exits 1; at the mint
    commit itself, with the pins moved, it exits 0."""

    @classmethod
    def setUpClass(cls):
        for _, _, mint, follow in MINTS:
            for c in [mint] + follow:
                subprocess.run(["git", "-C", str(REPO), "cat-file", "-e", c + "^{commit}"], check=True)
        cls.before = {m[2]: aps.search(REPO, "Electrical", m[1], rev=m[2] + "^", asset_rev=m[2])[1] for m in MINTS}

    def test_every_moved_asset_pin_is_listed(self):
        for slice_, _, mint, follow in MINTS:
            found = self.before[mint]
            for c in [mint] + follow:
                for path, start, length in _hunks(c):
                    if (c, path) in NOT_ASSET_PINS:
                        continue
                    units = _units(c, path, start, length) - {u for (k, u) in NOT_ASSET_PINS if k == c}
                    if not units:
                        continue
                    hit = [f for f in found if f.path == path and
                           ("<file>" in units or f.test in units
                            or ("<module>" in units and c == mint and start <= f.line < start + length))]
                    with self.subTest(slice=slice_, commit=c, at="%s:%d" % (path, start), units=sorted(units)):
                        self.assertTrue(hit, "the script did not list this moved pin")

    def test_the_must_list_is_the_current_constant_and_its_asserts_and_exit_is_1(self):
        for slice_, new, mint, _ in MINTS:
            musts = [f for f in self.before[mint] if f.cls in aps.MUST]
            with self.subTest(slice=slice_):
                self.assertIn("const", {f.cls for f in musts})
                self.assertTrue(all("v%d" % (new - 1) in f.text or f.cls == "count" for f in musts), musts)

    def test_elr3a_the_prefix_reader_it_missed_is_listed(self):
        """ELR-3a's commit 2 grepped for the v68 file name and CURRENT_EALL_ASSET and missed this one (93f6aa776)."""
        hits = [f for f in self.before["0a4ea1002"] if f.path.endswith("pricing/servedVsStoredPricing.test.ts")]
        self.assertIn("prefix", {f.cls for f in hits})

    def test_NEGATIVE_after_the_pins_moved_no_must_pin_remains(self):
        for slice_, new, mint, _ in MINTS:
            _, found = aps.search(REPO, "Electrical", new, rev=mint)
            with self.subTest(slice=slice_):
                self.assertEqual([f for f in found if f.cls in aps.MUST], [])


if __name__ == "__main__":
    unittest.main()
