# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Nobody types Amount Paid by hand; the system still writes it (#1454, ADR-0034).

`amount_paid` and `amount_due` are read-only on Procurement Orders and Service Requests, so the Desk form
offers no input for them. Read-only only shapes the form: the system writers (`write_amount_paid`, PO
Adjustments' `_recalculate_amount_paid`, the payment save) write through `set_value`, which it does not
touch. Fixtures: `test_amount_paid_drift.OrdersFixture`.
"""

import frappe

from nirmaan_stack.api.po_adjustments._payment_utils import _recalculate_amount_paid
from nirmaan_stack.services.test_amount_paid_drift import PO, WO
from nirmaan_stack.services.test_amount_paid_integrity import PaidPaymentFixture
from nirmaan_stack.services.amount_paid import write_amount_paid


class AmountPaidIsReadOnlyInDesk(PaidPaymentFixture):
    PREFIX = "TEST-1454-RO"

    def test_amount_paid_and_amount_due_are_read_only_on_pos_and_work_orders(self):
        read_only = {
            (doctype, field): frappe.get_meta(doctype).get_field(field).read_only
            for doctype in (PO, WO)
            for field in ("amount_paid", "amount_due")
        }

        self.assertEqual(set(read_only.values()), {1}, read_only)

    def test_the_legacy_tds_box_on_a_payment_is_read_only(self):
        """A PO payment's tax counts from its deduction record, and a filled legacy `tds` box marks it as
        stored gross (spec #1528 story 53): a hand edit of the box would change PO tax counting."""
        self.assertEqual(frappe.get_meta("Project Payments").get_field("tds").read_only, 1)

    def test_the_single_writer_still_writes_a_po_and_a_work_order(self):
        po = self._po(stored_paid=0, payments=[500])
        wo = self._wo(stored_paid=0, payments=[400])

        write_amount_paid(PO, po)
        write_amount_paid(WO, wo)

        self.assertEqual((self._stored(PO, po), self._stored(WO, wo)), ((500.0, 500.0), (400.0, 600.0)))

    def test_a_po_adjustment_recount_still_writes(self):
        po = self._po(stored_paid=0, payments=[700])

        _recalculate_amount_paid(po)

        self.assertEqual(self._stored(PO, po), (700.0, 300.0))
        self.assertRight(PO, po)

    def test_a_paid_payment_saved_through_the_document_layer_still_recounts(self):
        po = self._po(stored_paid=1000, payments=[1000])
        (payment,) = frappe.get_all("Project Payments", {"document_name": po}, pluck="name")

        self._save_payment(payment, amount=250)

        self.assertEqual(self._stored(PO, po), (250.0, 750.0))
        self.assertRight(PO, po)
