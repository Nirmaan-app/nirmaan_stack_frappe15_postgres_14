"""
Tests for the review flags (S3, ADR-0033): Claude's sure changes, "Check type" / "Check parent",
"Looks OK", the counts and the finalize block.

NO live AI call anywhere: the service and the examples look-up are mocks.

  TestRowFlagRules         every flag rule, positive and negative, on plain dicts
  TestHistoryReaders       the edit-history readers behind R18 and R20
  TestRefusalAndSummary    the finalize sentence, the percentage, the heavy marker
  TestSureChanges          what is written into the parsed result, and what never is
  TestWorkerAndCachePath   both call sites in ai_assist.py; a superseded run re-types nothing
  TestReviewData           get_review_rows carries the flags and counts; the hidden type stays hidden
  TestClearing             type / parent changes, a re-mapped child, Looks OK, Revert
  TestLooksOk              the endpoint's refusals; one row per call
  TestFinalizeBlock        the order of the checks, both refusals, the sheets that pass
  TestHistoryWordingPins   the two history wordings this module reads, written by the REAL endpoints
"""
import datetime
import inspect
import unittest
from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.boq.wizard import ai_assist, ai_run_log, review_flags, review_screen

_ROW = "BoQ Review Row"
_RUN_LOG = "BoQ AI Run Log"
_SHEET = "FlagSheet"
_PARSED_AT = datetime.datetime(2026, 2, 3, 9, 0, 0)

_SETTINGS = "nirmaan_stack.api.boq.wizard.ai_assist.get_boq_ai_settings"
_API_KEY = "nirmaan_stack.api.boq.wizard.ai_assist.get_boq_ai_api_key"
_GUIDANCE = "nirmaan_stack.services.boq_ai_guidance.build_guidance"
_SERVICE = "nirmaan_stack.services.boq_ai_assist.run_ai_pass"

DONE = ai_run_log.CHECK_DONE
RUNNING = ai_run_log.CHECK_RUNNING
INCOMPLETE = ai_run_log.CHECK_INCOMPLETE
NOT_RUN = ai_run_log.CHECK_NOT_RUN


def _row(index, cls, parent=-1, **fields):
    """A review row as the rules read it. Defaults mean: no human change, no Claude answer."""
    row = {
        "row_index": index, "source_row_number": index + 10, "classification": cls,
        "parent_index": parent, "parser_classification": None,
        "human_classification": None, "human_parent": -1, "human_is_root": 0,
        "ai_suggestion_status": None, "ai_suggested_classification": None,
        "ai_classification_confidence": None,
        # 0, not -1: the column default of a row Claude never answered (the status is read first).
        "ai_suggested_parent": 0, "ai_suggested_is_root": 0,
        "unit": None, "qty_total": 0.0, "qty_by_area": {},
        "is_excluded": 0, "revision_carry_status": None,
        "edit_log": [], "ai_flags_ok": 0, "ai_flags_ok_at": None,
    }
    row.update(fields)
    return row


def _answer(cls=None, confidence=None, parent=-1, root=0):
    return {
        "ai_suggestion_status": "Pending", "ai_suggested_classification": cls,
        "ai_classification_confidence": confidence, "ai_suggested_parent": parent,
        "ai_suggested_is_root": root,
    }


def _entry(field, reason, at="2026-02-03 10:00:00.000000", frm=None, to=None):
    return {"field": field, "from": frm, "to": to, "by": "t@example.com", "at": at, "reason": reason}


def _open(flags):
    return (flags["check_type"], flags["check_parent"], flags["reasons"])


# ===========================================================================
# The rules (pure)
# ===========================================================================

class TestRowFlagRules(unittest.TestCase):

    # -- the check status ---------------------------------------------------

    def test_a_sheet_with_no_run_record_gets_no_flag_at_all(self):
        row = _row(1, "preamble", unit="Nos", qty_total=5.0, **_answer("line_item", "Medium", parent=7))
        self.assertEqual(_open(review_flags.row_flags(row, NOT_RUN)), (False, False, []))
        self.assertEqual(review_flags.row_flags(row, NOT_RUN)["doubts"], [])

    def test_a_failed_or_unfinished_check_leaves_only_the_unit_quantity_rule(self):
        row = _row(1, "preamble", unit="Nos", **_answer("note", "High", parent=7))
        for status in (INCOMPLETE, RUNNING):
            self.assertEqual(_open(review_flags.row_flags(row, status)),
                             (True, False, ["unit_qty_not_item"]), status)

    # -- Check type ---------------------------------------------------------

    def test_claude_naming_another_type_opens_check_type(self):
        row = _row(1, "preamble", **_answer("note", "High"))
        self.assertEqual(_open(review_flags.row_flags(row, DONE)), (True, False, ["type_doubt"]))

    def test_claude_naming_the_same_type_opens_nothing(self):
        row = _row(1, "line_item", **_answer("line_item", "High"))
        self.assertEqual(_open(review_flags.row_flags(row, DONE)), (False, False, []))

    def test_a_row_claude_surely_re_typed_is_not_flagged_for_its_type(self):
        row = _row(1, "line_item", parser_classification="preamble", **_answer("line_item", "High"))
        self.assertEqual(_open(review_flags.row_flags(row, DONE)), (False, False, []))

    def test_a_later_run_naming_another_type_on_a_re_typed_row_is_a_doubt_again(self):
        row = _row(1, "line_item", parser_classification="preamble", **_answer("note", "High"))
        self.assertEqual(_open(review_flags.row_flags(row, DONE)), (True, False, ["type_doubt"]))

    def test_a_sure_subtotal_to_item_answer_is_flagged_not_applied(self):
        row = _row(1, "subtotal_marker", **_answer("line_item", "High"))
        self.assertEqual(_open(review_flags.row_flags(row, DONE)), (True, False, ["type_doubt"]))

    def test_a_unit_on_a_row_that_is_not_an_item_opens_check_type(self):
        self.assertEqual(_open(review_flags.row_flags(_row(1, "preamble", unit="Nos"), DONE)),
                         (True, False, ["unit_qty_not_item"]))

    def test_a_quantity_on_a_row_that_is_not_an_item_opens_check_type(self):
        self.assertEqual(_open(review_flags.row_flags(_row(1, "note", qty_total=3.0), DONE)),
                         (True, False, ["unit_qty_not_item"]))
        per_area = _row(1, "subtotal_marker", qty_by_area={"Phase 1": 0, "Phase 2": 4})
        self.assertEqual(_open(review_flags.row_flags(per_area, DONE)),
                         (True, False, ["unit_qty_not_item"]))

    def test_no_unit_and_a_zero_quantity_open_nothing(self):
        row = _row(1, "preamble", unit="  ", qty_total=0.0, qty_by_area={"Phase 1": 0})
        self.assertEqual(_open(review_flags.row_flags(row, DONE)), (False, False, []))

    def test_an_item_with_a_unit_and_quantity_opens_nothing(self):
        row = _row(1, "line_item", unit="Nos", qty_total=5.0)
        self.assertEqual(_open(review_flags.row_flags(row, DONE)), (False, False, []))

    def test_both_type_reasons_are_reported_together(self):
        row = _row(1, "preamble", unit="Nos", **_answer("note", "Low"))
        self.assertEqual(review_flags.row_flags(row, DONE)["reasons"], ["type_doubt", "unit_qty_not_item"])

    # -- Check parent -------------------------------------------------------

    def test_claude_naming_another_parent_opens_check_parent(self):
        row = _row(5, "line_item", parent=2, **_answer(parent=3))
        self.assertEqual(_open(review_flags.row_flags(row, DONE)), (False, True, ["parent_doubt"]))

    def test_claude_naming_the_same_parent_opens_nothing(self):
        row = _row(5, "line_item", parent=2, **_answer(parent=2))
        self.assertEqual(_open(review_flags.row_flags(row, DONE)), (False, False, []))

    def test_claude_saying_top_level(self):
        under = _row(5, "line_item", parent=2, **_answer(root=1))
        self.assertEqual(_open(review_flags.row_flags(under, DONE)), (False, True, ["parent_doubt"]))
        already_top = _row(5, "line_item", parent=-1, **_answer(root=1))
        self.assertEqual(_open(review_flags.row_flags(already_top, DONE)), (False, False, []))

    def test_a_row_claude_never_answered_is_not_read_as_parent_zero(self):
        # ai_suggested_parent is 0 by column default on such a row; row 0 is a real row.
        row = _row(5, "line_item", parent=2)
        self.assertEqual(row["ai_suggested_parent"], 0)
        self.assertEqual(_open(review_flags.row_flags(row, DONE)), (False, False, []))

    def test_check_parent_still_shows_on_a_row_claude_surely_re_typed(self):
        row = _row(5, "line_item", parent=2, parser_classification="preamble",
                   **_answer("line_item", "High", parent=0))
        self.assertEqual(_open(review_flags.row_flags(row, DONE)), (False, True, ["parent_doubt"]))

    def test_type_and_parent_can_both_be_open(self):
        row = _row(5, "preamble", parent=2, **_answer("note", "Medium", parent=0))
        self.assertEqual(_open(review_flags.row_flags(row, DONE)),
                         (True, True, ["type_doubt", "parent_doubt"]))

    # -- who is never flagged ----------------------------------------------

    def test_a_row_copied_unchanged_into_a_revision_is_never_flagged(self):
        row = _row(5, "preamble", parent=2, unit="Nos", revision_carry_status="Copied",
                   **_answer("note", "High", parent=0))
        self.assertEqual(_open(review_flags.row_flags(row, DONE)), (False, False, []))
        needs_review = dict(row, revision_carry_status="Needs Review")
        self.assertTrue(review_flags.row_flags(needs_review, DONE)["check_type"])

    def test_a_de_selected_row_is_never_flagged(self):
        row = _row(5, "preamble", unit="Nos", is_excluded=1)
        self.assertEqual(_open(review_flags.row_flags(row, DONE)), (False, False, []))

    def test_a_gemini_answer_is_never_read(self):
        row = _row(5, "preamble", parent=2)
        row.update({"gemini_suggestion_status": "Pending", "gemini_suggested_classification": "note",
                    "gemini_suggested_parent": 0})
        self.assertEqual(_open(review_flags.row_flags(row, DONE)), (False, False, []))
        self.assertNotIn("gemini", " ".join(review_flags.FLAG_FIELDS))

    # -- clearing -----------------------------------------------------------

    def test_changing_the_type_clears_check_type_whatever_type_is_chosen(self):
        base = _row(1, "preamble", unit="Nos", **_answer("line_item", "Medium"))
        for chosen in ("line_item", "note", "spacer"):      # "note" is not what Claude had in mind
            flags = review_flags.row_flags(dict(base, human_classification=chosen), DONE)
            self.assertFalse(flags["check_type"], chosen)
            self.assertTrue(flags["checked"], chosen)

    def test_a_human_type_equal_to_the_parsed_type_is_not_a_type_change(self):
        # "Change parent" stores the row's own type as a human type.
        row = _row(1, "preamble", **_answer("note", "High"))
        row["human_classification"] = "preamble"
        self.assertTrue(review_flags.row_flags(row, DONE)["check_type"])

    def test_the_users_own_parent_change_clears_check_parent_only(self):
        row = _row(5, "preamble", parent=2, human_parent=4, **_answer("note", "High", parent=0))
        row["edit_log"] = [_entry("human_parent", "row moved: row 5 reclassified to preamble", frm=2, to=4)]
        self.assertEqual(_open(review_flags.row_flags(row, DONE)), (True, False, ["type_doubt"]))

    def test_a_child_moved_by_the_re_mapping_keeps_its_check_parent(self):
        row = _row(5, "line_item", parent=2, human_parent=4, **_answer(parent=0))
        row["edit_log"] = [_entry("human_parent", "parent moved: row 2 reclassified to note", frm=2, to=4)]
        self.assertEqual(_open(review_flags.row_flags(row, DONE)), (False, True, ["parent_doubt"]))
        # ... until the user moves that child himself.
        row["edit_log"].append(
            _entry("human_parent", "row moved: row 5 reclassified to line_item", frm=4, to=6))
        row["human_parent"] = 6
        self.assertEqual(_open(review_flags.row_flags(row, DONE)), (False, False, []))

    def test_a_child_the_re_mapping_puts_on_claudes_parent_is_no_longer_open(self):
        row = _row(5, "line_item", parent=2, human_parent=0, **_answer(parent=0))
        row["edit_log"] = [_entry("human_parent", "parent moved: row 2 reclassified to note", frm=2, to=0)]
        flags = review_flags.row_flags(row, DONE)
        self.assertEqual(_open(flags), (False, False, []))
        # ... but it still counts as a flagged row: the sheet's percentage does not fall
        self.assertEqual((flags["doubts"], flags["checked"]), (["parent_doubt"], True))

    def test_a_row_moved_to_top_level_as_claude_said_is_no_longer_open(self):
        row = _row(5, "line_item", parent=2, human_is_root=1, **_answer(root=1))
        row["edit_log"] = [_entry("human_parent", "parent moved: row 2 reclassified to note", frm=2, to=None)]
        flags = review_flags.row_flags(row, DONE)
        self.assertEqual((_open(flags), flags["doubts"]), ((False, False, []), ["parent_doubt"]))

    def test_the_parent_doubt_is_measured_against_the_parsed_parent(self):
        # Claude named the parsed parent (no doubt); a later re-mapping moved the row elsewhere.
        row = _row(5, "line_item", parent=2, human_parent=4, **_answer(parent=2))
        row["edit_log"] = [_entry("human_parent", "parent moved: row 2 reclassified to note", frm=2, to=4)]
        self.assertEqual(review_flags.row_flags(row, DONE)["doubts"], [])

    def test_looks_ok_closes_every_open_flag_of_the_row(self):
        row = _row(5, "preamble", parent=2, unit="Nos", **_answer("note", "High", parent=0))
        row.update({"ai_flags_ok": 1, "ai_flags_ok_at": "2026-02-03 11:00:00"})
        flags = review_flags.row_flags(row, DONE)
        self.assertEqual(_open(flags), (False, False, []))
        self.assertTrue(flags["looks_ok"] and flags["checked"])
        self.assertEqual(flags["doubts"], ["type_doubt", "unit_qty_not_item", "parent_doubt"])

    def test_a_revert_after_looks_ok_brings_the_flags_back(self):
        row = _row(5, "preamble", parent=2, **_answer("note", "High", parent=0))
        row.update({"ai_flags_ok": 1, "ai_flags_ok_at": "2026-02-03 11:00:00"})
        row["edit_log"] = [_entry("human_classification", "reverted to parser", at="2026-02-03 12:00:00")]
        self.assertEqual(_open(review_flags.row_flags(row, DONE)),
                         (True, True, ["type_doubt", "parent_doubt"]))

    def test_a_revert_before_looks_ok_does_not_undo_it(self):
        row = _row(5, "preamble", parent=2, **_answer("note", "High", parent=0))
        row.update({"ai_flags_ok": 1, "ai_flags_ok_at": "2026-02-03 11:00:00"})
        row["edit_log"] = [_entry("human_classification", "reverted to parser", at="2026-02-03 10:00:00")]
        self.assertEqual(_open(review_flags.row_flags(row, DONE)), (False, False, []))

    def test_an_ordinary_later_edit_does_not_undo_looks_ok(self):
        row = _row(5, "preamble", parent=2, human_parent=4, **_answer("note", "High", parent=0))
        row.update({"ai_flags_ok": 1, "ai_flags_ok_at": "2026-02-03 11:00:00"})
        row["edit_log"] = [_entry("human_parent", "row moved: row 5 reclassified to preamble",
                                  at="2026-02-03 12:00:00", frm=2, to=4)]
        self.assertEqual(_open(review_flags.row_flags(row, DONE)), (False, False, []))


# ===========================================================================
# The edit-history readers
# ===========================================================================

class TestHistoryReaders(unittest.TestCase):

    def _child(self, index, entries, human_parent=4, parent=2):
        return _row(index, "line_item", parent=parent, human_parent=human_parent, name=f"R{index}",
                    edit_log=entries)

    def test_a_plain_revert_wipes_the_standing_moves(self):
        log = [_entry("human_parent", "row moved: row 5 reclassified to note", frm=2, to=4),
               _entry("human_parent", "reverted to parser", frm=4, to=None)]
        self.assertEqual(review_flags.standing_parent_moves(log), [])

    def test_a_cascade_revert_removes_only_the_moves_that_row_caused(self):
        log = [_entry("human_parent", "row moved: row 5 reclassified to note", frm=2, to=7),
               _entry("human_parent", "parent moved: row 7 reclassified to note", frm=7, to=3),
               _entry("human_parent", review_flags.cascade_revert_reason(7), frm=3, to=7)]
        self.assertEqual(review_flags.standing_parent_moves(log), [{"moved_by": None, "from": 2}])

    def test_other_fields_and_a_json_string_log_are_handled(self):
        import json
        log = json.dumps([_entry("human_classification", None),
                          _entry("human_parent", "parent moved: row 2 reclassified to note", frm=2, to=4)])
        self.assertEqual(review_flags.standing_parent_moves(log), [{"moved_by": 2, "from": 2}])
        self.assertEqual(review_flags.standing_parent_moves("not json"), [])
        self.assertEqual(review_flags.standing_parent_moves(None), [])

    def test_a_child_the_row_moved_returns_to_where_it_was(self):
        rows = [self._child(5, [_entry("human_parent", "parent moved: row 2 reclassified to note", frm=2, to=4)])]
        self.assertEqual(review_flags.plan_child_reverts(rows, 2),
                         [{"row_index": 5, "name": "R5", "target": 2}])

    def test_a_child_the_user_moved_again_is_left_alone(self):
        rows = [self._child(5, [
            _entry("human_parent", "parent moved: row 2 reclassified to note", frm=2, to=4),
            _entry("human_parent", "row moved: row 5 reclassified to line_item", frm=4, to=6),
        ], human_parent=6)]
        self.assertEqual(review_flags.plan_child_reverts(rows, 2), [])

    def test_a_child_another_row_moved_is_left_alone(self):
        rows = [self._child(5, [_entry("human_parent", "parent moved: row 9 reclassified to note", frm=9, to=4)])]
        self.assertEqual(review_flags.plan_child_reverts(rows, 2), [])

    def test_several_moves_by_the_same_row_are_undone_back_to_the_first(self):
        rows = [self._child(5, [
            _entry("human_parent", "parent moved: row 2 reclassified to note", frm=2, to=4),
            _entry("human_parent", "parent moved: row 2 reclassified to spacer", frm=4, to=8),
        ], human_parent=8)]
        self.assertEqual(review_flags.plan_child_reverts(rows, 2)[0]["target"], 2)

    def test_only_the_moves_after_the_users_own_are_undone(self):
        # row 2 moved it, the user moved it under row 2's sibling 6, then row 6 moved it on.
        rows = [self._child(5, [
            _entry("human_parent", "parent moved: row 2 reclassified to note", frm=2, to=4),
            _entry("human_parent", "row moved: row 5 reclassified to line_item", frm=4, to=6),
            _entry("human_parent", "parent moved: row 6 reclassified to note", frm=6, to=8),
        ], human_parent=8)]
        self.assertEqual(review_flags.plan_child_reverts(rows, 6)[0]["target"], 6)
        self.assertEqual(review_flags.plan_child_reverts(rows, 2), [])

    def test_a_child_already_returned_is_not_returned_twice(self):
        rows = [self._child(5, [
            _entry("human_parent", "parent moved: row 2 reclassified to note", frm=2, to=4),
            _entry("human_parent", review_flags.cascade_revert_reason(2), frm=4, to=None),
        ], human_parent=-1)]
        self.assertEqual(review_flags.plan_child_reverts(rows, 2), [])

    def test_the_reverted_row_itself_is_never_in_its_own_plan(self):
        rows = [self._child(2, [_entry("human_parent", "parent moved: row 2 reclassified to note", frm=1, to=4)])]
        self.assertEqual(review_flags.plan_child_reverts(rows, 2), [])


# ===========================================================================
# The refusal sentence and the counts
# ===========================================================================

class TestRefusalAndSummary(unittest.TestCase):

    def test_the_approved_refusal_sentence(self):
        self.assertEqual(review_flags.finalize_refusal([22, 26]),
                         "Check the 2 flagged rows before finalizing: rows 22, 26.")

    def test_one_row_reads_in_the_singular(self):
        self.assertEqual(review_flags.finalize_refusal([22]),
                         "Check the 1 flagged row before finalizing: row 22.")

    def test_at_most_twenty_rows_are_named_then_and_n_more(self):
        text = review_flags.finalize_refusal(list(range(101, 126)))
        self.assertTrue(text.startswith("Check the 25 flagged rows before finalizing: rows 101, 102,"))
        self.assertTrue(text.endswith("119, 120 and 5 more."))
        self.assertNotIn("121", text)
        self.assertNotIn("more", review_flags.finalize_refusal(list(range(1, 21))))

    def test_the_check_running_message_is_the_approved_one(self):
        self.assertEqual(
            review_flags.CHECK_RUNNING_MESSAGE,
            "The automatic check is still running on this sheet. Try again when it finishes.",
        )

    def _summary(self, rows, status=DONE):
        return review_flags.summarize(rows, review_flags.flags_for_rows(rows, status), status)

    def test_counts_by_kind_checked_and_rows_to_check(self):
        rows = [
            _row(0, "preamble"),
            _row(1, "preamble", unit="Nos"),                                  # type
            _row(2, "line_item", parent=0, **_answer(parent=1)),              # parent
            _row(3, "preamble", parent=0, **_answer("note", "Low", parent=1)),  # both
            _row(4, "note", unit="Kg", human_classification="line_item"),     # checked
            _row(5, "spacer"),
        ]
        summary = self._summary(rows)
        self.assertEqual(summary["by_kind"], {"type": 1, "parent": 1, "both": 1})
        self.assertEqual((summary["to_check"], summary["checked"], summary["flagged"]), (3, 1, 4))
        self.assertEqual(summary["open_rows"], [11, 12, 13])       # Excel row numbers, in row order
        self.assertEqual(summary["non_blank_rows"], 5)
        self.assertEqual(summary["flagged_pct"], 80.0)
        self.assertTrue(summary["heavy"])
        self.assertEqual(summary["check_status"], "done")

    def test_blank_rows_are_left_out_of_the_percentage(self):
        rows = [_row(0, "preamble", unit="Nos"), _row(1, "line_item")] + [_row(i, "spacer") for i in range(2, 10)]
        summary = self._summary(rows)
        self.assertEqual((summary["non_blank_rows"], summary["flagged_pct"]), (2, 50.0))

    def test_the_percentage_does_not_fall_as_rows_are_checked(self):
        rows = [_row(0, "preamble", unit="Nos", human_classification="line_item"), _row(1, "line_item")]
        summary = self._summary(rows)
        self.assertEqual((summary["to_check"], summary["checked"], summary["flagged_pct"]), (0, 1, 50.0))

    def test_heavy_means_more_than_forty_percent(self):
        def sheet(flagged, total):
            return ([_row(i, "preamble", unit="Nos") for i in range(flagged)]
                    + [_row(i, "line_item") for i in range(flagged, total)])
        self.assertFalse(self._summary(sheet(2, 5))["heavy"])       # exactly 40%
        self.assertTrue(self._summary(sheet(41, 100))["heavy"])
        self.assertFalse(self._summary([])["heavy"])
        self.assertEqual(self._summary([])["flagged_pct"], 0.0)

    def test_a_sheet_with_no_record_reports_not_run_and_nothing_to_check(self):
        summary = self._summary([_row(0, "preamble", unit="Nos")], NOT_RUN)
        self.assertEqual((summary["check_status"], summary["to_check"], summary["flagged"]), ("not_run", 0, 0))


# ===========================================================================
# Database-backed cases
# ===========================================================================

def _make_project():
    proj = frappe.new_doc("Projects")
    proj.project_name = f"TEST_S3FLAGS_{frappe.generate_hash(length=6)}"
    proj.project_start_date = frappe.utils.now()[:19]
    proj.project_end_date = frappe.utils.add_to_date(frappe.utils.now()[:19], years=1)[:19]
    proj.project_scopes = {"scopes": []}
    proj.insert(ignore_permissions=True)
    frappe.db.commit()
    return proj


class _FlagCase(FrappeTestCase):
    """One BoQ, one "Parsed" sheet. Fresh rows and run records per test."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.test_project = _make_project()
        boq = frappe.new_doc("BOQs")
        boq.project = cls.test_project.name
        boq.boq_name = "S3 Review Flags Test BoQ"
        boq.tax_treatment = "Pre-tax"
        boq.append("sheet_drafts", {"sheet_name": _SHEET, "sheet_order": 1, "wizard_status": "Parsed"})
        boq.insert(ignore_permissions=True)
        frappe.db.commit()
        cls.boq_name = boq.name

    @classmethod
    def tearDownClass(cls):
        frappe.db.rollback()
        for b in frappe.get_all("BOQs", filters={"project": cls.test_project.name}, pluck="name"):
            frappe.db.delete(_RUN_LOG, {"boq": b})
            frappe.db.delete(_ROW, {"boq": b})
            frappe.delete_doc("BOQs", b, force=True, ignore_permissions=True)
        frappe.delete_doc("Projects", cls.test_project.name, force=True, ignore_permissions=True)
        frappe.db.commit()
        super().tearDownClass()

    def setUp(self):
        frappe.db.rollback()
        frappe.db.delete(_RUN_LOG, {"boq": self.boq_name})
        frappe.db.delete(_ROW, {"boq": self.boq_name})
        self._set_draft({"wizard_status": "Parsed", "last_parsed_at": _PARSED_AT,
                         "parse_in_progress": 0, "ai_in_progress": 0})
        frappe.db.set_value("BOQs", self.boq_name, "origin", "upload")
        frappe.cache().delete_value(ai_assist._ai_cache_key(self.boq_name, _SHEET, _PARSED_AT))
        frappe.db.commit()

    # -- helpers ------------------------------------------------------------

    def _set_draft(self, values):
        name = frappe.db.get_value(
            "BoQ Sheet Draft", {"parent": self.boq_name, "parenttype": "BOQs", "sheet_name": _SHEET}, "name")
        frappe.db.set_value("BoQ Sheet Draft", name, values)

    def _status(self):
        frappe.db.rollback()
        return frappe.db.get_value(
            "BoQ Sheet Draft", {"parent": self.boq_name, "parenttype": "BOQs", "sheet_name": _SHEET},
            "wizard_status")

    def _seed(self, rows, run="Done"):
        """Insert rows (dicts from _row) and, unless run is None, a run record for this parse."""
        for spec in rows:
            doc = dict(spec)
            doc.pop("qty_by_area", None)
            doc.pop("edit_log", None)
            frappe.get_doc({"doctype": _ROW, "boq": self.boq_name, "sheet_name": _SHEET,
                            "ai_suggested_level": -1, **doc}).insert(ignore_permissions=True)
        if run:
            self._run(run)
        frappe.db.commit()

    def _run(self, status, parsed_at=_PARSED_AT):
        name = ai_run_log.create_run(
            self.boq_name, _SHEET, ai_run_log.TRIGGER_AUTO, status=status,
            job_id="job-" + frappe.generate_hash(length=8), last_parsed_at=parsed_at,
        )
        frappe.db.commit()
        return name

    def _field(self, index, field):
        frappe.db.rollback()
        return frappe.db.get_value(
            _ROW, {"boq": self.boq_name, "sheet_name": _SHEET, "row_index": index}, field)

    def _flags(self, index):
        frappe.db.rollback()
        return review_flags.sheet_flag_state(self.boq_name, _SHEET)["flags"][index]

    def _summary(self):
        frappe.db.rollback()
        return review_flags.sheet_flag_state(self.boq_name, _SHEET)["summary"]

    def _restructure(self, index, new_type, child_moves=None, row_new_parent=None):
        return review_screen.save_review_restructure(
            boq_name=self.boq_name, sheet_name=_SHEET, row_index=index, new_classification=new_type,
            child_moves=child_moves or {}, row_new_parent=row_new_parent,
        )

    def _revert(self, index):
        return review_screen.revert_to_parser(boq_name=self.boq_name, sheet_name=_SHEET, row_index=index)

    def _looks_ok(self, index):
        return review_flags.mark_row_looks_ok(boq_name=self.boq_name, sheet_name=_SHEET, row_index=index)

    def _finalize(self):
        return review_screen.mark_sheet_parsed_check_done(boq_name=self.boq_name, sheet_name=_SHEET)


# ---------------------------------------------------------------------------

class TestSureChanges(_FlagCase):

    def _apply(self):
        changed = review_flags.apply_sure_changes(self.boq_name, _SHEET)
        frappe.db.commit()
        return changed

    def test_a_sure_preamble_to_item_answer_is_written_into_the_parsed_result(self):
        self._seed([_row(0, "preamble"), _row(1, "preamble", parent=0, **_answer("line_item", "High"))])
        self.assertEqual(self._apply(), 1)
        self.assertEqual(self._field(1, "classification"), "line_item")
        self.assertEqual(self._field(1, "parser_classification"), "preamble")
        # the parsed result, not a human edit and not an accepted suggestion
        self.assertIsNone(self._field(1, "human_classification"))
        self.assertIsNone(self._field(1, "edited_at"))
        self.assertEqual(self._field(1, "ai_suggestion_status"), "Pending")
        self.assertEqual(self._field(0, "classification"), "preamble")
        self.assertFalse(self._field(0, "parser_classification"))

    def test_only_high_confidence_is_applied(self):
        self._seed([_row(0, "preamble", **_answer("line_item", "Medium")),
                    _row(1, "preamble", **_answer("line_item", "Low")),
                    _row(2, "preamble", **_answer("line_item", None))])
        self.assertEqual(self._apply(), 0)
        self.assertEqual([self._field(i, "classification") for i in range(3)], ["preamble"] * 3)

    def test_no_other_type_change_is_applied_even_at_high_confidence(self):
        self._seed([_row(0, "preamble", **_answer("note", "High")),
                    _row(1, "subtotal_marker", **_answer("line_item", "High")),
                    _row(2, "note", **_answer("line_item", "High")),
                    _row(3, "line_item", **_answer("preamble", "High"))])
        self.assertEqual(self._apply(), 0)
        self.assertEqual([self._field(i, "classification") for i in range(4)],
                         ["preamble", "subtotal_marker", "note", "line_item"])

    def test_claudes_parent_is_never_applied(self):
        self._seed([_row(0, "preamble"), _row(1, "preamble"),
                    _row(2, "preamble", parent=0, **_answer("line_item", "High", parent=1))])
        self.assertEqual(self._apply(), 1)
        self.assertEqual(self._field(2, "parent_index"), 0)
        self.assertEqual(self._field(2, "human_parent"), -1)

    def test_a_row_with_a_preamble_child_is_flagged_instead(self):
        self._seed([_row(0, "preamble", **_answer("line_item", "High")),
                    _row(1, "preamble", parent=0),
                    _row(2, "preamble", **_answer("line_item", "High")),
                    _row(3, "line_item", parent=2)])
        self.assertEqual(self._apply(), 1)
        self.assertEqual(self._field(0, "classification"), "preamble")
        self.assertEqual(self._flags(0)["reasons"], ["type_doubt"])
        self.assertEqual(self._field(2, "classification"), "line_item", "an item child is no obstacle")

    def test_a_row_the_user_already_changed_is_left_alone(self):
        self._seed([_row(0, "preamble", human_classification="note", **_answer("line_item", "High"))])
        self.assertEqual(self._apply(), 0)
        self.assertEqual(self._field(0, "classification"), "preamble")

    def test_nothing_is_applied_to_a_finalized_sheet(self):
        self._seed([_row(0, "preamble", **_answer("line_item", "High"))])
        self._set_draft({"wizard_status": "Finalized"})
        frappe.db.commit()
        self.assertEqual(self._apply(), 0)
        self.assertEqual(self._field(0, "classification"), "preamble")

    def test_applying_twice_keeps_the_parsers_own_type(self):
        self._seed([_row(0, "preamble", **_answer("line_item", "High"))])
        self.assertEqual(self._apply(), 1)
        self.assertEqual(self._apply(), 0)
        self.assertEqual(self._field(0, "parser_classification"), "preamble")


# ---------------------------------------------------------------------------

_SUGGESTION = {
    "row_index": 1, "ai_suggested_classification": "line_item", "ai_classification_confidence": "High",
    "ai_suggested_parent": None, "ai_suggested_is_root": False, "ai_parent_confidence": None,
    "ai_explanation": "has a unit and a quantity",
}


def _settings():
    return {"enabled": True, "provider": "Anthropic", "model": "claude-test",
            "max_tokens": 8000, "request_timeout_seconds": 120}


class TestWorkerAndCachePath(_FlagCase):

    def _rows(self):
        self._seed([_row(0, "preamble"), _row(1, "preamble", parent=0, unit="Nos", qty_total=2.0)], run=None)

    def _work(self, run_name, service):
        with patch(_SETTINGS, return_value=_settings()), patch(_API_KEY, return_value="k"), \
             patch(_GUIDANCE, return_value={}), patch(_SERVICE, side_effect=service), \
             patch("frappe.publish_realtime"):
            ai_assist._run_ai_pass_worker(self.boq_name, _SHEET, user=None, run_name=run_name)

    def test_the_worker_applies_the_sure_change_and_the_row_is_not_flagged(self):
        self._rows()
        run = self._run("Queued")
        self._work(run, lambda *a, **k: [dict(_SUGGESTION)])
        self.assertEqual(self._field(1, "classification"), "line_item")
        self.assertEqual(self._field(1, "parser_classification"), "preamble")
        self.assertEqual(frappe.db.get_value(_RUN_LOG, run, "status"), "Done")
        self.assertEqual(self._flags(1)["doubts"], [])
        self.assertEqual(self._summary()["to_check"], 0)

    def test_a_superseded_run_re_types_nothing(self):
        self._rows()
        run = self._run("Queued")

        def service(*args, **kwargs):
            # the sheet is re-parsed while Claude is answering
            self._set_draft({"last_parsed_at": datetime.datetime(2026, 2, 4, 9, 0, 0)})
            frappe.db.commit()
            return [dict(_SUGGESTION)]

        self._work(run, service)
        self.assertEqual(frappe.db.get_value(_RUN_LOG, run, "status"), "Superseded")
        self.assertEqual(self._field(1, "classification"), "preamble")
        self.assertFalse(self._field(1, "parser_classification"))

    def test_the_cached_result_path_applies_the_sure_change_too(self):
        self._rows()
        frappe.cache().set_value(
            ai_assist._ai_cache_key(self.boq_name, _SHEET, _PARSED_AT), [dict(_SUGGESTION)],
            expires_in_sec=60,
        )
        with patch(_SETTINGS, return_value=_settings()), patch(_API_KEY, return_value="k"), \
             patch("frappe.enqueue") as enqueue:
            result = ai_assist.run_ai_pass(boq_name=self.boq_name, sheet_name=_SHEET)
        enqueue.assert_not_called()
        self.assertEqual(result, {"ok": True, "cached": True, "count": 1})
        self.assertEqual(self._field(1, "classification"), "line_item")
        self.assertEqual(self._field(1, "parser_classification"), "preamble")

    def test_both_call_sites_follow_the_write_back(self):
        # The sure changes must come AFTER _apply_ai_suggestions, whose refusal protects them.
        for function in (ai_assist._run_ai_pass_worker, ai_assist.run_ai_pass):
            source = inspect.getsource(function)
            self.assertEqual(source.count("review_flags.apply_sure_changes(boq_name, sheet_name)"), 1)
            self.assertLess(source.index("_apply_ai_suggestions("),
                            source.index("review_flags.apply_sure_changes("), function.__name__)


# ---------------------------------------------------------------------------

class TestReviewData(_FlagCase):

    def _rows(self):
        frappe.db.rollback()
        return review_screen.get_review_rows(boq_name=self.boq_name, sheet_name=_SHEET)

    def test_every_row_carries_its_flags_and_the_sheet_its_counts(self):
        self._seed([_row(0, "preamble"),
                    _row(1, "preamble", parent=0, unit="Nos"),
                    _row(2, "line_item", parent=0, **_answer(parent=1))])
        data = self._rows()
        by_index = {r["row_index"]: r["check_flags"] for r in data["rows"]}
        self.assertEqual(_open(by_index[0]), (False, False, []))
        self.assertEqual(_open(by_index[1]), (True, False, ["unit_qty_not_item"]))
        self.assertEqual(_open(by_index[2]), (False, True, ["parent_doubt"]))
        summary = data["check_summary"]
        self.assertEqual((summary["to_check"], summary["by_kind"], summary["check_status"]),
                         (2, {"type": 1, "parent": 1, "both": 0}, "done"))
        self.assertEqual(summary, self._summary(), "the screen and the finalize block read one function")

    def test_the_parsers_own_type_is_never_sent_to_the_screen(self):
        self._seed([_row(0, "preamble", **_answer("line_item", "High"))])
        review_flags.apply_sure_changes(self.boq_name, _SHEET)
        frappe.db.commit()
        row = self._rows()["rows"][0]
        self.assertNotIn("parser_classification", row)
        self.assertEqual((row["classification"], row["effective_classification"]), ("line_item", "line_item"))
        self.assertFalse(row["has_override"], "a sure change is the parsed result, not an override")

    def test_a_sheet_parsed_before_the_check_existed_reads_exactly_as_before(self):
        self._seed([_row(0, "preamble", unit="Nos", **_answer("note", "High"))], run=None)
        data = self._rows()
        self.assertEqual(_open(data["rows"][0]["check_flags"]), (False, False, []))
        self.assertEqual((data["check_summary"]["check_status"], data["check_summary"]["to_check"]),
                         ("not_run", 0))

    def test_the_counts_endpoint_gives_the_same_block_per_sheet(self):
        self._seed([_row(0, "preamble", unit="Nos"), _row(1, "line_item", parent=0)])
        frappe.db.rollback()
        sheets = review_flags.get_check_summary(boq_name=self.boq_name)["sheets"]
        self.assertEqual(list(sheets), [_SHEET])
        self.assertEqual(sheets[_SHEET], self._summary())
        with self.assertRaises(frappe.ValidationError):
            review_flags.get_check_summary(boq_name="BOQ-DOES-NOT-EXIST")


# ---------------------------------------------------------------------------

class TestClearing(_FlagCase):

    def _sheet(self):
        # 0 preamble (top) / 1 preamble under 0, wrong type and parent for Claude / 2, 3 its children
        # / 4 another preamble.
        self._seed([
            _row(0, "preamble"),
            _row(1, "preamble", parent=0, unit="Nos", **_answer("line_item", "Medium", parent=4)),
            _row(2, "line_item", parent=1, **_answer(parent=0)),
            _row(3, "line_item", parent=1),
            _row(4, "preamble"),
        ])

    def test_changing_the_type_clears_check_type_and_leaves_check_parent(self):
        self._sheet()
        self.assertEqual(_open(self._flags(1)), (True, True, ["type_doubt", "unit_qty_not_item", "parent_doubt"]))
        self._restructure(1, "line_item")
        self.assertEqual(_open(self._flags(1)), (False, True, ["parent_doubt"]))

    def test_a_type_other_than_claudes_is_accepted_and_clears_the_flag(self):
        self._sheet()
        self._restructure(1, "note", child_moves={2: 0, 3: 0})
        self.assertEqual(self._field(1, "human_classification"), "note")
        self.assertFalse(self._flags(1)["check_type"])

    def test_changing_the_parent_clears_check_parent_and_leaves_check_type(self):
        self._sheet()
        # the screen's "Change parent": the row's own type again, plus its new parent
        self._restructure(1, "preamble", row_new_parent=4)
        self.assertEqual(self._field(1, "human_classification"), "preamble")
        self.assertEqual(_open(self._flags(1)), (True, False, ["type_doubt", "unit_qty_not_item"]))

    def test_a_parent_other_than_claudes_is_accepted_and_clears_the_flag(self):
        self._sheet()
        self._restructure(2, "line_item", row_new_parent=4)      # Claude said row 0
        self.assertEqual(self._field(2, "human_parent"), 4)
        self.assertFalse(self._flags(2)["check_parent"])

    def test_a_child_the_re_mapping_moves_keeps_its_check_parent(self):
        self._sheet()
        self.assertTrue(self._flags(2)["check_parent"])
        self._restructure(1, "note", child_moves={2: 4, 3: 4})   # "move all children to one new parent"
        self.assertEqual(self._field(2, "human_parent"), 4)
        self.assertTrue(self._flags(2)["check_parent"], "the user chose for row 1, not for its child")
        self.assertEqual(self._flags(3)["doubts"], [], "a child Claude had no doubt about gets no flag")
        # the user's own move of that child clears it
        self._restructure(2, "line_item", row_new_parent=3)
        self.assertFalse(self._flags(2)["check_parent"])

    def test_revert_brings_the_rows_flags_back(self):
        self._sheet()
        self._restructure(1, "line_item", row_new_parent=4)
        self.assertEqual(_open(self._flags(1)), (False, False, []))
        self._revert(1)
        self.assertEqual(_open(self._flags(1)), (True, True, ["type_doubt", "unit_qty_not_item", "parent_doubt"]))

    def test_revert_brings_the_flags_back_also_after_looks_ok(self):
        self._sheet()
        self._restructure(1, "line_item")            # clears Check type
        self._looks_ok(1)                            # clears Check parent
        self.assertEqual(_open(self._flags(1)), (False, False, []))
        self._revert(1)
        flags = self._flags(1)
        self.assertEqual(_open(flags), (True, True, ["type_doubt", "unit_qty_not_item", "parent_doubt"]))
        self.assertFalse(flags["looks_ok"])
        self.assertEqual(self._field(1, "ai_flags_ok"), 1, "the mark is still stored; it no longer counts")

    def test_revert_of_a_sure_change_returns_to_parser_plus_claude(self):
        self._seed([_row(0, "preamble"), _row(1, "preamble", parent=0, **_answer("line_item", "High"))])
        review_flags.apply_sure_changes(self.boq_name, _SHEET)
        frappe.db.commit()
        self._restructure(1, "note")
        self.assertEqual(self._field(1, "human_classification"), "note")
        self._revert(1)
        self.assertIsNone(self._field(1, "human_classification"))
        self.assertEqual(self._field(1, "classification"), "line_item")
        self.assertEqual(self._field(1, "parser_classification"), "preamble")

    def test_a_value_edit_neither_clears_nor_reopens_a_flag(self):
        self._sheet()
        review_screen.save_review_edit(boq_name=self.boq_name, sheet_name=_SHEET, row_index=2,
                                       field="qty_total", value=9)
        self.assertTrue(self._flags(2)["check_parent"])
        self._looks_ok(2)
        review_screen.save_review_edit(boq_name=self.boq_name, sheet_name=_SHEET, row_index=2,
                                       field="qty_total", value=11)
        self.assertEqual(_open(self._flags(2)), (False, False, []))


# ---------------------------------------------------------------------------

class TestLooksOk(_FlagCase):

    def _sheet(self):
        self._seed([_row(0, "preamble", unit="Nos"), _row(1, "preamble", unit="Kg"), _row(2, "line_item", parent=0)])

    def test_it_closes_that_rows_flags_and_no_other_rows(self):
        self._sheet()
        result = self._looks_ok(0)
        self.assertEqual(result, {"ok": True, "row_index": 0, "ai_flags_ok": 1})
        self.assertEqual(_open(self._flags(0)), (False, False, []))
        self.assertTrue(self._flags(1)["check_type"], "one row per call")
        self.assertEqual(self._field(0, "ai_flags_ok_by"), frappe.session.user)
        self.assertIsNotNone(self._field(0, "ai_flags_ok_at"))

    def test_it_is_an_acknowledgement_not_an_edit(self):
        self._sheet()
        self._looks_ok(0)
        self.assertIsNone(self._field(0, "edited_at"))
        self.assertFalse(self._field(0, "edit_log"))
        self.assertIsNone(self._field(0, "human_classification"))

    def test_it_is_refused_on_a_row_with_no_open_flag(self):
        self._sheet()
        with self.assertRaises(frappe.ValidationError) as ctx:
            self._looks_ok(2)
        self.assertEqual(str(ctx.exception), "Row 12 has no open flag to confirm.")     # the Excel row
        self.assertEqual(self._field(2, "ai_flags_ok"), 0)
        # ... including a row already marked
        self._looks_ok(0)
        with self.assertRaises(frappe.ValidationError):
            self._looks_ok(0)

    def test_it_is_refused_on_a_finalized_sheet(self):
        self._sheet()
        self._set_draft({"wizard_status": "Finalized"})
        frappe.db.commit()
        with self.assertRaises(frappe.ValidationError) as ctx:
            self._looks_ok(0)
        self.assertIn("read-only", str(ctx.exception))
        self.assertEqual(self._field(0, "ai_flags_ok"), 0)

    def test_it_is_refused_while_a_parse_is_running(self):
        self._sheet()
        self._set_draft({"parse_in_progress": 1})
        frappe.db.commit()
        with self.assertRaises(frappe.ValidationError):
            self._looks_ok(0)
        self.assertEqual(self._field(0, "ai_flags_ok"), 0)

    def test_it_is_refused_for_a_row_that_does_not_exist(self):
        self._sheet()
        with self.assertRaises(frappe.ValidationError):
            self._looks_ok(99)

    def test_there_is_no_bulk_form(self):
        signature = inspect.signature(review_flags.mark_row_looks_ok)
        self.assertEqual(list(signature.parameters), ["boq_name", "sheet_name", "row_index"])
        whitelisted = [name for name, obj in vars(review_flags).items()
                       if callable(obj) and obj in frappe.whitelisted]
        self.assertEqual(sorted(whitelisted), ["get_check_summary", "mark_row_looks_ok"])


# ---------------------------------------------------------------------------

class TestFinalizeBlock(_FlagCase):

    def _refusal(self):
        with self.assertRaises(frappe.ValidationError) as ctx:
            self._finalize()
        return str(ctx.exception)

    def test_an_open_flag_refuses_finalize_and_names_the_excel_rows(self):
        self._seed([_row(0, "preamble"), _row(1, "preamble", parent=0, unit="Nos"),
                    _row(2, "line_item", parent=0, **_answer(parent=1))])
        self.assertEqual(self._refusal(), "Check the 2 flagged rows before finalizing: rows 11, 12.")
        self.assertEqual(self._status(), "Parsed")

    def test_it_finalizes_once_every_flag_is_closed(self):
        self._seed([_row(0, "preamble"), _row(1, "preamble", parent=0, unit="Nos"),
                    _row(2, "line_item", parent=0, **_answer(parent=1))])
        self._restructure(1, "line_item")
        self.assertEqual(self._refusal(), "Check the 1 flagged row before finalizing: row 12.")
        self._looks_ok(2)
        self.assertEqual(self._finalize(), {"ok": True, "status": "Finalized"})
        self.assertEqual(self._status(), "Finalized")

    def test_a_sheet_with_no_flag_finalizes_exactly_as_before(self):
        self._seed([_row(0, "preamble"), _row(1, "line_item", parent=0, unit="Nos", qty_total=1.0)])
        self.assertEqual(self._finalize(), {"ok": True, "status": "Finalized"})

    def test_a_sheet_parsed_before_the_check_existed_finalizes_with_unit_quantity_rows(self):
        self._seed([_row(0, "preamble", unit="Nos", **_answer("note", "High"))], run=None)
        self.assertEqual(self._finalize(), {"ok": True, "status": "Finalized"})

    def test_finalize_is_refused_while_the_check_is_still_running(self):
        self._seed([_row(0, "preamble"), _row(1, "line_item", parent=0)], run=None)
        for status in ("Queued", "Running"):
            frappe.db.delete(_RUN_LOG, {"boq": self.boq_name})
            run = self._run(status)
            # a healthy run: just started, heartbeat now, its job still in the queue
            frappe.db.set_value(_RUN_LOG, run, {"started_at": frappe.utils.now_datetime(),
                                               "last_heartbeat": frappe.utils.now_datetime()})
            frappe.db.commit()
            with patch.object(ai_run_log, "_job_is_live", return_value=True):
                self.assertEqual(
                    self._refusal(),
                    "The automatic check is still running on this sheet. Try again when it finishes.",
                    status)
            self.assertEqual(self._status(), "Parsed")

    def test_a_dead_run_does_not_hold_the_sheet(self):
        self._seed([_row(0, "preamble"), _row(1, "line_item", parent=0)], run=None)
        run = self._run("Running")
        long_ago = frappe.utils.add_to_date(frappe.utils.now_datetime(), hours=-1)
        frappe.db.set_value(_RUN_LOG, run, {"started_at": long_ago, "last_heartbeat": long_ago})
        frappe.db.commit()
        with patch("frappe.publish_realtime"):
            self.assertEqual(self._finalize(), {"ok": True, "status": "Finalized"})
        self.assertEqual(frappe.db.get_value(_RUN_LOG, run, "status"), "Failed")

    def test_a_failed_check_lets_the_sheet_finalize_on_the_parser_result(self):
        self._seed([_row(0, "preamble"), _row(1, "line_item", parent=0, **_answer("note", "High", parent=0))],
                   run="Failed")
        self.assertEqual(self._summary()["check_status"], "incomplete")
        self.assertEqual(self._finalize(), {"ok": True, "status": "Finalized"})

    def test_a_failed_check_still_blocks_on_unit_quantity_rows(self):
        self._seed([_row(0, "preamble", unit="Nos")], run="Failed")
        self.assertEqual(self._refusal(), "Check the 1 flagged row before finalizing: row 10.")

    def test_must_fix_comes_before_the_flags(self):
        # row 1 is an item under a NOTE (must-fix #8) and row 2 carries an open flag
        self._seed([_row(0, "note"), _row(1, "line_item", parent=0), _row(2, "preamble", unit="Nos")])
        result = self._finalize()
        self.assertFalse(result["ok"])
        self.assertTrue(result["breaks"], "the must-fix answer, returned as before -- not the flag refusal")

    def test_revision_rows_come_before_the_flags(self):
        self._seed([_row(0, "preamble", unit="Nos", revision_carry_status="Needs Review")])
        result = self._finalize()
        self.assertEqual((result["ok"], result["unaffirmed_count"]), (False, 1))

    def test_the_flag_gate_is_the_last_check_before_the_write(self):
        source = inspect.getsource(review_screen.mark_sheet_parsed_check_done)
        order = [source.index(marker) for marker in (
            "structural_errors_for_sheet(boq_name, sheet_name)",
            "unaffirmed_needs_review(boq_name, sheet_name)",
            "_template_line_item_qty_gap(r)",
            "review_flags.guard_finalize(boq_name, sheet_name)",
            '"wizard_status", _SHEET_FINALIZED)',
        )]
        self.assertEqual(order, sorted(order))

    def test_un_mark_is_untouched_by_open_flags(self):
        self._seed([_row(0, "preamble"), _row(1, "line_item", parent=0)])
        self._finalize()
        result = review_screen.unmark_sheet_parsed_check_done(boq_name=self.boq_name, sheet_name=_SHEET)
        self.assertEqual(result, {"ok": True, "status": "Parsed"})


# ---------------------------------------------------------------------------

class TestHistoryWordingPins(_FlagCase):
    """review_flags READS two wordings that other code writes. These tests make the real endpoints
    write them: if either wording is ever changed, this class fails -- instead of "Check parent"
    quietly clearing on re-mapped children, or "Looks OK" quietly surviving a revert."""

    def _log(self, index):
        frappe.db.rollback()
        return review_flags._log_entries(self._field(index, "edit_log"))

    def _sheet(self):
        self._seed([_row(0, "preamble"), _row(1, "preamble", parent=0), _row(2, "line_item", parent=1),
                    _row(3, "preamble")])

    def test_a_re_mapped_child_is_stamped_parent_moved_with_the_rows_index(self):
        self._sheet()
        self._restructure(1, "note", child_moves={2: 0})
        reason = self._log(2)[-1]["reason"]
        self.assertTrue(reason.startswith(review_flags.CHILD_MOVE_REASON_PREFIX), reason)
        self.assertEqual(review_flags.CHILD_MOVE_REASON_PREFIX, "parent moved:")
        self.assertEqual(reason, "parent moved: row 1 reclassified to note")
        self.assertEqual(review_flags.standing_parent_moves(self._log(2)), [{"moved_by": 1, "from": 1}])

    def test_the_users_own_move_is_not_stamped_parent_moved(self):
        self._sheet()
        self._restructure(2, "line_item", row_new_parent=3)
        reason = self._log(2)[-1]["reason"]
        self.assertEqual(reason, "row moved: row 2 reclassified to line_item")
        self.assertFalse(reason.startswith(review_flags.CHILD_MOVE_REASON_PREFIX))

    def test_a_revert_stamps_a_reverted_entry(self):
        self._sheet()
        self._restructure(2, "note", row_new_parent=3)
        self._revert(2)
        reasons = [e["reason"] for e in self._log(2)[-2:]]
        self.assertEqual(reasons, ["reverted to parser", "reverted to parser"])
        self.assertEqual(review_flags.REVERT_REASON_WORD, "reverted")
        self.assertTrue(all(review_flags.REVERT_REASON_WORD in r for r in reasons))

    def test_a_returning_child_is_stamped_reverted_and_names_the_row(self):
        self._sheet()
        self._restructure(1, "note", child_moves={2: 0})
        self._revert(1)
        reason = self._log(2)[-1]["reason"]
        self.assertEqual(reason, "reverted with row 1 (parent restore)")
        self.assertIn(review_flags.REVERT_REASON_WORD, reason)
        self.assertEqual(review_flags.standing_parent_moves(self._log(2)), [])


# ---------------------------------------------------------------------------

class TestFlagsOnReturningChildren(_FlagCase):
    """R20 + the flags: a child that returns with its row is flagged by the ordinary rules."""

    def _sheet(self):
        # 0 preamble / 1 preamble under 0 / 2 its child, Claude wants it under 4 / 3 its child / 4 preamble
        self._seed([
            _row(0, "preamble"),
            _row(1, "preamble", parent=0),
            _row(2, "line_item", parent=1, **_answer(parent=4)),
            _row(3, "line_item", parent=1),
            _row(4, "preamble"),
        ])

    def test_a_returning_childs_check_parent_follows_the_rules(self):
        self._sheet()
        self._restructure(1, "note", child_moves={2: 4, 3: 4})
        self.assertFalse(self._flags(2)["check_parent"], "moved onto the parent Claude named")
        self.assertEqual(self._summary()["flagged"], 1, "it is still a flagged row, now checked")
        self.assertEqual(self._revert(1)["reverted_children"], [2, 3])
        self.assertEqual(_open(self._flags(2)), (False, True, ["parent_doubt"]),
                         "back under row 1, where Claude doubts it")
        self.assertEqual(self._flags(3)["doubts"], [])

    def test_looks_ok_on_a_returning_child_ends_like_on_a_reverted_row(self):
        self._sheet()
        self._restructure(1, "note", child_moves={2: 0, 3: 0})
        self.assertTrue(self._flags(2)["check_parent"], "the re-mapped child keeps its flag (R18)")
        self._looks_ok(2)
        self.assertEqual(_open(self._flags(2)), (False, False, []))
        self._revert(1)
        flags = self._flags(2)
        self.assertEqual(_open(flags), (False, True, ["parent_doubt"]))
        self.assertFalse(flags["looks_ok"])

    def test_a_child_the_user_moved_himself_keeps_its_cleared_flag_after_the_revert(self):
        self._sheet()
        self._restructure(1, "note", child_moves={2: 0, 3: 0})
        self._restructure(2, "line_item", row_new_parent=3)
        self.assertFalse(self._flags(2)["check_parent"])
        self.assertEqual(self._revert(1)["reverted_children"], [3])
        self.assertFalse(self._flags(2)["check_parent"])
        self.assertEqual(self._field(2, "human_parent"), 3)
