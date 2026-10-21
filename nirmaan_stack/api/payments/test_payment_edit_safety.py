# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt
"""Payment edit safety (#1536, spec #1528 stories 42-44).

  * A Desk amount edit is held to the Work Order payment limit, as a new request is (ADR-0030).
  * Fulfilling a payment marks it Paid and recounts its Work Order without saving the Work Order, so a
    Work Order that fails its own validation cannot hold the payment up.
  * Bulk approve names the payments whose tax failed, and Retry TDS (Admin) records it.

Each test acts as a real user of a role profile (`PaymentStepCase._user`) and does what that role does: a
plain `doc.save()` as Desk does, or the endpoint the screen calls.

⚠️ RUNS AGAINST THE SITE DATABASE. Planted by `TaxedWorkOrderFixture` (`TEST-TWO-*`), whose purge sweeps
every payment under its projects.
"""

import json
from unittest.mock import patch

import frappe
from frappe.utils import flt, getdate

from nirmaan_stack.api.payments.bulk_actions import bulk_lead_approve_payments, retry_bulk_deductions
from nirmaan_stack.api.payments.project_payments import update_payment_request
from nirmaan_stack.api.payments.test_payment_steps import WITHIN_L1, PaymentStepCase
from nirmaan_stack.services import payment_tds
from nirmaan_stack.services.role_profiles import ACCOUNTANT_PROFILE, ADMIN_PROFILE

PAYMENT = "Project Payments"
SR = "Service Requests"
CONTROLLER = "nirmaan_stack.integrations.controllers.project_payments"


class EditSafetyCase(PaymentStepCase):
    def setUp(self):
        super().setUp()
        # The payment saves below reach notification fan-outs to every real admin -- keep them off.
        for target in ("_notify_admins_auto_approved", "get_admin_users", "get_allowed_accountants"):
            quiet = patch(f"{CONTROLLER}.{target}", return_value=[])
            quiet.start()
            self.addCleanup(quiet.stop)

    def _plant_on(self, sr, amount, status):
        name = self._plant(amount, status)
        frappe.db.set_value(PAYMENT, name, "document_name", sr, update_modified=False)
        frappe.db.commit()
        return name

    def _amount(self, payment):
        return flt(frappe.db.get_value(PAYMENT, payment, "amount"))

    def _edit_amount_as(self, user, payment, amount):
        """The Desk form's save of a new amount."""
        def edit():
            doc = frappe.get_doc(PAYMENT, payment)
            doc.amount = amount
            doc.save()

        self._as(user, edit)


class TestADeskAmountEdit(EditSafetyCase):
    """A Desk edit that lifts a payment above its order's limit is refused (story 43)."""

    def setUp(self):
        super().setUp()
        # Base 1,00,000 + GST 18,000; no GST invoiced, so base payments are capped at 1,00,000. Fully
        # invoiced, so the invoice check passes unless a test plants a Work Order that is not.
        self.wo = self.fx.service_request(self.project, self.vendor, total=118000, gst=True, amount_invoiced=118000)
        self.accountant = self._user(ACCOUNTANT_PROFILE)

    def test_a_raise_above_base_left_is_refused(self):
        pay = self._plant_on(self.wo, 50000, "Approved")
        with self.assertRaisesRegex(
            frappe.ValidationError, r"Maximum amount you can raise this payment to is ₹ ?1,00,000.00 \(Base left\)"
        ):
            self._edit_amount_as(self.accountant, pay, 100011)
        self.assertEqual(self._amount(pay), 50000.0)

    def test_a_raise_within_the_tolerance_is_saved(self):
        pay = self._plant_on(self.wo, 50000, "Approved")
        self._edit_amount_as(self.accountant, pay, 100010)
        self.assertEqual(self._amount(pay), 100010.0)

    def test_the_other_payments_on_the_order_count(self):
        self._plant_on(self.wo, 60000, "Paid")
        pay = self._plant_on(self.wo, 30000, "Approved")
        with self.assertRaisesRegex(frappe.ValidationError, r"₹ ?40,000.00 \(Base left\)"):
            self._edit_amount_as(self.accountant, pay, 41000)
        self.assertEqual(self._amount(pay), 30000.0)

    def test_lowering_a_payment_on_an_overpaid_order_is_saved(self):
        """Lowering never takes more of the limit, so an order already paid past it can still be corrected."""
        pay = self._plant_on(self.wo, 130000, "Approved")
        self._edit_amount_as(self.accountant, pay, 120000)
        self.assertEqual(self._amount(pay), 120000.0)

    def test_a_raise_waits_for_invoices_as_a_new_request_does(self):
        """The invoice check (#1488) holds an edit too: raised money elsewhere on the order is already
        more than ₹100 above Total Amount Invoiced, so new money waits for an invoice."""
        wo = self.fx.service_request(self.project, self.vendor, total=118000, gst=True)
        self._plant_on(wo, 20000, "Requested")
        pay = self._plant_on(wo, 10000, "Approved")
        with self.assertRaisesRegex(frappe.ValidationError, "in approved invoices"):
            self._edit_amount_as(self.accountant, pay, 15000)
        self.assertEqual(self._amount(pay), 10000.0)


class TestFulfilling(EditSafetyCase):
    """Marking a payment Paid recounts its Work Order but does not save it (story 44)."""

    def test_a_work_order_that_fails_its_own_validation_does_not_hold_the_payment_up(self):
        # A Work Order whose vendor link is broken: saving it fails Frappe's link check.
        broken = self.fx.service_request(self.project, f"{self.fx._name('VEN')}-GONE", total=100000)
        accountant = self._user(ACCOUNTANT_PROFILE)
        pay = self._plant_on(broken, WITHIN_L1, "Reconciliation Pending")

        self._as(accountant, update_payment_request, json.dumps({
            "action": "fulfil", "name": pay, "utr": f"UTR-{frappe.generate_hash(length=8)}",
            "pay_date": "2026-10-20",
        }))

        self.assertEqual(self._status(pay), "Paid")
        wo = frappe.db.get_value(SR, broken, ["amount_paid", "latest_payment_date"], as_dict=True)
        self.assertEqual(flt(wo.amount_paid), float(WITHIN_L1))
        self.assertEqual(getdate(wo.latest_payment_date), getdate("2026-10-20"))


class TestRetryTds(EditSafetyCase):
    """Bulk approve names the payments whose tax failed; Retry TDS (Admin) records it (story 42)."""

    def _approve_with_a_failed_deduction(self, admin, victim, others=()):
        real = payment_tds.record_deduction

        def exploding(doc, **kw):
            if doc.name == victim:
                frappe.db.sql('SELECT * FROM "tabNo Such Table Retry Tds"')
            return real(doc, **kw)

        with patch.object(payment_tds, "record_deduction", exploding):
            return self._as(admin, bulk_lead_approve_payments, [victim, *others], "approve")["data"]

    def test_the_failed_payment_is_named_and_retry_records_its_tax(self):
        admin = self._user(ADMIN_PROFILE)
        victim, other = self._plant(WITHIN_L1, "Requested"), self._plant(WITHIN_L1, "Requested")

        result = self._approve_with_a_failed_deduction(admin, victim, [other])

        self.assertEqual(result["tds_failed"], [victim])
        self.assertEqual(self._amount(victim), float(WITHIN_L1))  # still gross

        retried = self._as(admin, retry_bulk_deductions, [victim])

        self.assertEqual((retried["tds_recorded"], retried["tds_failed"]), (1, []))
        self.assertTrue(payment_tds.existing_deduction(victim))
        self.assertEqual(self._amount(victim), WITHIN_L1 * 0.98)
        self.assertEqual(self._amount(other), WITHIN_L1 * 0.98)

    def test_a_retry_that_fails_again_names_the_payment_again(self):
        admin = self._user(ADMIN_PROFILE)
        victim = self._plant(WITHIN_L1, "Approved")
        with patch.object(payment_tds, "record_deduction", side_effect=frappe.ValidationError("still broken")):
            retried = self._as(admin, retry_bulk_deductions, [victim])
        self.assertEqual(retried["tds_failed"], [victim])
        self.assertEqual(self._amount(victim), float(WITHIN_L1))

    def test_a_payment_no_longer_approved_is_not_retried(self):
        admin = self._user(ADMIN_PROFILE)
        paid = self._plant(WITHIN_L1, "Paid")
        retried = self._as(admin, retry_bulk_deductions, [paid])
        self.assertEqual((retried["tds_recorded"], retried["tds_failed"], retried["not_approved"]), (0, [], [paid]))
        self.assertIsNone(payment_tds.existing_deduction(paid))

    def test_an_accountant_cannot_retry(self):
        victim = self._plant(WITHIN_L1, "Approved")
        with self.assertRaisesRegex(frappe.PermissionError, "Only an Admin can retry"):
            self._as(self._user(ACCOUNTANT_PROFILE), retry_bulk_deductions, [victim])
        self.assertIsNone(payment_tds.existing_deduction(victim))
