# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Tests for `pr_packages.py` -- which procurement packages a PR carries.

Pure: no bench, no site. The lifecycle behaviour (validate writes the rows, the PR Tracker
follows) is pinned in `integrations/controllers/test_procurement_request_packages.py`.

Run:  env/bin/python -m unittest nirmaan_stack.services.test_pr_packages -v
"""

import unittest

from nirmaan_stack.services.pr_packages import (
    ACTION_COLLAPSE,
    ACTION_REBUILD,
    categories_needing_lookup,
    derive_pr_packages,
    item_package,
    rows_are_clean,
    stored_packages,
    tag_rows_action,
)

VALID = {"Electrical Work", "HVAC System", "FA System", "Additional Charges", "Tool & Equipments"}
CATEGORIES = {"Wires": "Electrical Work", "Ducting": "HVAC System", "Orphan": None, "Charges": "Additional Charges"}


def item(package=None, category=None, status="Pending"):
    return {"procurement_package": package, "category": category, "status": status}


def row(package):
    return {"tag_package": package}


class ItemPackageTest(unittest.TestCase):
    def test_own_package_wins_when_real(self):
        self.assertEqual(item_package("FA System", "Wires", VALID, CATEGORIES), "FA System")

    def test_blank_package_falls_back_to_category(self):
        self.assertEqual(item_package("", "Wires", VALID, CATEGORIES), "Electrical Work")
        self.assertEqual(item_package(None, "Wires", VALID, CATEGORIES), "Electrical Work")

    def test_unknown_package_falls_back_to_category(self):
        # The live DB holds one item with the typo "Electrial Work".
        self.assertEqual(item_package("Electrial Work", "Wires", VALID, CATEGORIES), "Electrical Work")

    def test_nothing_usable_gives_none(self):
        self.assertIsNone(item_package("Electrial Work", "Orphan", VALID, CATEGORIES))
        self.assertIsNone(item_package("", "No Such Category", VALID, CATEGORIES))
        self.assertIsNone(item_package(None, None, VALID, CATEGORIES))

    def test_additional_charges_never_counts(self):
        self.assertIsNone(item_package("Additional Charges", "Charges", VALID, CATEGORIES))
        # ...not even through the category fallback.
        self.assertIsNone(item_package("", "Charges", VALID, CATEGORIES))

    def test_whitespace_is_ignored(self):
        self.assertEqual(item_package("  FA System ", None, VALID, CATEGORIES), "FA System")

    def test_valid_packages_may_be_any_iterable(self):
        # A set is used as is; a list or a generator is turned into one.
        self.assertEqual(item_package("FA System", None, sorted(VALID), CATEGORIES), "FA System")
        self.assertEqual(item_package("", "Wires", (p for p in VALID), CATEGORIES), "Electrical Work")
        self.assertEqual(item_package("FA System", None, frozenset(VALID), CATEGORIES), "FA System")


class DerivePackagesTest(unittest.TestCase):
    def test_two_packages_sorted_once_each(self):
        items = [item("HVAC System"), item("Electrical Work"), item("HVAC System")]
        self.assertEqual(derive_pr_packages(items, VALID, CATEGORIES), ["Electrical Work", "HVAC System"])

    def test_every_status_counts(self):
        # A PR whose items are all Deleted can still have live POs (9 such PRs on 2026-10-13).
        for status in ("Pending", "Approved", "Delayed", "Sent Back", "Deleted", "Request"):
            with self.subTest(status=status):
                self.assertEqual(
                    derive_pr_packages([item("FA System", status=status)], VALID, CATEGORIES),
                    ["FA System"],
                )

    def test_only_additional_charges_gives_no_package(self):
        self.assertEqual(derive_pr_packages([item("Additional Charges", "Charges")], VALID, CATEGORIES), [])

    def test_mixed_keeps_only_real_packages(self):
        items = [item("Additional Charges", "Charges"), item("", "Ducting"), item("Bogus", "Orphan")]
        self.assertEqual(derive_pr_packages(items, VALID, CATEGORIES), ["HVAC System"])

    def test_no_items(self):
        self.assertEqual(derive_pr_packages([], VALID, CATEGORIES), [])


class CategoriesNeedingLookupTest(unittest.TestCase):
    def test_only_items_without_a_usable_package(self):
        items = [item("FA System", "Wires"), item("", "Ducting"), item("Bogus", "Orphan"), item("Additional Charges", "Charges")]
        self.assertEqual(categories_needing_lookup(items, VALID), {"Ducting", "Orphan"})


class RowsTest(unittest.TestCase):
    def test_clean_rows(self):
        self.assertTrue(rows_are_clean([row("Electrical Work"), row("HVAC System")]))
        self.assertTrue(rows_are_clean([]))

    def test_a_repeated_package_is_not_clean(self):
        self.assertFalse(rows_are_clean([row("HVAC System"), row("HVAC System")]))

    def test_a_blank_package_is_not_clean(self):
        self.assertFalse(rows_are_clean([row(None)]))

    def test_stored_packages_collapse_old_hvac_rows(self):
        # Before the one-row-per-package patch, HVAC System had one row per header (4 headers).
        rows = [row("HVAC System"), row("HVAC System"), row("HVAC System"), row("HVAC System"), row("Electrical Work")]
        self.assertEqual(stored_packages(rows), ["Electrical Work", "HVAC System"])


class TagRowsActionTest(unittest.TestCase):
    def test_new_pr_always_rebuilds(self):
        self.assertEqual(tag_rows_action(True, None, ["FA System"], None, [row("FA System")]), ACTION_REBUILD)
        # Even with rows a client sent.
        self.assertEqual(
            tag_rows_action(True, None, ["FA System"], None, [row("Electrical Work"), row("Electrical Work")]),
            ACTION_REBUILD,
        )

    def test_item_packages_changed_rebuilds(self):
        rows = [row("FA System")]
        self.assertEqual(tag_rows_action(False, ["FA System"], ["FA System", "HVAC System"], rows, rows), ACTION_REBUILD)
        self.assertEqual(tag_rows_action(False, ["FA System", "HVAC System"], ["FA System"], rows, rows), ACTION_REBUILD)

    def test_tag_rows_changed_by_the_request_rebuilds(self):
        old = [row("FA System")]
        new = [row("FA System"), row("HVAC System")]
        self.assertEqual(tag_rows_action(False, ["FA System"], ["FA System"], old, new), ACTION_REBUILD)

    def test_status_only_save_with_clean_rows_does_nothing(self):
        rows = [row("FA System")]
        self.assertIsNone(tag_rows_action(False, ["FA System"], ["FA System"], rows, rows))

    def test_old_repeated_rows_collapse_without_rebuilding(self):
        rows = [row("HVAC System"), row("HVAC System"), row("Electrical Work")]
        # The items say FA System, but nothing about them changed: keep the stored packages.
        self.assertEqual(tag_rows_action(False, ["FA System"], ["FA System"], rows, rows), ACTION_COLLAPSE)


if __name__ == "__main__":
    unittest.main()
