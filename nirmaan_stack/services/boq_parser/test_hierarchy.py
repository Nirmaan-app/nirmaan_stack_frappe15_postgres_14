# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

import unittest

from nirmaan_stack.services.boq_parser.classifier import ClassifiedRow, RowClassification
from nirmaan_stack.services.boq_parser.config import ColumnRole, GlobalSettings, SheetConfig
from nirmaan_stack.services.boq_parser.hierarchy import ResolvedSheet, resolve_hierarchy
from nirmaan_stack.services.boq_parser.reader import CellInfo, RawRow


# ------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------

def _make_preamble(idx: int, sl_no: str, description: str = "Section") -> ClassifiedRow:
    raw_row = RawRow(row_number=idx + 1, cells={})
    return ClassifiedRow(
        raw_row=raw_row,
        classification=RowClassification.PREAMBLE,
        sl_no_value=sl_no,
        description=description,
    )


def _make_line_item(idx: int, sl_no: str = "a.", qty: float = 1.0) -> ClassifiedRow:
    raw_row = RawRow(row_number=idx + 1, cells={})
    return ClassifiedRow(
        raw_row=raw_row,
        classification=RowClassification.LINE_ITEM,
        sl_no_value=sl_no,
        description="Item",
        qty=qty,
    )


def _make_note(idx: int, text: str) -> ClassifiedRow:
    raw_row = RawRow(row_number=idx + 1, cells={})
    return ClassifiedRow(
        raw_row=raw_row,
        classification=RowClassification.NOTE,
        description=text,
    )


def _make_subtotal(idx: int, text: str) -> ClassifiedRow:
    raw_row = RawRow(row_number=idx + 1, cells={})
    return ClassifiedRow(
        raw_row=raw_row,
        classification=RowClassification.SUBTOTAL_MARKER,
        description=text,
    )


def _make_spacer(idx: int) -> ClassifiedRow:
    raw_row = RawRow(row_number=idx + 1, cells={})
    return ClassifiedRow(
        raw_row=raw_row,
        classification=RowClassification.SPACER,
    )


def _basic_sheet() -> SheetConfig:
    return SheetConfig(
        sheet_name="Test",
        header_row=1,
        column_role_map={
            "A": ColumnRole(role="sl_no"),
            "B": ColumnRole(role="description"),
            "C": ColumnRole(role="unit"),
            "D": ColumnRole(role="qty"),
            "E": ColumnRole(role="rate_supply"),
            "F": ColumnRole(role="amount_supply"),
        },
    )


def _gs() -> GlobalSettings:
    return GlobalSettings()


# ------------------------------------------------------------------
# Tests
# ------------------------------------------------------------------

class TestHierarchyResolver(unittest.TestCase):
    """Phase 2b.1b — hierarchy resolver tests."""

    # ---------------------------------------------------------------- #
    # Family 1 — Tree shape                                             #
    # ---------------------------------------------------------------- #

    def test_single_preamble_with_line_item(self):
        """[preamble('1.0'), line_item('a.')] → correct parent, level, path."""
        rows = [
            _make_preamble(0, "1.0"),
            _make_line_item(1, "a."),
        ]
        result = resolve_hierarchy(rows, _basic_sheet(), _gs())
        p = result.rows[0]
        li = result.rows[1]

        self.assertEqual(p.level, 1)
        self.assertEqual(p.path, "0")
        self.assertIsNone(p.parent_index)

        self.assertEqual(li.parent_index, 0)
        self.assertEqual(li.path, "0/1")
        self.assertIsNone(li.level)

    def test_two_siblings_with_line_items(self):
        """Two level-1 preambles; each line item parents to its own preamble."""
        rows = [
            _make_preamble(0, "1.0"),
            _make_line_item(1, "a."),
            _make_preamble(2, "2.0"),
            _make_line_item(3, "a."),
        ]
        result = resolve_hierarchy(rows, _basic_sheet(), _gs())
        self.assertEqual(result.rows[1].parent_index, 0)
        self.assertEqual(result.rows[3].parent_index, 2)
        # Siblings must both be level 1 with no parent
        self.assertIsNone(result.rows[0].parent_index)
        self.assertIsNone(result.rows[2].parent_index)

    def test_three_level_nesting(self):
        """Preambles at levels 1/2/3 build correct ancestor chain."""
        rows = [
            _make_preamble(0, "1.0"),
            _make_preamble(1, "1.1"),
            _make_preamble(2, "1.1.4"),
            _make_line_item(3, "a."),
        ]
        result = resolve_hierarchy(rows, _basic_sheet(), _gs())
        self.assertEqual(result.rows[0].level, 1)
        self.assertEqual(result.rows[1].level, 2)
        self.assertEqual(result.rows[2].level, 3)

        self.assertIsNone(result.rows[0].parent_index)
        self.assertEqual(result.rows[1].parent_index, 0)
        self.assertEqual(result.rows[2].parent_index, 1)
        self.assertEqual(result.rows[3].parent_index, 2)
        self.assertEqual(result.rows[3].path, "0/1/2/3")

    def test_standalone_line_item_warns(self):
        """Line item with no preceding preamble → parent_index=None + warning."""
        rows = [_make_line_item(0, "1.")]
        result = resolve_hierarchy(rows, _basic_sheet(), _gs())
        li = result.rows[0]
        self.assertIsNone(li.parent_index)
        self.assertEqual(li.path, "0")
        self.assertTrue(any("standalone" in w for w in result.warnings))

    def test_deep_tree_path_correctness(self):
        """5 nested preambles + 1 line item: path is '0/1/2/3/4/5'."""
        rows = [
            _make_preamble(0, "1.0"),
            _make_preamble(1, "1.1"),
            _make_preamble(2, "1.1.1"),
            _make_preamble(3, "1.1.1.1"),
            _make_preamble(4, "1.1.1.1.1"),
            _make_line_item(5, "a."),
        ]
        result = resolve_hierarchy(rows, _basic_sheet(), _gs())
        self.assertEqual(result.rows[5].path, "0/1/2/3/4/5")
        self.assertEqual(result.rows[5].parent_index, 4)
        # Levels 1-5
        for i, expected_level in enumerate(range(1, 6)):
            self.assertEqual(result.rows[i].level, expected_level)

    # ---------------------------------------------------------------- #
    # Family 2 — Note attachment                                        #
    # ---------------------------------------------------------------- #

    def test_note_attaches_to_parent_preamble(self):
        """Note after a preamble attaches to that preamble; line_item still parents correctly."""
        rows = [
            _make_preamble(0, "1.0"),
            _make_note(1, "All wires shall be FRLS"),
            _make_line_item(2, "a."),
        ]
        result = resolve_hierarchy(rows, _basic_sheet(), _gs())
        note_row = result.rows[1]
        preamble_row = result.rows[0]
        line_row = result.rows[2]

        self.assertEqual(note_row.attached_to_index, 0)
        self.assertEqual(preamble_row.attached_notes, ["All wires shall be FRLS"])
        self.assertEqual(line_row.parent_index, 0)

    def test_note_before_first_preamble_goes_to_master(self):
        """Note with no preceding preamble → master_preamble_notes."""
        rows = [
            _make_note(0, "Project notes"),
            _make_preamble(1, "1.0"),
        ]
        result = resolve_hierarchy(rows, _basic_sheet(), _gs())
        self.assertEqual(result.master_preamble_notes, ["Project notes"])
        self.assertIsNone(result.rows[0].attached_to_index)
        self.assertEqual(result.rows[1].attached_notes, [])

    def test_multiple_notes_attached_to_same_preamble_in_order(self):
        """Three consecutive notes all attach to the same preamble, in order."""
        rows = [
            _make_preamble(0, "1.0"),
            _make_note(1, "First"),
            _make_note(2, "Second"),
            _make_note(3, "Third"),
            _make_line_item(4, "a."),
        ]
        result = resolve_hierarchy(rows, _basic_sheet(), _gs())
        self.assertEqual(
            result.rows[0].attached_notes,
            ["First", "Second", "Third"],
        )
        # All note rows point to the same preamble
        for note_idx in (1, 2, 3):
            self.assertEqual(result.rows[note_idx].attached_to_index, 0)
        # Line item parents to preamble, not blocked by notes
        self.assertEqual(result.rows[4].parent_index, 0)

    # ---------------------------------------------------------------- #
    # Family 3 — Special markers                                        #
    # ---------------------------------------------------------------- #

    def test_subtotal_marker_skipped_normal_case(self):
        """Non-reset subtotal leaves tree intact; subsequent preamble is a sibling."""
        rows = [
            _make_preamble(0, "1.0"),
            _make_line_item(1, "a."),
            _make_subtotal(2, "TOTAL CARRIED OVER"),
            _make_preamble(3, "2.0"),
            _make_line_item(4, "a."),
        ]
        result = resolve_hierarchy(rows, _basic_sheet(), _gs())
        subtotal_row = result.rows[2]
        # Subtotal has no tree fields
        self.assertIsNone(subtotal_row.parent_index)
        self.assertIsNone(subtotal_row.level)
        self.assertIsNone(subtotal_row.path)
        # Preamble 2.0 is a root sibling (not a child of 1.0)
        self.assertIsNone(result.rows[3].parent_index)
        self.assertEqual(result.rows[3].level, 1)
        # Second line item parents to preamble 2.0 (idx 3)
        self.assertEqual(result.rows[4].parent_index, 3)

    def test_mid_sheet_numbering_reset(self):
        """'TOTAL ITEM NO. X' clears the stack; next preamble restarts at level 1."""
        rows = [
            _make_preamble(0, "1.0"),
            _make_preamble(1, "1.1"),
            _make_line_item(2, "a."),
            _make_subtotal(3, "TOTAL ITEM NO. 5"),
            _make_preamble(4, "1.0"),
            _make_line_item(5, "a."),
        ]
        result = resolve_hierarchy(rows, _basic_sheet(), _gs())
        # Second preamble("1.0") — fresh root after reset
        second_preamble = result.rows[4]
        self.assertIsNone(second_preamble.parent_index)
        self.assertEqual(second_preamble.level, 1)
        # Second line item parents to the new preamble (idx 4)
        self.assertEqual(result.rows[5].parent_index, 4)

    def test_spacers_skipped_without_affecting_tree(self):
        """Spacer rows do not interrupt the preamble stack."""
        rows = [
            _make_preamble(0, "1.0"),
            _make_spacer(1),
            _make_line_item(2, "a."),
        ]
        result = resolve_hierarchy(rows, _basic_sheet(), _gs())
        # Spacer has no tree fields
        self.assertIsNone(result.rows[1].parent_index)
        self.assertIsNone(result.rows[1].path)
        # Line item still parents to the preamble
        self.assertEqual(result.rows[2].parent_index, 0)

    def test_header_repeat_skipped_without_affecting_tree(self):
        """HEADER_REPEAT rows are skipped like spacers."""
        raw_row = RawRow(row_number=2, cells={})
        header_repeat = ClassifiedRow(
            raw_row=raw_row,
            classification=RowClassification.HEADER_REPEAT,
        )
        rows = [
            _make_preamble(0, "1.0"),
            header_repeat,
            _make_line_item(2, "a."),
        ]
        result = resolve_hierarchy(rows, _basic_sheet(), _gs())
        self.assertIsNone(result.rows[1].parent_index)
        self.assertEqual(result.rows[2].parent_index, 0)

    # ---------------------------------------------------------------- #
    # Family 4 — Level determination heuristics                         #
    # ---------------------------------------------------------------- #

    def test_letter_codes_treated_as_level_1(self):
        """Letter-coded preambles (A., B.) are level 1 siblings."""
        rows = [
            _make_preamble(0, "A."),
            _make_preamble(1, "B."),
            _make_line_item(2, "a."),
        ]
        result = resolve_hierarchy(rows, _basic_sheet(), _gs())
        self.assertEqual(result.rows[0].level, 1)
        self.assertEqual(result.rows[1].level, 1)
        self.assertIsNone(result.rows[0].parent_index)
        self.assertIsNone(result.rows[1].parent_index)
        # Line item parents to the most recent (B.)
        self.assertEqual(result.rows[2].parent_index, 1)

    def test_roman_numerals_treated_as_level_1(self):
        """Roman numeral preambles (I., II., III.) are all level 1."""
        rows = [
            _make_preamble(0, "I."),
            _make_preamble(1, "II."),
            _make_preamble(2, "III."),
        ]
        result = resolve_hierarchy(rows, _basic_sheet(), _gs())
        for i in range(3):
            self.assertEqual(result.rows[i].level, 1)
            self.assertIsNone(result.rows[i].parent_index)

    def test_dotted_decimal_with_trailing_zero_is_level_1(self):
        """'1.0', '2.0', '3.0' are all level-1 preambles (trailing .0 stripped)."""
        rows = [
            _make_preamble(0, "1.0"),
            _make_preamble(1, "2.0"),
            _make_preamble(2, "3.0"),
        ]
        result = resolve_hierarchy(rows, _basic_sheet(), _gs())
        for i in range(3):
            self.assertEqual(result.rows[i].level, 1)
            self.assertIsNone(result.rows[i].parent_index)

    def test_dotted_decimal_deeper_levels(self):
        """'1.1' → level 2; '1.1.4' → level 3; '1.10' unchanged → level 2."""
        rows = [
            _make_preamble(0, "1.0"),   # level 1 (trailing .0 stripped)
            _make_preamble(1, "1.1"),   # level 2
            _make_preamble(2, "1.1.4"), # level 3
        ]
        result = resolve_hierarchy(rows, _basic_sheet(), _gs())
        self.assertEqual(result.rows[0].level, 1)
        self.assertEqual(result.rows[1].level, 2)
        self.assertEqual(result.rows[2].level, 3)

    def test_ambiguous_sl_no_falls_back_to_indent_or_warning(self):
        """Unrecognized sl_no with indent=2 → level inferred from indent (level 3)."""
        cell_a = CellInfo(
            value="weird code",
            formula=None,
            is_formula=False,
            is_merged_origin=False,
            merged_range=None,
            font_bold=False,
            fill_color_rgb=None,
            indent=2,
        )
        raw_row = RawRow(row_number=1, cells={"A": cell_a})
        preamble = ClassifiedRow(
            raw_row=raw_row,
            classification=RowClassification.PREAMBLE,
            sl_no_value="weird code",
            description="Section",
        )
        result = resolve_hierarchy([preamble], _basic_sheet(), _gs())
        self.assertEqual(result.rows[0].level, 3)
        self.assertTrue(
            any("indent" in w for w in result.warnings),
            "Expected a warning mentioning indent fallback",
        )

    # ---------------------------------------------------------------- #
    # Edge cases                                                        #
    # ---------------------------------------------------------------- #

    def test_empty_input_returns_empty_resolved_sheet(self):
        """Empty input list → empty ResolvedSheet with no warnings."""
        result = resolve_hierarchy([], _basic_sheet(), _gs())
        self.assertEqual(result.rows, [])
        self.assertEqual(result.master_preamble_notes, [])
        self.assertEqual(result.warnings, [])

    def test_only_spacers_input(self):
        """All-spacer input → three ResolvedRows with all tree fields None."""
        rows = [_make_spacer(i) for i in range(3)]
        result = resolve_hierarchy(rows, _basic_sheet(), _gs())
        self.assertEqual(len(result.rows), 3)
        for row in result.rows:
            self.assertIsNone(row.parent_index)
            self.assertIsNone(row.level)
            self.assertIsNone(row.path)
        self.assertEqual(result.warnings, [])


if __name__ == "__main__":
    unittest.main()
