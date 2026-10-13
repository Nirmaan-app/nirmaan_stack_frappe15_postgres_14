# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Recording a waiting Vendor Refund from "Adjust Payments" (#1400, ADR-0032).

The vendor says it sent money back; the bank line is not matched yet. The refund is recorded at
*Reconciliation Pending*: it moves no paid amount, amount due, vendor credit or adjustment balance,
and the PO stays payment-locked. It HOLDS its amount of the PO's overpaid credit, so a credit push
or pull can spend only the rest. While it waits, its creator or an Accountant may correct its
amount or PO; once Received, its amount and PO are fixed.

⚠️ THE ENDPOINTS COMMIT. Fixtures are raw-SQL rows (a PO, its Paid payment, its adjustment) on a
real vendor and project, purged by name in `tearDown`; the vendor's credit is put back as found.
"""

import unittest

import frappe
from frappe.utils import flt

from nirmaan_stack.api.po_adjustments._payment_utils import usable_po_credit
from nirmaan_stack.api.po_adjustments.adjustment_logic import execute_adjustment, get_po_adjustment
from nirmaan_stack.api.po_revisions.revision_po_check import check_po_in_pending_revisions
from nirmaan_stack.api.vendor_refunds import credit_fixture
from nirmaan_stack.api.vendor_refunds.waiting_refunds import record_waiting_refund, update_waiting_refund
from nirmaan_stack.services.role_profiles import (
    ACCOUNTANT_PROFILE,
    ADMIN_PROFILE,
    MATERIAL_PROCUREMENT_PROFILES,
    PMO_EXECUTIVE_PROFILE,
)
from nirmaan_stack.services.vendor_refunds import CANCELLED, RECEIVED, RECONCILIATION_PENDING

PO = "Procurement Orders"
ADJ = "PO Adjustments"
ADJ_ITEM = "PO Adjustment Items"
PAYMENT = "Project Payments"
VENDOR_REFUNDS = "Vendor Refunds"

#: The PO is worth 10,000 and was paid 11,180: 1,180 genuinely overpaid, and the ledger says so.
TOTAL, PAID, CREDIT = 10000.0, 11180.0, 1180.0


def _user_with_profile(profiles, exclude=()):
    for user in frappe.get_all(
        "Nirmaan Users", filters={"role_profile": ["in", list(profiles)]}, pluck="name", limit=20
    ):
        if user and user != "Administrator" and user not in exclude and frappe.db.exists("User", user):
            return user
    return None


class WaitingRefundFixture(unittest.TestCase):
    """Raw-SQL overpaid POs on a real vendor and project, purged by name; the vendor's credit put back."""

    def setUp(self):
        frappe.set_user("Administrator")
        self.project = frappe.db.get_value("Projects", {}, "name")
        self.vendor = frappe.db.get_value("Vendors", {}, "name")
        self.pos, self.adjustments = [], []
        self.credit = credit_fixture.snapshot([self.vendor])
        frappe.db.commit()

    def tearDown(self):
        frappe.set_user("Administrator")
        frappe.db.rollback()
        refunds = frappe.get_all(VENDOR_REFUNDS, {"document_name": ["in", self.pos or ["-"]]}, pluck="name")
        scopes = [
            ("Version", lambda: refunds and frappe.db.delete(
                "Version", {"ref_doctype": VENDOR_REFUNDS, "docname": ["in", refunds]})),
            (VENDOR_REFUNDS, lambda: refunds and frappe.db.delete(VENDOR_REFUNDS, {"name": ["in", refunds]})),
            (PAYMENT, lambda: self.pos and frappe.db.delete(
                PAYMENT, {"document_type": PO, "document_name": ["in", self.pos]})),
            (ADJ_ITEM, lambda: self.adjustments and frappe.db.delete(ADJ_ITEM, {"parent": ["in", self.adjustments]})),
            (ADJ, lambda: self.adjustments and frappe.db.delete(ADJ, {"name": ["in", self.adjustments]})),
            (PO, lambda: self.pos and frappe.db.delete(PO, {"name": ["in", self.pos]})),
            ("vendor credit", lambda: credit_fixture.restore(self.credit)),
        ]
        failures = []
        for label, purge in scopes:
            try:
                purge()
                frappe.db.commit()
            except Exception as exc:  # report, never strand the next scope
                frappe.db.rollback()
                failures.append(f"{label}: {exc}")
        if failures:
            raise AssertionError("purge failed: " + "; ".join(failures))

    # ── fixture ─────────────────────────────────────────────────────────────────

    def _overpaid_po(self, remaining=-CREDIT):
        """A PO paid 11,180 on 10,000 through one real Paid payment, its adjustment Pending at
        `remaining`. amount_due already agrees with amount_paid, so a recompute moves nothing."""
        po = f"TEST-1400-PO-{frappe.generate_hash(length=10)}"
        frappe.db.sql(
            f"""INSERT INTO "tab{PO}"
                    (name, creation, modified, modified_by, owner, docstatus, idx, project, vendor,
                     amount_paid, total_amount, amount_invoiced, amount_due, status)
                VALUES (%s, NOW(), NOW(), 'Administrator', 'Administrator', 0, 0, %s, %s,
                        %s, %s, 0, %s, 'PO Approved')""",
            (po, self.project, self.vendor, PAID, TOTAL, -PAID),
        )
        self.pos.append(po)
        frappe.db.sql(
            f"""INSERT INTO "tab{PAYMENT}"
                    (name, creation, modified, modified_by, owner, docstatus, idx,
                     document_type, document_name, project, vendor, amount, status)
                VALUES (%s, NOW(), NOW(), 'Administrator', 'Administrator', 0, 0,
                        %s, %s, %s, %s, %s, 'Paid')""",
            (f"TEST-1400-PAY-{frappe.generate_hash(length=10)}", PO, po, self.project, self.vendor, PAID),
        )
        adj = f"TEST-1400-ADJ-{frappe.generate_hash(length=8)}"
        frappe.db.sql(
            f"""INSERT INTO "tab{ADJ}"
                    (name, creation, modified, modified_by, owner, docstatus, idx,
                     po_id, project, vendor, status, remaining_impact)
                VALUES (%s, NOW(), NOW(), 'Administrator', 'Administrator', 0, 0,
                        %s, %s, %s, 'Pending', %s)""",
            (adj, po, self.project, self.vendor, remaining),
        )
        self.adjustments.append(adj)
        frappe.db.sql(
            f"""INSERT INTO "tab{ADJ_ITEM}"
                    (name, creation, modified, modified_by, owner, docstatus, idx,
                     parent, parenttype, parentfield, entry_type, amount)
                VALUES (%s, NOW(), NOW(), 'Administrator', 'Administrator', 0, 1,
                        %s, %s, 'adjustment_items', 'Revision Impact', %s)""",
            (frappe.generate_hash(length=10), adj, ADJ, remaining),
        )
        frappe.db.commit()
        return po, adj

    def _figures(self, po, adj):
        return (
            frappe.db.get_value(PO, po, ["amount_paid", "amount_due"]),
            frappe.db.get_value(ADJ, adj, ["remaining_impact", "status"]),
            frappe.db.get_value("Vendors", self.vendor, ["credit_used", "available_credit"]),
        )

    def _record(self, po, amount, **extra):
        return record_waiting_refund(
            po_id=po, amount=amount, payment_date=frappe.utils.today(), utr="TEST-1400-UTR", **extra
        )

    def _as(self, profiles, exclude=()):
        user = _user_with_profile(profiles, exclude)
        if not user:
            self.skipTest(f"no Nirmaan User with one of {profiles} on this site")
        frappe.set_user(user)
        return user



class TestRecordAWaitingRefund(WaitingRefundFixture):
    # ── recording ───────────────────────────────────────────────────────────────

    def test_a_waiting_refund_counts_for_nothing_and_holds_its_credit(self):
        po, adj = self._overpaid_po()
        before = self._figures(po, adj)
        user = self._as(MATERIAL_PROCUREMENT_PROFILES)

        result = self._record(po, 500)

        frappe.set_user("Administrator")
        refund = frappe.get_doc(VENDOR_REFUNDS, result["refund"])
        self.assertEqual(refund.status, RECONCILIATION_PENDING)
        self.assertEqual(refund.waiting_created_by, user)
        self.assertEqual(refund.vendor, self.vendor)
        self.assertEqual(refund.project, self.project)
        # Paid amount, amount due, adjustment balance and vendor credit: none of them moves.
        self.assertEqual(self._figures(po, adj), before)
        # The PO stays payment-locked, and the lock names the refund it waits for.
        lock = check_po_in_pending_revisions(po)
        self.assertTrue(lock["is_payment_locked"])
        self.assertEqual([w["name"] for w in lock["waiting_refunds"]], [refund.name])
        # Its amount is held: only the rest may be spent, and Adjust Payments is told so.
        self.assertAlmostEqual(usable_po_credit(po), CREDIT - 500, places=2)
        shown = get_po_adjustment(po)
        self.assertAlmostEqual(shown["held_credit"], 500, places=2)
        self.assertAlmostEqual(shown["usable_credit"], CREDIT - 500, places=2)
        self.assertEqual([w["name"] for w in shown["waiting_refunds"]], [refund.name])

    def test_pmo_and_admin_may_record_one_too(self):
        for profile in (PMO_EXECUTIVE_PROFILE, ADMIN_PROFILE):
            with self.subTest(profile=profile):
                po, _ = self._overpaid_po()
                self._as((profile,))
                self.assertTrue(self._record(po, 100)["refund"])
                frappe.set_user("Administrator")

    def test_a_user_outside_adjust_payments_is_refused_and_nothing_is_written(self):
        po, _ = self._overpaid_po()
        self._as((ACCOUNTANT_PROFILE,))
        with self.assertRaises(frappe.PermissionError):
            self._record(po, 100)
        frappe.set_user("Administrator")
        self.assertEqual(frappe.db.count(VENDOR_REFUNDS, {"document_name": po}), 0)

    def test_no_more_than_the_unheld_balance_may_be_recorded(self):
        po, _ = self._overpaid_po()
        with self.assertRaises(frappe.ValidationError):
            self._record(po, CREDIT + 1)
        self._record(po, 1000)
        # 1,000 of the 1,180 is now held: a second refund may take only the other 180.
        with self.assertRaises(frappe.ValidationError):
            self._record(po, 181)
        self._record(po, 180)
        self.assertEqual(usable_po_credit(po), 0.0)

    def test_a_held_credit_cannot_be_pushed_to_another_po_or_spent_ad_hoc(self):
        po, adj = self._overpaid_po()
        self._record(po, 1000)
        with self.assertRaises(frappe.ValidationError):
            execute_adjustment(po, [{"return_type": "Ad-hoc", "amount": 500}])
        self.assertEqual(frappe.db.count(PAYMENT, {"document_name": po}), 1)
        self.assertAlmostEqual(flt(frappe.db.get_value(ADJ, adj, "remaining_impact")), -CREDIT, places=2)

    def test_the_old_negative_payment_refund_is_gone(self):
        po, adj = self._overpaid_po()
        with self.assertRaises(frappe.ValidationError):
            execute_adjustment(po, [{"return_type": "Vendor-has-refund", "amount": 500}])
        self.assertEqual(frappe.db.count(PAYMENT, {"document_name": po}), 1)
        self.assertAlmostEqual(flt(frappe.db.get_value(PO, po, "amount_paid")), PAID, places=2)
        self.assertAlmostEqual(flt(frappe.db.get_value(ADJ, adj, "remaining_impact")), -CREDIT, places=2)

    # ── correcting it while it waits ────────────────────────────────────────────

    def test_its_creator_may_change_its_amount_and_po_while_it_waits(self):
        po, _ = self._overpaid_po()
        other, _ = self._overpaid_po()
        self._as(MATERIAL_PROCUREMENT_PROFILES)
        name = self._record(po, 500)["refund"]

        update_waiting_refund(refund=name, amount=700)
        update_waiting_refund(refund=name, po_id=other)

        frappe.set_user("Administrator")
        self.assertEqual(frappe.db.get_value(VENDOR_REFUNDS, name, ["amount", "document_name"]), (700, other))
        self.assertAlmostEqual(usable_po_credit(po), CREDIT, places=2)
        self.assertAlmostEqual(usable_po_credit(other), CREDIT - 700, places=2)

    def test_a_correction_may_not_raise_it_above_the_unheld_balance(self):
        po, _ = self._overpaid_po()
        name = self._record(po, 500)["refund"]
        self._record(po, 600)
        # Its own 500 is free for it; the other 600 is not.
        update_waiting_refund(refund=name, amount=580)
        with self.assertRaises(frappe.ValidationError):
            update_waiting_refund(refund=name, amount=581)

    def test_an_accountant_may_correct_it_and_nobody_else(self):
        po, _ = self._overpaid_po()
        creator = self._as(MATERIAL_PROCUREMENT_PROFILES)
        name = self._record(po, 500)["refund"]

        self._as(MATERIAL_PROCUREMENT_PROFILES + (PMO_EXECUTIVE_PROFILE,), exclude=(creator,))
        with self.assertRaises(frappe.PermissionError):
            update_waiting_refund(refund=name, amount=400)

        self._as((ACCOUNTANT_PROFILE,))
        update_waiting_refund(refund=name, amount=400)
        frappe.set_user("Administrator")
        self.assertEqual(flt(frappe.db.get_value(VENDOR_REFUNDS, name, "amount")), 400)

    def test_a_received_refund_keeps_its_amount_and_po_but_its_paperwork_stays_editable(self):
        po, _ = self._overpaid_po()
        name = self._record(po, 500)["refund"]
        frappe.db.set_value(VENDOR_REFUNDS, name, "status", RECEIVED)  # as the bank match will
        frappe.db.commit()

        with self.assertRaises(frappe.ValidationError):
            update_waiting_refund(refund=name, amount=400)
        update_waiting_refund(refund=name, utr="TEST-1400-NEW-UTR", description="proof came later")

        self.assertEqual(
            frappe.db.get_value(VENDOR_REFUNDS, name, ["amount", "utr", "description"]),
            (500, "TEST-1400-NEW-UTR", "proof came later"),
        )

    def test_a_desk_edit_obeys_the_same_rule(self):
        po, _ = self._overpaid_po()
        name = self._record(po, 500)["refund"]
        frappe.db.set_value(VENDOR_REFUNDS, name, "status", RECEIVED)
        doc = frappe.get_doc(VENDOR_REFUNDS, name)
        doc.amount = 400
        with self.assertRaises(frappe.ValidationError):
            doc.save(ignore_permissions=True)

    def test_cancelling_skips_the_refund_cap(self):
        """A cancelled refund holds nothing, so a cap that tightened since it was recorded must not
        stop it being cancelled."""
        po, _ = self._overpaid_po()
        name = self._record(po, 1000)["refund"]
        # Most of the payment goes away, so only 100 is refundable now.
        frappe.db.sql(
            f'UPDATE "tab{PAYMENT}" SET amount = 100 WHERE document_type = %s AND document_name = %s', (PO, po)
        )
        frappe.db.set_value(PO, po, "amount_paid", 100)
        doc = frappe.get_doc(VENDOR_REFUNDS, name)
        doc.status = CANCELLED
        doc.save(ignore_permissions=True)
        self.assertEqual(frappe.db.get_value(VENDOR_REFUNDS, name, "status"), CANCELLED)
