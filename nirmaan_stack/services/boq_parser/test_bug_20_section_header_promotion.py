"""
Tests for Bug 20 anchors 1+2 and Bug 20-ext -- cluster 2 session 2, sec 9 #108.

Bug 20 anchors 1+2: _apply_section_header_note_promotion_post_pass promotes NOTE
rows at positional anchors (sheet start; after each SUBTOTAL_MARKER) to PREAMBLE
level=0 when they carry section-banner text (e.g. "PART-1 AIR DISTRIBUTION SYSTEM").

Bug 20-ext: _determine_preamble_level forces level=0 (was 1) for SUB HEAD markers,
so numeric PREAMBLEs (sl=1.0, 2.0, ...) correctly parent under the SUB HEAD row.

17 tests across 5 groups:
  TestAnchor1                  (5) -- Anchor 1: first non-SPACER after header
  TestAnchor2                  (4) -- Anchor 2: first non-SPACER after SUBTOTAL
  TestToggles                  (2) -- BUG_20_SECTION_HEADER_PROMOTION_ENABLED,
                                      BUG_20_EXT_SUB_HEAD_LEVEL_ZERO_ENABLED
  TestSafronIntegration        (3) -- safron r5 (anchor 1), r41 (anchor 2), r43 (NOT promoted)
  TestBoqElvBug20Ext           (3) -- BoQ ELV r4 SUB HEAD A, r6 sl=1.0 parent, 21-SUB HEAD count
"""
from __future__ import annotations

import unittest
from pathlib import Path

import nirmaan_stack.services.boq_parser.classifier as classifier_mod
import nirmaan_stack.services.boq_parser.hierarchy as hierarchy_mod
from nirmaan_stack.services.boq_parser.classifier import (
    ClassifiedRow,
    RowClassification,
    _apply_section_header_note_promotion_post_pass,
    _apply_unit_based_demotion_post_pass,
    classify_row,
    populate_preamble_candidate_scores,
)
from nirmaan_stack.services.boq_parser.config import (
    ColumnRole,
    GlobalSettings,
    MappingConfig,
    MasterBoqMetadata,
    SheetConfig,
)
from nirmaan_stack.services.boq_parser.hierarchy import (
    _is_sub_head_marker,
    resolve_hierarchy,
)
from nirmaan_stack.services.boq_parser.orchestrator import TEXT_ROLE_ROLES
from nirmaan_stack.services.boq_parser.reader import BoqReader, RawRow

_FIXTURES = Path(__file__).parent / "tests" / "fixtures"
_SAFRON_FIXTURE = _FIXTURES / "safron_hvac_2026-04-11.xlsx"
_SAFRON_SHEET = "Low Side Works R2 11.4.26"
_SAFRON_HEADER_ROW = 3
_SAFRON_R41_ROW = 41   # "PART- 2 INSULATION" (anchor 2 target)
_SAFRON_R43_ROW = 43   # "ACCOUSTIC INSULATION" (anchor 3 -- NOT promoted this session)

_GS = GlobalSettings()
_SAFRON_CONFIG = SheetConfig(
    sheet_name=_SAFRON_SHEET,
    header_row=_SAFRON_HEADER_ROW,
    column_role_map={
        "A": ColumnRole(role="sl_no"),
        "B": ColumnRole(role="description"),
        "C": ColumnRole(role="unit"),
        "D": ColumnRole(role="qty"),
        "E": ColumnRole(role="rate_supply"),
        "F": ColumnRole(role="rate_install"),
        "G": ColumnRole(role="amount_supply"),
    },
)


# ------------------------------------------------------------------
# Synthetic ClassifiedRow helpers
# ------------------------------------------------------------------

def _make_cr(
    classification: RowClassification,
    row_num: int,
    sl_no: str | None = None,
    description: str | None = None,
) -> ClassifiedRow:
    return ClassifiedRow(
        raw_row=RawRow(row_number=row_num),
        classification=classification,
        sl_no_value=sl_no,
        description=description,
    )


def _note(row_num: int, sl_no: str | None = None, description: str | None = None) -> ClassifiedRow:
    return _make_cr(RowClassification.NOTE, row_num, sl_no=sl_no, description=description)


def _spacer(row_num: int) -> ClassifiedRow:
    return _make_cr(RowClassification.SPACER, row_num)


def _line_item(row_num: int, sl_no: str = "1.0") -> ClassifiedRow:
    return _make_cr(RowClassification.LINE_ITEM, row_num, sl_no=sl_no)


def _subtotal(row_num: int) -> ClassifiedRow:
    return _make_cr(RowClassification.SUBTOTAL_MARKER, row_num, description="TOTAL")


def _preamble(row_num: int, sl_no: str = "A.") -> ClassifiedRow:
    return _make_cr(RowClassification.PREAMBLE, row_num, sl_no=sl_no)


def _sheet_cfg() -> SheetConfig:
    return SheetConfig(
        sheet_name="Test",
        header_row=1,
        column_role_map={
            "A": ColumnRole(role="sl_no"),
            "B": ColumnRole(role="description"),
        },
    )


def _find_by_xlsx_row(resolved_rows, xlsx_row: int):
    for rr in resolved_rows:
        if rr.classified_row.raw_row.row_number == xlsx_row:
            return rr
    return None


# ------------------------------------------------------------------
# BoQ ELV pipeline helper
# ------------------------------------------------------------------

def _boq_elv_config() -> MappingConfig:
    _cols = {
        "A": ColumnRole(role="sl_no"),
        "B": ColumnRole(role="append_to_notes"),
        "C": ColumnRole(role="description"),
        "D": ColumnRole(role="unit"),
        "E": ColumnRole(role="qty"),
        "F": ColumnRole(role="rate_supply"),
        "G": ColumnRole(role="rate_install"),
        "H": ColumnRole(role="amount_supply"),
        "I": ColumnRole(role="amount_install"),
    }
    return MappingConfig(
        project="boq_elv",
        master_boq=MasterBoqMetadata(boq_name="Bill Of Quantities ELV"),
        sheets=[
            SheetConfig(
                sheet_name="ELECTRICAL & ELV BOQ",
                header_row=2,
                header_row_count=2,
                column_role_map=_cols,
            ),
        ],
    )


def _run_elv_pipeline_with_bug20():
    """Full pipeline (including Bug 20 post-pass) for BoQ ELV sheet."""
    cfg = _boq_elv_config()
    sheet_config = cfg.sheets[0]
    global_settings = cfg.global_settings
    reader = BoqReader(str(_FIXTURES / "Bill of Quantities.xlsx"))
    header_row = sheet_config.header_row
    skip_rows = {header_row, header_row + 1}
    raw_rows = [
        rr for rr in reader.iter_rows(sheet_config.sheet_name)
        if rr.row_number not in skip_rows and rr.row_number >= header_row
    ]
    classified = [classify_row(rr, sheet_config, global_settings) for rr in raw_rows]
    _apply_unit_based_demotion_post_pass(classified)
    populate_preamble_candidate_scores(classified, sheet_config)
    _apply_section_header_note_promotion_post_pass(classified)
    return resolve_hierarchy(classified, sheet_config, global_settings).rows


def _run_safron_pipeline_with_bug20():
    """Full pipeline (including Bug 20 post-pass) for safron Low Side Works sheet."""
    reader = BoqReader(str(_SAFRON_FIXTURE))
    text_role_columns = {
        col for col, cr in _SAFRON_CONFIG.column_role_map.items()
        if cr.role in TEXT_ROLE_ROLES
    }
    raw_rows = [
        rr for rr in reader.iter_rows(_SAFRON_SHEET, text_role_columns=text_role_columns)
        if rr.row_number != _SAFRON_HEADER_ROW and rr.row_number >= _SAFRON_HEADER_ROW
    ]
    classified = [classify_row(rr, _SAFRON_CONFIG, _GS) for rr in raw_rows]
    _apply_unit_based_demotion_post_pass(classified)
    populate_preamble_candidate_scores(classified, _SAFRON_CONFIG)
    _apply_section_header_note_promotion_post_pass(classified)
    return resolve_hierarchy(classified, _SAFRON_CONFIG, _GS).rows


# ==================================================================
# Group 1: Anchor 1 -- first non-SPACER after header (5 tests)
# ==================================================================

class TestAnchor1(unittest.TestCase):
    """Anchor 1 promotes the first non-SPACER NOTE at sheet start."""

    def test_anchor1_fires_after_single_spacer(self):
        """header → spacer → NOTE(desc) → promoted to PREAMBLE level=0."""
        rows = [
            _spacer(2),
            _note(3, description="PART-1 AIR DISTRIBUTION SYSTEM"),
        ]
        _apply_section_header_note_promotion_post_pass(rows)
        self.assertEqual(rows[1].classification, RowClassification.PREAMBLE)
        self.assertEqual(rows[1].preamble_level_override, 0)

    def test_anchor1_fires_without_spacer(self):
        """header → NOTE (no spacer) → promoted."""
        rows = [_note(2, description="SECTION 1")]
        _apply_section_header_note_promotion_post_pass(rows)
        self.assertEqual(rows[0].classification, RowClassification.PREAMBLE)
        self.assertEqual(rows[0].preamble_level_override, 0)

    def test_anchor1_skips_multiple_spacers(self):
        """header → spacer × 3 → NOTE → promoted (skip-spacers rule)."""
        rows = [
            _spacer(2), _spacer(3), _spacer(4),
            _note(5, description="CHAPTER A"),
        ]
        _apply_section_header_note_promotion_post_pass(rows)
        self.assertEqual(rows[3].classification, RowClassification.PREAMBLE)
        self.assertEqual(rows[3].preamble_level_override, 0)

    def test_anchor1_no_fire_for_line_item(self):
        """header → spacer → LINE_ITEM → no promotion (not NOTE)."""
        rows = [
            _spacer(2),
            _line_item(3),
        ]
        _apply_section_header_note_promotion_post_pass(rows)
        self.assertEqual(rows[1].classification, RowClassification.LINE_ITEM)
        self.assertIsNone(rows[1].preamble_level_override)

    def test_anchor1_no_fire_for_note_with_numeric_sl_no(self):
        """header → spacer → NOTE with sl_no='1.0' and no desc → no promotion (section-number pattern)."""
        rows = [
            _spacer(2),
            _note(3, sl_no="1.0"),  # looks like a section number, no description
        ]
        _apply_section_header_note_promotion_post_pass(rows)
        self.assertEqual(rows[1].classification, RowClassification.NOTE)
        self.assertIsNone(rows[1].preamble_level_override)


# ==================================================================
# Group 2: Anchor 2 -- first non-SPACER after SUBTOTAL_MARKER (4 tests)
# ==================================================================

class TestAnchor2(unittest.TestCase):
    """Anchor 2 promotes the first non-SPACER NOTE after each SUBTOTAL_MARKER."""

    def test_anchor2_fires_after_subtotal_with_spacer(self):
        """SUBTOTAL → spacer → NOTE → promoted."""
        rows = [
            _preamble(2, "A."),
            _subtotal(3),
            _spacer(4),
            _note(5, description="PART-2 INSULATION"),
        ]
        _apply_section_header_note_promotion_post_pass(rows)
        self.assertEqual(rows[3].classification, RowClassification.PREAMBLE)
        self.assertEqual(rows[3].preamble_level_override, 0)

    def test_anchor2_fires_after_subtotal_without_spacer(self):
        """SUBTOTAL → NOTE (no spacer) → promoted."""
        rows = [
            _subtotal(2),
            _note(3, description="NEXT SECTION"),
        ]
        _apply_section_header_note_promotion_post_pass(rows)
        self.assertEqual(rows[1].classification, RowClassification.PREAMBLE)
        self.assertEqual(rows[1].preamble_level_override, 0)

    def test_anchor2_no_fire_for_note_with_numeric_sl_no(self):
        """SUBTOTAL → NOTE with sl_no='A.' and no desc → no promotion (section-number code)."""
        rows = [
            _subtotal(2),
            _note(3, sl_no="A."),
        ]
        _apply_section_header_note_promotion_post_pass(rows)
        self.assertEqual(rows[1].classification, RowClassification.NOTE)
        self.assertIsNone(rows[1].preamble_level_override)

    def test_anchor2_fires_twice_for_two_subtotals(self):
        """Two SUBTOTAL_MARKERs → anchor 2 fires independently for each."""
        rows = [
            _subtotal(2),
            _note(3, description="PART-2 SOMETHING"),
            _subtotal(5),
            _note(6, description="PART-3 SOMETHING"),
        ]
        _apply_section_header_note_promotion_post_pass(rows)
        self.assertEqual(rows[1].classification, RowClassification.PREAMBLE)
        self.assertEqual(rows[1].preamble_level_override, 0)
        self.assertEqual(rows[3].classification, RowClassification.PREAMBLE)
        self.assertEqual(rows[3].preamble_level_override, 0)


# ==================================================================
# Group 3: Toggle tests (2 tests)
# ==================================================================

class TestToggles(unittest.TestCase):

    def test_bug20_promotion_toggle_off_no_promotions(self):
        """BUG_20_SECTION_HEADER_PROMOTION_ENABLED=False: no promotions happen."""
        rows = [
            _spacer(2),
            _note(3, description="PART-1 SECTION"),
            _subtotal(4),
            _note(5, description="PART-2 SECTION"),
        ]
        try:
            classifier_mod.BUG_20_SECTION_HEADER_PROMOTION_ENABLED = False
            _apply_section_header_note_promotion_post_pass(rows)
        finally:
            classifier_mod.BUG_20_SECTION_HEADER_PROMOTION_ENABLED = True
        self.assertEqual(rows[1].classification, RowClassification.NOTE)
        self.assertEqual(rows[3].classification, RowClassification.NOTE)

    def test_bug20_ext_toggle_off_sub_head_stays_level_1(self):
        """BUG_20_EXT_SUB_HEAD_LEVEL_ZERO_ENABLED=False: SUB HEAD rows return level=1."""
        from nirmaan_stack.services.boq_parser.hierarchy import _determine_preamble_level
        cr = ClassifiedRow(
            raw_row=RawRow(row_number=1),
            classification=RowClassification.PREAMBLE,
            sl_no_value="SUB HEAD A",
        )
        try:
            hierarchy_mod.BUG_20_EXT_SUB_HEAD_LEVEL_ZERO_ENABLED = False
            level, warns = _determine_preamble_level(
                classified_row=cr,
                level_1_style="letter",
                stack_depth=0,
                stack_top_index=None,
                classified_rows=[cr],
                raw_row=cr.raw_row,
                sheet_config=_sheet_cfg(),
                approach_a_enabled=False,
                stack=[],
                resolved=[],
            )
        finally:
            hierarchy_mod.BUG_20_EXT_SUB_HEAD_LEVEL_ZERO_ENABLED = True
        self.assertEqual(level, 1)
        self.assertEqual(warns, [])


# ==================================================================
# Group 4: Safron integration tests (3 tests)
# ==================================================================

class TestSafronIntegration(unittest.TestCase):
    """
    Integration tests on safron_hvac_2026-04-11.xlsx "Low Side Works R2 11.4.26".

    Anchor 1 target: first non-SPACER row after header (Excel row 5), containing
    "PART-1 AIR DISTRIBUTION SYSTEM" in the description (column B).
    Anchor 2 target: Excel row 41 "PART- 2 INSULATION" (merged A41:G41;
    Bug 18 blanks B41-G41, so text ends up in sl_no column A).
    Anchor 3 target: Excel row 43 "ACCOUSTIC INSULATION" — NOT promoted this session.
    """

    @classmethod
    def setUpClass(cls):
        if not _SAFRON_FIXTURE.exists():
            cls._skip = True
            return
        cls._skip = False
        cls.resolved = _run_safron_pipeline_with_bug20()

    def setUp(self):
        if self._skip:
            self.skipTest(f"Safron fixture not found: {_SAFRON_FIXTURE}")

    def _find(self, xlsx_row: int):
        return _find_by_xlsx_row(self.resolved, xlsx_row)

    def test_safron_anchor1_promotes_r5_part1_to_preamble_level0(self):
        """
        Excel row 5 is 'PART-1 AIR DISTRIBUTION SYSTEM' — a NOTE with no numeric data,
        the first non-SPACER data row after the true header (r3). Anchor 1 must promote
        it to PREAMBLE level=0.

        Previous test used header_row=5 (copied from Bug 17/18 pattern), which caused
        the parser to treat r5 itself as the header row and exclude it from the data
        stream. Corrected to header_row=3 (actual safron column-title row).
        """
        rr = self._find(5)
        self.assertIsNotNone(rr, "Excel row 5 (PART-1 AIR DISTRIBUTION SYSTEM) not found in resolved output")
        self.assertEqual(
            rr.classified_row.classification, RowClassification.PREAMBLE,
            f"Row 5 must be PREAMBLE after Anchor 1 promotion; got {rr.classified_row.classification}",
        )
        self.assertEqual(rr.level, 0, "Anchor 1 promoted row must have level=0")
        self.assertIsNone(rr.parent_index, "Level-0 section header must have no parent")
        desc = rr.classified_row.sl_no_value or rr.classified_row.description or ""
        self.assertIn(
            "PART-1",
            desc,
            f"Row 5 must carry 'PART-1 AIR DISTRIBUTION SYSTEM' text; got {desc!r}",
        )

    def test_safron_anchor2_r41_promoted_to_preamble_level0(self):
        """
        Excel row 41 ('PART- 2 INSULATION', Bug 18 NOTE) must be promoted to
        PREAMBLE level=0 by Anchor 2 (first non-SPACER after SUBTOTAL_MARKER).
        """
        rr = self._find(_SAFRON_R41_ROW)
        self.assertIsNotNone(rr, f"Row {_SAFRON_R41_ROW} not found in resolved output")
        self.assertEqual(
            rr.classified_row.classification, RowClassification.PREAMBLE,
            f"Row {_SAFRON_R41_ROW} must be PREAMBLE after Bug 20 anchor 2; "
            f"got {rr.classified_row.classification}",
        )
        self.assertEqual(rr.level, 0, f"Row {_SAFRON_R41_ROW} must have level=0")
        self.assertIsNone(rr.parent_index, "Level-0 section header must have no parent")

    def test_safron_anchor3_r43_stays_note_not_promoted(self):
        """
        Excel row 43 ('ACCOUSTIC INSULATION') must stay NOTE — anchor 3 is
        deferred to session 6 and not implemented in this session.
        """
        rr = self._find(_SAFRON_R43_ROW)
        self.assertIsNotNone(rr, f"Row {_SAFRON_R43_ROW} not found in resolved output")
        self.assertEqual(
            rr.classified_row.classification, RowClassification.NOTE,
            f"Row {_SAFRON_R43_ROW} must stay NOTE (anchor 3 deferred to session 6); "
            f"got {rr.classified_row.classification}",
        )


# ==================================================================
# Group 5: BoQ ELV Bug 20-ext integration tests (3 tests)
# ==================================================================

class TestBoqElvBug20Ext(unittest.TestCase):
    """
    Integration tests on Bill of Quantities.xlsx 'ELECTRICAL & ELV BOQ'.
    Bug 20-ext: 21 SUB HEAD rows now at level=0 (was level=1).
    Numeric PREAMBLEs (sl=1.0, 2.0, ...) now parent under the preceding SUB HEAD.

    Fixture: header_row=2 (2-row header), skip_rows={2,3}. First data row is
    Excel row 4 (SUB HEAD A). First numeric PREAMBLE sl='1.0' is at Excel row 6.
    """

    @classmethod
    def setUpClass(cls):
        fixture = _FIXTURES / "Bill of Quantities.xlsx"
        if not fixture.exists():
            cls._skip = True
            return
        cls._skip = False
        cls.resolved = _run_elv_pipeline_with_bug20()

    def setUp(self):
        if self._skip:
            self.skipTest("Bill of Quantities.xlsx fixture not found")

    def _find(self, xlsx_row: int):
        return _find_by_xlsx_row(self.resolved, xlsx_row)

    def test_boq_elv_r4_sub_head_a_at_level_0(self):
        """
        xlsx row 4 sl='SUB HEAD A' -> level=0, parent_index=None.
        Bug 20-ext calibration: was level=1 (sec 9 #100), now level=0 (sec 9 #108).
        """
        rr = self._find(4)
        self.assertIsNotNone(rr, "Row 4 (SUB HEAD A) not found")
        self.assertTrue(
            _is_sub_head_marker((rr.classified_row.sl_no_value or "").strip()),
            f"Row 4 sl_no must match SUB HEAD pattern; got {rr.classified_row.sl_no_value!r}",
        )
        self.assertEqual(rr.level, 0, "SUB HEAD A must be at level=0 after Bug 20-ext")
        self.assertIsNone(rr.parent_index, "Level-0 SUB HEAD must have no parent")

    def test_boq_elv_r6_numeric_preamble_parents_under_sub_head_a(self):
        """
        xlsx row 6 sl='1.0' -> level=1, parent is SUB HEAD A (row 4).
        Bug 20-ext: level-1 PREAMBLEs now inherit level0_ancestor as parent.
        """
        rr = self._find(6)
        self.assertIsNotNone(rr, "Row 6 (sl='1.0') not found")
        self.assertEqual(rr.classified_row.sl_no_value, "1.0", "Row 6 must have sl_no='1.0'")
        self.assertEqual(rr.level, 1, "sl='1.0' must be at level=1")
        self.assertIsNotNone(
            rr.parent_index,
            "sl='1.0' must parent under SUB HEAD A (not rootless) after Bug 20-ext",
        )
        parent_rr = self.resolved[rr.parent_index]
        self.assertTrue(
            _is_sub_head_marker((parent_rr.classified_row.sl_no_value or "").strip()),
            f"Parent of sl='1.0' must be a SUB HEAD; got {parent_rr.classified_row.sl_no_value!r}",
        )

    def test_boq_elv_all_21_sub_head_rows_at_level_0(self):
        """
        Every PREAMBLE matching _is_sub_head_marker has level=0 and parent_index=None.
        Bug 20-ext calibration: was level=1 for all 21 rows (sec 9 #100).
        """
        sub_heads = [
            rr for rr in self.resolved
            if rr.classified_row.classification == RowClassification.PREAMBLE
            and _is_sub_head_marker((rr.classified_row.sl_no_value or "").strip())
        ]
        self.assertGreaterEqual(
            len(sub_heads), 20,
            f"Expected >= 20 SUB HEAD rows, got {len(sub_heads)}",
        )
        for rr in sub_heads:
            row_num = rr.classified_row.raw_row.row_number
            with self.subTest(xlsx_row=row_num, sl=rr.classified_row.sl_no_value):
                self.assertEqual(rr.level, 0)  # Bug 20-ext calibration -- was level=1
                self.assertIsNone(rr.parent_index)


if __name__ == "__main__":
    unittest.main()
