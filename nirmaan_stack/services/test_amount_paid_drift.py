# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Tests for finding and recounting a PO whose stored Amount Paid has drifted from its source.

Source = the PO's Paid Project Payments less its Received Vendor Refunds (`amount_paid_of`). A drifted PO
is recounted from that source, with its Amount Due and its vendor's credit; a PO already right is left
alone. Fixtures are raw-SQL rows on a real vendor and project, purged by name; the vendor's credit is put
back.
"""

import unittest

import frappe
from frappe.utils import flt

from nirmaan_stack.api.vendor_refunds import credit_fixture, po_refund_fixture
from nirmaan_stack.api.vendor_refunds.po_refund_fixture import PAYMENT, PO
from nirmaan_stack.services.amount_paid_drift import drifted_pos, recount_pos

ENTRY = "TEST Amount Paid Recount"
LEDGER = "Vendor Credit Ledger"


class AmountPaidDriftTests(unittest.TestCase):
    def setUp(self):
        frappe.set_user("Administrator")
        # The rows are raw SQL, so the project is only a label; the vendor must be real, with the
        # credit limit its credit recount reads.
        self.project = "TEST-RECOUNT-PROJECT"
        self.vendor = frappe.db.get_value("Vendors", {"credit_limit": [">", 0]}, "name")
        self.pos = []
        self.credit = credit_fixture.snapshot([self.vendor])
        frappe.db.commit()

    def tearDown(self):
        frappe.db.rollback()
        refunds = frappe.get_all("Vendor Refunds", {"document_name": ["in", self.pos or ["-"]]}, pluck="name")
        po_refund_fixture.purge(
            po_refund_fixture.po_scopes(self.pos, [], refunds)
            + [("vendor credit", lambda: credit_fixture.restore(self.credit))]
        )

    # ── fixture ─────────────────────────────────────────────────────────────────

    def _po(self, stored_paid, payments, total=1000.0):
        """A PO invoiced and worth `total`, storing `stored_paid`, with one Paid payment per amount."""
        po = f"TEST-RECOUNT-PO-{frappe.generate_hash(length=10)}"
        frappe.db.sql(
            f"""INSERT INTO "tab{PO}"
                    (name, creation, modified, modified_by, owner, docstatus, idx, project, vendor,
                     amount_paid, total_amount, amount_invoiced, amount_due, status)
                VALUES (%s, '2026-01-01', '2026-01-01', 'Administrator', 'Administrator', 0, 0, %s, %s,
                        %s, %s, %s, %s, 'Delivered')""",
            (po, self.project, self.vendor, stored_paid, total, total, total - stored_paid),
        )
        for amount in payments:
            frappe.db.sql(
                f"""INSERT INTO "tab{PAYMENT}"
                        (name, creation, modified, modified_by, owner, docstatus, idx,
                         document_type, document_name, project, vendor, amount, status)
                    VALUES (%s, NOW(), NOW(), 'Administrator', 'Administrator', 0, 0,
                            %s, %s, %s, %s, %s, 'Paid')""",
                (f"TEST-RECOUNT-PAY-{frappe.generate_hash(length=10)}", PO, po, self.project, self.vendor, amount),
            )
        self.pos.append(po)
        frappe.db.commit()
        return po

    def _refund(self, po, amount, status):
        frappe.db.sql(
            """INSERT INTO "tabVendor Refunds"
                    (name, creation, modified, modified_by, owner, docstatus, idx, vendor, project,
                     document_type, document_name, status, amount, payment_date)
                VALUES (%s, NOW(), NOW(), 'Administrator', 'Administrator', 0, 0, %s, %s,
                        %s, %s, %s, %s, CURRENT_DATE)""",
            (f"TEST-RECOUNT-VRF-{frappe.generate_hash(length=8)}", self.vendor, self.project, PO, po, status, amount),
        )
        frappe.db.commit()

    def _stored(self, po):
        values = frappe.db.get_value(PO, po, ["amount_paid", "amount_due"], as_dict=True)
        return flt(values.amount_paid, 2), flt(values.amount_due, 2)

    # ── finding ─────────────────────────────────────────────────────────────────

    def test_finds_only_the_po_whose_stored_paid_differs_from_its_payments_and_writes_nothing(self):
        stale = self._po(stored_paid=400, payments=[600, 400])
        right = self._po(stored_paid=1000, payments=[1000])

        found = drifted_pos([stale, right])

        self.assertEqual([(r.name, r.stored, r.source) for r in found], [(stale, 400.0, 1000.0)])
        self.assertEqual(self._stored(stale), (400.0, 600.0))

    def test_a_received_refund_is_part_of_the_source_and_a_waiting_one_is_not(self):
        received = self._po(stored_paid=1000, payments=[1000])
        self._refund(received, 200, "Received")
        waiting = self._po(stored_paid=1000, payments=[1000])
        self._refund(waiting, 200, "Reconciliation Pending")

        found = drifted_pos([received, waiting])

        self.assertEqual([(r.name, r.source) for r in found], [(received, 800.0)])

    # ── recounting ──────────────────────────────────────────────────────────────

    def test_recount_sets_paid_and_due_from_source_and_leaves_a_right_po_untouched(self):
        stale = self._po(stored_paid=400, payments=[600, 400])
        right = self._po(stored_paid=1000, payments=[1000])
        right_modified = frappe.db.get_value(PO, right, "modified")

        changed = recount_pos([stale, right], ENTRY)

        self.assertEqual([r.name for r in changed], [stale])
        self.assertEqual(self._stored(stale), (1000.0, 0.0))
        self.assertEqual(frappe.db.get_value(PO, right, "modified"), right_modified)
        self.assertEqual(drifted_pos([stale, right]), [])

    def test_recount_recounts_the_vendors_credit_once_under_the_given_entry(self):
        first = self._po(stored_paid=0, payments=[500])
        second = self._po(stored_paid=0, payments=[700])

        recount_pos([first, second], ENTRY)

        entries = frappe.get_all(LEDGER, filters={"parent": self.vendor, "entry_type": ENTRY}, pluck="po_id")
        self.assertEqual(len(entries), 1)
        self.assertIn(first, entries[0])
        self.assertIn(second, entries[0])

    def test_recount_of_pos_already_right_writes_no_credit_entry(self):
        right = self._po(stored_paid=1000, payments=[1000])

        self.assertEqual(recount_pos([right], ENTRY), [])
        self.assertFalse(frappe.get_all(LEDGER, filters={"parent": self.vendor, "entry_type": ENTRY}))
