"""Payments dashboard stats -- the Non-Project Inflow (30 days) figure (#1267, ADR-0016 A-D4).

    bench --site localhost run-tests --app nirmaan_stack \
        --module nirmaan_stack.api.payments.test_payment_dashboard_stats

⚠️ RUNS AGAINST THE LIVE SITE DATABASE, which already holds real inflows and expenses. Every assertion
is therefore a DELTA: read the stats, insert a record, read again. Each record inserted here is purged
in `tearDownClass` together with its `Version` rows (the doctype carries `track_changes`).
"""

import unittest

import frappe
from frappe.utils import add_days, today

from nirmaan_stack.api.payments.get_project_payment_summary import get_payment_dashboard_stats

DOCTYPE = "Non Project Inflows"


class TestNonProjectInflowDashboardFigure(unittest.TestCase):
    created: list = []

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.created = []

    @classmethod
    def tearDownClass(cls):
        # Raw deletes skip the doctype's hooks on purpose: its only hook is `on_update` (receipt
        # adoption), nothing runs on delete, and these rows carry no receipt.
        for name in cls.created:
            frappe.db.delete("Version", {"ref_doctype": DOCTYPE, "docname": name})
            frappe.db.delete(DOCTYPE, {"name": name})
        frappe.db.commit()
        super().tearDownClass()

    def _insert(self, payment_date, amount):
        doc = frappe.get_doc({
            "doctype": DOCTYPE,
            "inflow_type": "Interest Payouts",
            "amount": amount,
            "payment_date": payment_date,
            "utr": f"TEST-DASH-{frappe.generate_hash(length=8)}",
        })
        doc.insert(ignore_permissions=True)
        self.created.append(doc.name)
        return doc

    def _delta(self, before, after, key):
        return after[key] - before[key]

    def test_a_record_inside_the_window_is_counted(self):
        before = get_payment_dashboard_stats()
        self._insert(today(), 12345)
        after = get_payment_dashboard_stats()
        self.assertEqual(self._delta(before, after, "total_non_project_inflow_30_days_count"), 1)
        self.assertAlmostEqual(self._delta(before, after, "total_non_project_inflow_30_days_amount"), 12345)

    def test_the_window_is_thirty_days_inclusive(self):
        # The window starts at today - 29, the same inclusive 30 days every other 30-day figure uses.
        before = get_payment_dashboard_stats()
        self._insert(add_days(today(), -29), 700)
        self._insert(add_days(today(), -30), 900)
        self._insert(add_days(today(), -45), 1100)
        after = get_payment_dashboard_stats()
        self.assertEqual(self._delta(before, after, "total_non_project_inflow_30_days_count"), 1)
        self.assertAlmostEqual(self._delta(before, after, "total_non_project_inflow_30_days_amount"), 700)

    def test_non_project_outflow_is_not_netted(self):
        before = get_payment_dashboard_stats()
        self._insert(today(), 5000)
        after = get_payment_dashboard_stats()
        self.assertEqual(self._delta(before, after, "total_non_project_expense_30_days_count"), 0)
        self.assertAlmostEqual(self._delta(before, after, "total_non_project_expense_30_days_amount"), 0)

    def test_project_inflow_is_not_touched(self):
        before = get_payment_dashboard_stats()
        self._insert(today(), 5000)
        after = get_payment_dashboard_stats()
        self.assertEqual(self._delta(before, after, "total_inflow_30_days_count"), 0)
        self.assertAlmostEqual(self._delta(before, after, "total_inflow_30_days_amount"), 0)
