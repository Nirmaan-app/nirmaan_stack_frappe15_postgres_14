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
    _DEFAULT_PAGE_SIZE,
    export_approved_records,
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


class TestTheApprovedExport(FrappeTestCase):
    """`export_approved_records` -- the WHOLE filtered set, not the page (Export control).

    ⚠️ THIS CLASS PLANTS MORE ROWS THAN A PAGE HOLDS and asserts on THOSE, by name. Everything it
    checks is scoped to its own token, so it neither depends on nor disturbs whatever the live
    ledgers hold; teardown deletes exactly the names it inserted and nothing else.
    """

    #: One more than the real default page size, so "not limited to a page" is measured against the
    #: number the screen actually uses rather than a monkeypatched stand-in.
    PLANTED = _DEFAULT_PAGE_SIZE + 5
    TOKEN = None

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.TOKEN = f"TESTEXPORTBULK{frappe.generate_hash(length=8).upper()}"
        cls.names = [f"TEST-NPE-EXP-{frappe.generate_hash(length=10)}" for _ in range(cls.PLANTED)]
        values, params = [], []
        for i, name in enumerate(cls.names):
            values.append("(%s, NOW(), NOW(), %s, %s, 0, 0, %s, %s, %s)")
            params.extend([name, "Administrator", "Administrator", 100 + i, "Approved",
                           f"{cls.TOKEN} row {i}"])
        frappe.db.sql(
            """
            INSERT INTO "tabNon Project Expenses"
                (name, creation, modified, modified_by, owner, docstatus, idx,
                 amount, status, description)
            VALUES """
            + ", ".join(values),
            tuple(params),
        )

        # A Project Expense too -- the export must show the two date keys apart, and only a payment
        # ever fills `approved_on` (asymmetry 1). Without an expense in the set that guard is vacuous.
        cls.expense = f"TEST-PE-EXP-{frappe.generate_hash(length=10)}"
        cls.expense_project = frappe.db.get_value("Projects", {}, "name")
        frappe.db.sql(
            """
            INSERT INTO "tabProject Expenses"
                (name, creation, modified, modified_by, owner, docstatus, idx,
                 amount, status, description, projects)
            VALUES (%s, NOW(), NOW(), %s, %s, 0, 0, %s, %s, %s, %s)
            """,
            (cls.expense, "Administrator", "Administrator", "777.5", "Approved",
             f"{cls.TOKEN} expense", cls.expense_project),
        )
        frappe.db.commit()

    @classmethod
    def tearDownClass(cls):
        # ⚠️ SCOPED TO THE NAMES THIS CLASS INSERTED. This suite runs against the live site; a
        # purge by status or by token prefix would be a delete over other people's records.
        frappe.db.delete(NON_PROJECT_EXPENSE, {"name": ["in", cls.names]})
        frappe.db.delete(PROJECT_EXPENSE, {"name": cls.expense})
        frappe.db.commit()
        super().tearDownClass()

    @staticmethod
    def _ids(rows):
        """Identity, not count. Two sets of the same size can still be different rows."""
        return {(r["target_doctype"], r["name"]) for r in rows}

    # --- the same population as the list, row for row ------------------------------------------

    def test_the_export_holds_exactly_the_rows_the_list_holds(self):
        """⚠️ IDENTITY, NOT COUNT. Equal totals over different rows is precisely the failure an
        export must not have -- and it is invisible to a length check."""
        listed = list_approved_records(search=self.TOKEN, limit=200)
        exported = export_approved_records(search=self.TOKEN)
        self.assertEqual(listed["total"], self.PLANTED + 1)
        self.assertEqual(exported["total"], listed["total"])
        self.assertEqual(self._ids(exported["rows"]), self._ids(listed["rows"]))

    def test_a_row_comes_back_in_the_same_shape_the_page_returns(self):
        """One row type for both surfaces, or the screen needs a second renderer and they drift."""
        row = next(
            r for r in export_approved_records(search=self.TOKEN)["rows"]
            if r["name"] == self.names[0]
        )
        for key in (
            "target_doctype", "name", "amount", "status", "vendor_name",
            "project_name", "order_doctype", "order_name", "expense_type",
            "approved_on", "updated_on",
        ):
            self.assertIn(key, row)

    # --- it is not a page ----------------------------------------------------------------------

    def test_the_export_is_not_limited_to_a_page(self):
        """⚠️ THE WHOLE REASON THE ENDPOINT EXISTS. The list stops at its page size with more rows
        behind it; the export must carry every one of them."""
        page = list_approved_records(search=self.TOKEN)
        self.assertEqual(len(page["rows"]), _DEFAULT_PAGE_SIZE)
        self.assertGreater(page["total"], _DEFAULT_PAGE_SIZE)

        exported = export_approved_records(search=self.TOKEN)
        self.assertEqual(len(exported["rows"]), page["total"])
        self.assertTrue(set(self.names) <= {r["name"] for r in exported["rows"]})

    def test_the_screens_page_cap_is_untouched_by_the_export(self):
        """⚠️ `_MAX_PAGE_SIZE` GUARDS THE SCREEN and must not be widened to serve a file: raising it
        would let the panel render the whole ledger in one go."""
        self.assertLessEqual(list_approved_records(search=self.TOKEN, limit=99999)["limit"], 200)

    # --- every filter narrows the export exactly as it narrows the list ------------------------

    def test_a_search_narrows_the_export_the_way_it_narrows_the_list(self):
        one = export_approved_records(search="TESTZEPHYRNOTHINGMATCHESTHIS")
        self.assertEqual(one["total"], 0)
        self.assertEqual(one["rows"], [])

        both = export_approved_records(search=self.TOKEN)
        self.assertEqual(
            self._ids(both["rows"]),
            self._ids(list_approved_records(search=self.TOKEN, limit=200)["rows"]),
        )

    def test_a_ledger_filter_narrows_the_export_the_way_it_narrows_the_list(self):
        for doctype in LEDGER_SOURCES:
            exported = export_approved_records(ledger=doctype, search=self.TOKEN)
            listed = list_approved_records(ledger=doctype, search=self.TOKEN, limit=200)
            self.assertEqual(exported["total"], listed["total"])
            self.assertEqual(self._ids(exported["rows"]), self._ids(listed["rows"]))
            for row in exported["rows"]:
                self.assertEqual(row["target_doctype"], doctype)

        self.assertEqual(
            export_approved_records(ledger=NON_PROJECT_EXPENSE, search=self.TOKEN)["total"],
            self.PLANTED,
        )

    def test_a_project_filter_narrows_the_export_and_drops_the_projectless_ledger(self):
        """⚠️ ASYMMETRY 3 THROUGH THE EXPORT. `Non Project Expenses` has no project column, so a
        project filter excludes that ledger entirely -- the planted 55 must vanish, not match."""
        # ⚠️ THE FILTER MATCHES THE PROJECT AS THE ROW REPORTS IT (`project_name`, which falls back
        # to the link when the join misses), not the Projects doc id -- so take it from the row.
        planted = next(
            (
                r for r in export_approved_records(search=self.TOKEN)["rows"]
                if r["name"] == self.expense
            ),
            None,
        )
        if planted is None or not planted["project_name"]:
            self.skipTest("no project exists on this site")
        wanted = planted["project_name"]
        exported = export_approved_records(search=self.TOKEN, project=wanted)
        listed = list_approved_records(search=self.TOKEN, project=wanted, limit=200)
        self.assertEqual(self._ids(exported["rows"]), self._ids(listed["rows"]))
        self.assertEqual([r["name"] for r in exported["rows"]], [self.expense])
        for row in exported["rows"]:
            self.assertNotEqual(row["target_doctype"], NON_PROJECT_EXPENSE)

    # --- the cap refuses, and says both numbers ------------------------------------------------

    def test_it_REFUSES_over_the_cap_rather_than_truncating_and_names_both_numbers(self):
        """⚠️ THE DIRECTION IS THE POINT, as with `_MAX_CONFIRMABLE`. A silently `LIMIT`ed download
        is a list nobody chose, whose missing rows share no property anything on screen could name
        -- and a file outlives the session that made it. The refusal must name the size and the
        limit, or "too many" is not actionable."""
        from nirmaan_stack.api.outflow_import import approved as A

        original = A._MAX_EXPORT
        A._MAX_EXPORT = 3
        self.addCleanup(setattr, A, "_MAX_EXPORT", original)
        with self.assertRaises(frappe.ValidationError) as caught:
            A.export_approved_records(search=self.TOKEN)
        message = str(caught.exception)
        self.assertIn(f"{self.PLANTED + 1:,}", message)
        self.assertIn("3", message)

        # Under the cap the same call succeeds -- the refusal is the cap, not the query.
        A._MAX_EXPORT = original
        self.assertEqual(
            A.export_approved_records(search=self.TOKEN)["total"], self.PLANTED + 1
        )

    # --- asymmetry 1, straight through the export ----------------------------------------------

    def test_the_export_keeps_the_two_date_keys_apart(self):
        """⚠️ A CSV IS WHERE THIS LIE WOULD BE HARDEST TO CATCH. Only `Project Payments` records an
        approval date; the expense doctypes have no approval date, no approver and no approval step
        at all. A merged column would present a modification as an approval, in a file that outlives
        the screen which could have contradicted it."""
        expense = next(
            r for r in export_approved_records(search=self.TOKEN)["rows"]
            if r["name"] == self.expense
        )
        self.assertIn("approved_on", expense)
        self.assertIn("updated_on", expense)
        self.assertEqual(expense["approved_on"], "", "a Project Expense has no approval date")
        self.assertTrue(expense["updated_on"], "but it does have a modification date")

    def test_no_exported_row_ever_fills_both_date_keys(self):
        for row in export_approved_records(ledger=PAYMENT)["rows"]:
            self.assertFalse(
                bool(row["approved_on"]) and bool(row["updated_on"]),
                f"{row['name']} claims both an approval and a modification date",
            )
