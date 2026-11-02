# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt
"""Tests for the H2 bench's scorer (DEV2-B3, T1; scripts/_instruments/h2_bench.py). Fixtures only: no model call,
no database read or write, no bench file.

  top 5 / first   a known-same row or a copy of it (same group) counts   /  a row of another group never does
  reach           a known row the target may not be offered leaves the denominator; a target with no verdict too
                  (as DEV2-S8 x_s8.score), counted apart
  first verdict   the first row's verdict through a copy; the newest verdict file wins for a pair
  traps           size changed: original first AND SAME is the failure  /  first but CLOSE is not
                  reworded: original first  /  S0: a known row called SAME
  GO              the thresholds 177 / 156 / 63 / 54
"""
import importlib.util
from pathlib import Path
from types import SimpleNamespace

from frappe.tests.utils import FrappeTestCase

import nirmaan_stack

_PATH = Path(nirmaan_stack.__file__).resolve().parents[1] / "scripts" / "_instruments" / "h2_bench.py"
_spec = importlib.util.spec_from_file_location("h2_bench_under_test", _PATH)
HB = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(HB)


def _bench():
    b = HB.Bench.__new__(HB.Bench)
    b.tg = {"T001": {"key": "B1|S|1", "kind": "target"}, "T002": {"key": "B1|S|2", "kind": "target"},
            "T003": {"key": "B1|S|3", "kind": "target"}, "T004": {"key": "B1|S|4", "kind": "target"},
            "H001": {"key": "B1|S|5", "kind": "target"},
            "MUT-001": {"key": "MUT-001", "kind": "mutation_trap", "of": "B2|S|1"},
            "PAR-001": {"key": "PAR-001", "kind": "paraphrase_trap", "of": "B2|S|1"}}
    b.s0 = {"S0-001": {"key": "S0-001", "kind": "s0_trap", "of": "B2|S|2"}}
    b.s0r = {"S0-001": {"target": "T002", "of": "B2|S|2", "how": "changed"}}
    b.traps = [{"trap_id": "MUT-001", "kind": "mutation", "of": "B2|S|1"},
               {"trap_id": "PAR-001", "kind": "paraphrase", "of": "B2|S|1"}]
    pt = {"own_boq": "B1", "extra": []}
    b.p5 = {"per_target": {t: dict(pt) for t in b.tg}}
    b.p0 = {"per_target": {"S0-001": dict(pt)}}
    b.kept5 = b.kept0 = {"B2|S|1", "B2|S|1c", "B2|S|2", "B3|S|1", "B3|S|2"}
    b.ks = {"T001": {"rows": {"B2|S|1": {}}}, "T002": {"rows": {"B2|S|2": {}}},
            "T003": {"rows": {"B1|S|9": {}}},           # its own BoQ: never offered -> out of the denominator
            "T004": {"rows": {"B3|S|1": {}}}, "H001": {"rows": {"B3|S|2": {}}}}
    b.vv = {"T001|B3|S|1": "CLOSE", "T002|B2|S|2c": "SAME"}
    return b


def _pool():
    keys = ["B2|S|1", "B2|S|1c", "B2|S|2", "B2|S|2c", "B3|S|1", "B3|S|2", "B1|S|9", "B9|S|9"]
    groups = {"B2|S|1": 0, "B2|S|1c": 0, "B2|S|2": 1, "B2|S|2c": 1, "B3|S|1": 2, "B3|S|2": 3, "B1|S|9": 4, "B9|S|9": 5}
    rows = [{"key": k, "group": groups[k]} for k in keys]
    members = {}
    for k, g in groups.items():
        members.setdefault(g, []).append(k)
    return SimpleNamespace(rows=rows, byk={k: i for i, k in enumerate(keys)}, index={"members": members})


class TestScore(FrappeTestCase):

    def setUp(self):
        self.sc = HB.Scorer(_bench(), _pool())

    def test_top5_and_first_count_a_known_row_or_its_copy(self):
        order = {"T001": ["B3|S|1", "B2|S|1c", "B9|S|9"],      # a copy at 2: top 5 yes, first no
                 "T002": ["B2|S|2", "B9|S|9"],                 # first
                 "T003": ["B1|S|9"],                           # unreachable: not counted
                 "H001": ["B9|S|9", "B3|S|1"]}                 # another group only: no
        s = self.sc.score(order, ["T001", "T002", "T003", "T004"])
        self.assertEqual((s["denominator"], s["top5"], s["first"]), (2, 2, 1))
        self.assertEqual(s["no verdict (left out)"], 1, "T004 is reachable but has no order")
        h = self.sc.score(order, ["H001"])
        self.assertEqual((h["denominator"], h["top5"], h["first"]), (1, 0, 0))

    def test_the_first_rows_verdict_through_a_copy(self):
        self.assertEqual(self.sc.verdict_of("T002", "B2|S|2"), ("SAME", True))
        self.assertEqual(self.sc.verdict_of("T001", "B3|S|1"), ("CLOSE", False))
        self.assertEqual(self.sc.verdict_of("T001", "B9|S|9"), (None, False))
        ov = self.sc.overall({"T001": ["B3|S|1"]}, {"T001": {"B3|S|1": {"v": "SAME"}}}, ["T001"])
        self.assertEqual(ov["shown first as SAME, verdict CLOSE or DIFFERENT"], 1)

    def test_traps(self):
        verd = {"MUT-001": {"B2|S|1": {"v": "SAME", "pos": 0}}, "PAR-001": {"B2|S|1": {"v": "CLOSE", "pos": 0}},
                "S0-001": {"B2|S|2": {"v": "SAME", "pos": 0}}}
        order = {"MUT-001": ["B2|S|1"], "PAR-001": ["B2|S|1"], "S0-001": ["B2|S|2"]}
        t = self.sc.traps(verd, order)
        self.assertEqual(t["mutation"]["original first and SAME (the failure)"], 1)
        self.assertEqual(t["paraphrase"]["original first"], 1)
        self.assertEqual(t["s0"]["flipped called SAME"], 1)
        verd["MUT-001"]["B2|S|1"]["v"] = "CLOSE"
        self.assertEqual(self.sc.traps(verd, order)["mutation"]["original first and SAME (the failure)"], 0)

    def test_go_needs_all_four_thresholds(self):
        b = _bench()
        b.set_of = lambda t: "bench" if t.startswith("T") else "heldout"
        sc = SimpleNamespace(score=lambda o, ts: ({"top5": 177, "first": 156} if ts and ts[0].startswith("T") else {"top5": 63, "first": 54}),
                             overall=lambda *a: {}, traps=lambda *a: {})
        orders = {"T001": {"ok": True, "n1b": [], "raw": [], "shown": []}, "H001": {"ok": True, "n1b": [], "raw": [], "shown": []}}
        self.assertTrue(HB.table(sc, orders, {}, b)["go"])
        sc.score = lambda o, ts: ({"top5": 177, "first": 155} if ts and ts[0].startswith("T") else {"top5": 63, "first": 54})
        self.assertFalse(HB.table(sc, orders, {}, b)["go"])
