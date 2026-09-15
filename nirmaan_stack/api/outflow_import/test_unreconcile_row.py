# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""The all-or-nothing reversal write path (#1271).

`reverse_allocation`'s own behaviour is pinned by `test_reverse_allocation.py`, which this slice
leaves untouched. What is new is several legs in one call, and the promise that one refused leg
means NOTHING is written.
"""

import json
from unittest.mock import patch

import frappe
import psycopg2.errors as pg_errors

from nirmaan_stack.api.outflow_import import unreconcile as unreconcile_api
from nirmaan_stack.api.outflow_import.expenses import (
    CONCURRENT_ALLOCATION_MESSAGE,
    ConcurrentAllocationError,
    reverse_allocation,
)
from nirmaan_stack.api.outflow_import.test_allocate_row import AllocationFixture
from nirmaan_stack.api.outflow_import.unreconcile import unreconcile_row
from nirmaan_stack.services.outflow_import.status import (
    ROW_MATCHED,
    ROW_MISMATCHED,
    ROW_PARTIALLY_ALLOCATED,
    ROW_SETTLED,
)

MATCH_DOCTYPE = "Outflow Row Match"
ROW_DOCTYPE = "Outflow Import Row"


class UnreconcileFixture(AllocationFixture):
    def _leg(self, row, payment):
        return frappe.db.get_value(
            MATCH_DOCTYPE, {"import_row": row, "target_name": payment}, "name"
        )

    def _assert_untouched(self, row, legs, payments):
        for leg in legs:
            self.assertEqual(frappe.db.get_value(MATCH_DOCTYPE, leg, "match_kind"), "Settled")
        for payment in payments:
            self.assertEqual(frappe.db.get_value("Project Payments", payment, "status"), "Paid")
        self.assertEqual(frappe.db.get_value(ROW_DOCTYPE, row, "row_status"), ROW_SETTLED)


class TestAllOrNothing(UnreconcileFixture):
    def test_two_legs_one_refused_writes_nothing(self):
        """The acceptance case. The GOOD leg is listed first, so a loop that wrote as it went would
        already have reverted it by the time the refused one is reached."""
        row, (a, b, _) = self._allocated()
        good, bad = self._leg(row, a), self._leg(row, b)
        frappe.db.set_value("Project Payments", b, "tds", 1.5, update_modified=False)
        frappe.db.commit()

        with self.assertRaises(frappe.ValidationError) as caught:
            unreconcile_row(row=row, legs=json.dumps([good, bad]), reason="wrong PO")

        self.assertIn(b, str(caught.exception))
        self.assertIn("TDS", str(caught.exception))
        self._assert_untouched(row, [good, bad], [a, b])

    def test_all_with_one_refused_leg_writes_nothing(self):
        row, pays = self._allocated()
        frappe.db.set_value("Project Payments", pays[2], "amount", 11.0, update_modified=False)
        frappe.db.commit()

        with self.assertRaises(frappe.ValidationError):
            unreconcile_row(row=row, legs="all", reason="wrong PO")

        self._assert_untouched(row, [self._leg(row, p) for p in pays], pays)

    def test_two_reversible_legs_are_both_reversed_in_one_call(self):
        row, (a, b, c) = self._allocated()
        result = unreconcile_row(
            row=row, legs=[self._leg(row, a), self._leg(row, b)], reason="wrong PO"
        )
        self.assertEqual(result["row_status"], ROW_PARTIALLY_ALLOCATED)
        self.assertEqual(float(result["remaining"]), 90.0)
        self.assertEqual(
            sorted(r["target_name"] for r in result["reversed"]), sorted([a, b])
        )
        for payment in (a, b):
            self.assertEqual(frappe.db.get_value("Project Payments", payment, "status"), "Approved")
        self.assertEqual(frappe.db.get_value("Project Payments", c, "status"), "Paid")

    def test_all_reverses_every_settled_leg_and_reopens_the_line(self):
        row, pays = self._allocated()
        result = unreconcile_row(row=row, legs="all", reason="all wrong")
        self.assertIn(result["row_status"], (ROW_MATCHED, ROW_MISMATCHED))
        self.assertEqual(float(result["allocated"]), 0.0)
        self.assertEqual(
            frappe.db.count(MATCH_DOCTYPE, {"import_row": row, "match_kind": "Reversed"}), 3
        )
        for payment in pays:
            self.assertEqual(frappe.db.get_value("Project Payments", payment, "status"), "Approved")
        reversed_leg = frappe.db.get_value(
            MATCH_DOCTYPE, self._leg(row, pays[0]), ["reversal_reason", "reversed_by"], as_dict=True
        )
        self.assertEqual(reversed_leg.reversal_reason, "all wrong")
        self.assertTrue(reversed_leg.reversed_by)


class TestWhatItRefusesBeforeLooking(UnreconcileFixture):
    def test_a_reason_is_required(self):
        row, _ = self._allocated()
        with self.assertRaises(frappe.ValidationError):
            unreconcile_row(row=row, legs="all", reason="  ")

    def test_nothing_selected_is_refused(self):
        row, _ = self._allocated()
        with self.assertRaises(frappe.ValidationError):
            unreconcile_row(row=row, legs=[], reason="wrong PO")

    def test_a_leg_from_another_line_is_refused_and_nothing_is_written(self):
        row, (a, _, _) = self._allocated()
        other_row, (other, _, _) = self._allocated()
        foreign = self._leg(other_row, other)
        with self.assertRaises(frappe.ValidationError):
            unreconcile_row(row=row, legs=[self._leg(row, a), foreign], reason="wrong PO")
        self._assert_untouched(row, [self._leg(row, a)], [a])
        self._assert_untouched(other_row, [foreign], [other])

    def test_one_bare_match_name_is_accepted(self):
        row, (a, _, _) = self._allocated()
        unreconcile_row(row=row, legs=self._leg(row, a), reason="wrong PO")
        self.assertEqual(frappe.db.get_value("Project Payments", a, "status"), "Approved")

    def test_a_verdict_with_no_write_rolls_everything_back(self):
        """A verdict the decision module learns before the write path does must not stamp a leg
        Reversed while its target stays settled."""
        from nirmaan_stack.services.outflow_import.unreconcile import LegVerdict

        row, pays = self._allocated()
        frappe.db.commit()
        with patch.object(
            unreconcile_api,
            "leg_verdict",
            # A verdict no write knows. It was `revert_expense` until #1277 wired that one,
            # `delete_created` until #1278 and `unsplit_payment` until #1279. Since #1278 the leg is
            # stamped BEFORE the write, so this also proves the stamp rolls back with it.
            side_effect=lambda facts: LegVerdict(leg=facts.leg, verdict="not_a_verdict"),
        ):
            with self.assertRaises(NotImplementedError):
                unreconcile_row(row=row, legs="all", reason="wrong PO")
        self._assert_untouched(row, [self._leg(row, p) for p in pays], pays)

    def test_all_on_a_line_with_nothing_settled_is_refused(self):
        row = self._staged_row(amount="100")
        with self.assertRaises(frappe.ValidationError):
            unreconcile_row(row=row, legs="all", reason="wrong PO")


class TestAConcurrentWriter(UnreconcileFixture):
    """The refusal is SIMULATED at the row-lock read, exactly as `test_allocate_row`'s
    `TestAConcurrentLoser` does it -- see that class for why a real 40001 is not reproduced here."""

    def _refusal(self):
        return pg_errors.SerializationFailure("could not serialize access due to concurrent update")

    def test_the_write_path_answers_in_a_sentence(self):
        row, pays = self._allocated()
        frappe.db.commit()
        with patch.object(unreconcile_api, "_lock_row", side_effect=self._refusal()):
            with self.assertRaises(ConcurrentAllocationError) as caught:
                unreconcile_row(row=row, legs="all", reason="wrong PO")
        self.assertEqual(str(caught.exception), CONCURRENT_ALLOCATION_MESSAGE)
        self._assert_untouched(row, [self._leg(row, p) for p in pays], pays)

    def test_the_single_leg_endpoint_answers_in_the_same_sentence(self):
        """Before #1271 `reverse_allocation` let the raw database error through."""
        row, (a, _, _) = self._allocated()
        leg = self._leg(row, a)
        frappe.db.commit()
        with patch.object(unreconcile_api, "_lock_row", side_effect=self._refusal()):
            with self.assertRaises(ConcurrentAllocationError) as caught:
                reverse_allocation(match=leg, reason="wrong PO")
        self.assertNotIn("serialize", str(caught.exception).lower())
        self._assert_untouched(row, [leg], [a])

    def test_a_refusal_mid_write_rolls_back_the_legs_already_written(self):
        """The late shape: the first payment really reverts, the second write is refused."""
        row, pays = self._allocated()
        frappe.db.commit()
        real = unreconcile_api._revert_payment
        calls = []

        def second_refused(*args, **kwargs):
            calls.append(1)
            if len(calls) == 2:
                raise self._refusal()
            return real(*args, **kwargs)

        with patch.object(unreconcile_api, "_revert_payment", side_effect=second_refused):
            with self.assertRaises(ConcurrentAllocationError):
                unreconcile_row(row=row, legs="all", reason="wrong PO")
        self.assertEqual(len(calls), 2)
        self._assert_untouched(row, [self._leg(row, p) for p in pays], pays)

    def test_any_other_database_error_stays_itself(self):
        row, _ = self._allocated()
        frappe.db.commit()
        other = pg_errors.DeadlockDetected("deadlock detected")
        with patch.object(unreconcile_api, "_lock_row", side_effect=other):
            with self.assertRaises(pg_errors.DeadlockDetected):
                unreconcile_row(row=row, legs="all", reason="wrong PO")
