# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""RM-3 backend tests: the extraction runner + the suggest-run skeleton + telemetry.

Runs against the LIVE site DB (like test_rate_master / test_classify), reusing test_classify's
committed-sheet fixture helpers. NO live AI -- the Anthropic client is MOCKED everywhere; the
fail-closed paths patch the settings singleton.

Coverage map (behavior -> test):
  - population assembly: rate-editable wiring_cabling rows only, with ancestor headers        -> test_01
  - non-wiring rows + qty-less Preamble excluded                                              -> test_01
  - extraction payload/response parse (mock client): choice-vocab + number coercion           -> test_02
  - run_extraction "ran" with a mock client -> attributes + corroborated flags                -> test_03
  - regex corroborator: agree -> corroborated True; disagree/absent -> False                  -> test_03/test_04
  - fail-closed: toggle OFF -> ai_status "disabled", all-null, NO client used                 -> test_05
  - fail-closed: enabled but no key -> ai_status "no_key", all-null                            -> test_06
  - suggest worker freeze-and-supersede: new run deactivates prior; committed_version keyed    -> test_07
  - get_active_suggestion_run active-only (POS) + guest denied (NEG)                            -> test_08
  - record_rate_suggestion_event insert + validation (NEG: guest, missing field)               -> test_09
  - start_suggest D8 gate re-check (NEG: uncommitted, formulas incomplete)                      -> test_10
"""

import json
from unittest import mock

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.boq import rate_master
from nirmaan_stack.services.boq_rate_master import extraction
from nirmaan_stack.api.boq.wizard.test_classify import _FakeClient, _Resp, _new_boq, _new_sheet, _node
from nirmaan_stack.api.boq.wizard.test_review_screen import _cleanup_project, _make_project

_ROW_CATEGORY = "BoQ Row Category"
_RUN = "BoQ Rate Suggestion Run"
_EVENT = "BoQ Rate Suggestion Event"


def _fake_extract(by_row):
    """by_row: {excel_row: {attr_id: (value, confidence)}} -> a fake Anthropic client returning
    the extraction JSON array shape."""
    def responder(call, kwargs):
        arr = [
            {"id": rid, "attributes": {a: {"value": v, "confidence": c} for a, (v, c) in attrs.items()}}
            for rid, attrs in by_row.items()
        ]
        return _Resp(json.dumps(arr))
    return _FakeClient(responder)


def _insert_cat(boq, sheet_name, cv, excel_row, final_category_id, discipline="Electrical"):
    doc = frappe.new_doc(_ROW_CATEGORY)
    doc.boq = boq
    doc.sheet_name = sheet_name
    doc.excel_row = excel_row
    doc.committed_version = cv
    doc.discipline = discipline
    doc.is_current = 1
    doc.rule_category_id = final_category_id
    doc.ai_category_id = final_category_id
    doc.ai_confidence = 0.9
    doc.final_category_id = final_category_id
    doc.routing = "Auto-accepted"
    doc.routing_reason = "consensus"
    doc.description = "committed line"
    doc.prompt_version = "v1.3"
    doc.model = "claude-opus-4-8"
    doc.insert(ignore_permissions=True)


class TestRateSuggest(FrappeTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.project = _make_project()
        cls.boq = _new_boq(cls.project.name, f"RM3_{frappe.generate_hash(length=6)}")
        cls.sheet_name = "Wiring"
        cls.cv = 1
        cls.sheet_doc = _new_sheet(cls.boq, cls.sheet_name, commit_version=cls.cv)

        # Section header (Preamble, qty-less -> NOT rate-editable).
        cls.header = _node(cls.boq, cls.sheet_doc, "Preamble", 1, None, "COPPER ARMOURED CABLES", 1)
        # Rate-editable wiring Line Items under the header.
        _node(cls.boq, cls.sheet_doc, "Line Item", 2, cls.header, "3C x 2.5 sqmm cable", 2, qty=1)
        _node(cls.boq, cls.sheet_doc, "Line Item", 3, cls.header, "ALUMINIUM ARMOURED 4C x 16 sqmm cable", 3, qty=1)
        # A non-wiring Line Item (earthing) -> excluded.
        _node(cls.boq, cls.sheet_doc, "Line Item", 4, None, "GI earthing strip 25x3", 4, qty=1)
        # A qty-less Preamble classed wiring -> eligible but NOT rate-editable -> excluded.
        _node(cls.boq, cls.sheet_doc, "Preamble", 5, None, "General wiring notes", 5)
        frappe.db.commit()

        _insert_cat(cls.boq, cls.sheet_name, cls.cv, 2, "wiring_cabling")
        _insert_cat(cls.boq, cls.sheet_name, cls.cv, 3, "wiring_cabling")
        _insert_cat(cls.boq, cls.sheet_name, cls.cv, 4, "earthing")
        _insert_cat(cls.boq, cls.sheet_name, cls.cv, 5, "wiring_cabling")
        frappe.db.commit()

    @classmethod
    def tearDownClass(cls):
        for dt in (_EVENT, _RUN, _ROW_CATEGORY, "BOQ Nodes", "BoQ Sheet"):
            frappe.db.delete(dt, {"boq": cls.boq})
        frappe.db.commit()
        _cleanup_project(cls.project.name)  # deletes the BOQs + the project
        super().tearDownClass()

    # ---- population assembly ----
    def test_01_population_assembly(self):
        cv, rows = extraction.assemble_population(self.boq, self.sheet_name)
        self.assertEqual(cv, self.cv)
        got = sorted(r["excel_row"] for r in rows)
        self.assertEqual(got, [2, 3])  # wiring rate-editable Line Items only
        by_row = {r["excel_row"]: r for r in rows}
        # ancestry: the section header flows into anc_headers (section context for inheritance)
        self.assertTrue(any("COPPER ARMOURED CABLES" in h for h in by_row[2]["anc_headers"]))

    # ---- extraction parse (mock client, no live AI) ----
    def test_02_extract_batch_coercion(self):
        defs = extraction.get_extraction_attribute_defs()
        self.assertTrue(defs and any(d["id"] == "material" for d in defs))
        client = _fake_extract({
            2: {"material": ("COPPER", 0.9), "insulation": ("ARMOURED", 0.9),
                "core": (3, 0.9), "thickness_sqmm": (2.5, 0.9),
                # an out-of-vocab choice must be blanked to None:
                },
            3: {"material": ("Titanium", 0.4), "core": ("4", 0.8), "thickness_sqmm": (16, 0.9)},
        })
        _cv, rows = extraction.assemble_population(self.boq, self.sheet_name)
        out = extraction._extract_batch(client, "m", "P", defs, rows)
        self.assertEqual(out[2]["material"]["value"], "COPPER")
        self.assertEqual(out[2]["core"]["value"], 3)  # number coerced to int
        # out-of-vocab choice -> None
        self.assertIsNone(out[3]["material"]["value"])
        self.assertEqual(out[3]["core"]["value"], 4)  # "4" string -> 4

    # ---- run_extraction "ran" + corroborator ----
    def test_03_run_extraction_ran_and_corroborate(self):
        client = _fake_extract({
            2: {"material": ("COPPER", 0.95), "insulation": ("ARMOURED", 0.9),
                "core": (3, 0.9), "thickness_sqmm": (2.5, 0.9)},
            3: {"material": ("ALUMINIUM", 0.9), "insulation": ("ARMOURED", 0.9),
                "core": (4, 0.9), "thickness_sqmm": (16, 0.9)},
        })
        env = extraction.run_extraction(self.boq, self.sheet_name, client=client)
        self.assertEqual(env["ai_status"], "ran")
        self.assertEqual(env["committed_version"], self.cv)
        r2 = next(r for r in env["results"] if r["excel_row"] == 2)
        # row 2 inherits material/insulation from the "COPPER ARMOURED CABLES" header ->
        # the regex reads them from anc_headers and AGREES -> corroborated True.
        self.assertEqual(r2["attributes"]["material"]["value"], "COPPER")
        self.assertTrue(r2["attributes"]["material"]["corroborated"])
        self.assertTrue(r2["attributes"]["insulation"]["corroborated"])
        # core/thickness from the row's own "3C x 2.5" -> regex agrees -> corroborated
        self.assertTrue(r2["attributes"]["core"]["corroborated"])
        self.assertTrue(r2["attributes"]["thickness_sqmm"]["corroborated"])

    def test_04_corroborator_disagreement(self):
        # AI says thickness 99 but row 2 text ("3C x 2.5 sqmm") reads 2.5 -> disagree -> NOT
        # corroborated. Material still corroborates (the header supplies COPPER).
        client = _fake_extract({
            2: {"material": ("COPPER", 0.9), "insulation": ("ARMOURED", 0.9),
                "core": (3, 0.9), "thickness_sqmm": (99, 0.5)},
            3: {"material": ("ALUMINIUM", 0.9), "insulation": ("ARMOURED", 0.9),
                "core": (4, 0.9), "thickness_sqmm": (16, 0.9)},
        })
        env = extraction.run_extraction(self.boq, self.sheet_name, client=client)
        r2 = next(r for r in env["results"] if r["excel_row"] == 2)
        self.assertEqual(r2["attributes"]["thickness_sqmm"]["value"], 99)
        self.assertFalse(r2["attributes"]["thickness_sqmm"]["corroborated"])  # regex reads 2.5
        self.assertTrue(r2["attributes"]["material"]["corroborated"])  # header COPPER agrees

    # ---- fail-closed ----
    def test_05_fail_closed_disabled(self):
        with mock.patch(
            "nirmaan_stack.api.boq.wizard.ai_settings.get_boq_ai_settings",
            return_value={"enabled": False, "model": "m"},
        ):
            client = _fake_extract({2: {"material": ("COPPER", 1.0)}})
            env = extraction.run_extraction(self.boq, self.sheet_name, client=client)
        self.assertEqual(env["ai_status"], "disabled")
        # blank rows: every attribute null, and the mock client was NOT consulted
        self.assertEqual(client.messages.calls, 0)
        r2 = next(r for r in env["results"] if r["excel_row"] == 2)
        self.assertIsNone(r2["attributes"]["material"]["value"])

    def test_06_fail_closed_no_key(self):
        with mock.patch(
            "nirmaan_stack.api.boq.wizard.ai_settings.get_boq_ai_settings",
            return_value={"enabled": True, "model": "m"},
        ), mock.patch(
            "nirmaan_stack.api.boq.wizard.ai_settings.get_boq_ai_api_key", return_value=None
        ):
            env = extraction.run_extraction(self.boq, self.sheet_name)  # client None -> key read
        self.assertEqual(env["ai_status"], "no_key")
        r2 = next(r for r in env["results"] if r["excel_row"] == 2)
        self.assertIsNone(r2["attributes"]["material"]["value"])

    # ---- worker freeze-and-supersede ----
    def test_07_worker_freeze_and_supersede(self):
        # a prior active run for this sheet
        prior = frappe.new_doc(_RUN)
        prior.boq = self.boq
        prior.sheet_name = self.sheet_name
        prior.committed_version = self.cv
        prior.run_id = "prior-run"
        prior.ai_status = "ran"
        prior.results = "[]"
        prior.active = 1
        prior.insert(ignore_permissions=True)
        frappe.db.commit()

        canned = {
            "committed_version": self.cv, "ai_status": "ran", "model": "m",
            "category_id": "wiring_cabling", "attribute_definitions": [],
            "results": [{"excel_row": 2, "description": "d", "attributes": {}}],
        }
        with mock.patch(
            "nirmaan_stack.services.boq_rate_master.extraction.run_extraction", return_value=canned
        ):
            rate_master._suggest_worker(boq=self.boq, sheet_name=self.sheet_name, user="Administrator")

        active = frappe.get_all(
            _RUN, filters={"boq": self.boq, "sheet_name": self.sheet_name, "active": 1},
            fields=["name", "run_id", "committed_version"],
        )
        self.assertEqual(len(active), 1)  # exactly one active
        self.assertNotEqual(active[0]["run_id"], "prior-run")  # superseded
        self.assertEqual(active[0]["committed_version"], self.cv)  # version keyed
        # prior retained but inactive
        self.assertEqual(frappe.db.get_value(_RUN, {"run_id": "prior-run"}, "active"), 0)
        self.assertEqual(frappe.db.count(_RUN, {"boq": self.boq, "sheet_name": self.sheet_name}), 2)

    # ---- read endpoint ----
    def test_08_get_active_run_and_guest_denied(self):
        res = rate_master.get_active_suggestion_run(self.boq, self.sheet_name)
        self.assertIsNotNone(res["run"])
        self.assertEqual(res["run"]["committed_version"], self.cv)
        self.assertIsInstance(res["run"]["results"], list)
        original = frappe.session.user
        try:
            frappe.set_user("Guest")
            with self.assertRaises(frappe.PermissionError):
                rate_master.get_active_suggestion_run(self.boq, self.sheet_name)
        finally:
            frappe.set_user(original)

    # ---- telemetry ----
    def test_09_record_event_and_negatives(self):
        res = rate_master.record_rate_suggestion_event(
            boq=self.boq, sheet_name=self.sheet_name, excel_row=2, col="H", kind="supply_rate",
            helper_id="pricing_sheet", category_id="wiring_cabling", run_id="r1",
            extracted_attributes={"material": "COPPER"}, corrected_attributes={"material": "COPPER"},
            computed_value=120, used_value=120,
        )
        self.assertTrue(res["ok"])
        ev = frappe.get_all(_EVENT, filters={"boq": self.boq, "excel_row": 2},
                            fields=["kind", "used_value", "run_id", "event_user"])
        self.assertTrue(ev)
        self.assertEqual(ev[0]["kind"], "supply_rate")
        self.assertEqual(ev[0]["used_value"], 120)
        # NEG: missing excel_row
        with self.assertRaises(frappe.ValidationError):
            rate_master.record_rate_suggestion_event(boq=self.boq, sheet_name=self.sheet_name)
        # NEG: guest denied
        original = frappe.session.user
        try:
            frappe.set_user("Guest")
            with self.assertRaises(frappe.PermissionError):
                rate_master.record_rate_suggestion_event(
                    boq=self.boq, sheet_name=self.sheet_name, excel_row=2
                )
        finally:
            frappe.set_user(original)

    # ---- start_suggest D8 gate (negatives) ----
    def test_10_start_suggest_gate_negatives(self):
        # NEG: uncommitted sheet -> throws before the gate (never enqueues).
        with self.assertRaises(frappe.ValidationError):
            rate_master.start_suggest(boq=self.boq, sheet_name="NoSuchSheet")
        # NEG: the D8 gate is re-checked server-side -> a locked sheet throws BEFORE enqueue.
        # (Patch the shared lock reader so the gate trips deterministically without a real enqueue.)
        with mock.patch(
            "nirmaan_stack.api.boq.wizard.pricing._get_sheet_is_locked", return_value=1
        ):
            with self.assertRaises(frappe.ValidationError):
                rate_master.start_suggest(boq=self.boq, sheet_name=self.sheet_name)
