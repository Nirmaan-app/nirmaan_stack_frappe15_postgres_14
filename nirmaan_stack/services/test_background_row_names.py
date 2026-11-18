"""Rows that background operations write never clash on their names (ADR 0048, spec #1654).

The fast two-connection clash test. Two background operations overlap when two `long` workers run them at once.
Every connection runs at REPEATABLE READ, and a counted name (`BRCT-.YY.-.#####`) is taken from one `tabSeries`
row under `SELECT ... FOR UPDATE`: the transaction that takes a number after the other committed fails with a
serialization error, however late it asks. Two connections prove that clash for any number of workers, so this
test overlaps exactly two transactions:

1. the second connection reads first, so its snapshot is taken (without this read the test passes even on counted
   names, because the second transaction would only start after the first committed);
2. the first connection inserts a row and commits;
3. the second connection inserts a row of the same doctype and commits.

Both inserts must commit. One case per doctype; a later ticket adds its doctype with one more `test_` method
that calls `assert_overlapping_inserts_both_commit`.
"""

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.boq.wizard.test_review_screen import _cleanup_project, _make_project
from nirmaan_stack.services.boq_fixture_teardown import fixture_boq_name

SHEET = "__row_names_clash__"


class TestBackgroundRowNamesDoNotClash(FrappeTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.project = _make_project()
        boq = frappe.new_doc("BOQs")
        boq.project = cls.project.name
        boq.boq_name = "Row names clash fixture"
        boq.insert(set_name=fixture_boq_name("ROW-NAMES"), ignore_permissions=True)
        frappe.db.commit()
        cls.boq = boq.name

    @classmethod
    def tearDownClass(cls):
        frappe.db.rollback()
        _cleanup_project(cls.project.name)
        super().tearDownClass()

    def assert_overlapping_inserts_both_commit(self, doctype, fields):
        """Insert one `doctype` row on each of two overlapping transactions; assert both commit.

        `fields(n)` gives the n-th row's own fields (beside `boq` and `sheet_name`)."""
        made = []

        def insert(n):
            doc = frappe.get_doc({"doctype": doctype, "boq": self.boq, "sheet_name": SHEET, **fields(n)})
            doc.insert(ignore_permissions=True)
            frappe.db.commit()
            made.append(doc.name)

        try:
            with self.secondary_connection():
                frappe.db.sql("select count(*) from `tabBOQs`")  # takes this transaction's snapshot
            with self.primary_connection():
                insert(1)
            with self.secondary_connection():
                try:
                    insert(2)
                except Exception as e:
                    self.fail(f"the second, overlapping {doctype} insert did not commit: {type(e).__name__}: {e}")
        finally:
            with self.secondary_connection():
                frappe.db.rollback()
            with self.primary_connection():
                frappe.db.rollback()
                for name in made:
                    frappe.db.delete(doctype, {"name": name})
                frappe.db.commit()
        self.assertEqual(len(made), 2)

    def test_two_overlapping_row_category_inserts_both_commit(self):
        self.assert_overlapping_inserts_both_commit(
            "BoQ Row Category",
            lambda n: {"excel_row": n, "committed_version": 0, "discipline": "Electrical", "category_version": 1},
        )

    def test_two_overlapping_review_row_inserts_both_commit(self):
        self.assert_overlapping_inserts_both_commit("BoQ Review Row", lambda n: {})

    def test_two_overlapping_rate_suggestion_run_inserts_both_commit(self):
        self.assert_overlapping_inserts_both_commit(
            "BoQ Rate Suggestion Run",
            lambda n: {"committed_version": 0, "run_id": f"row-names-clash-{n}", "status": "running", "active": 0},
        )

    def test_two_overlapping_rate_match_run_inserts_both_commit(self):
        self.assert_overlapping_inserts_both_commit(
            "BoQ Rate Match Run", lambda n: {"commit_version": 0, "status": "queued", "active": 0}
        )
