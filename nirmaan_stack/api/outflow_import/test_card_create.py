# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Review the card spends' types, then Create: one Paid Non-Project Expense per spend (#1568, spec #1565,
ADR-0037 rulings 1, 6, 7).

    devenv.sh test --module nirmaan_stack.api.outflow_import.test_card_create

Each test uploads the fixture statement as a PDF through the real endpoint (`test_card_import.CardImportCase`),
edits types through the Review endpoint, presses Create through its endpoint (the queue faked, to record the
job), then runs the Create job DIRECTLY, as the queue would. It asserts on what is left: Expenses, match
records, lines, and the import as Review reports it.

⚠️ Every test removes what it made: matches and Expenses here; lines, the statement, the batch and the PDF
through `test_card_import._purge`.
"""

from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.outflow_import import card_create, card_import, card_review
from nirmaan_stack.api.outflow_import.test_card_import import CardImportCase, purge_records
from nirmaan_stack.api.outflow_import.test_skip_row import ACCOUNTANT, ACCOUNTANT_LEAD, OUTSIDER
from nirmaan_stack.services.outflow_import.tests.card_pdf_builder import pdf_from_text

MATCH_DOCTYPE = "Outflow Row Match"
ROW_DOCTYPE = "Outflow Import Row"
EXPENSE = "Non Project Expenses"
MISC = "Misc. Expenses"
# A live Non-Project type other than the fallback, and a Project-only one (fixtures/expense_type.json).
HOTEL = "Hotel Expenses"
PROJECT_ONLY = "Scaffolding Rent"


def _purge_created(batch: str) -> None:
    """The batch's match records and the Expenses they name, with their Version and Comment rows. Raw, per
    scope (`test_card_import.purge_records`); rolls back first."""
    frappe.db.rollback()
    matches = frappe.get_all(
        MATCH_DOCTYPE, filters={"import_batch": batch}, fields=["name", "target_doctype", "target_name"]
    )
    purge_records(EXPENSE, [m.target_name for m in matches if m.target_doctype == EXPENSE])
    purge_records(MATCH_DOCTYPE, [m.name for m in matches])


def _purge_what_the_delete_left(expense: str) -> None:
    """A real delete (Unreconcile's) leaves a `Nirmaan Versions` copy, a `Deleted Document` row and a Deleted
    feed Comment behind, besides the Expense's own Version and Comment rows."""
    frappe.db.rollback()
    try:
        frappe.db.delete("Nirmaan Versions", {"ref_doctype": EXPENSE, "docname": expense})
        frappe.db.delete("Deleted Document", {"deleted_doctype": EXPENSE, "deleted_name": expense})
        frappe.db.delete(
            "Comment", {"comment_type": "Deleted", "reference_doctype": EXPENSE, "subject": f"{EXPENSE} {expense}"}
        )
        frappe.db.commit()
    except Exception:
        frappe.db.rollback()
        print(f"card create test purge: could not delete what deleting {expense} left")
    purge_records(EXPENSE, [expense])


class CardCreateCase(CardImportCase):
    def setUp(self):
        super().setUp()
        self.batch = self._upload(pdf_from_text(self._text()))["batch"]
        self.statement = frappe.db.get_value("Credit Card Statement", {"import_batch": self.batch}, "name")
        self.addCleanup(_purge_created, self.batch)

    def _review(self):
        return card_import.get_card_import(self.batch)

    def _press_create(self, user: str = "Administrator"):
        jobs = []
        frappe.set_user(user)
        try:
            with patch.object(frappe, "enqueue", side_effect=lambda *a, **kw: jobs.append(kw)):
                result = card_create.create_card_expenses(self.batch)
        finally:
            frappe.set_user("Administrator")
        return result, jobs

    def _run_create(self):
        card_create.create_card_import(self.batch, "Administrator")

    def _line(self, details: str):
        return next(line for line in self._rows(self.batch) if line.remarks == details)

    def _spends(self):
        return [row for row in self._rows(self.batch) if row.direction == "Debit"]

    def _expenses(self):
        return frappe.get_all(EXPENSE, filters={"credit_card_statement": self.statement}, fields=["*"])


class TestReviewShowsEachSpendsType(CardCreateCase):
    def test_every_spend_starts_as_misc_expenses_marked_check(self):
        spends = [line for line in self._review()["lines"] if not line["is_credit"]]
        self.assertEqual(len(spends), 40)
        self.assertEqual({line["expense_type"] for line in spends}, {MISC})
        self.assertEqual({line["check"] for line in spends}, {True})
        self.assertEqual({line["editable"] for line in spends}, {True})

    def test_a_credit_has_no_type_and_is_not_editable_here(self):
        credits = [line for line in self._review()["lines"] if line["is_credit"]]
        self.assertEqual({line["expense_type"] for line in credits}, {None})
        self.assertEqual({line["editable"] for line in credits}, {False})

    def test_the_type_list_is_the_live_non_project_list(self):
        types = self._review()["expense_types"]
        self.assertIn(MISC, types)
        self.assertIn(HOTEL, types)
        self.assertNotIn(PROJECT_ONLY, types)


class TestChangingASpendsType(CardCreateCase):
    def test_the_chosen_type_is_kept_and_no_longer_marked_check(self):
        line = self._line("PARK RESIDENCY Cochin IN")
        review = card_review.set_card_expense_type(self.batch, [line.name], HOTEL)
        shown = next(item for item in review["lines"] if item["name"] == line.name)
        self.assertEqual((shown["expense_type"], shown["check"]), (HOTEL, False))
        self.assertEqual(self._line("PARK RESIDENCY Cochin IN").suggested_expense_type, HOTEL)
        # Every other spend is untouched.
        others = [item for item in review["lines"] if not item["is_credit"] and item["name"] != line.name]
        self.assertEqual({item["expense_type"] for item in others}, {MISC})

    def test_an_accountant_may_change_it(self):
        accountant = self.users.make(ACCOUNTANT)
        line = self._line("PARK RESIDENCY Cochin IN")
        frappe.set_user(accountant)
        try:
            card_review.set_card_expense_type(self.batch, [line.name], HOTEL)
        finally:
            frappe.set_user("Administrator")
        self.assertEqual(self._line("PARK RESIDENCY Cochin IN").suggested_expense_type, HOTEL)

    def test_a_project_only_type_is_refused(self):
        line = self._line("PARK RESIDENCY Cochin IN")
        with self.assertRaises(frappe.ValidationError):
            card_review.set_card_expense_type(self.batch, [line.name], PROJECT_ONLY)
        self.assertEqual(self._line("PARK RESIDENCY Cochin IN").suggested_expense_type, MISC)

    def test_a_credit_line_is_refused(self):
        credit = next(row for row in self._rows(self.batch) if row.direction == "Credit")
        with self.assertRaises(frappe.ValidationError):
            card_review.set_card_expense_type(self.batch, [credit.name], HOTEL)
        self.assertFalse(self._line(credit.remarks).suggested_expense_type)

    def test_a_created_spend_is_refused(self):
        self._press_create()
        self._run_create()
        line = self._line("PARK RESIDENCY Cochin IN")
        with self.assertRaises(frappe.ValidationError):
            card_review.set_card_expense_type(self.batch, [line.name], HOTEL)
        self.assertEqual(frappe.db.get_value(EXPENSE, line.suggested_name, "type"), MISC)


class TestPressingCreate(CardCreateCase):
    def test_it_starts_one_job_de_duplicated_per_import(self):
        result, jobs = self._press_create()
        self.assertEqual(len(jobs), 1)
        self.assertEqual(jobs[0]["job_id"], f"card-create-{self.batch}")
        self.assertIn(jobs[0]["job_id"], card_import.job_ids(self.batch))
        self.assertTrue(jobs[0]["deduplicate"])
        self.assertEqual(result["batch"], self.batch)

    def test_an_accountant_and_an_accountant_lead_may_press_it(self):
        for role in (ACCOUNTANT, ACCOUNTANT_LEAD):
            _, jobs = self._press_create(self.users.make(role))
            self.assertEqual(len(jobs), 1, role)

    def test_a_user_outside_bulk_import_is_refused(self):
        outsider = self.users.make(OUTSIDER)
        with self.assertRaises(frappe.PermissionError):
            self._press_create(outsider)

    def test_it_is_refused_once_every_spend_is_created(self):
        self._press_create()
        self._run_create()
        with self.assertRaises(frappe.ValidationError):
            self._press_create()


class TestCreatedSpends(CardCreateCase):
    def setUp(self):
        super().setUp()
        self.park = self._line("PARK RESIDENCY Cochin IN")
        card_review.set_card_expense_type(self.batch, [self.park.name], HOTEL)
        self._press_create()
        self._run_create()

    def test_each_spend_is_one_paid_non_project_expense_on_the_statement(self):
        expenses = self._expenses()
        self.assertEqual(len(expenses), 40)
        self.assertEqual({e.status for e in expenses}, {"Paid"})
        self.assertEqual(round(sum(float(e.amount) for e in expenses), 2), 137584.99)

    def test_an_expense_carries_the_lines_amount_date_reference_and_description(self):
        line = self._line("PARK RESIDENCY Cochin IN")
        expense = frappe.get_doc(EXPENSE, line.suggested_name)
        self.assertEqual(expense.type, HOTEL)
        self.assertEqual(float(expense.amount), 1933.0)
        self.assertEqual(str(expense.payment_date), "2026-09-23")
        self.assertEqual(expense.payment_ref, f"PARK RESIDENCY Cochin IN - {line.transfer_id}")
        self.assertEqual(expense.description, f"Card spend at PARK RESIDENCY, {self.holder}'s card")
        self.assertEqual(expense.credit_card_statement, self.statement)
        # No statement PDF and no invoice on the Expense: the PDF is the statement's one File.
        self.assertFalse(expense.payment_attachment)
        self.assertFalse(expense.invoice_attachment)

    def test_a_spend_left_at_the_fallback_is_misc_expenses(self):
        line = self._line("ZOMATO LIMITED Gurugram IN")
        self.assertEqual(frappe.db.get_value(EXPENSE, line.suggested_name, "type"), MISC)

    def test_each_spend_is_settled_with_a_card_statement_match(self):
        spends = self._spends()
        self.assertEqual({row.row_status for row in spends}, {"Settled"})
        matches = frappe.get_all(
            MATCH_DOCTYPE, filters={"import_batch": self.batch}, fields=["match_basis", "created_by_import", "match_kind"]
        )
        self.assertEqual(len(matches), 40)
        self.assertEqual({(m.match_basis, m.created_by_import, m.match_kind) for m in matches}, {("card statement", 1, "Settled")})

    def test_credits_are_never_created(self):
        credits = [row for row in self._rows(self.batch) if row.direction == "Credit"]
        self.assertEqual(len(credits), 7)
        self.assertFalse({row.row_status for row in credits} & {"Settled"})
        self.assertFalse(any(row.suggested_name for row in credits))

    def test_review_reports_it_created_and_discard_is_refused(self):
        review = self._review()
        self.assertEqual((review["created"], review["to_create"], review["failed"]), (40, 0, 0))
        self.assertFalse(review["discardable"])
        self.assertEqual({line["editable"] for line in review["lines"]}, {False})
        with self.assertRaises(frappe.ValidationError):
            card_import.discard_card_import(self.batch)
        self.assertTrue(frappe.db.exists("Outflow Import Batch", self.batch))


class TestAnInterruptedCreateResumes(CardCreateCase):
    def test_a_line_that_failed_is_left_in_error_and_a_rerun_finishes_without_duplicates(self):
        self._press_create()
        real = card_create.create_expense_from_row
        calls = []

        def _third_fails(*args, **kwargs):
            calls.append(1)
            if len(calls) == 3:
                raise RuntimeError("worker died")
            return real(*args, **kwargs)

        with patch.object(card_create, "create_expense_from_row", side_effect=_third_fails):
            self._run_create()
        review = self._review()
        self.assertEqual((review["created"], review["failed"], review["to_create"]), (39, 1, 1))
        failed = [row for row in self._spends() if row.row_status == "Error"]
        self.assertEqual(len(failed), 1)
        self.assertIn("Could not create", failed[0].outcome_note)

        _, jobs = self._press_create()
        self.assertEqual(len(jobs), 1)
        self._run_create()
        self.assertEqual(len(self._expenses()), 40)
        self.assertEqual({row.row_status for row in self._spends()}, {"Settled"})
        self.assertEqual(len({e.payment_ref for e in self._expenses()}), 40)

    def test_a_second_run_writes_nothing_twice(self):
        self._press_create()
        self._run_create()
        self._run_create()
        self.assertEqual(len(self._expenses()), 40)


class TestUnreconcilingACreatedSpend(CardCreateCase):
    def test_it_removes_the_expense_reopens_the_line_and_create_makes_it_again(self):
        from nirmaan_stack.api.outflow_import.unreconcile import unreconcile_row

        self._press_create()
        self._run_create()
        line = self._line("PARK RESIDENCY Cochin IN")
        first = line.suggested_name
        unreconcile_row(row=line.name, legs="all", reason="wrong card line")
        self.addCleanup(_purge_what_the_delete_left, first)

        self.assertFalse(frappe.db.exists(EXPENSE, first))
        reopened = self._line("PARK RESIDENCY Cochin IN")
        self.assertNotEqual(reopened.row_status, "Settled")
        review = self._review()
        self.assertEqual((review["created"], review["to_create"]), (39, 1))
        shown = next(item for item in review["lines"] if item["name"] == line.name)
        self.assertTrue(shown["editable"])

        self._press_create()
        self._run_create()
        again = self._line("PARK RESIDENCY Cochin IN")
        self.assertEqual(again.row_status, "Settled")
        self.assertNotEqual(again.suggested_name, first)
        self.assertEqual(len(self._expenses()), 40)


class TestTheMatcherIsNeverCalled(FrappeTestCase):
    """The Cashbook AST guard (`test_cashbook_import`), over the card modules: they create, never settle."""

    def test_the_card_modules_import_and_call_no_settlement_entry_point(self):
        from nirmaan_stack.api.outflow_import import card_upload
        from nirmaan_stack.api.outflow_import.test_cashbook_import import TestItNeverSettlesAnExistingRecord
        from nirmaan_stack.services.outflow_import import card_pdf, card_statement, card_types

        guard = TestItNeverSettlesAnExistingRecord
        for module in (card_import, card_upload, card_review, card_create, card_pdf, card_statement, card_types):
            with self.subTest(module=module.__name__):
                self.assertEqual(guard.forbidden_imports(module), [])
                self.assertEqual(guard.forbidden_calls(module), [])
