# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt
"""F1-a (owner 2026-10-22): the PRICING payload reads a heading's attached notes from the CURRENT committed tree, by the
commit's own rule (commit_pipeline._derive_attached_notes, imported), never from the saved `attached_notes` copy; the
classifier keeps reading the saved copy (O1).

Every sheet here is committed through the REAL commit write-body (commit_pipeline._commit_one_sheet), from seeded
review rows, so the saved copy is whatever the commit wrote. The one stale sheet has its saved copy overwritten AFTER the
commit -- a fixture-only stand-in for a sheet committed before 2026-08-11.

  TestF1aFresh  (AC5 pos) derived == saved on a fresh commit; the payload is byte-identical to the saved-copy build;
                the empty-description stand-in note contributes exactly what it did (O2 deferred); the stand-in adapter
                is pinned to the commit's own expression; the payload == page pin for heading notes.
  TestF1aStale  (AC5 neg) the payload carries the tree's notes and not the stale text; the classifier still reads the
                saved copy; (AC6) the Suggest run logs ONE line naming the stale heading, the guards stay silent.
  TestF1aDeep   (AC5 lean) a great-grandparent's (and higher) attached notes never appear; the grandparent's do.
"""

import json
from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.boq.wizard import commit_pipeline
from nirmaan_stack.api.boq.wizard.review_screen import get_committed_rows
from nirmaan_stack.services.boq_category import ai_voter, context_builder
from nirmaan_stack.services.boq_category.context_builder import build_sheet_context
from nirmaan_stack.services.boq_fixture_teardown import fixture_boq_name, purge_boq
from nirmaan_stack.services.boq_rate_master import extraction

_TEST_PROJECT = "_TEST_BOQ_PROJECT_F1A_NOTES"
_CFG = {"header_row": 1, "header_row_count": 1, "column_role_map": {"A": {"role": "sl_no", "area": None},
        "B": {"role": "description", "area": None}}, "column_headers": {"A": "Sl", "B": "Description"}}
_GRID = [{"row_number": 1, "cells": {"A": "Sl", "B": "Description"}}]
_STALE_TEXT = "Modular : Round/Universal multipin type With Box"   # a note that belongs to another heading


def _purge(boq_name):
    """Roll back first, then each scope in its own try (CODING_STANDARDS: clean-up must survive a poisoned
    transaction). Raw deletes: list-valued JSON fields refuse delete_doc."""
    frappe.db.rollback()
    for doctype, filters in (("BOQ Nodes", {"boq": boq_name}), ("BoQ Committed Sheet Grid", {"boq": boq_name}),
                             ("BoQ Sheet", {"boq": boq_name}), ("BoQ Review Row", {"boq": boq_name})):
        try:
            for name in frappe.get_all(doctype, filters=filters, pluck="name"):
                for child in ("BOQ Node Qty By Area", "BoQ Committed Sheet Grid Row", "BoQ Sheet Work Package"):
                    frappe.db.delete(child, {"parent": name})
            frappe.db.delete(doctype, filters)
            frappe.db.commit()
        except Exception as exc:   # report, never swallow silently
            frappe.db.rollback()
            print(f"F1-a fixture purge: {doctype} {boq_name}: {exc!r}")
    try:
        purge_boq(boq_name)
        frappe.db.commit()
    except Exception as exc:
        frappe.db.rollback()
        print(f"F1-a fixture purge: BOQs {boq_name}: {exc!r}")


class _CommittedSheetCase(FrappeTestCase):
    """One fixture BoQ with one finalized sheet, committed through the real write-body in setUpClass."""

    SHEET = "F1a Sheet "   # trailing space is deliberate (#152 verbatim)
    ROWS: list = []        # (row_index, classification, kwargs)

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        boq = frappe.new_doc("BOQs")
        boq.project = _TEST_PROJECT
        boq.boq_name = f"F1-a {cls.__name__}"
        boq.append("sheet_drafts", {"sheet_name": cls.SHEET, "sheet_order": 1, "wizard_status": "Finalized",
                                    "sheet_config": json.dumps(_CFG)})
        boq.insert(set_name=fixture_boq_name("F1A_NOTES"), ignore_permissions=True, ignore_links=True)
        cls.boq_name = boq.name
        frappe.db.commit()
        for row_index, classification, kw in cls.ROWS:
            doc = frappe.new_doc("BoQ Review Row")
            doc.boq = cls.boq_name
            doc.sheet_name = cls.SHEET
            doc.row_index = row_index
            doc.source_row_number = row_index + 10
            doc.classification = classification
            doc.parent_index = kw.get("parent_index", -1)
            doc.human_parent = -1
            for f in ("description", "sl_no_value", "qty_total", "level"):
                if f in kw:
                    setattr(doc, f, kw[f])
            doc.insert(ignore_permissions=True)
        frappe.db.commit()
        draft = next(d for d in frappe.get_doc("BOQs", cls.boq_name).sheet_drafts if d.sheet_name == cls.SHEET)
        cls.boq_sheet = commit_pipeline._commit_one_sheet(cls.boq_name, cls.SHEET, "finalized", _GRID, draft)["boq_sheet_name"]
        frappe.db.commit()

    @classmethod
    def tearDownClass(cls):
        if getattr(cls, "boq_name", None):
            _purge(cls.boq_name)
        super().tearDownClass()

    def ctx(self):
        return build_sheet_context(self.boq_name, self.SHEET)

    def row(self, ctx, excel_row):
        return next(r for r in ctx["rows"] if r["excel_row"] == excel_row)

    def node(self, excel_row):
        return frappe.db.get_value("BOQ Nodes", {"sheet": self.boq_sheet, "is_current": 1, "source_row_number": excel_row},
                                   ["name", "description", "code", "attached_notes"], as_dict=True)

    @staticmethod
    def saved_copy_build(row):
        """The pricing payload exactly as before F1-a: the same row with the derived keys removed, so _ai_item falls back
        to the saved `attached_notes` copy on the row and on every ancestor."""
        r = json.loads(json.dumps(row, default=str))
        r.pop("derived_attached_notes", None)
        for a in r["ancestors"]:
            a.pop("derived_attached_notes", None)
        return r


# Fresh: SECTION A (r10) > [note "A-spec one" r11, SUB B (r12) > [note "B-spec" r13, stand-in note "" / sl "1.03" r14,
#        cable 3C (r15) > note "LI own note" r16], cable 4C (r17)]
_FRESH = [
    (0, "preamble", {"description": "SECTION A", "sl_no_value": "A"}),
    (1, "note", {"description": "A-spec one", "parent_index": 0}),
    (2, "preamble", {"description": "SUB B", "sl_no_value": "1", "parent_index": 0}),
    (3, "note", {"description": "B-spec", "parent_index": 2}),
    (4, "note", {"description": "", "sl_no_value": "1.03", "parent_index": 2}),
    (5, "line_item", {"description": "cable 3C", "sl_no_value": "1.1", "parent_index": 2, "qty_total": 1.0}),
    (6, "note", {"description": "LI own note", "parent_index": 5}),
    (7, "line_item", {"description": "cable 4C", "sl_no_value": "2", "parent_index": 0, "qty_total": 1.0}),
]


class TestF1aFresh(_CommittedSheetCase):
    ROWS = _FRESH

    def test_pos_derived_equals_the_saved_copy_on_a_fresh_commit(self):
        """A commit made today: on every row and every ancestor, the derived list == the saved copy (as the payload
        reads both), and the sheet reports no drift."""
        ctx = self.ctx()
        self.assertEqual(ctx["attached_notes_drift"], [])
        for r in ctx["rows"]:
            self.assertEqual(extraction._as_list(r["derived_attached_notes"]), extraction._as_list(r["attached_notes"]))
            for a in r["ancestors"]:
                self.assertEqual(extraction._as_list(a["derived_attached_notes"]), extraction._as_list(a["attached_notes"]))
        self.assertEqual(self.row(ctx, 12)["derived_attached_notes"], ["B-spec", ""],
                         "the stand-in note reaches the derive as '' -- what the commit saw")

    def test_pos_payload_is_byte_identical_to_the_saved_copy_build(self):
        """On a sheet whose saved copy is right, the pricing payload does not move by one byte."""
        ctx = self.ctx()
        for r in ctx["rows"]:
            self.assertEqual(json.dumps(extraction._ai_item(r), sort_keys=True),
                             json.dumps(extraction._ai_item(self.saved_copy_build(r)), sort_keys=True), r["excel_row"])
        item = extraction._ai_item(self.row(ctx, 15))
        self.assertEqual(item["notes"], {"attached": ["LI own note"]})
        parent = next(e for e in item["ancestor_chain"] if e.get("distance") == 1)
        self.assertEqual(parent["notes"], {"attached": ["B-spec"]},
                         "O2 deferred: the empty-description note contributes nothing, exactly as today")
        self.assertNotIn("1.03", json.dumps(item))

    def test_pos_the_stand_in_adapter_matches_the_commits_own_expression(self):
        """Ruling item 2: the adapter undoes exactly what commit_pipeline._build_node_pass1 writes for an empty
        description -- if either side changes, this goes red."""
        eff = {"effective_classification": "note", "effective_parent_index": None}
        for sl in (None, "1.03"):
            d = {"row_index": 0, "source_row_number": 1, "description": "", "sl_no_value": sl}
            written = commit_pipeline._build_node_pass1("x", d, eff, 1, frappe.utils.now(), {}).description
            self.assertEqual(written, sl or context_builder._COMMIT_UNTITLED)
            self.assertEqual(context_builder._commit_note_text({"description": written, "code": sl}), "")
        # the stored node of the fixture's stand-in row carries the commit's text, and reaches the derive as ''
        n = self.node(14)
        self.assertEqual((n.description, n.code), ("1.03", "1.03"))
        # a real description is passed through untouched -- including one that only CONTAINS its code
        self.assertEqual(context_builder._commit_note_text({"description": "B-spec", "code": "1"}), "B-spec")
        self.assertEqual(context_builder._commit_note_text({"description": "1.03 note", "code": "1.03"}), "1.03 note")
        # the documented blind spot: a REAL description equal to its own code is indistinguishable and reads as ''
        self.assertEqual(context_builder._commit_note_text({"description": "A", "code": "A"}), "")

    def test_pin_payload_heading_notes_equal_the_pages_where_no_stand_in_note(self):
        """AC8: the payload's immediate-parent notes == the page's rowHeadingNotes (the page's rule over
        get_committed_rows) on every row whose heading carries no stand-in note; the row under a stand-in heading is the
        O2 exclusion, and it is NOT empty here (the pin is not vacuous) and differs exactly by the stand-in text."""
        frappe.set_user("Administrator")
        page = get_committed_rows(boq_name=self.boq_name, sheet_name=self.SHEET)["rows"]
        by_index = {p["row_index"]: p for p in page}

        def page_heading_notes(src):   # rateSuggestionModel.rowHeadingNotes, transcribed
            me = next(p for p in page if p["source_row_number"] == src)
            par = by_index.get(me["effective_parent_index"])
            if par is None:
                return None
            out = [str(v).strip() for v in (par.get("append_notes_raw") or {}).values() if str(v).strip()]
            if (par.get("row_notes") or "").strip():
                out.append(par["row_notes"].strip())
            out += [(p["description"] or "").strip() for p in sorted(page, key=lambda p: p["row_index"])
                    if p.get("effective_classification") == "note" and p.get("effective_parent_index") == par["row_index"]
                    and (p["description"] or "").strip()]
            return out

        compared = excluded = 0
        for r in self.ctx()["rows"]:
            pg = page_heading_notes(r["excel_row"])
            if pg is None:
                continue
            parent = next(e for e in extraction._ai_item(r)["ancestor_chain"] if e.get("distance") == 1)
            block = parent.get("notes") or {}
            payload = list((block.get("appended") or {}).values()) + (block.get("own") or []) + (block.get("attached") or [])
            if r["excel_row"] in (13, 14, 15, 16):   # rows under SUB B, which carries the stand-in note r14
                excluded += 1
                self.assertEqual([x for x in pg if x != "1.03"], payload, "differs ONLY by the stand-in text")
                self.assertIn("1.03", pg)
                continue
            compared += 1
            self.assertEqual(pg, payload, r["excel_row"])
        self.assertEqual((compared, excluded), (2, 1), "SUB B and cable 4C compared; cable 3C excluded (O2)")


# Stale: the same shape as Fresh minus the stand-in; after the commit, SUB B's saved copy is overwritten with a note that
# belongs to another heading and loses its own -- the pre-2026-08-11 failure (BOQ-26-00174 r148's shape).
class TestF1aStale(_CommittedSheetCase):
    ROWS = [r for r in _FRESH if r[0] != 4]

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        sub_b = frappe.db.get_value("BOQ Nodes", {"sheet": cls.boq_sheet, "is_current": 1, "source_row_number": 12}, "name")
        cls.stale_node = sub_b
        # Fixture-only raw writes of the saved copy (no doc_events matter: nothing derives from this field). SUB B gets a
        # note from another heading; the line item cable 3C (r15) loses its own note from the saved copy (00260's shape).
        frappe.db.set_value("BOQ Nodes", sub_b, "attached_notes", json.dumps([_STALE_TEXT]), update_modified=False)
        li = frappe.db.get_value("BOQ Nodes", {"sheet": cls.boq_sheet, "is_current": 1, "source_row_number": 15}, "name")
        frappe.db.set_value("BOQ Nodes", li, "attached_notes", None, update_modified=False)
        frappe.db.commit()

    def test_neg_the_payload_carries_the_trees_notes_and_not_the_stale_text(self):
        ctx = self.ctx()
        item = extraction._ai_item(self.row(ctx, 15))
        parent = next(e for e in item["ancestor_chain"] if e.get("distance") == 1)
        self.assertEqual(parent["notes"], {"attached": ["B-spec"]})
        self.assertNotIn(_STALE_TEXT, json.dumps(item))
        # ... and the saved-copy build (what the model was sent before F1-a) shows the defect being fixed
        before = extraction._ai_item(self.saved_copy_build(self.row(ctx, 15)))
        self.assertIn(_STALE_TEXT, json.dumps(before))
        self.assertNotIn("B-spec", json.dumps(before))
        # the heading row itself (SUB B, self tier) too
        self.assertEqual(extraction._ai_item(self.row(ctx, 12))["notes"], {"attached": ["B-spec"]})
        # the row's OWN attached note (self tier), missing from its saved copy, is sent from the tree
        self.assertEqual(item["notes"], {"attached": ["LI own note"]})
        self.assertNotIn("notes", before)

    def test_neg_the_deterministic_readers_read_the_tree_too(self):
        """AC2: row_own_text_fragments (the TPN post-match) and point_type_of (which reads the payload item) see the
        row's own note from the tree, not the saved copy that lost it."""
        row = self.row(self.ctx(), 15)
        self.assertEqual(extraction.row_own_text_fragments(row), ["cable 3C", "LI own note"])
        self.assertEqual(extraction.row_own_text_fragments(self.saved_copy_build(row)), ["cable 3C"])

    def test_neg_the_classifier_still_reads_the_saved_copy(self):
        """O1: the classifier's input is untouched -- its voter item still carries the saved copy's text."""
        voter = ai_voter._ai_item(self.row(self.ctx(), 15))
        self.assertIn(_STALE_TEXT, json.dumps(voter))
        self.assertNotIn("B-spec", json.dumps(voter))

    def test_ac6_the_suggest_run_logs_one_line_naming_the_stale_heading(self):
        with patch.object(extraction.frappe, "logger") as logger:
            extraction._log_attached_notes_drift_for(self.boq_name, self.SHEET, 1)
        self.assertEqual(logger.call_count, 1)
        logger.assert_called_with("boq_rate_extraction")
        warn = logger.return_value.warning
        self.assertEqual(warn.call_count, 1)
        line = warn.call_args[0][0]
        self.assertIn(self.stale_node, line)
        self.assertIn("headings=2", line)
        self.assertIn("src=12 saved=1 derived=1", line)
        self.assertIn("src=15 saved=0 derived=1", line)
        self.assertNotIn(_STALE_TEXT, line, "counts only, never the text")

    def test_ac6_the_population_read_itself_stays_silent(self):
        """The guards and the tick boxes call assemble_population too; only the Suggest run logs."""
        with patch.object(extraction.frappe, "logger") as logger:
            extraction.assemble_population(self.boq_name, self.SHEET)
        logger.assert_not_called()

    def test_ac6_run_extraction_calls_the_log_once_after_its_two_argument_population_read(self):
        """The Suggest run's entry point: assemble_population is called with exactly (boq, sheet_name) -- a two-argument
        stand-in still works (test_piping_v34 test_28) -- and the drift log is called once with the run's version."""
        from nirmaan_stack.api.boq.wizard import ai_settings
        with patch.object(extraction, "assemble_population", lambda boq, sheet: (7, [])), \
                patch.object(extraction, "_capture_write", lambda rec: None), \
                patch.object(ai_settings, "get_boq_ai_settings", lambda: {"enabled": False, "model": "stub"}), \
                patch.object(extraction, "_log_attached_notes_drift_for") as log_for:
            extraction.run_extraction(self.boq_name, self.SHEET)
        log_for.assert_called_once_with(self.boq_name, self.SHEET, 7)


class TestF1aFreshIsSilent(_CommittedSheetCase):
    ROWS = _FRESH

    def test_ac6_no_log_line_on_a_fresh_sheet(self):
        with patch.object(extraction.frappe, "logger") as logger:
            extraction._log_attached_notes_drift_for(self.boq_name, self.SHEET, 1)
        logger.assert_not_called()


# Deep: A (r10) > B (r12) > C (r14) > D (r16) > LI (r18); every heading has one note row ("<X>-att").
class TestF1aDeep(_CommittedSheetCase):
    ROWS = [
        (0, "preamble", {"description": "A", "sl_no_value": "A"}),
        (1, "note", {"description": "A-att", "parent_index": 0}),
        (2, "preamble", {"description": "B", "sl_no_value": "B", "parent_index": 0}),
        (3, "note", {"description": "B-att", "parent_index": 2}),
        (4, "preamble", {"description": "C", "sl_no_value": "C", "parent_index": 2}),
        (5, "note", {"description": "C-att", "parent_index": 4}),
        (6, "preamble", {"description": "D", "sl_no_value": "D", "parent_index": 4}),
        (7, "note", {"description": "D-att", "parent_index": 6}),
        (8, "line_item", {"description": "leaf", "sl_no_value": "1", "parent_index": 6, "qty_total": 1.0}),
    ]

    def test_lean_great_grandparent_and_above_never_carry_attached_notes(self):
        item = extraction._ai_item(self.row(self.ctx(), 18))
        by_d = {e.get("distance"): e for e in item["ancestor_chain"] if e.get("distance")}
        self.assertEqual(by_d[1]["notes"], {"attached": ["D-att"]})
        self.assertEqual(by_d[2]["notes"], {"attached": ["C-att"]})
        self.assertEqual((by_d[3]["tier"], by_d[4]["tier"]), ("lean", "lean"))
        self.assertNotIn("notes", by_d[3])
        self.assertNotIn("notes", by_d[4])
        self.assertNotIn("B-att", json.dumps(item))
        self.assertNotIn("A-att", json.dumps(item))
