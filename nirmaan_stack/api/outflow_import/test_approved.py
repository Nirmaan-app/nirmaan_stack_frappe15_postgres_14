# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The approved inbox -- `api/outflow_import/approved.py` over `services/.../ledger_read.py`.

    bench --site localhost run-tests --app nirmaan_stack \
        --module nirmaan_stack.api.outflow_import.test_approved

⚠️ THIS SUITE READS THE LIVE LEDGERS and plants nothing of its own beyond one non-project expense.
So it asserts PARTITIONS AND INVARIANTS -- the ledger split adds to the total, a filter narrows, the
two date keys never both fill -- rather than exact counts, which drift as real data moves. That is
the same discipline `test_review` records for the same reason.
"""

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.outflow_import.approved import (
    get_approved_projects,
    list_approved_records,
)
from nirmaan_stack.services.outflow_import.ledger_read import LEDGER_SOURCES

PAYMENT = "Project Payments"
PROJECT_EXPENSE = "Project Expenses"
NON_PROJECT_EXPENSE = "Non Project Expenses"


class TestApprovedInbox(FrappeTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        # One planted record, so the suite has something it OWNS to assert exact behaviour on
        # without depending on whatever the live ledgers happen to hold today.
        cls.planted = f"TEST-NPE-{frappe.generate_hash(length=10)}"
        frappe.db.sql(
            """
            INSERT INTO "tabNon Project Expenses"
                (name, creation, modified, modified_by, owner, docstatus, idx,
                 amount, status, description)
            VALUES (%s, NOW(), NOW(), %s, %s, 0, 0, %s, %s, %s)
            """,
            (cls.planted, "Administrator", "Administrator", 4242.42, "Approved",
             "TESTZEPHYR unmistakable description"),
        )
        frappe.db.commit()

    @classmethod
    def tearDownClass(cls):
        frappe.db.delete(NON_PROJECT_EXPENSE, {"name": cls.planted})
        frappe.db.commit()
        super().tearDownClass()

    # --- the shape every ledger comes back in --------------------------------------------------

    def test_every_row_declares_every_key_whatever_ledger_it_came_from(self):
        """⚠️ THE POINT OF THE SHARED SHAPE. A caller putting all three in one table must never have
        to ask which ledger it is holding before it can read a key."""
        rows = list_approved_records(limit=50)["rows"]
        self.assertTrue(rows)
        for row in rows:
            for key in (
                "target_doctype", "name", "amount", "status", "vendor_name",
                "project_name", "order_doctype", "order_name", "expense_type",
                "approved_on", "updated_on",
            ):
                self.assertIn(key, row)

    def test_only_approved_records_are_listed(self):
        for row in list_approved_records(limit=100)["rows"]:
            self.assertEqual(row["status"], "Approved")

    # --- asymmetry 1: only payments have an approval date --------------------------------------

    def test_a_modification_date_is_never_presented_as_an_approval(self):
        """⚠️ OWNER RULING 2026-08-06. Neither expense doctype records an approval date -- not a
        field, not an approver. Merging the two into one key would present a modification as an
        approval on every expense in the list."""
        for row in list_approved_records(limit=100)["rows"]:
            if row["target_doctype"] == PAYMENT:
                self.assertEqual(row["updated_on"], "", row["name"])
            else:
                self.assertEqual(row["approved_on"], "", row["name"])

    def test_a_row_never_fills_both_date_keys(self):
        for row in list_approved_records(limit=100)["rows"]:
            self.assertFalse(
                bool(row["approved_on"]) and bool(row["updated_on"]),
                f"{row['name']} claims both an approval and a modification date",
            )

    # --- asymmetry 2: Project Expenses.amount is a Data column ---------------------------------

    def test_an_unreadable_amount_blanks_the_row_rather_than_the_page(self):
        """⚠️ THE CAST IS THE HAZARD. `Project Expenses.amount` is Data, so a non-numeric value is
        permitted and `CAST` on it fails the WHOLE statement -- taking down the page, not one row.
        The guard makes it NULL instead. There is no junk in the live data today, so this plants
        some: without the regex guard this test raises rather than fails."""
        junk = f"TEST-PE-{frappe.generate_hash(length=10)}"
        project = frappe.db.get_value("Projects", {}, "name")
        frappe.db.sql(
            """
            INSERT INTO "tabProject Expenses"
                (name, creation, modified, modified_by, owner, docstatus, idx,
                 amount, status, description, projects)
            VALUES (%s, NOW(), NOW(), %s, %s, 0, 0, %s, %s, %s, %s)
            """,
            (junk, "Administrator", "Administrator", "not a number", "Approved",
             "TESTJUNKAMOUNT", project),
        )
        frappe.db.commit()
        try:
            page = list_approved_records(search="TESTJUNKAMOUNT", limit=10)
            names = [r["name"] for r in page["rows"]]
            self.assertIn(junk, names, "a record with an unreadable amount must still be listed")
            row = next(r for r in page["rows"] if r["name"] == junk)
            # ⚠️ `None`, NOT 0. A zero is a claim that the record costs nothing; an unreadable value
            # is not that claim.
            self.assertIsNone(row["amount"])
        finally:
            frappe.db.delete(PROJECT_EXPENSE, {"name": junk})
            frappe.db.commit()

    # --- asymmetry 3: Non Project Expenses has no vendor and no project ------------------------

    def test_a_non_project_expense_carries_no_vendor_and_no_project(self):
        rows = list_approved_records(ledger=NON_PROJECT_EXPENSE, limit=50)["rows"]
        self.assertTrue(rows)
        for row in rows:
            self.assertEqual(row["vendor_name"], "")
            self.assertEqual(row["project_name"], "")

    def test_a_project_filter_excludes_the_ledger_that_has_no_projects(self):
        """⚠️ IT DROPS OUT ENTIRELY rather than contributing an always-false predicate. Asking which
        non-project expenses are on a project has one honest answer."""
        project = next(
            (
                r["project_name"]
                for r in list_approved_records(ledger=PAYMENT, limit=20)["rows"]
                if r["project_name"]
            ),
            None,
        )
        if not project:
            self.skipTest("no approved payment carries a project name right now")
        page = list_approved_records(project=project, limit=100)
        self.assertTrue(page["rows"])
        for row in page["rows"]:
            self.assertNotEqual(row["target_doctype"], NON_PROJECT_EXPENSE)
            self.assertEqual(row["project_name"], project)

    # --- counts, filters and paging ------------------------------------------------------------

    def test_the_ledger_split_adds_up_to_the_total(self):
        page = list_approved_records(limit=1)
        self.assertEqual(sum(x["count"] for x in page["by_ledger"].values()), page["total"])

    def test_the_totals_are_computed_under_the_same_filters_as_the_page(self):
        """⚠️ THE DEFECT THIS FEATURE HAS ALREADY SHIPPED ONCE. A count taken under different filters
        than the list it labels is a lie that looks like a paging bug."""
        narrow = list_approved_records(search="TESTZEPHYR", limit=50)
        self.assertEqual(narrow["total"], 1)
        self.assertEqual(len(narrow["rows"]), 1)
        self.assertEqual(narrow["rows"][0]["name"], self.planted)

    def test_a_ledger_filter_returns_only_that_ledger(self):
        for doctype in LEDGER_SOURCES:
            for row in list_approved_records(ledger=doctype, limit=20)["rows"]:
                self.assertEqual(row["target_doctype"], doctype)

    def test_an_unknown_ledger_reads_them_all_rather_than_none(self):
        """⚠️ FAILING OPEN, matching `_scope_clause`. On a read-only browse a typo that shows too
        much is a nuisance; one that shows an empty screen reads as "nothing is approved"."""
        self.assertEqual(
            list_approved_records(ledger="not-a-ledger", limit=1)["total"],
            list_approved_records(limit=1)["total"],
        )

    def test_paging_walks_the_set_without_repeating_a_row(self):
        first = list_approved_records(limit=5, offset=0)["rows"]
        second = list_approved_records(limit=5, offset=5)["rows"]
        self.assertFalse({r["name"] for r in first} & {r["name"] for r in second})

    def test_the_page_size_is_capped(self):
        self.assertLessEqual(list_approved_records(limit=99999)["limit"], 200)

    def test_sorting_by_amount_actually_orders_by_amount(self):
        rows = list_approved_records(sort_by="amount", sort_dir="desc", limit=10)["rows"]
        amounts = [r["amount"] for r in rows if r["amount"] is not None]
        self.assertEqual(amounts, sorted(amounts, reverse=True))

    def test_an_unknown_sort_key_falls_back_rather_than_reaching_sql(self):
        """The key is interpolated, so the allow-list is the whole defence."""
        self.assertTrue(list_approved_records(sort_by="'; DROP TABLE x; --", limit=1)["rows"])

    # --- the project filter's own options ------------------------------------------------------

    def test_the_project_list_offers_only_projects_that_have_something_approved(self):
        offered = set(get_approved_projects()["projects"])
        self.assertTrue(offered)
        self.assertNotIn("", offered)

        # ⚠️ THE ASSERTION THAT CAUGHT THE DEFECT. The options must be a SUPERSET of every project
        # visible on any page -- the first implementation built them from ONE page of 200 against a
        # set of 332, so a project could appear in the table and be missing from its own filter.
        seen = set()
        for offset in (0, 200):
            seen |= {
                r["project_name"]
                for r in list_approved_records(limit=200, offset=offset)["rows"]
                if r["project_name"]
            }
        self.assertTrue(
            seen <= offered, f"projects on screen but not offered: {sorted(seen - offered)}"
        )
