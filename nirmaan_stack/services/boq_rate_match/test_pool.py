# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt
"""Tests for the historical pool (DEV2-B2, T1). Fixtures only: the pool's rules are pure functions over small in-memory
rows; the cache is exercised on a temp path with a fake builder. No live data, no database write, no model call.

  family + near copy  a revision family yields ONE version; near copies keep the newest copy of each row
  3-day rule          a version changed inside the window is passed over; one settled outside it is selected
  2X                  a target in the selected version sees the next settled version; a target elsewhere does not
  own version out     a row of the target's own BoQ is never allowed; another BoQ's kept row is
  WIP out             a sheet priced inside the window is not offered; one priced before it is
  test projects       the APP's rule: "testproject" anywhere (spaces removed); a "test ..." name that is not one stays in
  rate-editable only  a Line Item always; a Preamble only with a quantity; an unpriced row never
  group key           the normaliser makes spelling variants one group; a different unit or size stays apart
  readings view       the pricer's values for the MEASURED driving fields only (attribute and item-list path); none measured -> none
  cache               missing -> built; fresh -> loaded; older than 24 h -> rebuilt; stale stamp -> rebuilt; one lock;
                      rebuild_pool() (the daily job's entry point, no arguments) always rebuilds, under the same lock
"""
import datetime
import os
import shutil
import tempfile
import time
from unittest.mock import patch

from filelock import FileLock, Timeout
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.services.boq_rate_match import pool as P


def _row(key, test=False, desc="cable", parent="", created="2026-01-01"):
    boq = key.split("|")[0]
    return {"key": key, "boq": boq, "test": test, "payload": {"description": desc}, "parent_raw": parent}


class TestPoolRules(FrappeTestCase):
    CREATED = {"B1": "2026-01-01 10:00:00", "B2": "2026-02-01 10:00:00", "B3": "2026-03-01 10:00:00", "C1": "2026-01-05 10:00:00", "C2": "2026-02-05 10:00:00"}

    # ---- family + near copy -> one version ----
    def test_a_revision_family_enters_as_one_version(self):
        sel, nxt = P.select_versions([["B1", "B2", "B3"]], self.CREATED, {"B1": 5, "B2": 5, "B3": 5}, {"B1": "2026-01-02", "B2": "2026-02-02", "B3": "2026-03-02"}, "2026-10-01 00:00:00")
        self.assertEqual({sel[b] for b in ("B1", "B2", "B3")}, {"B3"})
        rows = [_row(f"{b}|S|{n}", desc=f"row {n}") for b in ("B1", "B2", "B3") for n in (1, 2)]
        kept = P.kept_keys(rows, sel, [], {b: self.CREATED[b] for b in ("B1", "B2", "B3")})
        self.assertEqual(kept, {"B3|S|1", "B3|S|2"})

    def test_a_version_holding_no_rate_is_never_selected(self):
        sel, _ = P.select_versions([["B1", "B2"]], self.CREATED, {"B1": 5}, {}, "2026-10-01 00:00:00")
        self.assertEqual(sel["B2"], "B1")

    def test_near_copies_keep_the_newest_copy_of_each_row(self):
        pairs = P.near_copy_pairs({"C1": {f"description number {i}": 1 for i in range(12)}, "C2": {f"description number {i}": 1 for i in range(12)}})
        self.assertEqual(pairs, [("C1", "C2")])
        sets = P.near_copy_sets(pairs)
        rows = [_row("C1|S|1", desc="same row"), _row("C1|S|2", desc="only in the old one"), _row("C2|S|1", desc="same row")]
        kept = P.kept_keys(rows, {}, sets, self.CREATED)
        self.assertEqual(kept, {"C1|S|2", "C2|S|1"})

    def test_bboqs_sharing_too_little_are_not_near_copies(self):
        a = {f"description number {i}": 1 for i in range(20)}
        b = {**{f"description number {i}": 1 for i in range(9)}, **{f"other text {i}": 1 for i in range(20)}}
        self.assertEqual(P.near_copy_pairs({"C1": a, "C2": b}), [])     # 9 shared < 10
        self.assertEqual(P.near_copy_pairs({"C1": a, "C2": {f"description number {i}": 1 for i in range(10)}}), [("C1", "C2")])

    def test_a_description_in_more_than_40_boqs_says_nothing(self):
        common = {f"generic line {i}": 1 for i in range(12)}
        desc = {f"Q{n}": dict(common) for n in range(41)}
        self.assertEqual(P.near_copy_pairs(desc), [])

    # ---- the 3-day rule, both sides ----
    def test_three_day_rule_passes_over_a_version_changed_inside_the_window(self):
        cut = "2026-10-29 02:00:00"
        sel, nxt = P.select_versions([["B1", "B2"]], self.CREATED, {"B1": 5, "B2": 5}, {"B1": "2026-10-01 10:00:00", "B2": "2026-10-30 09:00:00"}, cut)
        self.assertEqual(sel["B1"], "B1")
        self.assertIsNone(nxt["B1"])

    def test_three_day_rule_selects_the_latest_version_settled_before_the_window(self):
        cut = "2026-10-29 02:00:00"
        sel, nxt = P.select_versions([["B1", "B2"]], self.CREATED, {"B1": 5, "B2": 5}, {"B1": "2026-10-01 10:00:00", "B2": "2026-10-28 09:00:00"}, cut)
        self.assertEqual(sel["B1"], "B2")
        self.assertEqual(nxt["B2"], "B1")

    def test_last_team_change_counts_a_changed_rate_not_a_resave(self):
        base = {"boq": "B1", "sheet_name": "S", "excel_row": 5, "col_letter": "F", "committed_version": 1}
        cells = [
            {**base, "pricing_version": 1, "rate": 100, "is_filled": 1, "priced_at": "2026-10-01 10:00:00"},
            {**base, "pricing_version": 2, "rate": 100, "is_filled": 1, "priced_at": "2026-10-20 10:00:00"},   # same rate: no change
            {**base, "pricing_version": 3, "rate": 120, "is_filled": 1, "priced_at": "2026-10-10 10:00:00"},   # changed
        ]
        self.assertEqual(P.last_team_change(cells), {"B1": "2026-10-10 10:00:00"})
        self.assertEqual(P.last_team_change(cells[:2]), {"B1": "2026-10-01 10:00:00"})

    # ---- 2X and own version ----
    def _pool(self, rows, kept, sel=None, nxt=None):
        return P.Pool({"rows": rows, "kept": kept, "sel": sel or {}, "nxt": nxt or {}})

    def test_2x_a_target_in_the_selected_version_sees_the_next_settled_version(self):
        rows = [dict(_row("B2|S|1"), wip=False), dict(_row("B1|S|1"), wip=False), dict(_row("B1|S|2", test=True), wip=False)]
        pool = self._pool(rows, {"B2|S|1"}, sel={"B1": "B2", "B2": "B2"}, nxt={"B1": "B1", "B2": "B1"})
        self.assertEqual(pool.extra_for("B2"), {"B1|S|1"})     # the test row stays out
        self.assertEqual(pool.extra_for("B1"), set())          # a target in an older version: nothing extra
        self.assertEqual(pool.extra_for("ZZ"), set())

    def test_own_boq_version_is_never_allowed(self):
        rows = [dict(_row("B1|S|1"), wip=False), dict(_row("B2|S|1"), wip=False)]
        pool = self._pool(rows, {"B1|S|1", "B2|S|1"})
        self.assertFalse(pool.allowed("B1|S|1", own_boq="B1"))
        self.assertTrue(pool.allowed("B2|S|1", own_boq="B1"))
        self.assertFalse(pool.allowed("B2|S|1", own_boq="B1", target_key="B2|S|1"))

    # ---- WIP ----
    def test_wip_rows_are_not_offered(self):
        at = datetime.datetime(2026, 11, 1, 2, 0, 0)
        self.assertTrue(P.is_wip("2026-10-31 10:00:00", at))
        self.assertFalse(P.is_wip("2026-10-28 10:00:00", at))
        self.assertFalse(P.is_wip("", at))
        rows = [dict(_row("B2|S|1"), wip=True), dict(_row("B3|S|1"), wip=False)]
        pool = self._pool(rows, {"B2|S|1", "B3|S|1"})
        self.assertFalse(pool.offered(0, own_boq="B1"))
        self.assertTrue(pool.offered(1, own_boq="B1"))
        self.assertTrue(pool.allowed("B2|S|1", own_boq="B1"))   # EXACT / RULES read allowed(), as t8_final.py did

    # ---- test projects (G15) ----
    def test_the_apps_test_project_rule(self):
        self.assertTrue(P.is_test_project("Test Project Bangalore"))
        self.assertTrue(P.is_test_project("TESTPROJECT"))
        self.assertTrue(P.is_test_project("my test  project"))
        self.assertFalse(P.is_test_project("test 3 BOQ Ankita"))     # starts with "test", is not a test project by the app's rule
        self.assertFalse(P.is_test_project("Testing lab fit-out"))
        self.assertFalse(P.is_test_project(None))

    def test_test_project_rows_are_not_kept(self):
        rows = [_row("B1|S|1", test=True), _row("C1|S|1")]
        self.assertEqual(P.kept_keys(rows, {}, [], self.CREATED), {"C1|S|1"})

    # ---- rate-editable only ----
    def test_rate_editable_and_priced(self):
        self.assertTrue(P.rate_editable("Line Item", "N1", set()))
        self.assertTrue(P.rate_editable(" Preamble ", "N2", {"N2"}))
        self.assertFalse(P.rate_editable("Preamble", "N3", {"N2"}))
        self.assertFalse(P.rate_editable("Heading", "N4", {"N4"}))
        self.assertTrue(P.is_priced({"supply_rate": 10}))
        self.assertFalse(P.is_priced({"supply_rate": 0, "install_rate": None}))

    # ---- group key ----
    def test_group_key_joins_spelling_variants_and_keeps_real_differences_apart(self):
        def gk(desc, unit, parent="Cable tray"):
            np = P.nz_payload({"description": desc, "ancestor_chain": [{"distance": 1, "description": parent}]})
            s, p, u = P.row_texts(np)
            return P.group_key(s, p, u, P.unit_norm(unit))
        self.assertEqual(gk("300X50 mm GI tray", "Rmt"), gk("300 x 50 mm galvanized iron tray", "mtr"))
        self.assertNotEqual(gk("300X50mm GI tray", "Rmt"), gk("300X50mm GI tray", "Nos"))
        self.assertNotEqual(gk("300X50mm GI tray", "Rmt"), gk("300X75mm GI tray", "Rmt"))
        self.assertNotEqual(gk("300X50mm GI tray", "Rmt"), gk("300X50mm GI tray", "Rmt", parent="Ladder tray"))

    def test_swg_table_assert(self):
        cfg = {"cabletray_raceway": {"pipelines": {"tray_boq_supply": {"steps": [{"params": {"table": dict(P.SWG)}}]}}}}
        P.check_swg_table(cfg)
        cfg["cabletray_raceway"]["pipelines"]["tray_boq_supply"]["steps"][0]["params"]["table"]["18"] = 1.25
        with self.assertRaises(AssertionError):
            P.check_swg_table(cfg)

    # ---- readings view (Q1 option A) ----
    def test_readings_view_attribute_path_reads_driving_fields_only(self):
        rec = {"mode": "attr", "finals": [{"item": None, "id": "core", "value": 4}, {"item": None, "id": "material", "value": " Copper "},
                                          {"item": None, "id": "brand", "value": "X"}, {"item": None, "id": "runs", "value": ""}]}
        drv = {"wiring_cabling": ["core", "insulation", "material", "runs", "thickness_sqmm"]}
        self.assertEqual(P.readings_view("wiring_cabling", rec, {"list": None}, {}, drv), ["core=4", "material=copper"])
        self.assertEqual(P.readings_view("", rec, {"list": None}, {}, drv), [])
        self.assertEqual(P.readings_view("wiring_cabling", rec, {"list": None}, {}, {}), [])   # nothing measured: no tokens

    def test_readings_view_item_list_path(self):
        ac7 = {"list": {"items": [{"family": "Grille", "fields": [{"id": "size_mm", "value": None, "typed": "600 X 600"}, {"id": "family", "value": "Grille"}]}]}}
        row = {"items": [{"attributes": {"neck_mm": {"value": 300}}}]}
        drv = {"hvac_adp": ["dia_mm", "family", "neck_mm", "panel_ratio", "size_mm", "slot_count", "torque"]}
        self.assertEqual(P.readings_view("hvac_adp", {"mode": "list"}, ac7, row, drv), ["family=grille", "grille.neck_mm=300", "grille.size_mm=600 x 600"])

    # ---- the index ----
    def test_a_rows_rebuilt_vector_equals_its_postings(self):
        docs = [P.toks("gi cable tray 300 x 50"), P.toks("pvc conduit 25 mm"), P.toks("gi cable tray 600 x 50")]
        df, (off, ids, ws) = P.tfidf_build(docs)
        v = dict(P.tfidf_vec(df, 3, docs[0]))
        for t, w in v.items():
            a, b = off[t]
            self.assertIn(0, ids[a:b])
            self.assertEqual(ws[a + list(ids[a:b]).index(0)], w)
        self.assertEqual(P.js_fixed(0.125, 2), 0.13)    # JavaScript's toFixed: a tie rounds up
        self.assertEqual(P.js_fixed(70.394999, 2), 70.39)


class TestPoolCache(FrappeTestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="pool_cache_test_")
        self.path = os.path.join(self.dir, "match_pool_v1.pkl")
        self.builds = 0
        self.stamp = {"code": "c1", "asset": "a1"}

    def tearDown(self):
        shutil.rmtree(self.dir, ignore_errors=True)

    def _builder(self):
        self.builds += 1
        return P.Pool({"format": P.POOL_FORMAT, "rows": [], "kept": set(), "sel": {}, "nxt": {}, "pricing": {"stamp": dict(self.stamp)}, "n": self.builds})

    def _ensure(self):
        with patch.object(P, "_current_stamp", return_value=dict(self.stamp)):
            return P.ensure_pool(path=self.path, builder=self._builder)

    def test_missing_is_built_then_fresh_is_loaded(self):
        pool, rebuilt = self._ensure()
        self.assertTrue(rebuilt)
        self.assertTrue(os.path.exists(self.path))
        pool2, rebuilt2 = self._ensure()
        self.assertFalse(rebuilt2)
        self.assertEqual(self.builds, 1)
        self.assertEqual(pool2.n, 1)

    def test_older_than_24_hours_is_rebuilt(self):
        self._ensure()
        old = time.time() - P.POOL_MAX_AGE_SEC - 60
        os.utime(self.path, (old, old))
        _, rebuilt = self._ensure()
        self.assertTrue(rebuilt)
        self.assertEqual(self.builds, 2)

    def test_younger_than_24_hours_is_not_rebuilt(self):
        self._ensure()
        recent = time.time() - P.POOL_MAX_AGE_SEC + 600
        os.utime(self.path, (recent, recent))
        _, rebuilt = self._ensure()
        self.assertFalse(rebuilt)

    def test_a_stale_pricing_stamp_is_rebuilt(self):
        self._ensure()
        self.stamp = {"code": "c2", "asset": "a1"}
        _, rebuilt = self._ensure()
        self.assertTrue(rebuilt)

    def test_an_unreadable_file_is_rebuilt(self):
        with open(self.path, "wb") as f:
            f.write(b"not a pickle")
        _, rebuilt = self._ensure()
        self.assertTrue(rebuilt)

    def test_a_rebuild_waits_on_the_one_lock(self):
        with FileLock(self.path + ".lock"):
            with patch.object(P, "REBUILD_WAIT_SEC", 0.5):
                with self.assertRaises(Timeout):
                    self._ensure()
        self.assertEqual(self.builds, 0)

    def test_the_pool_path_is_under_the_sites_private_folder(self):
        p = P.pool_path()
        self.assertIn(os.path.join("private", "boq_rate_match"), p)
        self.assertTrue(p.endswith(f"match_pool_v{P.POOL_FORMAT}.pkl"))


class TestRebuildPool(FrappeTestCase):
    """rebuild_pool(): the one no-argument entry point a scheduled job calls (B4 adds the 06:00 IST entry)."""

    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="pool_rebuild_test_")
        self.path = os.path.join(self.dir, "match_pool_v1.pkl")
        self.builds = 0

    def tearDown(self):
        shutil.rmtree(self.dir, ignore_errors=True)

    def _build(self):
        self.builds += 1
        return P.Pool({"format": P.POOL_FORMAT, "rows": [], "kept": set(), "sel": {}, "nxt": {}, "as_of": "x", "secs": {},
                       "pricing": {"stamp": {"code": "c", "asset": "a"}}, "driving": {"available": True, "reason": None}})

    def test_rebuild_always_builds_and_replaces_a_fresh_file(self):
        with patch.object(P, "pool_path", return_value=self.path), patch.object(P, "build_pool", side_effect=self._build):
            P.rebuild_pool()
            first = os.path.getmtime(self.path)
            os.utime(self.path, (first - 10, first - 10))
            out = P.rebuild_pool()
        self.assertEqual(self.builds, 2)                         # a fresh file is rebuilt anyway: the daily job
        self.assertGreater(os.path.getmtime(self.path), first - 10)
        self.assertEqual(out["path"], self.path)

    def test_rebuild_waits_on_the_one_lock(self):
        with patch.object(P, "pool_path", return_value=self.path), patch.object(P, "build_pool", side_effect=self._build):
            with FileLock(self.path + ".lock"):
                with patch.object(P, "REBUILD_WAIT_SEC", 0.5):
                    with self.assertRaises(Timeout):
                        P.rebuild_pool()
        self.assertEqual(self.builds, 0)
