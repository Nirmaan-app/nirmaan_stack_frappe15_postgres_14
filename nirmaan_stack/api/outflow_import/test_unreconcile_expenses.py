# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Unreconcile a line settled against an EXISTING expense (#1277, parent #1270, ADR-0022).

Through the whitelisted `get_unreconcile_plan` and `unreconcile_row`, for a hand Link to an Approved
`Project Expenses` and `Non Project Expenses` record: the expense goes back to Approved with its payment
date, reference and (Project Expenses) "paid by" cleared, the leg is Reversed, the line is open, and
the expense settles against a DIFFERENT line afterwards -- the only proof it is really free.

An expense the import CREATED is deleted instead: `test_unreconcile_created.py` (#1278).

⚠️ RUNS AGAINST THE LIVE SITE DATABASE. Every expense here hangs off the fixture's throwaway project
(never a real one: a Paid Project Expense moves that project's CEO Hold), and every expense, its
Versions and File rows, and the project's CEO Hold reasons are purged in tearDown.
"""

import frappe

from nirmaan_stack.api.outflow_import.expenses import create_expense, settle_row
from nirmaan_stack.api.outflow_import.test_unreconcile_payments import PaymentUnreconcileFixture
from nirmaan_stack.api.outflow_import.unreconcile import get_unreconcile_plan, unreconcile_row
from nirmaan_stack.integrations.controllers.project_cashflow_hold_update import (
    _compute_cashflow_gap,
)
from nirmaan_stack.services.ceo_hold import core as ceo_hold
from nirmaan_stack.services.outflow_import.status import ROW_MISMATCHED, ROW_SETTLED
from nirmaan_stack.services.outflow_import.unreconcile import (
    VERDICT_REFUSED,
    VERDICT_REVERT_EXPENSE,
    WHAT_HAPPENS_REVERT_NON_PROJECT_EXPENSE,
    WHAT_HAPPENS_REVERT_PROJECT_EXPENSE,
)

PROJECT_EXPENSE = "Project Expenses"
NON_PROJECT_EXPENSE = "Non Project Expenses"
MATCH_DOCTYPE = "Outflow Row Match"
ROW_DOCTYPE = "Outflow Import Row"


class ExpenseUnreconcileFixture(PaymentUnreconcileFixture):
    def setUp(self):
        super().setUp()
        self.expenses = []
        self.files = []

    def tearDown(self):
        for doctype, name in self.expenses:
            frappe.db.delete("Version", {"ref_doctype": doctype, "docname": name})
            frappe.db.delete("File", {"attached_to_doctype": doctype, "attached_to_name": name})
            frappe.db.delete(doctype, {"name": name})
        if self.files:
            frappe.db.delete("File", {"name": ["in", self.files]})
        project = getattr(self, "_alloc_project_name", None)
        if project:
            frappe.db.delete("CEO Hold Reason", {"project": project})
            frappe.flags.pop(f"ceo_hold_checked:{project}", None)
        frappe.db.commit()
        super().tearDown()

    def _expense(self, doctype, amount):
        """An Approved expense, through the document layer as the Expenses screen makes one."""
        doc = frappe.new_doc(doctype)
        doc.update(
            {
                "type": frappe.db.get_value(
                    "Expense Type",
                    {"project": 1, "non_project": 0}
                    if doctype == PROJECT_EXPENSE
                    else {"non_project": 1, "project": 0},
                    "name",
                ),
                "status": "Approved",
                "amount": str(amount) if doctype == PROJECT_EXPENSE else float(amount),
                "description": "planted by test_unreconcile_expenses",
            }
        )
        if doctype == PROJECT_EXPENSE:
            doc.projects = self._allocation_project()
        doc.insert(ignore_permissions=True)
        frappe.db.set_value(doctype, doc.name, "status", "Approved", update_modified=False)
        self.expenses.append((doctype, doc.name))
        frappe.db.commit()
        return doc.name

    def _linked(self, doctype, amount="500"):
        """A hand Link: an Approved expense settled against a fresh line."""
        name = self._expense(doctype, amount)
        row = self._staged_row(amount=amount)
        settle_row(row=row, target_doctype=doctype, target_name=name)
        self.assertEqual(self._line(row).row_status, ROW_SETTLED)
        self.assertEqual(frappe.db.get_value(doctype, name, "status"), "Paid")
        return row, name

    def _stored(self, doctype, name):
        fields = ["status", "payment_date", "payment_ref", "payment_attachment", "amount"]
        if doctype == PROJECT_EXPENSE:
            fields.append("payment_by")
        return frappe.db.get_value(doctype, name, fields, as_dict=True)

    def _assert_free(self, doctype, name):
        stored = self._stored(doctype, name)
        self.assertEqual(stored.status, "Approved")
        self.assertFalse(stored.payment_date)
        self.assertFalse(stored.payment_ref)
        if doctype == PROJECT_EXPENSE:
            self.assertFalse(stored.payment_by)

    def _resettle_elsewhere(self, doctype, name):
        other = self._staged_row(amount=str(self._stored(doctype, name).amount))
        settle_row(row=other, target_doctype=doctype, target_name=name)
        self.assertEqual(self._line(other).row_status, ROW_SETTLED)
        self.assertEqual(frappe.db.get_value(doctype, name, "status"), "Paid")


class TestAProjectExpense(ExpenseUnreconcileFixture):
    def test_the_plan_offers_the_revert_with_the_dialog_sentence(self):
        row, name = self._linked(PROJECT_EXPENSE)
        plan = get_unreconcile_plan(row=row)
        self.assertEqual(plan["refused_count"], 0)
        [leg] = plan["legs"]
        self.assertEqual(leg["target_name"], name)
        self.assertEqual(leg["verdict"], VERDICT_REVERT_EXPENSE)
        self.assertEqual(leg["what_happens"], WHAT_HAPPENS_REVERT_PROJECT_EXPENSE)
        self.assertEqual(
            WHAT_HAPPENS_REVERT_PROJECT_EXPENSE,
            "Goes back to Approved. Payment date, reference and 'paid by' are cleared.",
        )

    def test_it_goes_back_to_approved_the_line_opens_and_it_resettles_elsewhere(self):
        row, name = self._linked(PROJECT_EXPENSE)
        self.assertTrue(self._stored(PROJECT_EXPENSE, name).payment_by)

        result = unreconcile_row(row=row, legs="all", reason="wrong expense")

        self.assertEqual(result["row_status"], ROW_MISMATCHED)
        [reversed_leg] = result["reversed"]
        self.assertEqual(reversed_leg["verdict"], VERDICT_REVERT_EXPENSE)
        self.assertEqual(reversed_leg["amount_after"], 500.0)
        self._assert_free(PROJECT_EXPENSE, name)
        self.assertEqual(
            frappe.db.get_value(
                MATCH_DOCTYPE, self._leg(row, name), ["match_kind", "reversal_reason"]
            ),
            ("Reversed", "wrong expense"),
        )
        self._resettle_elsewhere(PROJECT_EXPENSE, name)

    def test_the_statement_attachment_and_its_file_row_come_off(self):
        row, name = self._linked(PROJECT_EXPENSE)
        self.assertEqual(self._stored(PROJECT_EXPENSE, name).payment_attachment, self.ALLOC_STATEMENT)
        link = f"TEST-OFI-FILE-{frappe.generate_hash(length=10)}"
        frappe.db.sql(
            """INSERT INTO "tabFile" (name, creation, modified, modified_by, owner, docstatus, idx,
                   file_name, file_url, attached_to_doctype, attached_to_name, attached_to_field,
                   is_private, is_folder)
               VALUES (%s, NOW(), NOW(), 'Administrator', 'Administrator', 0, 0,
                   'statement.csv', %s, %s, %s, 'payment_attachment', 1, 0)""",
            (link, self.ALLOC_STATEMENT, PROJECT_EXPENSE, name),
        )
        self.files.append(link)
        frappe.db.commit()

        unreconcile_row(row=row, legs="all", reason="wrong expense")

        self.assertFalse(self._stored(PROJECT_EXPENSE, name).payment_attachment)
        self.assertFalse(frappe.db.exists("File", link))

    def test_the_cashflow_gap_hold_matches_a_fresh_evaluation(self):
        row, name = self._linked(PROJECT_EXPENSE)
        project = self._allocation_project()
        # Paid, the expense puts the gap at 500 -- over a limit of 100. `settle_row` in this same
        # process already claimed the hook's per-request flag, so only the explicit re-sync can
        # clear the reason once the expense is back to Approved.
        frappe.db.set_value("Projects", project, "cashflow_gap_limit", 100, update_modified=False)
        ceo_hold.set_reason(project, ceo_hold.SOURCE_CASHFLOW, ceo_hold.cashflow_reason_text(500, 100))
        frappe.db.commit()
        self.assertTrue(frappe.flags.get(f"ceo_hold_checked:{project}"))

        unreconcile_row(row=row, legs="all", reason="wrong expense")

        gap = _compute_cashflow_gap(project)
        self.assertEqual(gap, 0.0)
        self.assertEqual(ceo_hold.SOURCE_CASHFLOW in ceo_hold.active_sources(project), gap > 100)


class TestANonProjectExpense(ExpenseUnreconcileFixture):
    def test_it_goes_back_to_approved_with_no_paid_by_and_resettles_elsewhere(self):
        row, name = self._linked(NON_PROJECT_EXPENSE)
        plan = get_unreconcile_plan(row=row)
        self.assertEqual(plan["legs"][0]["what_happens"], WHAT_HAPPENS_REVERT_NON_PROJECT_EXPENSE)

        result = unreconcile_row(row=row, legs="all", reason="wrong expense")

        self.assertEqual(result["row_status"], ROW_MISMATCHED)
        self._assert_free(NON_PROJECT_EXPENSE, name)
        self._resettle_elsewhere(NON_PROJECT_EXPENSE, name)


class TestRefusals(ExpenseUnreconcileFixture):
    def _assert_refused_and_untouched(self, row, doctype, name, fragment):
        plan = get_unreconcile_plan(row=row)
        [leg] = plan["legs"]
        self.assertEqual(leg["verdict"], VERDICT_REFUSED)
        self.assertIn(fragment, leg["reason"])
        with self.assertRaises(frappe.ValidationError) as caught:
            unreconcile_row(row=row, legs="all", reason="wrong expense")
        self.assertIn(fragment, str(caught.exception))
        self.assertEqual(frappe.db.get_value(doctype, name, "status"), "Paid")
        self.assertEqual(self._line(row).row_status, ROW_SETTLED)
        self.assertEqual(
            frappe.db.get_value(MATCH_DOCTYPE, self._leg(row, name), "match_kind"), "Settled"
        )

    def test_an_expense_edited_since_the_match_is_refused_as_changed_elsewhere(self):
        row, name = self._linked(PROJECT_EXPENSE)
        frappe.db.set_value(PROJECT_EXPENSE, name, "amount", "450", update_modified=False)
        frappe.db.commit()
        self._assert_refused_and_untouched(row, PROJECT_EXPENSE, name, "Somebody has changed the record")

    def test_an_expense_no_longer_paid_is_refused_as_changed_elsewhere(self):
        row, name = self._linked(NON_PROJECT_EXPENSE)
        # A raw write on purpose: it stands in for an edit made elsewhere, hooks and all skipped.
        frappe.db.set_value(NON_PROJECT_EXPENSE, name, "status", "Approved", update_modified=False)
        frappe.db.commit()
        plan = get_unreconcile_plan(row=row)
        self.assertIn("not Paid", plan["legs"][0]["reason"])
        with self.assertRaises(frappe.ValidationError):
            unreconcile_row(row=row, legs="all", reason="wrong expense")
        self.assertEqual(
            frappe.db.get_value(MATCH_DOCTYPE, self._leg(row, name), "match_kind"), "Settled"
        )

    def test_a_re_pointed_reference_is_refused(self):
        row, name = self._linked(NON_PROJECT_EXPENSE)
        frappe.db.set_value(
            NON_PROJECT_EXPENSE, name, "payment_ref", "SOMEONE-ELSE", update_modified=False
        )
        frappe.db.commit()
        self._assert_refused_and_untouched(row, NON_PROJECT_EXPENSE, name, "re-pointed")

    def test_an_expense_the_import_created_is_no_longer_refused_as_not_yet(self):
        """⚠️ INVERTED AT #1278: a created expense is now DELETED (`test_unreconcile_created.py`)."""
        row = self._staged_row(amount="500")
        result = create_expense(
            row=row,
            doctype=NON_PROJECT_EXPENSE,
            expense_type=frappe.db.get_value(
                "Expense Type", {"non_project": 1, "project": 0}, "name"
            ),
        )
        name = result["settled"]["name"]
        self.expenses.append((NON_PROJECT_EXPENSE, name))
        [leg] = get_unreconcile_plan(row=row)["legs"]
        self.assertNotEqual(leg["verdict"], VERDICT_REFUSED)
        self.assertNotIn("can't be undone yet", leg["reason"] or "")


class TestTheCreatedFlagDecides(ExpenseUnreconcileFixture):
    """⚠️ INVERTED AT #1278. Until the stored created flag, an expense reverted only on PROOF it existed
    before the import (older than the upload, or a Version showing it was once not Paid). The leg's flag
    now decides, and an unflagged leg is "not created" -- the safe revert path."""

    def test_an_expense_older_than_the_upload_reverts_even_with_no_version_history(self):
        """The shape of an expense settled before X1 moved the settle onto `doc.save()`."""
        name = self._expense(NON_PROJECT_EXPENSE, "500")
        row = self._staged_row(amount="500")
        settle_row(row=row, target_doctype=NON_PROJECT_EXPENSE, target_name=name)
        frappe.db.delete("Version", {"ref_doctype": NON_PROJECT_EXPENSE, "docname": name})
        frappe.db.commit()

        unreconcile_row(row=row, legs="all", reason="wrong expense")

        self._assert_free(NON_PROJECT_EXPENSE, name)

    def test_a_younger_expense_with_no_history_now_reverts(self):
        row = self._staged_row(amount="500")
        name = self._expense(NON_PROJECT_EXPENSE, "500")
        settle_row(row=row, target_doctype=NON_PROJECT_EXPENSE, target_name=name)
        frappe.db.delete("Version", {"ref_doctype": NON_PROJECT_EXPENSE, "docname": name})
        frappe.db.commit()

        unreconcile_row(row=row, legs="all", reason="wrong expense")

        self._assert_free(NON_PROJECT_EXPENSE, name)
