# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""RM-3 backend tests: the extraction runner + the suggest-run skeleton + telemetry.

Runs against the LIVE site DB (like test_rate_master / test_classify), reusing test_classify's
committed-sheet fixture helpers. NO live AI -- the Anthropic client is MOCKED everywhere; the
fail-closed paths patch the settings singleton.

Coverage map (behavior -> test):
  - EA-2 population: rate-editable rows across ALL eligible categories, each category_id-tagged -> test_01
  - qty-less Preamble excluded (not rate-editable)                                             -> test_01
  - EA-2 N-category run: identity mode + live-catalog injection + prompt mode-switch;
    LMS (empty pipelines) + blank category excluded; results carry category_id; catalog coercion -> test_11
  - extraction payload/response parse (mock client): choice-vocab + number coercion           -> test_02
  - run_extraction "ran" with a mock client -> attributes + corroborated flags                -> test_03
  - regex corroborator: agree -> corroborated True; disagree/absent -> False                  -> test_03/test_04
  - fail-closed: toggle OFF -> ai_status "disabled", all-null, NO client used                 -> test_05
  - fail-closed: enabled but no key -> ai_status "no_key", all-null                            -> test_06
  - suggest worker freeze-and-supersede: new run deactivates prior; committed_version keyed    -> test_07
  - get_active_suggestion_run active-only (POS) + guest denied (NEG)                            -> test_08
  - record_rate_suggestion_event insert + validation (NEG: guest, missing field)               -> test_09
  - start_suggest D8 gate re-check (NEG: uncommitted, formulas incomplete)                      -> test_10
  - EA-DIFF synonyms: injected into the prompt payload when configured, absent otherwise;
    _coerce_value maps variant->canonical (GI->MS); a non-configured category is untouched       -> test_12
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


def _j(value):
    """A Frappe JSON field comes back ALREADY PARSED on PostgreSQL (list/dict), but as a str on
    some paths -- normalize either way. Mirrors test_row_category._as_obj."""
    return json.loads(value) if isinstance(value, str) else value


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
        # EA-2: the population spans EVERY eligible category -- the wiring Line Items 2/3 AND the
        # earthing Line Item 4 (earthing is an eligible config: non-empty pipelines + defs). Row 5 is
        # a qty-less Preamble (not rate-editable) -> excluded. (Pre-EA-2 this returned [2, 3] only.)
        self.assertEqual(got, [2, 3, 4])
        by_row = {r["excel_row"]: r for r in rows}
        self.assertEqual(by_row[2]["category_id"], "wiring_cabling")
        self.assertEqual(by_row[4]["category_id"], "earthing")
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

    # ---- EA-2: N-category population + item-identity mode (uses the live v6 Electrical configs) ----
    def test_11_ea2_multicategory_and_identity(self):
        sheet = "MultiCat"
        sd = _new_sheet(self.boq, sheet, commit_version=1)
        hdr = _node(self.boq, sd, "Preamble", 20, None, "SWITCHES AND SOCKETS", 20)
        _node(self.boq, sd, "Line Item", 21, hdr, "10A 1 way switch", 21, qty=1)          # switches (identity)
        _node(self.boq, sd, "Line Item", 22, None, "25mm dia FRLS PVC conduit", 22, qty=1)  # conduit (attribute)
        _node(self.boq, sd, "Line Item", 23, None, "Wireless occupancy sensor ceiling mount", 23, qty=1)  # LMS
        _node(self.boq, sd, "Line Item", 24, None, "Totally uncategorised widget", 24, qty=1)  # blank
        frappe.db.commit()
        _insert_cat(self.boq, sheet, 1, 21, "switches_sockets")
        _insert_cat(self.boq, sheet, 1, 22, "conduit_piping")
        _insert_cat(self.boq, sheet, 1, 23, "lighting_mgmt_system")  # empty pipelines -> NOT eligible
        # row 24: no BoQ Row Category -> blank -> excluded
        frappe.db.commit()

        # (a) population spans switches + conduit ONLY; LMS (empty pipelines) + blank excluded
        cv, rows = extraction.assemble_population(self.boq, sheet)
        self.assertEqual(cv, 1)
        cats = {r["excel_row"]: r["category_id"] for r in rows}
        self.assertEqual(cats, {21: "switches_sockets", 22: "conduit_piping"})

        # (b) the switches config is item-identity: identity flag + LIVE catalog injected (not hardcoded)
        configs = extraction._load_active_configs({"Electrical"})
        sw_cfg = configs[("Electrical", "switches_sockets")]
        catalog = extraction.catalog_values("Electrical", sw_cfg)
        self.assertIn("10A 1 WAY SWITCH", catalog)  # sourced from the active master items
        sw_defs = extraction.build_attribute_defs(sw_cfg, catalog)
        iden = [d for d in sw_defs if d.get("identity")]
        self.assertEqual(len(iden), 1)
        self.assertEqual(iden[0]["id"], "item")
        self.assertEqual(iden[0]["values"], catalog)

        # (c) the MODE SWITCH: identity prompt for switches, attribute prompt for conduit
        self.assertIn("rate-item catalog", extraction.select_prompt_text(sw_cfg))
        conduit_cfg = configs[("Electrical", "conduit_piping")]
        self.assertNotIn("rate-item catalog", extraction.select_prompt_text(conduit_cfg))

        # (d) a full run (mock client): an identity value IN the catalog is kept; results carry category_id
        client = _fake_extract({
            21: {"item": ("10A 1 WAY SWITCH", 0.9)},
            22: {"size_mm": (25, 0.9)},
        })
        env = extraction.run_extraction(self.boq, sheet, client=client)
        self.assertEqual(env["ai_status"], "ran")
        r21 = next(r for r in env["results"] if r["excel_row"] == 21)
        self.assertEqual(r21["category_id"], "switches_sockets")
        self.assertEqual(r21["attributes"]["item"]["value"], "10A 1 WAY SWITCH")
        r22 = next(r for r in env["results"] if r["excel_row"] == 22)
        self.assertEqual(r22["category_id"], "conduit_piping")

        # (e) NEGATIVE: an identity value NOT in the catalog coerces to None (unknown / refuse-composite)
        client2 = _fake_extract({21: {"item": ("NONEXISTENT WIDGET", 0.9)}, 22: {"size_mm": (25, 0.9)}})
        env2 = extraction.run_extraction(self.boq, sheet, client=client2)
        r21b = next(r for r in env2["results"] if r["excel_row"] == 21)
        self.assertIsNone(r21b["attributes"]["item"]["value"])

    # ---- EA-DIFF: synonyms injection + coercion (GI -> MS for conduit_type) ----
    def test_12_ea_diff_synonyms(self):
        # (a) _coerce_value maps a configured variant to its canonical BEFORE the allowed-values check.
        defn = {"id": "conduit_type", "type": "choice", "values": ["PVC", "MS"]}
        # WITHOUT synonyms: a variant "GI" is out-of-vocab -> None (honest blank).
        self.assertIsNone(extraction._coerce_value(defn, "GI"))
        # WITH synonyms {GI: MS}: "GI" maps to the canonical "MS" and passes the vocab check.
        self.assertEqual(extraction._coerce_value(defn, "GI", {"GI": "MS"}), "MS")
        # a canonical value is unaffected; an unmapped out-of-vocab value still blanks.
        self.assertEqual(extraction._coerce_value(defn, "MS", {"GI": "MS"}), "MS")
        self.assertIsNone(extraction._coerce_value(defn, "COPPER", {"GI": "MS"}))

        # (b) _extract_batch INJECTS a SYNONYMS section into the prompt payload when configured, and the
        # returned variant is coerced to the canonical. Capture the content the client received.
        sink = []

        def responder(call, kwargs):
            sink.append(kwargs["messages"][0]["content"])
            return _Resp(json.dumps([{"id": 22, "attributes": {"conduit_type": {"value": "GI", "confidence": 0.9}}}]))

        client = _FakeClient(responder)
        rows = [{"excel_row": 22, "description": "25mm dia GI conduit", "anc_headers": [], "anc_texts": []}]
        out = extraction._extract_batch(client, "m", "P", [defn], rows, {"conduit_type": {"GI": "MS"}})
        self.assertIn("SYNONYMS", sink[0])
        self.assertIn('"GI"', sink[0])
        self.assertEqual(out[22]["conduit_type"]["value"], "MS")  # variant coerced to canonical

        # (c) NEGATIVE: a non-configured category (synonyms=None, the default) is byte-untouched --
        # NO SYNONYMS section, and the out-of-vocab "GI" blanks honestly.
        sink2 = []

        def responder2(call, kwargs):
            sink2.append(kwargs["messages"][0]["content"])
            return _Resp(json.dumps([{"id": 22, "attributes": {"conduit_type": {"value": "GI", "confidence": 0.9}}}]))

        out2 = extraction._extract_batch(_FakeClient(responder2), "m", "P", [defn], rows)
        self.assertNotIn("SYNONYMS", sink2[0])
        self.assertIsNone(out2[22]["conduit_type"]["value"])

    # ================= SR-1: checkpointing / partial / resume / halt =================
    # Fixture note: the population is rows 2,3 (wiring_cabling) + row 4 (earthing) -> TWO
    # single-category batches. Failing the SECOND call therefore halts after batch 1 has been
    # checkpointed, which is exactly the "batch 7 of 10 fails" shape SR-1 exists to fix.

    def _reset_runs(self):
        frappe.db.delete(_RUN, {"boq": self.boq, "sheet_name": self.sheet_name})
        frappe.db.commit()

    def _prior_complete_run(self, run_id="prior-complete"):
        doc = frappe.new_doc(_RUN)
        doc.boq = self.boq
        doc.sheet_name = self.sheet_name
        doc.committed_version = self.cv
        doc.run_id = run_id
        doc.ai_status = "ran"
        doc.status = "complete"
        doc.results = json.dumps([{"excel_row": 2, "description": "prior", "attributes": {}}])
        doc.attempted_rows = json.dumps([2, 3, 4])
        doc.active = 1
        doc.insert(ignore_permissions=True)
        frappe.db.commit()
        return doc.name

    def _run_worker_with(self, client, resume_run_id=None):
        """Drive the real worker but force the injected fake client (never a live Anthropic)."""
        real = extraction.run_extraction

        def _with_client(boq, sheet_name, **kw):
            kw.pop("client", None)
            return real(boq, sheet_name, client=client, **kw)

        with mock.patch.object(extraction, "run_extraction", side_effect=_with_client):
            rate_master._suggest_worker(
                boq=self.boq, sheet_name=self.sheet_name, user="Administrator",
                resume_run_id=resume_run_id,
            )

    def _failing_after_first_batch(self, error):
        """Batch 1 answers normally; batch 2 raises `error`."""
        def responder(call, kwargs):
            if call == 1:
                return _Resp(json.dumps([
                    {"id": 2, "attributes": {"material": {"value": "COPPER", "confidence": 0.9}}},
                    {"id": 3, "attributes": {"material": {"value": "ALUMINIUM", "confidence": 0.9}}},
                ]))
            raise error
        return _FakeClient(responder)

    def test_13_mid_run_failure_saves_partial_and_keeps_prior_complete(self):
        """THE CORE FIX: batch 1's rows are PERSISTED when batch 2 fails (pre-SR-1 they were
        discarded), the run is partial/active=0, and the prior COMPLETE run stays live."""
        self._reset_runs()
        prior_name = self._prior_complete_run()

        client = self._failing_after_first_batch(
            RuntimeError("Error code 400: reached your specified API usage limits")
        )
        self._run_worker_with(client)

        new = frappe.get_all(
            _RUN, filters={"boq": self.boq, "sheet_name": self.sheet_name, "status": "partial"},
            fields=["name", "run_id", "status", "active", "results", "attempted_rows", "halt_reason"],
        )
        self.assertEqual(len(new), 1, "exactly one partial run")
        p = new[0]

        # (a) the completed batch SURVIVED the failure
        saved = _j(p["results"])
        self.assertEqual(sorted(r["excel_row"] for r in saved), [2, 3])
        self.assertEqual(saved[0]["attributes"]["material"]["value"], "COPPER")

        # (b) attempted_rows is the done-marker: row 4 (the halted batch) stays PENDING
        self.assertEqual(_j(p["attempted_rows"]), [2, 3])

        # (c) R-SUPERSEDE: the partial did NOT supersede the prior complete run
        self.assertEqual(p["active"], 0, "a partial must never be active")
        self.assertEqual(frappe.db.get_value(_RUN, prior_name, "active"), 1)
        active = rate_master.get_active_suggestion_run(self.boq, self.sheet_name)
        self.assertEqual(active["run"]["run_id"], "prior-complete",
                         "the editor must still read the prior COMPLETE run")
        self.assertEqual(active["run"]["status"], "complete")

        # (d) R-USE-GATE input + a CLEAR halt reason (never the opaque "suggest_failed")
        self.assertEqual(active["partial_run"]["run_id"], p["run_id"])
        self.assertEqual(active["partial_run"]["attempted_count"], 2)
        self.assertIn("usage limit", (p["halt_reason"] or "").lower())
        self.assertNotIn("suggest_failed", (p["halt_reason"] or ""))

    def test_14_resume_completes_the_same_run_and_only_pending_rows(self):
        """R-RESUME-SAME-RUN: the resume fills ONLY the pending row, completes the SAME doc/run_id,
        and only THEN goes active (superseding the prior complete run). No second run doc."""
        self._reset_runs()
        prior_name = self._prior_complete_run()
        self._run_worker_with(
            self._failing_after_first_batch(
                RuntimeError("Error code 400: reached your specified API usage limits")
            )
        )
        partial = frappe.get_all(
            _RUN, filters={"boq": self.boq, "sheet_name": self.sheet_name, "status": "partial"},
            fields=["name", "run_id"],
        )[0]
        count_before = frappe.db.count(_RUN, {"boq": self.boq, "sheet_name": self.sheet_name})

        seen = []

        def responder(call, kwargs):
            seen.append(kwargs["messages"][0]["content"])
            return _Resp(json.dumps([{"id": 4, "attributes": {}}]))

        self._run_worker_with(_FakeClient(responder), resume_run_id=partial["run_id"])

        # (a) ONLY the pending row was sent -- one batch, containing id 4 and not id 2
        self.assertEqual(len(seen), 1, "resume must send exactly one batch (the pending row)")
        self.assertIn('"id": 4', seen[0])
        self.assertNotIn('"id": 2', seen[0])

        # (b) the SAME doc completed -- no second run was created
        self.assertEqual(frappe.db.count(_RUN, {"boq": self.boq, "sheet_name": self.sheet_name}),
                         count_before, "resume must not spawn a second run doc")
        row = frappe.db.get_value(
            _RUN, partial["name"],
            ["run_id", "status", "active", "attempted_rows", "results", "halt_reason"],
            as_dict=True,
        )
        self.assertEqual(row["run_id"], partial["run_id"], "same run_id")
        self.assertEqual(row["status"], "complete")
        self.assertIsNone(row["halt_reason"], "a completed run carries no halt reason")

        # (c) the resume MERGED -- batch 1's rows were not lost
        self.assertEqual(_j(row["attempted_rows"]), [2, 3, 4])
        self.assertEqual(sorted(r["excel_row"] for r in _j(row["results"])), [2, 3, 4])

        # (d) NOW it supersedes the prior complete run (and only now)
        self.assertEqual(row["active"], 1)
        self.assertEqual(frappe.db.get_value(_RUN, prior_name, "active"), 0)
        active = rate_master.get_active_suggestion_run(self.boq, self.sheet_name)
        self.assertEqual(active["run"]["run_id"], partial["run_id"])
        self.assertIsNone(active["partial_run"], "no partial remains once it completed")

    def test_15_usage_limit_fast_fails_without_retrying(self):
        """A terminal 400 must NOT burn the 3x retry + 6s of sleep -- it cannot clear in six
        seconds. Asserted on the call count AND on time.sleep never being called."""
        self._reset_runs()
        client = self._failing_after_first_batch(
            RuntimeError("Error code 400: reached your specified API usage limits, regain 2026-08-01")
        )
        with mock.patch("nirmaan_stack.services.boq_rate_master.extraction.time.sleep") as slept:
            self._run_worker_with(client)
        self.assertEqual(client.messages.calls, 2,
                         "batch 1 + ONE terminal attempt -- no retries on a usage limit")
        slept.assert_not_called()
        p = frappe.get_all(_RUN, filters={"boq": self.boq, "status": "partial"},
                           fields=["halt_reason", "attempted_rows"])[0]
        self.assertIn("usage limit", p["halt_reason"].lower())
        self.assertEqual(_j(p["attempted_rows"]), [2, 3], "the completed batch was kept")

    def test_16_transient_error_still_retries_unchanged(self):
        """NEGATIVE control: a transient marker (529 overloaded) keeps the pre-SR-1 retry
        behaviour byte-identical -- 3 attempts, with backoff sleeps."""
        self._reset_runs()
        client = self._failing_after_first_batch(RuntimeError("Error code 529: overloaded_error"))
        with mock.patch("nirmaan_stack.services.boq_rate_master.extraction.time.sleep") as slept:
            self._run_worker_with(client)
        # batch 1 (ok) + 3 attempts on batch 2
        self.assertEqual(client.messages.calls, 4, "transient errors still retry 3x")
        self.assertEqual(slept.call_count, 3, "backoff preserved for transient errors")
        p = frappe.get_all(_RUN, filters={"boq": self.boq, "status": "partial"},
                           fields=["halt_reason", "attempted_rows"])[0]
        self.assertEqual(_j(p["attempted_rows"]), [2, 3],
                         "even an exhausted transient keeps the completed batches")

    def test_17_attempted_row_is_not_inferred_from_blank_attributes(self):
        """The done-marker must distinguish 'never asked' from 'asked and the AI returned null' --
        the two are byte-identical in results, which is why attempted_rows exists at all."""
        self._reset_runs()

        def responder(call, kwargs):
            # Batch 1 answers with an explicit NULL for rows 2/3; batch 2 halts.
            if call == 1:
                return _Resp(json.dumps([
                    {"id": 2, "attributes": {"material": {"value": None, "confidence": 0.0}}},
                    {"id": 3, "attributes": {"material": {"value": None, "confidence": 0.0}}},
                ]))
            raise RuntimeError("Error code 400: usage limit reached")

        self._run_worker_with(_FakeClient(responder))
        p = frappe.get_all(_RUN, filters={"boq": self.boq, "status": "partial"},
                           fields=["results", "attempted_rows"])[0]
        saved = _j(p["results"])
        # rows 2/3 have blank attributes YET are attempted; row 4 is neither saved nor attempted
        self.assertIsNone(saved[0]["attributes"]["material"]["value"])
        self.assertEqual(_j(p["attempted_rows"]), [2, 3])
        self.assertNotIn(4, [r["excel_row"] for r in saved])

    def test_18_resume_validation_negatives(self):
        """start_suggest refuses to resume anything that is not a live partial of THIS sheet at the
        CURRENT committed version -- a resume must never write into the wrong run."""
        self._reset_runs()
        self._prior_complete_run(run_id="already-done")

        # NEG: unknown run id
        with self.assertRaises(frappe.ValidationError):
            rate_master.start_suggest(boq=self.boq, sheet_name=self.sheet_name, resume_run_id="nope")
        # NEG: the run is complete, not partial -> nothing to resume
        with self.assertRaises(frappe.ValidationError):
            rate_master.start_suggest(
                boq=self.boq, sheet_name=self.sheet_name, resume_run_id="already-done"
            )
        # NEG: a partial pinned to a DIFFERENT committed version (rows may have changed)
        stale = frappe.new_doc(_RUN)
        stale.boq = self.boq
        stale.sheet_name = self.sheet_name
        stale.committed_version = self.cv + 5
        stale.run_id = "stale-version"
        stale.status = "partial"
        stale.results = "[]"
        stale.attempted_rows = "[]"
        stale.active = 0
        stale.insert(ignore_permissions=True)
        frappe.db.commit()
        with self.assertRaises(frappe.ValidationError):
            rate_master.start_suggest(
                boq=self.boq, sheet_name=self.sheet_name, resume_run_id="stale-version"
            )

    def test_19_unrecognised_error_still_retries_like_before(self):
        """REGRESSION (caught by the SR-1 browser cert on real data, not by the unit tests): a
        TRUNCATED AI reply raises ValueError from _extract_json_array. That is a per-call artifact
        that usually succeeds on the next attempt, and pre-SR-1 it was retried 3x.

        An early version of the terminal/transient split defaulted UNRECOGNISED errors to terminal,
        which silently turned this common failure into an instant halt. The default direction must
        stay 'retry unless positively identified as terminal'."""
        self._reset_runs()
        truncated = '[{"id": 2, "attributes": {"material": {"value": "COP'
        calls = {"n": 0}

        def responder(call, kwargs):
            calls["n"] += 1
            if call == 1:
                return _Resp(json.dumps([
                    {"id": 2, "attributes": {"material": {"value": "COPPER", "confidence": 0.9}}},
                    {"id": 3, "attributes": {"material": {"value": "ALUMINIUM", "confidence": 0.9}}},
                ]))
            return _Resp(truncated)  # batch 2 always comes back cut off

        client = _FakeClient(responder)
        with mock.patch("nirmaan_stack.services.boq_rate_master.extraction.time.sleep") as slept:
            self._run_worker_with(client)

        # batch 1 (ok) + 3 attempts on the truncated batch -- NOT an instant halt
        self.assertEqual(client.messages.calls, 4,
                         "a truncated reply must be retried, exactly as it was before SR-1")
        self.assertEqual(slept.call_count, 3, "backoff preserved for a retryable error")

        # and the completed batch is still kept, with an honest non-provider-blaming reason
        p = frappe.get_all(_RUN, filters={"boq": self.boq, "status": "partial"},
                           fields=["halt_reason", "attempted_rows"])[0]
        self.assertEqual(_j(p["attempted_rows"]), [2, 3])
        self.assertIn("kept failing", p["halt_reason"])
        self.assertNotIn("rejected", p["halt_reason"],
                         "a local parse failure must not be reported as a provider rejection")

    def test_20_terminal_markers_are_positively_identified_only(self):
        """The classifier's contract, pinned directly: only positively-named terminal errors
        fast-fail; everything else keeps the pre-SR-1 retry behaviour."""
        # POSITIVE: terminal
        for msg in (
            "Error code: 400 - You have reached your specified API usage limits.",
            "authentication_error: invalid x-api-key",
            "invalid_request_error: bad payload",
        ):
            self.assertFalse(extraction._is_transient(RuntimeError(msg)), msg)
        # NEGATIVE: retryable (incl. the unrecognised default)
        for exc in (
            ValueError("truncated (unbalanced) JSON array in AI response"),
            RuntimeError("Error code 529: overloaded_error"),
            RuntimeError("connection reset by peer"),
            RuntimeError("something nobody has seen before"),
        ):
            self.assertTrue(extraction._is_transient(exc), repr(exc))

    # ================= EA-4 ext-a: estimator rules + the validator fix =================

    def test_21_rules_absent_prompt_is_byte_identical(self):
        """BACKWARDS-COMPAT PIN: a category with NO rules key must produce exactly the prompt it
        produced before ext-a -- no ESTIMATOR_RULES block, no stray whitespace."""
        defn = {"id": "material", "type": "choice", "values": ["COPPER", "ALUMINIUM"]}
        rows = [{"excel_row": 2, "description": "cable", "anc_headers": [], "anc_texts": []}]
        sink = []

        def responder(call, kwargs):
            sink.append(kwargs["messages"][0]["content"])
            return _Resp(json.dumps([{"id": 2, "attributes": {}}]))

        # rules omitted entirely (the pre-ext-a call shape)
        extraction._extract_batch(_FakeClient(responder), "m", "P", [defn], rows)
        without = sink[0]
        # rules explicitly None (the group_ctx shape for a category with no rules key)
        extraction._extract_batch(_FakeClient(responder), "m", "P", [defn], rows, None, None, None, None, None, None)
        with_none = sink[1]

        self.assertNotIn("ESTIMATOR_RULES", without)
        self.assertEqual(without, with_none, "an absent rules key must not alter the payload at all")

    def test_22_rules_present_reach_the_prompt_verbatim(self):
        """The owner-authored guidance must arrive in the payload UNCHANGED -- the text is the
        contract, so nothing may reword or truncate it."""
        defn = {"id": "material", "type": "choice", "values": ["COPPER"]}
        rows = [{"excel_row": 2, "description": "cable", "anc_headers": [], "anc_texts": []}]
        rules = [{
            "id": "R3",
            "label": "RCCB/RCBO with no stated current: 300mA",
            "applies_to": "mcb_slots",
            "guidance": "When a BoQ line describes an RCCB or RCBO but states NO leakage current rating, select the 300mA variant.",
        }]
        sink = []

        def responder(call, kwargs):
            sink.append(kwargs["messages"][0]["content"])
            return _Resp(json.dumps([{"id": 2, "attributes": {}}]))

        extraction._extract_batch(_FakeClient(responder), "m", "P", [defn], rows,
                                  None, None, None, None, None, rules)
        payload = sink[0]
        self.assertIn("ESTIMATOR_RULES", payload)
        self.assertIn(rules[0]["guidance"], payload, "guidance must appear verbatim")
        self.assertIn("R3", payload)

    def test_23_rules_are_ungated_reach_a_non_composite_category(self):
        """R7 lands on cabletray_raceway, an ORDINARY attribute category. Unlike slot_spec /
        resolution_rules (composite-only), rules must not be gated on matching_mode."""
        cfg = {"matching_mode": None, "rules": [{"id": "R7", "label": "Tray material",
                                                 "guidance": "price uPVC as GI Solid"}]}
        # the group_ctx line under test: rules is read unconditionally, slot_spec/resolution_rules are not
        is_composite = cfg.get("matching_mode") == "composite_decomposition"
        self.assertFalse(is_composite)
        self.assertIsNone(cfg.get("decomposition_rules"))          # composite-gated -> absent here
        self.assertEqual(len(cfg.get("rules")), 1)                 # ungated -> present here

        # and it survives the whole runner for a non-composite category
        live = extraction._load_active_configs({"Electrical"})
        tray = live.get(("Electrical", "cabletray_raceway")) or {}
        self.assertNotEqual(tray.get("matching_mode"), "composite_decomposition")
        self.assertTrue(tray.get("rules"), "the live tray config must carry its rules block")

    # ---- the validator fix, both polarities ----
    def _cfg_with_step(self, step):
        return {
            "discipline": "Electrical", "category_id": "t",
            "attribute_definitions": [{"id": "a", "label": "A", "type": "choice", "values": ["x"]}],
            "pipelines": {"p": {"output": ["o"], "steps": [step]}},
        }

    def test_24_validator_accepts_the_shipped_shapes(self):
        """POSITIVE: the three shapes the interpreter is explicitly built for. Before ext-a these
        made cabletray_raceway and popup_boxes unsavable through RM-4b."""
        # component with NO params (a conditional component carries them per-condition)
        rate_master._validate_config(self._cfg_with_step(
            {"step": "component", "name": "cover", "target": "t", "formula": "base*factor",
             "conditions": [{"when": {"a": "x"}, "params": {"factor": 1.0}}]}))
        # component with NO target (a param-only formula reads no price off the matched row)
        rate_master._validate_config(self._cfg_with_step(
            {"step": "component", "name": "acc", "formula": "accessories_per_mtr",
             "conditions": [{"when": {"a": "x"}, "params": {"accessories_per_mtr": 106.0}}]}))
        # *_from_attr binding an attribute id (a string BY CONTRACT)
        rate_master._validate_config(self._cfg_with_step(
            {"step": "scale", "target": "t", "result": "r", "formula": "base*n",
             "params": {"n_from_attr": "a"}}))

    def test_25_validator_still_rejects_genuinely_bad_input(self):
        """NEGATIVE (non-vacuity): the relaxation is scoped -- it must not swallow real errors."""
        # a NON-suffixed param carrying a string is still an error
        with self.assertRaises(frappe.ValidationError):
            rate_master._validate_config(self._cfg_with_step(
                {"step": "component", "name": "x", "target": "t", "formula": "base*f",
                 "params": {"factor": "not_a_number"}}))
        # a *_from_attr carrying a NUMBER is still an error (it must be an attribute id)
        with self.assertRaises(frappe.ValidationError):
            rate_master._validate_config(self._cfg_with_step(
                {"step": "component", "name": "x", "formula": "1", "params": {"n_from_attr": 5}}))
        # component missing formula
        with self.assertRaises(frappe.ValidationError):
            rate_master._validate_config(self._cfg_with_step(
                {"step": "component", "name": "x", "target": "t"}))
        # a PRESENT but blank target
        with self.assertRaises(frappe.ValidationError):
            rate_master._validate_config(self._cfg_with_step(
                {"step": "component", "name": "x", "target": "", "formula": "1"}))
        # unknown step type
        with self.assertRaises(frappe.ValidationError):
            rate_master._validate_config(self._cfg_with_step({"step": "teleport", "name": "x"}))
        # unknown TOP-LEVEL key (the _KNOWN_CONFIG_KEYS allowlist still bites)
        bad = self._cfg_with_step({"step": "component", "name": "x", "target": "t", "formula": "1"})
        bad["totally_bogus_key"] = 1
        with self.assertRaises(frappe.ValidationError):
            rate_master._validate_config(bad)

    def test_26_rules_is_an_accepted_top_level_key(self):
        """The allowlist entry: without it, adding rules would make every whole-config RM-4b save of
        that category fail -- and the loader would not have caught it, because it does not validate."""
        cfg = self._cfg_with_step({"step": "component", "name": "x", "target": "t", "formula": "1"})
        cfg["rules"] = [{"id": "R1", "label": "L", "applies_to": "a", "guidance": "G"}]
        rate_master._validate_config(cfg)  # must not raise
        self.assertIn("rules", rate_master._KNOWN_CONFIG_KEYS)

    def test_27_live_configs_all_validate(self):
        """Every active config must survive the RM-4b save path. Before ext-a, cabletray_raceway and
        popup_boxes did not -- they were unsavable in the editor."""
        rows = frappe.get_all("BoQ Rate Category Config", filters={"active": 1},
                              fields=["category_id", "config"])
        self.assertTrue(rows)
        for r in rows:
            cfg = r["config"] if isinstance(r["config"], dict) else json.loads(r["config"] or "{}")
            try:
                rate_master._validate_config(cfg)
            except Exception as e:
                self.fail(f"live config '{r['category_id']}' does not validate: {e}")

    # ── SR-2: the reply ceiling, its diagnosis, and split-on-truncation ───────────────
    # Coverage summary (plain English):
    #   28  a reply CUT at the ceiling raises the new named error, not the generic truncated-JSON
    #       ValueError -- and is NOT retried, because the cut is deterministic
    #   29  NEGATIVE: a genuinely malformed reply (no ceiling cut) still raises and retries exactly
    #       as it did before SR-2 -- the narrow special-case did not widen
    #   30  a ceiling cut SPLITS the batch and both halves are actually sent
    #   31  the split recurses at most twice (20 -> 10 -> 5) and then halts; it never degenerates
    #       to one call per row
    #   32  NEGATIVE: a transient error does NOT split -- today's retry/backoff is byte-identical
    #   33  attempted_rows advances per HALF, so a halt mid-split keeps the halves already done
    #   34  the constants are pinned: extraction at 32000, the classifier voter still at 8000
    #       (deliberately out of scope), batch size still 20

    @staticmethod
    def _cut_resp(text=""):
        """A reply the provider cut off at the token ceiling."""
        r = _Resp(text)
        r.stop_reason = "max_tokens"
        return r

    @staticmethod
    def _rows_in(kwargs):
        """The excel_rows the request actually asked about (parsed out of the ROWS block)."""
        content = kwargs["messages"][0]["content"]
        return [int(o["id"]) for o in json.loads(content.split("ROWS:\n", 1)[1])]

    @staticmethod
    def _fake_rows(n, start=1):
        return [{"excel_row": start + i, "description": f"r{start + i}",
                 "anc_headers": [], "anc_texts": []} for i in range(n)]

    def test_28_ceiling_cut_raises_the_named_error_and_is_not_retried(self):
        """CHANGE 1. A reply cut at max_tokens must be diagnosed as such BEFORE the text is parsed,
        so it never degrades into the generic truncated-JSON ValueError -- the ambiguity that made
        the 2026-08-02 failures opaque. And it must NOT be retried: the cut is deterministic for a
        given batch, so three attempts are three guaranteed-failed calls."""
        defn = {"id": "material", "type": "choice", "values": ["COPPER"]}
        rows = self._fake_rows(3, start=2)
        # a cut reply is also unparseable -- proving the ceiling check wins, not the parse
        client = _FakeClient(lambda call, kwargs: self._cut_resp('[{"id": 2, "attributes": {"mat'))

        with self.assertRaises(extraction.ReplyCeilingExceeded) as ctx:
            extraction._extract_batch(client, "m", "P", [defn], rows)

        self.assertEqual(client.messages.calls, 1, "a deterministic ceiling cut must not be retried")
        self.assertEqual(ctx.exception.size, 3)
        self.assertEqual(ctx.exception.max_tokens, extraction._AI_MAX_TOKENS)
        self.assertIn("ceiling", str(ctx.exception))

    def test_29_a_malformed_reply_still_raises_and_retries_as_before(self):
        """NEGATIVE POLARITY / BACKWARDS-COMPAT. The special-case is narrow ON PURPOSE: a reply
        that is garbled WITHOUT a ceiling cut keeps its pre-SR-2 behaviour byte-identical -- the
        SR-1 default-to-retry rule still applies, 3 attempts, then a non-terminal halt."""
        defn = {"id": "material", "type": "choice", "values": ["COPPER"]}
        rows = self._fake_rows(3, start=2)
        # no stop_reason at all -- the shape every pre-SR-2 test produces
        client = _FakeClient(lambda call, kwargs: _Resp('[{"id": 2, "attributes": {"mat'))

        with mock.patch("nirmaan_stack.services.boq_rate_master.extraction.time.sleep"):
            with self.assertRaises(extraction.ExtractionHalted) as ctx:
                extraction._extract_batch(client, "m", "P", [defn], rows)

        self.assertNotIsInstance(ctx.exception, extraction.ReplyCeilingExceeded)
        self.assertEqual(client.messages.calls, 3, "retry/backoff must be unchanged for a garbled reply")
        self.assertIn("kept failing", ctx.exception.reason)
        self.assertFalse(ctx.exception.terminal)

    def test_30_a_ceiling_cut_splits_the_batch_and_sends_both_halves(self):
        """CHANGE 3. The batch that does not fit is halved and BOTH halves are actually sent --
        and between them they cover every row of the original, none dropped."""
        rows = self._fake_rows(20, start=1)
        seen = []

        def call_batch(sub):
            seen.append(len(sub))
            if len(sub) > 10:
                raise extraction.ReplyCeilingExceeded(len(sub), extraction._AI_MAX_TOKENS)
            return {r["excel_row"]: {"material": {"value": "COPPER", "confidence": 0.9}} for r in sub}

        pairs = list(extraction._extract_with_ceiling_split(call_batch, rows))

        self.assertEqual(seen, [20, 10, 10], "the 20 must be tried, then each half")
        self.assertEqual([len(sub) for sub, _ in pairs], [10, 10])
        covered = [r["excel_row"] for sub, _ in pairs for r in sub]
        self.assertEqual(covered, [r["excel_row"] for r in rows], "no row may be lost in a split")

    def test_31_the_split_recurses_at_most_twice_then_halts(self):
        """The depth cap. 20 -> 10 -> 5; a 5-row batch that STILL cuts is not a size problem, so it
        halts with the run's work preserved rather than splitting to one call per row."""
        rows = self._fake_rows(20, start=1)
        seen = []

        def call_batch(sub):
            seen.append(len(sub))
            raise extraction.ReplyCeilingExceeded(len(sub), extraction._AI_MAX_TOKENS)

        with self.assertRaises(extraction.ExtractionHalted) as ctx:
            list(extraction._extract_with_ceiling_split(call_batch, rows))

        self.assertEqual(seen, [20, 10, 5], "depth-first: 20, its first half, that half's half")
        self.assertEqual(min(seen), 5, "must never split below the depth cap")
        self.assertEqual(extraction._MAX_SPLIT_DEPTH, 2)
        self.assertFalse(ctx.exception.terminal, "a size problem is not a terminal provider error")
        self.assertIn("splitting the batch down to 5 row(s)", ctx.exception.reason)

    def test_32_a_transient_error_does_not_split(self):
        """NEGATIVE POLARITY. The split triggers ONLY on a ceiling cut. A transient error must not
        reach the splitter at all -- it is still absorbed by _extract_batch's own retry/backoff,
        so batch sizes never change and today's behaviour is byte-identical."""
        rows = self._fake_rows(20, start=1)
        seen = []

        def call_batch(sub):
            seen.append(len(sub))
            raise ValueError("truncated (unbalanced) JSON array in AI response")

        with self.assertRaises(ValueError):
            list(extraction._extract_with_ceiling_split(call_batch, rows))

        self.assertEqual(seen, [20], "a non-ceiling error must propagate without splitting")

    def test_33_attempted_rows_advances_per_half(self):
        """The SR-1 composition. Each surviving half is checkpointed as it lands, so `attempted`
        advances per HALF -- which is what makes a halt part-way through a split keep the halves
        already done instead of discarding the whole batch."""
        # fixture batch 1 is rows 2,3 (wiring_cabling); make it cut, but let 1-row batches through
        def responder(call, kwargs):
            ids = self._rows_in(kwargs)
            if len(ids) > 1:
                return self._cut_resp("[")
            return _Resp(json.dumps(
                [{"id": i, "attributes": {"material": {"value": "COPPER", "confidence": 0.9}}}
                 for i in ids]))

        seen = []
        env = extraction.run_extraction(
            self.boq, self.sheet_name, client=_FakeClient(responder),
            checkpoint_cb=lambda rows_, attempted: seen.append((
                [r["excel_row"] for r in rows_], list(attempted))),
        )

        self.assertTrue(env["complete"], "splitting must let the run finish, not halt it")
        # the 2-row batch became two 1-row halves, each checkpointed on its own
        self.assertEqual([rows_ for rows_, _ in seen][:2], [[2], [3]])
        self.assertEqual([att for _, att in seen][:2], [[2], [2, 3]],
                         "attempted must grow one half at a time")
        self.assertEqual(seen[-1][1], [2, 3, 4])

    def test_34_the_ceiling_is_32000_and_the_classifier_voter_is_untouched(self):
        """The owner ruling, pinned. 32000 -- NOT the configured 100000, which is untested against
        a non-streaming call with a 300s timeout. And the classifier voter stays at 8000: its reply
        is one small object per row (~13x margin), so raising it would change a CERTIFIED surface
        (rules 4.2-hv7 / prompt hvac-v1.3, measured on a now-spent corpus) for zero benefit."""
        from nirmaan_stack.services.boq_category import ai_voter

        self.assertEqual(extraction._AI_MAX_TOKENS, 32000)
        self.assertEqual(ai_voter._AI_MAX_TOKENS, 8000,
                         "the classifier voter is deliberately OUT OF SCOPE for SR-2")
        self.assertEqual(extraction._BATCH, 20, "batch size was explicitly not changed")


# ══════════════════════════════════════════════════════════════════════════════════════
# EA-7 -- the rate-extraction payload builder
# ══════════════════════════════════════════════════════════════════════════════════════
def _deep_node(boq, sheet_doc, node_type, src, parent, desc, sort, qty=None,
               notes=None, attached=None, appended=None):
    """A committed node carrying the THREE distinct note kinds, which test_classify._node cannot
    set. Deliberately local: test_classify.py is out of scope for EA-7."""
    n = frappe.new_doc("BOQ Nodes")
    n.boq = boq
    n.sheet = sheet_doc
    n.node_type = node_type
    n.source_row_number = src
    n.parent_node = parent
    n.description = desc
    n.sort_order = sort
    n.commit_version = 1
    n.is_current = 1
    if node_type == "Preamble":
        n.level = 0
    if node_type == "Line Item":
        n.qty = 0 if qty is None else qty
    if notes is not None:
        n.notes = notes
    if attached is not None:
        # The documented list-valued-JSON wall: a LIST assigned to a JSON field trips Frappe's
        # "Value for Attached Notes cannot be a list" on insert. Pre-serialize, exactly as the
        # commit pipeline's _LIST_JSON_FIELDS rule does. _notes_text json.loads it back.
        n.attached_notes = json.dumps(attached)
    if appended is not None:
        n.append_notes_raw = appended
    n.insert(ignore_permissions=True)
    return n.name


class TestEA7PayloadShape(FrappeTestCase):
    """EA-7 C1 -- THE TRIPWIRE PINS for the rate-extraction payload builder.

    Before EA-7 this builder was pinned by NOTHING: extraction._ai_item could change its keys, its
    ancestor content or its note handling and the whole suite stayed green (the only incidental
    coverage was test_21's byte-equality of two calls that BOTH go through it, and the `ROWS:`
    split helper, which only needs an `id` key). Closing that gap is part of this slice's value.

    These pins were written against the UNCHANGED code and proven GREEN first, then updated in the
    SAME commit -- so the test diff shows exactly what the payload carried before and after (the
    W4/P5 tripwire pattern from the EA-6c wording slice).

    Fixture: a 5-deep chain so every tier is reachable --
        A (d=4, above the boundary) -> B (d=3, great-grandparent) -> C (d=2, grandparent)
          -> D (d=1, immediate parent) -> LI (d=0, self)
    every node carrying all three note kinds, so a tier that wrongly includes or drops one is
    visible rather than vacuous.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.project = _make_project()
        cls.boq = _new_boq(cls.project.name, f"EA7_{frappe.generate_hash(length=6)}")
        cls.sheet_name = "Deep Sheet "  # trailing space is deliberate (#152 verbatim)
        cls.cv = 1
        cls.sheet_doc = _new_sheet(cls.boq, cls.sheet_name, commit_version=cls.cv)

        def _notes_for(tag):
            return dict(notes=f"{tag}-own", attached=[f"{tag}-att1", f"{tag}-att2"],
                        appended={"Remarks": f"{tag}-app"})

        a = _deep_node(cls.boq, cls.sheet_doc, "Preamble", 1, None, "SECTION A", 1, **_notes_for("A"))
        b = _deep_node(cls.boq, cls.sheet_doc, "Preamble", 2, a, "SUBSECTION B", 2, **_notes_for("B"))
        c = _deep_node(cls.boq, cls.sheet_doc, "Preamble", 3, b, "SUB SUB C", 3, **_notes_for("C"))
        d = _deep_node(cls.boq, cls.sheet_doc, "Preamble", 4, c, "PARENT D", 4, **_notes_for("D"))
        _deep_node(cls.boq, cls.sheet_doc, "Line Item", 5, d, "3C x 2.5 sqmm cable", 5, qty=1,
                   **_notes_for("LI"))
        # A SIBLING under the same parent -- the no-dedup pin needs two rows sharing an ancestor.
        _deep_node(cls.boq, cls.sheet_doc, "Line Item", 6, d, "4C x 16 sqmm cable", 6, qty=1)
        frappe.db.commit()
        _insert_cat(cls.boq, cls.sheet_name, cls.cv, 5, "wiring_cabling")
        _insert_cat(cls.boq, cls.sheet_name, cls.cv, 6, "wiring_cabling")
        frappe.db.commit()

    @classmethod
    def tearDownClass(cls):
        for dt in (_EVENT, _RUN, _ROW_CATEGORY, "BOQ Nodes", "BoQ Sheet"):
            frappe.db.delete(dt, {"boq": cls.boq})
        frappe.db.commit()
        _cleanup_project(cls.project.name)
        super().tearDownClass()

    def _self_row(self):
        from nirmaan_stack.services.boq_category.context_builder import build_sheet_context
        ctx = build_sheet_context(self.boq, self.sheet_name)
        return next(r for r in ctx["rows"] if r["excel_row"] == 5)

    # ---- P1: the key set ----
    def test_p1_payload_item_key_set_is_pinned(self):
        """The four keys, exactly -- UNCHANGED by EA-7. EA-7 deepened the VALUES of `notes` and
        `ancestor_chain`; it deliberately did not add or rename a top-level key, which keeps the
        `ROWS:`/`id` contract and the prompt assets' key names accurate."""
        item = extraction._ai_item(self._self_row())
        self.assertEqual(set(item), {"id", "description", "ancestor_chain", "notes"})
        self.assertEqual(item["id"], 5)
        self.assertEqual(item["description"], "3C x 2.5 sqmm cable")

    # ---- P2: ancestors are LABELLED objects carrying their own note blocks ----
    def test_p2_ancestor_chain_entries_are_labelled_objects(self):
        """EA-7. Was: a flat list of description strings, every ancestor's note text discarded.
        Now: one labelled object per ancestor, root-first, each carrying relation + distance +
        tier + node_type + description + its own kind-keyed note block. The sheet stays the
        outermost entry and is a LABEL, not a node -- no distance, no tier, no notes."""
        item = extraction._ai_item(self._self_row())
        chain = item["ancestor_chain"]
        self.assertEqual(chain[0], {"relation": "sheet", "description": "Deep Sheet "})
        self.assertTrue(all(isinstance(x, dict) for x in chain))
        self.assertEqual([e.get("relation") for e in chain],
                         ["sheet", "ancestor", "great_grandparent", "grandparent", "parent"])
        self.assertEqual([e.get("distance") for e in chain], [None, 4, 3, 2, 1])
        self.assertEqual([e.get("tier") for e in chain],
                         [None, "lean", "lean", "full", "full"])
        self.assertEqual([e.get("description") for e in chain],
                         ["Deep Sheet ", "SECTION A", "SUBSECTION B", "SUB SUB C", "PARENT D"])
        # the immediate parent, in full
        self.assertEqual(chain[4]["notes"], {
            "appended": {"Remarks": "D-app"},
            "own": ["D-own"],
            "attached": ["D-att1", "D-att2"],
        })

    # ---- P3: self's note kinds are SEPARATED and LABELLED ----
    def test_p3_self_notes_is_a_kind_keyed_map(self):
        """EA-7. Was: one pipe-joined string collapsing all three kinds, so the model could not
        tell which fragment was which. Now: a map keyed by note KIND, with `appended` keeping its
        {column-header: value} shape so the source column is part of the provenance."""
        item = extraction._ai_item(self._self_row())
        self.assertIsInstance(item["notes"], dict)
        self.assertEqual(item["notes"], {
            "appended": {"Remarks": "LI-app"},
            "own": ["LI-own"],
            "attached": ["LI-att1", "LI-att2"],
        })

    # ---- P4: the SHARED helper's contract (C2 guard) ----
    def test_p4_notes_text_is_the_shared_pipe_join_in_order(self):
        """context_builder._notes_text is SHARED with the classifier voter. EA-7 must not change
        it. Pinned: own notes first, then every attached note, then every appended value, ' | '."""
        from nirmaan_stack.services.boq_category.context_builder import _notes_text
        node = {"notes": "own", "attached_notes": ["at1", "at2"],
                "append_notes_raw": {"Remarks": "ap1"}}
        self.assertEqual(_notes_text(node), "own | at1 | at2 | ap1")
        self.assertEqual(_notes_text({}), "")

    # ---- P5: C2 byte-identity, as a GOLDEN the voter's own code did not produce ----
    def test_p5_classifier_voter_payload_is_byte_identical(self):
        """C2. The classifier voter is OUT OF SCOPE and its input must not move by one byte. The
        expected value below is written out by hand from ai_voter._ai_item's documented shape --
        it is NOT derived by calling the code under test, so it is a real golden, not a tautology."""
        from nirmaan_stack.services.boq_category import ai_voter
        expected = {
            "id": 5,
            "description": "3C x 2.5 sqmm cable",
            "ancestor_chain": [
                "[sheet] Deep Sheet ",
                "  Preamble: SECTION A  (notes: A-own | A-att1 | A-att2 | A-app)",
                "    Preamble: SUBSECTION B  (notes: B-own | B-att1 | B-att2 | B-app)",
                "      Preamble: SUB SUB C  (notes: C-own | C-att1 | C-att2 | C-app)",
                "        Preamble: PARENT D  (notes: D-own | D-att1 | D-att2 | D-app)",
            ],
            "notes": "LI-own | LI-att1 | LI-att2 | LI-app",
        }
        self.assertEqual(ai_voter._ai_item(self._self_row()), expected)

    # ---- P6: THE TIER BOUNDARY (positive AND negative in one assertion pair) ----
    def test_p6_full_tier_reaches_the_grandparent_and_stops(self):
        """The owner-locked boundary. self / parent / grandparent -> every note kind. The
        great-grandparent and everything above -> appended ONLY. Both halves are asserted: the
        grandparent MUST have own+attached, the great-grandparent MUST NOT."""
        chain = extraction._ai_item(self._self_row())["ancestor_chain"]
        by_rel = {e["relation"]: e for e in chain if "relation" in e}

        gp = by_rel["grandparent"]           # distance 2 -- the LAST full tier
        self.assertEqual(gp["tier"], "full")
        self.assertEqual(gp["notes"], {"appended": {"Remarks": "C-app"},
                                       "own": ["C-own"], "attached": ["C-att1", "C-att2"]})

        ggp = by_rel["great_grandparent"]    # distance 3 -- the FIRST lean tier
        self.assertEqual(ggp["tier"], "lean")
        self.assertEqual(ggp["notes"], {"appended": {"Remarks": "B-app"}})
        self.assertNotIn("own", ggp["notes"], "a lean ancestor must not carry own notes")
        self.assertNotIn("attached", ggp["notes"], "a lean ancestor must not carry attached notes")

        far = by_rel["ancestor"]             # distance 4 -- above the named relations
        self.assertEqual(far["tier"], "lean")
        self.assertEqual(far["notes"], {"appended": {"Remarks": "A-app"}})
        self.assertEqual(extraction._FULL_TIER_MAX_DISTANCE, 2,
                         "the boundary is a named constant, not a magic number")

    # ---- P7: NO DEDUP (owner-locked) ----
    def test_p7_shared_ancestor_text_is_repeated_per_row_never_deduped(self):
        """Owner-locked after measurement: 86-94% of ancestor text on real sheets is repetition,
        and that cost is accepted so each row reads independently inline. Two siblings under the
        same parent must EACH carry that parent's full text -- no reference, no shared block."""
        from nirmaan_stack.services.boq_category.context_builder import build_sheet_context
        ctx = build_sheet_context(self.boq, self.sheet_name)
        rows = {r["excel_row"]: r for r in ctx["rows"]}
        a = extraction._ai_item(rows[5])
        b = extraction._ai_item(rows[6])

        parent_a = next(e for e in a["ancestor_chain"] if e.get("relation") == "parent")
        parent_b = next(e for e in b["ancestor_chain"] if e.get("relation") == "parent")
        self.assertEqual(parent_a, parent_b, "both siblings carry the parent block in full")
        self.assertEqual(parent_b["notes"]["attached"], ["D-att1", "D-att2"])
        # and nothing in either item points at the other row instead of carrying the text
        self.assertNotIn("$ref", json.dumps(a))
        self.assertNotIn("$ref", json.dumps(b))

    # ---- P8: an empty kind is OMITTED, not sent as an empty container ----
    def test_p8_absent_note_kinds_are_omitted_entirely(self):
        """Row 6 carries no notes at all -- so it must have NO `notes` key, not an empty map.
        Absence is then unambiguous and the payload does not pay for silence."""
        from nirmaan_stack.services.boq_category.context_builder import build_sheet_context
        ctx = build_sheet_context(self.boq, self.sheet_name)
        row6 = next(r for r in ctx["rows"] if r["excel_row"] == 6)
        item = extraction._ai_item(row6)
        self.assertNotIn("notes", item)
        self.assertEqual(set(item), {"id", "description", "ancestor_chain"})

    # ---- P9: the shape guidance reaches the prompt ----
    def test_p9_row_context_shape_guidance_is_in_the_prompt(self):
        """The labels are only useful if the model is told how to read them. The guidance lives in
        the wrapper (the SYNONYMS / DEFAULTS / ESTIMATOR_RULES convention) so the .md prompt assets
        stay untouched -- they are out of scope for EA-7."""
        defn = {"id": "material", "type": "choice", "values": ["COPPER"]}
        rows = [{"excel_row": 2, "description": "cable", "ancestors": [], "sheet_name": "S"}]
        sink = []

        def responder(call, kwargs):
            sink.append(kwargs["messages"][0]["content"])
            return _Resp(json.dumps([{"id": 2, "attributes": {}}]))

        extraction._extract_batch(_FakeClient(responder), "m", "P", [defn], rows)
        self.assertIn("ROW_CONTEXT_SHAPE", sink[0])
        self.assertIn("distance", sink[0])
        self.assertIn("NOT SUPPLIED", sink[0], "the lean tier's silence must be explained")

    # ---- P10: the dump, OFF (the default) ----
    def test_p10_dump_off_writes_nothing_and_changes_no_payload(self):
        """NEGATIVE POLARITY / the default. Flag OFF must produce NO file and a byte-identical
        payload. The flag ships FALSE -- this test also pins that default."""
        import os as _os
        import tempfile

        self.assertIs(extraction.EA7_PAYLOAD_DUMP_ENABLED, False,
                      "the dump is TEMPORARY instrumentation and must ship OFF")

        target = _os.path.join(tempfile.mkdtemp(), "ea7_off.jsonl")
        defn = {"id": "material", "type": "choice", "values": ["COPPER"]}
        rows = [{"excel_row": 2, "description": "cable", "ancestors": [], "sheet_name": "S",
                 "committed_version": 1, "category_id": "wiring_cabling"}]
        sink = []

        def responder(call, kwargs):
            sink.append(kwargs["messages"][0]["content"])
            return _Resp(json.dumps([{"id": 2, "attributes": {}}]))

        with mock.patch.object(extraction, "_dump_path", return_value=target):
            extraction._extract_batch(_FakeClient(responder), "m", "P", [defn], rows,
                                      dump_ctx={"boq": "BOQ-TEST"})
        self.assertFalse(_os.path.exists(target), "flag OFF must not create the file")

        # and the payload itself is identical to a call that passes no dump context at all
        with mock.patch.object(extraction, "_dump_path", return_value=target):
            extraction._extract_batch(_FakeClient(responder), "m", "P", [defn], rows)
        self.assertEqual(sink[0], sink[1], "the dump must not touch the payload")

    # ---- P11: the dump, ON ----
    def test_p11_dump_on_writes_one_joinable_record_per_row(self):
        """POSITIVE. Flag ON writes one JSON line per row carrying the join key (boq, sheet_name
        VERBATIM, committed_version, excel_row) + category_id + the EXACT payload item as sent.
        `boq` is not on the row dict -- it is threaded from run_extraction's scope via dump_ctx."""
        import os as _os
        import tempfile

        target = _os.path.join(tempfile.mkdtemp(), "ea7_on.jsonl")
        defn = {"id": "material", "type": "choice", "values": ["COPPER"]}
        rows = [{"excel_row": 5, "description": "3C x 2.5 sqmm cable", "ancestors": [],
                 "sheet_name": "Deep Sheet ", "committed_version": 1,
                 "category_id": "wiring_cabling", "discipline": "Electrical"}]

        def responder(call, kwargs):
            return _Resp(json.dumps([{"id": 5, "attributes": {}}]))

        with mock.patch.object(extraction, "EA7_PAYLOAD_DUMP_ENABLED", True), \
             mock.patch.object(extraction, "_dump_path", return_value=target):
            extraction._extract_batch(_FakeClient(responder), "m", "P", [defn], rows,
                                      dump_ctx={"boq": "BOQ-26-99999"})

        with open(target, encoding="utf-8") as fh:
            lines = [json.loads(x) for x in fh if x.strip()]
        self.assertEqual(len(lines), 1)
        rec = lines[0]
        self.assertEqual(rec["boq"], "BOQ-26-99999")
        self.assertEqual(rec["sheet_name"], "Deep Sheet ", "sheet_name must stay VERBATIM")
        self.assertEqual(rec["committed_version"], 1)
        self.assertEqual(rec["excel_row"], 5)
        self.assertEqual(rec["category_id"], "wiring_cabling")
        self.assertEqual(rec["payload_item"], extraction._ai_item(rows[0]),
                         "the record must carry the EXACT item that was sent")

    # ---- P12: an unresolvable dump path can never break a run ----
    def test_p12_a_failing_dump_never_fails_the_run(self):
        """Instrumentation that can break the thing it observes is worse than none. With the flag
        ON and no writable path, the batch must still complete normally."""
        defn = {"id": "material", "type": "choice", "values": ["COPPER"]}
        rows = [{"excel_row": 5, "description": "cable", "ancestors": [], "sheet_name": "S"}]

        def responder(call, kwargs):
            return _Resp(json.dumps(
                [{"id": 5, "attributes": {"material": {"value": "COPPER", "confidence": 0.9}}}]))

        with mock.patch.object(extraction, "EA7_PAYLOAD_DUMP_ENABLED", True), \
             mock.patch.object(extraction, "_dump_path", return_value=None):
            out = extraction._extract_batch(_FakeClient(responder), "m", "P", [defn], rows,
                                            dump_ctx={"boq": "B"})
        self.assertEqual(out[5]["material"]["value"], "COPPER")


# ══════════════════════════════════════════════════════════════════════════════════════
# ext-b -- the estimator-rule pins
# ══════════════════════════════════════════════════════════════════════════════════════
def _live_rules(category_id):
    """The rules array stored on the LIVE active config -- the authority (an asset edit alone is
    INERT at runtime; the EA-6a lesson)."""
    rows = frappe.get_all(
        "BoQ Rate Category Config",
        filters={"discipline": "Electrical", "category_id": category_id, "active": 1},
        fields=["config"], limit=1,
    )
    if not rows:
        return None
    cfg = rows[0]["config"]
    cfg = cfg if isinstance(cfg, dict) else json.loads(cfg or "{}")
    return cfg.get("rules")


def _prompt_for(rules):
    """The prompt _extract_batch actually builds for a given rules array."""
    defn = {"id": "material", "type": "choice", "values": ["COPPER"]}
    rows = [{"excel_row": 2, "description": "x", "ancestors": [], "sheet_name": "S"}]
    sink = []

    def responder(call, kwargs):
        sink.append(kwargs["messages"][0]["content"])
        return _Resp(json.dumps([{"id": 2, "attributes": {}}]))

    extraction._extract_batch(_FakeClient(responder), "m", "P", [defn], rows,
                              None, None, None, None, None, rules)
    return sink[0]


class TestExtBRules(FrappeTestCase):
    """ext-b C1 -- the estimator-rule pins.

    Written against the UNCHANGED live configs and proven GREEN first, then updated in the SAME
    slice so the test diff shows exactly which rules were shipped before and after (the W4/P5
    tripwire pattern). These read the LIVE `BoQ Rate Category Config` rows deliberately: the DB row
    is what the extraction engine reads, and an asset edited alone is inert at runtime.
    """

    # ---- B1 / B2 / B4 pins: written in the BEFORE state, proven green, then UPDATED here ----
    def test_e1_db_switchgear_rule_ids(self):
        """The db_switchgear rule SET. ext-b REPLACED R3 in full and ADDED R8.
        (BEFORE this slice the pin read ["R2", "R3", "R4"].)"""
        ids = [r.get("id") for r in (_live_rules("db_switchgear") or [])]
        self.assertEqual(ids, ["R2", "R3", "R4", "R8"])

    def test_e2_r3_is_the_highest_available_ma_rule(self):
        """B4 AFTER. R3 is now the HIGHEST-AVAILABLE rule; the 300-then-100 ladder and the
        'Never leave it unmatched' clause are DELETED, and an unmatchable combo is left BLANK.
        (BEFORE: label '...: 300mA', guidance carrying '300mA variant' / '100mA variant'.)"""
        r3 = next(r for r in _live_rules("db_switchgear") if r["id"] == "R3")
        self.assertEqual(r3["label"], "RCCB/RCBO with no stated current: highest available mA")
        self.assertEqual(r3["applies_to"], "mcb_slots")
        g = r3["guidance"]
        self.assertIn("HIGHEST mA rating", g)
        self.assertIn("leave it BLANK", g)
        self.assertNotIn("300mA variant", g)
        self.assertNotIn("100mA variant", g)
        self.assertNotIn("Never leave it unmatched", g)

    def test_e3_r8_per_phase_reaches_the_prompt_verbatim(self):
        """B1 AFTER. The per-phase rule ships as CONFIG DATA and arrives VERBATIM. This proves the
        rule ARRIVES; it does NOT prove the model obeys -- and R8 is the FIRST rule in this
        programme to ask the model for arithmetic, so obedience needs a live AI pass."""
        r8 = next(r for r in _live_rules("db_switchgear") if r["id"] == "R8")
        self.assertEqual(r8["applies_to"], "mcb_slots")
        self.assertIn("three for a TPN or VTPN DB, one for an SPN DB", r8["guidance"])
        payload = _prompt_for(_live_rules("db_switchgear"))
        self.assertIn("ESTIMATOR_RULES", payload)
        self.assertIn(r8["guidance"], payload, "the guidance must arrive verbatim")

    def test_e4_point_wiring_carries_r9_and_keeps_its_shipped_defaults(self):
        """B2 AFTER. point_wiring gained R9 and NOTHING else -- the wire-core defaults of 1.0 were
        already shipped and must not be duplicated or altered. (BEFORE: rules was falsy.)"""
        ids = [r.get("id") for r in (_live_rules("point_wiring") or [])]
        self.assertEqual(ids, ["R9"])
        r9 = next(r for r in _live_rules("point_wiring") if r["id"] == "R9")
        self.assertEqual(r9["applies_to"], "wire1_core")
        self.assertIn("3 runs of 2-core is 6", r9["guidance"])
        cfg = frappe.get_all("BoQ Rate Category Config",
                             filters={"discipline": "Electrical", "category_id": "point_wiring",
                                      "active": 1}, fields=["config"], limit=1)[0]["config"]
        cfg = cfg if isinstance(cfg, dict) else json.loads(cfg or "{}")
        self.assertEqual(cfg["extraction_defaults"]["wire1_core"], 1.0)
        self.assertEqual(cfg["extraction_defaults"]["wire2_core"], 1.0)

    def _wiring(self):
        cfg = frappe.get_all("BoQ Rate Category Config",
                             filters={"discipline": "Electrical", "category_id": "wiring_cabling",
                                      "active": 1}, fields=["config"], limit=1)[0]["config"]
        return cfg if isinstance(cfg, dict) else json.loads(cfg or "{}")

    def test_e5_wiring_cabling_carries_runs_defaults_and_r10(self):
        """B3 AFTER. wiring_cabling gained a `runs` attribute, an extraction_defaults block (it had
        NONE at all) and R10. `core` is NOT redefined.
        (BEFORE: no `runs`, no extraction_defaults, falsy rules -> no ESTIMATOR_RULES block.)"""
        cfg = self._wiring()
        by_id = {d["id"]: d for d in cfg["attribute_definitions"]}
        self.assertIn("runs", by_id)
        self.assertEqual(by_id["runs"]["type"], "number")
        self.assertEqual(by_id["runs"]["label"], "Runs")
        self.assertEqual(by_id["core"]["type"], "number")          # unchanged
        self.assertEqual(cfg["extraction_defaults"]["runs"], 1.0)
        self.assertEqual(cfg["extraction_defaults"]["core"], 1.0)
        ids = [r.get("id") for r in (cfg.get("rules") or [])]
        self.assertEqual(ids, ["R10"])
        r10 = next(r for r in cfg["rules"] if r["id"] == "R10")
        self.assertEqual(r10["applies_to"], "runs")
        self.assertIn("must never be multiplied together", r10["guidance"])
        self.assertIn("ESTIMATOR_RULES", _prompt_for(cfg["rules"]))

    def test_e6_five_runs_multipliers_each_after_its_rounding(self):
        """B3(c)(d) AFTER, with the OWNER RULING of 2026-08-05: FIVE attachment points, not six.
        Each is a `scale` carrying `runs_from_attr` and each sits AFTER that output's roundup, so
        runs multiplies a ROUNDED per-unit rate."""
        cfg = self._wiring()
        expected = {
            "cable_boq": ["supply_per_mtr", "install_per_mtr"],
            "termination_boq": ["supply_per_set"],      # install INHERITS -- see test_e7
            "cable_bcs": ["bcs_supply_per_mtr"],
            "termination_bcs": ["bcs_supply_per_set"],
        }
        total = 0
        for pid, outs in expected.items():
            steps = cfg["pipelines"][pid]["steps"]
            got = [s.get("target") for s in steps
                   if s.get("step") == "scale" and (s.get("params") or {}).get("runs_from_attr") == "runs"]
            self.assertEqual(got, outs, f"{pid}: runs multipliers on the wrong outputs")
            for out in outs:
                i = next(i for i, s in enumerate(steps)
                         if s.get("step") == "scale" and s.get("target") == out
                         and (s.get("params") or {}).get("runs_from_attr") == "runs")
                self.assertEqual(steps[i]["formula"], "base*runs")
                self.assertEqual(steps[i]["result"], out)
                rounds = [j for j, s in enumerate(steps)
                          if s.get("step") == "roundup" and s.get("target") == out]
                self.assertTrue(rounds and i > max(rounds),
                                f"{pid}/{out}: runs must multiply a ROUNDED per-unit rate")
                total += 1
        self.assertEqual(total, 5, "five output points (owner ruling: termination install inherits)")

    def test_e7_termination_install_inherits_runs_and_is_never_multiplied_twice(self):
        """OWNER RULING 2026-08-05, the reason this is five points and not six. `install_as_ratio`
        derives termination install FROM supply, and the supply multiplier fires BEFORE it -- so
        install already carries runs. A second multiplier would make install runs-SQUARED."""
        steps = self._wiring()["pipelines"]["termination_boq"]["steps"]
        runs_idx = [i for i, s in enumerate(steps)
                    if s.get("step") == "scale" and (s.get("params") or {}).get("runs_from_attr")]
        self.assertEqual(len(runs_idx), 1, "termination_boq must carry EXACTLY ONE runs multiplier")
        self.assertEqual(steps[runs_idx[0]]["target"], "supply_per_set")
        ratio_idx = next(i for i, s in enumerate(steps) if s.get("step") == "install_as_ratio")
        self.assertLess(runs_idx[0], ratio_idx,
                        "the supply multiplier must PRECEDE install_as_ratio so install inherits runs")
        # and nothing multiplies install directly
        self.assertFalse([s for s in steps if s.get("step") == "scale"
                          and s.get("target") == "install_per_set"
                          and (s.get("params") or {}).get("runs_from_attr")])

    def test_e7_rules_absent_is_still_byte_identical(self):
        """NEGATIVE POLARITY / backwards-compat. ext-b adds rules to three categories; a category
        with NO rules must still produce the pre-ext-a prompt exactly."""
        self.assertEqual(_prompt_for(None), _prompt_for([]))
        self.assertNotIn("ESTIMATOR_RULES", _prompt_for(None))
