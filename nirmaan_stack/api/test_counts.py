# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt
"""Tests for the batch count endpoint (api/counts.py)."""

import json

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.counts import get_counts


class TestGetCounts(FrappeTestCase):
    def test_plain_count_matches_db_count(self):
        expected = frappe.db.count("Projects")
        res = get_counts([{"key": "all", "doctype": "Projects"}])
        self.assertEqual(res["all"], expected)

    def test_filtered_count(self):
        expected = frappe.db.count("Projects", {"status": "WIP"})
        res = get_counts(
            [{"key": "wip", "doctype": "Projects", "filters": {"status": "WIP"}}]
        )
        self.assertEqual(res["wip"], expected)

    def test_group_by_returns_map_summing_to_total(self):
        res = get_counts(
            [{"key": "by_status", "doctype": "Projects", "group_field": "status"}]
        )
        self.assertIsInstance(res["by_status"], dict)
        self.assertEqual(sum(res["by_status"].values()), frappe.db.count("Projects"))

    def test_batch_multiple_doctypes_one_call(self):
        res = get_counts(
            [
                {"key": "projects", "doctype": "Projects"},
                {"key": "vendors", "doctype": "Vendors"},
            ]
        )
        self.assertEqual(res["projects"], frappe.db.count("Projects"))
        self.assertEqual(res["vendors"], frappe.db.count("Vendors"))

    def test_accepts_json_string(self):
        res = get_counts(json.dumps([{"key": "all", "doctype": "Projects"}]))
        self.assertEqual(res["all"], frappe.db.count("Projects"))

    def test_is_not_set_operator_preserved(self):
        # AssetsSummaryCard relies on `is not set`; it must behave like the SDK count.
        expected = frappe.db.count("Projects", {"customer": ["is", "not set"]})
        res = get_counts(
            [
                {
                    "key": "no_customer",
                    "doctype": "Projects",
                    "filters": [["customer", "is", "not set"]],
                }
            ]
        )
        self.assertEqual(res["no_customer"], expected)

    def test_malformed_spec_is_skipped_not_fatal(self):
        res = get_counts(
            [
                {"doctype": "Projects"},  # no key -> skipped
                {"key": "ok", "doctype": "Projects"},
            ]
        )
        self.assertIn("ok", res)
        self.assertEqual(len(res), 1)
