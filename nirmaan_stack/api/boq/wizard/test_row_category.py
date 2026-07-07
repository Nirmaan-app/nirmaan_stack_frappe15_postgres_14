# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and Contributors
# See license.txt

"""Tests for the classifier service core (Classifier CL-1a): the BoQ Row Category doctype +
persist (freeze-and-supersede), the R3d router (pure), the committed-tree context builder,
and the independent AI voter (stubbed client -- no live API).

Coverage matrix:
  ROUTING (pure, no DB)
    POS  non-blank consensus HIGH/MED -> Auto-accepted, final=consensus.
    POS  consensus LOW-rule x AI 0.75 -> Needs review (weak window), final "".
    POS  consensus LOW-rule x AI 0.90 -> Auto-accepted (outside window).
    POS  weak-window boundaries 0.70 / 0.85 inclusive -> Needs review.
    NEG  disagreement / mutual blank / one-blank-one-cat -> Needs review, final "".
    CFG  thresholds read from the passed config (an override flips the verdict).
  PERSISTENCE (DB)
    POS  first write -> category_version=1, is_current=1.
    POS  re-write same identity -> v1 frozen (is_current=0), v2 current (freeze-and-supersede).
    POS  two disciplines, same Excel address -> two coexisting current records.
    POS  set_human_verdict -> stamps the CURRENT record in place, category_version unchanged.
  CONTEXT BUILDER (DB, seeded committed tree)
    POS  5-deep ancestor chain, root-first, all 5 descriptions present; texts/headers split.
    POS  EVERY ancestor's attached_notes AND append_notes_raw carried; own notes combined.
    POS  non-current node excluded; Other node excluded (eligibility = Line Item/Preamble).
    NEG  broken (non-current) parent ref -> per-row warning, row KEPT (never dropped).
  AI VOTER (stubbed client)
    POS  batch chunking at 20 (25 items -> 2 calls); invalid category id blanked (conf kept).
    POS  retry path on a transient error (call raises then succeeds).
    NEG  settings disabled -> fails closed, NO client call attempted, blank results.

Work headers are intentionally NOT part of this slice (owner: parked) -- no work_header setup,
no work_header assertions anywhere here.
"""

import json
from unittest import mock

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.services.boq_category import ai_voter, persist
from nirmaan_stack.services.boq_category.context_builder import build_sheet_context
from nirmaan_stack.services.boq_category.routing import route_r3d
from nirmaan_stack.services.boq_category.runner import load_ruleset
from nirmaan_stack.api.boq.wizard.test_review_screen import _cleanup_project, _make_project

_ROW_CATEGORY = "BoQ Row Category"
_AI_SETTINGS = "BOQ Upload Review AI Settings"


def _as_obj(v):
    """A JSON field may come back as a str or an already-parsed object; normalize to object."""
    if isinstance(v, str):
        return json.loads(v)
    return v


# ── ROUTING (pure) ───────────────────────────────────────────────────────────────
class TestR3dRouting(FrappeTestCase):
    def _rule(self, cat, band):
        return {"category_id": cat, "band": band}

    def _ai(self, cat, conf):
        return {"category_id": cat, "confidence": conf}

    def test_consensus_high_auto_accept(self):
        r = route_r3d(self._rule("db_switchgear", "HIGH"), self._ai("db_switchgear", 0.9))
        self.assertEqual(r["routing"], "Auto-accepted")
        self.assertEqual(r["final_category_id"], "db_switchgear")

    def test_consensus_med_auto_accept(self):
        r = route_r3d(self._rule("panels", "MED"), self._ai("panels", 0.6))
        self.assertEqual(r["routing"], "Auto-accepted")
        self.assertEqual(r["final_category_id"], "panels")

    def test_consensus_low_weak_window_human(self):
        r = route_r3d(self._rule("earthing", "LOW"), self._ai("earthing", 0.75))
        self.assertEqual(r["routing"], "Needs review")
        self.assertEqual(r["final_category_id"], "")

    def test_consensus_low_above_window_auto_accept(self):
        r = route_r3d(self._rule("earthing", "LOW"), self._ai("earthing", 0.90))
        self.assertEqual(r["routing"], "Auto-accepted")
        self.assertEqual(r["final_category_id"], "earthing")

    def test_weak_window_boundaries_inclusive(self):
        lo = route_r3d(self._rule("earthing", "LOW"), self._ai("earthing", 0.70))
        hi = route_r3d(self._rule("earthing", "LOW"), self._ai("earthing", 0.85))
        self.assertEqual(lo["routing"], "Needs review")
        self.assertEqual(hi["routing"], "Needs review")

    def test_disagreement_human(self):
        r = route_r3d(self._rule("panels", "HIGH"), self._ai("db_switchgear", 0.9))
        self.assertEqual(r["routing"], "Needs review")
        self.assertEqual(r["final_category_id"], "")

    def test_mutual_blank_human(self):
        r = route_r3d(self._rule("", "ABSTAIN"), self._ai("", 0.0))
        self.assertEqual(r["routing"], "Needs review")
        self.assertEqual(r["final_category_id"], "")

    def test_rule_cat_ai_blank_human(self):
        r = route_r3d(self._rule("panels", "HIGH"), self._ai("", 0.0))
        self.assertEqual(r["routing"], "Needs review")
        self.assertEqual(r["final_category_id"], "")

    def test_rule_blank_ai_cat_human(self):
        r = route_r3d(self._rule("", "ABSTAIN"), self._ai("panels", 0.9))
        self.assertEqual(r["routing"], "Needs review")
        self.assertEqual(r["final_category_id"], "")

    def test_thresholds_read_from_config(self):
        # With the DEFAULT config, LOW x 0.75 -> human. Override the window so 0.75 falls
        # OUTSIDE it -> Auto-accepted. Proves the thresholds come from config, not hard-code.
        cfg = {"policy_id": "R3d", "ai_weak_low": 0.90, "ai_weak_high": 0.95, "weak_rule_band": "LOW"}
        r = route_r3d(self._rule("earthing", "LOW"), self._ai("earthing", 0.75), config=cfg)
        self.assertEqual(r["routing"], "Auto-accepted")
        self.assertEqual(r["final_category_id"], "earthing")


# ── PERSISTENCE (DB) ─────────────────────────────────────────────────────────────
def _row(excel_row, **kw):
    base = {
        "excel_row": excel_row,
        "rule_category_id": "db_switchgear",
        "rule_band": "HIGH",
        "rule_score": 0.9,
        "ai_category_id": "db_switchgear",
        "ai_confidence": 0.88,
        "final_category_id": "db_switchgear",
        "routing": "Auto-accepted",
        "routing_reason": "consensus -- db_switchgear",
        "description": "some committed line",
        "rules_version": "2.1-tuning2",
        "prompt_version": "v1.3",
        "model": "claude-opus-4-8",
    }
    base.update(kw)
    return base


class TestRowCategoryPersistence(FrappeTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.project = _make_project()
        boq = frappe.new_doc("BOQs")
        boq.project = cls.project.name
        boq.boq_name = "Row Category Persist BoQ"
        boq.tax_treatment = "Pre-tax"
        boq.insert(ignore_permissions=True)
        frappe.db.commit()
        cls.boq = boq.name
        cls.sheet = "RC Persist "  # VERBATIM trailing space (#152)
        cls.cv = 1

    @classmethod
    def tearDownClass(cls):
        frappe.db.delete(_ROW_CATEGORY, {"boq": cls.boq})
        frappe.db.commit()
        _cleanup_project(cls.project.name)
        super().tearDownClass()

    def _current(self, excel_row, discipline="Electrical"):
        return frappe.get_all(
            _ROW_CATEGORY,
            filters={
                "boq": self.boq,
                "sheet_name": self.sheet,
                "excel_row": excel_row,
                "committed_version": self.cv,
                "discipline": discipline,
                "is_current": 1,
            },
            fields=["name", "category_version", "final_category_id", "is_current"],
        )

    def test_first_write_v1_current(self):
        persist.write_row_categories(self.boq, self.sheet, self.cv, "Electrical", [_row(10)])
        cur = self._current(10)
        self.assertEqual(len(cur), 1)
        self.assertEqual(cur[0]["category_version"], 1)
        self.assertEqual(cur[0]["is_current"], 1)
        self.assertEqual(cur[0]["final_category_id"], "db_switchgear")

    def test_resave_freezes_and_bumps(self):
        persist.write_row_categories(self.boq, self.sheet, self.cv, "Electrical", [_row(11)])
        persist.write_row_categories(
            self.boq, self.sheet, self.cv, "Electrical",
            [_row(11, final_category_id="panels", ai_category_id="panels", rule_category_id="panels")],
        )
        cur = self._current(11)
        self.assertEqual(len(cur), 1, "exactly one current after re-save")
        self.assertEqual(cur[0]["category_version"], 2)
        self.assertEqual(cur[0]["final_category_id"], "panels")
        allv = frappe.get_all(
            _ROW_CATEGORY,
            filters={"boq": self.boq, "sheet_name": self.sheet, "excel_row": 11,
                     "committed_version": self.cv, "discipline": "Electrical"},
            fields=["category_version", "is_current"],
        )
        self.assertEqual(len(allv), 2, "two versions retained (freeze-and-supersede)")
        self.assertEqual(sum(v["is_current"] for v in allv), 1, "exactly one is_current")

    def test_two_disciplines_coexist(self):
        persist.write_row_categories(self.boq, self.sheet, self.cv, "Electrical", [_row(12)])
        persist.write_row_categories(self.boq, self.sheet, self.cv, "HVAC", [_row(12)])
        self.assertEqual(len(self._current(12, "Electrical")), 1)
        self.assertEqual(len(self._current(12, "HVAC")), 1)
        both = frappe.get_all(
            _ROW_CATEGORY,
            filters={"boq": self.boq, "sheet_name": self.sheet, "excel_row": 12,
                     "committed_version": self.cv, "is_current": 1},
            pluck="discipline",
        )
        self.assertEqual(sorted(both), ["Electrical", "HVAC"])

    def test_set_human_verdict_in_place(self):
        persist.write_row_categories(
            self.boq, self.sheet, self.cv, "Electrical",
            [_row(13, routing="Needs review", final_category_id="")],
        )
        persist.set_human_verdict(self.boq, self.sheet, 13, self.cv, "Electrical", "panels")
        cur = frappe.get_all(
            _ROW_CATEGORY,
            filters={"boq": self.boq, "sheet_name": self.sheet, "excel_row": 13,
                     "committed_version": self.cv, "discipline": "Electrical", "is_current": 1},
            fields=["name", "category_version", "human_category_id", "human_verdict_at",
                    "human_verdict_by"],
        )
        self.assertEqual(len(cur), 1)
        self.assertEqual(cur[0]["category_version"], 1, "no new version on human verdict")
        self.assertEqual(cur[0]["human_category_id"], "panels")
        self.assertTrue(cur[0]["human_verdict_at"])
        self.assertTrue(cur[0]["human_verdict_by"])
        total = frappe.db.count(
            _ROW_CATEGORY,
            {"boq": self.boq, "sheet_name": self.sheet, "excel_row": 13,
             "committed_version": self.cv, "discipline": "Electrical"},
        )
        self.assertEqual(total, 1, "verdict annotates in place -- no extra record")

    def test_set_human_verdict_upsert_creates_when_absent(self):
        # UPSERT: an ELIGIBLE row that was NEVER classified (no record) -- set_human_verdict must
        # CREATE a current record carrying the identity tuple + the human verdict (was: throw).
        self.assertEqual(self._current(20), [], "precondition: row 20 has no record")
        persist.set_human_verdict(self.boq, self.sheet, 20, self.cv, "Electrical", "earthing")
        cur = frappe.get_all(
            _ROW_CATEGORY,
            filters={"boq": self.boq, "sheet_name": self.sheet, "excel_row": 20,
                     "committed_version": self.cv, "discipline": "Electrical", "is_current": 1},
            fields=["name", "category_version", "is_current", "human_category_id",
                    "final_category_id", "human_verdict_at", "human_verdict_by", "classified_at"],
        )
        self.assertEqual(len(cur), 1, "exactly one current record created")
        self.assertEqual(cur[0]["category_version"], 1, "first-ever record is version 1")
        self.assertEqual(cur[0]["is_current"], 1)
        self.assertEqual(cur[0]["human_category_id"], "earthing")
        self.assertEqual((cur[0]["final_category_id"] or ""), "", "no machine verdict on a create")
        self.assertTrue(cur[0]["human_verdict_at"])
        self.assertTrue(cur[0]["human_verdict_by"])
        self.assertTrue(cur[0]["classified_at"])
        total = frappe.db.count(
            _ROW_CATEGORY,
            {"boq": self.boq, "sheet_name": self.sheet, "excel_row": 20,
             "committed_version": self.cv, "discipline": "Electrical"},
        )
        self.assertEqual(total, 1, "upsert created exactly one record")

    def test_get_sheet_categories_effective_after_upsert(self):
        # After an upsert on a no-record row, the read endpoint surfaces effective = the human pick.
        from nirmaan_stack.api.boq.wizard.classify import get_sheet_categories

        bs = frappe.new_doc("BoQ Sheet")
        bs.boq = self.boq
        bs.sheet_name = self.sheet
        bs.sheet_order = 1
        bs.commit_version = self.cv
        bs.is_current = 1
        bs.insert(ignore_permissions=True)
        frappe.db.commit()
        try:
            persist.set_human_verdict(self.boq, self.sheet, 21, self.cv, "Electrical", "panels")
            res = get_sheet_categories(boq=self.boq, sheet_name=self.sheet, discipline="Electrical")
            by = {c["excel_row"]: c for c in res["categories"]}
            self.assertIn(21, by, "the upserted row is returned")
            self.assertEqual(by[21]["human_category_id"], "panels")
            self.assertEqual(by[21]["effective_category_id"], "panels")
        finally:
            frappe.db.delete("BoQ Sheet", {"name": bs.name})
            frappe.db.commit()

    def test_set_human_verdict_upsert_then_clear(self):
        # Clearing ("") on a JUST-CREATED record must not crash and leaves the record current with a
        # blank human verdict (effective then falls back to the machine final, which is blank here).
        persist.set_human_verdict(self.boq, self.sheet, 22, self.cv, "Electrical", "earthing")
        persist.set_human_verdict(self.boq, self.sheet, 22, self.cv, "Electrical", "")
        cur = frappe.get_all(
            _ROW_CATEGORY,
            filters={"boq": self.boq, "sheet_name": self.sheet, "excel_row": 22,
                     "committed_version": self.cv, "discipline": "Electrical", "is_current": 1},
            fields=["category_version", "human_category_id"],
        )
        self.assertEqual(len(cur), 1, "still exactly one current after clear")
        self.assertEqual(cur[0]["category_version"], 1, "clear on a created record mints no version")
        self.assertEqual((cur[0]["human_category_id"] or ""), "", "verdict cleared in place")


# ── CONTEXT BUILDER (DB) ─────────────────────────────────────────────────────────
class TestContextBuilder(FrappeTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.project = _make_project()
        boq = frappe.new_doc("BOQs")
        boq.project = cls.project.name
        boq.boq_name = "Context Builder BoQ"
        boq.tax_treatment = "Pre-tax"
        boq.insert(ignore_permissions=True)
        frappe.db.commit()
        cls.boq = boq.name
        cls.sheet = "CtxFix "  # VERBATIM trailing space (#152)

        bs = frappe.new_doc("BoQ Sheet")
        bs.boq = cls.boq
        bs.sheet_name = cls.sheet
        bs.sheet_order = 1
        bs.commit_version = 1
        bs.is_current = 1
        bs.insert(ignore_permissions=True)
        cls.sheet_doc = bs.name

        def node(node_type, src, parent, desc, sort, is_current=1, level=None,
                 notes=None, attached_notes=None, append_notes_raw=None):
            n = frappe.new_doc("BOQ Nodes")
            n.boq = cls.boq
            n.sheet = cls.sheet_doc
            n.node_type = node_type
            n.source_row_number = src
            n.parent_node = parent
            n.description = desc
            n.sort_order = sort
            n.commit_version = 1
            n.is_current = is_current
            # The BOQ Nodes controller requires a non-negative level on Preamble nodes.
            if level is not None:
                n.level = level
            elif node_type == "Preamble":
                n.level = 0
            # ... and a qty (0 allowed, rate-only) on Line Item nodes.
            if node_type == "Line Item":
                n.qty = 0
            if notes is not None:
                n.notes = notes
            if attached_notes is not None:
                n.attached_notes = json.dumps(attached_notes)
            if append_notes_raw is not None:
                n.append_notes_raw = json.dumps(append_notes_raw)
            n.insert(ignore_permissions=True)
            return n.name

        r0 = node("Preamble", 10, None, "ROOT SECTION", 1, level=0)
        r1 = node("Preamble", 11, r0, "LEVEL 1", 2, level=1,
                  notes="flat-a1", attached_notes=["note-a1"], append_notes_raw={"C": "appended-a1"})
        r2 = node("Preamble", 12, r1, "LEVEL 2", 3, level=2)
        r3 = node("Preamble", 13, r2, "LEVEL 3", 4, level=3)
        r4 = node("Preamble", 14, r3, "LEVEL 4", 5, level=4)
        node("Line Item", 15, r4, "LEAF LINE ITEM", 6)          # eligible leaf, 5-deep chain
        node("Other", 16, r4, "a spacer/note row", 7)           # excluded: node_type Other
        # A non-current Preamble (a superseded section heading): excluded from the current set,
        # and used as the broken (unresolvable) parent for row 18 below.
        noncur = node("Preamble", 17, r4, "stale section", 8, is_current=0, level=1)
        node("Line Item", 18, noncur, "orphan leaf", 9)         # parent is non-current -> warning
        frappe.db.commit()

    @classmethod
    def tearDownClass(cls):
        frappe.db.delete("BOQ Nodes", {"boq": cls.boq})
        frappe.db.delete("BoQ Sheet", {"boq": cls.boq})
        frappe.db.commit()
        _cleanup_project(cls.project.name)
        super().tearDownClass()

    def setUp(self):
        self.ctx = build_sheet_context(self.boq, self.sheet)
        self.by_excel = {r["excel_row"]: r for r in self.ctx["rows"]}

    def test_wrapper_and_committed_version(self):
        self.assertEqual(self.ctx["committed_version"], 1)
        self.assertEqual(self.ctx["sheet_name"], "CtxFix ")
        self.assertEqual(self.ctx["sheet_warnings"], [])

    def test_eligibility_membership(self):
        # Preambles + Line Items eligible; Other + non-current excluded.
        for x in (10, 11, 12, 13, 14, 15, 18):
            self.assertIn(x, self.by_excel)
        self.assertNotIn(16, self.by_excel, "Other node excluded")
        self.assertNotIn(17, self.by_excel, "non-current node excluded")

    def test_ancestor_chain_root_first_all_present(self):
        leaf = self.by_excel[15]
        self.assertEqual(len(leaf["anc_texts"]), 6, "sheet + 5 ancestors")
        self.assertEqual(leaf["anc_texts"][0], "CtxFix ", "sheet_name prepended VERBATIM")
        self.assertEqual(
            leaf["anc_headers"],
            ["CtxFix ", "ROOT SECTION", "LEVEL 1", "LEVEL 2", "LEVEL 3", "LEVEL 4"],
        )
        self.assertEqual(len(leaf["ancestors"]), 5)
        self.assertEqual(leaf["ancestors"][0]["node_type"], "Preamble")
        self.assertEqual(leaf["ancestors"][0]["description"], "ROOT SECTION")
        self.assertEqual(leaf["ancestors"][4]["description"], "LEVEL 4")

    def test_headers_vs_texts_notes_split(self):
        leaf = self.by_excel[15]
        # anc index 2 == LEVEL 1 (the noted ancestor). Headers exclude notes; texts include them,
        # in the harness _notes_text order (own notes, attached, append).
        self.assertEqual(leaf["anc_headers"][2], "LEVEL 1")
        self.assertNotIn("note-a1", leaf["anc_headers"][2])
        self.assertEqual(leaf["anc_texts"][2], "LEVEL 1 flat-a1 | note-a1 | appended-a1")

    def test_every_ancestor_notes_carried(self):
        leaf = self.by_excel[15]
        a1 = leaf["ancestors"][1]  # LEVEL 1
        self.assertEqual(a1["description"], "LEVEL 1")
        for tok in ("flat-a1", "note-a1", "appended-a1"):
            self.assertIn(tok, a1["notes"])
        self.assertEqual(_as_obj(leaf["anc_attached_notes"][1]), ["note-a1"])
        self.assertEqual(_as_obj(leaf["anc_append_notes_raw"][1]), {"C": "appended-a1"})

    def test_broken_parent_warns_not_dropped(self):
        self.assertIn(18, self.by_excel, "row with a broken parent ref is KEPT")
        broken = self.by_excel[18]
        self.assertTrue(broken["warnings"], "a warning is surfaced")
        self.assertIn("missing or not current", broken["warnings"][0])
        self.assertEqual(broken["ancestors"], [], "unresolved chain is empty")
        # A clean row carries no warning.
        self.assertEqual(self.by_excel[15]["warnings"], [])


# ── AI VOTER (stubbed client) ────────────────────────────────────────────────────
class _Block:
    def __init__(self, text):
        self.text = text


class _Resp:
    def __init__(self, text):
        self.content = [_Block(text)]


class _FakeMessages:
    def __init__(self, responder):
        self._responder = responder
        self.calls = 0

    def create(self, **kwargs):
        self.calls += 1
        return self._responder(self.calls, kwargs)


class _FakeClient:
    def __init__(self, responder):
        self.messages = _FakeMessages(responder)


def _ctx_items(n, start=100):
    return [
        {"excel_row": start + i, "sheet_name": "S", "description": f"d{i}",
         "ancestors": [], "notes": ""}
        for i in range(n)
    ]


class TestAiVoter(FrappeTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.a_valid = sorted({c["category_id"] for c in load_ruleset()["categories"]})[0]

    def _set_enabled(self, enabled):
        frappe.db.set_single_value(_AI_SETTINGS, "enabled", 1 if enabled else 0)

    def test_disabled_fails_closed_no_call(self):
        self._set_enabled(False)
        fake = _FakeClient(lambda call, kwargs: _Resp("[]"))
        res = ai_voter.classify_rows_ai(_ctx_items(3), client=fake)
        self.assertFalse(res["enabled"])
        self.assertEqual(fake.messages.calls, 0, "no API call when disabled")
        self.assertTrue(all(r["category_id"] == "" and r["confidence"] == 0.0 for r in res["results"]))

    def test_batch_chunking_and_valid_id(self):
        self._set_enabled(True)
        a_valid = self.a_valid

        def responder(call, kwargs):
            arr = []
            for i in range(25):
                rid = 100 + i
                if rid == 100:
                    arr.append({"id": rid, "category_id": a_valid, "confidence": 0.9, "brief_reason": "ok"})
                elif rid == 101:
                    arr.append({"id": rid, "category_id": "ZZZ_INVALID", "confidence": 0.8, "brief_reason": "bad"})
                else:
                    arr.append({"id": rid, "category_id": "", "confidence": 0.1, "brief_reason": ""})
            return _Resp(json.dumps(arr))

        fake = _FakeClient(responder)
        res = ai_voter.classify_rows_ai(_ctx_items(25), client=fake)
        self.assertTrue(res["enabled"])
        self.assertEqual(fake.messages.calls, 2, "25 items batched at 20 -> 2 calls")
        by = {r["excel_row"]: r for r in res["results"]}
        self.assertEqual(by[100]["category_id"], a_valid)
        self.assertEqual(by[101]["category_id"], "", "invalid category id rejected -> blank")
        self.assertAlmostEqual(by[101]["confidence"], 0.8, msg="confidence kept even when cat blanked")
        self.assertTrue(res["model"])
        self.assertTrue(res["prompt_version"].startswith("v"))

    def test_retry_on_transient(self):
        self._set_enabled(True)
        a_valid = self.a_valid

        def responder(call, kwargs):
            if call == 1:
                raise RuntimeError("transient 503 overloaded")
            return _Resp(json.dumps([{"id": 200, "category_id": a_valid, "confidence": 0.7,
                                      "brief_reason": "r"}]))

        fake = _FakeClient(responder)
        with mock.patch("nirmaan_stack.services.boq_category.ai_voter.time.sleep"):
            res = ai_voter.classify_rows_ai(
                [{"excel_row": 200, "sheet_name": "S", "description": "d", "ancestors": [], "notes": ""}],
                client=fake,
            )
        self.assertEqual(fake.messages.calls, 2, "retried once after the transient error")
        self.assertEqual(res["results"][0]["category_id"], a_valid)
