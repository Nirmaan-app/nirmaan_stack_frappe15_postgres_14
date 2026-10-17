# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and Contributors
# See license.txt

"""A PO / Work Order payment carries its own pay-to account (#1437, spec #1420, ADR-0033 decision 9).

Raises payments through every creator the app uses and reads back the payment's own copy:

* the PO page's term request and the Credits page (`create_project_payment`), the Work Order request
  (`create_payment_request_for_service`), an adjustment's payment (`_payment_utils._create_project_payment`,
  which every PO Adjustment flow calls) and a payment recorded directly (a plain insert, as the
  Add Payment screens' `createDoc` does) each copy the vendor's Payee;
* a split remainder (CEO part-approval, partial settlement) carries its parent's copy, not the
  vendor's current Payee;
* editing the vendor's Payee, or a later save of the payment, never re-copies it.

⚠️ RUNS AGAINST THE ENV DATABASE (the endpoints commit). Projects, vendors, Work Orders and payments come
from `TaxedWorkOrderFixture`, Payees from `PayeeFixture`; the PO is planted and purged here.

Run:
  devenv.sh test --module nirmaan_stack.api.payees.test_payment_pay_to
"""

import json
from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import flt

from nirmaan_stack.api.cheques.cheque_fixture import ChequeFixture
from nirmaan_stack.api.payees.payee_fixture import TEST_IFSC, PayeeFixture
from nirmaan_stack.api.payments.project_payments import (
    create_payment_request_for_service,
    create_project_payment,
)
from nirmaan_stack.api.payments.taxed_work_order_fixture import TaxedWorkOrderFixture
from nirmaan_stack.api.po_adjustments._payment_utils import _create_project_payment
from nirmaan_stack.services.payees.pay_to import PAY_TO_FIELDS
from nirmaan_stack.services.payees.rules import ACCOUNT_FIELDS
from nirmaan_stack.services.payees.writer import edit_payee
from nirmaan_stack.services.payment_split import split_payment

U = "Administrator"
PAYMENT = "Project Payments"
SR = "Service Requests"
PO = "Procurement Orders"
TERMS = "PO Payment Terms"
CONTROLLER = "nirmaan_stack.integrations.controllers.project_payments"


class TestPaymentsCarryTheirOwnPayToAccount(FrappeTestCase):
    def setUp(self):
        frappe.set_user(U)
        # Cleanups run last-in first-out: the payments and vendors go before their Payees.
        self.payees = PayeeFixture.attach(self)
        self.fx = TaxedWorkOrderFixture.attach(self)
        self.project = self.fx.project()
        self.payee = self.payees.payee()
        self.vendor = self.fx.vendor(0)
        self._link(self.vendor, self.payee)
        self.sr = self.fx.service_request(self.project, self.vendor)
        self.po = self._po()
        frappe.db.commit()
        # The admin note reaches every real admin, and a push reaches real phones: keep both off.
        for target in ("_notify_admins_auto_approved", "PrNotification"):
            quiet = patch(f"{CONTROLLER}.{target}")
            quiet.start()
            self.addCleanup(quiet.stop)

    def tearDown(self):
        frappe.set_user(U)

    # -- planting -------------------------------------------------------------------------------
    def _link(self, vendor, payee):
        """Point `vendor` at `payee`, raw: the vendor screens' own rules are not under test."""
        frappe.db.set_value("Vendors", vendor, "payee", payee, update_modified=False)
        frappe.db.commit()

    def _po(self):
        name = self.fx._name("PO")
        frappe.db.sql(
            """INSERT INTO "tabProcurement Orders" (name, creation, modified, modified_by, owner,
                   docstatus, idx, project, vendor, total_amount, amount, tax_amount, amount_paid, status)
               VALUES (%s, NOW(), NOW(), %s, %s, 0, 0, %s, %s, 10000000, 10000000, 0, 0, 'Delivered')""",
            (name, U, U, self.project, self.vendor),
        )
        self.addCleanup(ChequeFixture.purge_rows, [
            (TERMS, {"parent": name}),
            ("Version", {"ref_doctype": PO, "docname": name}),
            (PO, {"name": name}),
        ])
        return name

    def _term(self, amount, payment_type="Delivery against Payment"):
        name = frappe.generate_hash(length=10)
        frappe.db.sql(
            """INSERT INTO "tabPO Payment Terms" (name, creation, modified, modified_by, owner, docstatus,
                   idx, vendor, project, payment_type, label, percentage, amount, term_status, due_date,
                   parent, parentfield, parenttype)
               VALUES (%s, NOW(), NOW(), %s, %s, 0, 1, %s, %s, %s, 'Test term', 10, %s, 'Created',
                       CURRENT_DATE, %s, 'payment_terms', %s)""",
            (name, U, U, self.vendor, self.project, payment_type, flt(amount), self.po, PO),
        )
        frappe.db.commit()
        return name

    # -- raising --------------------------------------------------------------------------------
    def _request_po(self, amount=5000, payment_type="Delivery against Payment"):
        term = self._term(amount, payment_type)
        create_project_payment(
            doctype=PO, docname=self.po, vendor=self.vendor, amount=amount, project=self.project, ptname=term,
        )
        frappe.db.commit()
        return frappe.db.get_value(TERMS, term, "project_payment")

    def _request_wo(self, amount=5000):
        out = json.loads(create_payment_request_for_service(json.dumps(
            {"doctype": SR, "docname": self.sr, "amount": amount})))
        frappe.db.commit()
        return out["name"]

    # -- reading --------------------------------------------------------------------------------
    def _pay_to(self, payment):
        return tuple(frappe.db.get_value(PAYMENT, payment, list(PAY_TO_FIELDS)))

    def _account_of(self, payee):
        return tuple(frappe.db.get_value("Payee", payee, list(ACCOUNT_FIELDS)))

    # -- every creator copies the vendor's Payee -------------------------------------------------
    def test_a_po_term_request_copies_the_vendors_payee(self):
        payment = self._request_po()
        self.assertEqual(self._pay_to(payment), self._account_of(self.payee))

    def test_a_credit_term_request_copies_the_vendors_payee(self):
        payment = self._request_po(payment_type="Credit")
        self.assertEqual(self._pay_to(payment), self._account_of(self.payee))

    def test_a_work_order_request_copies_the_vendors_payee(self):
        payment = self._request_wo()
        self.assertEqual(self._pay_to(payment), self._account_of(self.payee))

    def test_an_adjustment_payment_copies_the_vendors_payee(self):
        pay = _create_project_payment(self.po, self.project, self.vendor, 1200, "Paid")
        frappe.db.commit()
        self.assertEqual(self._pay_to(pay.name), self._account_of(self.payee))

    def test_a_payment_recorded_directly_copies_the_vendors_payee(self):
        """The Add Payment screens insert the record straight at Paid (`createDoc`)."""
        doc = frappe.get_doc({
            "doctype": PAYMENT, "document_type": SR, "document_name": self.sr, "project": self.project,
            "vendor": self.vendor, "amount": 3000, "status": "Paid", "utr": "TESTPAYTO1",
            "payment_date": frappe.utils.nowdate(),
        })
        doc.insert(ignore_permissions=True)
        frappe.db.commit()
        self.assertEqual(self._pay_to(doc.name), self._account_of(self.payee))

    def test_a_vendor_with_no_payee_leaves_the_copy_blank(self):
        frappe.db.set_value("Vendors", self.vendor, "payee", None, update_modified=False)
        frappe.db.commit()
        payment = self._request_wo()
        self.assertEqual(self._pay_to(payment), (None,) * 5)

    # -- the copy stays the payment's own -------------------------------------------------------
    def test_a_split_remainder_carries_its_parents_copy_not_the_vendors_current_payee(self):
        payment = self._request_wo(200000)
        raised_with = self._pay_to(payment)
        self.assertEqual(raised_with, self._account_of(self.payee))
        frappe.db.set_value(PAYMENT, payment, "status", "CEO Pending", update_modified=False)
        self._link(self.vendor, self.payees.payee())  # the vendor now pays into another account
        frappe.db.commit()

        split_payment(payment, 50000)
        frappe.db.commit()

        remainder = frappe.get_all(PAYMENT, filters={"split_from": payment}, pluck="name")
        self.assertEqual(len(remainder), 1)
        self.assertEqual(self._pay_to(remainder[0]), raised_with)
        self.assertNotEqual(raised_with, self._account_of(frappe.db.get_value("Vendors", self.vendor, "payee")))

    def test_editing_the_vendors_payee_leaves_the_payment_unchanged(self):
        payment = self._request_po()
        raised_with = self._pay_to(payment)
        self.assertEqual(raised_with, self._account_of(self.payee))

        edit_payee(self.payee, PayeeFixture.holder("Moved"), PayeeFixture.account_number(), TEST_IFSC)
        frappe.db.commit()
        # A later save of the payment does not re-copy either.
        doc = frappe.get_doc(PAYMENT, payment)
        doc.utr = "TESTPAYTO2"
        doc.save(ignore_permissions=True)
        frappe.db.commit()

        self.assertNotEqual(self._account_of(self.payee)[:2], raised_with[:2])
        self.assertEqual(self._pay_to(payment), raised_with)
