# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt
"""Tests for the server pricing step's Python side (DEV2-B2, T1). Fixtures only: each test writes a small FAKE bundle
(a few lines of JavaScript) and its stamp into a temp folder, so the plumbing is tested apart from the real bundle (the
real bundle's output is proved equal to the browser's pricing source by the Parity 1 vitest,
frontend/src/pages/boq-wizard/rate-helper/serverPricingStep.parity.test.ts). No database write.

  output returned      the bundle's rows come back keyed, with signature, values after the rules and the stamp
  fails closed         missing bundle / missing stamp / unreadable stamp / stamp not matching the bundle / node missing /
                       node exits with an error / node crashes / timeout -> available False with the reason, never a raise
  stale -> recomputed  a stored value whose stamp differs (code or asset) is recomputed; a current one is kept as is
  driving fields      the bundle's measureDrivingFields lists come back per category; the step unavailable -> no lists;
                      (DEV2-B4) no sample is sent by default (every stored row); a caller's int is sent
"""
import hashlib
import json
import os
import shutil
import tempfile
from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.services.boq_rate_match import pricing_step as ps

ECHO = """
const c = []; process.stdin.on("data", (d) => c.push(d)); process.stdin.on("end", () => {
  const input = JSON.parse(Buffer.concat(c).toString("utf8"));
  if (input.mode === "driving") {
    process.stdout.write(JSON.stringify({ ok: true, categories: { wiring_cabling: { rows: input.rows.length, pricedRows: 2, sampled: Math.min(2, input.sample),
      fields: [{ id: "core", cls: "needed" }, { id: "brand", cls: "not needed" }], driving: ["core"] } } }));
    return;
  }
  const rows = input.rows.map((r) => ({ key: `${r.boq}|${r.sheet_name}|${r.excel_row}`,
    rec: { signature: "SIG:" + r.excel_row, values: { supply_rate: r.excel_row * 10 }, priced: true, cat: r.resolved_category },
    ac7: { key: `${r.boq}|${r.sheet_name}|${r.excel_row}` } }));
  process.stdout.write(JSON.stringify({ ok: true, rows, seen_configs: Object.keys(input.configs || {}) }));
});
"""
SAMPLE_ECHO = """
const c = []; process.stdin.on("data", (d) => c.push(d)); process.stdin.on("end", () => {
  const input = JSON.parse(Buffer.concat(c).toString("utf8"));
  const sent = "sample" in input ? input.sample : false;
  process.stdout.write(JSON.stringify({ ok: true, categories: { wiring_cabling: { rows: input.rows.length, pricedRows: 2,
    sampled: 2, sample_sent: sent, fields: [], driving: [] } } }));
});
"""
FAIL = """process.stdout.write(JSON.stringify({ ok: false, error: "boom in the pricer" })); process.exitCode = 1;"""
CRASH = """throw new Error("syntax of a broken bundle");"""
SLOW = """setTimeout(() => process.stdout.write(JSON.stringify({ ok: true, rows: [] })), 5000);"""

ASSET = ({"configs": {"wiring_cabling": {"category_id": "wiring_cabling"}}, "itemsByDiscipline": {"Electrical": []}}, "BRMS-TEST:0123456789abcdef")
ROWS = [{"boq": "B1", "sheet_name": "S", "excel_row": 7, "resolved_category": "wiring_cabling"},
        {"boq": "B1", "sheet_name": "S", "excel_row": 8, "resolved_category": "wiring_cabling"}]


class TestPricingStep(FrappeTestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="pricing_step_test_")

    def tearDown(self):
        shutil.rmtree(self.dir, ignore_errors=True)

    def _bundle(self, js, stamp=None, code="code-A"):
        path = os.path.join(self.dir, ps.BUNDLE)
        with open(path, "w", encoding="utf-8") as f:
            f.write(js)
        with open(path, "rb") as f:
            digest = hashlib.sha256(f.read()).hexdigest()
        st = stamp if stamp is not None else {"code_hash": code, "bundle_sha256": digest}
        with open(os.path.join(self.dir, ps.STAMP), "w", encoding="utf-8") as f:
            f.write(st if isinstance(st, str) else json.dumps(st))

    # ---- output returned ----
    def test_bundle_output_returned_with_signature_values_and_stamp(self):
        self._bundle(ECHO)
        res = ps.price_rows({}, ROWS, asset=ASSET, build_dir=self.dir)
        self.assertTrue(res["available"], res["reason"])
        self.assertEqual(res["stamp"], {"code": "code-A", "asset": "BRMS-TEST:0123456789abcdef"})
        self.assertEqual(sorted(res["rows"]), ["B1|S|7", "B1|S|8"])
        r = res["rows"]["B1|S|7"]
        self.assertEqual(r["signature"], "SIG:7")
        self.assertEqual(r["values_after_rules"], {"supply_rate": 70})
        self.assertTrue(r["priced"])
        self.assertEqual(r["stamp"], res["stamp"])

    # ---- fails closed ----
    def test_missing_bundle_is_unavailable_with_reason(self):
        res = ps.price_rows({}, ROWS, asset=ASSET, build_dir=self.dir)
        self.assertFalse(res["available"])
        self.assertIn("bundle missing", res["reason"])
        self.assertEqual(res["rows"], {})

    def test_missing_stamp_is_unavailable(self):
        self._bundle(ECHO)
        os.remove(os.path.join(self.dir, ps.STAMP))
        res = ps.price_rows({}, ROWS, asset=ASSET, build_dir=self.dir)
        self.assertFalse(res["available"])
        self.assertIn("stamp missing", res["reason"])

    def test_unreadable_stamp_is_unavailable(self):
        self._bundle(ECHO, stamp="{not json")
        res = ps.price_rows({}, ROWS, asset=ASSET, build_dir=self.dir)
        self.assertFalse(res["available"])
        self.assertIn("stamp unreadable", res["reason"])

    def test_stamp_without_code_hash_is_unavailable(self):
        self._bundle(ECHO, stamp={"bundle_sha256": "x"})
        res = ps.price_rows({}, ROWS, asset=ASSET, build_dir=self.dir)
        self.assertFalse(res["available"])
        self.assertIn("no code_hash", res["reason"])

    def test_stamp_not_matching_the_bundle_bytes_is_unavailable(self):
        self._bundle(ECHO)
        with open(os.path.join(self.dir, ps.BUNDLE), "a", encoding="utf-8") as f:
            f.write("\n// edited after the build\n")
        res = ps.price_rows({}, ROWS, asset=ASSET, build_dir=self.dir)
        self.assertFalse(res["available"])
        self.assertIn("does not match the bundle", res["reason"])

    def test_node_missing_is_unavailable(self):
        self._bundle(ECHO)
        with patch.object(ps.shutil, "which", return_value=None):
            res = ps.price_rows({}, ROWS, asset=ASSET, build_dir=self.dir)
        self.assertFalse(res["available"])
        self.assertIn("node not found", res["reason"])

    def test_node_error_is_unavailable_with_the_bundles_message(self):
        self._bundle(FAIL)
        res = ps.price_rows({}, ROWS, asset=ASSET, build_dir=self.dir)
        self.assertFalse(res["available"])
        self.assertIn("boom in the pricer", res["reason"])

    def test_node_crash_is_unavailable_never_a_raise(self):
        self._bundle(CRASH)
        res = ps.price_rows({}, ROWS, asset=ASSET, build_dir=self.dir)
        self.assertFalse(res["available"])
        self.assertIn("pricing step failed", res["reason"])

    def test_timeout_is_unavailable(self):
        self._bundle(SLOW)
        res = ps.price_rows({}, ROWS, asset=ASSET, build_dir=self.dir, timeout=1)
        self.assertFalse(res["available"])
        self.assertIn("timed out", res["reason"])

    def test_an_asset_loader_error_is_unavailable_never_a_raise(self):
        self._bundle(ECHO)
        with patch.object(ps, "load_asset", side_effect=RuntimeError("db gone")):
            res = ps.price_rows({}, ROWS, build_dir=self.dir)
        self.assertFalse(res["available"])
        self.assertIn("db gone", res["reason"])

    # ---- stale -> recomputed ----
    def test_stale_stamp_is_recomputed_and_current_is_kept(self):
        self._bundle(ECHO)
        current = {"code": "code-A", "asset": ASSET[1]}
        kept = {"signature": "KEPT", "values_after_rules": {"supply_rate": 1}, "stamp": current}
        stored = {
            "B1|S|7": kept,
            "B1|S|8": {"signature": "OLD", "values_after_rules": {"supply_rate": 2}, "stamp": {"code": "code-OLD", "asset": ASSET[1]}},
        }
        res = ps.ensure_current(stored, {}, ROWS, asset=ASSET, build_dir=self.dir)
        self.assertTrue(res["available"], res["reason"])
        self.assertEqual(res["recomputed"], ["B1|S|8"])
        self.assertIs(res["rows"]["B1|S|7"], kept)
        self.assertEqual(res["rows"]["B1|S|8"]["signature"], "SIG:8")
        self.assertEqual(res["rows"]["B1|S|8"]["stamp"], current)

    def test_a_new_asset_version_makes_every_value_stale(self):
        self._bundle(ECHO)
        stored = {f"B1|S|{n}": {"signature": "OLD", "stamp": {"code": "code-A", "asset": "BRMS-OLD:ffff"}} for n in (7, 8)}
        res = ps.ensure_current(stored, {}, ROWS, asset=ASSET, build_dir=self.dir)
        self.assertEqual(res["recomputed"], ["B1|S|7", "B1|S|8"])

    def test_all_current_runs_no_bundle_call(self):
        self._bundle(ECHO)
        current = {"code": "code-A", "asset": ASSET[1]}
        stored = {f"B1|S|{n}": {"signature": "KEPT", "stamp": current} for n in (7, 8)}
        with patch.object(ps, "_run_bundle", side_effect=AssertionError("the bundle must not run")) as run:
            res = ps.ensure_current(stored, {}, ROWS, asset=ASSET, build_dir=self.dir)
        self.assertEqual(res["recomputed"], [])
        run.assert_not_called()

    def test_is_stale(self):
        st = {"code": "a", "asset": "v1"}
        self.assertFalse(ps.is_stale({"code": "a", "asset": "v1"}, st))
        self.assertTrue(ps.is_stale({"code": "b", "asset": "v1"}, st))
        self.assertTrue(ps.is_stale({"code": "a", "asset": "v2"}, st))
        self.assertTrue(ps.is_stale(None, st))

    # ---- the asset as the browser reads it (READ ONLY) ----
    def test_load_asset_reads_through_the_browsers_endpoints(self):
        frappe.set_user("Administrator")
        from nirmaan_stack.api.boq import rate_master
        calls = []
        real = rate_master.get_rate_master_items

        def spy(discipline=None, kind=None):
            calls.append(discipline)
            return real(discipline=discipline, kind=kind)

        with patch.object(rate_master, "get_rate_master_items", side_effect=spy):
            payload, version = ps.load_asset()
        self.assertEqual(sorted(calls), sorted(payload["itemsByDiscipline"]))
        self.assertTrue(calls)
        self.assertRegex(version, r"^.+:[0-9a-f]{16}$")
        # the browser's projection is present: an item with a brand column carries it in attributes
        branded = [it for items in payload["itemsByDiscipline"].values() for it in items if (it.get("brand") or "").strip()]
        if branded:
            self.assertEqual(branded[0]["attributes"].get("brand"), branded[0]["brand"].strip())


class TestDrivingFieldMeasure(FrappeTestCase):
    """measure_driving_fields: the pricer's own measurement of the price-driving fields (owner answer 3, Q4 (A))."""
    setUp = TestPricingStep.setUp
    tearDown = TestPricingStep.tearDown
    _bundle = TestPricingStep._bundle

    def test_the_bundles_lists_come_back_per_category(self):
        self._bundle(ECHO)
        res = ps.measure_driving_fields({}, ROWS, asset=ASSET, sample=400, build_dir=self.dir)
        self.assertTrue(res["available"], res["reason"])
        self.assertEqual(res["lists"], {"wiring_cabling": ["core"]})
        self.assertEqual(res["categories"]["wiring_cabling"]["sampled"], 2)
        self.assertEqual(res["stamp"], {"code": "code-A", "asset": ASSET[1]})

    def test_the_default_sends_no_sample_so_every_row_is_measured(self):
        # DEV2-B4 (rule (iii) on ALL stored rows): no "sample" key reaches the bundle unless a caller passes one
        self._bundle(SAMPLE_ECHO)
        res = ps.measure_driving_fields({}, ROWS, asset=ASSET, build_dir=self.dir)
        self.assertTrue(res["available"], res["reason"])
        self.assertEqual(res["categories"]["wiring_cabling"]["sample_sent"], False)
        self.assertIsNone(ps.DRIVING_SAMPLE)
        res = ps.measure_driving_fields({}, ROWS, asset=ASSET, sample=30, build_dir=self.dir)
        self.assertEqual(res["categories"]["wiring_cabling"]["sample_sent"], 30)

    def test_unavailable_gives_no_lists_never_a_raise(self):
        res = ps.measure_driving_fields({}, ROWS, asset=ASSET, build_dir=self.dir)      # no bundle
        self.assertFalse(res["available"])
        self.assertIn("bundle missing", res["reason"])
        self.assertEqual(res["lists"], {})
        self._bundle(FAIL)
        res = ps.measure_driving_fields({}, ROWS, asset=ASSET, build_dir=self.dir)
        self.assertFalse(res["available"])
        self.assertIn("boom in the pricer", res["reason"])
