# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Saving a Payment cheque from the Cheque Tracker's Add Cheque: the cheque record (#1408, spec #1407;
#1482, spec #1477).

Drives `api/cheques/save_cheque.save_cheque` against the database, the way the Add Cheque dialog does,
and reads back what a user sees: the Cheque, its status and its history, or the refusal. Its lines,
the payment picker and the payments it takes are `test_cheque_lines`.

⚠️ RUNS AGAINST THE ENV DATABASE (the endpoint commits). Vendors and projects come from
`TaxedWorkOrderFixture`, POs from `ChequeFixture.plant_po`; every Cheque carries a TESTCHQ number and is
purged by `ChequeFixture`.
"""

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import add_days, nowdate

from nirmaan_stack.api.cheques.cheque_fixture import ChequeFixture
from nirmaan_stack.api.cheques.save_cheque import save_cheque
from nirmaan_stack.api.payments.taxed_work_order_fixture import TaxedWorkOrderFixture

U = "Administrator"
PO = "Procurement Orders"
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
        self.project = self.fx.project()
        self.po = ChequeFixture.plant_po(self, self.fx, project=self.project, vendor=self.vendor)
        frappe.db.commit()  # a refusal below rolls back; the vendor must outlive it

    def tearDown(self):
        frappe.set_user(U)

    # -- helpers --------------------------------------------------------------------------------
    def _line(self):
        """A PO line with no payment yet: the simplest line a Payment cheque takes."""
        return {"line_type": "PO/WO Payment", "project": self.project, "record_doctype": PO,
                "record_name": self.po, "amount": 25000}

    def _values(self, **overrides):
        values = {
            "bank": "ICICI Bank",
            "cheque_no": self.cheques.number(),
            "cheque_date": nowdate(),
            "amount": 25000,
            "vendor": self.vendor,
            "attachment": PHOTO,
            "lines": [self._line()],
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

    # -- a Payment cheque -----------------------------------------------------------------------
    def test_a_payment_cheque_saves_at_pending_with_one_history_row(self):
        result = save_cheque(**self._values())
        name = self.cheques.track(result["cheque"])

        self.assertEqual(result["status"], "Pending")
        cheque = frappe.get_doc("Cheques", name)
        self.assertEqual((cheque.cheque_type, cheque.status, cheque.made_from), ("Payment", "Pending", "Report"))
        self.assertFalse(cheque.issue_date)
        self.assertEqual(len(cheque.status_history), 1)
        created = cheque.status_history[0]
        self.assertFalse(created.from_status)
        self.assertEqual(created.to_status, "Pending")
        self.assertEqual(created.changed_by, U)
        self.assertTrue(created.changed_at)

    def test_a_cheque_with_no_lines_is_refused(self):
        # No Ad-hoc Payment cheque (spec #1477): a description no longer stands in for lines.
        self._refused("Add at least one PO payment", lines=[], description="Office rent, October")

    def test_a_typed_payee_is_refused(self):
        self._refused("made out to a Vendor", vendor=None, payee_name="Tata Power")
        self._refused("made out to a Vendor", vendor=None)

    def test_the_photo_is_required_on_a_new_cheque(self):
        self._refused("Upload the photo of the cheque", attachment=None)

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
