# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Confirm by hand: an unreconciled line stays out of "Confirm all matched" (#1280, parent #1270).

Through the whitelisted endpoints only: `unreconcile_row` sets `Outflow Import Row.confirm_by_hand`,
any successful settle of the line clears it, the match run leaves it alone, `settle_row(bulk=1)`
refuses a marked line, and the two reads behind the bulk confirm (`get_confirmable_rows` and the
summary's `confirmable_rows`) leave it out.

⚠️ RUNS AGAINST THE LIVE SITE DATABASE. Everything a test makes is purged by the fixtures' tearDown.
"""

import json

import frappe

from nirmaan_stack.api.outflow_import.expenses import (
    CONFIRM_BY_HAND_REFUSAL,
    allocate_row,
    settle_row,
)
from nirmaan_stack.api.outflow_import.review import (
    SCOPE_MATCHED_OUTFLOW,
    SCOPE_NOT_MATCHED_OUTFLOW,
    get_confirmable_rows,
    get_outflow_rows,
    get_outflow_summary,
    match_batch,
)
from nirmaan_stack.api.outflow_import.test_unreconcile_payments import PaymentUnreconcileFixture
from nirmaan_stack.api.outflow_import.unreconcile import unreconcile_row
from nirmaan_stack.services.outflow_import.parser import BANK_SUCCESS_STATUS
from nirmaan_stack.services.outflow_import.status import (
    ROW_MATCHED,
    ROW_PARTIALLY_ALLOCATED,
    ROW_SETTLED,
)

ROW_DOCTYPE = "Outflow Import Row"
PAYMENT = "Project Payments"


class ConfirmByHandFixture(PaymentUnreconcileFixture):
    def _marker(self, row) -> int:
        return int(frappe.db.get_value(ROW_DOCTYPE, row, "confirm_by_hand") or 0)

    def _batch(self, row) -> str:
        return frappe.db.get_value(ROW_DOCTYPE, row, "import_batch")

    def _suggested(self, pay, amount="100"):
        row = self._staged_row(amount=amount)
        frappe.db.set_value(
            ROW_DOCTYPE, row, {"suggested_doctype": PAYMENT, "suggested_name": pay},
            update_modified=False,
        )
        frappe.db.commit()
        return row

    def _unreconciled(self):
        """A confirmed suggestion, then unreconciled: open again, same pick, marked."""
        pay = self._approved_payment("100")
        row = self._suggested(pay)
        settle_row(row=row, target_doctype=PAYMENT, target_name=pay)
        unreconcile_row(row=row, legs="all", reason="wrong vendor bill")
        return row, pay


class TestUnreconcileSetsTheMarker(ConfirmByHandFixture):
    def test_a_settled_line_starts_unmarked(self):
        pay = self._approved_payment("100")
        row = self._suggested(pay)
        settle_row(row=row, target_doctype=PAYMENT, target_name=pay)
        self.assertEqual(self._marker(row), 0)

    def test_unreconcile_marks_the_line_and_keeps_its_suggestion(self):
        row, pay = self._unreconciled()
        self.assertEqual(self._marker(row), 1)
        stored = self._line(row)
        self.assertEqual(stored.row_status, ROW_MATCHED)
        self.assertEqual(stored.suggested_name, pay)

    def test_reversing_one_leg_of_a_split_marks_the_line_too(self):
        row, (a, b, c) = self._allocated()
        unreconcile_row(row=row, legs=json.dumps([self._leg(row, b)]), reason="not this")
        self.assertEqual(self._line(row).row_status, ROW_PARTIALLY_ALLOCATED)
        self.assertEqual(self._marker(row), 1)


class TestTheBulkConfirmRefusesAMarkedLine(ConfirmByHandFixture):
    def test_a_bulk_settle_of_a_marked_line_is_refused_and_writes_nothing(self):
        row, pay = self._unreconciled()

        with self.assertRaises(frappe.ValidationError) as caught:
            settle_row(row=row, target_doctype=PAYMENT, target_name=pay, bulk=1)

        self.assertIn(CONFIRM_BY_HAND_REFUSAL, str(caught.exception))
        self.assertEqual(self._line(row).row_status, ROW_MATCHED)
        self.assertEqual(self._marker(row), 1)
        self._assert_free(pay)

    def test_a_form_post_string_flag_is_read_as_bulk(self):
        row, pay = self._unreconciled()
        with self.assertRaises(frappe.ValidationError):
            settle_row(row=row, target_doctype=PAYMENT, target_name=pay, bulk="true")
        self._assert_free(pay)

    def test_a_hand_confirm_succeeds_and_clears_the_marker(self):
        row, pay = self._unreconciled()
        settle_row(row=row, target_doctype=PAYMENT, target_name=pay)
        self.assertEqual(self._line(row).row_status, ROW_SETTLED)
        self.assertEqual(self._marker(row), 0)

    def test_a_bulk_settle_of_an_unmarked_line_is_unchanged(self):
        pay = self._approved_payment("100")
        row = self._suggested(pay)
        settle_row(row=row, target_doctype=PAYMENT, target_name=pay, bulk=1)
        self.assertEqual(self._line(row).row_status, ROW_SETTLED)

    def test_an_allocation_by_hand_clears_the_marker_once_something_lands(self):
        row, (a, b, c) = self._allocated()
        unreconcile_row(row=row, legs=json.dumps([self._leg(row, b)]), reason="not this")
        self.assertEqual(self._marker(row), 1)

        allocate_row(row=row, targets=self._targets([b]))

        self.assertEqual(self._line(row).row_status, ROW_SETTLED)
        self.assertEqual(self._marker(row), 0)


class TestTheMatchRunLeavesTheMarkerAlone(ConfirmByHandFixture):
    def test_a_re_run_does_not_clear_the_marker(self):
        row, _pay = self._unreconciled()
        match_batch(batch=self._batch(row))
        self.assertEqual(self._marker(row), 1)


class TestTheBulkReadsLeaveAMarkedLineOut(ConfirmByHandFixture):
    def _marked_and_unmarked_in_one_batch(self):
        """A marked line and an ordinary suggested one, side by side, both SUCCESS at the bank --
        the summary counts nothing the bank failed, and a fixture row carries no status otherwise."""
        row, _pay = self._unreconciled()
        other = self._suggested(self._approved_payment("100"))
        frappe.db.set_value(
            ROW_DOCTYPE, other, "import_batch", self._batch(row), update_modified=False
        )
        for name in (row, other):
            frappe.db.set_value(
                ROW_DOCTYPE, name, "status_raw", BANK_SUCCESS_STATUS, update_modified=False
            )
        frappe.db.commit()
        return row, other

    def test_the_confirm_list_puts_a_marked_line_in_needs_you_not_ready(self):
        row, other = self._marked_and_unmarked_in_one_batch()

        payload = get_confirmable_rows(batch=self._batch(row))

        ready = {r["name"] for r in payload["ready"]}
        needs_you = {r["name"]: r for r in payload["needs_you"]}
        self.assertIn(other, ready)
        self.assertNotIn(row, ready)
        self.assertIn(row, needs_you)
        self.assertTrue(needs_you[row]["confirm_by_hand"])
        # The funnel still adds up: matched = ready + stale + needs_you.
        self.assertEqual(
            payload["matched_rows"],
            len(payload["ready"]) + len(payload["stale"]) + len(payload["needs_you"]),
        )

    def test_the_summary_button_count_leaves_a_marked_line_out(self):
        row, _other = self._marked_and_unmarked_in_one_batch()
        totals = get_outflow_summary(batch=self._batch(row))["totals"]
        self.assertEqual(totals["matched_rows"], 2)
        self.assertEqual(totals["confirmable_rows"], 1)
        self.assertEqual(float(totals["confirmable_value"]), 100.0)
        # The button's number is the dialog's ready + stale, as `get_confirmable_rows` promises.
        payload = get_confirmable_rows(batch=self._batch(row))
        self.assertEqual(totals["confirmable_rows"], len(payload["ready"]) + len(payload["stale"]))


class TestTheTableRead(ConfirmByHandFixture):
    def test_a_marked_line_carries_the_marker_the_date_and_what_came_off(self):
        row, pay = self._unreconciled()
        payload = get_outflow_rows(scope=SCOPE_MATCHED_OUTFLOW, batch=self._batch(row))
        [shipped] = [r for r in payload["rows"] if r["name"] == row]
        self.assertTrue(shipped["confirm_by_hand"])
        self.assertTrue(shipped["unreconciled_at"])
        self.assertEqual(shipped["unreconciled_targets"], [pay])

    def test_an_unmarked_line_carries_no_unreconcile_facts(self):
        pay = self._approved_payment("100")
        row = self._suggested(pay)
        payload = get_outflow_rows(scope=SCOPE_MATCHED_OUTFLOW, batch=self._batch(row))
        [shipped] = [r for r in payload["rows"] if r["name"] == row]
        self.assertFalse(shipped["confirm_by_hand"])
        self.assertIsNone(shipped["unreconciled_at"])
        self.assertEqual(shipped["unreconciled_targets"], [])

    def test_every_record_of_one_unreconcile_is_named(self):
        """One call reverses three legs; the table read names all three, not just the last stamped."""
        row, pays = self._allocated()
        unreconcile_row(row=row, legs="all", reason="three wrong bills")
        payload = get_outflow_rows(scope=SCOPE_NOT_MATCHED_OUTFLOW, batch=self._batch(row))
        [shipped] = [r for r in payload["rows"] if r["name"] == row]
        self.assertTrue(shipped["confirm_by_hand"])
        self.assertEqual(sorted(shipped["unreconciled_targets"]), sorted(pays))
