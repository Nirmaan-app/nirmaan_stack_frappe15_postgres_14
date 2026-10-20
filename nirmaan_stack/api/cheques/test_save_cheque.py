# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""What `api/cheques/save_cheque.save_cheque` makes (#1408, spec #1407; spec #1514).

The Cheque Tracker makes no cheque (ADR-0035 Amendment A): the endpoint refuses a new Payment cheque,
which is made only with its payment by a PO's Request Payment in Cheque mode
(`api/payments/payment_cheque.put_on_new_cheque`). It still records a Security Deposit cheque, from the PO
page's card (`test_deposit_cheques`), and saves the Edit of a Cheque (`test_cheque_edit`). The bank +
number rule every Cheque keeps is driven here through a deposit cheque.

⚠️ RUNS AGAINST THE ENV DATABASE (the endpoint commits). Vendors and projects come from
`TaxedWorkOrderFixture`, POs from `ChequeFixture.plant_po`; every Cheque carries a TESTCHQ number and is
purged by `ChequeFixture`.
"""

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import nowdate

from nirmaan_stack.api.cheques.cheque_fixture import ChequeFixture
from nirmaan_stack.api.cheques.save_cheque import save_cheque
from nirmaan_stack.api.payments.taxed_work_order_fixture import TaxedWorkOrderFixture

U = "Administrator"
PO = "Procurement Orders"
SD = "Security Deposit"
PROJECT_MANAGER = "Nirmaan Project Manager Profile"
PHOTO = "https://storage.example.invalid/private/files/cheque-test.jpg"
NOT_HERE = "A Payment cheque is made with its payment"


class TestSaveCheque(FrappeTestCase):
    def setUp(self):
        frappe.set_user(U)
        self.fx = TaxedWorkOrderFixture.attach(self)
        self.cheques = ChequeFixture.attach(self)
        self.vendor = self.fx.vendor()
        self.project = self.fx.project()
        self.po = ChequeFixture.plant_po(self, self.fx, project=self.project, vendor=self.vendor)
        frappe.db.commit()  # a refusal below rolls back; the vendor must outlive it

    def tearDown(self):
        frappe.set_user(U)

    # -- helpers --------------------------------------------------------------------------------
    def _payment_cheque(self, **overrides):
        """What the Tracker's Add Cheque sent for a Payment cheque: a Vendor, a PO line."""
        values = {
            "bank": "ICICI Bank",
            "cheque_no": self.cheques.number(),
            "cheque_date": nowdate(),
            "amount": 25000,
            "vendor": self.vendor,
            "attachment": PHOTO,
            "lines": [{"line_type": "PO/WO Payment", "project": self.project, "record_doctype": PO,
                       "record_name": self.po, "amount": 25000}],
        }
        values.update(overrides)
        return {k: v for k, v in values.items() if v is not None}

    def _deposit(self, **overrides):
        values = {"cheque_type": SD, "issue_date": nowdate(), "lines": [], **overrides}
        return self.cheques.track(save_cheque(**self._payment_cheque(**values))["cheque"])

    def _refused(self, phrase, fn, **kwargs):
        with self.assertRaisesRegex(frappe.ValidationError, phrase):
            fn(**kwargs)
        frappe.db.rollback()

    def _cheques_numbered(self, number):
        return frappe.get_all("Cheques", filters={"cheque_no": number}, pluck="name")

    # -- no Payment cheque ----------------------------------------------------------------------
    def test_a_new_payment_cheque_is_refused_and_nothing_is_saved(self):
        for cheque_type in (None, "Payment"):
            values = self._payment_cheque(cheque_type=cheque_type)
            self._refused(f"{NOT_HERE}: use Request Payment in Cheque mode on the PO", save_cheque, **values)
            self.assertEqual(self._cheques_numbered(values["cheque_no"]), [])

    def test_a_deposit_cheque_is_still_recorded(self):
        name = self._deposit()
        self.assertEqual(frappe.db.get_value("Cheques", name, ["cheque_type", "status"]), (SD, "Issued"))

    def test_an_unknown_cheque_type_is_refused(self):
        self._refused("Choose the kind of cheque", save_cheque, **self._payment_cheque(cheque_type="Rent"))

    # -- bank + cheque number is unique -----------------------------------------------------------
    def test_the_same_icici_cheque_number_is_refused_naming_the_existing_cheque(self):
        number = self.cheques.number()
        first = self._deposit(cheque_no=number)
        self._refused(f"Cheque {number} on ICICI Bank is already recorded as {first}", self._deposit, cheque_no=number)

    def test_an_others_bank_name_matches_ignoring_case_and_repeated_spaces(self):
        number = self.cheques.number()
        first = self._deposit(bank="Others", bank_name="HDFC Bank", cheque_no=number)
        self._refused(f"is already recorded as {first}", self._deposit,
                      bank="Others", bank_name="hdfc  bank ", cheque_no=number)

    def test_the_same_number_on_another_bank_is_a_different_cheque(self):
        number = self.cheques.number()
        self._deposit(cheque_no=number)
        other = self._deposit(bank="Others", bank_name="HDFC Bank", cheque_no=number)
        self.assertEqual(frappe.db.get_value("Cheques", other, "bank_name"), "HDFC Bank")

    def test_an_others_bank_needs_its_name(self):
        self._refused("Type the name of the bank", self._deposit, bank="Others", bank_name=None)

    # -- who ------------------------------------------------------------------------------------
    def test_a_project_manager_cannot_save_a_cheque(self):
        pm = next((u for u in frappe.get_all("Nirmaan Users", filters={"role_profile": PROJECT_MANAGER},
                                             pluck="name", limit=20) if u and frappe.db.exists("User", u)), None)
        if not pm:
            self.skipTest("no Project Manager on this site")
        frappe.set_user(pm)
        try:
            with self.assertRaises(frappe.PermissionError):
                save_cheque(**self._payment_cheque(cheque_type=SD, issue_date=nowdate(), lines=[]))
        finally:
            frappe.set_user(U)
        frappe.db.rollback()
