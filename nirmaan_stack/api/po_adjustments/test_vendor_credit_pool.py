# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Tests for the vendor credit pool listing ("Apply to this PO", `get_vendor_adjustment_credit`).

The pool lists, per source PO, the overpaid credit that PO may spend. That figure must be the
one the apply step will later accept, so it comes from the shared reader `usable_po_credit`
(#1397). These tests pin the listed amounts on the two cases the cap exists for:

  - a ledger that claims more than was really overpaid lists only the real overpayment
    (and a PO that overpaid nothing is not listed at all);
  - a ledger within the ₹1 tolerance of the real figure is listed in full, never shaved.

Fixtures are raw-SQL rows under a scratch vendor name, so the pool holds only these POs.
The endpoint does not commit; tearDown rolls back, then purges by name in case anything did.
"""

import unittest

import frappe

from nirmaan_stack.api.po_adjustments.adjustment_logic import get_vendor_adjustment_credit

PO_DOCTYPE = "Procurement Orders"
ADJ_DOCTYPE = "PO Adjustments"


class VendorCreditPoolTests(unittest.TestCase):
    def setUp(self):
        super().setUp()
        frappe.set_user("Administrator")
        self.vendor = f"TEST-1397-VENDOR-{frappe.generate_hash(length=8)}"
        self.project = frappe.db.get_value("Projects", {}, "name")
        self.pos, self.adjustments = [], []

    def tearDown(self):
        frappe.db.rollback()
        scopes = (
            (ADJ_DOCTYPE, self.adjustments),
            (PO_DOCTYPE, self.pos),
        )
        failures = []
        for doctype, names in scopes:
            try:
                for name in names:
                    frappe.db.sql(f'DELETE FROM "tab{doctype}" WHERE name=%s', (name,))
                frappe.db.commit()
            except Exception as exc:  # report, never strand the next scope
                frappe.db.rollback()
                failures.append(f"{doctype}: {exc}")
        super().tearDown()
        if failures:
            raise AssertionError("purge failed: " + "; ".join(failures))

    def _source(self, remaining, amount_paid, total_amount):
        po = f"TEST-1397-PO-{frappe.generate_hash(length=10)}"
        frappe.db.sql(
            f"""INSERT INTO "tab{PO_DOCTYPE}"
                    (name, creation, modified, modified_by, owner, docstatus, idx,
                     project, vendor, amount_paid, total_amount, status)
                VALUES (%s, NOW(), NOW(), 'Administrator', 'Administrator', 0, 0,
                        %s, %s, %s, %s, 'PO Approved')""",
            (po, self.project, self.vendor, amount_paid, total_amount),
        )
        self.pos.append(po)
        adj = f"TEST-1397-ADJ-{frappe.generate_hash(length=8)}"
        frappe.db.sql(
            f"""INSERT INTO "tab{ADJ_DOCTYPE}"
                    (name, creation, modified, modified_by, owner, docstatus, idx,
                     po_id, project, vendor, status, remaining_impact)
                VALUES (%s, NOW(), NOW(), 'Administrator', 'Administrator', 0, 0,
                        %s, %s, %s, 'Pending', %s)""",
            (adj, po, self.project, self.vendor, remaining),
        )
        self.adjustments.append(adj)
        return po

    def _listed(self, **kwargs):
        pool = get_vendor_adjustment_credit(self.vendor, **kwargs)
        return pool, {s["po_id"]: s["available"] for s in pool["sources"]}

    def test_a_phantom_ledger_lists_only_what_was_really_overpaid(self):
        nothing_paid = self._source(-4130, amount_paid=0, total_amount=20650)
        partly_real = self._source(-5000, amount_paid=11200, total_amount=10000)

        pool, listed = self._listed()

        self.assertNotIn(nothing_paid, listed)
        self.assertEqual(listed, {partly_real: 1200.0})
        self.assertEqual(pool["total_available"], 1200.0)
        self.assertEqual(pool["source_count"], 1)

    def test_a_ledger_within_the_tolerance_is_listed_in_full(self):
        rounding = self._source(-1000.52, amount_paid=11000, total_amount=10000)

        pool, listed = self._listed()

        self.assertEqual(listed, {rounding: 1000.52})
        self.assertEqual(pool["total_available"], 1000.52)

    def test_the_po_being_viewed_is_not_offered_to_itself(self):
        viewed = self._source(-500, amount_paid=10500, total_amount=10000)
        other = self._source(-300, amount_paid=10300, total_amount=10000)

        _, listed = self._listed(exclude_po=viewed)

        self.assertEqual(listed, {other: 300.0})
