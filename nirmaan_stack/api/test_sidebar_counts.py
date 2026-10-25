# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""The sidebar's Work Order counts (spec #1528 story 21).

Run: DEVENV test --module nirmaan_stack.api.test_sidebar_counts

⚠️ RUNS AGAINST THE SITE DATABASE. Counts are read as the change one planted Work Order makes, so the
site's own Work Orders don't matter. Rows are planted with the GST Hold fixture (`TEST-GSTH-*`).
"""

import json

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.sidebar_counts import sidebar_counts
from nirmaan_stack.api.vendor.test_gst_hold import U, _Fixture


class TestWorkOrderCounts(FrappeTestCase):
    def setUp(self):
        super().setUp()
        frappe.set_user(U)
        self.fx = _Fixture()
        self.addCleanup(self.fx.purge)
        self.project, self.vendor = self.fx.project(), self.fx.vendor()

    def _sr_counts(self):
        return json.loads(sidebar_counts(U))["sr"]

    def test_all_wo_counts_a_work_order_under_amendment_as_the_list_shows_it(self):
        before = self._sr_counts()
        self.fx.work_order(self.project, self.vendor, 1000, status="Amendment")
        frappe.db.commit()
        after = self._sr_counts()
        self.assertEqual((after["all"] - before["all"], after["amended"] - before["amended"]), (1, 1))
