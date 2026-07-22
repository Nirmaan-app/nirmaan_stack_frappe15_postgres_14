"""S3 -- the revision needs-review affirmation and the finalize gate.

The gate holds the WHOLE downstream for a sheet: no finalize means no commit, no pricing, no
tendering. So most of what is pinned here is not "does it catch things" but "can it deadlock":

  G1  every row the gate blocks on is a row the affirm endpoint accepts -- proved by walking the
      ENTIRE reason vocabulary through both, and end to end by clearing a blocked sheet;
  G3  inert off a revision (an upload sheet finalizes exactly as before);
  G4  the same `is_excluded` scope the structural-break gate uses;
  G7  no retroactive lockout -- a sheet with no stamps (the pre-S2 shape) finalizes;
  G10 unmark keeps the affirmations, so re-finalize needs no rework.

The affirmation is also pinned as NOT an edit (no `edited_at` / `edit_log`) and as a SEPARATE
channel from `flags_dismissed`, and the auto-affirm is pinned to classification/parent edits ONLY
-- a quantity fix must not silently clear a row nobody classified.
"""

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.boq.wizard.review_carry import unaffirmed_needs_review
from nirmaan_stack.api.boq.wizard.review_screen import (
    affirm_revision_row,
    get_review_rows,
    mark_sheet_parsed_check_done,
    revert_to_parser,
    save_review_edit,
    unmark_sheet_parsed_check_done,
)
from nirmaan_stack.api.boq.wizard.test_revision_entry import (
    _cleanup_project,
    _make_boq,
    _make_project,
)
from nirmaan_stack.api.boq.wizard.test_revision_mapping import _make_revision
from nirmaan_stack.services.boq_revision.reasons import (
    ALL_REASONS,
    COLLATERAL_REASONS,
    DESCRIPTION_CHANGED,
    NEEDS_REVIEW,
    POSITION_SHIFTED,
    ROW_INSERTED,
)

_SHEET = "Data"


def _seed_sheet(project, rows, origin="revision", source_boq=None, sheet=_SHEET,
                wizard_status="Parsed"):
    """A BoQ with one draft + the given review rows. Returns (boq_name, {row_index: docname}).

    `rows` entries are dicts of BoQ Review Row fields; `row_index` and `description` are required.
    Rows are seeded DIRECTLY (not via a parse) so each test can pin one exact stamp shape.
    """
    if origin == "revision":
        boq = _make_revision(project, source_boq)
    else:
        boq = _make_boq(project, origin=origin, boq_name=f"S3 {origin.upper()}")
    doc = frappe.get_doc("BOQs", boq.name)
    doc.append("sheet_drafts", {
        "sheet_name": sheet,
        "sheet_order": 1,
        "wizard_status": wizard_status,
        "source_sheet_name": _SHEET if origin == "revision" else None,
    })
    doc.save(ignore_permissions=True)

    names = {}
    for spec in rows:
        rr = frappe.new_doc("BoQ Review Row")
        rr.boq = boq.name
        rr.sheet_name = sheet
        rr.classification = spec.get("classification", "line_item")
        rr.parent_index = spec.get("parent_index", -1)
        rr.human_parent = -1
        rr.source_row_number = spec.get("source_row_number", spec["row_index"] + 1)
        for k, v in spec.items():
            setattr(rr, k, v)
        rr.insert(ignore_permissions=True)
        names[spec["row_index"]] = rr.name
    frappe.db.commit()
    return boq.name, names


def _needs(row_index, reason=DESCRIPTION_CHANGED, **extra):
    """A stamped Needs Review row."""
    return {
        "row_index": row_index,
        "description": f"Row {row_index}",
        "revision_carry_status": NEEDS_REVIEW,
        "revision_review_reason": reason,
        **extra,
    }


def _copied(row_index):
    return {
        "row_index": row_index,
        "description": f"Row {row_index}",
        "revision_carry_status": "Copied",
    }


def _plain(row_index):
    """An ordinary row with no revision stamp -- an upload row, or a pre-S2 revision row."""
    return {"row_index": row_index, "description": f"Row {row_index}"}


class _Base(FrappeTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.project = _make_project()
        cls.original = _make_boq(cls.project.name, origin="upload", boq_name="S3 ORIG")

    @classmethod
    def tearDownClass(cls):
        for boq in frappe.get_all("BOQs", filters={"project": cls.project.name}, fields=["name"]):
            frappe.db.delete("BoQ Review Row", {"boq": boq.name})
        frappe.db.commit()
        _cleanup_project(cls.project.name)
        super().tearDownClass()

    def _row(self, name, *fields):
        return frappe.db.get_value("BoQ Review Row", name, list(fields), as_dict=True)


class TestAffirmRow(_Base):
    def test_affirming_stamps_who_and_when(self):
        boq, names = _seed_sheet(self.project.name, [_needs(0)], source_boq=self.original.name)
        affirm_revision_row(boq, _SHEET, 0)
        row = self._row(names[0], "revision_reviewed", "revision_reviewed_by",
                        "revision_reviewed_at")
        self.assertEqual(row.revision_reviewed, 1)
        self.assertTrue(row.revision_reviewed_by)
        self.assertIsNotNone(row.revision_reviewed_at)

    def test_affirmation_is_reversible(self):
        boq, names = _seed_sheet(self.project.name, [_needs(0)], source_boq=self.original.name)
        affirm_revision_row(boq, _SHEET, 0)
        affirm_revision_row(boq, _SHEET, 0, affirmed=False)
        row = self._row(names[0], "revision_reviewed", "revision_reviewed_by")
        self.assertEqual(row.revision_reviewed, 0)
        self.assertIsNone(row.revision_reviewed_by)

    def test_affirming_is_not_an_edit(self):
        # It must not flip the row to "Edited" -- the Status column keys off exactly these two.
        boq, names = _seed_sheet(self.project.name, [_needs(0)], source_boq=self.original.name)
        affirm_revision_row(boq, _SHEET, 0)
        row = self._row(names[0], "edited_at", "edit_log", "edited_by")
        self.assertIsNone(row.edited_at)
        self.assertIsNone(row.edited_by)
        self.assertIn(row.edit_log, (None, "", "[]"))

    def test_affirming_does_not_touch_the_flag_dismissal_channel(self):
        # Two SEPARATE acknowledgements: this one confirms the classification, `flags_dismissed`
        # acknowledges the parser's advisories. Overloading one would make each clear the other.
        boq, names = _seed_sheet(self.project.name, [_needs(0)], source_boq=self.original.name)
        affirm_revision_row(boq, _SHEET, 0)
        self.assertEqual(self._row(names[0], "flags_dismissed").flags_dismissed, 0)

    def test_a_copied_row_has_nothing_to_confirm(self):
        boq, _names = _seed_sheet(self.project.name, [_copied(0)], source_boq=self.original.name)
        with self.assertRaises(frappe.ValidationError):
            affirm_revision_row(boq, _SHEET, 0)

    def test_an_unstamped_row_has_nothing_to_confirm(self):
        boq, _names = _seed_sheet(self.project.name, [_plain(0)], source_boq=self.original.name)
        with self.assertRaises(frappe.ValidationError):
            affirm_revision_row(boq, _SHEET, 0)

    def test_a_missing_row_throws(self):
        boq, _names = _seed_sheet(self.project.name, [_needs(0)], source_boq=self.original.name)
        with self.assertRaises(frappe.ValidationError):
            affirm_revision_row(boq, _SHEET, 99)

    def test_G1_every_reason_in_the_vocabulary_is_affirmable(self):
        """⚠️ THE ANTI-DEADLOCK PROPERTY. A reason the gate can block on but the endpoint refuses
        would make its sheet permanently un-finalizable -- and therefore un-committable and
        un-priceable. Walks the WHOLE vocabulary, including the defensive codes that should never
        fire, precisely because those are the ones nobody would think to test by hand."""
        rows = [_needs(i, reason=r) for i, r in enumerate(sorted(ALL_REASONS))]
        boq, names = _seed_sheet(self.project.name, rows, source_boq=self.original.name)
        for i in range(len(rows)):
            affirm_revision_row(boq, _SHEET, i)
        for i in range(len(rows)):
            self.assertEqual(self._row(names[i], "revision_reviewed").revision_reviewed, 1,
                             f"reason {sorted(ALL_REASONS)[i]} was not affirmable")
        self.assertEqual(unaffirmed_needs_review(boq, _SHEET)["count"], 0)

    def test_a_frozen_sheet_rejects_the_affirmation(self):
        boq, _names = _seed_sheet(self.project.name, [_needs(0)], source_boq=self.original.name,
                                  wizard_status="Finalized")
        with self.assertRaises(frappe.ValidationError):
            affirm_revision_row(boq, _SHEET, 0)


class TestNoBulkAffirmExists(_Base):
    """⚠️ Owner reversal, 2026-07-22: there is NO bulk affirm, by design.

    `affirm_revision_block` cleared a whole shift block in one call. It was removed WITH its
    button, not merely unwired -- a reviewer who can clear a shift at once will not open the rows,
    which is the reading the gate exists to force, and a whitelisted endpoint that can bulk-clear
    the gate reopens that hole regardless of what the UI offers.

    If you are here because you are adding one back: it needs the owner, not a refactor.
    """

    def test_no_bulk_affirm_endpoint_is_exposed(self):
        import nirmaan_stack.api.boq.wizard.review_screen as rs
        for name in dir(rs):
            self.assertNotIn("affirm_revision_block", name)

    def test_rows_of_one_block_must_each_be_confirmed(self):
        rows = [
            _needs(0, reason=ROW_INSERTED, revision_shift_anchor=3),
            _needs(1, reason=POSITION_SHIFTED, revision_shift_anchor=3, revision_shift_delta=1),
            _needs(2, reason=POSITION_SHIFTED, revision_shift_anchor=3, revision_shift_delta=1),
        ]
        boq, names = _seed_sheet(self.project.name, rows, source_boq=self.original.name)

        affirm_revision_row(boq, _SHEET, 1)
        # Its block-mate is untouched -- confirming one moved row says nothing about the next.
        self.assertEqual(self._row(names[2], "revision_reviewed").revision_reviewed, 0)
        self.assertEqual(unaffirmed_needs_review(boq, _SHEET)["count"], 2)

    def test_the_collateral_split_survives_for_the_panels_use(self):
        # The vocabulary distinction is NOT retired with the endpoint: the review panel still
        # colours a moved row differently from an inserted one, and the diagnosis still falls back
        # to the causal label when its shift probe is ambiguous.
        self.assertEqual(COLLATERAL_REASONS, frozenset({POSITION_SHIFTED}))


class TestAutoAffirm(_Base):
    def test_a_classification_edit_affirms_the_row(self):
        boq, names = _seed_sheet(self.project.name, [_needs(0)], source_boq=self.original.name)
        save_review_edit(boq, _SHEET, 0, "human_classification", "preamble")
        self.assertEqual(self._row(names[0], "revision_reviewed").revision_reviewed, 1)

    def test_a_parent_edit_affirms_the_row(self):
        boq, names = _seed_sheet(
            self.project.name, [_needs(0), _needs(1)], source_boq=self.original.name
        )
        save_review_edit(boq, _SHEET, 1, "human_parent", 0)
        self.assertEqual(self._row(names[1], "revision_reviewed").revision_reviewed, 1)

    def test_a_value_edit_does_NOT_affirm_the_row(self):
        """⚠️ The deliberate divergence from `flags_dismissed`, which ANY data edit re-opens.

        Fixing a quantity says nothing about whether the row is classified correctly, so it must
        not clear the row out of the gate. Getting this wrong is silent: the row simply stops
        being asked about."""
        boq, names = _seed_sheet(self.project.name, [_needs(0)], source_boq=self.original.name)
        save_review_edit(boq, _SHEET, 0, "qty_total", 12.5)
        self.assertEqual(self._row(names[0], "revision_reviewed").revision_reviewed, 0)

    def test_reverting_to_parser_returns_the_row_to_blocking(self):
        # The revert routes through the same chokepoint that auto-affirms, so this also proves the
        # final normalize write wins over that in-flight affirm.
        boq, names = _seed_sheet(self.project.name, [_needs(0)], source_boq=self.original.name)
        save_review_edit(boq, _SHEET, 0, "human_classification", "preamble")
        revert_to_parser(boq, _SHEET, 0)
        self.assertEqual(self._row(names[0], "revision_reviewed").revision_reviewed, 0)
        self.assertEqual(unaffirmed_needs_review(boq, _SHEET)["count"], 1)

    def test_an_unstamped_row_is_never_given_an_affirmation(self):
        boq, names = _seed_sheet(self.project.name, [_plain(0)], source_boq=self.original.name)
        save_review_edit(boq, _SHEET, 0, "human_classification", "preamble")
        self.assertEqual(self._row(names[0], "revision_reviewed").revision_reviewed, 0)


class TestFinalizeGate(_Base):
    def test_unaffirmed_rows_block_finalize_and_are_named(self):
        boq, _names = _seed_sheet(
            self.project.name, [_needs(0), _needs(1), _copied(2)], source_boq=self.original.name
        )
        res = mark_sheet_parsed_check_done(boq, _SHEET)
        self.assertFalse(res["ok"])
        self.assertEqual(res["unaffirmed_count"], 2)
        self.assertEqual(sorted(r["row_index"] for r in res["unaffirmed"]), [0, 1])
        self.assertEqual(res["breaks"], [], "this is the revision gate, not a structural break")

    def test_G1_end_to_end_a_blocked_sheet_can_always_be_cleared(self):
        """The deadlock check as a user would hit it: block, clear every named row through the
        public endpoint, finalize."""
        rows = [_needs(i, reason=r) for i, r in enumerate(sorted(ALL_REASONS))]
        boq, _names = _seed_sheet(self.project.name, rows, source_boq=self.original.name)

        blocked = mark_sheet_parsed_check_done(boq, _SHEET)
        self.assertFalse(blocked["ok"])
        for row in blocked["unaffirmed"]:
            affirm_revision_row(boq, _SHEET, row["row_index"])

        self.assertTrue(mark_sheet_parsed_check_done(boq, _SHEET)["ok"])

    def test_finalize_passes_once_every_row_is_affirmed(self):
        boq, _names = _seed_sheet(self.project.name, [_needs(0), _copied(1)],
                                  source_boq=self.original.name)
        affirm_revision_row(boq, _SHEET, 0)
        res = mark_sheet_parsed_check_done(boq, _SHEET)
        self.assertTrue(res["ok"])
        self.assertEqual(res["status"], "Finalized")

    def test_an_auto_affirmed_row_stops_blocking(self):
        boq, _names = _seed_sheet(self.project.name, [_needs(0)], source_boq=self.original.name)
        save_review_edit(boq, _SHEET, 0, "human_classification", "preamble")
        self.assertTrue(mark_sheet_parsed_check_done(boq, _SHEET)["ok"])

    def test_G3_an_upload_sheet_is_unaffected(self):
        boq, _names = _seed_sheet(self.project.name, [_plain(0), _plain(1)], origin="upload")
        self.assertEqual(unaffirmed_needs_review(boq, _SHEET)["count"], 0)
        self.assertTrue(mark_sheet_parsed_check_done(boq, _SHEET)["ok"])

    def test_G7_a_sheet_with_no_stamps_is_not_retroactively_locked_out(self):
        # The pre-S2 shape: a revision whose non-copied rows were never stamped. `Needs Review` did
        # not exist when it parsed, so it must finalize exactly as it did before this feature.
        boq, _names = _seed_sheet(self.project.name, [_copied(0), _plain(1), _plain(2)],
                                  source_boq=self.original.name)
        self.assertTrue(mark_sheet_parsed_check_done(boq, _SHEET)["ok"])

    def test_G4_an_excluded_row_does_not_block(self):
        # Same scope as the structural-break gate: a row that will never be committed must not
        # hold the sheet.
        boq, _names = _seed_sheet(self.project.name, [_needs(0, is_excluded=1), _copied(1)],
                                  source_boq=self.original.name)
        self.assertEqual(unaffirmed_needs_review(boq, _SHEET)["count"], 0)
        self.assertTrue(mark_sheet_parsed_check_done(boq, _SHEET)["ok"])

    def test_G10_unmark_keeps_the_affirmations(self):
        boq, _names = _seed_sheet(self.project.name, [_needs(0)], source_boq=self.original.name)
        affirm_revision_row(boq, _SHEET, 0)
        self.assertTrue(mark_sheet_parsed_check_done(boq, _SHEET)["ok"])
        unmark_sheet_parsed_check_done(boq, _SHEET)
        # No rework: the affirmation survived, so re-finalizing is immediate.
        self.assertEqual(unaffirmed_needs_review(boq, _SHEET)["count"], 0)
        self.assertTrue(mark_sheet_parsed_check_done(boq, _SHEET)["ok"])

    def test_a_declared_new_sheet_has_nothing_to_affirm(self):
        # No original to carry from -> no stamps -> nothing blocks.
        boq, _names = _seed_sheet(self.project.name, [_plain(0)], source_boq=self.original.name)
        frappe.db.set_value(
            "BoQ Sheet Draft",
            {"parent": boq, "parenttype": "BOQs", "sheet_name": _SHEET},
            "source_sheet_name", None,
        )
        frappe.db.commit()
        self.assertTrue(mark_sheet_parsed_check_done(boq, _SHEET)["ok"])


class TestReviewScreenMeta(_Base):
    def test_the_meta_reports_the_blocking_count(self):
        boq, _names = _seed_sheet(self.project.name, [_needs(0), _needs(1), _copied(2)],
                                  source_boq=self.original.name)
        meta = get_review_rows(boq, _SHEET)["revision"]
        self.assertTrue(meta["is_revision"])
        self.assertEqual(meta["unaffirmed_count"], 2)

    def test_the_blocking_count_falls_as_rows_are_affirmed(self):
        # It is the SAME function the gate refuses on -- the button and the server cannot disagree.
        boq, _names = _seed_sheet(self.project.name, [_needs(0), _needs(1)],
                                  source_boq=self.original.name)
        affirm_revision_row(boq, _SHEET, 0)
        self.assertEqual(get_review_rows(boq, _SHEET)["revision"]["unaffirmed_count"], 1)

    def test_needs_review_count_does_not_move_as_rows_are_affirmed(self):
        # Deliberately different numbers: the carry count describes the PARSE, the unaffirmed count
        # describes REMAINING WORK. Collapsing them would lose one of the two.
        boq, _names = _seed_sheet(self.project.name, [_needs(0), _needs(1)],
                                  source_boq=self.original.name)
        affirm_revision_row(boq, _SHEET, 0)
        meta = get_review_rows(boq, _SHEET)["revision"]
        self.assertEqual(meta["needs_review_count"], 2)
        self.assertEqual(meta["unaffirmed_count"], 1)

    def test_the_rows_carry_their_reason_and_affirmation(self):
        boq, _names = _seed_sheet(
            self.project.name,
            [_needs(0, reason=POSITION_SHIFTED, revision_shift_delta=2, revision_shift_anchor=5)],
            source_boq=self.original.name,
        )
        row = get_review_rows(boq, _SHEET)["rows"][0]
        self.assertEqual(row["revision_review_reason"], POSITION_SHIFTED)
        self.assertEqual(row["revision_shift_delta"], 2)
        self.assertEqual(row["revision_shift_anchor"], 5)
        self.assertEqual(row["revision_reviewed"], 0)

    def test_an_upload_sheet_has_no_revision_meta(self):
        boq, _names = _seed_sheet(self.project.name, [_plain(0)], origin="upload")
        self.assertIsNone(get_review_rows(boq, _SHEET)["revision"])


if __name__ == "__main__":
    import unittest
    unittest.main()
