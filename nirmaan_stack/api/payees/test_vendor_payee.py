# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""A new vendor picks an existing Payee or enters new bank details (#1425, spec #1420, ADR-0033).

Drives the Payee module's suggestions (`services/payees/choosing`) and the new-vendor endpoints the
way the form does: `api/payees/vendor_payee` for the suggestions panel, the confirmation and the
duplicate pre-check, and `api/create_vendor_and_address` for Submit. Reads back what the user sees:
the ranked suggestions, the vendor's Payee, the refusal.

⚠️ RUNS AGAINST THE ENV DATABASE (the endpoints commit). Vendors and payments planted by
`TaxedWorkOrderFixture`, Payees by `PayeeFixture`; vendors the endpoint creates, their addresses and
the expenses planted here are deleted by this module's own cleanup.
"""

import random
import string

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.create_vendor_and_address import create_vendor_and_address
from nirmaan_stack.api.payees.payee_fixture import TEST_IFSC, PayeeFixture
from nirmaan_stack.api.payees.vendor_payee import check_vendor_payee, get_payee_choice, suggest_vendor_payees
from nirmaan_stack.api.payments.taxed_work_order_fixture import TaxedWorkOrderFixture
from nirmaan_stack.services.payees.choosing import suggest_for_vendor
from nirmaan_stack.services.payees.matching import NAME_ONLY, STRONG
from nirmaan_stack.services.payees.rules import INACTIVE, PAYEE_DOCTYPE

U = "Administrator"
PROJECT_MANAGER = "Nirmaan Project Manager Profile"
OLD_BANK_FIELDS = ("account_name", "account_number", "ifsc", "bank_name", "bank_branch")


def _pan():
    return "".join(random.choices(string.ascii_uppercase, k=5)) + "".join(random.choices(string.digits, k=4)) + "Z"


class TestVendorPayee(FrappeTestCase):
    def setUp(self):
        frappe.set_user(U)
        self.fx = TaxedWorkOrderFixture.attach(self)
        self.payees = PayeeFixture.attach(self)
        self.created_vendors: list[str] = []
        self.expenses: list[tuple[str, str]] = []
        self.addCleanup(self._purge)
        # A made-up firm word, so only this test's Payees can look like the vendor.
        self.firm = "Qz" + frappe.generate_hash(length=6)
        self.pan = _pan()

    def tearDown(self):
        frappe.set_user(U)

    # -- helpers --------------------------------------------------------------------------------
    def _vendor(self, vendor_name, *, pan=None, payee=None, city=None):
        name = self.fx.vendor()
        frappe.db.set_value(
            "Vendors", name,
            {"vendor_name": vendor_name, "vendor_pan": pan, "payee": payee, "vendor_city": city},
            update_modified=False,
        )
        return name

    def _payment(self, vendor, status, payment_date, document):
        name = self.fx._name("PAY")
        frappe.db.sql(
            """INSERT INTO "tabProject Payments" (name, creation, modified, modified_by, owner, docstatus, idx,
                   vendor, amount, status, payment_date, document_type, document_name)
               VALUES (%s, NOW(), NOW(), %s, %s, 0, 0, %s, 1000, %s, %s, 'Procurement Orders', %s)""",
            (name, U, U, vendor, status, payment_date, document),
        )
        self.fx.payments.append(name)

    def _expense(self, doctype, payee, status="Approved", payment_date=None):
        name = f"TEST-PYE-EXP-{frappe.generate_hash(length=10)}"
        frappe.db.sql(
            f"""INSERT INTO "tab{doctype}" (name, creation, modified, modified_by, owner, docstatus, idx,
                    amount, status, payee, payment_date)
                VALUES (%s, NOW(), NOW(), %s, %s, 0, 0, 500, %s, %s, %s)""",
            (name, U, U, status, payee, payment_date),
        )
        self.expenses.append((doctype, name))
        return name

    def _purge(self):
        frappe.db.rollback()
        for doctype, name in self.expenses:
            frappe.db.delete(doctype, {"name": name})
        for vendor in self.created_vendors:
            address = frappe.db.get_value("Vendors", vendor, "vendor_address")
            frappe.db.delete("Vendor Category", {"vendor": vendor})
            frappe.db.delete("Vendors", {"name": vendor})
            if address:
                frappe.db.delete("Address", {"name": address})
        frappe.db.commit()

    def _values(self, vendor_name=None):
        return {
            "vendor_name": vendor_name or f"{self.firm} Ductfab Systems (Pune)",
            "vendor_contact_person_name": "Test Person",
            "vendor_mobile": "9999999999",
            "vendor_pan": self.pan,
            "address_line_1": "Test address",
            "vendor_city": "Pune",
            "vendor_state": "Maharashtra",
            "pin": "411001",
            "tds_deduction_percentage": 2,
        }

    def _create(self, **kwargs):
        values = self._values()
        result = create_vendor_and_address(values=values, vendorType="Material", service=False, **kwargs)
        vendor = frappe.db.get_value("Vendors", {"vendor_name": values["vendor_name"]}, "name")
        if vendor:
            self.created_vendors.append(vendor)
        return result, vendor

    def _user(self, profile):
        for user in frappe.get_all("Nirmaan Users", filters={"role_profile": profile}, pluck="name", limit=20):
            if user and user != U and frappe.db.exists("User", user):
                return user
        self.skipTest(f"no user with {profile} on this site")

    # -- suggestions ----------------------------------------------------------------------------
    def test_a_same_pan_payee_ranks_above_a_name_only_one(self):
        name_only = self.payees.payee(holder=self.payees.holder(f"{self.firm} Ductfab Systems"))
        self._vendor(f"{self.firm} Ductfab Systems", pan=_pan(), payee=name_only)
        same_pan = self.payees.payee(holder=self.payees.holder("KDS"))
        self._vendor(f"{self.firm} Ductfab (Rohtak)", pan=self.pan, payee=same_pan)
        frappe.db.commit()

        suggestions = suggest_for_vendor(f"{self.firm} Ductfab Systems (Pune)", self.pan.lower())
        self.assertEqual(
            [(s["name"], s["match"]) for s in suggestions],
            [(same_pan, STRONG), (name_only, NAME_ONLY)],
        )

    def test_an_inactive_payee_is_never_suggested(self):
        moved = self.payees.payee(holder=self.payees.holder(f"{self.firm} Ductfab"))
        self._vendor(f"{self.firm} Ductfab", pan=self.pan, payee=moved)
        frappe.db.set_value(PAYEE_DOCTYPE, moved, "status", INACTIVE)
        frappe.db.commit()
        self.assertEqual(suggest_for_vendor(f"{self.firm} Ductfab", self.pan), [])

    def test_a_suggestion_and_the_confirmation_list_every_link_and_the_last_payment(self):
        payee = self.payees.payee(holder=self.payees.holder(f"{self.firm} Ductfab"))
        rohtak = self._vendor(f"{self.firm} Ductfab (Rohtak)", pan=self.pan, payee=payee, city="Rohtak")
        gujarat = self._vendor(f"{self.firm} Ductfab (Gujarat)", pan=self.pan, payee=payee, city="Vadodara")
        self._payment(rohtak, "Paid", "2026-10-08", "PO/005/00107/26-27")
        self._payment(gujarat, "Paid", "2026-09-01", "PO/005/00090/26-27")
        self._payment(gujarat, "Approved", "2026-10-12", "PO/005/00111/26-27")
        pe = self._expense("Project Expenses", payee)
        npe = self._expense("Non Project Expenses", payee, status="Paid", payment_date="2026-09-15")
        frappe.db.commit()

        choice = get_payee_choice(payee)
        self.assertEqual(
            {(v["name"], v["vendor_city"]) for v in choice["linked_vendors"]}, {(rohtak, "Rohtak"), (gujarat, "Vadodara")}
        )
        self.assertEqual(
            {(e["name"], e["doctype"]) for e in choice["linked_expenses"]},
            {(pe, "Project Expenses"), (npe, "Non Project Expenses")},
        )
        self.assertEqual(choice["last_payment"], {"date": "2026-10-08", "document": "PO/005/00107/26-27"})
        self.assertEqual((choice["vendors"], choice["expenses"]), (2, 2))

        [suggestion] = suggest_vendor_payees(f"{self.firm} Ductfab (Pune)", self.pan)["suggestions"]
        self.assertEqual((suggestion["name"], suggestion["match"]), (payee, STRONG))
        self.assertEqual(len(suggestion["linked_vendors"]), 2)

    def test_procurement_screens_only(self):
        user = self._user(PROJECT_MANAGER)
        frappe.set_user(user)
        for call in (
            lambda: suggest_vendor_payees("Anything", None),
            lambda: check_vendor_payee("50200061234567", TEST_IFSC),
            lambda: self._create(bank={"account_name": "X", "account_number": "1", "ifsc": TEST_IFSC}),
        ):
            with self.assertRaises(frappe.PermissionError):
                call()
        frappe.set_user(U)

    # -- creating the vendor --------------------------------------------------------------------
    def test_a_vendor_using_an_existing_payee_links_to_it_and_writes_no_old_bank_fields(self):
        payee = self.payees.payee()
        result, vendor = self._create(payee=payee)
        self.assertEqual(result["status"], 200, result)
        doc = frappe.get_doc("Vendors", vendor)
        self.assertEqual(doc.payee, payee)
        self.assertEqual([doc.get(f) for f in OLD_BANK_FIELDS], [None] * len(OLD_BANK_FIELDS))
        self.assertEqual(result["payee"], payee)

    def test_new_bank_details_create_a_payee_and_link_the_vendor_to_it(self):
        holder = self.payees.holder(f"{self.firm} Ductfab")
        number = self.payees.account_number()
        result, vendor = self._create(bank={"account_name": holder, "account_number": number, "ifsc": TEST_IFSC.lower()})
        self.assertEqual(result["status"], 200, result)
        doc = frappe.get_doc("Vendors", vendor)
        payee = frappe.get_doc(PAYEE_DOCTYPE, doc.payee)
        self.assertEqual(
            (payee.account_name, payee.account_number, payee.ifsc, payee.bank_name), (holder, number, TEST_IFSC, "Test Bank")
        )
        self.assertEqual([doc.get(f) for f in OLD_BANK_FIELDS], [None] * len(OLD_BANK_FIELDS))

    def test_details_matching_an_existing_payee_are_refused_naming_it_and_no_vendor_is_made(self):
        number = self.payees.account_number()
        existing = self.payees.payee(account_number=number)
        result, vendor = self._create(bank={"account_name": "Someone", "account_number": "00" + number, "ifsc": TEST_IFSC})
        self.assertIsNone(vendor)
        self.assertNotEqual(result["status"], 200)
        self.assertEqual(result["duplicate"]["name"], existing)
        self.assertIn(existing, result["error"])
        self.assertEqual(check_vendor_payee(number, TEST_IFSC)["duplicate"]["name"], existing)

    def test_an_inactive_payee_cannot_be_picked(self):
        moved = self.payees.payee()
        frappe.db.set_value(PAYEE_DOCTYPE, moved, "status", INACTIVE)
        frappe.db.commit()
        result, vendor = self._create(payee=moved)
        self.assertIsNone(vendor)
        self.assertIn("Inactive", result["error"])

    def test_a_vendor_needs_a_payee_or_bank_details(self):
        result, vendor = self._create()
        self.assertIsNone(vendor)
        self.assertNotEqual(result["status"], 200)
