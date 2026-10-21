# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and Contributors
# See license.txt

"""The Office Rent request form (spec #1522, #1524), through the request endpoints.

An HR Executive raises Office Rent against the form the fixture ships: Rent Month, Office Location,
Landlord Name and Landlord PAN. The PAN is stored uppercased, a PAN not shaped like ABCPK1234D is
refused on create and on edit, and the approved Expense's description reads the form's sentence.
The tax itself is `test_office_rent_tds` (#1525).

⚠️ Runs against the site's real Office Rent type, so the site must have synced the fixture
(`bench migrate`). The Records without review list is emptied for the run, so HR's request waits for
review, and put back after.

Run:
  DEVENV test --module nirmaan_stack.api.expense_requests.test_office_rent_form
"""

import json

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.expense_requests.create import create_expense_request
from nirmaan_stack.api.expense_requests.review import approve_expense_request
from nirmaan_stack.api.expense_requests.test_expense_requests import _make_user
from nirmaan_stack.api.expense_requests.test_records_without_review import _listed, _write_list
from nirmaan_stack.api.expense_requests.update import update_expense_request
from nirmaan_stack.services import expense_request_routing as routing

HR_USER = "exr_rent_test_hr@example.com"
HR_PROFILE = "Nirmaan HR Executive Profile"
OFFICE_RENT = "Office Rent"


def _answers(**detail):
    fmt = json.loads(frappe.db.get_value("Expense Type", OFFICE_RENT, "source_format"))
    return {"templateId": fmt["templateId"], "templateVersion": fmt["templateVersion"],
            "responses": {"detail": detail}}


def _rent(**overrides):
    detail = {"rent_month": "2026-10-01", "office_location": "Bengaluru HQ",
              "landlord_name": "Asha Rao", "landlord_pan": "ABCPK1234D", **overrides}
    return _answers(**detail)


class TestOfficeRentForm(FrappeTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        frappe.set_user("Administrator")
        cls.original_list = _listed()
        _write_list([])
        _make_user(HR_USER, HR_PROFILE, ("Nirmaan HR Executive",))
        frappe.db.commit()

    @classmethod
    def tearDownClass(cls):
        frappe.db.rollback()
        frappe.set_user("Administrator")
        for r in frappe.get_all("Expense Request", filters={"owner": HR_USER}, pluck="name"):
            try:
                frappe.db.delete("Nirmaan Notifications", {"document": "Expense Request", "docname": r})
                for row in frappe.get_all("Non Project Expenses", filters={"request_id": r}, pluck="name"):
                    frappe.delete_doc("Non Project Expenses", row, force=True, ignore_permissions=True)
                if frappe.db.exists("Expense Request", r):
                    frappe.delete_doc("Expense Request", r, force=True, ignore_permissions=True)
                frappe.db.commit()
            except Exception:
                frappe.db.rollback()
                print(f"test_office_rent_form: could not remove {r}")
        try:
            _write_list(cls.original_list)
            for dt in ("Nirmaan Users", "User"):
                if frappe.db.exists(dt, HR_USER):
                    frappe.delete_doc(dt, HR_USER, force=True, ignore_permissions=True)
            frappe.db.commit()
        except Exception:
            frappe.db.rollback()
            print("test_office_rent_form: could not restore Records without review or remove the user")
        super().tearDownClass()

    def setUp(self):
        frappe.set_user("Administrator")
        routing.clear_cache()

    def tearDown(self):
        frappe.set_user("Administrator")

    def _raise(self, source_data, amount=100000):
        frappe.set_user(HR_USER)
        try:
            return create_expense_request(expense_type=OFFICE_RENT, amount=amount, source_data=source_data)
        finally:
            frappe.set_user("Administrator")

    def _stored_pan(self, name):
        data = json.loads(frappe.db.get_value("Expense Request", name, "source_data"))
        return data["responses"]["detail"]["landlord_pan"]

    def test_the_form_asks_the_four_questions_all_required(self):
        fmt = json.loads(frappe.db.get_value("Expense Type", OFFICE_RENT, "source_format"))
        self.assertEqual(frappe.db.get_value("Expense Type", OFFICE_RENT, "source_format_enabled"), 1)
        fields = [(f["label"], f.get("required")) for s in fmt["sections"] for f in s["fields"]]
        self.assertEqual(fields, [("Rent Month", True), ("Office Location", True),
                                  ("Landlord Name", True), ("Landlord PAN", True)])

    def test_a_lowercase_pan_is_stored_uppercased(self):
        res = self._raise(_rent(landlord_pan="abcpk1234d"))
        self.assertEqual(self._stored_pan(res["name"]), "ABCPK1234D")

    def test_a_malformed_pan_is_refused_on_create(self):
        before = frappe.db.count("Expense Request", {"owner": HR_USER})
        with self.assertRaisesRegex(frappe.ValidationError, "Landlord PAN \"ABC123\" is not a PAN"):
            self._raise(_rent(landlord_pan="ABC123"))
        frappe.db.rollback()
        self.assertEqual(frappe.db.count("Expense Request", {"owner": HR_USER}), before)

    def test_a_malformed_pan_is_refused_on_edit(self):
        name = self._raise(_rent())["name"]
        frappe.set_user(HR_USER)
        try:
            with self.assertRaisesRegex(frappe.ValidationError, "Landlord PAN \"ABC123\" is not a PAN"):
                update_expense_request(name, expense_type=OFFICE_RENT, amount=100000,
                                       source_data=_rent(landlord_pan="ABC123"))
        finally:
            frappe.set_user("Administrator")
        frappe.db.rollback()
        self.assertEqual(self._stored_pan(name), "ABCPK1234D")

    def test_an_edit_stores_a_lowercase_pan_uppercased(self):
        name = self._raise(_rent())["name"]
        frappe.set_user(HR_USER)
        try:
            update_expense_request(name, expense_type=OFFICE_RENT, amount=100000,
                                   source_data=_rent(landlord_pan="zyxpk9876q"))
        finally:
            frappe.set_user("Administrator")
        self.assertEqual(self._stored_pan(name), "ZYXPK9876Q")

    def test_the_approved_expense_reads_the_rent_sentence_and_keeps_the_full_rent(self):
        name = self._raise(_rent(landlord_pan="abcpk1234d"))["name"]
        created = approve_expense_request(name)["created_expense"]

        row = frappe.db.get_value("Non Project Expenses", created, ["description", "amount"], as_dict=True)
        self.assertEqual(
            row.description,
            "Office rent for 1 Oct 2026 – Bengaluru HQ. Landlord: Asha Rao (PAN ABCPK1234D). "
            f"(10% TDS will be deducted) · [{name}]")
        # An Admin's review is the L1 step, so Rs 1,00,000 waits at CEO Pending: nothing is withheld
        # before the CEO approves (`test_office_rent_tds`).
        self.assertEqual(row.amount, 100000)
