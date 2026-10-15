# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""A PO merge never strands money on a Merged PO (#1454, ADR-0034).

`handle_merge_pos` refuses, before any write, when the main PO or a PO to merge has a Project Payment
that is not Rejected, or any Vendor Refund (whatever its status). The refusal names the PO and points to
a PO Revision. POs with no payment, or only Rejected ones, still merge.

Fixtures are raw-SQL POs (status PO Approved, one raw-SQL Procurement Request) on a throwaway Won
project and a real vendor (`test_amount_paid_integrity.PaidPaymentFixture`); the master PO a merge
creates, its rows and the PO series counter it bumps are purged too.
"""

import frappe

from nirmaan_stack.api.po_merge_and_unmerge import handle_merge_pos
from nirmaan_stack.api.vendor_refunds import po_refund_fixture
from nirmaan_stack.services.test_amount_paid_drift import PO, WO
from nirmaan_stack.services.test_amount_paid_integrity import PaidPaymentFixture

PR = "Procurement Requests"
ITEM = "Purchase Order Item"


class MergeFixture(PaidPaymentFixture):
    PREFIX = "TEST-1454"

    def setUp(self):
        super().setUp()
        self.pr = f"{self.PREFIX}-PR-{frappe.generate_hash(length=8)}"
        frappe.db.sql(
            f"""INSERT INTO "tab{PR}" (name, creation, modified, modified_by, owner, docstatus, idx,
                    project, work_package, workflow_state)
                VALUES (%s, NOW(), NOW(), 'Administrator', 'Administrator', 0, 0, %s, 'Normal', 'Vendor Approved')""",
            (self.pr, self.project),
        )
        self.series_prefix = self.project.split("-")[-1]
        # `tabSeries` has no `modified` column, which `frappe.db.get_value` orders by.
        row = frappe.db.sql('SELECT "current" FROM "tabSeries" WHERE name = %s', (self.series_prefix,))
        self.series = row[0][0] if row else None
        self.error_logs = frappe.db.count("Error Log")
        frappe.db.commit()

    def tearDown(self):
        # The master PO a merge creates is in `self.orders[PO]`, so the shared purge removes it, its
        # payment terms and its Version rows; its items are removed here.
        po_refund_fixture.purge(
            [
                (ITEM, lambda: frappe.db.delete(ITEM, {"parent": ["in", self.orders[PO] or ["-"]]})),
                (PR, lambda: frappe.db.delete(PR, {"name": self.pr})),
                ("Series", self._restore_series),
            ]
        )
        super().tearDown()

    def _restore_series(self):
        if self.series is None:
            frappe.db.sql('DELETE FROM "tabSeries" WHERE name = %s', (self.series_prefix,))
        else:
            frappe.db.sql('UPDATE "tabSeries" SET "current" = %s WHERE name = %s', (self.series, self.series_prefix))

    def _approved_po(self):
        po = f"{self.PREFIX}-PO-{frappe.generate_hash(length=10)}"
        frappe.db.sql(
            f"""INSERT INTO "tab{PO}"
                    (name, creation, modified, modified_by, owner, docstatus, idx, project, vendor,
                     procurement_request, amount_paid, total_amount, amount_invoiced, amount_due, status)
                VALUES (%s, NOW(), NOW(), 'Administrator', 'Administrator', 0, 0, %s, %s, %s,
                        0, 1180, 0, 0, 'PO Approved')""",
            (po, self.project, self.vendor, self.pr),
        )
        self.orders[PO].append(po)
        frappe.db.commit()
        return po

    def _merge(self, main, *others):
        order_data = [
            {"item_id": f"ITEM-{po}", "item_name": "Test cement", "unit": "Bags", "category": "Cement",
             "quantity": 1, "quote": 1000, "tax": 18, "parent": po}
            for po in (main, *others)
        ]
        total = 1180 * len(order_data)
        result = handle_merge_pos(
            po_id=main,
            merged_items=[{"name": po} for po in others],
            order_data=order_data,
            payment_terms=[{"payment_type": "Cash", "label": "Full", "amount": total}],
        )
        merged_into = result.get("new_po_name")
        if merged_into:
            self.orders[PO].append(merged_into)
        return result

    def _statuses(self, *pos):
        return [frappe.db.get_value(PO, po, "status") for po in pos]

    def assertRefusedNaming(self, result, po, *untouched):
        self.assertEqual(result["status"], 400)
        self.assertIn(po, result["error"])
        self.assertIn("PO Revision", result["error"])
        self.assertEqual(self._statuses(*untouched), ["PO Approved"] * len(untouched))
        self.assertFalse(
            frappe.db.exists(PO, {"procurement_request": self.pr, "name": ["not like", f"{self.PREFIX}-%"]}),
            "a refused merge created a master PO",
        )
        self.assertEqual(frappe.db.count("Error Log"), self.error_logs)


class RefusedWhileMoneyIsOnAPO(MergeFixture):
    def test_each_payment_status_but_rejected_on_a_po_to_merge_refuses(self):
        for status in ("Requested", "CEO Pending", "Approved", "Reconciliation Pending", "Paid"):
            with self.subTest(status=status):
                main, other = self._approved_po(), self._approved_po()
                self._payment(PO, other, 500, status=status)

                self.assertRefusedNaming(self._merge(main, other), other, main, other)

    def test_a_payment_on_the_main_po_refuses(self):
        main, other = self._approved_po(), self._approved_po()
        self._payment(PO, main, 500, status="Requested")

        self.assertRefusedNaming(self._merge(main, other), main, main, other)

    def test_a_vendor_refund_of_any_status_refuses(self):
        for status in ("Reconciliation Pending", "Received", "Cancelled"):
            with self.subTest(status=status):
                main, other = self._approved_po(), self._approved_po()
                self._payment(PO, other, 500, status="Rejected")
                self._refund(PO, other, 100, status)

                self.assertRefusedNaming(self._merge(main, other), other, main, other)

    def test_a_payment_on_a_work_order_of_the_same_name_does_not_count(self):
        main, other = self._approved_po(), self._approved_po()
        self._payment(WO, other, 500, status="Paid")

        result = self._merge(main, other)

        self.assertEqual(result["status"], 200, result)


class MergingWithoutMoney(MergeFixture):
    def test_pos_with_no_payments_merge(self):
        main, other = self._approved_po(), self._approved_po()

        result = self._merge(main, other)

        self.assertEqual(result["status"], 200, result)
        self.assertEqual(self._statuses(main, other), ["Merged", "Merged"])

    def test_pos_with_only_rejected_payments_merge(self):
        main, other = self._approved_po(), self._approved_po()
        self._payment(PO, main, 500, status="Rejected")
        self._payment(PO, other, 700, status="Rejected")

        result = self._merge(main, other)

        self.assertEqual(result["status"], 200, result)
        self.assertEqual(self._statuses(main, other), ["Merged", "Merged"])
        self.assertEqual(
            frappe.db.get_value(PO, main, "merged"), result["new_po_name"]
        )
