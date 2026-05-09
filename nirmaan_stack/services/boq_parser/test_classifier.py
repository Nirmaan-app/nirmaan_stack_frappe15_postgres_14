# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

import unittest

from nirmaan_stack.services.boq_parser.classifier import (
    ClassifiedRow,
    RowClassification,
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


if __name__ == "__main__":
    unittest.main()
