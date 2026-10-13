# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The Cheque Payments report's list: one row per Cheque (#1408, spec #1407).

Drives `api/cheques/list_cheques.get_cheques` the way the report's server data table does, after
saving Cheques through the real save endpoint.

⚠️ RUNS AGAINST THE ENV DATABASE (the save endpoint commits). Purged by `ChequeFixture`.
"""

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import nowdate

from nirmaan_stack.api.cheques.cheque_fixture import ChequeFixture
from nirmaan_stack.api.cheques.list_cheques import get_cheques
from nirmaan_stack.api.cheques.save_cheque import save_cheque
from nirmaan_stack.api.payments.taxed_work_order_fixture import TaxedWorkOrderFixture

U = "Administrator"
PROJECT_MANAGER = "Nirmaan Project Manager Profile"
PROCUREMENT = (
    "Nirmaan Procurement Executive Profile",
    "Nirmaan Procurement Lead Profile",
    "Nirmaan Material Procurement Executive Profile",
    "Nirmaan Service Procurement Executive Profile",
)
PHOTO = "https://storage.example.invalid/private/files/cheque-test.jpg"


class TestListCheques(FrappeTestCase):
    def setUp(self):
        frappe.set_user(U)
        self.fx = TaxedWorkOrderFixture.attach(self)
        self.cheques = ChequeFixture.attach(self)
        self.vendor = self.fx.vendor()
        frappe.db.commit()

    def tearDown(self):
        frappe.set_user(U)

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

    def _save(self, **overrides):
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
        result = save_cheque(**{k: v for k, v in values.items() if v is not None})
        self.cheques.track(result["cheque"])
        return result["cheque"], values["cheque_no"]

    def _search(self, number, **kwargs):
        return get_cheques(search_term=number, current_search_fields='["cheque_no"]', **kwargs)

    def test_a_cheque_is_one_row_with_what_the_report_shows(self):
        name, number = self._save(bank="Others", bank_name="HDFC Bank")

        result = self._search(number)

        self.assertEqual(result["total_count"], 1)
        row = result["data"][0]
        self.assertEqual(row["name"], name)
        self.assertEqual(row["cheque_no"], number)
        self.assertEqual(row["bank_label"], "HDFC Bank")
        self.assertEqual(str(row["cheque_date"]), nowdate())
        self.assertEqual(row["status"], "Issued")
        self.assertEqual(row["amount"], 25000)
        self.assertEqual(row["description"], "Office rent, October")
        self.assertEqual(row["vendor"], self.vendor)
        self.assertEqual(row["vendor_name"], self.vendor)  # the fixture names a vendor after itself
        self.assertEqual(row["attachment"], PHOTO)
        self.assertEqual(row["owner"], U)
        self.assertEqual(row["status_changed_by"], U)
        self.assertTrue(row["status_changed_at"])

    def test_a_typed_payee_is_listed_as_the_payee(self):
        _, number = self._save(vendor=None, payee_name="Tata Power")

        row = self._search(number)["data"][0]

        self.assertFalse(row["vendor"])
        self.assertEqual(row["payee_name"], "Tata Power")

    def test_search_by_cheque_number_finds_only_that_cheque(self):
        name, number = self._save()
        self._save()

        result = self._search(number)

        self.assertEqual([r["name"] for r in result["data"]], [name])

    def test_status_filter(self):
        _, number = self._save()

        self.assertEqual(self._search(number, filters='[["status", "=", "Issued"]]')["total_count"], 1)
        self.assertEqual(self._search(number, filters='[["status", "in", ["Cleared", "Cancelled"]]]')["total_count"], 0)

    def test_a_project_manager_cannot_read_the_report(self):
        pm = self._user((PROJECT_MANAGER,))
        with self.assertRaises(frappe.PermissionError):
            self._as(pm, get_cheques)

    def test_procurement_can_read_the_report(self):
        _, number = self._save()
        user = self._user(PROCUREMENT)

        result = self._as(user, self._search, number)

        self.assertEqual(result["total_count"], 1)
