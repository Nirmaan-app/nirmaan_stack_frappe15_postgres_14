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


class TestLevel1StyleDetection(unittest.TestCase):
    """Phase 2b.1b fix — context-aware level_1_style detection tests."""

    # ---------------------------------------------------------------- #
    # Helper                                                            #
    # ---------------------------------------------------------------- #

    @staticmethod
    def _make_preamble_with_indent(
        idx: int,
        sl_no: str,
        indent: int = 0,
        description: str = "Section",
    ) -> ClassifiedRow:
        cells = {
            "A": CellInfo(
                value=sl_no,
                formula=None,
                is_formula=False,
                is_merged_origin=False,
                merged_range=None,
                font_bold=False,
                fill_color_rgb=None,
                indent=indent,
            )
        }
        raw_row = RawRow(row_number=idx + 1, cells=cells)
        return ClassifiedRow(
            raw_row=raw_row,
            classification=RowClassification.PREAMBLE,
            sl_no_value=sl_no,
            description=description,
        )

    # ---------------------------------------------------------------- #
    # Test 1 — letter detected as level_1_style                        #
    # ---------------------------------------------------------------- #

    def test_level_1_style_detected_from_first_letter_preamble(self):
        """First preamble 'A.' sets level_1_style=letter; '1.0' → level 2."""
        rows = [
            _make_preamble(0, "A."),
            _make_preamble(1, "1.0"),
            _make_line_item(2),
        ]
        result = resolve_hierarchy(rows, _basic_sheet(), _gs())
        self.assertEqual(result.rows[0].level, 1)
        self.assertEqual(result.rows[1].level, 2)
        self.assertEqual(result.rows[1].parent_index, 0)
        self.assertEqual(result.rows[2].parent_index, 1)

    # ---------------------------------------------------------------- #
    # Test 2 — numeric detected as level_1_style                       #
    # ---------------------------------------------------------------- #

    def test_level_1_style_detected_from_first_numeric_preamble(self):
        """First preamble '1.0' sets level_1_style=numeric; '2.0' → level 1 sibling."""
        rows = [
            _make_preamble(0, "1.0"),
            _make_preamble(1, "2.0"),
            _make_line_item(2),
        ]
        result = resolve_hierarchy(rows, _basic_sheet(), _gs())
        self.assertEqual(result.rows[0].level, 1)
        self.assertEqual(result.rows[1].level, 1)
        self.assertIsNone(result.rows[0].parent_index)
        self.assertIsNone(result.rows[1].parent_index)
        self.assertEqual(result.rows[2].parent_index, 1)

    # ---------------------------------------------------------------- #
    # Test 3 — Pattern X (JSW Elect B1 style)                          #
    # ---------------------------------------------------------------- #

    def test_pattern_x_letter_then_numeric_nesting(self):
        """JSW Elect B1: A./B. are L1, numeric codes under them are L2."""
        rows = [
            _make_preamble(0, "A."),
            _make_preamble(1, "1.0"),
            _make_preamble(2, "3.0"),
            _make_line_item(3),
            _make_preamble(4, "B."),
            _make_preamble(5, "1.0"),
            _make_line_item(6),
        ]
        result = resolve_hierarchy(rows, _basic_sheet(), _gs())
        # A. and B. are level 1
        self.assertEqual(result.rows[0].level, 1)
        self.assertEqual(result.rows[4].level, 1)
        self.assertIsNone(result.rows[0].parent_index)
        self.assertIsNone(result.rows[4].parent_index)
        # 1.0 and 3.0 under A. are level 2, parent=A.
        self.assertEqual(result.rows[1].level, 2)
        self.assertEqual(result.rows[1].parent_index, 0)
        self.assertEqual(result.rows[2].level, 2)
        self.assertEqual(result.rows[2].parent_index, 0)
        # 1.0 under B. is level 2, parent=B.
        self.assertEqual(result.rows[5].level, 2)
        self.assertEqual(result.rows[5].parent_index, 4)

    # ---------------------------------------------------------------- #
    # Test 4 — Pattern Y (numeric top → letter sub)                    #
    # ---------------------------------------------------------------- #

    def test_pattern_y_numeric_then_letter_nesting(self):
        """Numeric top-level; letter preambles are level-2 sub-sections."""
        rows = [
            _make_preamble(0, "1."),
            _make_preamble(1, "A."),
            _make_preamble(2, "B."),
            _make_preamble(3, "2."),
            _make_preamble(4, "A."),
        ]
        result = resolve_hierarchy(rows, _basic_sheet(), _gs())
        # 1. and 2. are level 1
        self.assertEqual(result.rows[0].level, 1)
        self.assertEqual(result.rows[3].level, 1)
        self.assertIsNone(result.rows[0].parent_index)
        self.assertIsNone(result.rows[3].parent_index)
        # A. and B. under 1. are level 2, parent=1.
        self.assertEqual(result.rows[1].level, 2)
        self.assertEqual(result.rows[1].parent_index, 0)
        self.assertEqual(result.rows[2].level, 2)
        self.assertEqual(result.rows[2].parent_index, 0)
        # A. under 2. is level 2, parent=2.
        self.assertEqual(result.rows[4].level, 2)
        self.assertEqual(result.rows[4].parent_index, 3)

    # ---------------------------------------------------------------- #
    # Test 5 — lowercase letter always one deeper                       #
    # ---------------------------------------------------------------- #

    def test_lowercase_letter_always_one_deeper(self):
        """Lowercase 'a' is always stack_depth+1, never a level-1 style."""
        rows = [
            _make_preamble(0, "1.0"),
            _make_preamble(1, "a"),
            _make_line_item(2),
        ]
        result = resolve_hierarchy(rows, _basic_sheet(), _gs())
        self.assertEqual(result.rows[0].level, 1)
        self.assertEqual(result.rows[1].level, 2)
        self.assertEqual(result.rows[1].parent_index, 0)
        self.assertEqual(result.rows[2].parent_index, 1)

    # ---------------------------------------------------------------- #
    # Test 6 — multi-dot numeric unambiguous in Pattern X              #
    # ---------------------------------------------------------------- #

    def test_multi_dot_numeric_unambiguous_pattern_x(self):
        """Under letter-style L1, multi-dot codes are not Pattern Y — no warning."""
        rows = [
            _make_preamble(0, "A."),
            _make_preamble(1, "1.1"),
            _make_preamble(2, "1.1.4"),
            _make_line_item(3),
        ]
        result = resolve_hierarchy(rows, _basic_sheet(), _gs())
        self.assertEqual(result.rows[0].level, 1)
        self.assertEqual(result.rows[1].level, 2)  # 1 + 1 dot
        self.assertEqual(result.rows[2].level, 3)  # 1 + 2 dots
        # No Pattern Y warning emitted (level_1_style is "letter", not "numeric")
        self.assertFalse(
            any("ambiguous_level_pattern_y" in w for w in result.warnings),
            "Pattern Y warning should NOT be emitted under letter-style L1",
        )

    # ---------------------------------------------------------------- #
    # Test 7 — Pattern Y warning emitted for multi-dot under non-numeric#
    # ---------------------------------------------------------------- #

    def test_multi_dot_numeric_pattern_y_emits_warning(self):
        """Multi-dot code under a non-numeric parent with numeric L1 → Pattern Y warning."""
        rows = [
            _make_preamble(0, "1."),   # numeric L1
            _make_preamble(1, "A."),   # letter → level 2 under 1.
            _make_preamble(2, "1.1"),  # multi-dot; parent is A. (non-numeric)
            _make_line_item(3),
        ]
        result = resolve_hierarchy(rows, _basic_sheet(), _gs())
        self.assertTrue(
            any("ambiguous_level_pattern_y" in w for w in result.warnings),
            "Expected Pattern Y warning for 1.1 under A. parent",
        )
        self.assertEqual(result.rows[2].level, 2)  # default = 1 + dot count

    # ---------------------------------------------------------------- #
    # Test 8 — level_1_style_override bypasses auto-detection           #
    # ---------------------------------------------------------------- #

    def test_level_1_style_override_skips_detection(self):
        """override='numeric' → first preamble 'A.' treated as level 2 (not L1)."""
        config = SheetConfig(
            sheet_name="Test",
            header_row=1,
            column_role_map={
                "A": ColumnRole(role="sl_no"),
                "B": ColumnRole(role="description"),
                "D": ColumnRole(role="qty"),
            },
            level_1_style_override="numeric",
        )
        rows = [_make_preamble(0, "A.")]
        result = resolve_hierarchy(rows, config, _gs())
        # 'A.' is "letter" style, differs from "numeric" override → level 2
        self.assertEqual(result.rows[0].level, 2)

    # ---------------------------------------------------------------- #
    # Test 9 — re-detect level_1_style after mid-sheet reset           #
    # ---------------------------------------------------------------- #

    def test_mid_sheet_reset_redetects_level_1_style(self):
        """After 'TOTAL ITEM NO. X', level_1_style is re-detected from next preamble."""
        rows = [
            _make_preamble(0, "A."),                          # sets style=letter
            _make_preamble(1, "1.0"),                         # level 2 under A.
            _make_subtotal(2, "TOTAL ITEM NO. 5"),            # reset + re-detect
            _make_preamble(3, "1.0"),                         # first preamble of new section → numeric
            _make_preamble(4, "A."),                          # letter, different → level 2 under 1.0
            _make_line_item(5),
        ]
        result = resolve_hierarchy(rows, _basic_sheet(), _gs())
        # First section: A. is L1, 1.0 is L2 under A.
        self.assertEqual(result.rows[0].level, 1)
        self.assertEqual(result.rows[1].level, 2)
        self.assertEqual(result.rows[1].parent_index, 0)
        # After reset: 1.0 becomes L1 (re-detected style=numeric)
        self.assertIsNone(result.rows[3].parent_index)
        self.assertEqual(result.rows[3].level, 1)
        # A. after 1.0 is level 2 under 1.0
        self.assertEqual(result.rows[4].level, 2)
        self.assertEqual(result.rows[4].parent_index, 3)
        # line_item parents to A.
        self.assertEqual(result.rows[5].parent_index, 4)

    # ---------------------------------------------------------------- #
    # Test 10 — unknown sl_no falls back with warning                  #
    # ---------------------------------------------------------------- #

    def test_unknown_sl_no_falls_back_with_warning(self):
        """Unrecognized sl_no emits a warning; tree remains well-formed."""
        rows = [
            _make_preamble(0, "A."),
            _make_preamble(1, "custom-code-xyz"),
            _make_line_item(2),
        ]
        result = resolve_hierarchy(rows, _basic_sheet(), _gs())
        # A warning should be recorded for the unknown code
        self.assertTrue(
            any("custom-code-xyz" in w for w in result.warnings),
            "Expected warning mentioning unrecognized sl_no",
        )
        # Line item still parented somewhere (to the unknown preamble)
        self.assertIsNotNone(result.rows[2].parent_index)
        self.assertEqual(result.rows[2].parent_index, 1)

    # ---------------------------------------------------------------- #
    # Test 11 — uppercase letter is L1, lowercase is not               #
    # ---------------------------------------------------------------- #

    def test_uppercase_letter_is_level_1_lowercase_is_not(self):
        """'A' → level 1 (letter style); 'a' → level 2 (stack_depth+1)."""
        rows = [
            _make_preamble(0, "A"),
            _make_preamble(1, "a"),
            _make_line_item(2),
        ]
        result = resolve_hierarchy(rows, _basic_sheet(), _gs())
        self.assertEqual(result.rows[0].level, 1)
        self.assertEqual(result.rows[1].level, 2)
        self.assertEqual(result.rows[1].parent_index, 0)
        self.assertEqual(result.rows[2].parent_index, 1)

    # ---------------------------------------------------------------- #
    # Test 12 — Roman numeral sets roman style; numeric → level 2      #
    # ---------------------------------------------------------------- #

    def test_roman_first_preamble_sets_roman_style(self):
        """I./II. establish roman style; '1.0' (numeric) → level 2 under II."""
        rows = [
            _make_preamble(0, "I."),
            _make_preamble(1, "II."),
            _make_preamble(2, "1.0"),
            _make_line_item(3),
        ]
        result = resolve_hierarchy(rows, _basic_sheet(), _gs())
        self.assertEqual(result.rows[0].level, 1)
        self.assertEqual(result.rows[1].level, 1)
        self.assertIsNone(result.rows[0].parent_index)
        self.assertIsNone(result.rows[1].parent_index)
        # '1.0' is numeric, different from roman → level 2 under II.
        self.assertEqual(result.rows[2].level, 2)
        self.assertEqual(result.rows[2].parent_index, 1)
        self.assertEqual(result.rows[3].parent_index, 2)


    # ---------------------------------------------------------------- #
    # Test 13 — JSW alphabetic sequence with C/D (the bug we fixed)   #
    # ---------------------------------------------------------------- #

    def test_jsw_alphabetic_sequence_with_C_and_D(self):
        """
        JSW Elect B1 pattern: section codes A, B, C, D, E, F, G are alphabetic.
        C and D are valid Roman characters but should be treated as letters in
        this context. Lookahead sees A (unambiguous letter) → level_1_style=letter;
        special case in _determine_preamble_level then accepts single-char Roman
        codes (C, D) as level 1 on letter-style sheets.
        """
        rows = [
            _make_preamble(0, "A."),
            _make_preamble(1, "B."),
            _make_preamble(2, "C."),
            _make_preamble(3, "D"),
            _make_preamble(4, "E"),
            _make_preamble(5, "F"),
            _make_preamble(6, "G"),
        ]
        result = resolve_hierarchy(rows, _basic_sheet(), _gs())

        for idx in range(7):
            self.assertEqual(
                result.rows[idx].level, 1,
                f"Letter at idx {idx} (sl_no={rows[idx].sl_no_value!r}) should be level 1",
            )
            self.assertIsNone(
                result.rows[idx].parent_index,
                f"Letter at idx {idx} should have no parent",
            )

    # ---------------------------------------------------------------- #
    # Test 14 — JSW pattern with numeric children under C and D        #
    # ---------------------------------------------------------------- #

    def test_jsw_pattern_with_numeric_children_under_letters(self):
        """
        Full JSW Elect B1 mini-tree: A→1.0, B→1.0, C→1.0, D→1.0.
        Verifies C and D correctly take their own numeric children rather than
        leaving those children parented under B (the bug before the fix).
        """
        rows = [
            _make_preamble(0, "A."),
            _make_preamble(1, "1.0"),  # under A.
            _make_preamble(2, "B."),
            _make_preamble(3, "1.0"),  # under B.
            _make_preamble(4, "C."),
            _make_preamble(5, "1.0"),  # under C.
            _make_preamble(6, "D"),
            _make_preamble(7, "1.0"),  # under D.
        ]
        result = resolve_hierarchy(rows, _basic_sheet(), _gs())

        self.assertEqual(result.rows[1].parent_index, 0)  # 1.0 under A
        self.assertEqual(result.rows[3].parent_index, 2)  # 1.0 under B
        self.assertEqual(result.rows[5].parent_index, 4)  # 1.0 under C
        self.assertEqual(result.rows[7].parent_index, 6)  # 1.0 under D

    # ---------------------------------------------------------------- #
    # Test 15 — Paytm Roman sequence still works (regression check)    #
    # ---------------------------------------------------------------- #

    def test_paytm_roman_sequence_starting_at_I(self):
        """
        Paytm pattern: section codes I, II, III, IV. Lookahead detection
        sees first=I (ambiguous single char), second=II (multi-char Roman)
        → resolves to roman style. All four sections at level 1.
        This is the regression check for the previous fix attempt that broke
        this exact pattern by doing a naive single-letter-before-Roman swap.
        """
        rows = [
            _make_preamble(0, "I."),
            _make_preamble(1, "II."),
            _make_preamble(2, "III."),
            _make_preamble(3, "IV."),
        ]
        result = resolve_hierarchy(rows, _basic_sheet(), _gs())

        for idx in range(4):
            self.assertEqual(
                result.rows[idx].level, 1,
                f"Roman at idx {idx} (sl_no={rows[idx].sl_no_value!r}) should be level 1",
            )
            self.assertIsNone(result.rows[idx].parent_index)

    # ---------------------------------------------------------------- #
    # Test 16 — single ambiguous char alone defaults to letter          #
    # ---------------------------------------------------------------- #

    def test_single_ambiguous_char_alone_defaults_to_letter(self):
        """
        BoQ with only one eligible preamble that's an ambiguous single Roman char
        (C. with no second eligible preamble for disambiguation). Default to
        'letter' style — alphabetic patterns far more common. Recovery via
        SheetConfig.level_1_style_override='roman'.
        """
        rows = [
            _make_preamble(0, "C."),
            _make_line_item(1),
        ]
        result = resolve_hierarchy(rows, _basic_sheet(), _gs())
        self.assertEqual(result.rows[0].level, 1)
        self.assertIsNone(result.rows[0].parent_index)

    # ---------------------------------------------------------------- #
    # Test 17 — override forces Roman even when first char is C        #
    # ---------------------------------------------------------------- #

    def test_override_roman_forces_roman_even_with_C_first(self):
        """
        SheetConfig.level_1_style_override='roman' bypasses lookahead entirely.
        A BoQ starting with C. but known to use Roman coding sets the override;
        both C. and D. (both categorize as 'roman') resolve to level 1.
        """
        config = SheetConfig(
            sheet_name="Test",
            header_row=1,
            column_role_map={
                "A": ColumnRole(role="sl_no"),
                "B": ColumnRole(role="description"),
                "D": ColumnRole(role="qty"),
            },
            level_1_style_override="roman",
        )
        rows = [
            _make_preamble(0, "C."),
            _make_preamble(1, "D."),
        ]
        result = resolve_hierarchy(rows, config, _gs())
        self.assertEqual(result.rows[0].level, 1)
        self.assertIsNone(result.rows[0].parent_index)
        self.assertEqual(result.rows[1].level, 1)
        self.assertIsNone(result.rows[1].parent_index)


    # ---------------------------------------------------------------- #
    # Test 18 — is_synthetic defaults to False on all resolved rows    #
    # ---------------------------------------------------------------- #

    def test_resolved_row_is_synthetic_defaults_to_false(self):
        """
        Every ResolvedRow produced by the parser has is_synthetic=False.
        The field is reserved for Phase 3 wizard synthetic preambles (user-created
        preambles with no source row); the parser never sets it to True.
        """
        rows = [
            _make_preamble(0, "A."),
            _make_preamble(1, "1.0"),
            _make_line_item(2),
            _make_note(3, "Some note"),
            _make_spacer(4),
        ]
        result = resolve_hierarchy(rows, _basic_sheet(), _gs())
        for i, resolved in enumerate(result.rows):
            self.assertFalse(
                resolved.is_synthetic,
                f"ResolvedRow at idx {i} should have is_synthetic=False",
            )


class TestResolvedRowValidationWarnings(unittest.TestCase):
    """Phase 2b.2 Part B1 — ResolvedRow.validation_warnings field."""

    def test_validation_warnings_default_is_empty_list(self):
        """Fresh ResolvedRow has validation_warnings=[] by default."""
        from nirmaan_stack.services.boq_parser.hierarchy import ResolvedRow
        rr = ResolvedRow(classified_row=_make_line_item(0))
        self.assertEqual(rr.validation_warnings, [])

    def test_validation_warnings_accepts_non_empty_list(self):
        """ResolvedRow accepts a list of warning strings — data shape is correct."""
        from nirmaan_stack.services.boq_parser.hierarchy import ResolvedRow
        warnings = ["sum mismatch: per-area total 105 vs file 100"]
        rr = ResolvedRow(classified_row=_make_line_item(0), validation_warnings=warnings)
        self.assertEqual(rr.validation_warnings, warnings)
        self.assertEqual(len(rr.validation_warnings), 1)


class TestResolvedRowMultiAreaFields(unittest.TestCase):
    """Phase 2b.2 Part B2a — new per-area fields on ResolvedRow."""

    def test_new_fields_default_to_empty_and_none(self):
        """Fresh ResolvedRow has all new multi-area fields at their defaults."""
        from nirmaan_stack.services.boq_parser.hierarchy import ResolvedRow
        rr = ResolvedRow(classified_row=_make_line_item(0))
        self.assertEqual(rr.qty_by_area_raw, {})
        self.assertEqual(rr.amount_by_area_raw, {})
        self.assertIsNone(rr.qty_total)
        self.assertIsNone(rr.amount_total)
        self.assertEqual(rr.qty_by_area, {})
        self.assertEqual(rr.amount_by_area, {})

    def test_resolver_carries_forward_raw_dicts_and_totals_for_line_items(self):
        """
        After resolve_hierarchy(), a LINE_ITEM ResolvedRow carries forward
        qty_by_area_raw, amount_by_area_raw from its ClassifiedRow, and
        qty_total from qty_total_raw, amount_total from amount_total.
        """
        from nirmaan_stack.services.boq_parser.classifier import RowClassification
        from nirmaan_stack.services.boq_parser.hierarchy import ResolvedRow, resolve_hierarchy

        # Construct a ClassifiedRow with per-area data
        raw_row = RawRow(row_number=1, cells={})
        classified = ClassifiedRow(
            raw_row=raw_row,
            classification=RowClassification.LINE_ITEM,
            sl_no_value="a.",
            description="Item",
            qty=8.0,
            qty_total_raw=10.0,  # deliberately different from qty to verify field selection
            amount_total=800.0,
            qty_by_area_raw={"Floor 1": 5.0, "Floor 2": 3.0},
            amount_by_area_raw={"Floor 1": 500.0, "Floor 2": 300.0},
        )

        config = SheetConfig(
            sheet_name="Test",
            header_row=1,
            column_role_map={
                "A": ColumnRole(role="sl_no"),
                "B": ColumnRole(role="description"),
            },
        )
        result = resolve_hierarchy([classified], config, GlobalSettings())

        line_item_row = next(
            rr for rr in result.rows
            if rr.classified_row.classification == RowClassification.LINE_ITEM
        )
        self.assertEqual(line_item_row.qty_by_area_raw, {"Floor 1": 5.0, "Floor 2": 3.0})
        self.assertEqual(line_item_row.amount_by_area_raw, {"Floor 1": 500.0, "Floor 2": 300.0})
        self.assertEqual(line_item_row.qty_total, 10.0)   # from qty_total_raw, not qty
        self.assertEqual(line_item_row.amount_total, 800.0)


if __name__ == "__main__":
    unittest.main()
