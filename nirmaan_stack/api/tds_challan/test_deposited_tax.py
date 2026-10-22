# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Deposited tax stays safe (#1535, spec #1528 stories 36-41).

Tax that has gone to the government under a challan can't disappear, and tax is never held for money
that didn't go out:
  * a payment whose deduction is in a challan can't be deleted, have its amount changed, or be rejected;
  * rejecting a payment whose tax is not deposited removes its deduction and puts its amount back to the
    full bill;
  * Pay TDS takes tax only from Paid payments;
  * a deduction's figures may be corrected in Desk until its tax is in a challan, and each correction
    recounts the Work Order; after that it is locked.

Driven through the real doors, as the role that uses them: an Accountant deletes through
`update_payment_request`, edits in Desk (a document save), deposits through Pay TDS; the CEO rejects by
saving the status, as the approval screen does. Approval is `ceo_approve_payment` (`TaxedWorkOrderFixture`).
Marking a payment Paid is this suite's input, not what it tests, so it is a `set_value` plus the recount
the Paid save would run.

⚠️ RUNS AGAINST THE SITE DATABASE. Everything is `TEST-TWO-*` (purged by `TaxedWorkOrderFixture`), plus
the challans and the Accountant user made here, removed in cleanup.
"""

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import flt, nowdate

from nirmaan_stack.api.payments.project_payments import update_payment_request
from nirmaan_stack.api.payments.taxed_work_order_fixture import TaxedWorkOrderFixture
from nirmaan_stack.api.tds_challan.pay_tds import create_challan_and_pay, pay_tds
from nirmaan_stack.constants.authorized_users import CEO_AUTHORIZED_USER
from nirmaan_stack.services.amount_paid import write_amount_paid

PAYMENT = "Project Payments"
PTD = "Payment TDS Deduction"
CHALLAN = "TDS Challan Attachment"
SR = "Service Requests"
ACCOUNTANT = "Nirmaan Accountant"


class DepositedTaxCase(FrappeTestCase):
    def setUp(self):
        frappe.set_user("Administrator")
        self.fx = TaxedWorkOrderFixture.attach(self)
        self.challans: list[str] = []
        self.addCleanup(self._drop_challans)
        self.email = f"test-1535-acct-{frappe.generate_hash(length=6)}@example.com"
        frappe.get_doc({
            "doctype": "User", "email": self.email, "first_name": "Deposited Tax", "send_welcome_email": 0,
            "roles": [{"role": ACCOUNTANT}],
        }).insert(ignore_permissions=True)
        frappe.db.commit()
        self.addCleanup(self._drop_user)

    # -- cleanup ----------------------------------------------------------------------------------
    def _drop_user(self):
        frappe.set_user("Administrator")
        frappe.db.rollback()
        frappe.delete_doc("User", self.email, force=True, ignore_permissions=True)
        for contact in frappe.get_all("Contact", {"email_id": self.email}, pluck="name"):
            frappe.delete_doc("Contact", contact, force=True, ignore_permissions=True)
        frappe.db.commit()

    def _drop_challans(self):
        frappe.set_user("Administrator")
        frappe.db.rollback()
        if self.challans:
            frappe.db.sql(f'UPDATE "tab{PTD}" SET tds_challan = NULL WHERE tds_challan IN %s', (tuple(self.challans),))
            frappe.db.delete("Version", {"ref_doctype": CHALLAN, "docname": ["in", self.challans]})
            frappe.db.delete(CHALLAN, {"name": ["in", self.challans]})
        frappe.db.commit()

    # -- arrangement ------------------------------------------------------------------------------
    def _as(self, user, action, *args, **kwargs):
        frappe.set_user(user)
        try:
            return action(*args, **kwargs)
        finally:
            frappe.set_user("Administrator")

    def _as_accountant(self, action, *args, **kwargs):
        return self._as(self.email, action, *args, **kwargs)

    def _approved(self, gross=10000.0):
        """An Approved Work Order payment, cut by the real approval: 10,000 at 2% -> 9,800 + 200."""
        return self.fx.payment(gross)

    def _mark_paid(self, made):
        frappe.db.set_value(PAYMENT, made.name, {"status": "Paid", "payment_date": nowdate()})
        write_amount_paid(SR, made.service_request)
        frappe.db.commit()

    def _challan_data(self, amount):
        key = frappe.generate_hash(length=8)
        return {
            "financial_year": "2026-27", "amount": amount, "date_of_deposit": nowdate(),
            "bank_reference_number": f"T1535{key}", "bsr_code": "0006900", "challan_no": key,
            "challan_attachment": "/private/files/test-1535-challan.pdf",
        }

    def _deposit(self, made, amount=1000.0):
        """Pay this payment's tax under a new challan, as an Accountant does with Pay TDS."""
        result = self._as_accountant(create_challan_and_pay, [made.deduction], self._challan_data(amount))
        self.challans.append(result["created_challan"])
        return result["created_challan"]

    def _empty_challan(self, amount=1000.0):
        doc = frappe.get_doc({"doctype": CHALLAN, **self._challan_data(amount)}).insert(ignore_permissions=True)
        frappe.db.commit()
        self.challans.append(doc.name)
        return doc.name

    def _deposited_before_this_rule(self, made, challan):
        """A deduction put in a challan while its payment was still Approved: Pay TDS allowed it before #1535."""
        frappe.db.set_value(PTD, made.deduction, {"tds_challan": challan, "status": "Paid"})
        frappe.db.set_value(CHALLAN, challan, "reconciled_amount", made.tds)
        frappe.db.commit()

    def _wo(self, made):
        return frappe.db.get_value(
            SR, made.service_request, ["total_amount", "amount_paid", "total_tds", "amount_due"], as_dict=True
        )

    def _reconciled(self, challan):
        return flt(frappe.db.get_value(CHALLAN, challan, "reconciled_amount"))

    def assertRefusedNaming(self, challan, action, *args, **kwargs):
        with self.assertRaises(frappe.ValidationError) as caught:
            action(*args, **kwargs)
        frappe.db.rollback()
        self.assertIn(challan, str(caught.exception))


class TestAPaymentWhoseTaxIsDeposited(DepositedTaxCase):
    def setUp(self):
        super().setUp()
        self.made = self._approved()
        self._mark_paid(self.made)
        self.challan = self._deposit(self.made)

    def test_it_cannot_be_deleted(self):
        self.assertRefusedNaming(
            self.challan, self._as_accountant, update_payment_request,
            frappe.as_json({"action": "delete", "name": self.made.name}),
        )
        self.assertTrue(frappe.db.exists(PAYMENT, self.made.name))
        self.assertTrue(frappe.db.exists(PTD, self.made.deduction))
        self.assertEqual(self._reconciled(self.challan), 200)

    def test_its_amount_cannot_be_lowered(self):
        def lower():
            doc = frappe.get_doc(PAYMENT, self.made.name)
            doc.amount = 8820
            doc.save()

        self.assertRefusedNaming(self.challan, self._as_accountant, lower)
        self.assertEqual(flt(frappe.db.get_value(PAYMENT, self.made.name, "amount")), 9800)
        self.assertEqual(flt(frappe.db.get_value(PTD, self.made.deduction, "tds_amount")), 200)
        self.assertEqual(self._reconciled(self.challan), 200)

    def test_its_deduction_cannot_be_corrected(self):
        def correct():
            row = frappe.get_doc(PTD, self.made.deduction)
            row.tds_amount = 300
            row.save()

        self.assertRefusedNaming(self.challan, self._as_accountant, correct)
        self.assertEqual(flt(frappe.db.get_value(PTD, self.made.deduction, "tds_amount")), 200)
        self.assertEqual(self._reconciled(self.challan), 200)

    def test_its_deduction_cannot_be_deleted(self):
        self.assertRefusedNaming(
            self.challan, self._as_accountant, frappe.delete_doc, PTD, self.made.deduction, force=True
        )
        self.assertTrue(frappe.db.exists(PTD, self.made.deduction))
        self.assertEqual(self._reconciled(self.challan), 200)


class TestRejectingAPayment(DepositedTaxCase):
    def _reject(self, made):
        doc = frappe.get_doc(PAYMENT, made.name)
        doc.status = "Rejected"
        doc.save()
        frappe.db.commit()

    def test_rejecting_an_approved_cut_payment_removes_its_tax_and_restores_the_gross(self):
        made = self._approved()

        self._as(CEO_AUTHORIZED_USER, self._reject, made)

        self.assertEqual(frappe.db.get_value(PAYMENT, made.name, "status"), "Rejected")
        self.assertEqual(flt(frappe.db.get_value(PAYMENT, made.name, "amount")), 10000)
        self.assertFalse(frappe.db.exists(PTD, {"project_payment": made.name}))
        self.assertFalse(frappe.db.get_value(PAYMENT, made.name, "payment_tds"))

    def test_a_rejected_payment_approved_again_is_cut_once_from_the_full_bill(self):
        made = self._approved()
        self._as(CEO_AUTHORIZED_USER, self._reject, made)

        def approve():
            doc = frappe.get_doc(PAYMENT, made.name)
            doc.status = "Approved"
            doc.save()
            frappe.db.commit()

        self._as(CEO_AUTHORIZED_USER, approve)

        self.assertEqual(flt(frappe.db.get_value(PAYMENT, made.name, "amount")), 9800)
        self.assertEqual(
            frappe.get_all(PTD, {"project_payment": made.name}, ["gross_amount", "tds_amount"]),
            [{"gross_amount": 10000, "tds_amount": 200}],
        )

    def test_a_payment_whose_tax_is_deposited_cannot_be_rejected(self):
        made = self._approved()
        challan = self._empty_challan()
        self._deposited_before_this_rule(made, challan)

        self.assertRefusedNaming(challan, self._as, CEO_AUTHORIZED_USER, self._reject, made)
        self.assertEqual(frappe.db.get_value(PAYMENT, made.name, "status"), "Approved")
        self.assertTrue(frappe.db.exists(PTD, made.deduction))
        self.assertEqual(self._reconciled(challan), 200)


class TestPayTds(DepositedTaxCase):
    def test_it_refuses_tax_from_a_payment_that_is_not_paid(self):
        made = self._approved()
        challan = self._empty_challan()

        with self.assertRaises(frappe.ValidationError) as caught:
            self._as_accountant(pay_tds, [made.deduction], challan)
        frappe.db.rollback()

        self.assertIn(made.deduction, str(caught.exception))
        self.assertEqual(frappe.db.get_value(PTD, made.deduction, ["status", "tds_challan"]), ("Pending", None))
        self.assertEqual(self._reconciled(challan), 0)

    def test_it_takes_tax_from_a_paid_payment(self):
        made = self._approved()
        self._mark_paid(made)
        challan = self._empty_challan()

        self._as_accountant(pay_tds, [made.deduction], challan)

        self.assertEqual(frappe.db.get_value(PTD, made.deduction, ["status", "tds_challan"]), ("Paid", challan))
        self.assertEqual(self._reconciled(challan), 200)


class TestCorrectingADeductionBeforeAChallan(DepositedTaxCase):
    def test_a_tax_correction_recounts_the_work_order(self):
        made = self._approved()
        self._mark_paid(made)
        before = self._wo(made)
        self.assertEqual((before.amount_paid, before.total_tds), (10000, 200))

        def correct():
            row = frappe.get_doc(PTD, made.deduction)
            row.tds_amount = 300
            row.save()
            frappe.db.commit()

        self._as_accountant(correct)

        after = self._wo(made)
        # The payment still says 9,800 went to the vendor; the tax withheld for them is now 300.
        self.assertEqual(after.amount_paid, 10100)
        self.assertEqual(after.total_tds, 300)
        self.assertEqual(after.amount_due, after.total_amount - 10100)


class TestADeductionMadeInDesk(DepositedTaxCase):
    def test_it_cannot_be_born_in_a_challan_or_paid(self):
        """Only Pay TDS links a challan and marks tax Paid: it checks the payment is Paid and the balance."""
        made = self._approved()
        challan = self._empty_challan()
        row = frappe.db.get_value(PTD, made.deduction, ["project_payment", "document_type", "document_name",
                                                        "vendor", "project", "gross_amount", "tds_percentage",
                                                        "tds_amount"], as_dict=True)
        # The payment's own deduction is gone (as after a reject), so a hand-made one is the only one.
        frappe.db.delete(PTD, {"name": made.deduction})
        frappe.db.commit()
        for extra in ({"tds_challan": challan}, {"status": "Paid"}):
            with self.subTest(extra=extra):
                def insert():
                    frappe.get_doc({"doctype": PTD, **row, **extra}).insert()
                with self.assertRaisesRegex(frappe.ValidationError, "set by Pay TDS"):
                    self._as_accountant(insert)
                frappe.db.rollback()
        self.assertEqual(frappe.db.count(PTD, {"project_payment": row.project_payment}), 0)
        self.assertEqual(self._reconciled(challan), 0)
