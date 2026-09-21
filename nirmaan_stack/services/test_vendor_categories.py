# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Tests for `vendor_categories.py` -- which PO / WO categories land on a vendor.

Run:  bench --site localhost run-tests --module nirmaan_stack.services.test_vendor_categories
"""

import unittest

from nirmaan_stack.services.vendor_categories import (
    PO,
    RENAMED_CATEGORIES,
    WO,
    categories_by_vendor,
    merged,
)

CATEGORY = {"Wires & Cables", "DX System", "HVAC Services", "Chilled Water Pipes", "Additional Charges"}
WO_ONLY = {"HVAC Ducting Services"}


def _run(pairs):
    return categories_by_vendor(pairs, CATEGORY, CATEGORY | WO_ONLY)


class TestCategoriesByVendor(unittest.TestCase):
    def test_current_categories_are_kept_and_deduplicated(self):
        found, dropped = _run([("V1", "Wires & Cables", PO), ("V1", "Wires & Cables", PO), ("V2", "HVAC Services", WO)])
        self.assertEqual(found, {"V1": {"Wires & Cables"}, "V2": {"HVAC Services"}})
        self.assertEqual(dropped, {})

    def test_a_same_meaning_rename_maps_to_the_current_name(self):
        found, _ = _run([("V1", "DX Sysetm", PO)])
        self.assertEqual(found, {"V1": {"DX System"}})

    def test_a_reused_name_is_dropped_not_mapped(self):
        # "HVAC Miscellaneous" was renamed INTO "Chilled Water Pipes" -- a different category.
        self.assertNotIn("HVAC Miscellaneous", RENAMED_CATEGORIES)
        found, dropped = _run([("V1", "HVAC Miscellaneous", PO)])
        self.assertEqual(found, {})
        self.assertEqual(dropped, {"HVAC Miscellaneous": 1})

    def test_retired_and_never_valid_names_are_dropped(self):
        found, dropped = _run([("V1", "Sprinkler Piping", PO), ("V1", "Penalty", WO), ("V1", "Additonal Charges", PO)])
        self.assertEqual(found, {})
        self.assertEqual(dropped, {"Sprinkler Piping": 1, "Penalty": 1, "Additonal Charges": 1})

    def test_additional_charges_is_excluded_not_dropped(self):
        found, dropped = _run([("V1", "Additional Charges", PO)])
        self.assertEqual((found, dropped), ({}, {}))

    def test_a_wo_service_category_counts_on_a_wo_only(self):
        found, dropped = _run([("V1", "HVAC Ducting Services", WO), ("V2", "HVAC Ducting Services", PO)])
        self.assertEqual(found, {"V1": {"HVAC Ducting Services"}})
        self.assertEqual(dropped, {"HVAC Ducting Services": 1})

    def test_blank_vendor_or_category_is_ignored(self):
        self.assertEqual(_run([("", "Wires & Cables", PO), ("V1", None, PO)]), ({}, {}))

    def test_every_rename_target_differs_from_its_source(self):
        for old, new in RENAMED_CATEGORIES.items():
            self.assertNotEqual(old, new)


class TestMerged(unittest.TestCase):
    def test_replace_discards_what_was_stored(self):
        self.assertEqual(merged(["Old", "Wires & Cables"], {"Wires & Cables", "DX System"}, replace=True),
                         ["DX System", "Wires & Cables"])

    def test_replace_with_nothing_found_empties_the_list(self):
        self.assertEqual(merged(["Old"], set(), replace=True), [])

    def test_daily_only_adds(self):
        self.assertEqual(merged(["Old", "Wires & Cables"], {"DX System"}, replace=False),
                         ["DX System", "Old", "Wires & Cables"])

    def test_result_is_unique_and_sorted(self):
        self.assertEqual(merged(["b", "a", "b"], {"a", "c"}, replace=False), ["a", "b", "c"])
