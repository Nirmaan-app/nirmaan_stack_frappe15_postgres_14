# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and Contributors
# See license.txt

"""Tests for the classifier endpoints + orchestrator + job plumbing (Classifier CL-1b).

Coverage matrix:
  ENGINES
    POS  Electrical available; HVAC + ELV present-but-unavailable; is_discipline_available gate.
  ORCHESTRATOR (DB seeded tree; STUBBED AI voter via ai_voter's injectable client -- no live API)
    POS  whole sheet classifies every eligible row; rows persist as current with routing filled.
    POS  a range spanning an ineligible spacer + a superseded row classifies only the eligible
         subset and reports honest N-of-M + a skipped_by_reason rollup (SILENT, no throw).
    POS  consensus (rule==AI, conf outside the weak window) -> Auto-accepted, final=consensus.
    NEG  AI disabled -> voter fails closed (no call) -> every row Needs review, blank final.
  START_CLASSIFY (mock frappe.enqueue -- no real queue)
    NEG  unavailable engine / bad range / uncommitted sheet -> throw.
    POS  happy path returns a job_id, enqueues the worker (queue=long, timeout=600), sets marker.
  STATUS  idle when nothing; done mirrors the terminal payload; running when a live marker.
  WORKER  success -> terminal success payload + marker cleared + event published; failure ->
          terminal error payload + marker cleared (never left stuck).
  GET_SHEET_CATEGORIES  effective = human when set else final; only current-version rows.
  SET_ROW_CATEGORY  valid id writes + returns effective; unknown id -> throw; "" clears to machine.

AI settings are toggled per test via set_single_value; TestOrchestrator restores enabled=0 in
tearDownClass because persist.write_row_categories commits (so the toggle would otherwise leak).
"""

import json
from unittest import mock

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.boq.wizard import classify
from nirmaan_stack.api.boq.wizard.classify import (
    _classify_worker,
    get_classify_status,
    get_sheet_categories,
    list_engines,
    set_row_category,
    start_classify,
)
from nirmaan_stack.services.boq_category import engines, orchestrator, persist
from nirmaan_stack.services.boq_category.runner import classify_line
from nirmaan_stack.api.boq.wizard.test_review_screen import _cleanup_project, _make_project

_ROW_CATEGORY = "BoQ Row Category"
_AI_SETTINGS = "BOQ Upload Review AI Settings"


# ── Fake Anthropic client (mirrors the CL-1a AI voter test) ──────────────────────
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


def _fake_ai(answers):
    """answers: {excel_row: (category_id, confidence)} -> a fake client returning them."""
    def responder(call, kwargs):
        arr = [
            {"id": rid, "category_id": cat, "confidence": conf, "brief_reason": "t"}
            for rid, (cat, conf) in answers.items()
        ]
        return _Resp(json.dumps(arr))

    return _FakeClient(responder)


# ── Seeding helpers ──────────────────────────────────────────────────────────────
def _new_boq(project_name, name):
    boq = frappe.new_doc("BOQs")
    boq.project = project_name
    boq.boq_name = name
    boq.tax_treatment = "Pre-tax"
    boq.insert(ignore_permissions=True)
    frappe.db.commit()
    return boq.name


def _new_sheet(boq, sheet_name, commit_version=1):
    bs = frappe.new_doc("BoQ Sheet")
    bs.boq = boq
    bs.sheet_name = sheet_name
    bs.sheet_order = 1
    bs.commit_version = commit_version
    bs.is_current = 1
    bs.insert(ignore_permissions=True)
    frappe.db.commit()
    return bs.name


def _node(boq, sheet_doc, node_type, src, parent, desc, sort,
          is_current=1, level=None, row_class=None, qty=None):
    n = frappe.new_doc("BOQ Nodes")
    n.boq = boq
    n.sheet = sheet_doc
    n.node_type = node_type
    n.source_row_number = src
    n.parent_node = parent
    n.description = desc
    n.sort_order = sort
    n.commit_version = 1
    n.is_current = is_current
    if level is not None:
        n.level = level
    elif node_type == "Preamble":
        n.level = 0
    if node_type == "Line Item":
        n.qty = 0 if qty is None else qty
    if row_class is not None:
        n.row_class = row_class
    n.insert(ignore_permissions=True)
    return n.name


def _cat_row(excel_row, **kw):
    base = {
        "excel_row": excel_row,
        "rule_category_id": "earthing",
        "rule_band": "HIGH",
        "rule_score": 0.9,
        "ai_category_id": "earthing",
        "ai_confidence": 0.9,
        "final_category_id": "earthing",
        "routing": "Auto-accepted",
        "routing_reason": "consensus -- earthing",
        "description": "committed line",
        "rules_version": "",
        "prompt_version": "v1.3",
        "model": "claude-opus-4-8",
    }
    base.update(kw)
    return base


# ── ENGINES ──────────────────────────────────────────────────────────────────────
class TestEngines(FrappeTestCase):
    def test_registry_shape_and_availability(self):
        listed = list_engines()
        for e in listed:
            for k in ("id", "label", "discipline", "available"):
                self.assertIn(k, e)
        by_disc = {e["discipline"]: e for e in listed}
        self.assertTrue(by_disc["Electrical"]["available"])
        self.assertFalse(by_disc["HVAC"]["available"])
        self.assertFalse(by_disc["ELV"]["available"])

    def test_is_discipline_available(self):
        self.assertTrue(engines.is_discipline_available("Electrical"))
        self.assertFalse(engines.is_discipline_available("HVAC"))
        self.assertFalse(engines.is_discipline_available("Nonexistent"))

    def test_category_catalog(self):
        from nirmaan_stack.api.boq.wizard.classify import get_category_catalog

        cat = get_category_catalog("Electrical")
        self.assertEqual(cat["discipline"], "Electrical")
        ids = {c["id"] for c in cat["categories"]}
        self.assertIn("db_switchgear", ids)
        # every category carries a non-empty display label (id fallback ensures this)
        self.assertTrue(cat["categories"] and all(c["label"] for c in cat["categories"]))
        # an unavailable engine has no catalog -> throws
        with self.assertRaises(frappe.ValidationError):
            get_category_catalog("HVAC")


# ── ORCHESTRATOR ─────────────────────────────────────────────────────────────────
class TestOrchestrator(FrappeTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.project = _make_project()
        cls.boq = _new_boq(cls.project.name, "Orchestrator BoQ")
        cls.sheet = "OrchFix "  # VERBATIM trailing space (#152)
        sd = _new_sheet(cls.boq, cls.sheet)
        p = _node(cls.boq, sd, "Preamble", 10, None, "SECTION", 1, level=0)
        _node(cls.boq, sd, "Line Item", 11, p, "zzz nonsense qqq", 2)  # rule abstains
        _node(cls.boq, sd, "Line Item", 12, p, "supply and fixing of 25x3mm gi earth strip", 3)
        _node(cls.boq, sd, "Other", 13, p, "", 4, row_class="spacer")  # skipped: layout
        _node(cls.boq, sd, "Line Item", 14, p, "stale item", 5, is_current=0)  # skipped: superseded
        frappe.db.commit()

    @classmethod
    def tearDownClass(cls):
        frappe.db.set_single_value(_AI_SETTINGS, "enabled", 0)  # restore (persist commits leak it)
        frappe.db.delete(_ROW_CATEGORY, {"boq": cls.boq})
        frappe.db.delete("BOQ Nodes", {"boq": cls.boq})
        frappe.db.delete("BoQ Sheet", {"boq": cls.boq})
        frappe.db.commit()
        _cleanup_project(cls.project.name)
        super().tearDownClass()

    def test_whole_sheet_all_ai_blank_needs_review(self):
        frappe.db.set_single_value(_AI_SETTINGS, "enabled", 1)
        client = _fake_ai({10: ("", 0.0), 11: ("", 0.0), 12: ("", 0.0)})
        summary = orchestrator.classify_sheet_rows(self.boq, self.sheet, "Electrical", ai_client=client)
        # eligible = Preamble(10) + LI1(11) + LI2(12) = 3
        self.assertEqual(summary["eligible_classified"], 3)
        self.assertEqual(summary["needs_review"], 3)  # AI blank -> never consensus
        self.assertEqual(summary["auto_accepted"], 0)
        cats = frappe.get_all(
            _ROW_CATEGORY, filters={"boq": self.boq, "is_current": 1},
            fields=["routing", "final_category_id"],
        )
        self.assertEqual(len(cats), 3)
        self.assertTrue(all(c["routing"] == "Needs review" for c in cats))
        self.assertTrue(all((c["final_category_id"] or "") == "" for c in cats))

    def test_range_skip_rollup(self):
        frappe.db.set_single_value(_AI_SETTINGS, "enabled", 1)
        client = _fake_ai({11: ("", 0.0), 12: ("", 0.0)})
        summary = orchestrator.classify_sheet_rows(
            self.boq, self.sheet, "Electrical", row_filter=(11, 14), ai_client=client
        )
        self.assertEqual(summary["eligible_classified"], 2)  # LI1 + LI2
        self.assertEqual(summary["total_in_range"], 4)  # 11,12,13,14 (honest M)
        self.assertEqual(summary["skipped_total"], 2)
        self.assertEqual(summary["skipped_by_reason"], {"layout": 1, "superseded": 1})

    def test_consensus_auto_accepts(self):
        frappe.db.set_single_value(_AI_SETTINGS, "enabled", 1)
        # Discover the rule verdict for LI2 with the SAME feed the orchestrator builds (ancestor P).
        rule = classify_line(
            "supply and fixing of 25x3mm gi earth strip",
            ["OrchFix ", "SECTION"], [], discipline="Electrical",
            ancestor_headers=["OrchFix ", "SECTION"],
        )
        self.assertTrue(rule["category_id"], "precondition: LI2 must classify to a non-blank category")
        # Echo the rule category at 0.99 (outside the weak window even if LOW band) -> Auto-accepted.
        client = _fake_ai({11: ("", 0.0), 12: (rule["category_id"], 0.99)})
        summary = orchestrator.classify_sheet_rows(
            self.boq, self.sheet, "Electrical", row_filter=(11, 12), ai_client=client
        )
        self.assertEqual(summary["eligible_classified"], 2)
        self.assertEqual(summary["auto_accepted"], 1)
        self.assertEqual(summary["needs_review"], 1)
        li2 = frappe.get_all(
            _ROW_CATEGORY, filters={"boq": self.boq, "excel_row": 12, "is_current": 1},
            fields=["routing", "final_category_id"],
        )[0]
        self.assertEqual(li2["routing"], "Auto-accepted")
        self.assertEqual(li2["final_category_id"], rule["category_id"])

    def test_ai_disabled_fails_closed(self):
        frappe.db.set_single_value(_AI_SETTINGS, "enabled", 0)
        client = _fake_ai({11: ("panels", 0.9), 12: ("panels", 0.9)})  # used only if enabled
        summary = orchestrator.classify_sheet_rows(
            self.boq, self.sheet, "Electrical", row_filter=(11, 12), ai_client=client
        )
        self.assertEqual(summary["eligible_classified"], 2)
        self.assertEqual(summary["needs_review"], 2)
        self.assertEqual(summary["auto_accepted"], 0)
        self.assertEqual(client.messages.calls, 0, "disabled -> no AI call attempted")

    def test_progress_cb_monotonic_per_batch(self):
        # Force multiple 20-row slices on the 3-eligible-row fixture by patching the batch size
        # to 2 (test-only; production stays 20). progress_cb must receive a monotonic
        # non-decreasing `done`, capped at total, ending exactly at (total, total).
        frappe.db.set_single_value(_AI_SETTINGS, "enabled", 1)
        client = _fake_ai({10: ("", 0.0), 11: ("", 0.0), 12: ("", 0.0)})
        calls = []
        with mock.patch("nirmaan_stack.services.boq_category.orchestrator._AI_BATCH", 2):
            summary = orchestrator.classify_sheet_rows(
                self.boq, self.sheet, "Electrical",
                progress_cb=lambda done, total: calls.append((done, total)),
                ai_client=client,
            )
        self.assertEqual(summary["eligible_classified"], 3)
        self.assertTrue(calls, "progress_cb fired")
        dones = [d for d, _ in calls]
        self.assertEqual(dones, sorted(dones), "done is monotonic non-decreasing")
        self.assertTrue(all(t == 3 for _, t in calls), "total == eligible count")
        self.assertLessEqual(max(dones), 3, "done never exceeds total")
        self.assertEqual(calls[-1], (3, 3), "final progress is total-of-total")


# ── START_CLASSIFY ───────────────────────────────────────────────────────────────
class TestStartClassify(FrappeTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.project = _make_project()
        cls.boq = _new_boq(cls.project.name, "Start Classify BoQ")
        cls.sheet = "StartFix "
        _new_sheet(cls.boq, cls.sheet)

    @classmethod
    def tearDownClass(cls):
        frappe.cache().delete_value(classify._marker_key(cls.boq, cls.sheet, "Electrical"))
        frappe.cache().delete_value(classify._status_key(cls.boq, cls.sheet, "Electrical"))
        frappe.db.delete("BoQ Sheet", {"boq": cls.boq})
        frappe.db.commit()
        _cleanup_project(cls.project.name)
        super().tearDownClass()

    def test_unavailable_engine_throws(self):
        with self.assertRaises(frappe.ValidationError):
            start_classify(boq=self.boq, sheet_name=self.sheet, discipline="HVAC", scope={"mode": "sheet"})

    def test_bad_range_throws(self):
        with self.assertRaises(frappe.ValidationError):
            start_classify(
                boq=self.boq, sheet_name=self.sheet, discipline="Electrical",
                scope={"mode": "range", "start": 20, "end": 10},
            )

    def test_uncommitted_sheet_throws(self):
        with self.assertRaises(frappe.ValidationError):
            start_classify(
                boq=self.boq, sheet_name="No Such Sheet", discipline="Electrical", scope={"mode": "sheet"}
            )

    def test_happy_path_enqueues_and_marks(self):
        # Spy on _set_marker (still executes) to verify the marker is set with the returned
        # job_id. NB: we do NOT read the Redis marker back here -- FrappeTestCase isolates a
        # frappe.cache() write made before the endpoint's frappe.db.commit() from a later read
        # in the same test (a harness quirk; a probe confirms the marker persists across commit
        # in a real request). The spy asserts the contract without that read.
        with mock.patch("frappe.enqueue") as enq, mock.patch(
            "nirmaan_stack.api.boq.wizard.classify._set_marker", wraps=classify._set_marker
        ) as setm:
            res = start_classify(
                boq=self.boq, sheet_name=self.sheet, discipline="Electrical", scope={"mode": "sheet"}
            )
        self.assertEqual(res["status"], "queued")
        self.assertTrue(res["job_id"])
        enq.assert_called_once()
        args, kwargs = enq.call_args
        self.assertTrue(args[0].endswith("_classify_worker"))
        self.assertEqual(kwargs["queue"], "long")
        self.assertEqual(kwargs["timeout"], 600)
        self.assertEqual(kwargs["job_id"], res["job_id"])
        setm.assert_called_once()
        # _set_marker(boq, sheet_name, discipline, job_id, user) -- job_id is positional arg 3.
        self.assertEqual(setm.call_args[0][3], res["job_id"])
        classify._clear_marker(self.boq, self.sheet, "Electrical")
        frappe.cache().delete_value(classify._status_key(self.boq, self.sheet, "Electrical"))


# ── STATUS ───────────────────────────────────────────────────────────────────────
class TestClassifyStatus(FrappeTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.boq = "STATUS-TEST-BOQ"  # status is pure Redis -- no BOQs row needed
        cls.sheet = "StatusFix "
        cls.disc = "Electrical"

    def tearDown(self):
        frappe.cache().delete_value(classify._status_key(self.boq, self.sheet, self.disc))
        frappe.cache().delete_value(classify._marker_key(self.boq, self.sheet, self.disc))

    def test_idle_when_nothing(self):
        res = get_classify_status(boq=self.boq, sheet_name=self.sheet, discipline=self.disc)
        self.assertEqual(res["state"], "idle")

    def test_done_mirrors_terminal(self):
        payload = {
            "status": "success", "boq_name": self.boq, "sheet_name": self.sheet, "discipline": self.disc,
            "total_in_range": 4, "eligible_classified": 2, "needs_review": 1, "auto_accepted": 1,
            "skipped_total": 2, "skipped_by_reason": {"layout": 1, "superseded": 1},
            "committed_version": 1, "sheet_warnings": [],
        }
        frappe.cache().set_value(classify._status_key(self.boq, self.sheet, self.disc), payload, expires_in_sec=60)
        res = get_classify_status(boq=self.boq, sheet_name=self.sheet, discipline=self.disc)
        self.assertEqual(res["state"], "done")
        self.assertEqual(res["status"], "success")
        self.assertEqual(res["eligible_classified"], 2)
        self.assertEqual(res["skipped_by_reason"], {"layout": 1, "superseded": 1})

    def test_running_when_marker_live(self):
        classify._set_marker(self.boq, self.sheet, self.disc, "fakejob123", "Administrator")
        with mock.patch("nirmaan_stack.api.boq.wizard.classify.get_job_status", return_value="started"):
            res = get_classify_status(boq=self.boq, sheet_name=self.sheet, discipline=self.disc)
        self.assertEqual(res["state"], "running")


# ── WORKER ───────────────────────────────────────────────────────────────────────
class TestClassifyWorker(FrappeTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.boq = "WORKER-TEST-BOQ"
        cls.sheet = "WorkerFix "
        cls.disc = "Electrical"

    def tearDown(self):
        frappe.cache().delete_value(classify._status_key(self.boq, self.sheet, self.disc))
        frappe.cache().delete_value(classify._marker_key(self.boq, self.sheet, self.disc))

    def test_success_terminal_and_marker_cleared(self):
        classify._set_marker(self.boq, self.sheet, self.disc, "job1", "Administrator")
        fake_summary = {
            "total_in_range": 4, "eligible_classified": 2, "needs_review": 1, "auto_accepted": 1,
            "skipped_total": 2, "skipped_by_reason": {"layout": 1, "superseded": 1},
            "committed_version": 1, "sheet_warnings": [],
        }
        with mock.patch(
            "nirmaan_stack.api.boq.wizard.classify.orchestrator.classify_sheet_rows",
            return_value=fake_summary,
        ), mock.patch("frappe.publish_realtime") as pub, mock.patch("frappe.db.commit"):
            _classify_worker(
                boq=self.boq, sheet_name=self.sheet, discipline=self.disc,
                scope={"mode": "sheet"}, user="Administrator",
            )
        term = frappe.cache().get_value(classify._status_key(self.boq, self.sheet, self.disc))
        self.assertEqual(term["status"], "success")
        self.assertEqual(term["eligible_classified"], 2)
        self.assertIsNone(classify._get_marker(self.boq, self.sheet, self.disc))
        pub.assert_called_once()
        self.assertEqual(pub.call_args[0][0], "boq:classify_sheet_done")

    def test_failure_terminal_and_marker_cleared(self):
        classify._set_marker(self.boq, self.sheet, self.disc, "job2", "Administrator")
        with mock.patch(
            "nirmaan_stack.api.boq.wizard.classify.orchestrator.classify_sheet_rows",
            side_effect=RuntimeError("boom"),
        ), mock.patch("frappe.publish_realtime") as pub, mock.patch("frappe.db.rollback"), \
                mock.patch("frappe.log_error"):
            _classify_worker(
                boq=self.boq, sheet_name=self.sheet, discipline=self.disc,
                scope={"mode": "sheet"}, user="Administrator",
            )
        term = frappe.cache().get_value(classify._status_key(self.boq, self.sheet, self.disc))
        self.assertEqual(term["status"], "error")
        self.assertEqual(term["error_code"], "classify_failed")
        self.assertIsNone(classify._get_marker(self.boq, self.sheet, self.disc))
        pub.assert_called_once()


# ── GET_SHEET_CATEGORIES ─────────────────────────────────────────────────────────
class TestGetSheetCategories(FrappeTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.project = _make_project()
        cls.boq = _new_boq(cls.project.name, "Get Categories BoQ")
        cls.sheet = "CatsFix "
        _new_sheet(cls.boq, cls.sheet)
        persist.write_row_categories(cls.boq, cls.sheet, 1, "Electrical", [
            _cat_row(11),
            _cat_row(12, rule_category_id="panels", rule_band="LOW", ai_category_id="",
                     ai_confidence=0.0, final_category_id="", routing="Needs review",
                     routing_reason="disagreement"),
        ])

    @classmethod
    def tearDownClass(cls):
        frappe.db.delete(_ROW_CATEGORY, {"boq": cls.boq})
        frappe.db.delete("BoQ Sheet", {"boq": cls.boq})
        frappe.db.commit()
        _cleanup_project(cls.project.name)
        super().tearDownClass()

    def test_effective_is_final_when_no_human(self):
        res = get_sheet_categories(boq=self.boq, sheet_name=self.sheet)
        self.assertEqual(res["committed_version"], 1)
        by = {c["excel_row"]: c for c in res["categories"]}
        self.assertEqual(by[11]["effective_category_id"], "earthing")
        self.assertEqual(by[12]["effective_category_id"], "")

    def test_effective_is_human_when_set(self):
        persist.set_human_verdict(self.boq, self.sheet, 12, 1, "Electrical", "panels")
        res = get_sheet_categories(boq=self.boq, sheet_name=self.sheet)
        by = {c["excel_row"]: c for c in res["categories"]}
        self.assertEqual(by[12]["human_category_id"], "panels")
        self.assertEqual(by[12]["effective_category_id"], "panels")

    def test_only_current_version_rows(self):
        persist.write_row_categories(self.boq, self.sheet, 1, "Electrical", [_cat_row(11)])
        res = get_sheet_categories(boq=self.boq, sheet_name=self.sheet)
        elevens = [c for c in res["categories"] if c["excel_row"] == 11]
        self.assertEqual(len(elevens), 1)


# ── SET_ROW_CATEGORY ─────────────────────────────────────────────────────────────
class TestSetRowCategory(FrappeTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.project = _make_project()
        cls.boq = _new_boq(cls.project.name, "Set Category BoQ")
        cls.sheet = "SetFix "
        _new_sheet(cls.boq, cls.sheet)
        persist.write_row_categories(cls.boq, cls.sheet, 1, "Electrical", [
            _cat_row(11, rule_category_id="panels", rule_band="LOW", ai_category_id="",
                     ai_confidence=0.0, final_category_id="", routing="Needs review",
                     routing_reason="disagreement"),
        ])

    @classmethod
    def tearDownClass(cls):
        frappe.db.delete(_ROW_CATEGORY, {"boq": cls.boq})
        frappe.db.delete("BoQ Sheet", {"boq": cls.boq})
        frappe.db.commit()
        _cleanup_project(cls.project.name)
        super().tearDownClass()

    def test_valid_id_sets_and_returns_effective(self):
        res = set_row_category(
            boq=self.boq, sheet_name=self.sheet, excel_row=11, human_category_id="earthing"
        )
        self.assertEqual(res["effective_category_id"], "earthing")

    def test_unknown_id_throws(self):
        with self.assertRaises(frappe.ValidationError):
            set_row_category(
                boq=self.boq, sheet_name=self.sheet, excel_row=11, human_category_id="NOT_A_CATEGORY"
            )

    def test_blank_clears_to_machine_verdict(self):
        set_row_category(boq=self.boq, sheet_name=self.sheet, excel_row=11, human_category_id="earthing")
        res = set_row_category(boq=self.boq, sheet_name=self.sheet, excel_row=11, human_category_id="")
        self.assertEqual(res["effective_category_id"], "")  # final was "" (needs review)
