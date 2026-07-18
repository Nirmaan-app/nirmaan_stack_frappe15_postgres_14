"""S4 (#1101, ADR-0014 D5) -- pure column-diff tests.

These pin the disposition rules with NO Frappe / openpyxl -- the caller extracts the
committed baseline + revised columns; this module only decides clean vs unsafe. Cases
mirror the plan's S4 acceptance list: shift/insert -> unsafe; append -> unsafe; removed
mapped -> unsafe + dangling; removed unmapped -> silent (clean); clean -> clean; a
blank-header column never mismatches; a renamed unmapped column DOES flag (accepted
false positive); a 2-description removal raises the config-time warning.
"""

import unittest

from nirmaan_stack.services.boq_revision.column_diff import (
    DISPOSITION_CLEAN,
    DISPOSITION_UNSAFE,
    diff_columns,
    summarize_columns,
)

# A small original: A=sl_no, B=description, C=unit, D=qty, E=rate, F=amount.
# S.No column A is UNMAPPED here (a real-life clean label the guard still uses).
_ROLE_MAP = {
    "B": {"role": "description", "area": None},
    "C": {"role": "unit", "area": None},
    "D": {"role": "qty", "area": None},
    "E": {"role": "rate_combined", "area": None},
    "F": {"role": "amount_total", "area": None},
}
_ORIG_HEADER = {
    "A": "S.No", "B": "Description", "C": "Unit",
    "D": "Qty", "E": "Rate", "F": "Amount",
}
_ORIG_UNIVERSE = set("ABCDEF")


def _diff(revised_header, revised_universe, role_map=None, orig_header=None, orig_universe=None):
    return diff_columns(
        role_map if role_map is not None else _ROLE_MAP,
        orig_header if orig_header is not None else _ORIG_HEADER,
        orig_universe if orig_universe is not None else _ORIG_UNIVERSE,
        revised_header,
        revised_universe,
    )


class TestColumnDiffClean(unittest.TestCase):
    def test_identical_is_clean(self):
        r = _diff(dict(_ORIG_HEADER), set("ABCDEF"))
        self.assertEqual(r.disposition, DISPOSITION_CLEAN)
        self.assertTrue(r.is_clean)
        self.assertEqual(r.reasons, [])
        self.assertEqual(r.dangling_roles, [])
        self.assertFalse(r.description_set_changed)

    def test_n2_whitespace_case_drift_is_clean(self):
        # Trailing space + case + collapsed internal whitespace all fold under N2.
        drifted = {
            "A": "  s.no ", "B": "DESCRIPTION", "C": "unit",
            "D": "Qty", "E": "rate", "F": "amount",
        }
        self.assertEqual(_diff(drifted, set("ABCDEF")).disposition, DISPOSITION_CLEAN)

    def test_blank_header_column_never_mismatches(self):
        # E's header is blank on the revised side -> silent on E (not a mismatch), and E is
        # still present in the universe -> not dangling. Whole sheet stays clean.
        rev = dict(_ORIG_HEADER)
        rev["E"] = ""
        self.assertEqual(_diff(rev, set("ABCDEF")).disposition, DISPOSITION_CLEAN)

    def test_removed_unmapped_column_is_silent(self):
        # The UNMAPPED S.No column A is gone from the revised sheet -> silent no-op (clean).
        rev = {k: v for k, v in _ORIG_HEADER.items() if k != "A"}
        r = _diff(rev, set("BCDEF"))
        self.assertEqual(r.disposition, DISPOSITION_CLEAN)
        self.assertEqual(r.dangling_roles, [])


class TestColumnDiffUnsafe(unittest.TestCase):
    def test_guard_mismatch_on_shift_is_unsafe(self):
        # A mid-sheet insert shifts C..F right by one: the label under D is now "Unit", etc.
        shifted = {
            "A": "S.No", "B": "Description", "C": "NEW COL",
            "D": "Unit", "E": "Qty", "F": "Rate", "G": "Amount",
        }
        r = _diff(shifted, set("ABCDEFG"))
        self.assertEqual(r.disposition, DISPOSITION_UNSAFE)
        self.assertTrue(any("changed" in x for x in r.reasons))

    def test_appended_new_column_is_unsafe(self):
        rev = dict(_ORIG_HEADER)
        rev["G"] = "Remarks"
        r = _diff(rev, set("ABCDEFG"))
        self.assertEqual(r.disposition, DISPOSITION_UNSAFE)
        self.assertTrue(any("New column G" in x for x in r.reasons))

    def test_removed_mapped_column_is_unsafe_and_dangling(self):
        # F (amount_total) removed from the revised sheet -> dangling role flagged.
        rev = {k: v for k, v in _ORIG_HEADER.items() if k != "F"}
        r = _diff(rev, set("ABCDE"))
        self.assertEqual(r.disposition, DISPOSITION_UNSAFE)
        self.assertEqual(r.dangling_roles, ["F"])

    def test_removed_mapped_column_with_blank_header_still_dangling(self):
        # A mapped column can carry a blank header (69% of live sheets do); its removal is a
        # UNIVERSE fact, not a header fact -> still flagged even though its header was blank.
        role_map = dict(_ROLE_MAP)
        orig_header = dict(_ORIG_HEADER)
        orig_header["F"] = ""  # amount had a blank header originally
        rev = {k: v for k, v in orig_header.items() if k != "F"}
        r = _diff(rev, set("ABCDE"), role_map=role_map, orig_header=orig_header)
        self.assertEqual(r.disposition, DISPOSITION_UNSAFE)
        self.assertEqual(r.dangling_roles, ["F"])

    def test_renamed_unmapped_column_flags_accepted_false_positive(self):
        # The UNMAPPED S.No header is renamed -> the full-row guard fires (accepted cost).
        rev = dict(_ORIG_HEADER)
        rev["A"] = "Serial"
        r = _diff(rev, set("ABCDEF"))
        self.assertEqual(r.disposition, DISPOSITION_UNSAFE)
        self.assertTrue(any("column A" in x for x in r.reasons))

    def test_no_baseline_degrades_to_unsafe(self):
        # A template-origin original with no committed header row -> cannot certify clean.
        r = _diff(dict(_ORIG_HEADER), set("ABCDEF"), orig_header={}, orig_universe=set(_ROLE_MAP))
        self.assertEqual(r.disposition, DISPOSITION_UNSAFE)
        self.assertTrue(any("baseline" in x for x in r.reasons))


class TestColumnDiffDescriptionWarning(unittest.TestCase):
    def test_description_column_removed_raises_warning(self):
        # A 2-description sheet loses its second description column.
        role_map = dict(_ROLE_MAP)
        role_map["G"] = {"role": "description", "area": None}
        orig_header = dict(_ORIG_HEADER)
        orig_header["G"] = "Description (Hindi)"
        r = _diff(
            dict(_ORIG_HEADER), set("ABCDEF"),  # G gone
            role_map=role_map, orig_header=orig_header, orig_universe=set("ABCDEFG"),
        )
        self.assertEqual(r.disposition, DISPOSITION_UNSAFE)
        self.assertIn("G", r.dangling_roles)
        self.assertTrue(r.description_set_changed)

    def test_description_header_changed_raises_warning(self):
        rev = dict(_ORIG_HEADER)
        rev["B"] = "Item Particulars"  # description header changed -> guard mismatch on B
        r = _diff(rev, set("ABCDEF"))
        self.assertEqual(r.disposition, DISPOSITION_UNSAFE)
        self.assertTrue(r.description_set_changed)

    def test_non_description_change_does_not_raise_description_warning(self):
        rev = dict(_ORIG_HEADER)
        rev["C"] = "UOM"  # unit header changed -> unsafe, but NOT a description change
        r = _diff(rev, set("ABCDEF"))
        self.assertEqual(r.disposition, DISPOSITION_UNSAFE)
        self.assertFalse(r.description_set_changed)


class TestSummarizeColumns(unittest.TestCase):
    def test_header_text_and_universe_from_header_only(self):
        # Original-side use: only the header row is passed -> universe = header extent.
        rows = [{"row_number": 1, "cells": {"A": "S.No", "B": "Description", "C": None}}]
        header_cells, universe = summarize_columns(rows, {1})
        self.assertEqual(header_cells, {"A": "S.No", "B": "Description", "C": ""})
        self.assertEqual(universe, {"A", "B", "C"})  # blank C kept via the header extent

    def test_universe_includes_data_columns_beyond_header(self):
        # Revised-side use: header + data rows -> universe = header extent + data columns.
        rows = [
            {"row_number": 1, "cells": {"A": "S.No", "B": "Description"}},
            {"row_number": 2, "cells": {"A": 1, "B": "item", "C": 5}},  # C only in data
        ]
        header_cells, universe = summarize_columns(rows, {1})
        self.assertEqual(header_cells, {"A": "S.No", "B": "Description"})
        self.assertEqual(universe, {"A", "B", "C"})

    def test_two_row_header_joins_in_order(self):
        rows = [
            {"row_number": 1, "cells": {"D": "Total", "E": "Supply"}},
            {"row_number": 2, "cells": {"D": "Qty", "E": "Rate"}},
        ]
        header_cells, _ = summarize_columns(rows, {1, 2})
        self.assertEqual(header_cells["D"], "Total Qty")
        self.assertEqual(header_cells["E"], "Supply Rate")

    def test_empty_rows_give_empty(self):
        self.assertEqual(summarize_columns([], {1}), ({}, set()))


if __name__ == "__main__":
    unittest.main()
