"""
Tests for Bug 23 (LINE_ITEM orphans after level=0) and
Bug 24 (NOTE parent_index always None) -- cycle 4 session 1.

Bug 23: After a level=0 PREAMBLE clears the stack, LINE_ITEM rows end up
with parent_index=None even though level0_ancestor holds the resolved index
of the SUB HEAD (or anchor-promoted section header). Fix: when stack is empty
and BUG_23_LINE_ITEM_LEVEL0_ANCESTOR_ENABLED, inherit level0_ancestor as parent.

Bug 24: NOTE rows never set parent_index (defaults to None on ResolvedRow).
Fix: when stack has an entry, mirror attached_to_index into parent_index;
when stack is empty and level0_ancestor is set, parent_index = level0_ancestor.

28 tests across 8 groups:
  TestBug23LineItemUnit           (5) -- LINE_ITEM parenting via level0_ancestor
  TestBug24NoteUnit               (5) -- NOTE parent_index assignment
  TestBug23Toggle                 (2) -- BUG_23_LINE_ITEM_LEVEL0_ANCESTOR_ENABLED
  TestBug24Toggle                 (2) -- BUG_24_NOTE_PARENT_INDEX_ENABLED
  TestDemotionPostPassUnaffected  (1) -- zero-children demotion unaffected by Bug 24 fix
  TestBillOfQuantitiesIntegration (2) -- BoQ ELV LINE_ITEMS + NOTEs post-fix
  TestAloricaIntegration          (1) -- alorica_1row LINE_ITEM Bug 23 candidates
  TestEA6aNoteNearestRow         (10) -- EA-6a slice 1 three-way nearest-wins note parenting

EA-6a slice 1 (2026-08-03): a NOTE now attaches to the NEAREST preamble-or-line-item above it
(NOTE_PARENT_NEAREST_ROW_ENABLED). ONE pre-existing assertion was updated by owner ruling --
test_note_after_level0_subhead_attaches_to_the_anchor (was ..._empty_stack_parents_under_anchor):
it pinned the Bug-24 pointer/text divergence, which the new rule removes. The three assertions
that protect genuine top-of-BoQ master-bucket notes are UNCHANGED and green.
"""
from __future__ import annotations

import unittest
from pathlib import Path

import nirmaan_stack.services.boq_parser.hierarchy as hierarchy_mod
from nirmaan_stack.services.boq_parser.classifier import (
    ClassifiedRow,
    RowClassification,
)
from nirmaan_stack.services.boq_parser.config import (
    ColumnRole,
    GlobalSettings,
    MappingConfig,
    MasterBoqMetadata,
    SheetConfig,
)
from nirmaan_stack.services.boq_parser.hierarchy import (
    _apply_zero_children_preamble_demotion_post_pass,
    resolve_hierarchy,
)
from nirmaan_stack.services.boq_parser.reader import RawRow

_FIXTURES = Path(__file__).parent / "tests" / "fixtures"
_BOQ_ELV_FIXTURE = _FIXTURES / "Bill of Quantities.xlsx"
_ALORICA_FIXTURE = _FIXTURES / "alorica_pri_tech_hvac.xlsx"

_GS = GlobalSettings()


# ------------------------------------------------------------------
# Synthetic ClassifiedRow helpers
# ------------------------------------------------------------------

def _make_cr(
    classification: RowClassification,
    row_num: int,
    sl_no: str | None = None,
    description: str | None = None,
    unit: str | None = None,
) -> ClassifiedRow:
    return ClassifiedRow(
        raw_row=RawRow(row_number=row_num),
        classification=classification,
        sl_no_value=sl_no,
        description=description,
        unit=unit,
    )


def _preamble(row_num: int, sl_no: str = "A.") -> ClassifiedRow:
    return _make_cr(RowClassification.PREAMBLE, row_num, sl_no=sl_no)


def _preamble_with_unit(row_num: int, sl_no: str = "A.", unit: str = "m2") -> ClassifiedRow:
    return _make_cr(RowClassification.PREAMBLE, row_num, sl_no=sl_no, unit=unit)


def _line_item(row_num: int, sl_no: str = "1.1") -> ClassifiedRow:
    return _make_cr(RowClassification.LINE_ITEM, row_num, sl_no=sl_no)


def _note(row_num: int, description: str = "note text") -> ClassifiedRow:
    return _make_cr(RowClassification.NOTE, row_num, description=description)


def _subtotal(row_num: int) -> ClassifiedRow:
    return _make_cr(RowClassification.SUBTOTAL_MARKER, row_num, description="TOTAL")


def _sheet_cfg() -> SheetConfig:
    return SheetConfig(
        sheet_name="Test",
        header_row=1,
        column_role_map={
            "A": ColumnRole(role="sl_no"),
            "B": ColumnRole(role="description"),
            "C": ColumnRole(role="unit"),
        },
    )


def _find_by_xlsx_row(resolved_rows, xlsx_row: int):
    for rr in resolved_rows:
        if rr.classified_row.raw_row.row_number == xlsx_row:
            return rr
    return None


# ==================================================================
# Group 1: Bug 23 LINE_ITEM unit tests (5 tests)
# ==================================================================

class TestBug23LineItemUnit(unittest.TestCase):
    """LINE_ITEM parenting via level0_ancestor when stack is empty."""

    def test_line_item_after_level0_preamble_parents_under_level0(self):
        """[SUB HEAD A level=0] + [LINE_ITEM] -> parent_index=0, no standalone warning."""
        rows = [
            _preamble(2, sl_no="SUB HEAD A"),
            _line_item(3, sl_no="1"),
        ]
        result = resolve_hierarchy(rows, _sheet_cfg(), _GS)
        sub_head_rr = result.rows[0]
        line_item_rr = result.rows[1]
        self.assertEqual(sub_head_rr.level, 0)
        self.assertIsNone(sub_head_rr.parent_index)
        self.assertIsNotNone(line_item_rr.parent_index, "Bug 23: LINE_ITEM must inherit level0_ancestor")
        self.assertEqual(line_item_rr.parent_index, 0)
        warns = [w for w in result.warnings if "standalone line item" in w]
        self.assertEqual(len(warns), 0, f"No standalone warning expected; got: {warns}")

    def test_line_item_after_sub_head_and_subtotal_remains_rootless(self):
        """[SUB HEAD level=0] + [SUBTOTAL] + [LINE_ITEM] -> parent_index=None, warning fires."""
        rows = [
            _preamble(2, sl_no="SUB HEAD A"),
            _subtotal(3),
            _line_item(4, sl_no="1"),
        ]
        result = resolve_hierarchy(rows, _sheet_cfg(), _GS)
        line_item_rr = result.rows[2]
        self.assertIsNone(line_item_rr.parent_index, "After SUBTOTAL reset, LINE_ITEM must be rootless")
        warns = [w for w in result.warnings if "standalone line item" in w]
        self.assertGreater(len(warns), 0, "Standalone warning must fire after SUBTOTAL reset")

    def test_line_item_at_sheet_start_no_anchor_remains_rootless(self):
        """[LINE_ITEM] with no preceding PREAMBLE -> parent_index=None, warning fires."""
        rows = [_line_item(2, sl_no="1")]
        result = resolve_hierarchy(rows, _sheet_cfg(), _GS)
        self.assertIsNone(result.rows[0].parent_index)
        self.assertGreater(len(result.warnings), 0, "Standalone warning must fire")

    def test_line_item_rule_a2_fires_bug23_does_not_apply(self):
        """Rule A2 fires (sig D.D, fnt 1 vs 2) -> a2_handled=True, Bug 23 skipped."""
        rows = [
            _preamble(2, sl_no="1.0"),
            _line_item(3, sl_no="2.0"),
        ]
        result = resolve_hierarchy(rows, _sheet_cfg(), _GS)
        preamble_rr = result.rows[0]
        line_item_rr = result.rows[1]
        self.assertIsNone(preamble_rr.parent_index, "Preamble is rootless (no level=0 ancestor)")
        self.assertIsNone(
            line_item_rr.parent_index,
            "Rule A2 rootless sibling: parent stays None even with Bug 23 enabled",
        )

    def test_line_item_after_level0_then_level1_preamble_parents_under_level1(self):
        """[SUB HEAD level=0] + [PREAMBLE level=1] + [LINE_ITEM] -> parent_index=level-1 idx."""
        rows = [
            _preamble(2, sl_no="SUB HEAD A"),
            _preamble(3, sl_no="1.0"),
            _line_item(4, sl_no="1.1"),
        ]
        result = resolve_hierarchy(rows, _sheet_cfg(), _GS)
        level1_rr = result.rows[1]
        line_item_rr = result.rows[2]
        self.assertEqual(level1_rr.level, 1)
        self.assertIsNotNone(line_item_rr.parent_index)
        self.assertEqual(line_item_rr.parent_index, 1, "LINE_ITEM must parent under level-1, not level-0")


# ==================================================================
# Group 2: Bug 24 NOTE unit tests (5 tests)
# ==================================================================

class TestBug24NoteUnit(unittest.TestCase):
    """NOTE parent_index assigned to mirror attached_to_index or level0_ancestor."""

    def test_note_after_level1_preamble_parents_under_preamble(self):
        """[PREAMBLE level=1] + [NOTE] -> parent_index=preamble idx, attached_to_index=same."""
        rows = [
            _preamble(2, sl_no="A."),
            _note(3, description="note text"),
        ]
        result = resolve_hierarchy(rows, _sheet_cfg(), _GS)
        preamble_rr = result.rows[0]
        note_rr = result.rows[1]
        self.assertEqual(note_rr.attached_to_index, 0, "attached_to_index must be preamble idx")
        self.assertEqual(note_rr.parent_index, 0, "Bug 24: parent_index must mirror attached_to_index")
        self.assertIn("note text", preamble_rr.attached_notes)

    def test_note_after_level0_subhead_attaches_to_the_anchor(self):
        """[SUB HEAD level=0] + [NOTE] -> the note ATTACHES to the anchor (EA-6a).

        UPDATED at EA-6a slice 1 (authorised). This test previously asserted
        attached_to_index=None + the text in master_preamble_notes while parent_index was the
        anchor -- i.e. it PINNED the pointer/text divergence that BUG_24's own comment admits
        ("gates only parent_index, not attached_to_index").

        A level-0 section header IS a PREAMBLE (classifier._promote_section_header sets
        classification = PREAMBLE); it is merely never pushed onto the stack, so
        _top_non_none(stack) is blind to it. Under the three-way nearest-wins rule it is a full
        candidate, so this is an ORDINARY preamble attachment -- and the divergence disappears.
        The master bucket is NOT involved here: it is reached only when nothing at all sits
        above the note (see TestBug24NoteUnit.test_note_at_sheet_start_no_anchor_remains_rootless,
        which stays green).
        """
        rows = [
            _preamble(2, sl_no="SUB HEAD A"),
            _note(3, description="section note"),
        ]
        result = resolve_hierarchy(rows, _sheet_cfg(), _GS)
        anchor_rr = result.rows[0]
        note_rr = result.rows[1]
        self.assertEqual(note_rr.parent_index, 0, "the anchor is the nearest preamble above")
        self.assertEqual(
            note_rr.attached_to_index, note_rr.parent_index,
            "EA-6a: attached_to_index must equal parent_index (no divergence)",
        )
        self.assertIn("section note", anchor_rr.attached_notes,
                      "the text lands on the row the pointer names")
        self.assertEqual(result.master_preamble_notes, [],
                         "the master bucket is for notes with NOTHING above them")

    def test_note_at_sheet_start_no_anchor_remains_rootless(self):
        """[NOTE] at sheet start, no PREAMBLE -> parent_index=None, attached_to_index=None."""
        rows = [_note(2, description="preamble text")]
        result = resolve_hierarchy(rows, _sheet_cfg(), _GS)
        note_rr = result.rows[0]
        self.assertIsNone(note_rr.parent_index)
        self.assertIsNone(note_rr.attached_to_index)
        self.assertIn("preamble text", result.master_preamble_notes)

    def test_note_after_subtotal_with_no_new_preamble_remains_rootless(self):
        """[PREAMBLE] + [SUBTOTAL] + [NOTE] -> parent_index=None (stack and level0_ancestor both reset)."""
        rows = [
            _preamble(2, sl_no="A."),
            _subtotal(3),
            _note(4, description="post-subtotal note"),
        ]
        result = resolve_hierarchy(rows, _sheet_cfg(), _GS)
        note_rr = result.rows[2]
        self.assertIsNone(note_rr.parent_index, "After SUBTOTAL reset, NOTE must be rootless")
        self.assertIsNone(note_rr.attached_to_index)

    def test_note_attached_to_index_still_correct_alongside_parent_index(self):
        """Adding parent_index must not break existing attached_to_index + attached_notes contract."""
        rows = [
            _preamble(2, sl_no="A."),
            _note(3, description="the note"),
        ]
        result = resolve_hierarchy(rows, _sheet_cfg(), _GS)
        preamble_rr = result.rows[0]
        note_rr = result.rows[1]
        self.assertEqual(note_rr.attached_to_index, 0)
        self.assertEqual(note_rr.parent_index, 0)
        self.assertIn("the note", preamble_rr.attached_notes)
        self.assertIsNone(note_rr.path, "NOTE must have path=None (not a tree node)")


# ==================================================================
# Group 3: Bug 23 toggle tests (2 tests)
# ==================================================================

class TestBug23Toggle(unittest.TestCase):

    def test_bug23_toggle_off_restores_pre_fix_behavior(self):
        """BUG_23_LINE_ITEM_LEVEL0_ANCESTOR_ENABLED=False: LINE_ITEM after SUB HEAD is rootless."""
        rows = [
            _preamble(2, sl_no="SUB HEAD A"),
            _line_item(3, sl_no="1"),
        ]
        try:
            hierarchy_mod.BUG_23_LINE_ITEM_LEVEL0_ANCESTOR_ENABLED = False
            result = resolve_hierarchy(rows, _sheet_cfg(), _GS)
        finally:
            hierarchy_mod.BUG_23_LINE_ITEM_LEVEL0_ANCESTOR_ENABLED = True
        line_item_rr = result.rows[1]
        self.assertIsNone(line_item_rr.parent_index, "Toggle off: LINE_ITEM must be rootless (pre-fix behavior)")
        warns = [w for w in result.warnings if "standalone line item" in w]
        self.assertGreater(len(warns), 0, "Standalone warning must fire when toggle is off")

    def test_bug23_toggle_off_does_not_affect_bug24(self):
        """BUG_23 off, BUG_24 on: NOTEs still receive parent_index from level0_ancestor."""
        rows = [
            _preamble(2, sl_no="SUB HEAD A"),
            _note(3, description="section note"),
        ]
        try:
            hierarchy_mod.BUG_23_LINE_ITEM_LEVEL0_ANCESTOR_ENABLED = False
            result = resolve_hierarchy(rows, _sheet_cfg(), _GS)
        finally:
            hierarchy_mod.BUG_23_LINE_ITEM_LEVEL0_ANCESTOR_ENABLED = True
        note_rr = result.rows[1]
        self.assertIsNotNone(note_rr.parent_index, "Bug 24 must still fire when Bug 23 is off")
        self.assertEqual(note_rr.parent_index, 0)


# ==================================================================
# Group 4: Bug 24 toggle tests (2 tests)
# ==================================================================

class TestBug24Toggle(unittest.TestCase):

    def test_bug24_toggle_off_restores_pre_fix_behavior(self):
        """BUG_24_NOTE_PARENT_INDEX_ENABLED=False: NOTEs have parent_index=None, attached_to_index still set."""
        rows = [
            _preamble(2, sl_no="A."),
            _note(3, description="the note"),
        ]
        try:
            hierarchy_mod.BUG_24_NOTE_PARENT_INDEX_ENABLED = False
            result = resolve_hierarchy(rows, _sheet_cfg(), _GS)
        finally:
            hierarchy_mod.BUG_24_NOTE_PARENT_INDEX_ENABLED = True
        note_rr = result.rows[1]
        preamble_rr = result.rows[0]
        self.assertIsNone(note_rr.parent_index, "Toggle off: parent_index must be None (pre-fix behavior)")
        self.assertEqual(note_rr.attached_to_index, 0, "attached_to_index must still be set correctly")
        self.assertIn("the note", preamble_rr.attached_notes)

    def test_bug24_toggle_off_does_not_affect_bug23(self):
        """BUG_24 off, BUG_23 on: LINE_ITEMs still inherit level0_ancestor as parent."""
        rows = [
            _preamble(2, sl_no="SUB HEAD A"),
            _line_item(3, sl_no="1"),
        ]
        try:
            hierarchy_mod.BUG_24_NOTE_PARENT_INDEX_ENABLED = False
            result = resolve_hierarchy(rows, _sheet_cfg(), _GS)
        finally:
            hierarchy_mod.BUG_24_NOTE_PARENT_INDEX_ENABLED = True
        line_item_rr = result.rows[1]
        self.assertIsNotNone(line_item_rr.parent_index, "Bug 23 must still fire when Bug 24 is off")
        self.assertEqual(line_item_rr.parent_index, 0)


# ==================================================================
# Group 5: Demotion post-pass unaffected (1 test)
# ==================================================================

class TestDemotionPostPassUnaffected(unittest.TestCase):

    def test_preamble_with_only_note_children_still_demotes(self):
        """
        [PREAMBLE with unit] + [NOTE child] -> zero-children demotion post-pass still fires.
        After Bug 24, NOTE has parent_index=0 but path=None. The demotion post-pass builds
        paths_with_descendants from rows with non-None path only. Since NOTE path=None it is
        skipped and does not count as a tree descendant. The PREAMBLE (unit present, no
        path-bearing children) must still be demoted to LINE_ITEM.
        """
        rows = [
            _preamble_with_unit(2, sl_no="A.", unit="m2"),
            _note(3, description="measurement note"),
        ]
        result = resolve_hierarchy(rows, _sheet_cfg(), _GS)
        note_rr = result.rows[1]
        self.assertIsNotNone(note_rr.parent_index, "NOTE must have parent_index after Bug 24")
        self.assertIsNone(note_rr.path, "NOTE must have path=None (not a tree node)")
        _apply_zero_children_preamble_demotion_post_pass(result.rows)
        preamble_rr = result.rows[0]
        self.assertEqual(
            preamble_rr.classified_row.classification,
            RowClassification.LINE_ITEM,
            "PREAMBLE with only NOTE children (path=None) must still demote to LINE_ITEM",
        )


# ==================================================================
# Group 6: Bill of Quantities integration tests (2 tests)
# ==================================================================

def _boq_elv_cfg() -> MappingConfig:
    return MappingConfig(
        project="boq_elv_bug23_24",
        master_boq=MasterBoqMetadata(boq_name="Bill Of Quantities ELV"),
        sheets=[
            SheetConfig(sheet_name="SUMMARY OF ELECTRICAL & ELV BOQ", skip=True, column_role_map={}),
            SheetConfig(
                sheet_name="ELECTRICAL & ELV BOQ",
                header_row=2,
                header_row_count=2,
                column_role_map={
                    "A": ColumnRole(role="sl_no"),
                    "B": ColumnRole(role="append_to_notes"),
                    "C": ColumnRole(role="description"),
                    "D": ColumnRole(role="unit"),
                    "E": ColumnRole(role="qty"),
                    "F": ColumnRole(role="rate_supply"),
                    "G": ColumnRole(role="rate_install"),
                    "H": ColumnRole(role="amount_supply"),
                    "I": ColumnRole(role="amount_install"),
                    "J": ColumnRole(role="append_to_notes"),
                },
            ),
        ],
    )


class TestBillOfQuantitiesIntegration(unittest.TestCase):
    """
    Integration tests on Bill of Quantities.xlsx 'ELECTRICAL & ELV BOQ'.

    Bug 23 fix: LINE_ITEM rows immediately following a level=0 SUB HEAD (empty
    stack) now parent under that SUB HEAD. Pre-fix: parent_index=None.

    Bug 24 fix: NOTE rows after a PREAMBLE on the stack carry non-None
    parent_index. Pre-fix: all NOTEs had parent_index=None.

    Config inlined for test-file self-containment (see cycle 4 session 1 note).
    """

    @classmethod
    def setUpClass(cls):
        if not _BOQ_ELV_FIXTURE.exists():
            cls._skip = True
            return
        cls._skip = False
        from nirmaan_stack.services.boq_parser.orchestrator import parse_boq
        result = parse_boq(str(_BOQ_ELV_FIXTURE), _boq_elv_cfg())
        cls.resolved = result.sheets[0].resolved_rows

    def setUp(self):
        if self._skip:
            self.skipTest(f"Bill of Quantities fixture not found: {_BOQ_ELV_FIXTURE}")

    def test_boq_elv_sub_head_line_items_now_parented(self):
        """
        After Bug 23 fix, at least one LINE_ITEM must parent under a level=0 SUB HEAD.
        21 SUB HEAD rows exist; at least one (e.g. SUB HEAD D, xl r177-r183) has
        direct LINE_ITEM children. Pre-fix: those LINE_ITEMs had parent_index=None.
        """
        level0_ridxs = {
            ridx
            for ridx, rr in enumerate(self.resolved)
            if rr.classified_row.classification == RowClassification.PREAMBLE
            and rr.level == 0
        }
        line_items_under_level0 = [
            rr for rr in self.resolved
            if rr.classified_row.classification == RowClassification.LINE_ITEM
            and rr.parent_index is not None
            and rr.parent_index in level0_ridxs
        ]
        self.assertGreater(
            len(line_items_under_level0), 0,
            f"At least one LINE_ITEM must parent under a level=0 SUB HEAD after Bug 23 fix. "
            f"Found {len(level0_ridxs)} level=0 PREAMBLEs but 0 direct LINE_ITEM children.",
        )

    def test_boq_elv_notes_now_have_parent_index(self):
        """
        After Bug 24 fix, NOTE rows after any PREAMBLE on the stack must have
        non-None parent_index. Pre-fix: all NOTEs had parent_index=None.
        Assert at least 2 NOTEs now have non-None parent_index.
        """
        notes_with_parent = [
            rr for rr in self.resolved
            if rr.classified_row.classification == RowClassification.NOTE
            and rr.parent_index is not None
        ]
        self.assertGreaterEqual(
            len(notes_with_parent), 2,
            f"At least 2 NOTEs must have non-None parent_index after Bug 24 fix; "
            f"got {len(notes_with_parent)}",
        )


# ==================================================================
# Group 7: Alorica integration test (1 test)
# ==================================================================

def _alorica_1row_cfg() -> MappingConfig:
    return MappingConfig(
        project="alorica_1row_bug23",
        master_boq=MasterBoqMetadata(boq_name="Alorica Pri Tech HVAC (1-row header)"),
        sheets=[
            SheetConfig(sheet_name="Summary", skip=True, column_role_map={}),
            SheetConfig(
                sheet_name="low side",
                header_row=6,
                header_row_count=1,
                column_role_map={
                    "A": ColumnRole(role="sl_no"),
                    "B": ColumnRole(role="description"),
                    "C": ColumnRole(role="unit"),
                    "D": ColumnRole(role="qty"),
                    "E": ColumnRole(role="rate_supply"),
                    "F": ColumnRole(role="rate_install"),
                    "G": ColumnRole(role="amount_total"),
                },
            ),
            SheetConfig(sheet_name="csu unit", skip=True, column_role_map={}),
            SheetConfig(sheet_name="make", skip=True, column_role_map={}),
        ],
    )


class TestAloricaIntegration(unittest.TestCase):
    """
    Integration test on alorica_pri_tech_hvac.xlsx 'low side' (1-row header config).

    Bug 23 candidates: LINE_ITEM rows following a level=0 PREAMBLE with empty stack.
    Post-fix they inherit level0_ancestor. Cycle 3 investigation estimated ~13 candidates.

    Deferred (Nitesh cycle 4 decision): 7 rootless LINE_ITEMs via Rule A2 through a
    rootless PREAMBLE stay parent=None (a2_handled=True gates Bug 23). Parked to Phase 3+
    AI layer.

    Config inlined from cycle_3_configs/alorica_pri_tech_hvac_1row_header_sheetconfig.py.
    """

    @classmethod
    def setUpClass(cls):
        if not _ALORICA_FIXTURE.exists():
            cls._skip = True
            return
        cls._skip = False
        from nirmaan_stack.services.boq_parser.orchestrator import parse_boq
        result = parse_boq(str(_ALORICA_FIXTURE), _alorica_1row_cfg())
        cls.resolved = result.sheets[0].resolved_rows

    def setUp(self):
        if self._skip:
            self.skipTest(f"Alorica fixture not found: {_ALORICA_FIXTURE}")

    def test_alorica_1row_bug23_candidates_now_parented_seven_stay_rootless(self):
        """
        At least 1 LINE_ITEM must now parent under a level=0 PREAMBLE (smoke check).
        The 7 Rule-A2-rootless cases remain parent=None per Nitesh's cycle 4 decision.
        """
        level0_ridxs = {
            ridx
            for ridx, rr in enumerate(self.resolved)
            if rr.classified_row.classification == RowClassification.PREAMBLE
            and rr.level == 0
        }
        bug23_parented = [
            rr for rr in self.resolved
            if rr.classified_row.classification == RowClassification.LINE_ITEM
            and rr.parent_index is not None
            and rr.parent_index in level0_ridxs
        ]
        self.assertGreater(
            len(bug23_parented), 0,
            "At least 1 LINE_ITEM must now parent under a level=0 PREAMBLE after Bug 23 fix",
        )
        rootless = [
            rr for rr in self.resolved
            if rr.classified_row.classification == RowClassification.LINE_ITEM
            and rr.parent_index is None
        ]
        # 7 Rule-A2 rootless cases deliberately deferred to Phase 3+ AI layer.
        _ = rootless


# ==================================================================
# Group 8: EA-6a slice 1 -- note attaches to the NEAREST preamble-or-line-item (10 tests)
# ==================================================================

class TestEA6aNoteNearestRow(unittest.TestCase):
    """NOTE_PARENT_NEAREST_ROW_ENABLED: three-way nearest-wins note parenting.

    The rule: a note attaches to the nearest of (stack-top preamble, last line item,
    level0_ancestor) ABOVE it -- one rule, no special cases. Flag off restores the
    pre-EA-6a nearest-preamble-on-the-stack behaviour exactly.
    """

    # -- the core new case -------------------------------------------------

    def test_note_attaches_to_a_nearer_line_item(self):
        """[PREAMBLE] [LINE_ITEM] [NOTE] -> the NOTE attaches to the LINE ITEM, not the preamble.

        This is the whole point of EA-6a: a DB's schedule note lands on the DB row.
        """
        rows = [
            _preamble(2, sl_no="A."),
            _line_item(3, sl_no="1"),
            _note(4, description="Sub incomer - 40A, DP, RCBO,30mA- 3No."),
        ]
        result = resolve_hierarchy(rows, _sheet_cfg(), _GS)
        preamble_rr, line_item_rr, note_rr = result.rows
        self.assertEqual(note_rr.parent_index, 1, "the line item is nearer than the preamble")
        self.assertEqual(note_rr.attached_to_index, 1)
        self.assertIn("Sub incomer - 40A, DP, RCBO,30mA- 3No.", line_item_rr.attached_notes)
        self.assertEqual(preamble_rr.attached_notes, [],
                         "the preamble must NOT also collect the text")

    def test_note_with_only_a_preamble_above_still_attaches_to_the_preamble(self):
        """[PREAMBLE] [NOTE] -> unchanged behaviour (no line item to beat it)."""
        rows = [
            _preamble(2, sl_no="A."),
            _note(3, description="section spec"),
        ]
        result = resolve_hierarchy(rows, _sheet_cfg(), _GS)
        preamble_rr, note_rr = result.rows
        self.assertEqual(note_rr.parent_index, 0)
        self.assertEqual(note_rr.attached_to_index, 0)
        self.assertIn("section spec", preamble_rr.attached_notes)

    def test_a_preamble_opening_after_a_line_item_wins_it_back(self):
        """[PREAMBLE] [LINE_ITEM] [PREAMBLE] [NOTE] -> the NEW preamble is nearest.

        The negative of the core case: the marker does not 'stick' once a nearer preamble
        opens. This is also why a per-preamble reset would be a no-op.
        """
        rows = [
            _preamble(2, sl_no="A."),
            _line_item(3, sl_no="1"),
            _preamble(4, sl_no="B."),
            _note(5, description="belongs to B"),
        ]
        result = resolve_hierarchy(rows, _sheet_cfg(), _GS)
        note_rr = result.rows[3]
        self.assertEqual(note_rr.parent_index, 2, "preamble B is nearer than the line item")
        self.assertIn("belongs to B", result.rows[2].attached_notes)

    def test_level0_anchor_beats_a_line_item_that_precedes_it(self):
        """[LINE_ITEM] [SUB HEAD level=0] [NOTE] -> the ANCHOR wins, not the stale line item.

        The level-0 header is a PREAMBLE the stack cannot see, so it must be a FULL candidate.
        An `else level0_ancestor` FALLBACK would return the line item here -- the shape that
        mis-attaches 42 notes on the live corpus.
        """
        rows = [
            _line_item(2, sl_no="1"),
            _preamble(3, sl_no="SUB HEAD A"),
            _note(4, description="Supplier shall provide installation methodology"),
        ]
        result = resolve_hierarchy(rows, _sheet_cfg(), _GS)
        anchor_rr, note_rr = result.rows[1], result.rows[2]
        self.assertEqual(note_rr.parent_index, 1, "the anchor is nearer than the line item")
        self.assertEqual(note_rr.attached_to_index, 1)
        self.assertIn("Supplier shall provide installation methodology", anchor_rr.attached_notes)
        self.assertEqual(result.rows[0].attached_notes, [],
                         "the pre-anchor line item must NOT collect it")

    # -- the master bucket, unchanged --------------------------------------

    def test_note_with_nothing_above_still_goes_to_the_master_bucket(self):
        """[NOTE] alone -> master bucket, byte-identical to pre-EA-6a."""
        rows = [_note(2, description="General scope statement")]
        result = resolve_hierarchy(rows, _sheet_cfg(), _GS)
        note_rr = result.rows[0]
        self.assertIsNone(note_rr.parent_index)
        self.assertIsNone(note_rr.attached_to_index)
        self.assertIn("General scope statement", result.master_preamble_notes)

    def test_note_after_subtotal_with_a_prior_line_item_is_rootless(self):
        """[PREAMBLE] [LINE_ITEM] [SUBTOTAL] [NOTE] -> rootless; the marker reset fires.

        The variant the pre-EA-6a suite could not exercise: without the subtotal reset the
        stale line item would be the only candidate and would wrongly win.
        """
        rows = [
            _preamble(2, sl_no="A."),
            _line_item(3, sl_no="1"),
            _subtotal(4),
            _note(5, description="TOTAL FOR EARTH ELECTRODES AND EARTH STRIPS"),
        ]
        result = resolve_hierarchy(rows, _sheet_cfg(), _GS)
        note_rr = result.rows[3]
        self.assertIsNone(note_rr.parent_index, "the subtotal reset must clear the marker")
        self.assertIsNone(note_rr.attached_to_index)
        self.assertIn("TOTAL FOR EARTH ELECTRODES AND EARTH STRIPS", result.master_preamble_notes)
        self.assertEqual(result.rows[1].attached_notes, [],
                         "the pre-subtotal line item must NOT collect it")

    # -- the invariants ----------------------------------------------------

    def test_reparented_note_keeps_path_none_and_no_level(self):
        """A note that re-parents onto a LINE ITEM is still not a tree node."""
        rows = [
            _preamble(2, sl_no="A."),
            _line_item(3, sl_no="1"),
            _note(4, description="spec"),
        ]
        result = resolve_hierarchy(rows, _sheet_cfg(), _GS)
        note_rr = result.rows[2]
        self.assertEqual(note_rr.parent_index, 1, "precondition: it did re-parent")
        self.assertIsNone(note_rr.path, "NOTE must keep path=None")
        self.assertIsNone(note_rr.level, "NOTE must carry no level")

    def test_attached_to_index_equals_parent_index_for_every_note(self):
        """The no-divergence invariant, over every note shape incl. the master bucket."""
        rows = [
            _note(2, description="top-of-BoQ general note"),   # master bucket (both None)
            _preamble(3, sl_no="SUB HEAD A"),                  # level-0 anchor
            _note(4, description="under the anchor"),
            _preamble(5, sl_no="A."),
            _note(6, description="under the preamble"),
            _line_item(7, sl_no="1"),
            _note(8, description="under the line item"),
            _subtotal(9),
            _note(10, description="after the subtotal"),       # master bucket (both None)
        ]
        result = resolve_hierarchy(rows, _sheet_cfg(), _GS)
        notes = [
            rr for rr in result.rows
            if rr.classified_row.classification == RowClassification.NOTE
        ]
        self.assertEqual(len(notes), 5)
        for rr in notes:
            self.assertEqual(
                rr.attached_to_index, rr.parent_index,
                f"divergence on row {rr.classified_row.raw_row.row_number}",
            )

    def test_line_item_and_preamble_parenting_is_byte_unchanged(self):
        """THE HARD INVARIANT: the marker changes NOTE parents only.

        Same fixture resolved with the flag OFF and ON -- every LINE_ITEM and PREAMBLE keeps
        an identical parent_index, level and path. Only the notes move.
        """
        def _fixture():
            return [
                _preamble(2, sl_no="SUB HEAD A"),
                _preamble(3, sl_no="A."),
                _line_item(4, sl_no="1"),
                _note(5, description="n1"),
                _line_item(6, sl_no="2"),
                _note(7, description="n2"),
                _preamble(8, sl_no="B."),
                _line_item(9, sl_no="3"),
                _subtotal(10),
                _preamble(11, sl_no="C."),
                _note(12, description="n3"),
                _line_item(13, sl_no="4"),
            ]

        try:
            hierarchy_mod.NOTE_PARENT_NEAREST_ROW_ENABLED = False
            before = resolve_hierarchy(_fixture(), _sheet_cfg(), _GS)
            hierarchy_mod.NOTE_PARENT_NEAREST_ROW_ENABLED = True
            after = resolve_hierarchy(_fixture(), _sheet_cfg(), _GS)
        finally:
            hierarchy_mod.NOTE_PARENT_NEAREST_ROW_ENABLED = True

        def _non_note_shape(res):
            return [
                (rr.classified_row.raw_row.row_number, rr.parent_index, rr.level, rr.path)
                for rr in res.rows
                if rr.classified_row.classification != RowClassification.NOTE
            ]

        self.assertEqual(
            _non_note_shape(before), _non_note_shape(after),
            "line item / preamble / subtotal parenting, level and path must be byte-identical",
        )
        # ...and the notes DID move, or the comparison above proves nothing.
        moved = [
            (b.parent_index, a.parent_index)
            for b, a in zip(before.rows, after.rows)
            if b.classified_row.classification == RowClassification.NOTE
            and b.parent_index != a.parent_index
        ]
        self.assertTrue(moved, "precondition: at least one note must re-parent under the flag")

    def test_flag_off_restores_pre_ea6a_note_parenting(self):
        """Flag OFF: [PREAMBLE] [LINE_ITEM] [NOTE] -> the note attaches to the PREAMBLE."""
        rows = [
            _preamble(2, sl_no="A."),
            _line_item(3, sl_no="1"),
            _note(4, description="spec"),
        ]
        try:
            hierarchy_mod.NOTE_PARENT_NEAREST_ROW_ENABLED = False
            result = resolve_hierarchy(rows, _sheet_cfg(), _GS)
        finally:
            hierarchy_mod.NOTE_PARENT_NEAREST_ROW_ENABLED = True
        note_rr = result.rows[2]
        self.assertEqual(note_rr.parent_index, 0, "flag off -> nearest preamble on the stack")
        self.assertEqual(note_rr.attached_to_index, 0)
        self.assertIn("spec", result.rows[0].attached_notes)
        self.assertEqual(result.rows[1].attached_notes, [])


if __name__ == "__main__":
    unittest.main()
