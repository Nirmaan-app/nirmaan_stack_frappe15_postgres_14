# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""A Received Vendor Refund lowers its project's cashflow gap (owner, 2026-10-13, spec #1396).

The gap is "paid out + liabilities - inflows". Money a vendor sent back is no longer paid out, so the
gap subtracts the Received refunds on the project's POs and Work Orders: the one paid-amount rule
(`services/vendor_refunds.LOWERS_PAID_STATUSES`) a PO's `amount_paid` already follows. A waiting refund
moves nothing. A refund turning Received, or a Received refund being deleted, re-evaluates the
project's cashflow CEO Hold, as a payment entering or leaving Paid does.

Both readers are pinned: the hold's `_compute_cashflow_gap` and the Projects list's
`get_projects_financial_rollup` outflow. ⚠️ THE ENDPOINTS COMMIT. The fixture is
`test_waiting_refunds.WaitingRefundFixture` on a scratch project row (raw insert, no hooks), purged
with its hold reasons.
"""

import frappe
from frappe.utils import flt

from nirmaan_stack.api.projects.project_aggregates import get_projects_financial_rollup
from nirmaan_stack.api.vendor_refunds.test_waiting_refunds import PAID, VENDOR_REFUNDS, WaitingRefundFixture
from nirmaan_stack.api.vendor_refunds.waiting_refunds import mark_received_without_bank_line
from nirmaan_stack.integrations.controllers.project_cashflow_hold_update import (
    _compute_cashflow_gap,
    sync_cashflow_reason,
)
from nirmaan_stack.services.ceo_hold import core as ceo_hold

REFUND = 1000.0


class TestARefundLowersTheCashflowGap(WaitingRefundFixture):
    def setUp(self):
        super().setUp()
        project = frappe.new_doc("Projects")
        project.update({"project_name": "TEST-1396-GAP", "status": "WIP"})
        project.name = f"TEST-1396-PROJ-{frappe.generate_hash(length=8)}"
        project.db_insert()
        self.project = project.name
        frappe.db.commit()

    def _purge_scopes(self):
        return super()._purge_scopes() + [
            ("CEO Hold Reason", lambda: ceo_hold.clear_all_reasons(self.project)),
            ("Projects", lambda: frappe.db.delete("Projects", {"name": self.project})),
        ]

    def _outflow(self):
        return flt(get_projects_financial_rollup()[self.project]["outflow"], 2)

    def _fresh_check(self):
        """`trigger_check` runs once per project per request, and a test run is one request."""
        frappe.flags.pop(f"ceo_hold_checked:{self.project}", None)

    def test_a_received_refund_lowers_the_gap_and_a_waiting_one_does_not(self):
        po, _adj = self._overpaid_po()
        self.assertEqual((flt(_compute_cashflow_gap(self.project), 2), self._outflow()), (PAID, PAID))

        name = self._record(po, REFUND)["refund"]
        self.assertEqual((flt(_compute_cashflow_gap(self.project), 2), self._outflow()), (PAID, PAID))

        mark_received_without_bank_line(refund=name, reason="vendor confirmed")
        self.assertEqual(
            (flt(_compute_cashflow_gap(self.project), 2), self._outflow()), (PAID - REFUND, PAID - REFUND)
        )

    def test_a_refund_turning_received_or_deleted_re_evaluates_the_cashflow_hold(self):
        po, _adj = self._overpaid_po()
        # Paid out 11,180 against a limit of 10,500: over the limit, the hold reason is set.
        frappe.db.set_value("Projects", self.project, "cashflow_gap_limit", 10500, update_modified=False)
        sync_cashflow_reason(self.project)
        frappe.db.commit()
        self.assertIn(ceo_hold.SOURCE_CASHFLOW, ceo_hold.active_sources(self.project))
        name = self._record(po, REFUND)["refund"]

        self._fresh_check()
        mark_received_without_bank_line(refund=name, reason="vendor confirmed")
        self.assertNotIn(ceo_hold.SOURCE_CASHFLOW, ceo_hold.active_sources(self.project), "10,180 is under")

        self._fresh_check()
        frappe.delete_doc(VENDOR_REFUNDS, name, ignore_permissions=True)
        frappe.db.commit()
        self.assertIn(ceo_hold.SOURCE_CASHFLOW, ceo_hold.active_sources(self.project), "back to 11,180")
