"""**Partially Reconciled** -- the Outflow Reports' figure for money their Paid filter cannot see.

    bench --site localhost run-tests --app nirmaan_stack \
        --module nirmaan_stack.api.reports.test_partially_reconciled

⚠️ RUNS AGAINST THE LIVE SITE DATABASE, which already holds real expenses and real bank lines. Every
assertion is therefore a DELTA against a reading taken first, and every fixture is planted raw and
purged in `tearDown`. The expense ledgers are written with SQL on purpose: their `validate` is the
bank-links controller, which would re-derive the very status these tests need to hold still.

⚠️ THE DATE TESTED IS THE RECORD'S NEWEST BANK LINE, ALL OR NOTHING (owner, 2026-09-24), and that is
the whole point of the range tests below. These records carry no `payment_date` at all, so the newest
line stands in for it -- see `partially_reconciled.py`. The two tests marked INVERTS pin the change
from the 2026-09-23 line-by-line rule.
"""

import unittest

import frappe
from frappe.utils import add_days, today

from nirmaan_stack.api.reports.partially_reconciled import get_partially_reconciled
from nirmaan_stack.services.outflow_import.parser import BANK_SUCCESS_STATUS, DIRECTION_DEBIT
from nirmaan_stack.services.outflow_import.status import ROW_SETTLED

MATCH_DOCTYPE = "Outflow Row Match"
ROW_DOCTYPE = "Outflow Import Row"
BATCH_DOCTYPE = "Outflow Import Batch"
PROJECT_EXPENSE = "Project Expenses"
NON_PROJECT_EXPENSE = "Non Project Expenses"


class TestPartiallyReconciled(unittest.TestCase):
    PREFIX = "TEST-PARTREC-RPT"

    def setUp(self):
        self.batches, self.rows, self.matches, self.planted = [], [], [], []
        self.non_project_type = frappe.db.get_value(
            "Expense Type", {"non_project": 1, "project": 0}, "name"
        )
        self.project_type = frappe.db.get_value("Expense Type", {"project": 1}, "name")

    def tearDown(self):
        for name in self.matches:
            frappe.db.delete(MATCH_DOCTYPE, {"name": name})
        for name in self.rows:
            frappe.db.delete(ROW_DOCTYPE, {"name": name})
        for name in self.batches:
            frappe.db.delete(BATCH_DOCTYPE, {"name": name})
        for doctype, name in self.planted:
            frappe.db.delete("Version", {"ref_doctype": doctype, "docname": name})
            frappe.db.delete(doctype, {"name": name})
        frappe.db.commit()

    # --- arrange --------------------------------------------------------------------------

    def _line(self, amount, added_on):
        batch = frappe.get_doc({
            "doctype": BATCH_DOCTYPE,
            "source": "Cashfree",
            "original_filename": f"{self.PREFIX}-{frappe.generate_hash(length=8)}.csv",
        })
        batch.insert(ignore_permissions=True)
        self.batches.append(batch.name)
        row = frappe.get_doc({
            "doctype": ROW_DOCTYPE,
            "import_batch": batch.name,
            "transfer_id": f"{self.PREFIX}-{frappe.generate_hash(length=10)}",
            "amount": amount,
            "row_status": ROW_SETTLED,
            "direction": DIRECTION_DEBIT,
            "status_raw": BANK_SUCCESS_STATUS,
            "added_on": added_on,
        })
        row.insert(ignore_permissions=True)
        self.rows.append(row.name)
        frappe.db.commit()
        return row.name

    def _expense(self, doctype, amount, status="Reconciliation Pending"):
        name = f"{self.PREFIX}-{frappe.generate_hash(length=12)}"
        expense_type = (
            self.non_project_type if doctype == NON_PROJECT_EXPENSE else self.project_type
        )
        frappe.db.sql(
            f'''INSERT INTO "tab{doctype}" (name, creation, modified, modified_by, owner,
                docstatus, idx, amount, status, description, type)
                VALUES (%s, NOW(), NOW(), %s, %s, 0, 0, %s, %s, %s, %s)''',
            (name, "Administrator", "Administrator", float(amount), status,
             "Partially Reconciled report test", expense_type),
        )
        self.planted.append((doctype, name))
        frappe.db.commit()
        return name

    def _slip(self, row, doctype, name, amount):
        staged = frappe.db.get_value(
            ROW_DOCTYPE, row, ["import_batch", "transfer_id"], as_dict=True
        )
        match = frappe.get_doc({
            "doctype": MATCH_DOCTYPE,
            "import_row": row,
            "import_batch": staged.import_batch,
            "transfer_id": staged.transfer_id,
            "target_doctype": doctype,
            "target_name": name,
            "target_amount": float(amount),
            "match_kind": "Settled",
            "match_basis": "Manual",
        })
        match.insert(ignore_permissions=True)
        self.matches.append(match.name)
        frappe.db.commit()
        return match.name

    @staticmethod
    def _delta(before, after, report, key):
        return after[report][key] - before[report][key]

    # --- assert ----------------------------------------------------------------------------

    def test_a_non_project_expense_lands_in_the_non_project_report(self):
        before = get_partially_reconciled()
        expense = self._expense(NON_PROJECT_EXPENSE, 60000)
        self._slip(self._line(25000, today()), NON_PROJECT_EXPENSE, expense, 25000)
        after = get_partially_reconciled()

        self.assertAlmostEqual(self._delta(before, after, "non_project", "amount"), 25000)
        self.assertEqual(self._delta(before, after, "non_project", "count"), 1)
        # And nowhere near the project figure.
        self.assertAlmostEqual(self._delta(before, after, "project", "amount"), 0)

    def test_a_project_expense_lands_in_the_project_report(self):
        before = get_partially_reconciled()
        expense = self._expense(PROJECT_EXPENSE, 40000)
        self._slip(self._line(15000, today()), PROJECT_EXPENSE, expense, 15000)
        after = get_partially_reconciled()

        self.assertAlmostEqual(self._delta(before, after, "project", "amount"), 15000)
        self.assertEqual(self._delta(before, after, "project", "count"), 1)
        self.assertAlmostEqual(self._delta(before, after, "non_project", "amount"), 0)

    def test_only_the_confirmed_part_counts_not_the_record(self):
        """A ₹60,000 expense with ₹25,000 confirmed contributes ₹25,000, never ₹60,000."""
        before = get_partially_reconciled()
        expense = self._expense(NON_PROJECT_EXPENSE, 60000)
        self._slip(self._line(25000, today()), NON_PROJECT_EXPENSE, expense, 25000)
        after = get_partially_reconciled()
        self.assertAlmostEqual(self._delta(before, after, "non_project", "amount"), 25000)

    def test_a_date_range_counts_a_line_inside_it(self):
        start, end = add_days(today(), -10), today()
        expense = self._expense(NON_PROJECT_EXPENSE, 60000)
        before = get_partially_reconciled(start, end)
        self._slip(self._line(9000, add_days(today(), -3)), NON_PROJECT_EXPENSE, expense, 9000)
        after = get_partially_reconciled(start, end)
        self.assertAlmostEqual(self._delta(before, after, "non_project", "amount"), 9000)

    def test_a_date_range_excludes_a_line_outside_it(self):
        """The same fixture, the same record -- only the line's date differs."""
        start, end = add_days(today(), -10), today()
        expense = self._expense(NON_PROJECT_EXPENSE, 60000)
        before_ranged = get_partially_reconciled(start, end)
        before_all = get_partially_reconciled()
        self._slip(self._line(9000, add_days(today(), -45)), NON_PROJECT_EXPENSE, expense, 9000)

        self.assertAlmostEqual(
            self._delta(before_ranged, get_partially_reconciled(start, end), "non_project", "amount"), 0
        )
        # ...and all time still sees it, so the range is what excluded it, not the fixture.
        self.assertAlmostEqual(
            self._delta(before_all, get_partially_reconciled(), "non_project", "amount"), 9000
        )

    def test_the_range_edges_are_inclusive(self):
        start, end = add_days(today(), -10), add_days(today(), -2)
        expense = self._expense(NON_PROJECT_EXPENSE, 60000)
        before = get_partially_reconciled(start, end)
        self._slip(self._line(1000, start), NON_PROJECT_EXPENSE, expense, 1000)
        second = self._expense(NON_PROJECT_EXPENSE, 60000)
        self._slip(self._line(2000, end), NON_PROJECT_EXPENSE, second, 2000)
        after = get_partially_reconciled(start, end)
        self.assertAlmostEqual(self._delta(before, after, "non_project", "amount"), 3000)

    def test_the_count_is_records_not_bank_lines(self):
        """Two lines part-covering ONE record is one row's worth of money, not two."""
        before = get_partially_reconciled()
        expense = self._expense(NON_PROJECT_EXPENSE, 60000)
        self._slip(self._line(10000, today()), NON_PROJECT_EXPENSE, expense, 10000)
        self._slip(self._line(12000, today()), NON_PROJECT_EXPENSE, expense, 12000)
        after = get_partially_reconciled()

        self.assertEqual(self._delta(before, after, "non_project", "count"), 1)
        self.assertAlmostEqual(self._delta(before, after, "non_project", "amount"), 22000)

    def test_items_carry_no_order_for_an_expense(self):
        """`items` feeds the Excl. GST figure: an expense has no order, so it has no rate."""
        expense = self._expense(PROJECT_EXPENSE, 40000)
        self._slip(self._line(15000, today()), PROJECT_EXPENSE, expense, 15000)
        mine = [i for i in get_partially_reconciled()["project"]["items"] if i["name"] == expense]

        self.assertEqual(len(mine), 1)
        self.assertEqual(mine[0]["doctype"], PROJECT_EXPENSE)
        self.assertAlmostEqual(mine[0]["amount"], 15000)
        self.assertIsNone(mine[0]["document_type"])
        self.assertIsNone(mine[0]["document_name"])

    def test_items_add_up_to_the_amount(self):
        """The two are one reading, so a caller splitting `items` can never miss money."""
        self._slip(
            self._line(7000, today()),
            NON_PROJECT_EXPENSE,
            self._expense(NON_PROJECT_EXPENSE, 60000),
            7000,
        )
        result = get_partially_reconciled()
        for report in ("project", "non_project"):
            self.assertAlmostEqual(
                sum(i["amount"] for i in result[report]["items"]), result[report]["amount"]
            )
            self.assertEqual(len(result[report]["items"]), result[report]["count"])

    def test_a_paid_record_is_not_counted(self):
        """Paid money is already in the report's own total -- counting it here doubles it."""
        before = get_partially_reconciled()
        expense = self._expense(NON_PROJECT_EXPENSE, 20000, status="Paid")
        self._slip(self._line(20000, today()), NON_PROJECT_EXPENSE, expense, 20000)
        after = get_partially_reconciled()
        self.assertAlmostEqual(self._delta(before, after, "non_project", "amount"), 0)
        self.assertEqual(self._delta(before, after, "non_project", "count"), 0)

    def test_one_line_in_range_brings_the_whole_record_in(self):
        """ALL OR NOTHING: the newest line is in range, so the old line's money counts with it.

        ⚠️ INVERTS the 2026-09-23 line-by-line rule, under which only the 2,000 would count.
        """
        start, end = add_days(today(), -10), today()
        expense = self._expense(NON_PROJECT_EXPENSE, 60000)
        before = get_partially_reconciled(start, end)
        self._slip(self._line(4000, add_days(today(), -45)), NON_PROJECT_EXPENSE, expense, 4000)
        self._slip(self._line(2000, add_days(today(), -3)), NON_PROJECT_EXPENSE, expense, 2000)
        after = get_partially_reconciled(start, end)
        self.assertAlmostEqual(self._delta(before, after, "non_project", "amount"), 6000)
        self.assertEqual(self._delta(before, after, "non_project", "count"), 1)

    def test_a_newest_line_after_the_range_takes_the_record_out(self):
        """⚠️ INVERTS the line-by-line rule too: a line inside the range no longer counts on its own
        when the record's newest line falls after it -- the record belongs to the later period."""
        start, end = add_days(today(), -10), add_days(today(), -2)
        expense = self._expense(NON_PROJECT_EXPENSE, 60000)
        before = get_partially_reconciled(start, end)
        self._slip(self._line(3000, add_days(today(), -5)), NON_PROJECT_EXPENSE, expense, 3000)
        self._slip(self._line(1000, today()), NON_PROJECT_EXPENSE, expense, 1000)
        after = get_partially_reconciled(start, end)
        self.assertAlmostEqual(self._delta(before, after, "non_project", "amount"), 0)

    def test_a_record_whose_lines_carry_no_date_is_out_of_a_range_but_in_all_time(self):
        expense = self._expense(NON_PROJECT_EXPENSE, 60000)
        start, end = add_days(today(), -10), today()
        before_ranged = get_partially_reconciled(start, end)
        before_all = get_partially_reconciled()
        row = self._line(5000, today())
        self._slip(row, NON_PROJECT_EXPENSE, expense, 5000)
        frappe.db.delete(ROW_DOCTYPE, {"name": row})
        self.rows.remove(row)
        frappe.db.commit()

        self.assertAlmostEqual(
            self._delta(before_ranged, get_partially_reconciled(start, end), "non_project", "amount"), 0
        )
        self.assertAlmostEqual(
            self._delta(before_all, get_partially_reconciled(), "non_project", "amount"), 5000
        )

    def test_items_carry_what_the_dialog_shows(self):
        """The "Partially Reconciled" dialog's row: bill, confirmed, pending, newest line, lines."""
        expense = self._expense(NON_PROJECT_EXPENSE, 60000)
        self._slip(self._line(10000, add_days(today(), -4)), NON_PROJECT_EXPENSE, expense, 10000)
        self._slip(self._line(12000, add_days(today(), -1)), NON_PROJECT_EXPENSE, expense, 12000)
        mine = [i for i in get_partially_reconciled()["non_project"]["items"] if i["name"] == expense]

        self.assertEqual(len(mine), 1)
        item = mine[0]
        self.assertAlmostEqual(item["amount"], 22000)
        self.assertAlmostEqual(item["bill_amount"], 60000)
        self.assertAlmostEqual(item["pending_amount"], 38000)
        self.assertEqual(str(item["latest_line_date"]), str(add_days(today(), -1)))
        self.assertEqual(item["line_count"], 2)
        self.assertEqual(item["type"], self.non_project_type)
        self.assertEqual(item["description"], "Partially Reconciled report test")
        self.assertIsNone(item["project_name"])
