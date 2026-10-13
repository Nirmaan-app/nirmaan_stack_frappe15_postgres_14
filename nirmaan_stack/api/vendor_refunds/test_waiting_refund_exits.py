# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Ways out for a waiting Vendor Refund whose bank line never comes (#1403, ADR-0032).

*Cancel* (its creator or an Accountant): the refund stays, Cancelled; it counts for nothing and holds
nothing, so the PO's overpaid credit is free again. Nothing else moves: the PO stays locked until its
balance is cleared another way. *Mark Received with no bank line* (an Admin, with a reason): it counts
at once -- the paid amount drops, the adjustment balance clears, the PO unlocks, the vendor's credit is
recounted -- and carries the "No bank proof" mark with who marked it, when and why.

⚠️ THE ENDPOINTS COMMIT. The fixture is `test_waiting_refunds.WaitingRefundFixture` (raw-SQL rows,
purged by name; the vendor's credit put back as found).
"""

import frappe
from frappe.utils import flt, get_datetime

from nirmaan_stack.api.po_adjustments._payment_utils import usable_po_credit
from nirmaan_stack.api.po_revisions.revision_po_check import check_po_in_pending_revisions
from nirmaan_stack.api.vendor_refunds.list_refunds import get_vendor_refunds
from nirmaan_stack.api.vendor_refunds.test_waiting_refunds import (
    ADJ,
    CREDIT,
    PAID,
    PO,
    VENDOR_REFUNDS,
    WaitingRefundFixture,
)
from nirmaan_stack.api.vendor_refunds.waiting_refunds import (
    cancel_waiting_refund,
    mark_received_without_bank_line,
)
from nirmaan_stack.services.role_profiles import (
    ACCOUNTANT_PROFILE,
    ADMIN_PROFILE,
    MATERIAL_PROCUREMENT_PROFILES,
    PMO_EXECUTIVE_PROFILE,
)
from nirmaan_stack.services.vendor_refunds import CANCELLED, RECEIVED, RECONCILIATION_PENDING

LEDGER = "Vendor Credit Ledger"


class TestCancelAWaitingRefund(WaitingRefundFixture):
    def _ledger_rows(self):
        return frappe.db.count(LEDGER, {"parent": self.vendor})

    def test_its_creator_cancels_it_the_hold_is_released_and_nothing_else_moves(self):
        po, adj = self._overpaid_po()
        self._as(MATERIAL_PROCUREMENT_PROFILES)
        name = self._record(po, 500)["refund"]
        frappe.set_user("Administrator")
        before, ledger_before = self._figures(po, adj), self._ledger_rows()
        self.assertAlmostEqual(usable_po_credit(po), CREDIT - 500, places=2)
        frappe.set_user(frappe.db.get_value(VENDOR_REFUNDS, name, "waiting_created_by"))

        result = cancel_waiting_refund(refund=name)

        frappe.set_user("Administrator")
        self.assertEqual(result["status"], CANCELLED)
        self.assertEqual(frappe.db.get_value(VENDOR_REFUNDS, name, "status"), CANCELLED, "the record is kept")
        self.assertAlmostEqual(usable_po_credit(po), CREDIT, places=2)
        self.assertAlmostEqual(result["usable_credit"], CREDIT, places=2)
        # Paid, due, the adjustment balance and the vendor's credit stay; no credit entry is written.
        self.assertEqual(self._figures(po, adj), before)
        self.assertEqual(self._ledger_rows(), ledger_before)
        # The PO stays locked: its balance still has to be cleared another way.
        lock = check_po_in_pending_revisions(po)
        self.assertTrue(lock["is_payment_locked"])
        self.assertEqual(lock["waiting_refunds"], [])

    def test_an_accountant_may_cancel_it_and_nobody_else(self):
        po, _ = self._overpaid_po()
        creator = self._as(MATERIAL_PROCUREMENT_PROFILES)
        name = self._record(po, 500)["refund"]

        self._as(MATERIAL_PROCUREMENT_PROFILES + (PMO_EXECUTIVE_PROFILE,), exclude=(creator,))
        with self.assertRaises(frappe.PermissionError):
            cancel_waiting_refund(refund=name)
        frappe.set_user("Administrator")
        self.assertEqual(frappe.db.get_value(VENDOR_REFUNDS, name, "status"), RECONCILIATION_PENDING)

        self._as((ACCOUNTANT_PROFILE,))
        cancel_waiting_refund(refund=name)
        frappe.set_user("Administrator")
        self.assertEqual(frappe.db.get_value(VENDOR_REFUNDS, name, "status"), CANCELLED)

    def test_a_received_refund_cannot_be_cancelled(self):
        po, _ = self._overpaid_po()
        name = self._record(po, 500)["refund"]
        mark_received_without_bank_line(refund=name, reason="test: vendor confirmed")
        with self.assertRaises(frappe.ValidationError):
            cancel_waiting_refund(refund=name)
        self.assertEqual(frappe.db.get_value(VENDOR_REFUNDS, name, "status"), RECEIVED)


class TestMarkItReceivedWithNoBankLine(WaitingRefundFixture):
    def test_an_admin_marks_it_and_it_counts_at_once(self):
        po, adj = self._overpaid_po()
        name = self._record(po, CREDIT)["refund"]
        ledger_before = frappe.db.count(LEDGER, {"parent": self.vendor})
        admin = self._as((ADMIN_PROFILE,))

        result = mark_received_without_bank_line(refund=name, reason="  Vendor confirmed by email  ")

        frappe.set_user("Administrator")
        self.assertEqual(result["status"], RECEIVED)
        doc = frappe.db.get_value(
            VENDOR_REFUNDS, name,
            ["status", "no_bank_line", "no_bank_line_by", "no_bank_line_at", "no_bank_line_reason", "amount"],
            as_dict=True,
        )
        self.assertEqual(
            (doc.status, doc.no_bank_line, doc.no_bank_line_by, doc.no_bank_line_reason, flt(doc.amount)),
            (RECEIVED, 1, admin, "Vendor confirmed by email", CREDIT),
        )
        self.assertLess(abs((get_datetime() - get_datetime(doc.no_bank_line_at)).total_seconds()), 300)
        # It counts: the paid amount drops, the balance clears, the PO unlocks, the credit is recounted.
        self.assertAlmostEqual(flt(frappe.db.get_value(PO, po, "amount_paid")), PAID - CREDIT, places=2)
        remaining, status = frappe.db.get_value(ADJ, adj, ["remaining_impact", "status"])
        self.assertEqual((abs(flt(remaining)) < 1, status), (True, "Done"))
        self.assertFalse(check_po_in_pending_revisions(po)["is_payment_locked"])
        self.assertGreater(frappe.db.count(LEDGER, {"parent": self.vendor}), ledger_before)
        # It holds nothing any more: it is Received, not waiting.
        self.assertAlmostEqual(result["held_credit"], 0, places=2)
        # The Transaction Details rows read the mark, for the "No bank proof" badge.
        row = next(r for r in get_vendor_refunds(PO, po) if r["name"] == name)
        self.assertEqual(
            (row["no_bank_line"], row["no_bank_line_by"], row["no_bank_line_reason"]),
            (1, admin, "Vendor confirmed by email"),
        )
        self.assertTrue(row["no_bank_line_at"])

    def test_only_an_admin_may_mark_it(self):
        po, _ = self._overpaid_po()
        creator = self._as(MATERIAL_PROCUREMENT_PROFILES)
        name = self._record(po, 500)["refund"]
        # Its creator, an Accountant (who may cancel it) and PMO (who may record one) may not.
        with self.assertRaises(frappe.PermissionError):
            mark_received_without_bank_line(refund=name, reason="a reason")
        for profile in (ACCOUNTANT_PROFILE, PMO_EXECUTIVE_PROFILE):
            with self.subTest(profile=profile):
                self._as((profile,), exclude=(creator,))
                with self.assertRaises(frappe.PermissionError):
                    mark_received_without_bank_line(refund=name, reason="a reason")
        frappe.set_user("Administrator")
        self.assertEqual(frappe.db.get_value(VENDOR_REFUNDS, name, "status"), RECONCILIATION_PENDING)

    def test_the_reason_is_required(self):
        po, _ = self._overpaid_po()
        name = self._record(po, 500)["refund"]
        with self.assertRaises(frappe.ValidationError):
            mark_received_without_bank_line(refund=name, reason="   ")
        self.assertEqual(
            frappe.db.get_value(VENDOR_REFUNDS, name, ["status", "no_bank_line"]), (RECONCILIATION_PENDING, 0)
        )

    def test_a_cancelled_refund_cannot_be_marked(self):
        po, _ = self._overpaid_po()
        name = self._record(po, 500)["refund"]
        cancel_waiting_refund(refund=name)
        with self.assertRaises(frappe.ValidationError):
            mark_received_without_bank_line(refund=name, reason="a reason")
        self.assertEqual(frappe.db.get_value(VENDOR_REFUNDS, name, "status"), CANCELLED)
