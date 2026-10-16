# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Every change to a Paid payment or a refund keeps its orders' Amount Paid right (ADR-0034, #1453).

Each test performs one real action through the document layer or an endpoint -- edit a Paid payment's
amount, move it to another order, delete it, move one into or out of Paid, receive / cancel / re-point a
refund, make a PO Adjustment payment -- and asserts THE JUDGE (`services/amount_paid_drift.mismatches`)
finds nothing on the orders involved, plus the stored figures a user would read. The CEO Hold tests
assert the cashflow check read the recounted Amount Paid: its reason names the gap worked out from it.

Fixtures are raw-SQL orders, payments and refunds on a real vendor (`test_amount_paid_drift.OrdersFixture`),
purged by name; the vendor's credit is put back. The CEO Hold tests add a throwaway project of their own.
"""

import frappe
from frappe.utils import flt

from nirmaan_stack.api.po_adjustments.adjustment_logic import execute_adjustment
from nirmaan_stack.services.amount_paid_drift import mismatches
from nirmaan_stack.services.ceo_hold.core import SOURCE_CASHFLOW, cashflow_reason_text
from nirmaan_stack.services.test_amount_paid_drift import LEDGER, PAYMENT, PO, REFUNDS, WO, OrdersFixture

ADJ = "PO Adjustments"
ADJ_ITEM = "PO Adjustment Items"


class PaidPaymentFixture(OrdersFixture):
    """A throwaway project of its own: a payment or refund saved through the document layer has its
    project link checked, and a CEO Hold check writes to it."""

    PREFIX = "TEST-1453"

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        frappe.set_user("Administrator")
        now = frappe.utils.now()[:19]
        project = frappe.new_doc("Projects")
        project.project_name = f"TEST_1453_{frappe.generate_hash(length=6)}"
        project.tendering_status = "Won"
        project.project_start_date = now
        project.project_end_date = frappe.utils.add_to_date(now, years=1)[:19]
        project.project_scopes = {"scopes": []}
        project.insert(ignore_permissions=True)
        frappe.db.commit()
        cls.test_project = project.name

    @classmethod
    def tearDownClass(cls):
        frappe.db.rollback()
        frappe.db.delete("CEO Hold Reason", {"project": cls.test_project})
        frappe.db.commit()
        frappe.delete_doc("Projects", cls.test_project, force=True, ignore_permissions=True)
        frappe.db.commit()
        super().tearDownClass()

    def setUp(self):
        super().setUp()
        self.project = self.test_project
        frappe.flags.pop(f"ceo_hold_checked:{self.project}", None)

    def _save_payment(self, name, **changes):
        doc = frappe.get_doc(PAYMENT, name)
        doc.update(changes)
        doc.save(ignore_permissions=True)
        frappe.db.commit()

    def _credit_entries(self, entry_type):
        """This test's own entries only: the vendor is a real one, so other entries of it may exist."""
        return frappe.get_all(
            LEDGER,
            filters={"parent": self.vendor, "entry_type": entry_type, "po_id": ["like", f"{self.PREFIX}%"]},
            pluck="po_id",
        )


class EditingAPaidPayment(PaidPaymentFixture):
    def test_editing_the_amount_of_a_paid_po_payment_recounts_the_po_and_its_vendors_credit(self):
        po = self._po(stored_paid=1000, total=1500)
        payment = self._payment(PO, po, 1000)

        self._save_payment(payment, amount=600)

        self.assertEqual(self._stored(PO, po), (600.0, 900.0))
        self.assertRight(PO, po)
        self.assertEqual(self._credit_entries("Payment Changed"), [po])

    def test_editing_the_amount_of_a_paid_work_order_payment_recounts_the_work_order(self):
        wo = self._wo(stored_paid=700)
        payment = self._payment(WO, wo, 700)

        self._save_payment(payment, amount=650)

        self.assertEqual(self._stored(WO, wo), (650.0, 350.0))
        self.assertRight(WO, wo)

    def test_editing_a_payment_that_is_not_paid_moves_nothing(self):
        po = self._po(stored_paid=0)
        payment = self._payment(PO, po, 1000, status="Approved")
        modified = frappe.db.get_value(PO, po, "modified")

        self._save_payment(payment, amount=600)

        self.assertEqual(frappe.db.get_value(PO, po, "modified"), modified)
        self.assertEqual(self._credit_entries("Payment Changed"), [])


class MovingAPaidPayment(PaidPaymentFixture):
    def test_moving_a_paid_payment_to_another_po_recounts_both(self):
        left = self._po(stored_paid=1000)
        joined = self._po(stored_paid=0)
        payment = self._payment(PO, left, 1000)

        self._save_payment(payment, document_name=joined)

        self.assertEqual(self._stored(PO, left), (0.0, 1000.0))
        self.assertEqual(self._stored(PO, joined), (1000.0, 0.0))
        self.assertRight(PO, left, joined)
        (entry,) = self._credit_entries("Payment Changed")
        self.assertIn(left, entry)
        self.assertIn(joined, entry)

    def test_moving_a_paid_payment_to_another_work_order_recounts_both(self):
        left = self._wo(stored_paid=300)
        joined = self._wo(stored_paid=0)
        payment = self._payment(WO, left, 300)

        self._save_payment(payment, document_name=joined)

        self.assertRight(WO, left, joined)
        self.assertEqual(self._stored(WO, joined), (300.0, 700.0))

    def test_moving_a_paid_payment_from_a_po_to_a_work_order_recounts_both(self):
        po = self._po(stored_paid=500)
        wo = self._wo(stored_paid=0)
        payment = self._payment(PO, po, 500)

        self._save_payment(payment, document_type=WO, document_name=wo)

        self.assertRight(PO, po)
        self.assertRight(WO, wo)
        self.assertEqual((self._stored(PO, po)[0], self._stored(WO, wo)[0]), (0.0, 500.0))


class DeletingOrChangingStatus(PaidPaymentFixture):
    def test_deleting_a_paid_payment_recounts_its_order(self):
        po = self._po(stored_paid=1000)
        self._payment(PO, po, 400)
        payment = self._payment(PO, po, 600)

        frappe.delete_doc(PAYMENT, payment, ignore_permissions=True, force=True)
        frappe.db.commit()

        self.assertEqual(self._stored(PO, po)[0], 400.0)
        self.assertRight(PO, po)

    def test_a_payment_moving_into_or_out_of_paid_recounts_its_order(self):
        wo = self._wo(stored_paid=0)
        payment = self._payment(WO, wo, 800, status="Approved")

        self._save_payment(payment, status="Paid")
        self.assertEqual(self._stored(WO, wo)[0], 800.0)
        self.assertRight(WO, wo)

        self._save_payment(payment, status="Rejected")
        self.assertEqual(self._stored(WO, wo)[0], 0.0)
        self.assertRight(WO, wo)


class RefundEvents(PaidPaymentFixture):
    def _save_refund(self, name, **changes):
        doc = frappe.get_doc(REFUNDS, name)
        doc.update(changes)
        doc.save(ignore_permissions=True)
        frappe.db.commit()

    def test_a_refund_turning_received_recounts_its_po(self):
        po = self._po(stored_paid=1000, payments=[1000])
        refund = self._refund(PO, po, 300, "Reconciliation Pending")

        self._save_refund(refund, status="Received")

        self.assertEqual(self._stored(PO, po)[0], 700.0)
        self.assertRight(PO, po)

    def test_a_cancelled_waiting_refund_moves_nothing(self):
        po = self._po(stored_paid=1000, payments=[1000])
        refund = self._refund(PO, po, 300, "Reconciliation Pending")

        self._save_refund(refund, status="Cancelled")

        self.assertEqual(self._stored(PO, po)[0], 1000.0)
        self.assertRight(PO, po)

    def test_a_refund_re_pointed_then_received_recounts_both_orders(self):
        first = self._po(stored_paid=1000, payments=[1000])
        second = self._po(stored_paid=1000, payments=[1000])
        refund = self._refund(PO, first, 300, "Reconciliation Pending")

        self._save_refund(refund, document_name=second)
        self._save_refund(refund, status="Received")

        self.assertEqual((self._stored(PO, first)[0], self._stored(PO, second)[0]), (1000.0, 700.0))
        self.assertRight(PO, first, second)

    def test_a_work_order_refund_received_recounts_the_work_order(self):
        wo = self._wo(stored_paid=500, payments=[500])
        refund = self._refund(WO, wo, 100, "Reconciliation Pending")

        self._save_refund(refund, status="Received")

        self.assertEqual(self._stored(WO, wo), (400.0, 600.0))
        self.assertRight(WO, wo)


class CashflowCheckReadsTheRecountedFigure(PaidPaymentFixture):
    """The cashflow gap's liabilities read each PO's stored Amount Paid (delivered - paid), so a check
    run before the recount reads a different gap from one run after it."""

    def setUp(self):
        super().setUp()
        self.adjustments = []

    def tearDown(self):
        adjustments = self.adjustments
        super().tearDown()
        frappe.db.delete(ADJ_ITEM, {"parent": ["in", adjustments or ["-"]]})
        frappe.db.delete(ADJ, {"name": ["in", adjustments or ["-"]]})
        frappe.db.set_value("Projects", self.project, "cashflow_gap_limit", 0)
        frappe.db.delete("CEO Hold Reason", {"project": self.project})
        frappe.db.commit()

    def _limit(self, limit):
        frappe.db.set_value("Projects", self.project, "cashflow_gap_limit", limit)
        frappe.db.commit()
        frappe.flags.pop(f"ceo_hold_checked:{self.project}", None)

    def _delivered(self, po, delivered):
        frappe.db.set_value(PO, po, "po_amount_delivered", delivered)
        frappe.db.commit()

    def _cashflow_reason(self):
        return frappe.db.get_value(
            "CEO Hold Reason", {"project": self.project, "source": SOURCE_CASHFLOW}, "reason_text"
        )

    def test_editing_a_paid_payments_amount_checks_the_gap_on_the_recounted_po(self):
        # Delivered 1,000, paid 1,000 -> gap 1,000. Cut the payment to 400: outflow 400, liabilities
        # 1,000 - 400 = 600, gap still 1,000. A check reading the stale 1,000 paid would see 400.
        po = self._po(stored_paid=1000)
        self._delivered(po, 1000)
        payment = self._payment(PO, po, 1000)
        self._limit(700)

        self._save_payment(payment, amount=400)

        self.assertEqual(self._cashflow_reason(), cashflow_reason_text(1000, 700))

    def test_deleting_a_paid_payment_checks_the_gap_once_it_is_gone(self):
        # Delivered 1,000, paid 600 + 400. Delete the 400: outflow 600, liabilities 400, gap 1,000. A
        # check run while the row is still there counts it as paid out (outflow 1,000, gap 1,400).
        po = self._po(stored_paid=1000)
        self._delivered(po, 1000)
        self._payment(PO, po, 600)
        payment = self._payment(PO, po, 400)
        self._limit(900)

        frappe.delete_doc(PAYMENT, payment, ignore_permissions=True, force=True)
        frappe.db.commit()

        self.assertEqual(self._cashflow_reason(), cashflow_reason_text(1000, 900))

    def test_a_po_adjustment_payment_is_checked_after_its_po_is_recounted(self):
        # Worth 10,000, delivered 11,000, paid 11,180: 1,180 overpaid. An Ad-hoc return of 1,180 makes
        # a -1,180 payment: outflow 10,000, paid 10,000, liabilities 1,000, gap 11,000. A check run on
        # the payment's insert, before the recount, reads paid 11,180 and a gap of 10,000.
        po = self._po(stored_paid=11180, payments=[11180], total=10000)
        self._delivered(po, 11000)
        adj = f"{self.PREFIX}-ADJ-{frappe.generate_hash(length=8)}"
        frappe.db.sql(
            f"""INSERT INTO "tab{ADJ}" (name, creation, modified, modified_by, owner, docstatus, idx,
                    po_id, project, vendor, status, remaining_impact)
                VALUES (%s, NOW(), NOW(), 'Administrator', 'Administrator', 0, 0, %s, %s, %s, 'Pending', -1180)""",
            (adj, po, self.project, self.vendor),
        )
        frappe.db.sql(
            f"""INSERT INTO "tab{ADJ_ITEM}" (name, creation, modified, modified_by, owner, docstatus, idx,
                    parent, parenttype, parentfield, entry_type, amount)
                VALUES (%s, NOW(), NOW(), 'Administrator', 'Administrator', 0, 1, %s, %s,
                        'adjustment_items', 'Revision Impact', -1180)""",
            (frappe.generate_hash(length=10), adj, ADJ),
        )
        self.adjustments.append(adj)
        self._limit(10500)

        execute_adjustment(po, [{"return_type": "Ad-hoc", "amount": 1180}])

        self.assertEqual(flt(frappe.db.get_value(PO, po, "amount_paid")), 10000.0)
        self.assertEqual(mismatches(PO, [po]), [])
        self.assertEqual(self._cashflow_reason(), cashflow_reason_text(11000, 10500))
