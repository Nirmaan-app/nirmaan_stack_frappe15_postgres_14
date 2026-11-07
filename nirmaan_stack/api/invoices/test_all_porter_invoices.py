# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Vendor Invoice Recon -> All Invoices -> Porter (#1646, spec #1637).

DB tests: `DEVENV test --module nirmaan_stack.api.invoices.test_all_porter_invoices`. One row per Porter Invoice
(one PDF covers many trips) with its Validate result and its PDF, paged and filtered on the server. The suite's
Porter Invoices are inserted after its users are made, never committed, and rolled back.
"""

import json

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.invoices.all_porter_invoices import get_all_porter_invoices
from nirmaan_stack.api.outflow_import.test_skip_row import ACCOUNTANT, OUTSIDER, _Users

PORTER = "Porter Invoice"


class TestThePorterPill(FrappeTestCase):
    def setUp(self):
        self.users = _Users()
        self.addCleanup(self.users.purge)
        # Made first: making a user commits.
        self.accountant, self.outsider = self.users.make(ACCOUNTANT), self.users.make(OUTSIDER)
        self.addCleanup(frappe.db.rollback)
        self.tag = frappe.generate_hash(length=6).upper()
        self.batch = f"OFI-TEST-{self.tag}"
        # name -> (Validate result, its message, invoice date, has its PDF)
        spec = {
            "A": ("Passed", None, "2025-10-31", True),
            "B": ("Failed", "Fare differs: ₹1,000.00 on the statement, ₹900.00 on the invoice.", "2025-09-30", True),
            "C": ("Error", "The invoice could not be downloaded.", None, False),
        }
        now = frappe.utils.now()
        for key, (status, message, day, has_pdf) in spec.items():
            name = f"TEST-PRT-{self.tag}-{key}"
            doc = frappe.get_doc({
                "doctype": PORTER, "invoice_number": name, "import_batch": self.batch,
                "validation_status": status, "validation_message": message, "city": "Testpur",
                "completed_orders": 3, "read_invoice_date": day, "fare_total": 1000, "tax_total": 180,
                "invoice_file": f"/private/files/{name}.pdf" if has_pdf else None,
            })
            doc.name, doc.creation, doc.modified = name, now, now
            doc.owner = doc.modified_by = "Administrator"
            doc.db_insert()
            setattr(self, key.lower(), name)

    def _page(self, filters=(), user=None, **kwargs) -> dict:
        frappe.set_user(user or self.accountant)
        try:
            return get_all_porter_invoices(
                doctype=PORTER, filters=json.dumps([["import_batch", "=", self.batch], *filters]),
                limit_start=0, limit_page_length=kwargs.pop("limit_page_length", 50), **kwargs,
            )
        finally:
            frappe.set_user("Administrator")

    def test_one_row_per_porter_invoice_with_its_validate_result_and_its_pdf(self):
        rows = {r["name"]: r for r in self._page()["data"]}

        self.assertEqual(set(rows), {self.a, self.b, self.c})
        b = rows[self.b]
        self.assertEqual((b["validation_status"], b["validation_message"]),
                         ("Failed", "Fare differs: ₹1,000.00 on the statement, ₹900.00 on the invoice."))
        self.assertEqual(b["invoice_file"], f"/private/files/{self.b}.pdf")
        self.assertEqual((str(b["read_invoice_date"]), b["city"], b["completed_orders"]), ("2025-09-30", "Testpur", 3))
        self.assertEqual((float(b["fare_total"]), float(b["tax_total"]), float(b["invoice_total"])), (1000.0, 180.0, 1180.0))
        # An invoice whose PDF never arrived is listed, with nothing to open.
        self.assertIsNone(rows[self.c]["invoice_file"])

    def test_the_pill_filters_by_validate_result_and_pages_on_the_server(self):
        failed = self._page([["validation_status", "in", ["Failed", "Error"]]], order_by="read_invoice_date asc",
                            limit_page_length=1)

        self.assertEqual(failed["total_count"], 2)
        self.assertEqual([r["name"] for r in failed["data"]], [self.b])

    def test_a_search_finds_an_invoice_by_its_number(self):
        rows = self._page(search_term=f"{self.tag}-A", current_search_fields=json.dumps(["name"]))["data"]

        self.assertEqual([r["name"] for r in rows], [self.a])

    def test_someone_outside_admin_and_the_accountant_profiles_cannot_list(self):
        with self.assertRaises(frappe.PermissionError):
            self._page(user=self.outsider)

    def test_a_filter_the_list_cannot_apply_is_refused_not_ignored(self):
        # Ignoring it would show more rows than were asked for.
        for bad in (["validation_status"], ["fare_total", "in", [1000]], ["validation_status", "like", "%Pass%"]):
            with self.assertRaises(frappe.ValidationError, msg=bad):
                self._page([bad])
