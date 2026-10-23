# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""A cheque payment is Paid only when its cheque clears from the bank statement (#1552, spec #1514, ADR-0035
Amendment B).

Two seams. The user-facing ways to pay one payment (Bulk Import's settle by hand, the payments screen's
fulfil) refuse a payment on any Payment cheque, Old-type ones included. Under them, the payment's own save
refuses a move into or out of Paid that is not the cheques service clearing the cheque, and refuses a
payment in Cheque mode that no cheque lists. Each test reads back what a user sees: the refusal, the
payment's status, the cheque's status.

⚠️ RUNS AGAINST THE ENV DATABASE (the endpoints commit). Fixtures purge every row they plant.
"""

import frappe

from nirmaan_stack.api.cheques.cheque_fixture import ChequeFixture
from nirmaan_stack.api.outflow_import.expenses import settle_row
from nirmaan_stack.api.outflow_import.test_cheque_bank_import import ChequeImportCase
from nirmaan_stack.api.payments.project_payments import update_payment_request

PAYMENT = "Project Payments"
RP = "Reconciliation Pending"
PAID_ALONE = "when a bank-statement line with the cheque's number and amount is imported"


class TestAnOldTypeChequePaymentIsNeverPaidAlone(ChequeImportCase):
    """Old-type cheques follow the same rule as any Payment cheque (Amendment B, decision 2)."""

    def test_settling_one_by_hand_from_a_bank_line_is_refused(self):
        number = self._number()
        a, b = self._payment(30000, RP), self._payment(20000, RP)
        cheque = self._old_type(number, 50000, [(a, 30000), (b, 20000)])
        (row,) = self._import((self._number(), 30000))  # a line naming no cheque

        with self.assertRaisesRegex(frappe.ValidationError, f"{a} is paid by cheque {number}.*{PAID_ALONE}"):
            settle_row(row, PAYMENT, a)
        frappe.db.rollback()

        self.assertEqual(self._statuses(a, b), [RP, RP])
        self.assertEqual(self._state(cheque).status, "Issued")
        self.assertEqual(self._legs(row), [])

    def test_the_refusal_names_the_cheque_s_own_number(self):
        number = self._number()
        a = self._payment(30000, RP)
        self._old_type(number, 30000, [(a, 30000)])
        # A payment's own copy of the number can be stale (raw: test setup); the cheque's is the one shown.
        frappe.db.set_value(PAYMENT, a, "cheque_no", "000000", update_modified=False)
        frappe.db.commit()

        with self.assertRaisesRegex(frappe.ValidationError, f"{a} is paid by cheque {number},"):
            update_payment_request(frappe.as_json({"action": "fulfil", "name": a, "utr": "UTR1552NM"}))
        frappe.db.rollback()

    def test_fulfilling_one_on_the_payments_screen_is_refused(self):
        number = self._number()
        a, b = self._payment(30000, RP), self._payment(20000, RP)
        cheque = self._old_type(number, 50000, [(a, 30000), (b, 20000)])

        with self.assertRaisesRegex(frappe.ValidationError, f"{a} is paid by cheque {number}.*{PAID_ALONE}"):
            update_payment_request(frappe.as_json({"action": "fulfil", "name": a, "utr": "UTR1552OT"}))
        frappe.db.rollback()

        self.assertEqual(self._statuses(a, b), [RP, RP])
        self.assertEqual(self._state(cheque).status, "Issued")


PAID_BY_CLEAR = "a cheque's payments are paid when a bank-statement line with the cheque's number and amount is imported"


class TestTheSaveRefusesPaidOutsideTheClear(ChequeImportCase):
    """The payment's own save holds the rule for every path, Desk and REST included (Amendment B)."""

    def _save_as(self, payment, status, **values):
        pay = frappe.get_doc(PAYMENT, payment)
        pay.update({"status": status, **values})
        pay.save(ignore_permissions=True)

    def test_saving_an_issued_cheque_s_payment_as_paid_is_refused(self):
        cheque, (a, b) = self._issued(30000, 12000)

        self._refused(f"{a} is a cheque payment.*{PAID_BY_CLEAR}", self._save_as, a, "Paid", utr="UTR1552D")

        self.assertEqual(self._statuses(a, b), [RP, RP])
        self.assertEqual(self._state(cheque).status, "Issued")

    def test_saving_an_old_type_cheque_s_payment_as_paid_is_refused(self):
        a = self._payment(30000, RP)
        cheque = self._old_type(self._number(), 30000, [(a, 30000)])

        self._refused(f"{a} is a cheque payment.*{PAID_BY_CLEAR}", self._save_as, a, "Paid")

        self.assertEqual(self._statuses(a), [RP])
        self.assertEqual(self._state(cheque).status, "Issued")

    def test_a_new_cheque_payment_cannot_be_inserted_paid(self):
        po = self._po()
        pay = frappe.new_doc(PAYMENT)
        pay.update({
            "document_type": "Procurement Orders", "document_name": po, "project": self.project, "vendor": self.vendor,
            "amount": 5000, "status": "Paid", "mode_of_payment": "Cheque", "cheque_no": self._number(),
            "cheque_date": self.day,
        })

        self._refused(f"is a cheque payment.*{PAID_BY_CLEAR}", pay.insert, ignore_permissions=True)

        self.assertFalse(frappe.db.exists(PAYMENT, {"document_name": po}))

    def test_clearing_the_cheque_still_pays_every_payment_on_it(self):
        cheque, (a, b) = self._issued(30000, 12000)

        self._clear_by_bank(cheque)

        self.assertEqual(self._statuses(a, b), ["Paid", "Paid"])
        self.assertEqual(self._state(cheque).status, "Cleared")

    def test_a_cleared_cheque_s_payment_cannot_be_saved_back_from_paid(self):
        cheque, (a,) = self._issued(30000)
        self._clear_by_bank(cheque)

        self._refused(f"{a} is a Paid cheque payment, so it cannot be moved to {RP}.*never set back",
                      self._save_as, a, RP)

        self.assertEqual(self._statuses(a), ["Paid"])
        self.assertEqual(self._state(cheque).status, "Cleared")

    def test_any_other_edit_of_a_paid_cheque_payment_is_saved(self):
        cheque, (a,) = self._issued(30000)
        self._clear_by_bank(cheque)

        self._save_as(a, "Paid", utr="UTR1552-EDITED")
        frappe.db.commit()

        self.assertEqual(frappe.db.get_value(PAYMENT, a, ["status", "utr"]), ("Paid", "UTR1552-EDITED"))


ON_NO_CHEQUE = "no cheque lists it.*a cheque payment always has its cheque. An Admin can switch its Mode of Payment to Online in Desk"


class TestAChequePaymentAlwaysHasItsCheque(ChequeImportCase):
    """A payment in Cheque mode that no cheque lists, as a failed Request Payment could leave one, is refused
    at save (Amendment B, decision 3)."""

    def _on_no_cheque(self, status):
        return ChequeFixture.plant_payment(self.fx, status, project=self.project, vendor=self.vendor,
                                           document=("Procurement Orders", self._po()), amount=20000,
                                           cheque_no=self._number())

    def _save_as(self, payment, status):
        pay = frappe.get_doc(PAYMENT, payment)
        pay.status = status
        pay.save(ignore_permissions=True)

    def test_approving_one_is_refused(self):
        a = self._on_no_cheque("Requested")

        self._refused(f"{a} is in Cheque mode, but {ON_NO_CHEQUE}", self._save_as, a, "Approved")

        self.assertEqual(self._statuses(a), ["Requested"])

    def test_saving_a_reconciliation_pending_one_is_told_to_switch_it_to_online(self):
        a = self._on_no_cheque(RP)

        self._refused(f"{a} is in Cheque mode, but {ON_NO_CHEQUE}", self._save_as, a, RP)

        self.assertEqual(self._statuses(a), [RP])

    def test_paying_one_is_refused_at_the_service_seam_too(self):
        a = self._on_no_cheque(RP)

        with self.assertRaisesRegex(frappe.ValidationError, f"{a} is in Cheque mode, but {ON_NO_CHEQUE}"):
            update_payment_request(frappe.as_json({"action": "fulfil", "name": a, "utr": "UTR1552NC"}))
        frappe.db.rollback()

        self.assertEqual(self._statuses(a), [RP])

    def test_a_paid_one_the_backfill_left_on_no_cheque_still_saves_other_edits(self):
        a = self._on_no_cheque("Paid")

        pay = frappe.get_doc(PAYMENT, a)
        pay.utr = "UTR1552-LEGACY"
        pay.save(ignore_permissions=True)
        frappe.db.commit()

        self.assertEqual(frappe.db.get_value(PAYMENT, a, ["status", "utr"]), ("Paid", "UTR1552-LEGACY"))

    def test_a_new_one_inserted_outside_request_payment_is_refused(self):
        """Desk or REST: only Request Payment inserts a Cheque-mode payment, and makes its cheque right after
        (`test_cheque_request` holds that path)."""
        po = self._po()
        pay = frappe.new_doc(PAYMENT)
        pay.update({
            "document_type": "Procurement Orders", "document_name": po, "project": self.project, "vendor": self.vendor,
            "amount": 5000, "status": "Requested", "mode_of_payment": "Cheque", "cheque_no": self._number(),
            "cheque_date": self.day,
        })

        self._refused(f"is in Cheque mode, but {ON_NO_CHEQUE}", pay.insert, ignore_permissions=True)

        self.assertFalse(frappe.db.exists(PAYMENT, {"document_name": po}))

    def test_rejecting_one_is_saved(self):
        a = self._on_no_cheque("Requested")

        self._save_as(a, "Rejected")
        frappe.db.commit()

        self.assertEqual(self._statuses(a), ["Rejected"])

    def test_a_payment_whose_line_dropped_off_its_old_type_cheque_stays_rejected_and_editable(self):
        a, b = self._payment(30000, RP), self._payment(20000, RP)
        self._old_type(self._number(), 50000, [(a, 30000), (b, 20000)])
        self._save_as(a, "Rejected")  # its line drops off the cheque (#1413)
        frappe.db.commit()

        pay = frappe.get_doc(PAYMENT, a)
        pay.utr = "UTR1552-NOTE"
        pay.save(ignore_permissions=True)
        frappe.db.commit()

        self.assertEqual(frappe.db.get_value(PAYMENT, a, ["status", "utr"]), ("Rejected", "UTR1552-NOTE"))
