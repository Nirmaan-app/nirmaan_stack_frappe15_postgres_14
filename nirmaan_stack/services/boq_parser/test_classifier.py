# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

import unittest

from nirmaan_stack.services.boq_parser.classifier import (
    ClassifiedRow,
    RowClassification,
    _is_cross_row_sum,
    classify_row,
)
from nirmaan_stack.services.boq_parser.config import (
    ColumnRole,
    GlobalSettings,
    SheetConfig,
)
from nirmaan_stack.services.boq_parser.reader import CellInfo, RawRow


# ------------------------------------------------------------------
# Synthetic row / config helpers
# ------------------------------------------------------------------

def _make_row(row_number: int, cells: dict[str, dict]) -> RawRow:
    """
    Build a RawRow from a plain dict.

    Each key is a column letter; each value is a dict with optional fields:
      value      — cell value (default None)
      formula    — formula string (default None)
      is_formula — bool (default False)
      bold       — font_bold (default False)
      indent     — alignment indent (default 0)
    """
    cell_objs: dict[str, CellInfo] = {}
    for col, props in cells.items():
        cell_objs[col] = CellInfo(
            value=props.get("value"),
            formula=props.get("formula"),
            is_formula=props.get("is_formula", False),
            is_merged_origin=False,
            merged_range=None,
            font_bold=props.get("bold", False),
            fill_color_rgb=None,
            indent=props.get("indent", 0),
        )
    return RawRow(row_number=row_number, cells=cell_objs)


def _basic_sheet_config(
    extra_columns: dict[str, ColumnRole] | None = None,
) -> SheetConfig:
    """
    Standard single-area sheet layout used by most tests:
      A → sl_no, B → description, C → unit,
      D → qty,   E → rate_supply, F → amount_supply
    """
    column_role_map: dict[str, ColumnRole] = {
        "A": ColumnRole(role="sl_no"),
        "B": ColumnRole(role="description"),
        "C": ColumnRole(role="unit"),
        "D": ColumnRole(role="qty"),
        "E": ColumnRole(role="rate_supply"),
        "F": ColumnRole(role="amount_supply"),
    }
    if extra_columns:
        column_role_map.update(extra_columns)
    return SheetConfig(
        sheet_name="Test",
        header_row=1,
        column_role_map=column_role_map,
    )


_GS = GlobalSettings()  # shared default GlobalSettings instance


# ------------------------------------------------------------------
# Tests
# ------------------------------------------------------------------

class TestClassifier(unittest.TestCase):
    """Phase 2b.1a — per-row classifier tests."""

    # ---------------------------------------------------------------- #
    # Test 1 — basic preamble                                            #
    # ---------------------------------------------------------------- #

    def test_basic_preamble(self):
        """sl_no + description, no qty, no rates → PREAMBLE, qty=None."""
        row = _make_row(1, {
            "A": {"value": "1.0"},
            "B": {"value": "Section header"},
        })
        result = classify_row(row, _basic_sheet_config(), _GS)
        self.assertEqual(result.classification, RowClassification.PREAMBLE)
        self.assertEqual(result.sl_no_value, "1.0")
        self.assertEqual(result.description, "Section header")
        self.assertIsNone(result.qty)

    # ---------------------------------------------------------------- #
    # Test 2 — basic line item                                           #
    # ---------------------------------------------------------------- #

    def test_basic_line_item(self):
        """sl_no + description + qty + rate → LINE_ITEM, correct values."""
        row = _make_row(2, {
            "A": {"value": "a."},
            "B": {"value": "First point"},
            "D": {"value": 15.0},
            "E": {"value": 100.0},
        })
        result = classify_row(row, _basic_sheet_config(), _GS)
        self.assertEqual(result.classification, RowClassification.LINE_ITEM)
        self.assertEqual(result.qty, 15.0)
        self.assertEqual(result.rate_supply, 100.0)
        self.assertFalse(result.is_rate_only)

    # ---------------------------------------------------------------- #
    # Test 3 — rate-only marker                                          #
    # ---------------------------------------------------------------- #

    def test_line_item_with_RO_marker(self):
        """Qty cell value 'RO' → qty=0, is_rate_only=True, LINE_ITEM."""
        row = _make_row(3, {
            "A": {"value": "1."},
            "B": {"value": "Cable laying"},
            "D": {"value": "RO"},
            "E": {"value": 250},
        })
        result = classify_row(row, _basic_sheet_config(), _GS)
        self.assertEqual(result.classification, RowClassification.LINE_ITEM)
        self.assertEqual(result.qty, 0.0)
        self.assertTrue(result.is_rate_only)

    # ---------------------------------------------------------------- #
    # Test 4 — blank qty with rate → rate-only line item                 #
    # ---------------------------------------------------------------- #

    def test_line_item_with_blank_qty(self):
        """Qty cell is blank (value=None) but rate is set → qty=0, is_rate_only."""
        row = _make_row(4, {
            "A": {"value": "2."},
            "B": {"value": "Item"},
            "D": {"value": None},  # cell present but blank
            "E": {"value": 100},
        })
        result = classify_row(row, _basic_sheet_config(), _GS)
        self.assertEqual(result.classification, RowClassification.LINE_ITEM)
        self.assertEqual(result.qty, 0.0)
        self.assertTrue(result.is_rate_only)

    # ---------------------------------------------------------------- #
    # Test 5 — note row                                                  #
    # ---------------------------------------------------------------- #

    def test_note_row(self):
        """Description only, no sl_no, no qty, no rates → NOTE."""
        row = _make_row(5, {
            "B": {"value": "Note: All wiring per IS-732"},
        })
        result = classify_row(row, _basic_sheet_config(), _GS)
        self.assertEqual(result.classification, RowClassification.NOTE)

    # ---------------------------------------------------------------- #
    # Test 6 — subtotal via text pattern                                 #
    # ---------------------------------------------------------------- #

    def test_subtotal_carried_over(self):
        """'TOTAL CARRIED OVER' in description column → SUBTOTAL_MARKER."""
        row = _make_row(6, {
            "B": {"value": "TOTAL CARRIED OVER"},
        })
        result = classify_row(row, _basic_sheet_config(), _GS)
        self.assertEqual(result.classification, RowClassification.SUBTOTAL_MARKER)

    # ---------------------------------------------------------------- #
    # Test 7 — subtotal via SUM formula                                  #
    # ---------------------------------------------------------------- #

    def test_subtotal_via_sum_formula(self):
        """Amount column with =SUM( formula → SUBTOTAL_MARKER (formula signal)."""
        config = _basic_sheet_config(extra_columns={"G": ColumnRole(role="amount_total")})
        row = _make_row(7, {
            "A": {"value": "5."},
            "B": {"value": "Works total"},         # does not match text patterns
            "G": {
                "value": None,
                "is_formula": True,
                "formula": "=SUM(F10:F50)",
            },
        })
        result = classify_row(row, config, _GS)
        self.assertEqual(result.classification, RowClassification.SUBTOTAL_MARKER)

    # ---------------------------------------------------------------- #
    # Test 8 — spacer row                                                #
    # ---------------------------------------------------------------- #

    def test_spacer_row(self):
        """Empty cells dict → is_blank() = True → SPACER."""
        row = _make_row(8, {})
        result = classify_row(row, _basic_sheet_config(), _GS)
        self.assertEqual(result.classification, RowClassification.SPACER)

    # ---------------------------------------------------------------- #
    # Test 9 — header repeat                                             #
    # ---------------------------------------------------------------- #

    def test_header_repeat(self):
        """3+ mapped columns containing their role's header keyword → HEADER_REPEAT."""
        row = _make_row(9, {
            "A": {"value": "Sl.No."},
            "B": {"value": "Description"},
            "C": {"value": "Unit"},
            "D": {"value": "Qty"},
        })
        result = classify_row(row, _basic_sheet_config(), _GS)
        self.assertEqual(result.classification, RowClassification.HEADER_REPEAT)

    # ---------------------------------------------------------------- #
    # Test 10 — description_specs concatenation (deferred to 2b.2)      #
    # ---------------------------------------------------------------- #
    # TODO (Phase 2b.2): add 'description_specs' role to config.py and
    # test that description + ' — ' + specs are concatenated here.
    # Skipped for 2b.1a; concatenation logic stub is in classifier.py.

    # ---------------------------------------------------------------- #
    # Test 11 — make_model extracted                                     #
    # ---------------------------------------------------------------- #

    def test_make_model_extracted(self):
        """make_model column value is carried through to ClassifiedRow."""
        config = _basic_sheet_config(extra_columns={"H": ColumnRole(role="make_model")})
        row = _make_row(11, {
            "A": {"value": "3."},
            "B": {"value": "Cable tray"},
            "D": {"value": 5.0},
            "E": {"value": 200.0},
            "H": {"value": "Schneider XYZ-100"},
        })
        result = classify_row(row, config, _GS)
        self.assertEqual(result.classification, RowClassification.LINE_ITEM)
        self.assertEqual(result.make_model, "Schneider XYZ-100")

    # ---------------------------------------------------------------- #
    # Test 12 — row_notes extracted                                      #
    # ---------------------------------------------------------------- #

    def test_row_notes_extracted(self):
        """row_notes column value is carried through to ClassifiedRow."""
        config = _basic_sheet_config(extra_columns={"H": ColumnRole(role="row_notes")})
        row = _make_row(12, {
            "A": {"value": "4."},
            "B": {"value": "Conduit"},
            "D": {"value": 10.0},
            "E": {"value": 50.0},
            "H": {"value": "Coordinate with Civil contractor"},
        })
        result = classify_row(row, config, _GS)
        self.assertEqual(result.classification, RowClassification.LINE_ITEM)
        self.assertEqual(result.row_notes, "Coordinate with Civil contractor")

    # ---------------------------------------------------------------- #
    # Test 13 — unit trailing whitespace stripped                        #
    # ---------------------------------------------------------------- #

    def test_unit_whitespace_stripped(self):
        """Unit cell with trailing spaces → unit is stripped on extraction."""
        row = _make_row(13, {
            "A": {"value": "1."},
            "B": {"value": "Item"},
            "C": {"value": "Nos.   "},
            "D": {"value": 5.0},
        })
        result = classify_row(row, _basic_sheet_config(), _GS)
        self.assertEqual(result.unit, "Nos.")

    # ---------------------------------------------------------------- #
    # Test 14 — unrecognized qty string warns and treats as rate-only    #
    # ---------------------------------------------------------------- #

    def test_unrecognized_qty_string_warns(self):
        """Non-numeric, non-RO qty string → qty=0, is_rate_only, warning emitted."""
        row = _make_row(14, {
            "A": {"value": "1."},
            "B": {"value": "Item"},
            "D": {"value": "TBD"},
            "E": {"value": 100.0},
        })
        result = classify_row(row, _basic_sheet_config(), _GS)
        self.assertEqual(result.classification, RowClassification.LINE_ITEM)
        self.assertEqual(result.qty, 0.0)
        self.assertTrue(result.is_rate_only)
        self.assertGreater(len(result.warnings), 0)

    # ---------------------------------------------------------------- #
    # Additional — spacer with all-None cells                            #
    # ---------------------------------------------------------------- #

    def test_spacer_all_none_cells(self):
        """Row where every cell value is None is still treated as a spacer."""
        row = _make_row(15, {
            "A": {"value": None},
            "B": {"value": None},
            "C": {"value": None},
        })
        result = classify_row(row, _basic_sheet_config(), _GS)
        self.assertEqual(result.classification, RowClassification.SPACER)

    # ---------------------------------------------------------------- #
    # Additional — sl_no numeric value preserved as string               #
    # ---------------------------------------------------------------- #

    def test_sl_no_numeric_preserved_as_string(self):
        """sl_no cell with float value 1.0 is returned as '1.0' (not '1')."""
        row = _make_row(16, {
            "A": {"value": 1.0},
            "B": {"value": "Earthwork"},
        })
        result = classify_row(row, _basic_sheet_config(), _GS)
        self.assertEqual(result.classification, RowClassification.PREAMBLE)
        self.assertEqual(result.sl_no_value, "1.0")

    # ---------------------------------------------------------------- #
    # Additional — subtotal 'Total' alone                                #
    # ---------------------------------------------------------------- #

    def test_subtotal_just_total(self):
        """Description 'Total' (case-insensitive) → SUBTOTAL_MARKER."""
        row = _make_row(17, {
            "B": {"value": "Total"},
        })
        result = classify_row(row, _basic_sheet_config(), _GS)
        self.assertEqual(result.classification, RowClassification.SUBTOTAL_MARKER)

    # ---------------------------------------------------------------- #
    # Additional — rate_only_markers_override                            #
    # ---------------------------------------------------------------- #

    def test_custom_rate_only_marker(self):
        """Custom rate-only marker via sheet_config.rate_only_markers_override."""
        config = _basic_sheet_config()
        config = SheetConfig(
            sheet_name="Test",
            header_row=1,
            column_role_map=config.column_role_map,
            rate_only_markers_override=["QUOTE"],
        )
        row = _make_row(18, {
            "A": {"value": "2."},
            "B": {"value": "HV cable"},
            "D": {"value": "QUOTE"},
            "E": {"value": 500.0},
        })
        result = classify_row(row, config, _GS)
        self.assertEqual(result.classification, RowClassification.LINE_ITEM)
        self.assertEqual(result.qty, 0.0)
        self.assertTrue(result.is_rate_only)


    # ---------------------------------------------------------------- #
    # Test — ghost-note suppression (formula-only row → SPACER)         #
    # ---------------------------------------------------------------- #

    def test_ghost_note_row_with_only_zero_formula_classifies_as_spacer(self):
        """
        Real-world bug: BoQ templates pre-populate amount cells with a
        formula like =N($D17)*N(E17) that evaluates to 0 when qty and rate
        are both blank.  The row is visually empty but raw_row.is_blank()
        returns False because value=0 is not None.  Without the post-
        extraction emptiness guard the row was classified as NOTE (unclear).
        After the fix it must be SPACER since every extracted field is empty.
        (JSW Elect B1 has ~70 such rows.)
        """
        row = _make_row(17, {
            "F": {
                "value": 0,
                "formula": "=+N($D17)*N(E17)",
                "is_formula": True,
            },
        })
        # _basic_sheet_config() already maps F → amount_supply
        result = classify_row(row, _basic_sheet_config(), GlobalSettings())

        self.assertEqual(result.classification, RowClassification.SPACER)
        self.assertIsNone(result.description)
        self.assertIsNone(result.qty)
        self.assertEqual(result.warnings, [])


class TestPreambleCandidateScoring(unittest.TestCase):
    """Tests for populate_preamble_candidate_scores — the Phase 3 wizard data hook."""

    from nirmaan_stack.services.boq_parser.classifier import populate_preamble_candidate_scores

    def _make_note_row(
        self, idx: int, description: str, bold: bool = False
    ) -> ClassifiedRow:
        """Build a NOTE ClassifiedRow with a description cell at column B."""
        cells = {
            "B": CellInfo(
                value=description,
                formula=None,
                is_formula=False,
                is_merged_origin=False,
                merged_range=None,
                font_bold=bold,
                fill_color_rgb=None,
                indent=0,
            ),
        }
        raw_row = RawRow(row_number=idx + 1, cells=cells)
        return ClassifiedRow(
            raw_row=raw_row,
            classification=RowClassification.NOTE,
            sl_no_value=None,
            description=description,
        )

    def _make_line_item_row(self, idx: int, sl_no: str = "a.") -> ClassifiedRow:
        raw_row = RawRow(row_number=idx + 1, cells={})
        return ClassifiedRow(
            raw_row=raw_row,
            classification=RowClassification.LINE_ITEM,
            sl_no_value=sl_no,
            description="Item",
            qty=1.0,
        )

    def _make_preamble_row(self, idx: int, sl_no: str = "1.0") -> ClassifiedRow:
        raw_row = RawRow(row_number=idx + 1, cells={})
        return ClassifiedRow(
            raw_row=raw_row,
            classification=RowClassification.PREAMBLE,
            sl_no_value=sl_no,
            description="Section",
        )

    def _make_spacer_row(self, idx: int) -> ClassifiedRow:
        raw_row = RawRow(row_number=idx + 1, cells={})
        return ClassifiedRow(
            raw_row=raw_row,
            classification=RowClassification.SPACER,
        )

    def _config(self) -> SheetConfig:
        return SheetConfig(
            sheet_name="Test",
            header_row=1,
            column_role_map={
                "A": ColumnRole(role="sl_no"),
                "B": ColumnRole(role="description"),
                "D": ColumnRole(role="qty"),
            },
        )

    def _run(self, rows: list) -> None:
        """Run populate_preamble_candidate_scores in place."""
        from nirmaan_stack.services.boq_parser.classifier import populate_preamble_candidate_scores
        populate_preamble_candidate_scores(rows, self._config())

    # ---------------------------------------------------------------- #
    # Test 1 — bold + short + first-in-block-before-line-item = 5      #
    # ---------------------------------------------------------------- #

    def test_strong_candidate_bold_short_note_before_line_item_scores_5(self):
        """Bold short note immediately preceding a line item block scores 5."""
        rows = [
            self._make_note_row(0, "Central Air Cleaner for AHUs", bold=True),
            self._make_line_item_row(1),
        ]
        self._run(rows)
        self.assertEqual(rows[0].preamble_candidate_score, 5)
        self.assertIn("bold", rows[0].preamble_candidate_signals)
        self.assertIn("precedes_line_item_block", rows[0].preamble_candidate_signals)
        self.assertIn("short_description", rows[0].preamble_candidate_signals)

    # ---------------------------------------------------------------- #
    # Test 2 — first note in block scores high; others score lower     #
    # ---------------------------------------------------------------- #

    def test_first_note_in_block_with_spec_notes_then_line_item(self):
        """
        Block: bold-short header note + two bold-long spec notes + line item.
        Only the first note gets the position bonus. Subsequent bold long notes
        get bold (+2) only.
        """
        long_desc = "A" * 90  # > 80 chars, no short_description signal
        rows = [
            self._make_note_row(0, "Central Air Cleaner for AHUs", bold=True),  # short
            self._make_note_row(1, long_desc, bold=True),
            self._make_note_row(2, long_desc, bold=True),
            self._make_line_item_row(3),
        ]
        self._run(rows)
        self.assertEqual(rows[0].preamble_candidate_score, 5)   # bold+position+short
        self.assertEqual(rows[1].preamble_candidate_score, 2)   # bold only
        self.assertEqual(rows[2].preamble_candidate_score, 2)   # bold only

    # ---------------------------------------------------------------- #
    # Test 3 — Inovalon HVAC row 36 pattern reproduction               #
    # ---------------------------------------------------------------- #

    def test_inovalon_hvac_row_36_pattern(self):
        """
        Reproduction of the real Inovalon HVAC case: bold short note header
        (the section header) followed by several bold long spec notes, then
        line items. First row scores 5; spec notes score 2 each.
        """
        long_desc = "B" * 90
        rows = [
            self._make_note_row(0, "Central Air Cleaner for AHUs", bold=True),
            self._make_note_row(1, long_desc, bold=True),
            self._make_note_row(2, long_desc, bold=True),
            self._make_note_row(3, long_desc, bold=True),
            self._make_note_row(4, long_desc, bold=True),
            self._make_line_item_row(5, "a."),
            self._make_line_item_row(6, "b."),
        ]
        self._run(rows)
        self.assertEqual(rows[0].preamble_candidate_score, 5)
        for i in range(1, 5):
            self.assertEqual(rows[i].preamble_candidate_score, 2,
                             f"Spec note at idx {i} should score 2")
        # Line items are untouched
        self.assertEqual(rows[5].preamble_candidate_score, 0)
        self.assertEqual(rows[6].preamble_candidate_score, 0)

    # ---------------------------------------------------------------- #
    # Test 4 — block terminating at preamble: no position bonus        #
    # ---------------------------------------------------------------- #

    def test_note_block_terminating_at_preamble_no_position_bonus(self):
        """Block followed by preamble (not line item) → no position bonus."""
        rows = [
            self._make_note_row(0, "Short bold note", bold=True),
            self._make_preamble_row(1),
        ]
        self._run(rows)
        # bold (+2) + short (+1) only; no position bonus because next row is preamble
        self.assertEqual(rows[0].preamble_candidate_score, 3)
        self.assertIn("bold", rows[0].preamble_candidate_signals)
        self.assertNotIn("precedes_line_item_block", rows[0].preamble_candidate_signals)
        self.assertIn("short_description", rows[0].preamble_candidate_signals)

    # ---------------------------------------------------------------- #
    # Test 5 — spacers within block are transparent                    #
    # ---------------------------------------------------------------- #

    def test_note_block_with_spacers_between(self):
        """Spacers between notes are part of the block; end detection looks past them."""
        rows = [
            self._make_note_row(0, "Short bold note", bold=True),
            self._make_spacer_row(1),
            self._make_note_row(2, "C" * 90, bold=True),  # long, bold
            self._make_spacer_row(3),
            self._make_line_item_row(4),
        ]
        self._run(rows)
        # First note: bold + position + short = 5
        self.assertEqual(rows[0].preamble_candidate_score, 5)
        # Spacer at idx 1: score stays 0
        self.assertEqual(rows[1].preamble_candidate_score, 0)
        # Second note: bold only = 2 (not first in block)
        self.assertEqual(rows[2].preamble_candidate_score, 2)

    # ---------------------------------------------------------------- #
    # Test 6 — plain non-bold long note scores low                     #
    # ---------------------------------------------------------------- #

    def test_plain_note_in_middle_of_paragraph_scores_low(self):
        """Non-bold long notes: only first-in-block gets position bonus; rest score 0."""
        long_desc = "D" * 90
        rows = [
            self._make_note_row(0, long_desc, bold=False),  # first
            self._make_note_row(1, long_desc, bold=False),  # second
            self._make_line_item_row(2),
        ]
        self._run(rows)
        self.assertEqual(rows[0].preamble_candidate_score, 2)   # position only
        self.assertIn("precedes_line_item_block", rows[0].preamble_candidate_signals)
        self.assertEqual(rows[1].preamble_candidate_score, 0)   # nothing

    # ---------------------------------------------------------------- #
    # Test 7 — short non-bold note before line item scores 3           #
    # ---------------------------------------------------------------- #

    def test_short_non_bold_note_before_line_item_scores_3(self):
        """Non-bold short note before line item: position (2) + short (1) = 3."""
        rows = [
            self._make_note_row(0, "Short note", bold=False),
            self._make_line_item_row(1),
        ]
        self._run(rows)
        self.assertEqual(rows[0].preamble_candidate_score, 3)
        self.assertNotIn("bold", rows[0].preamble_candidate_signals)
        self.assertIn("precedes_line_item_block", rows[0].preamble_candidate_signals)
        self.assertIn("short_description", rows[0].preamble_candidate_signals)

    # ---------------------------------------------------------------- #
    # Test 8 — classify_row alone does NOT populate score              #
    # ---------------------------------------------------------------- #

    def test_classify_row_alone_does_not_populate_score(self):
        """
        Calling classify_row() directly (without populate_preamble_candidate_scores)
        always yields score=0, signals=[]. The scoring is a separate pass.
        """
        row = _make_row(1, {
            "B": {"value": "Short bold header", "font_bold": True},
        })
        config = SheetConfig(
            sheet_name="Test",
            header_row=1,
            column_role_map={
                "A": ColumnRole(role="sl_no"),
                "B": ColumnRole(role="description"),
                "D": ColumnRole(role="qty"),
            },
        )
        classified = classify_row(row, config, GlobalSettings())
        self.assertEqual(classified.classification, RowClassification.NOTE)
        self.assertEqual(classified.preamble_candidate_score, 0)
        self.assertEqual(classified.preamble_candidate_signals, [])


class TestAmountByAreaRaw(unittest.TestCase):
    """Phase 2b.2 Part B1 — amount_by_area_raw field on ClassifiedRow."""

    def _make_area_config(
        self,
        areas: list[str],
        include_qty_areas: bool = False,
    ) -> SheetConfig:
        """
        Build a SheetConfig with amount_by_area columns for each area.

        Columns layout:
          A → sl_no, B → description, C → unit
          D, E, F, ... → amount_by_area for each area in order
          If include_qty_areas: parallel qty columns start after amount cols
        """
        col_map: dict[str, ColumnRole] = {
            "A": ColumnRole(role="sl_no"),
            "B": ColumnRole(role="description"),
            "C": ColumnRole(role="unit"),
        }
        # Amount-by-area columns: D, E, F, ...
        amt_letters = [chr(ord("D") + i) for i in range(len(areas))]
        for letter, area in zip(amt_letters, areas):
            col_map[letter] = ColumnRole(role="amount_by_area", area=area)

        if include_qty_areas:
            # Qty-by-area (role="qty" with area): after amount cols
            qty_letters = [chr(ord("D") + len(areas) + i) for i in range(len(areas))]
            for letter, area in zip(qty_letters, areas):
                col_map[letter] = ColumnRole(role="qty", area=area)

        return SheetConfig(
            sheet_name="Test",
            header_row=1,
            column_role_map=col_map,
            area_dimensions=areas,
        )

    # ---------------------------------------------------------------- #
    # Test 1 — single area amount_by_area_raw captured                  #
    # ---------------------------------------------------------------- #

    def test_amount_by_area_raw_single_area(self):
        """amount_by_area column for one area → amount_by_area_raw has that area's value."""
        config = self._make_area_config(["Block A"])
        row = _make_row(1, {
            "A": {"value": "a."},
            "B": {"value": "Plaster"},
            "C": {"value": "Sqm"},
            "D": {"value": 1500.0},  # amount for Block A
        })
        result = classify_row(row, config, _GS)
        self.assertEqual(result.amount_by_area_raw, {"Block A": 1500.0})

    # ---------------------------------------------------------------- #
    # Test 2 — multiple areas (Pattern 3 shape: 3 areas)                #
    # ---------------------------------------------------------------- #

    def test_amount_by_area_raw_multiple_areas(self):
        """amount_by_area columns for 3 areas → dict keyed by all area names."""
        config = self._make_area_config(["North Wing", "South Wing", "Terrace"])
        row = _make_row(2, {
            "A": {"value": "b."},
            "B": {"value": "Tiling"},
            "C": {"value": "Sqm"},
            "D": {"value": 2000.0},   # North Wing
            "E": {"value": 1800.0},   # South Wing
            "F": {"value": 500.0},    # Terrace
        })
        result = classify_row(row, config, _GS)
        self.assertEqual(result.amount_by_area_raw, {
            "North Wing": 2000.0,
            "South Wing": 1800.0,
            "Terrace": 500.0,
        })

    # ---------------------------------------------------------------- #
    # Test 3 — no amount_by_area ColumnRoles → empty dict               #
    # ---------------------------------------------------------------- #

    def test_amount_by_area_raw_empty_when_not_configured(self):
        """Sheet with no amount_by_area columns → amount_by_area_raw defaults to {}."""
        row = _make_row(3, {
            "A": {"value": "1."},
            "B": {"value": "Earthwork"},
            "D": {"value": 10.0},
            "E": {"value": 500.0},
        })
        result = classify_row(row, _basic_sheet_config(), _GS)
        self.assertEqual(result.amount_by_area_raw, {})

    # ---------------------------------------------------------------- #
    # Test 4 — qty_by_area_raw and amount_by_area_raw populated together #
    # ---------------------------------------------------------------- #

    def test_qty_and_amount_by_area_raw_populated_together(self):
        """Pattern 3 shape: per-area qty cols + per-area amount cols → both dicts populated."""
        areas = ["Zone 1", "Zone 2"]
        config = self._make_area_config(areas, include_qty_areas=True)
        # Columns: D=amount Zone 1, E=amount Zone 2, F=qty Zone 1, G=qty Zone 2
        row = _make_row(4, {
            "A": {"value": "c."},
            "B": {"value": "Electrical conduit"},
            "C": {"value": "Rmt"},
            "D": {"value": 3500.0},  # amount Zone 1
            "E": {"value": 2800.0},  # amount Zone 2
            "F": {"value": 120.0},   # qty Zone 1
            "G": {"value": 95.0},    # qty Zone 2
        })
        result = classify_row(row, config, _GS)
        self.assertEqual(result.amount_by_area_raw, {"Zone 1": 3500.0, "Zone 2": 2800.0})
        self.assertEqual(result.qty_by_area_raw, {"Zone 1": 120.0, "Zone 2": 95.0})

    # ---------------------------------------------------------------- #
    # Test 5 — SPACER row does not get amount_by_area_raw populated     #
    # ---------------------------------------------------------------- #

    def test_non_line_item_rows_do_not_get_amount_by_area_raw(self):
        """
        SPACER rows return early before extraction — amount_by_area_raw stays {}.
        NOTE rows with blank amount cells also produce {}.
        """
        config = self._make_area_config(["Wing A", "Wing B"])
        # SPACER: blank row
        spacer = _make_row(5, {})
        spacer_result = classify_row(spacer, config, _GS)
        self.assertEqual(spacer_result.classification, RowClassification.SPACER)
        self.assertEqual(spacer_result.amount_by_area_raw, {})

        # NOTE: description only, no amount cells
        note = _make_row(6, {"B": {"value": "Note: coordinate with contractor"}})
        note_result = classify_row(note, config, _GS)
        self.assertEqual(note_result.classification, RowClassification.NOTE)
        self.assertEqual(note_result.amount_by_area_raw, {})


class TestPolicyX(unittest.TestCase):
    """Phase 2b.2 Part B2a — §7.25 zero-value Policy X for per-area dicts."""

    def _single_area_config_with_qty_and_amount(self, area: str = "Zone A") -> SheetConfig:
        """Config with one qty-area col (E) and one amount_by_area col (D), plus rate."""
        return SheetConfig(
            sheet_name="Test",
            header_row=1,
            column_role_map={
                "A": ColumnRole(role="sl_no"),
                "B": ColumnRole(role="description"),
                "C": ColumnRole(role="unit"),
                "D": ColumnRole(role="amount_by_area", area=area),
                "E": ColumnRole(role="qty", area=area),
                "F": ColumnRole(role="rate_supply"),
            },
            area_dimensions=[area],
        )

    def _config_with_qty_total(self, area: str = "Zone A") -> SheetConfig:
        """Config with per-area qty col (E), qty_total col (F), amount_by_area col (D)."""
        return SheetConfig(
            sheet_name="Test",
            header_row=1,
            column_role_map={
                "A": ColumnRole(role="sl_no"),
                "B": ColumnRole(role="description"),
                "C": ColumnRole(role="unit"),
                "D": ColumnRole(role="amount_by_area", area=area),
                "E": ColumnRole(role="qty", area=area),
                "F": ColumnRole(role="qty_total"),
            },
            area_dimensions=[area],
        )

    # ---------------------------------------------------------------- #
    # Test 1 — per-area amount cell 0.0 → key present (Policy X)        #
    # ---------------------------------------------------------------- #

    def test_amount_by_area_raw_zero_preserved(self):
        """Explicit 0.0 in amount_by_area col → key present in amount_by_area_raw."""
        config = self._single_area_config_with_qty_and_amount()
        row = _make_row(1, {
            "A": {"value": "a."},
            "B": {"value": "Item"},
            "D": {"value": 0.0},   # explicit zero amount
            "E": {"value": 5.0},
            "F": {"value": 100.0},
        })
        result = classify_row(row, config, _GS)
        self.assertIn("Zone A", result.amount_by_area_raw)
        self.assertEqual(result.amount_by_area_raw["Zone A"], 0.0)

    # ---------------------------------------------------------------- #
    # Test 2 — per-area amount cell empty → key absent                  #
    # ---------------------------------------------------------------- #

    def test_amount_by_area_raw_empty_cell_key_absent(self):
        """Blank/None amount_by_area cell → key absent from amount_by_area_raw."""
        config = self._single_area_config_with_qty_and_amount()
        row = _make_row(2, {
            "A": {"value": "b."},
            "B": {"value": "Item"},
            "D": {"value": None},  # blank amount cell
            "E": {"value": 5.0},
            "F": {"value": 100.0},
        })
        result = classify_row(row, config, _GS)
        self.assertNotIn("Zone A", result.amount_by_area_raw)
        self.assertEqual(result.amount_by_area_raw, {})

    # ---------------------------------------------------------------- #
    # Test 3 — per-area qty cell 0.0 → key present (Policy X)           #
    # ---------------------------------------------------------------- #

    def test_qty_by_area_raw_zero_preserved(self):
        """Explicit 0.0 in per-area qty col → key present in qty_by_area_raw."""
        config = self._single_area_config_with_qty_and_amount()
        row = _make_row(3, {
            "A": {"value": "c."},
            "B": {"value": "Item"},
            "D": {"value": 0.0},   # zero amount
            "E": {"value": 0.0},   # explicit zero qty
            "F": {"value": 100.0}, # rate present → rate-only
        })
        result = classify_row(row, config, _GS)
        self.assertIn("Zone A", result.qty_by_area_raw)
        self.assertEqual(result.qty_by_area_raw["Zone A"], 0.0)

    # ---------------------------------------------------------------- #
    # Test 4 — per-area qty cell empty → key absent                     #
    # ---------------------------------------------------------------- #

    def test_qty_by_area_raw_empty_cell_key_absent(self):
        """Blank/None per-area qty cell → key absent from qty_by_area_raw."""
        config = self._single_area_config_with_qty_and_amount()
        row = _make_row(4, {
            "A": {"value": "d."},
            "B": {"value": "Item"},
            "D": {"value": None},  # blank amount
            "E": {"value": None},  # blank qty cell
        })
        result = classify_row(row, config, _GS)
        self.assertNotIn("Zone A", result.qty_by_area_raw)
        self.assertEqual(result.qty_by_area_raw, {})

    # ---------------------------------------------------------------- #
    # Test 5 — qty_total_raw populated from qty_total column             #
    # ---------------------------------------------------------------- #

    def test_qty_total_raw_populated_when_qty_total_col_present(self):
        """qty_total column with value → qty_total_raw set; blank → None."""
        config = self._config_with_qty_total()
        # With value
        row_with = _make_row(5, {
            "A": {"value": "e."},
            "B": {"value": "Item"},
            "E": {"value": 4.0},   # per-area qty
            "F": {"value": 10.0},  # qty_total column
        })
        result = classify_row(row_with, config, _GS)
        self.assertEqual(result.qty_total_raw, 10.0)

        # Blank qty_total cell
        row_blank = _make_row(6, {
            "A": {"value": "f."},
            "B": {"value": "Item"},
            "E": {"value": 4.0},   # per-area qty
            "F": {"value": None},  # blank qty_total cell
        })
        result_blank = classify_row(row_blank, config, _GS)
        self.assertIsNone(result_blank.qty_total_raw)


class TestUnitBasedDemotion(unittest.TestCase):
    """Phase 2b.2 Part B2d — _apply_unit_based_demotion_post_pass tests."""

    def _run(self, rows: list) -> None:
        from nirmaan_stack.services.boq_parser.classifier import _apply_unit_based_demotion_post_pass
        _apply_unit_based_demotion_post_pass(rows)

    def _make_preamble(self, idx: int, unit=None, qty=None) -> ClassifiedRow:
        raw_row = RawRow(row_number=idx + 1, cells={})
        return ClassifiedRow(
            raw_row=raw_row,
            classification=RowClassification.PREAMBLE,
            sl_no_value="1.",
            description="Section header",
            unit=unit,
            qty=qty,
        )

    def _make_line_item(self, idx: int, unit: str = "Nos.") -> ClassifiedRow:
        raw_row = RawRow(row_number=idx + 1, cells={})
        return ClassifiedRow(
            raw_row=raw_row,
            classification=RowClassification.LINE_ITEM,
            sl_no_value="a.",
            description="Item",
            unit=unit,
            qty=5.0,
        )

    def _make_note(self, idx: int, unit: str = "Nos.") -> ClassifiedRow:
        raw_row = RawRow(row_number=idx + 1, cells={})
        return ClassifiedRow(
            raw_row=raw_row,
            classification=RowClassification.NOTE,
            description="Note text",
            unit=unit,
        )

    # ---------------------------------------------------------------- #
    # Test 1 — blank-qty preamble with matching unit is demoted         #
    # ---------------------------------------------------------------- #

    def test_blank_qty_preamble_with_matching_unit_demoted(self):
        """PREAMBLE with qty=None and unit='Nos.' matching a LINE_ITEM → LINE_ITEM."""
        rows = [
            self._make_preamble(0, unit="Nos."),
            self._make_line_item(1, unit="Nos."),
        ]
        self._run(rows)
        self.assertEqual(rows[0].classification, RowClassification.LINE_ITEM)
        self.assertEqual(rows[0].qty, 0.0)
        self.assertTrue(rows[0].is_rate_only)

    # ---------------------------------------------------------------- #
    # Test 2 — RM unit variant demoted                                  #
    # ---------------------------------------------------------------- #

    def test_rm_unit_variant_demoted(self):
        """PREAMBLE with unit='Rmt' matching a LINE_ITEM unit → demoted."""
        rows = [
            self._make_preamble(0, unit="Rmt"),
            self._make_line_item(1, unit="Rmt"),
        ]
        self._run(rows)
        self.assertEqual(rows[0].classification, RowClassification.LINE_ITEM)
        self.assertEqual(rows[0].qty, 0.0)
        self.assertTrue(rows[0].is_rate_only)

    # ---------------------------------------------------------------- #
    # Test 3 — unique unit stays PREAMBLE                               #
    # ---------------------------------------------------------------- #

    def test_unique_unit_stays_preamble(self):
        """PREAMBLE with unit='kg' when no LINE_ITEM has 'kg' → stays PREAMBLE."""
        rows = [
            self._make_preamble(0, unit="kg"),
            self._make_line_item(1, unit="Nos."),
        ]
        self._run(rows)
        self.assertEqual(rows[0].classification, RowClassification.PREAMBLE)
        self.assertIsNone(rows[0].qty)

    # ---------------------------------------------------------------- #
    # Test 4 — None unit stays PREAMBLE                                 #
    # ---------------------------------------------------------------- #

    def test_empty_unit_stays_preamble(self):
        """PREAMBLE with unit=None → no unit to match → stays PREAMBLE."""
        rows = [
            self._make_preamble(0, unit=None),
            self._make_line_item(1, unit="Nos."),
        ]
        self._run(rows)
        self.assertEqual(rows[0].classification, RowClassification.PREAMBLE)

    # ---------------------------------------------------------------- #
    # Test 5 — LINE_ITEM rows untouched                                 #
    # ---------------------------------------------------------------- #

    def test_line_item_unchanged(self):
        """LINE_ITEM rows are not affected — only PREAMBLE rows are demotion targets."""
        rows = [
            self._make_line_item(0, unit="Nos."),
            self._make_line_item(1, unit="Rmt"),
        ]
        self._run(rows)
        self.assertEqual(rows[0].classification, RowClassification.LINE_ITEM)
        self.assertEqual(rows[1].classification, RowClassification.LINE_ITEM)

    # ---------------------------------------------------------------- #
    # Test 6 — PREAMBLE with qty present is not a demotion target       #
    # ---------------------------------------------------------------- #

    def test_preamble_with_qty_present_unchanged(self):
        """PREAMBLE with qty=5.0 (has a qty value) → condition qty is None fails → unchanged."""
        rows = [
            self._make_preamble(0, unit="Nos.", qty=5.0),
            self._make_line_item(1, unit="Nos."),
        ]
        self._run(rows)
        self.assertEqual(rows[0].classification, RowClassification.PREAMBLE)
        self.assertEqual(rows[0].qty, 5.0)

    # ---------------------------------------------------------------- #
    # Test 7 — NOTE row is not a demotion target                        #
    # ---------------------------------------------------------------- #

    def test_note_unit_does_not_trigger_demotion(self):
        """NOTE rows with a matching unit are not examined as demotion targets."""
        rows = [
            self._make_note(0, unit="Nos."),
            self._make_line_item(1, unit="Nos."),
        ]
        self._run(rows)
        self.assertEqual(rows[0].classification, RowClassification.NOTE)

    # ---------------------------------------------------------------- #
    # Test 8 — case-sensitive match                                     #
    # ---------------------------------------------------------------- #

    def test_case_sensitive_comparison(self):
        """Unit match is case-sensitive: PREAMBLE unit='nos.' != LINE_ITEM unit='Nos.' → no demotion."""
        rows = [
            self._make_preamble(0, unit="nos."),
            self._make_line_item(1, unit="Nos."),
        ]
        self._run(rows)
        self.assertEqual(rows[0].classification, RowClassification.PREAMBLE)

    # ---------------------------------------------------------------- #
    # Test 9 — smoke: no-op on synthetic_simple.xlsx                    #
    # ---------------------------------------------------------------- #

    def test_smoke_no_demotion_on_synthetic_simple(self):
        """
        synthetic_simple.xlsx has no blank-qty PREAMBLE rows with units
        matching LINE_ITEMs — the pass is a no-op and PREAMBLE count stays 0.
        """
        from pathlib import Path
        from nirmaan_stack.services.boq_parser.tests.fixtures.generate_synthetic import generate_all
        from nirmaan_stack.services.boq_parser.orchestrator import parse_boq
        from nirmaan_stack.services.boq_parser.config import (
            ColumnRole, MappingConfig, MasterBoqMetadata, SheetConfig,
        )

        generate_all()
        fixture = str(Path(__file__).parent / "tests" / "fixtures" / "synthetic_simple.xlsx")
        config = MappingConfig(
            project="test",
            master_boq=MasterBoqMetadata(boq_name="test_boq"),
            sheets=[SheetConfig(
                sheet_name="Sheet1",
                header_row=1,
                column_role_map={
                    "A": ColumnRole(role="sl_no"),
                    "B": ColumnRole(role="description"),
                    "C": ColumnRole(role="unit"),
                    "D": ColumnRole(role="qty"),
                    "E": ColumnRole(role="rate_supply"),
                    "F": ColumnRole(role="amount_supply"),
                },
            )],
        )
        result = parse_boq(fixture, config)
        preamble_count = sum(
            1 for rr in result.sheets[0].resolved_rows
            if rr.classified_row.classification == RowClassification.PREAMBLE
        )
        self.assertEqual(preamble_count, 0)


class TestHeaderKwExpansionPhase2c(unittest.TestCase):
    """Phase 2c §9 #48 — _HEADER_KW expanded from 5 to 14 role keys."""

    # ---------------------------------------------------------------- #
    # Test 1 — new rate_combined key detected                           #
    # ---------------------------------------------------------------- #

    def test_header_repeat_via_new_rate_combined_keys(self):
        """'SITC Rate' in rate_combined col + sl_no + description → HEADER_REPEAT."""
        config = SheetConfig(
            sheet_name="Test",
            header_row=1,
            column_role_map={
                "A": ColumnRole(role="sl_no"),
                "B": ColumnRole(role="description"),
                "C": ColumnRole(role="rate_combined"),
            },
        )
        row = _make_row(1, {
            "A": {"value": "sl.no"},
            "B": {"value": "description"},
            "C": {"value": "sitc rate"},
        })
        result = classify_row(row, config, _GS)
        self.assertEqual(result.classification, RowClassification.HEADER_REPEAT)

    # ---------------------------------------------------------------- #
    # Test 2 — amount_supply / amount_install split detected            #
    # ---------------------------------------------------------------- #

    def test_header_repeat_via_amount_supply_install_split(self):
        """4 header matches (sl_no, desc, supply amount, install amount) → HEADER_REPEAT."""
        config = SheetConfig(
            sheet_name="Test",
            header_row=1,
            column_role_map={
                "A": ColumnRole(role="sl_no"),
                "B": ColumnRole(role="description"),
                "C": ColumnRole(role="amount_supply"),
                "D": ColumnRole(role="amount_install"),
            },
        )
        row = _make_row(1, {
            "A": {"value": "Sl. No."},
            "B": {"value": "Description"},
            "C": {"value": "Supply Amount"},
            "D": {"value": "Installation Amount"},
        })
        result = classify_row(row, config, _GS)
        self.assertEqual(result.classification, RowClassification.HEADER_REPEAT)

    # ---------------------------------------------------------------- #
    # Test 3 — SITC Amount synonym for amount_combined                  #
    # ---------------------------------------------------------------- #

    def test_sitc_amount_synonym_matches_amount_combined(self):
        """'SITC Amount' in amount_combined col triggers HEADER_REPEAT."""
        config = SheetConfig(
            sheet_name="Test",
            header_row=1,
            column_role_map={
                "A": ColumnRole(role="sl_no"),
                "B": ColumnRole(role="description"),
                "C": ColumnRole(role="amount_combined"),
            },
        )
        row = _make_row(1, {
            "A": {"value": "Sl. No."},
            "B": {"value": "Description"},
            "C": {"value": "SITC Amount"},
        })
        result = classify_row(row, config, _GS)
        self.assertEqual(result.classification, RowClassification.HEADER_REPEAT)

    # ---------------------------------------------------------------- #
    # Test 4 — make_model keyword recognized                            #
    # ---------------------------------------------------------------- #

    def test_make_model_header_keyword_recognized(self):
        """'Make' in make_model col + sl_no + description → HEADER_REPEAT."""
        config = SheetConfig(
            sheet_name="Test",
            header_row=1,
            column_role_map={
                "A": ColumnRole(role="sl_no"),
                "B": ColumnRole(role="description"),
                "C": ColumnRole(role="make_model"),
            },
        )
        row = _make_row(1, {
            "A": {"value": "Sl. No."},
            "B": {"value": "Description"},
            "C": {"value": "Make"},
        })
        result = classify_row(row, config, _GS)
        self.assertEqual(result.classification, RowClassification.HEADER_REPEAT)

    # ---------------------------------------------------------------- #
    # Test 5 — row_notes keyword recognized                             #
    # ---------------------------------------------------------------- #

    def test_row_notes_header_keyword_recognized(self):
        """'Remarks' in row_notes col + sl_no + description → HEADER_REPEAT."""
        config = SheetConfig(
            sheet_name="Test",
            header_row=1,
            column_role_map={
                "A": ColumnRole(role="sl_no"),
                "B": ColumnRole(role="description"),
                "C": ColumnRole(role="row_notes"),
            },
        )
        row = _make_row(1, {
            "A": {"value": "Sl. No."},
            "B": {"value": "Description"},
            "C": {"value": "Remarks"},
        })
        result = classify_row(row, config, _GS)
        self.assertEqual(result.classification, RowClassification.HEADER_REPEAT)

    # ---------------------------------------------------------------- #
    # Test 6 — case insensitivity smoke                                 #
    # ---------------------------------------------------------------- #

    def test_case_insensitivity_smoke(self):
        """All-UPPERCASE header values still trigger HEADER_REPEAT via case folding."""
        config = SheetConfig(
            sheet_name="Test",
            header_row=1,
            column_role_map={
                "A": ColumnRole(role="sl_no"),
                "B": ColumnRole(role="description"),
                "C": ColumnRole(role="rate_combined"),
            },
        )
        row = _make_row(1, {
            "A": {"value": "SL.NO"},
            "B": {"value": "DESCRIPTION"},
            "C": {"value": "SITC RATE"},
        })
        result = classify_row(row, config, _GS)
        self.assertEqual(result.classification, RowClassification.HEADER_REPEAT)

    # ---------------------------------------------------------------- #
    # Test 7 — data row does NOT falsely trigger HEADER_REPEAT          #
    # ---------------------------------------------------------------- #

    def test_new_synonyms_do_not_falsely_trigger_on_data_row(self):
        """Numeric data values in new-role columns → NOT HEADER_REPEAT."""
        config = SheetConfig(
            sheet_name="Test",
            header_row=1,
            column_role_map={
                "A": ColumnRole(role="sl_no"),
                "B": ColumnRole(role="description"),
                "C": ColumnRole(role="qty"),
                "D": ColumnRole(role="rate_combined"),
            },
        )
        row = _make_row(2, {
            "A": {"value": "1.1"},
            "B": {"value": "Carpet flooring item"},
            "C": {"value": "100"},
            "D": {"value": "150.50"},
        })
        result = classify_row(row, config, _GS)
        self.assertNotEqual(result.classification, RowClassification.HEADER_REPEAT)

    # ---------------------------------------------------------------- #
    # Test 8 — UOM recognized for unit role                             #
    # ---------------------------------------------------------------- #

    def test_uom_recognized_for_unit_role(self):
        """'UOM' in unit col + sl_no + description → HEADER_REPEAT."""
        row = _make_row(1, {
            "A": {"value": "Sl. No."},
            "B": {"value": "Description"},
            "C": {"value": "UOM"},
        })
        result = classify_row(row, _basic_sheet_config(), _GS)
        self.assertEqual(result.classification, RowClassification.HEADER_REPEAT)

    # ---------------------------------------------------------------- #
    # Test 9 — 'particulars' synonym for description role               #
    # ---------------------------------------------------------------- #

    def test_particulars_synonym_for_description_role(self):
        """'Particulars' in description col triggers HEADER_REPEAT."""
        row = _make_row(1, {
            "A": {"value": "Sl.No."},
            "B": {"value": "Particulars"},
            "C": {"value": "Unit"},
            "D": {"value": "Qty"},
        })
        result = classify_row(row, _basic_sheet_config(), _GS)
        self.assertEqual(result.classification, RowClassification.HEADER_REPEAT)

    # ---------------------------------------------------------------- #
    # Test 10 — 'BOQ Qty' synonym for qty role                          #
    # ---------------------------------------------------------------- #

    def test_boq_qty_synonym_for_qty_role(self):
        """'BOQ Qty' in qty col triggers HEADER_REPEAT (new synonym)."""
        row = _make_row(1, {
            "A": {"value": "Sl.No."},
            "B": {"value": "Description"},
            "C": {"value": "Unit"},
            "D": {"value": "BOQ Qty"},
        })
        result = classify_row(row, _basic_sheet_config(), _GS)
        self.assertEqual(result.classification, RowClassification.HEADER_REPEAT)


class TestPhase1_9kModeBAndF(unittest.TestCase):
    """Phase 1.9k — Mode B vocabulary additions + Mode F trailing-punctuation normalization."""

    # ---------------------------------------------------------------- #
    # Test 1 — QNT classifies as qty                                    #
    # ---------------------------------------------------------------- #

    def test_qnt_classifies_as_qty(self):
        """'QNT' header in qty col → HEADER_REPEAT (Paytm HVAC target 5)."""
        row = _make_row(1, {
            "A": {"value": "SL NO"},
            "B": {"value": "Description"},
            "C": {"value": "Unit"},
            "D": {"value": "QNT"},
        })
        result = classify_row(row, _basic_sheet_config(), _GS)
        self.assertEqual(result.classification, RowClassification.HEADER_REPEAT)

    # ---------------------------------------------------------------- #
    # Test 2 — QNT. (trailing period) classifies as qty                 #
    # ---------------------------------------------------------------- #

    def test_qnt_with_trailing_period_classifies_as_qty(self):
        """'QNT.' (trailing period) in qty col → HEADER_REPEAT via qnt. keyword."""
        row = _make_row(1, {
            "A": {"value": "SL NO"},
            "B": {"value": "Description"},
            "C": {"value": "Unit"},
            "D": {"value": "QNT."},
        })
        result = classify_row(row, _basic_sheet_config(), _GS)
        self.assertEqual(result.classification, RowClassification.HEADER_REPEAT)

    # ---------------------------------------------------------------- #
    # Test 3 — UM classifies as unit                                    #
    # ---------------------------------------------------------------- #

    def test_um_classifies_as_unit(self):
        """'UM' header in unit col → HEADER_REPEAT (Kohler HVAC target 11)."""
        row = _make_row(1, {
            "A": {"value": "SL NO"},
            "B": {"value": "Description"},
            "C": {"value": "UM"},
            "D": {"value": "Qty"},
        })
        result = classify_row(row, _basic_sheet_config(), _GS)
        self.assertEqual(result.classification, RowClassification.HEADER_REPEAT)

    # ---------------------------------------------------------------- #
    # Test 4 — Sl No. (trailing period) classifies as sl_no via Mode F  #
    # ---------------------------------------------------------------- #

    def test_sl_no_with_trailing_period_classifies_as_sl_no(self):
        """'Sl No.' → rstrip('.') → 'sl no' → matches 'sl no' keyword → HEADER_REPEAT."""
        row = _make_row(1, {
            "A": {"value": "Sl No."},
            "B": {"value": "Description"},
            "C": {"value": "Unit"},
            "D": {"value": "Qty"},
        })
        result = classify_row(row, _basic_sheet_config(), _GS)
        self.assertEqual(result.classification, RowClassification.HEADER_REPEAT)

    # ---------------------------------------------------------------- #
    # Test 5 — SL NO. (trailing period, uppercase) classifies as sl_no  #
    # ---------------------------------------------------------------- #

    def test_sl_no_uppercase_with_trailing_period_classifies_as_sl_no(self):
        """'SL NO.' → rstrip('.') → 'sl no' → HEADER_REPEAT (audit rollup freq=4)."""
        row = _make_row(1, {
            "A": {"value": "SL NO."},
            "B": {"value": "Description"},
            "C": {"value": "Unit"},
            "D": {"value": "Qty"},
        })
        result = classify_row(row, _basic_sheet_config(), _GS)
        self.assertEqual(result.classification, RowClassification.HEADER_REPEAT)

    # ---------------------------------------------------------------- #
    # Test 6 — Qty. (trailing period) classifies as qty via Mode F      #
    # ---------------------------------------------------------------- #

    def test_qty_with_trailing_period_classifies_as_qty(self):
        """'Qty.' → rstrip('.') → 'qty' → HEADER_REPEAT (Mode F normalization)."""
        row = _make_row(1, {
            "A": {"value": "SL NO"},
            "B": {"value": "Description"},
            "C": {"value": "Unit"},
            "D": {"value": "Qty."},
        })
        result = classify_row(row, _basic_sheet_config(), _GS)
        self.assertEqual(result.classification, RowClassification.HEADER_REPEAT)

    # ---------------------------------------------------------------- #
    # Test 7 — No's classifies as qty                                   #
    # ---------------------------------------------------------------- #

    def test_nos_apostrophe_classifies_as_qty(self):
        """\"No's\" in qty col → HEADER_REPEAT (nos-variant from audit top-200)."""
        row = _make_row(1, {
            "A": {"value": "SL NO"},
            "B": {"value": "Description"},
            "C": {"value": "Unit"},
            "D": {"value": "No's"},
        })
        result = classify_row(row, _basic_sheet_config(), _GS)
        self.assertEqual(result.classification, RowClassification.HEADER_REPEAT)

    # ---------------------------------------------------------------- #
    # Test 8 — sq.ft classifies as unit                                 #
    # ---------------------------------------------------------------- #

    def test_sq_ft_classifies_as_unit(self):
        """'Sq.ft' in unit col → HEADER_REPEAT (freq=91 in audit output)."""
        row = _make_row(1, {
            "A": {"value": "SL NO"},
            "B": {"value": "Description"},
            "C": {"value": "Sq.ft"},
            "D": {"value": "Qty"},
        })
        result = classify_row(row, _basic_sheet_config(), _GS)
        self.assertEqual(result.classification, RowClassification.HEADER_REPEAT)

    # ---------------------------------------------------------------- #
    # Test 9 — rmt classifies as unit                                   #
    # ---------------------------------------------------------------- #

    def test_rmt_classifies_as_unit(self):
        """'Rmt' (running meter) in unit col → HEADER_REPEAT (freq=27)."""
        row = _make_row(1, {
            "A": {"value": "SL NO"},
            "B": {"value": "Description"},
            "C": {"value": "Rmt"},
            "D": {"value": "Qty"},
        })
        result = classify_row(row, _basic_sheet_config(), _GS)
        self.assertEqual(result.classification, RowClassification.HEADER_REPEAT)

    # ---------------------------------------------------------------- #
    # Test 10 — each classifies as unit                                 #
    # ---------------------------------------------------------------- #

    def test_each_classifies_as_unit(self):
        """'Each' in unit col → HEADER_REPEAT (freq=12 in audit output)."""
        row = _make_row(1, {
            "A": {"value": "SL NO"},
            "B": {"value": "Description"},
            "C": {"value": "Each"},
            "D": {"value": "Qty"},
        })
        result = classify_row(row, _basic_sheet_config(), _GS)
        self.assertEqual(result.classification, RowClassification.HEADER_REPEAT)


class TestRateByAreaRaw(unittest.TestCase):
    """Phase 1.9a — rate_by_area_raw field on ClassifiedRow."""

    def _rate_area_config(self, areas: list[str]) -> SheetConfig:
        """Config with per-area qty + rate_combined_by_area columns for each area."""
        col_map: dict[str, ColumnRole] = {
            "A": ColumnRole(role="sl_no"),
            "B": ColumnRole(role="description"),
        }
        # Per-area qty and rate columns: C/D for first area, E/F for second, etc.
        for i, area in enumerate(areas):
            qty_col = chr(ord("C") + i * 2)
            rate_col = chr(ord("D") + i * 2)
            col_map[qty_col] = ColumnRole(role="qty", area=area)
            col_map[rate_col] = ColumnRole(role="rate_combined_by_area", area=area)
        return SheetConfig(
            sheet_name="Test",
            header_row=1,
            column_role_map=col_map,
            area_dimensions=areas,
        )

    # ---------------------------------------------------------------- #
    # Test 1 — rate_combined_by_area populated                          #
    # ---------------------------------------------------------------- #

    def test_rate_by_area_raw_populated_when_role_mapped(self):
        """rate_combined_by_area column with value 100.0 → rate_by_area_raw={'B1': {'combined_rate': 100.0}}."""
        config = self._rate_area_config(["B1"])
        row = _make_row(1, {
            "A": {"value": "1."},
            "B": {"value": "Item"},
            "C": {"value": 10.0},   # qty, area=B1
            "D": {"value": 100.0},  # rate_combined_by_area, area=B1
        })
        result = classify_row(row, config, _GS)
        self.assertEqual(result.rate_by_area_raw, {"B1": {"combined_rate": 100.0}})

    # ---------------------------------------------------------------- #
    # Test 2 — Policy X: explicit 0.0 preserved                        #
    # ---------------------------------------------------------------- #

    def test_rate_by_area_raw_policy_x_zero_preservation(self):
        """Explicit 0.0 in rate_combined_by_area cell → preserved in rate_by_area_raw (Policy X)."""
        config = self._rate_area_config(["B1"])
        row = _make_row(1, {
            "A": {"value": "1."},
            "B": {"value": "Item"},
            "C": {"value": 10.0},
            "D": {"value": 0.0},  # explicit zero rate
        })
        result = classify_row(row, config, _GS)
        self.assertEqual(result.rate_by_area_raw, {"B1": {"combined_rate": 0.0}})

    # ---------------------------------------------------------------- #
    # Test 3 — not populated when no per-area-rate role mapped          #
    # ---------------------------------------------------------------- #

    def test_rate_by_area_raw_not_populated_when_role_not_mapped(self):
        """SheetConfig with no per-area-rate columns → rate_by_area_raw remains {}."""
        row = _make_row(1, {
            "A": {"value": "1."},
            "B": {"value": "Item"},
            "D": {"value": 10.0},
            "E": {"value": 100.0},
        })
        result = classify_row(row, _basic_sheet_config(), _GS)
        self.assertEqual(result.rate_by_area_raw, {})


class TestAppendNotesRaw(unittest.TestCase):
    """Phase 1.9b — append_notes_raw field on ClassifiedRow."""

    def _append_config(
        self,
        cols: dict[str, str],  # col_letter → header_label
    ) -> SheetConfig:
        """
        Build a SheetConfig with the given columns mapped to append_to_notes.
        cols maps column letter → human header label stored in column_headers.
        Standard base columns A=sl_no, B=description, D=qty are always present.
        """
        col_map: dict[str, ColumnRole] = {
            "A": ColumnRole(role="sl_no"),
            "B": ColumnRole(role="description"),
            "D": ColumnRole(role="qty"),
        }
        for col_letter in cols:
            col_map[col_letter] = ColumnRole(role="append_to_notes")
        return SheetConfig(
            sheet_name="Test",
            header_row=1,
            column_role_map=col_map,
            column_headers=cols,
        )

    # ---------------------------------------------------------------- #
    # Test 1 — single column populated                                   #
    # ---------------------------------------------------------------- #

    def test_append_notes_raw_populated_single_column(self):
        """Single append_to_notes column (D=Floor) with value → key present in append_notes_raw."""
        config = self._append_config({"G": "Floor"})
        row = _make_row(1, {
            "A": {"value": "1."},
            "B": {"value": "Wall plastering"},
            "D": {"value": 50.0},
            "G": {"value": "Ground Floor"},
        })
        result = classify_row(row, config, _GS)
        self.assertEqual(result.append_notes_raw, {"Floor": "Ground Floor"})

    # ---------------------------------------------------------------- #
    # Test 2 — multiple columns populated                                #
    # ---------------------------------------------------------------- #

    def test_append_notes_raw_populated_multiple_columns(self):
        """Three append_to_notes columns all populated → all three keys in append_notes_raw."""
        config = self._append_config({"G": "Floor", "H": "Area", "I": "Workitem"})
        row = _make_row(2, {
            "A": {"value": "a."},
            "B": {"value": "Electrical conduit"},
            "D": {"value": 10.0},
            "G": {"value": "Ground Floor"},
            "H": {"value": "Lobby"},
            "I": {"value": "Wall plastering 12mm thick"},
        })
        result = classify_row(row, config, _GS)
        self.assertEqual(result.append_notes_raw, {
            "Floor": "Ground Floor",
            "Area": "Lobby",
            "Workitem": "Wall plastering 12mm thick",
        })

    # ---------------------------------------------------------------- #
    # Test 3 — empty cell produces no key                               #
    # ---------------------------------------------------------------- #

    def test_append_notes_raw_empty_cell_produces_no_key(self):
        """append_to_notes column with None or empty-string cell → no key in append_notes_raw."""
        config = self._append_config({"G": "Floor"})

        # None cell value
        row_none = _make_row(3, {
            "A": {"value": "1."},
            "B": {"value": "Item"},
            "D": {"value": 5.0},
            "G": {"value": None},
        })
        result_none = classify_row(row_none, config, _GS)
        self.assertEqual(result_none.append_notes_raw, {})

        # Empty string cell value
        row_empty = _make_row(4, {
            "A": {"value": "1."},
            "B": {"value": "Item"},
            "D": {"value": 5.0},
            "G": {"value": "   "},
        })
        result_empty = classify_row(row_empty, config, _GS)
        self.assertEqual(result_empty.append_notes_raw, {})

    # ---------------------------------------------------------------- #
    # Test 4 — non-string value coerced to string                       #
    # ---------------------------------------------------------------- #

    def test_append_notes_raw_coerces_non_string_values_to_string(self):
        """Float cell value in append_to_notes column → str() coercion applied."""
        config = self._append_config({"G": "HSN Code"})
        row = _make_row(5, {
            "A": {"value": "2."},
            "B": {"value": "Cable tray"},
            "D": {"value": 5.0},
            "G": {"value": 1234.0},  # numeric HSN code stored as float
        })
        result = classify_row(row, config, _GS)
        self.assertEqual(result.append_notes_raw, {"HSN Code": str(1234.0)})

    # ---------------------------------------------------------------- #
    # Test 5 — no append_to_notes column mapped → empty dict            #
    # ---------------------------------------------------------------- #

    def test_append_notes_raw_empty_when_no_role_mapped(self):
        """SheetConfig with no append_to_notes columns → append_notes_raw == {}."""
        row = _make_row(6, {
            "A": {"value": "3."},
            "B": {"value": "Earthwork"},
            "D": {"value": 20.0},
            "E": {"value": 500.0},
        })
        result = classify_row(row, _basic_sheet_config(), _GS)
        self.assertEqual(result.append_notes_raw, {})


# ================================================================ #
# Phase 1.9l Mode D --- HEADER_REPEAT spot-checks                  #
# ================================================================ #

class TestPhase1_9lModeDPrecedence(unittest.TestCase):
    """
    Phase 1.9l Mode D spot-checks at the classify_row HEADER_REPEAT level.

    Role assignment (the Mode D fix) is in _auto_guess.py and tested fully
    in test_auto_guess.TestPhase1_9lModeDPrecedence. These 2 tests are
    complementary guards: they verify the HEADER_REPEAT checker in
    classify_row() correctly detects compound-role header keywords once
    a column carries the right role (as auto_guess now correctly assigns).
    """

    def test_supply_rate_header_in_rate_supply_col_triggers_header_repeat(self):
        """'Supply Rate' in rate_supply column contributes to HEADER_REPEAT count (3+ threshold met)."""
        config = SheetConfig(
            sheet_name="Test",
            header_row=1,
            column_role_map={
                "A": ColumnRole(role="sl_no"),
                "B": ColumnRole(role="description"),
                "C": ColumnRole(role="rate_supply"),
            },
        )
        row = _make_row(1, {
            "A": {"value": "Sl. No."},
            "B": {"value": "Description"},
            "C": {"value": "Supply Rate"},
        })
        result = classify_row(row, config, _GS)
        self.assertEqual(result.classification, RowClassification.HEADER_REPEAT)

    def test_install_rate_header_in_rate_install_col_triggers_header_repeat(self):
        """'Install Rate' in rate_install column contributes to HEADER_REPEAT count (3+ threshold met)."""
        config = SheetConfig(
            sheet_name="Test",
            header_row=1,
            column_role_map={
                "A": ColumnRole(role="sl_no"),
                "B": ColumnRole(role="description"),
                "C": ColumnRole(role="rate_install"),
            },
        )
        row = _make_row(1, {
            "A": {"value": "Sl. No."},
            "B": {"value": "Description"},
            "C": {"value": "Install Rate"},
        })
        result = classify_row(row, config, _GS)
        self.assertEqual(result.classification, RowClassification.HEADER_REPEAT)


class TestPhase1_9pAppendToNotesKeywords(unittest.TestCase):
    """
    Phase 1.9p --- HEADER_REPEAT recognition for append_to_notes keyword family.

    9 positive tests confirm each new keyword triggers HEADER_REPEAT when the
    column is mapped to append_to_notes. 2 negative regression tests confirm that
    the compound keywords 'DSR Rate' and 'NDSR Rate' continue to attribute to
    rate_supply / rate_install respectively (longest-match-wins from 1.9l preserved
    at the role-keyword-lookup level).
    """

    def _config_with_append_col(self) -> SheetConfig:
        return SheetConfig(
            sheet_name="Test",
            header_row=1,
            column_role_map={
                "A": ColumnRole(role="sl_no"),
                "B": ColumnRole(role="description"),
                "C": ColumnRole(role="append_to_notes"),
            },
        )

    # ---------------------------------------------------------------- #
    # Test 1 --- Ref No                                                  #
    # ---------------------------------------------------------------- #

    def test_ref_no_recognized(self):
        """'Ref No' in append_to_notes col → HEADER_REPEAT."""
        row = _make_row(1, {
            "A": {"value": "Sl No"},
            "B": {"value": "Description"},
            "C": {"value": "Ref No"},
        })
        result = classify_row(row, self._config_with_append_col(), _GS)
        self.assertEqual(result.classification, RowClassification.HEADER_REPEAT)

    # ---------------------------------------------------------------- #
    # Test 2 --- Refno (no space)                                        #
    # ---------------------------------------------------------------- #

    def test_refno_no_space_recognized(self):
        """'Refno' (no space) in append_to_notes col → HEADER_REPEAT."""
        row = _make_row(1, {
            "A": {"value": "Sl No"},
            "B": {"value": "Description"},
            "C": {"value": "Refno"},
        })
        result = classify_row(row, self._config_with_append_col(), _GS)
        self.assertEqual(result.classification, RowClassification.HEADER_REPEAT)

    # ---------------------------------------------------------------- #
    # Test 3 --- Ref No. (trailing period, via Mode F rstrip path)       #
    # ---------------------------------------------------------------- #

    def test_ref_no_with_period_recognized(self):
        """'Ref No.' → rstrip('.:') → 'ref no' → matches 'ref no' keyword → HEADER_REPEAT."""
        row = _make_row(1, {
            "A": {"value": "Sl No"},
            "B": {"value": "Description"},
            "C": {"value": "Ref No."},
        })
        result = classify_row(row, self._config_with_append_col(), _GS)
        self.assertEqual(result.classification, RowClassification.HEADER_REPEAT)

    # ---------------------------------------------------------------- #
    # Test 4 --- Reference                                               #
    # ---------------------------------------------------------------- #

    def test_reference_recognized(self):
        """'Reference' in append_to_notes col → HEADER_REPEAT."""
        row = _make_row(1, {
            "A": {"value": "Sl No"},
            "B": {"value": "Description"},
            "C": {"value": "Reference"},
        })
        result = classify_row(row, self._config_with_append_col(), _GS)
        self.assertEqual(result.classification, RowClassification.HEADER_REPEAT)

    # ---------------------------------------------------------------- #
    # Test 5 --- Ref Code                                                #
    # ---------------------------------------------------------------- #

    def test_ref_code_recognized(self):
        """'Ref Code' in append_to_notes col → HEADER_REPEAT."""
        row = _make_row(1, {
            "A": {"value": "Sl No"},
            "B": {"value": "Description"},
            "C": {"value": "Ref Code"},
        })
        result = classify_row(row, self._config_with_append_col(), _GS)
        self.assertEqual(result.classification, RowClassification.HEADER_REPEAT)

    # ---------------------------------------------------------------- #
    # Test 6 --- DSR                                                     #
    # ---------------------------------------------------------------- #

    def test_dsr_recognized(self):
        """'DSR' in append_to_notes col → HEADER_REPEAT."""
        row = _make_row(1, {
            "A": {"value": "Sl No"},
            "B": {"value": "Description"},
            "C": {"value": "DSR"},
        })
        result = classify_row(row, self._config_with_append_col(), _GS)
        self.assertEqual(result.classification, RowClassification.HEADER_REPEAT)

    # ---------------------------------------------------------------- #
    # Test 7 --- NDSR                                                    #
    # ---------------------------------------------------------------- #

    def test_ndsr_recognized(self):
        """'NDSR' in append_to_notes col → HEADER_REPEAT."""
        row = _make_row(1, {
            "A": {"value": "Sl No"},
            "B": {"value": "Description"},
            "C": {"value": "NDSR"},
        })
        result = classify_row(row, self._config_with_append_col(), _GS)
        self.assertEqual(result.classification, RowClassification.HEADER_REPEAT)

    # ---------------------------------------------------------------- #
    # Test 8 --- Code                                                    #
    # ---------------------------------------------------------------- #

    def test_code_recognized(self):
        """'Code' in append_to_notes col → HEADER_REPEAT."""
        row = _make_row(1, {
            "A": {"value": "Sl No"},
            "B": {"value": "Description"},
            "C": {"value": "Code"},
        })
        result = classify_row(row, self._config_with_append_col(), _GS)
        self.assertEqual(result.classification, RowClassification.HEADER_REPEAT)

    # ---------------------------------------------------------------- #
    # Test 9 --- Item Code                                               #
    # ---------------------------------------------------------------- #

    def test_item_code_recognized(self):
        """'Item Code' in append_to_notes col → HEADER_REPEAT."""
        row = _make_row(1, {
            "A": {"value": "Sl No"},
            "B": {"value": "Description"},
            "C": {"value": "Item Code"},
        })
        result = classify_row(row, self._config_with_append_col(), _GS)
        self.assertEqual(result.classification, RowClassification.HEADER_REPEAT)

    # ---------------------------------------------------------------- #
    # Test 10 --- DSR Rate stays rate_supply (negative regression)       #
    # ---------------------------------------------------------------- #

    def test_dsr_rate_still_classified_as_rate_supply(self):
        """'DSR Rate' in rate_supply col → HEADER_REPEAT (rate_supply keywords, not append_to_notes)."""
        config = SheetConfig(
            sheet_name="Test",
            header_row=1,
            column_role_map={
                "A": ColumnRole(role="sl_no"),
                "B": ColumnRole(role="description"),
                "C": ColumnRole(role="rate_supply"),
            },
        )
        row = _make_row(1, {
            "A": {"value": "Sl. No."},
            "B": {"value": "Description"},
            "C": {"value": "DSR Rate"},
        })
        result = classify_row(row, config, _GS)
        self.assertEqual(result.classification, RowClassification.HEADER_REPEAT)

    # ---------------------------------------------------------------- #
    # Test 11 --- NDSR Rate stays rate_install (negative regression)     #
    # ---------------------------------------------------------------- #

    def test_ndsr_rate_still_classified_as_rate_install(self):
        """'NDSR Rate' in rate_install col → HEADER_REPEAT (rate_install keywords, not append_to_notes)."""
        config = SheetConfig(
            sheet_name="Test",
            header_row=1,
            column_role_map={
                "A": ColumnRole(role="sl_no"),
                "B": ColumnRole(role="description"),
                "C": ColumnRole(role="rate_install"),
            },
        )
        row = _make_row(1, {
            "A": {"value": "Sl. No."},
            "B": {"value": "Description"},
            "C": {"value": "NDSR Rate"},
        })
        result = classify_row(row, config, _GS)
        self.assertEqual(result.classification, RowClassification.HEADER_REPEAT)


class TestBug6ConvenienceFieldSummation(unittest.TestCase):
    """
    Bug 6 (sec 9 #84) - convenience field summation cascade for cr.amount_total
    and cr.rate_combined when "total" column is blank.

    Column layout used throughout:
      A=sl_no, B=description, C=unit, D=qty,
      E=rate_supply, F=rate_install, G=rate_combined,
      H=amount_supply, I=amount_install, J=amount_total
    """

    def _cascade_config(
        self,
        has_amount_total_col: bool = True,
        areas: list[str] | None = None,
    ) -> SheetConfig:
        """Config with supply/install/total amount columns and optional per-area amounts."""
        col_map: dict[str, ColumnRole] = {
            "A": ColumnRole(role="sl_no"),
            "B": ColumnRole(role="description"),
            "C": ColumnRole(role="unit"),
            "D": ColumnRole(role="qty"),
            "E": ColumnRole(role="rate_supply"),
            "F": ColumnRole(role="rate_install"),
            "G": ColumnRole(role="rate_combined"),
            "H": ColumnRole(role="amount_supply"),
            "I": ColumnRole(role="amount_install"),
        }
        if has_amount_total_col:
            col_map["J"] = ColumnRole(role="amount_total")
        if areas:
            for idx, area in enumerate(areas):
                col_map[chr(ord("K") + idx)] = ColumnRole(role="amount_by_area", area=area)
        return SheetConfig(
            sheet_name="Test",
            header_row=1,
            column_role_map=col_map,
            area_dimensions=areas or [],
        )

    # ---------------------------------------------------------------- #
    # Test 1 - amount_total_raw column wins over supply+install        #
    # ---------------------------------------------------------------- #

    def test_amount_total_raw_column_wins(self):
        """Priority 1: amount_total column value wins over supply+install sum."""
        config = self._cascade_config(has_amount_total_col=True)
        row = _make_row(1, {
            "A": {"value": "1."},
            "B": {"value": "Item"},
            "D": {"value": 2.0},
            "H": {"value": 40.0},
            "I": {"value": 50.0},
            "J": {"value": 100.0},  # column value = 100, supply+install = 90
        })
        result = classify_row(row, config, _GS)
        self.assertEqual(result.amount_total, 100.0)   # column wins
        self.assertEqual(result.amount_total_raw, 100.0)
        self.assertEqual(result.warnings, [])

    # ---------------------------------------------------------------- #
    # Test 2 - supply+install sums when amount_total column blank      #
    # ---------------------------------------------------------------- #

    def test_supply_install_sum_when_total_blank(self):
        """Priority 2: supply + install = 90.0 when amount_total column blank."""
        config = self._cascade_config(has_amount_total_col=True)
        row = _make_row(2, {
            "A": {"value": "1."},
            "B": {"value": "Item"},
            "D": {"value": 2.0},
            "H": {"value": 40.0},
            "I": {"value": 50.0},
            "J": {"value": None},  # blank
        })
        result = classify_row(row, config, _GS)
        self.assertEqual(result.amount_total, 90.0)
        self.assertIsNone(result.amount_total_raw)
        self.assertEqual(result.warnings, [])

    # ---------------------------------------------------------------- #
    # Test 3 - supply+install fires when no amount_total column at all #
    # ---------------------------------------------------------------- #

    def test_supply_install_sum_when_no_total_column(self):
        """Priority 2: works when amount_total column is absent from column_role_map."""
        config = self._cascade_config(has_amount_total_col=False)
        row = _make_row(3, {
            "A": {"value": "1."},
            "B": {"value": "Item"},
            "D": {"value": 2.0},
            "H": {"value": 40.0},
            "I": {"value": 50.0},
        })
        result = classify_row(row, config, _GS)
        self.assertEqual(result.amount_total, 90.0)
        self.assertIsNone(result.amount_total_raw)
        self.assertEqual(result.warnings, [])

    # ---------------------------------------------------------------- #
    # Test 4 - per-area sums when supply+install absent                #
    # ---------------------------------------------------------------- #

    def test_per_area_sum_when_supply_install_absent(self):
        """Priority 3: sum(amount_by_area_raw) when supply+install both None."""
        config = self._cascade_config(has_amount_total_col=False, areas=["A", "B"])
        row = _make_row(4, {
            "A": {"value": "1."},
            "B": {"value": "Item"},
            "K": {"value": 30.0},   # area A
            "L": {"value": 60.0},   # area B
        })
        result = classify_row(row, config, _GS)
        self.assertEqual(result.amount_total, 90.0)
        self.assertIsNone(result.amount_total_raw)
        self.assertEqual(result.warnings, [])

    # ---------------------------------------------------------------- #
    # Test 5 - partial supply only falls through to per-area           #
    # ---------------------------------------------------------------- #

    def test_supply_only_partial_falls_through_to_per_area(self):
        """Supply non-None but install None: Priority 2 does not fire; Priority 3 fires."""
        config = self._cascade_config(has_amount_total_col=False, areas=["A", "B"])
        row = _make_row(5, {
            "A": {"value": "1."},
            "B": {"value": "Item"},
            "H": {"value": 40.0},   # supply present
            # I (install) absent
            "K": {"value": 30.0},   # area A
            "L": {"value": 60.0},   # area B
        })
        result = classify_row(row, config, _GS)
        self.assertEqual(result.amount_total, 90.0)  # per-area sum wins (Priority 3)
        self.assertEqual(result.warnings, [])

    # ---------------------------------------------------------------- #
    # Test 6 - partial install only falls through to per-area          #
    # ---------------------------------------------------------------- #

    def test_install_only_partial_falls_through_to_per_area(self):
        """Install non-None but supply None: Priority 2 does not fire; Priority 3 fires."""
        config = self._cascade_config(has_amount_total_col=False, areas=["A", "B"])
        row = _make_row(6, {
            "A": {"value": "1."},
            "B": {"value": "Item"},
            # H (supply) absent
            "I": {"value": 50.0},   # install present
            "K": {"value": 30.0},   # area A
            "L": {"value": 60.0},   # area B
        })
        result = classify_row(row, config, _GS)
        self.assertEqual(result.amount_total, 90.0)  # per-area sum wins (Priority 3)
        self.assertEqual(result.warnings, [])

    # ---------------------------------------------------------------- #
    # Test 7 - all sources blank -> amount_total is None               #
    # ---------------------------------------------------------------- #

    def test_all_sources_blank_amount_total_is_none(self):
        """All three sources absent/blank: cr.amount_total stays None."""
        config = self._cascade_config(has_amount_total_col=True)
        row = _make_row(7, {
            "A": {"value": "1."},
            "B": {"value": "Item"},
            "D": {"value": 2.0},
            "E": {"value": 100.0},
            "J": {"value": None},  # blank amount_total
            # H and I absent (no supply/install)
        })
        result = classify_row(row, config, _GS)
        self.assertIsNone(result.amount_total)
        self.assertIsNone(result.amount_total_raw)
        self.assertEqual(result.warnings, [])

    # ---------------------------------------------------------------- #
    # Test 8 - warning fires when supply+install disagrees with per-area#
    # ---------------------------------------------------------------- #

    def test_warning_fires_when_supply_install_disagrees_with_per_area(self):
        """supply+install=90, per_area_sum=100, diff=10 > 1.0 -> warning emitted."""
        config = self._cascade_config(has_amount_total_col=False, areas=["A", "B"])
        row = _make_row(8, {
            "A": {"value": "1."},
            "B": {"value": "Item"},
            "H": {"value": 40.0},   # supply
            "I": {"value": 50.0},   # install -> supply+install = 90
            "K": {"value": 30.0},   # area A
            "L": {"value": 70.0},   # area B -> per_area_sum = 100
        })
        result = classify_row(row, config, _GS)
        self.assertEqual(result.amount_total, 90.0)  # supply+install wins per Q3
        self.assertEqual(len(result.warnings), 1)
        self.assertIn("amount_total mismatch", result.warnings[0])
        self.assertIn("supply+install=90.0", result.warnings[0])
        self.assertIn("per_area_sum=100.0", result.warnings[0])

    # ---------------------------------------------------------------- #
    # Test 9 - no warning when within tolerance (diff <= 1.0)          #
    # ---------------------------------------------------------------- #

    def test_no_warning_within_tolerance(self):
        """supply+install=90.0, per_area_sum=89.5, diff=0.5 <= 1.0 -> no warning."""
        config = self._cascade_config(has_amount_total_col=False, areas=["A", "B"])
        row = _make_row(9, {
            "A": {"value": "1."},
            "B": {"value": "Item"},
            "H": {"value": 40.0},
            "I": {"value": 50.0},   # supply+install = 90.0
            "K": {"value": 30.5},   # area A
            "L": {"value": 59.0},   # area B -> per_area_sum = 89.5
        })
        result = classify_row(row, config, _GS)
        self.assertEqual(result.amount_total, 90.0)
        self.assertEqual(result.warnings, [])

    # ---------------------------------------------------------------- #
    # Test 10 - rate_combined column wins (Priority 1)                 #
    # ---------------------------------------------------------------- #

    def test_rate_combined_column_wins(self):
        """rate_combined column non-None: column value used, no fallback."""
        config = self._cascade_config()
        row = _make_row(10, {
            "A": {"value": "1."},
            "B": {"value": "Item"},
            "D": {"value": 2.0},
            "E": {"value": 40.0},   # rate_supply
            "F": {"value": 50.0},   # rate_install
            "G": {"value": 100.0},  # rate_combined column (col wins over 40+50=90)
        })
        result = classify_row(row, config, _GS)
        self.assertEqual(result.rate_combined, 100.0)

    # ---------------------------------------------------------------- #
    # Test 11 - rate_combined falls back to supply+install when blank  #
    # ---------------------------------------------------------------- #

    def test_rate_combined_fallback_to_supply_plus_install(self):
        """rate_combined column blank: falls back to rate_supply + rate_install."""
        config = self._cascade_config()
        row = _make_row(11, {
            "A": {"value": "1."},
            "B": {"value": "Item"},
            "D": {"value": 2.0},
            "E": {"value": 40.0},   # rate_supply
            "F": {"value": 50.0},   # rate_install
            "G": {"value": None},   # rate_combined blank
        })
        result = classify_row(row, config, _GS)
        self.assertEqual(result.rate_combined, 90.0)

    # ---------------------------------------------------------------- #
    # Test 12 - rate_combined None when only supply present            #
    # ---------------------------------------------------------------- #

    def test_rate_combined_none_when_install_absent(self):
        """rate_combined blank, rate_install None: fallback does NOT fire."""
        config = self._cascade_config()
        row = _make_row(12, {
            "A": {"value": "1."},
            "B": {"value": "Item"},
            "D": {"value": 2.0},
            "E": {"value": 40.0},   # rate_supply
            # F (rate_install) absent
            "G": {"value": None},   # rate_combined blank
        })
        result = classify_row(row, config, _GS)
        self.assertIsNone(result.rate_combined)

    # ---------------------------------------------------------------- #
    # Test 13 - rate_combined fallback contributes to has_nonzero_rate #
    # ---------------------------------------------------------------- #

    def test_rate_combined_fallback_triggers_rate_only_for_blank_qty(self):
        """Derived rate_combined contributes to has_nonzero_rate -> blank qty = rate-only."""
        config = self._cascade_config(has_amount_total_col=False)
        row = _make_row(13, {
            "A": {"value": "1."},
            "B": {"value": "Item"},
            "D": {"value": None},   # blank qty
            "E": {"value": 40.0},   # rate_supply
            "F": {"value": 50.0},   # rate_install
            # G (rate_combined) absent
        })
        result = classify_row(row, config, _GS)
        self.assertEqual(result.classification, RowClassification.LINE_ITEM)
        self.assertEqual(result.qty, 0.0)
        self.assertTrue(result.is_rate_only)
        self.assertEqual(result.rate_combined, 90.0)



# -----------------------------------------------------------------------
# Bug 9 (sec 9 #86) — amount_combined ColumnRole extraction fallback
# -----------------------------------------------------------------------

class TestBug9AmountCombinedExtraction(unittest.TestCase):
    """
    Bug 9 (sec 9 #86): amount_combined ColumnRole had no extraction path in classify_row().
    Any column mapped as amount_combined was silently dropped (cr.amount_total always None).

    Fix: OR-fallback in Bug 6 cascade Priority 1 step:
      amount_total_raw = _cell_float("amount_total")
      if amount_total_raw is None:
          amount_total_raw = _cell_float("amount_combined")  # Bug 9

    Column layout used throughout:
      A=sl_no, B=description, C=unit, D=qty,
      [E=rate_supply, F=rate_install optional],
      [H=amount_supply, I=amount_install optional],
      J=amount_combined  (the test subject)
    """

    def _config_with_combined(
        self,
        has_supply_install: bool = False,
        areas: list[str] | None = None,
    ) -> SheetConfig:
        """Config with amount_combined as the total-amount column."""
        col_map: dict[str, ColumnRole] = {
            "A": ColumnRole(role="sl_no"),
            "B": ColumnRole(role="description"),
            "C": ColumnRole(role="unit"),
            "D": ColumnRole(role="qty"),
        }
        if has_supply_install:
            col_map["H"] = ColumnRole(role="amount_supply")
            col_map["I"] = ColumnRole(role="amount_install")
        col_map["J"] = ColumnRole(role="amount_combined")
        if areas:
            for idx, area in enumerate(areas):
                col_map[chr(ord("K") + idx)] = ColumnRole(role="amount_by_area", area=area)
        return SheetConfig(
            sheet_name="Test",
            header_row=1,
            column_role_map=col_map,
            area_dimensions=areas or [],
        )

    # B9-1: amount_combined column alone populates cr.amount_total

    def test_amount_combined_populates_amount_total(self):
        """B9-1: Sheet has only amount_combined column (no supply/install). cr.amount_total = J."""
        config = self._config_with_combined()
        row = _make_row(2, {
            "A": {"value": "1"},
            "B": {"value": "Supply and install of SITC works"},
            "C": {"value": "LS"},
            "D": {"value": 1.0},
            "J": {"value": 100.0},  # amount_combined
        })
        result = classify_row(row, config, _GS)
        self.assertEqual(result.classification, RowClassification.LINE_ITEM)
        self.assertEqual(result.amount_total, 100.0,
            "amount_combined value must propagate to cr.amount_total via Bug 9 fallback")
        self.assertEqual(result.amount_total_raw, 100.0,
            "amount_total_raw must equal the amount_combined cell value")

    # B9-2: amount_combined wins over supply+install (Priority 1 > Priority 2)

    def test_amount_combined_wins_over_supply_install(self):
        """B9-2: J=amount_combined=100 present alongside H=supply=40 I=install=50 → total=100."""
        config = self._config_with_combined(has_supply_install=True)
        row = _make_row(2, {
            "A": {"value": "1"},
            "B": {"value": "SITC item"},
            "C": {"value": "LS"},
            "D": {"value": 1.0},
            "H": {"value": 40.0},   # amount_supply
            "I": {"value": 50.0},   # amount_install
            "J": {"value": 100.0},  # amount_combined — wins as Priority 1
        })
        result = classify_row(row, config, _GS)
        self.assertEqual(result.amount_total, 100.0,
            "amount_combined (P1) must win over supply+install sum (P2) when non-None")
        self.assertEqual(result.amount_total_raw, 100.0)

    # B9-3: blank amount_combined falls through to supply+install (P2)

    def test_blank_amount_combined_falls_to_supply_install(self):
        """B9-3: J=None, H=40, I=50 → cr.amount_total=90 via P2; amount_total_raw=None."""
        config = self._config_with_combined(has_supply_install=True)
        row = _make_row(2, {
            "A": {"value": "1"},
            "B": {"value": "SITC item"},
            "C": {"value": "LS"},
            "D": {"value": 1.0},
            "H": {"value": 40.0},
            "I": {"value": 50.0},
            # J absent → amount_combined cell is None
        })
        result = classify_row(row, config, _GS)
        self.assertEqual(result.amount_total, 90.0,
            "When amount_combined is blank, P2 supply+install fallback must fire")
        self.assertIsNone(result.amount_total_raw,
            "amount_total_raw must be None when amount_combined cell is blank")

    # B9-4: blank amount_combined falls through to per-area sum (P3)

    def test_blank_amount_combined_falls_to_per_area(self):
        """B9-4: J=None, no supply/install, per-area A=30 B=60 → cr.amount_total=90 via P3."""
        config = self._config_with_combined(areas=["AreaA", "AreaB"])
        row = _make_row(2, {
            "A": {"value": "1"},
            "B": {"value": "SITC item"},
            "C": {"value": "LS"},
            "D": {"value": 1.0},
            "K": {"value": 30.0},   # amount_by_area AreaA
            "L": {"value": 60.0},   # amount_by_area AreaB
            # J absent
        })
        result = classify_row(row, config, _GS)
        self.assertEqual(result.amount_total, 90.0,
            "When amount_combined and supply+install both blank, P3 per-area sum must fire")
        self.assertIsNone(result.amount_total_raw)

    # B9-5: SheetConfig with amount_combined role validates OK

    def test_amount_combined_sheetconfig_validates_ok(self):
        """B9-5: A SheetConfig with amount_combined ColumnRole must not raise ValidationError.

        SheetConfig uses @model_validator(mode='after') — validation fires on construction.
        We verify by re-constructing from the config's model data; no ValidationError expected.
        """
        config = self._config_with_combined()
        try:
            SheetConfig(**config.model_dump())
        except Exception as exc:
            self.fail(f"SheetConfig with amount_combined raised unexpectedly: {exc!r}")


# ================================================================ #
# Bug 10 (sec 9 #86) -- _is_cross_row_sum() unit tests             #
# ================================================================ #

class TestBug10CrossRowSum(unittest.TestCase):
    """
    Bug 10 (sec 9 #86) -- unit tests for _is_cross_row_sum() helper.

    Returns False for same-row inline aggregations (e.g. =SUM(K20:L20) on row 20)
    and True for genuine cross-row subtotal SUM formulas (or unparseable formulas).
    """

    # -- same-row cases (expect False) --

    def test_same_row_single_cell(self):
        """=SUM(K20) on row 20 -- single-cell, same row -- False."""
        self.assertFalse(_is_cross_row_sum("=SUM(K20)", 20))

    def test_same_row_range(self):
        """=SUM(K20:L20) on row 20 -- same-row range -- False (VRF System pattern)."""
        self.assertFalse(_is_cross_row_sum("=SUM(K20:L20)", 20))

    def test_same_row_range_absolute_refs(self):
        """=SUM($K$20:$L$20) with absolute $ refs on row 20 -- same-row -- False."""
        self.assertFalse(_is_cross_row_sum("=SUM($K$20:$L$20)", 20))

    def test_multi_range_all_same_row(self):
        """=SUM(K20:L20,M20) -- both operands on row 20 -- False."""
        self.assertFalse(_is_cross_row_sum("=SUM(K20:L20,M20)", 20))

    def test_leading_plus_form(self):
        """+=SUM(K20:L20) -- leading + stripped before parse -- False."""
        self.assertFalse(_is_cross_row_sum("+=SUM(K20:L20)", 20))

    def test_lowercase_sum(self):
        """=sum(K20:L20) -- lowercase SUM token -- case-insensitive parse -- False."""
        self.assertFalse(_is_cross_row_sum("=sum(K20:L20)", 20))

    # -- cross-row cases (expect True) --

    def test_cross_row_range(self):
        """=SUM(B5:B49) on row 50 -- range spans rows 5-49, not row 50 -- True."""
        self.assertTrue(_is_cross_row_sum("=SUM(B5:B49)", 50))

    def test_current_row_is_endpoint_of_range(self):
        """=SUM(B5:B49) on row 49 -- row 5 differs from current_row=49 -- True."""
        self.assertTrue(_is_cross_row_sum("=SUM(B5:B49)", 49))

    def test_mixed_same_and_cross_row(self):
        """=SUM(K20:L20,M5:M19) on row 20 -- M5:M19 is cross-row -- True."""
        self.assertTrue(_is_cross_row_sum("=SUM(K20:L20,M5:M19)", 20))

    # -- conservative/unparseable cases (expect True) --

    def test_named_range_conservative(self):
        """=SUM(MyRange) -- cannot extract row number -- conservative True."""
        self.assertTrue(_is_cross_row_sum("=SUM(MyRange)", 20))

    def test_cross_sheet_conservative(self):
        """=SUM(Sheet1!A1:A10) -- sheet qualifier -- conservative True."""
        self.assertTrue(_is_cross_row_sum("=SUM(Sheet1!A1:A10)", 20))

    def test_empty_sum(self):
        """=SUM() -- empty inside -- conservative True."""
        self.assertTrue(_is_cross_row_sum("=SUM()", 20))

    def test_non_sum_formula_conservative(self):
        """=A1+B1 -- not a SUM formula -- conservative True."""
        self.assertTrue(_is_cross_row_sum("=A1+B1", 20))


# ================================================================ #
# Bug 10 (sec 9 #86) -- classify_row() gating integration tests    #
# ================================================================ #

class TestBug10ClassifyRowGating(unittest.TestCase):
    """
    Bug 10 (sec 9 #86) -- classify_row() integration tests verifying that the
    _is_cross_row_sum() gate is correctly wired into the FORMULA-path SUBTOTAL_MARKER
    check. Text-regex path is verified to remain untouched.
    """

    def _config_with_amount_total(self) -> SheetConfig:
        """A=sl_no, B=desc, C=unit, D=qty, E=amount_supply, F=amount_install, G=amount_total."""
        return SheetConfig(
            sheet_name="Test",
            header_row=1,
            column_role_map={
                "A": ColumnRole(role="sl_no"),
                "B": ColumnRole(role="description"),
                "C": ColumnRole(role="unit"),
                "D": ColumnRole(role="qty"),
                "E": ColumnRole(role="amount_supply"),
                "F": ColumnRole(role="amount_install"),
                "G": ColumnRole(role="amount_total"),
            },
        )

    def test_same_row_sum_in_amount_col_is_not_subtotal(self):
        """
        Row 20 with amount_total col G formula =SUM(E20:F20) -- same-row --
        must NOT classify as SUBTOTAL_MARKER after Bug 10 fix.
        With qty=1.0, row classifies as LINE_ITEM.
        """
        config = self._config_with_amount_total()
        row = _make_row(20, {
            "A": {"value": "1.1"},
            "B": {"value": "VRF Unit 5TR"},
            "C": {"value": "Sets"},
            "D": {"value": 1.0},
            "E": {"value": 152400.0},
            "F": {"value": 6000.0},
            "G": {"value": 158400.0, "formula": "=SUM(E20:F20)", "is_formula": True},
        })
        result = classify_row(row, config, _GS)
        self.assertNotEqual(
            result.classification, RowClassification.SUBTOTAL_MARKER,
            "Same-row =SUM() must NOT be SUBTOTAL_MARKER after Bug 10 fix",
        )
        self.assertEqual(
            result.classification, RowClassification.LINE_ITEM,
            "Row with qty=1.0 and same-row SUM must be LINE_ITEM",
        )

    def test_cross_row_sum_in_amount_col_is_still_subtotal(self):
        """
        Row 50 with amount_total col G formula =SUM(G12:G49) -- cross-row --
        must still classify as SUBTOTAL_MARKER (existing behaviour preserved).
        """
        config = self._config_with_amount_total()
        row = _make_row(50, {
            "B": {"value": "Subtotal A"},
            "G": {"value": 500000.0, "formula": "=SUM(G12:G49)", "is_formula": True},
        })
        result = classify_row(row, config, _GS)
        self.assertEqual(
            result.classification, RowClassification.SUBTOTAL_MARKER,
            "Cross-row =SUM() must still classify as SUBTOTAL_MARKER",
        )

    def test_text_regex_path_overrides_same_row_sum(self):
        """
        Row whose description matches 'Grand Total' → text-regex fires first →
        SUBTOTAL_MARKER even when the amount column carries a same-row =SUM().
        Verifies the text-regex path is byte-identical and untouched by Bug 10.
        """
        config = self._config_with_amount_total()
        row = _make_row(20, {
            "B": {"value": "Grand Total"},
            "D": {"value": 1.0},
            "G": {"value": 158400.0, "formula": "=SUM(E20:F20)", "is_formula": True},
        })
        result = classify_row(row, config, _GS)
        self.assertEqual(
            result.classification, RowClassification.SUBTOTAL_MARKER,
            "Text-regex SUBTOTAL pattern must still fire when description matches",
        )


if __name__ == "__main__":
    unittest.main()
