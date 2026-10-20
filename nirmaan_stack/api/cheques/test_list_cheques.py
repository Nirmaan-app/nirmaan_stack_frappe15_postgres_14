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
from frappe.utils import add_days, nowdate

from nirmaan_stack.api.cheques.cheque_fixture import ChequeFixture
from nirmaan_stack.api.cheques.cheque_status import cancel_cheque, clear_cheque
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
PO = "Procurement Orders"
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
        name = self.cheques.plant_cheque(**{k: v for k, v in values.items() if v is not None})
        return name, values["cheque_no"]

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
        return self.cheques.plant_cheque(
            bank="ICICI Bank",
            cheque_no=self.cheques.number(),
            cheque_date=nowdate(),
            amount=amount,
            vendor=self.vendor,
            description=description,
            attachment=PHOTO,
            lines=lines or [],
        )

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
        clear_cheque(cleared, nowdate())
        cancel_cheque(cancelled, "Torn up")

        summary = self._list()["aggregates"]
        self.assertEqual(
            summary,
            {
                "count": 3, "total_amount": 40000,
                "pending_count": 0, "pending_amount": 0,
                "issued_count": 1, "issued_amount": 25000,
                "cleared_count": 1, "cleared_amount": 10000,
                "cancelled_count": 1, "cancelled_amount": 5000,
                "stale_count": 0, "stale_amount": 0,
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
        clear_cheque(cleared, nowdate())
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


class TestChequeTypeAndDates(FrappeTestCase):
    """#1478: each row carries its cheque type, issue and clearance dates, how it cleared and the Old-type
    flag; the list filters on type and both dates, and the strip counts Pending."""

    def setUp(self):
        frappe.set_user(U)
        self.fx = TaxedWorkOrderFixture.attach(self)
        self.cheques = ChequeFixture.attach(self)
        self.vendor = self.fx.vendor()
        frappe.db.commit()

    def tearDown(self):
        frappe.set_user(U)

    def _save(self, amount=25000, **values):
        """A Cheque saved through the report, then given `values` raw: the writers that set them (issue on
        approval, clear, deposit cheques) come in later tickets of spec #1477."""
        name = self.cheques.plant_cheque(bank="ICICI Bank", cheque_no=self.cheques.number(), cheque_date=nowdate(),
                                         amount=amount, vendor=self.vendor, description="Advance", attachment=PHOTO)
        if values:
            frappe.db.set_value("Cheques", name, values, update_modified=False)
            frappe.db.commit()
        return name

    def _names(self, *filters):
        rows = get_cheques(filters=json.dumps([["vendor", "=", self.vendor], *filters]))["data"]
        return sorted(r["name"] for r in rows)

    def test_a_new_cheque_is_a_payment_cheque(self):
        name = self._save()
        self.assertEqual(frappe.db.get_value("Cheques", name, "cheque_type"), "Payment")

    def test_a_row_carries_type_dates_how_it_cleared_and_old_type(self):
        name = self._save(cheque_type="Payment", status="Cleared", issue_date="2026-09-02",
                          clearance_date="2026-09-10", cleared_by="Bank import", old_type=1)

        row = get_cheques(filters=json.dumps([["name", "=", name]]))["data"][0]

        self.assertEqual(
            (row["cheque_type"], str(row["issue_date"]), str(row["clearance_date"]), row["cleared_by"], row["old_type"]),
            ("Payment", "2026-09-02", "2026-09-10", "Bank import", 1),
        )

    def test_the_list_filters_on_cheque_type(self):
        payment = self._save()
        deposit = self._save(cheque_type="Security Deposit")

        self.assertEqual(self._names(["cheque_type", "=", "Security Deposit"]), [deposit])
        self.assertEqual(self._names(["cheque_type", "in", ["Payment"]]), [payment])
        types = get_cheque_facets("cheque_type", filters=json.dumps([["vendor", "=", self.vendor]]))["values"]
        self.assertEqual(sorted((v["value"], v["count"]) for v in types), [("Payment", 1), ("Security Deposit", 1)])

    def test_the_list_filters_on_issue_and_clearance_dates(self):
        early = self._save(issue_date="2026-09-02", clearance_date="2026-09-20")
        late = self._save(issue_date="2026-09-15")
        self._save()  # never issued

        self.assertEqual(self._names(["issue_date", "between", ["2026-09-01", "2026-09-05"]]), [early])
        self.assertEqual(self._names(["issue_date", ">=", "2026-09-01"]), sorted([early, late]))
        self.assertEqual(self._names(["clearance_date", "between", ["2026-09-19", "2026-09-21"]]), [early])

    def test_the_summary_counts_pending_cheques(self):
        self._save(10000, status="Approval Pending")
        self._save(25000)

        summary = get_cheques(filters=json.dumps([["vendor", "=", self.vendor]]))["aggregates"]

        self.assertEqual((summary["pending_count"], summary["pending_amount"]), (1, 10000))
        self.assertEqual((summary["issued_count"], summary["count"]), (1, 2))


class TestTheChequeTrackerTabs(FrappeTestCase):
    """#1483: the Cheque Tracker's tabs are filters on this list. Cheque Issued – Reconciliation Pending sends
    `status = Issued` and `cheque_type = Payment` (`frontend/src/utils/cheques/chequeTabs.ts`), and its strip
    reads the stale figures: Issued cheques issued more than 90 days ago."""

    def setUp(self):
        frappe.set_user(U)
        self.fx = TaxedWorkOrderFixture.attach(self)
        self.cheques = ChequeFixture.attach(self)
        self.vendor = self.fx.vendor()
        frappe.db.commit()

    def tearDown(self):
        frappe.set_user(U)

    def _cheque(self, amount=25000, **values):
        """A Cheque saved through the report, then put in the state a test needs (raw: the writers that set
        status and dates by the new rules come with other tickets of spec #1477)."""
        name = self.cheques.plant_cheque(bank="ICICI Bank", cheque_no=self.cheques.number(), cheque_date=nowdate(),
                                         amount=amount, vendor=self.vendor, description="Advance", attachment=PHOTO)
        frappe.db.set_value("Cheques", name, {"status": "Issued", "cheque_type": "Payment", **values},
                            update_modified=False)
        frappe.db.commit()
        return name

    def _issued_tab(self, **kwargs):
        return get_cheques(
            filters=json.dumps([["vendor", "=", self.vendor], ["status", "=", "Issued"], ["cheque_type", "=", "Payment"]]),
            **kwargs,
        )

    def test_the_issued_tab_lists_only_issued_payment_cheques(self):
        issued = self._cheque(issue_date=nowdate())
        self._cheque(status="Approval Pending")
        self._cheque(status="Cleared", clearance_date=nowdate())
        self._cheque(status="Cancelled")
        self._cheque(cheque_type="Security Deposit", issue_date=nowdate())

        result = self._issued_tab()

        self.assertEqual([r["name"] for r in result["data"]], [issued])
        self.assertEqual((result["total_count"], result["aggregates"]["total_amount"]), (1, 25000))

    def test_stale_counts_issued_cheques_issued_more_than_90_days_ago(self):
        self._cheque(10000, issue_date=add_days(nowdate(), -91))
        self._cheque(20000, issue_date=add_days(nowdate(), -90))  # on the line: not yet stale
        # An old cheque made before issue dates counts from its cheque date.
        self._cheque(40000, issue_date=None, cheque_date=add_days(nowdate(), -120))
        self._cheque(80000, status="Cleared", issue_date=add_days(nowdate(), -200))
        # A Security Deposit is held, never cashed, so it is never stale.
        self._cheque(160000, cheque_type="Security Deposit", issue_date=add_days(nowdate(), -200))

        aggregates = get_cheques(filters=json.dumps([["vendor", "=", self.vendor]]))["aggregates"]

        self.assertEqual((aggregates["stale_count"], aggregates["stale_amount"]), (2, 50000))
        tab = self._issued_tab()["aggregates"]
        self.assertEqual((tab["count"], tab["stale_count"], tab["stale_amount"]), (3, 2, 50000))

    def test_the_issued_tab_sorts_by_issue_date_oldest_first(self):
        newer = self._cheque(issue_date=add_days(nowdate(), -5))
        older = self._cheque(issue_date=add_days(nowdate(), -40))

        rows = self._issued_tab(order_by="issue_date asc")["data"]

        self.assertEqual([r["name"] for r in rows], [older, newer])

    def test_a_project_manager_cannot_read_the_issued_tab(self):
        pm = TestListCheques._user(self, (PROJECT_MANAGER,))
        frappe.set_user(pm)
        with self.assertRaises(frappe.PermissionError):
            self._issued_tab()


class TestTheChequesOfOnePo(FrappeTestCase):
    """#1521 (spec #1514, stories 21 and 23): the PO page's "Cheques issued for this PO" card asks the list
    for `record_name = <its PO>`. That lists the Payment cheques with a line on the PO and the deposit cheques
    securing it, and each row carries `record_amount`: what its lines put on that PO."""

    def setUp(self):
        frappe.set_user(U)
        self.fx = TaxedWorkOrderFixture.attach(self)
        self.cheques = ChequeFixture.attach(self)
        self.vendor = self.fx.vendor()
        self.project = self.fx.project()
        self.po = ChequeFixture.plant_po(self, self.fx, project=self.project, vendor=self.vendor)
        self.other_po = ChequeFixture.plant_po(self, self.fx, project=self.project, vendor=self.vendor)
        frappe.db.commit()

    def tearDown(self):
        frappe.set_user(U)

    def _payment_cheque(self, *lines):
        """A Payment cheque with one PO/WO Payment line per `(po, amount)`, for their total."""
        return self.cheques.plant_cheque(
            bank="ICICI Bank", cheque_no=self.cheques.number(), cheque_date=nowdate(),
            amount=sum(amount for _, amount in lines), vendor=self.vendor, attachment=PHOTO,
            lines=[{"line_type": LINE, "project": self.project, "record_doctype": PO, "record_name": po,
                    "amount": amount} for po, amount in lines],
        )

    def _deposit_cheque(self, *pos):
        return self.cheques.track(save_cheque(
            cheque_type="Security Deposit", bank="Others", bank_name="HDFC Bank", cheque_no=self.cheques.number(),
            cheque_date=nowdate(), issue_date=nowdate(), amount=200000, vendor=self.vendor, attachment=PHOTO,
            lines=[{"line_type": "Secured PO/WO", "record_doctype": PO, "record_name": po} for po in pos],
        )["cheque"])

    def _of_po(self, po):
        rows = get_cheques(filters=json.dumps([["record_name", "=", po]]), limit_page_length=500)["data"]
        return {r["name"]: (r["cheque_type"], r["amount"], r["record_amount"]) for r in rows}

    def test_it_lists_the_po_s_payment_and_deposit_cheques_with_what_each_puts_on_the_po(self):
        one_line = self._payment_cheque((self.po, 30000))
        shared = self._payment_cheque((self.po, 20000), (self.other_po, 15000))
        deposit = self._deposit_cheque(self.po, self.other_po)
        self._payment_cheque((self.other_po, 40000))  # another PO's cheques are not listed
        self._deposit_cheque(self.other_po)

        self.assertEqual(self._of_po(self.po), {
            one_line: ("Payment", 30000, 30000),
            shared: ("Payment", 35000, 20000),
            # A deposit secures the PO and pays nothing on it: no line amount.
            deposit: ("Security Deposit", 200000, 0),
        })

    def test_a_row_carries_no_po_amount_when_no_po_is_asked_for(self):
        name = self._payment_cheque((self.po, 30000))

        row = get_cheques(filters=json.dumps([["name", "=", name]]))["data"][0]

        self.assertIsNone(row["record_amount"])
