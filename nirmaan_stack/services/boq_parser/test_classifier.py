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


if __name__ == "__main__":
    unittest.main()
