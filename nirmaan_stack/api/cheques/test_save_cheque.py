# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Saving a Cheque from the report: the Cheque record and Ad-hoc cheques (#1408, spec #1407).

Drives `api/cheques/save_cheque.save_cheque` against the database, the way the report's Add Cheque
dialog does, and reads back what a user sees: the Cheque, its status and its history, or the refusal.

⚠️ RUNS AGAINST THE ENV DATABASE (the endpoint commits). Vendors come from `TaxedWorkOrderFixture`;
every Cheque carries a TESTCHQ number and is purged by `ChequeFixture`.
"""

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import add_days, nowdate

from nirmaan_stack.api.cheques.cheque_fixture import ChequeFixture
from nirmaan_stack.api.cheques.save_cheque import save_cheque
from nirmaan_stack.api.payments.taxed_work_order_fixture import TaxedWorkOrderFixture

U = "Administrator"
ACCOUNTANT = "Nirmaan Accountant Profile"
PROJECT_MANAGER = "Nirmaan Project Manager Profile"
PROCUREMENT = (
    "Nirmaan Procurement Executive Profile",
    "Nirmaan Procurement Lead Profile",
    "Nirmaan Material Procurement Executive Profile",
    "Nirmaan Service Procurement Executive Profile",
)
PHOTO = "https://storage.example.invalid/private/files/cheque-test.jpg"


class TestSaveCheque(FrappeTestCase):
    def setUp(self):
        frappe.set_user(U)
        self.fx = TaxedWorkOrderFixture.attach(self)
        self.cheques = ChequeFixture.attach(self)
        self.vendor = self.fx.vendor()
        frappe.db.commit()  # a refusal below rolls back; the vendor must outlive it

    def tearDown(self):
        frappe.set_user(U)

    # -- helpers --------------------------------------------------------------------------------
    def _values(self, **overrides):
        values = {
            "bank": "ICICI Bank",
            "cheque_no": self.cheques.number(),
            "cheque_date": nowdate(),
            "amount": 25000,
            "vendor": self.vendor,
            "description": "Office rent, October",
            "attachment": PHOTO,
        }
        values.update(overrides)
        return {k: v for k, v in values.items() if v is not None}

    def _user(self, profiles):
        for user in frappe.get_all(
            "Nirmaan Users", filters={"role_profile": ["in", list(profiles)]}, pluck="name", limit=20
        ):
            if user and user != U and frappe.db.exists("User", user):
                return user
        self.skipTest(f"no user with {profiles} on this site")

    def _as(self, user, fn, *args, **kwargs):
        previous = frappe.session.user
        frappe.set_user(user)
        try:
            return fn(*args, **kwargs)
        finally:
            frappe.set_user(previous)

    def _refused(self, phrase, **overrides):
        with self.assertRaisesRegex(frappe.ValidationError, phrase):
            self._save(**overrides)
        frappe.db.rollback()

    def _save(self, **overrides):
        result = save_cheque(**self._values(**overrides))
        return self.cheques.track(result["cheque"])

    # -- an Ad-hoc cheque -----------------------------------------------------------------------
    def test_an_ad_hoc_cheque_saves_at_issued_with_one_history_row(self):
        name = self._save()

        cheque = frappe.get_doc("Cheques", name)
        self.assertEqual(cheque.status, "Issued")
        self.assertEqual(cheque.made_from, "Report")
        self.assertEqual(cheque.lines, [])
        self.assertEqual(len(cheque.status_history), 1)
        created = cheque.status_history[0]
        self.assertFalse(created.from_status)
        self.assertEqual(created.to_status, "Issued")
        self.assertEqual(created.changed_by, U)
        self.assertTrue(created.changed_at)

    def test_a_cheque_with_no_lines_and_no_description_is_refused(self):
        self._refused("Ad-hoc cheque: write a description", description=None)
        self._refused("Ad-hoc cheque: write a description", description="   ")

    def test_the_photo_is_required_on_a_new_cheque(self):
        self._refused("Upload the photo of the cheque", attachment=None)

    def test_exactly_one_of_vendor_or_payee_name_is_required(self):
        self._refused("or type the payee's name", vendor=None)
        self._refused("not both", payee_name="Tata Power")

        name = self._save(vendor=None, payee_name="  Tata   Power ")
        cheque = frappe.get_doc("Cheques", name)
        self.assertEqual(cheque.payee_name, "Tata Power")
        self.assertFalse(cheque.vendor)

    def test_an_others_bank_needs_its_name(self):
        self._refused("Type the name of the bank", bank="Others", bank_name=None)

    def test_a_post_dated_cheque_is_accepted(self):
        name = self._save(cheque_date=add_days(nowdate(), 45))
        self.assertEqual(str(frappe.db.get_value("Cheques", name, "cheque_date")), add_days(nowdate(), 45))

    # -- bank + cheque number is unique -----------------------------------------------------------
    def test_the_same_icici_cheque_number_is_refused_naming_the_existing_cheque(self):
        number = self.cheques.number()
        first = self._save(cheque_no=number)

        self._refused(f"Cheque {number} on ICICI Bank is already recorded as {first}", cheque_no=number)

    def test_an_others_bank_name_matches_ignoring_case_and_repeated_spaces(self):
        number = self.cheques.number()
        first = self._save(bank="Others", bank_name="HDFC Bank", cheque_no=number)

        self._refused(
            f"is already recorded as {first}", bank="Others", bank_name="hdfc  bank ", cheque_no=number
        )

    def test_the_same_number_on_another_bank_is_a_different_cheque(self):
        number = self.cheques.number()
        self._save(cheque_no=number)

        other = self._save(bank="Others", bank_name="HDFC Bank", cheque_no=number)
        self.assertEqual(frappe.db.get_value("Cheques", other, "bank_name"), "HDFC Bank")

    # -- who may add ----------------------------------------------------------------------------
    def test_a_project_manager_cannot_add_a_cheque(self):
        pm = self._user((PROJECT_MANAGER,))
        with self.assertRaises(frappe.PermissionError):
            self._as(pm, save_cheque, **self._values())

    def test_procurement_and_accounts_can_add_a_cheque(self):
        for profiles in (PROCUREMENT, (ACCOUNTANT,)):
            user = self._user(profiles)
            result = self._as(user, save_cheque, **self._values())
            self.cheques.track(result["cheque"])
            cheque = frappe.get_doc("Cheques", result["cheque"])
            self.assertEqual(cheque.owner, user)
            self.assertEqual(cheque.status_history[0].changed_by, user)
