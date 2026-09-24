# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Unreconcile, Skip and Unskip on Cashbook lines (#1314, ADR-0022 Amendment D, ADR-0015 Amendment).

    bench --site localhost run-tests --app nirmaan_stack \
        --module nirmaan_stack.api.outflow_import.test_cashbook_undo

What is pinned, on a real Cashbook import (the committed `cashbook_sample.csv`, run through the job):

  * Unreconcile deletes the expense the import created and lands the line NOT MATCHED with no pick --
    never Matched to the deleted record (trap 1), never `Pending match run` (trap 2) -- keeping the plan
    fields the Create form pre-fills from. The Cashbook job then leaves it alone.
  * an expense edited since the import is refused with the #1278 sentence, and nothing is written;
  * a reopened line can Create, and the expense's Paid by is the statement's `From` (trap 4);
  * the matcher never writes to a reopened line;
  * an open Cashbook line can be skipped by hand; one the job has not reached yet cannot;
  * a hand skip comes back NOT MATCHED, or SKIPPED again as System / Outflow Already Recorded when the
    wallet transaction is already booked (trap 3); a System Cashbook skip stays locked;
  * a plain Accountant is refused all three.

⚠️ THIS SUITE CREATES REAL EXPENSES on the live site, like `test_cashbook_import`, and tears down every
one of them.
"""

import frappe

from nirmaan_stack.api.outflow_import import cashbook as cb
from nirmaan_stack.api.outflow_import.expenses import MATCH_DOCTYPE, create_expense, settle_expense
from nirmaan_stack.api.outflow_import.review import match_batch, skip_row, unskip_row
from nirmaan_stack.api.outflow_import.test_cashbook_import import CashbookImportCase
from nirmaan_stack.api.outflow_import.test_skip_row import ACCOUNTANT, _Users
from nirmaan_stack.api.outflow_import.unreconcile import get_unreconcile_plan, unreconcile_row
from nirmaan_stack.services.outflow_import.skip_origin import (
    SKIP_REFUSED_CASHBOOK_PENDING,
    UNSKIP_REFUSED_CASHBOOK,
)
from nirmaan_stack.services.outflow_import.status import (
    ROW_MISMATCHED,
    ROW_PENDING_MATCH,
    ROW_SETTLED,
    ROW_SKIPPED,
    SKIP_ORIGIN_MANUAL,
    SKIP_ORIGIN_SYSTEM,
)
from nirmaan_stack.services.outflow_import.ledgers import settleable_statuses
from nirmaan_stack.services.outflow_import.unreconcile import VERDICT_DELETE_CREATED

ROW_DOCTYPE = "Outflow Import Row"
REASON = "Booked against the wrong project"

_STORED = (
    "row_status", "suggested_name", "suggested_doctype", "suggested_expense_type",
    "resolved_project", "confirm_by_hand", "skip_origin", "skip_kind", "skip_reason",
    "outcome_note", "settlement_origin",
)


class CashbookUndoCase(CashbookImportCase):
    """The fixture staged AND created: every planned line is Settled on an expense it created."""

    def setUp(self):
        super().setUp()
        frappe.set_user("Administrator")
        cb._cashbook_worker(self.batch, "Administrator")
        self.users = _Users()
        self.extra = []  # (doctype, name) planted by a test, purged after it
        self.addCleanup(self._purge_extra)

    def _purge_extra(self):
        frappe.set_user("Administrator")
        self.users.purge()
        for doctype, name in self.extra:
            frappe.db.delete(doctype, {"name": name})
        rows = [r.name for r in self._rows()]
        if rows:
            frappe.db.delete("Version", {"ref_doctype": ROW_DOCTYPE, "docname": ["in", rows]})
            frappe.db.delete(
                "Comment", {"reference_doctype": ROW_DOCTYPE, "reference_name": ["in", rows]}
            )
        frappe.db.commit()

    def _stored(self, row):
        return frappe.db.get_value(ROW_DOCTYPE, row, list(_STORED), as_dict=True)

    def _leg(self, row, kind="Settled"):
        return frappe.db.get_value(
            MATCH_DOCTYPE,
            {"import_row": row, "match_kind": kind},
            ["name", "target_doctype", "target_name", "created_by_import", "settlement_origin"],
            as_dict=True,
        )

    def _reopen(self, suffix="AAAAAA"):
        """Unreconcile one Settled line. Returns (row name, the expense it deleted)."""
        row = self._row(suffix).name
        leg = self._leg(row)
        unreconcile_row(row=row, legs="all", reason=REASON)
        return row, leg


class TestUnreconcile(CashbookUndoCase):
    def test_the_plan_offers_to_delete_the_created_expense(self):
        row = self._row("AAAAAA").name
        plan = get_unreconcile_plan(row=row)
        self.assertEqual(plan["refused_count"], 0)
        self.assertEqual([leg["verdict"] for leg in plan["legs"]], [VERDICT_DELETE_CREATED])

    def test_it_deletes_the_expense_and_lands_not_matched_with_no_pick(self):
        row = self._row("AAAAAA").name
        before = self._stored(row)
        self.assertEqual(before.row_status, ROW_SETTLED)
        self.assertTrue(before.suggested_name)  # the job stores its created expense as the pick

        _, leg = self._reopen()

        self.assertFalse(frappe.db.exists(leg.target_doctype, leg.target_name))
        stored = self._stored(row)
        # Trap 1: a stale pick would read Matched -- to a record that no longer exists.
        self.assertEqual(stored.row_status, ROW_MISMATCHED)
        self.assertFalse(stored.suggested_name)
        self.assertEqual(stored.confirm_by_hand, 1)
        self.assertFalse(stored.settlement_origin)
        # The plan stays: it is what the Create form pre-fills from.
        self.assertEqual(stored.suggested_doctype, before.suggested_doctype)
        self.assertEqual(stored.suggested_expense_type, before.suggested_expense_type)
        self.assertEqual(stored.resolved_project, before.resolved_project)

    def test_the_cashbook_job_never_picks_a_reopened_line_up_again(self):
        """Trap 2: the job selects `Pending match run` lines with a plan. A reopened line keeps its
        plan, so the status is the only fence."""
        row, _ = self._reopen()
        self.assertNotEqual(self._stored(row).row_status, ROW_PENDING_MATCH)
        cb._cashbook_worker(self.batch, "Administrator")
        self.assertIsNone(self._leg(row))
        self.assertEqual(self._stored(row).row_status, ROW_MISMATCHED)

    def test_an_expense_edited_since_the_import_is_refused_and_nothing_is_written(self):
        row = self._row("AAAAAA").name
        leg = self._leg(row)
        expense = frappe.get_doc(leg.target_doctype, leg.target_name)
        expense.description = "Corrected by hand"
        expense.flags.ignore_permissions = True
        expense.save(ignore_version=False)
        frappe.db.commit()

        with self.assertRaises(frappe.ValidationError) as caught:
            unreconcile_row(row=row, legs="all", reason=REASON)
        self.assertIn("after the import made it", str(caught.exception))
        self.assertTrue(frappe.db.exists(leg.target_doctype, leg.target_name))
        self.assertEqual(self._stored(row).row_status, ROW_SETTLED)
        self.assertEqual(self._leg(row).name, leg.name)

    def test_a_plain_accountant_is_refused(self):
        row = self._row("AAAAAA").name
        frappe.set_user(self.users.make(ACCOUNTANT))
        with self.assertRaises(frappe.PermissionError):
            unreconcile_row(row=row, legs="all", reason=REASON)
        frappe.set_user("Administrator")
        self.assertEqual(self._stored(row).row_status, ROW_SETTLED)


class TestAReopenedLineIsSettledByHand(CashbookUndoCase):
    def test_create_writes_paid_by_from_the_statement_and_can_be_unreconciled_again(self):
        """Trap 4: the normal Create does not pass Paid by; a wallet line must carry who spent it."""
        row, _ = self._reopen()
        # A live, Won project the create is allowed to book against -- never a test suite's fixture.
        project = frappe.db.get_value(
            "Projects", {"tendering_status": "Won", "status": ["!=", "CEO Hold"]}, "name",
            order_by="creation asc",
        )
        expense_type = frappe.db.get_value("Expense Type", {"project": 1, "non_project": 0}, "name")

        create_expense(
            row=row, doctype="Project Expenses", expense_type=expense_type, project=project
        )

        leg = self._leg(row)
        self.extra.append((leg.target_doctype, leg.target_name))
        self.assertEqual(frappe.db.get_value("Project Expenses", leg.target_name, "payment_by"), "Asha Menon")
        self.assertEqual(
            frappe.db.get_value("Project Expenses", leg.target_name, "payment_ref"),
            self._row("AAAAAA").transfer_id,
        )
        self.assertEqual(leg.created_by_import, 1)
        # A person chose it: never the worker's "Suggestion accepted".
        self.assertNotEqual(leg.settlement_origin, "Suggestion accepted")
        self.assertEqual(self._stored(row).row_status, ROW_SETTLED)

        unreconcile_row(row=row, legs="all", reason=REASON)
        self.assertFalse(frappe.db.exists("Project Expenses", leg.target_name))
        self.assertEqual(self._stored(row).row_status, ROW_MISMATCHED)

    def test_link_settles_an_existing_expense_and_unreconcile_puts_it_back(self):
        """Owner Q2: a reopened line may settle an existing record by hand. Undoing that Link reverts it
        to where a settle takes it from, like any source (ADR-0022 Amendment B) -- never a delete."""
        row, _ = self._reopen()
        amount = frappe.db.get_value(ROW_DOCTYPE, row, "amount")
        pending = settleable_statuses("Non Project Expenses")[0]
        existing = frappe.new_doc("Non Project Expenses")
        existing.update(
            {
                "type": frappe.db.get_value("Expense Type", {"non_project": 1}, "name"),
                "status": pending,
                "amount": amount,
                "description": "Raised before the wallet spend was imported",
            }
        )
        existing.insert(ignore_permissions=True)
        self.extra.append(("Non Project Expenses", existing.name))
        frappe.db.commit()

        settle_expense(row=row, target_doctype="Non Project Expenses", target_name=existing.name)

        leg = self._leg(row)
        self.assertEqual((leg.target_name, leg.created_by_import), (existing.name, 0))
        self.assertEqual(self._stored(row).row_status, ROW_SETTLED)
        self.assertEqual(frappe.db.get_value("Non Project Expenses", existing.name, "status"), "Paid")

        unreconcile_row(row=row, legs="all", reason=REASON)
        self.assertEqual(frappe.db.get_value("Non Project Expenses", existing.name, "status"), pending)
        self.assertEqual(self._stored(row).row_status, ROW_MISMATCHED)

    def test_the_matcher_never_writes_to_a_reopened_line(self):
        row, _ = self._reopen()
        before = self._stored(row)
        match_batch(self.batch)
        self.assertEqual(self._stored(row), before)


class TestSkipAndUnskip(CashbookUndoCase):
    def test_a_line_the_job_has_not_reached_is_refused(self):
        row = self._row("AAAAAA").name
        frappe.db.set_value(ROW_DOCTYPE, row, "row_status", ROW_PENDING_MATCH, update_modified=False)
        frappe.db.commit()
        with self.assertRaises(frappe.ValidationError) as caught:
            skip_row(row, "not ours")
        self.assertIn(SKIP_REFUSED_CASHBOOK_PENDING, str(caught.exception))

    def test_a_reopened_line_is_skipped_by_hand_and_unskipped_back_to_not_matched(self):
        row, _ = self._reopen()
        skip_row(row, "Staff's own money")
        stored = self._stored(row)
        self.assertEqual((stored.row_status, stored.skip_origin), (ROW_SKIPPED, SKIP_ORIGIN_MANUAL))
        self.assertEqual(stored.skip_kind, "Skipped by hand")

        result = unskip_row(row, "It was ours after all")

        stored = self._stored(row)
        self.assertEqual(result["status"], ROW_MISMATCHED)
        self.assertEqual(stored.row_status, ROW_MISMATCHED)
        self.assertFalse(stored.skip_origin)
        self.assertFalse(stored.skip_kind)
        self.assertFalse(stored.skip_reason)
        self.assertFalse(stored.suggested_name)
        self.assertFalse(result["suggested_name"])
        # The plan survives, and the job still never reaches the line.
        self.assertTrue(stored.suggested_doctype)
        cb._cashbook_worker(self.batch, "Administrator")
        self.assertIsNone(self._leg(row))

    def test_an_unskip_whose_transaction_is_booked_is_skipped_again_as_system(self):
        """Trap 3: `match_line` refuses Cashbook, so the re-check is the Cashbook duplicate check."""
        row, _ = self._reopen()
        skip_row(row, "Staff's own money")
        line = frappe.db.get_value(ROW_DOCTYPE, row, ["transfer_id", "amount", "added_on"], as_dict=True)
        booking = frappe.new_doc("Non Project Expenses")
        booking.update(
            {
                "type": frappe.db.get_value("Expense Type", {"non_project": 1}, "name"),
                "status": "Paid",
                "amount": line.amount,
                "payment_date": line.added_on.date(),
                "payment_ref": line.transfer_id,
                "description": "Keyed in by hand",
            }
        )
        booking.insert(ignore_permissions=True)
        self.extra.append(("Non Project Expenses", booking.name))
        frappe.db.commit()

        result = unskip_row(row, "It was ours after all")

        stored = self._stored(row)
        self.assertEqual(result["status"], ROW_SKIPPED)
        self.assertEqual(stored.row_status, ROW_SKIPPED)
        self.assertEqual(stored.skip_origin, SKIP_ORIGIN_SYSTEM)
        self.assertEqual(stored.skip_kind, "Outflow Already Recorded")
        self.assertIn(booking.name, stored.outcome_note)
        self.assertEqual(result["outcome_note"], stored.outcome_note)
        # Locked now: only a hand skip comes back.
        with self.assertRaises(frappe.ValidationError) as caught:
            unskip_row(row, "again")
        self.assertIn(UNSKIP_REFUSED_CASHBOOK, str(caught.exception))

    def test_an_unskip_whose_transaction_settled_another_line_is_skipped_again(self):
        row, _ = self._reopen()
        skip_row(row, "Staff's own money")
        # Another line holds a live leg on the same wallet transaction, on a record that no longer
        # carries its reference -- so only the leg can say the money is booked.
        other = self._row("BBBBBB").name
        transfer_id = frappe.db.get_value(ROW_DOCTYPE, row, "transfer_id")
        frappe.db.set_value(MATCH_DOCTYPE, self._leg(other).name, "transfer_id", transfer_id)
        frappe.db.commit()

        result = unskip_row(row, "It was ours after all")

        self.assertEqual(result["status"], ROW_SKIPPED)
        self.assertEqual(self._stored(row).skip_kind, "Outflow Already Recorded")
        self.assertIn(self._leg(other).target_name, self._stored(row).outcome_note)

    def test_a_system_cashbook_skip_stays_locked(self):
        row = self._row("900001-0").name
        with self.assertRaises(frappe.ValidationError) as caught:
            unskip_row(row, "try")
        self.assertIn(UNSKIP_REFUSED_CASHBOOK, str(caught.exception))
        self.assertEqual(self._stored(row).skip_origin, SKIP_ORIGIN_SYSTEM)

    def test_a_plain_accountant_can_neither_skip_nor_unskip(self):
        row, _ = self._reopen()
        frappe.set_user(self.users.make(ACCOUNTANT))
        with self.assertRaises(frappe.PermissionError):
            skip_row(row, "not ours")
        frappe.set_user("Administrator")
        skip_row(row, "not ours")
        frappe.set_user(self.users.make(ACCOUNTANT))
        with self.assertRaises(frappe.PermissionError):
            unskip_row(row, "back")
        frappe.set_user("Administrator")
        self.assertEqual(self._stored(row).row_status, ROW_SKIPPED)
