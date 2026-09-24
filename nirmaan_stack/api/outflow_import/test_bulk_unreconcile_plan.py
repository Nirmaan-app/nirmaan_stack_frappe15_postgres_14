# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""The bulk Unreconcile check step's one read (#1319, parent #1317).

`get_bulk_unreconcile_plan(rows)` returns, per line, exactly what `get_unreconcile_plan` returns for
that line. The pin is a COMPARISON, not a list of expected fields, so the two can never drift.

⚠️ RUNS AGAINST THE LIVE SITE DATABASE. Everything a test makes is purged by the fixtures' tearDown.
"""

import json

import frappe

from nirmaan_stack.api.outflow_import.bulk_unreconcile import (
    BULK_UNRECONCILE_LIMIT,
    get_bulk_unreconcile_plan,
)
from nirmaan_stack.api.outflow_import.test_skip_row import ACCOUNTANT, ACCOUNTANT_LEAD
from nirmaan_stack.api.outflow_import.test_unreconcile_payments import PaymentUnreconcileFixture
from nirmaan_stack.api.outflow_import.unreconcile import get_unreconcile_plan
from nirmaan_stack.services.outflow_import.status import ROW_SETTLED

ROW_DOCTYPE = "Outflow Import Row"
BATCH_DOCTYPE = "Outflow Import Batch"
MATCH_DOCTYPE = "Outflow Row Match"
PAYMENT = "Project Payments"


class BulkPlanFixture(PaymentUnreconcileFixture):
    def _three_lines(self):
        """A plain split, a split with one refused leg, and a Cashbook line."""
        split, _ = self._allocated()
        refused, pays = self._allocated()
        frappe.db.set_value(PAYMENT, pays[2], "amount", 11.0, update_modified=False)
        cashbook, _ = self._allocated()
        batch = frappe.db.get_value(ROW_DOCTYPE, cashbook, "import_batch")
        frappe.db.set_value(BATCH_DOCTYPE, batch, "source", "Cashbook", update_modified=False)
        frappe.db.commit()
        return [split, refused, cashbook]

    def _snapshot(self, rows):
        return {
            "rows": frappe.db.get_all(
                ROW_DOCTYPE, filters={"name": ["in", rows]}, fields=["name", "row_status", "modified"]
            ),
            "legs": frappe.db.get_all(
                MATCH_DOCTYPE,
                filters={"import_row": ["in", rows]},
                fields=["name", "match_kind", "modified"],
            ),
        }


class TestEachLineEqualsTheOneLinePlan(BulkPlanFixture):
    def test_every_entry_is_the_one_line_plan_for_that_line(self):
        rows = self._three_lines()
        bulk = get_bulk_unreconcile_plan(rows=json.dumps(rows))
        self.assertEqual([entry["row"] for entry in bulk["lines"]], rows)
        for row, entry in zip(rows, bulk["lines"]):
            self.assertEqual(entry, get_unreconcile_plan(row=row))
        # The fixture really covers what the ticket names: a split, a refused leg.
        self.assertEqual(len(bulk["lines"][0]["legs"]), 3)
        self.assertEqual(bulk["lines"][1]["refused_count"], 1)
        self.assertEqual(bulk["lines"][2]["refused_count"], 0)

    def test_a_list_is_accepted_as_well_as_json(self):
        rows = self._three_lines()
        self.assertEqual(
            get_bulk_unreconcile_plan(rows=rows), get_bulk_unreconcile_plan(rows=json.dumps(rows))
        )

    def test_a_name_sent_twice_is_planned_once(self):
        row, _ = self._allocated()
        bulk = get_bulk_unreconcile_plan(rows=[row, row])
        self.assertEqual([entry["row"] for entry in bulk["lines"]], [row])

    def test_it_writes_nothing(self):
        rows = self._three_lines()
        before = self._snapshot(rows)
        get_bulk_unreconcile_plan(rows=rows)
        self.assertEqual(self._snapshot(rows), before)
        for row in rows:
            self.assertEqual(frappe.db.get_value(ROW_DOCTYPE, row, "row_status"), ROW_SETTLED)


class TestWhatItRefuses(BulkPlanFixture):
    def test_more_than_the_limit_is_refused(self):
        row, _ = self._allocated()
        too_many = [row] + [f"NOT-A-ROW-{i}" for i in range(BULK_UNRECONCILE_LIMIT)]
        with self.assertRaises(frappe.ValidationError) as caught:
            get_bulk_unreconcile_plan(rows=too_many)
        self.assertIn(str(BULK_UNRECONCILE_LIMIT), str(caught.exception))

    def test_exactly_the_limit_is_not_refused_for_its_size(self):
        self.assertEqual(BULK_UNRECONCILE_LIMIT, 50)
        row, _ = self._allocated()
        names = [row] + [f"NOT-A-ROW-{i}" for i in range(BULK_UNRECONCILE_LIMIT - 1)]
        bulk = get_bulk_unreconcile_plan(rows=names)
        self.assertEqual(len(bulk["lines"]), BULK_UNRECONCILE_LIMIT)

    def test_a_line_that_no_longer_exists_is_reported_on_its_own(self):
        row, _ = self._allocated()
        bulk = get_bulk_unreconcile_plan(rows=["NOT-A-ROW", row])
        gone, real = bulk["lines"]
        self.assertEqual(gone["row"], "NOT-A-ROW")
        self.assertTrue(gone["not_found"])
        self.assertEqual(gone["legs"], [])
        self.assertEqual(real, get_unreconcile_plan(row=row))

    def test_nothing_sent_is_refused(self):
        with self.assertRaises(frappe.ValidationError):
            get_bulk_unreconcile_plan(rows=[])
        with self.assertRaises(frappe.ValidationError):
            get_bulk_unreconcile_plan(rows="not json")

    def test_a_plain_accountant_is_refused(self):
        row, _ = self._allocated()
        frappe.set_user(self.users.make(ACCOUNTANT))
        try:
            with self.assertRaises(frappe.PermissionError):
                get_bulk_unreconcile_plan(rows=[row])
        finally:
            frappe.set_user("Administrator")

    def test_an_accountant_lead_may_read_it(self):
        row, _ = self._allocated()
        frappe.set_user(self.users.make(ACCOUNTANT_LEAD))
        try:
            bulk = get_bulk_unreconcile_plan(rows=[row])
        finally:
            frappe.set_user("Administrator")
        self.assertEqual(bulk["lines"][0]["row"], row)

    def test_it_is_whitelisted(self):
        from frappe import whitelisted

        self.assertIn(get_bulk_unreconcile_plan, whitelisted)
