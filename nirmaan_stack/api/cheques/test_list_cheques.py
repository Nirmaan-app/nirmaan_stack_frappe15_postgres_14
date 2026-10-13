# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The Cheque Payments report's list: one row per Cheque (#1408, spec #1407).

Drives `api/cheques/list_cheques.get_cheques` the way the report's server data table does, after
saving Cheques through the real save endpoint.

⚠️ RUNS AGAINST THE ENV DATABASE (the save endpoint commits). Purged by `ChequeFixture`.
"""

import json

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import nowdate

from nirmaan_stack.api.cheques.cheque_fixture import ChequeFixture
from nirmaan_stack.api.cheques.cheque_status import change_cheque_status
from nirmaan_stack.api.cheques.list_cheques import get_cheque_facets, get_cheques
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
SR = "Service Requests"
LINE = "PO/WO Payment"


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


class TestChequeReportFiltersAndSummary(FrappeTestCase):
    """#1417: the summary strip, the line filters and the facets come from the table's own WHERE."""

    def setUp(self):
        frappe.set_user(U)
        self.fx = TaxedWorkOrderFixture.attach(self)
        self.cheques = ChequeFixture.attach(self)
        self.vendor = self.fx.vendor()
        self.project_a = self.fx.project()
        self.project_b = self.fx.project()
        self.wo_a = self.fx.service_request(self.project_a, self.vendor)
        self.wo_b = self.fx.service_request(self.project_b, self.vendor)
        frappe.db.commit()

    def tearDown(self):
        frappe.set_user(U)

    def _save(self, amount, *, lines=None, description="Advance"):
        result = save_cheque(
            bank="ICICI Bank",
            cheque_no=self.cheques.number(),
            cheque_date=nowdate(),
            amount=amount,
            vendor=self.vendor,
            description=description,
            attachment=PHOTO,
            lines=json.dumps(lines or []),
        )
        return self.cheques.track(result["cheque"])

    def _wo_line(self, project, wo, amount):
        return {"line_type": LINE, "project": project, "record_doctype": SR, "record_name": wo, "amount": amount}

    def _two_project_cheque(self):
        return self._save(
            50000,
            lines=[self._wo_line(self.project_a, self.wo_a, 30000), self._wo_line(self.project_b, self.wo_b, 20000)],
        )

    def _list(self, *filters, **kwargs):
        return get_cheques(filters=json.dumps([["vendor", "=", self.vendor], *filters]), **kwargs)

    def test_a_multi_project_cheque_is_found_by_each_project_and_counted_once_at_its_full_amount(self):
        cheque = self._two_project_cheque()

        for project in (self.project_a, self.project_b):
            result = self._list(["project", "in", [project]])
            self.assertEqual([r["name"] for r in result["data"]], [cheque], project)
            self.assertEqual(result["aggregates"]["count"], 1)
            self.assertEqual(result["aggregates"]["total_amount"], 50000)
            self.assertEqual(result["aggregates"]["issued_amount"], 50000)

        both = self._list(["project", "in", [self.project_a, self.project_b]])
        self.assertEqual(both["total_count"], 1)
        self.assertEqual(both["aggregates"]["total_amount"], 50000)

        self.assertEqual(self._list(["project", "=", self.fx.project()])["total_count"], 0)

    def test_a_po_wo_filter_matches_a_cheque_when_any_line_names_it(self):
        cheque = self._two_project_cheque()
        self._save(25000)  # an Ad-hoc cheque: no lines, so no PO/WO

        self.assertEqual([r["name"] for r in self._list(["record_name", "=", self.wo_b])["data"]], [cheque])
        self.assertEqual(self._list(["record_name", "in", [self.wo_a]])["aggregates"]["total_amount"], 50000)

    def test_a_row_carries_its_lines_in_order(self):
        cheque = self._two_project_cheque()

        row = self._list(["name", "=", cheque])["data"][0]

        self.assertEqual(
            [(l["line_type"], l["project"], l["project_name"], l["record_doctype"], l["record_name"],
              l["payment_name"], l["amount"]) for l in row["lines"]],
            [
                (LINE, self.project_a, self.project_a, SR, self.wo_a, None, 30000),
                (LINE, self.project_b, self.project_b, SR, self.wo_b, None, 20000),
            ],
        )
        self.assertEqual(self._list(["name", "=", self._save(1000)])["data"][0]["lines"], [])

    def test_the_summary_counts_each_status_over_the_filtered_rows(self):
        issued = self._save(25000)
        cleared = self._save(10000)
        cancelled = self._save(5000)
        change_cheque_status(cleared, "Cleared")
        change_cheque_status(cancelled, "Cancelled", note="Torn up")

        summary = self._list()["aggregates"]
        self.assertEqual(
            summary,
            {
                "count": 3, "total_amount": 40000,
                "issued_count": 1, "issued_amount": 25000,
                "cleared_count": 1, "cleared_amount": 10000,
                "cancelled_count": 1, "cancelled_amount": 5000,
            },
        )

        only_cleared = self._list(["status", "in", ["Cleared"]])["aggregates"]
        self.assertEqual((only_cleared["count"], only_cleared["total_amount"]), (1, 10000))
        self.assertEqual((only_cleared["issued_count"], only_cleared["issued_amount"]), (0, 0))

        number = frappe.db.get_value("Cheques", issued, "cheque_no")
        searched = self._list(search_term=number, current_search_fields='["cheque_no"]')
        self.assertEqual([r["name"] for r in searched["data"]], [issued])
        self.assertEqual(
            (searched["aggregates"]["count"], searched["aggregates"]["issued_amount"],
             searched["aggregates"]["cleared_count"]),
            (1, 25000, 0),
        )

    def test_facets_name_what_the_filtered_rows_hold(self):
        self._two_project_cheque()
        cleared = self._save(10000, lines=[self._wo_line(self.project_a, self.wo_a, 10000)])
        change_cheque_status(cleared, "Cleared")
        vendor_only = json.dumps([["vendor", "=", self.vendor]])

        projects = get_cheque_facets("project", filters=vendor_only)["values"]
        self.assertEqual(
            sorted((v["value"], v["label"], v["count"]) for v in projects),
            sorted([(self.project_a, self.project_a, 2), (self.project_b, self.project_b, 1)]),
        )

        records = get_cheque_facets(
            "record_name", filters=json.dumps([["vendor", "=", self.vendor], ["status", "in", ["Cleared"]]])
        )["values"]
        self.assertEqual([(v["value"], v["count"]) for v in records], [(self.wo_a, 1)])

        statuses = get_cheque_facets("status", filters=vendor_only)["values"]
        self.assertEqual(sorted((v["value"], v["count"]) for v in statuses), [("Cleared", 1), ("Issued", 1)])

        vendors = get_cheque_facets("vendor", filters=vendor_only)["values"]
        self.assertEqual([(v["value"], v["label"], v["count"]) for v in vendors], [(self.vendor, self.vendor, 2)])

    def test_an_unknown_facet_is_refused(self):
        with self.assertRaises(frappe.ValidationError):
            get_cheque_facets("amount")
