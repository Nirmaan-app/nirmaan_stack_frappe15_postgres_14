# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""The four rules that protect an expense settled by bank lines (#1302, ADR-0027 Q11/Q22).

Driven at the DOCUMENT SEAM -- `doc.save()` and `frappe.delete_doc()` -- because that is the seam the
rules were put on. Every door a person can edit an expense through (Mark Reconciled on the Payments
tab, the old expense pages' Mark as Paid / Edit / Delete, Desk, Data Import) arrives here, so a test
that drove an endpoint would prove nothing about the doors that have none.

Asserted on what a person sees: the stored status, amount and payment date, and the refusal sentence.

⚠️ RUNS AGAINST THE LIVE SITE DATABASE. Fixtures and teardown are `test_link_rows_to_expense`'s: every
expense, slip, import row and batch a test makes is purged.

Prior art: `test_confirm_by_hand.py` (endpoint seam), `test_link_rows_to_expense.py` (the link).
"""

from decimal import Decimal

import frappe

from nirmaan_stack.api.outflow_import.link_lines import link_rows_to_expense
from nirmaan_stack.api.outflow_import.review import MATCH_DOCTYPE, ROW_DOCTYPE
from nirmaan_stack.api.outflow_import.test_link_rows_to_expense import (
    RECONCILIATION_PENDING,
    LinkFixture,
)
from nirmaan_stack.api.outflow_import.unreconcile import unreconcile_row
from nirmaan_stack.services.outflow_import.amounts import AMOUNT_TOLERANCE
from nirmaan_stack.services.outflow_import.settle import (
    NON_PROJECT_EXPENSE,
    PROJECT_EXPENSE,
    format_amount_for,
)

PAID = "Paid"


class ExpenseRulesFixture(LinkFixture):
    def tearDown(self):
        """The undo tests leave a comment on the line and a Version on the slip."""
        rows = frappe.get_all(ROW_DOCTYPE, filters={"import_batch": self.batch.name}, pluck="name")
        matches = frappe.get_all(
            MATCH_DOCTYPE, filters={"import_batch": self.batch.name}, pluck="name"
        )
        if rows:
            frappe.db.delete(
                "Comment", {"reference_doctype": ROW_DOCTYPE, "reference_name": ["in", rows]}
            )
        if matches:
            frappe.db.delete("Version", {"ref_doctype": MATCH_DOCTYPE, "docname": ["in", matches]})
        super().tearDown()

    def _linked(self, count=3, *, extra=0, doctype=NON_PROJECT_EXPENSE):
        """`count` bank lines linked to an expense worth their total plus `extra`.

        `extra` of 0 fills it (Paid); anything above leaves it short (Reconciliation Pending).
        """
        lines = self._lines(count)
        expense = self._expense(doctype, amount=self._total(lines) + extra)
        link_rows_to_expense(
            rows=self._names(lines), target_doctype=doctype, target_name=expense
        )
        return lines, expense

    def _unlinked(self, amount="5000", doctype=NON_PROJECT_EXPENSE):
        """An ordinary expense no bank line has ever touched -- the control in every rule's tests."""
        return self._expense(doctype, amount=Decimal(amount))

    def _save(self, doctype, name, **fields):
        """Edit the expense the way every door does: load, set, save."""
        doc = frappe.get_doc(doctype, name)
        for field, value in fields.items():
            doc.set(field, value)
        doc.save(ignore_permissions=True)
        frappe.db.commit()
        return doc

    def _set_amount(self, doctype, name, amount):
        return self._save(doctype, name, amount=format_amount_for(doctype, Decimal(str(amount))))

    def _amount(self, doctype, name) -> Decimal:
        return Decimal(str(self._state(doctype, name).amount))


class TestRuleOneTheAmountCannotDropBelowItsLines(ExpenseRulesFixture):
    def test_lowering_the_amount_below_the_linked_total_is_refused_and_writes_nothing(self):
        lines, expense = self._linked(3)
        linked_total = self._total(lines)

        with self.assertRaises(frappe.ValidationError) as caught:
            self._set_amount(NON_PROJECT_EXPENSE, expense, linked_total / 2)

        self.assertIn(expense, str(caught.exception))
        self.assertIn("3 bank lines", str(caught.exception))
        self.assertIn("Unreconcile", str(caught.exception))
        self.assertEqual(self._amount(NON_PROJECT_EXPENSE, expense), linked_total)

    def test_lowering_to_exactly_the_linked_total_is_allowed(self):
        lines, expense = self._linked(2, extra=1000)

        self._set_amount(NON_PROJECT_EXPENSE, expense, self._total(lines))

        self.assertEqual(self._amount(NON_PROJECT_EXPENSE, expense), self._total(lines))

    def test_lowering_to_five_rupees_under_the_linked_total_is_allowed(self):
        """The same ₹5 the link guard allows in the other direction -- rounding, not a shortfall."""
        lines, expense = self._linked(2, extra=1000)
        floor = self._total(lines) - AMOUNT_TOLERANCE

        self._set_amount(NON_PROJECT_EXPENSE, expense, floor)

        self.assertEqual(self._amount(NON_PROJECT_EXPENSE, expense), floor)

    def test_a_paisa_below_that_floor_is_refused(self):
        lines, expense = self._linked(2, extra=1000)

        with self.assertRaises(frappe.ValidationError):
            self._set_amount(
                NON_PROJECT_EXPENSE, expense, self._total(lines) - AMOUNT_TOLERANCE - Decimal("0.01")
            )

    def test_the_rule_holds_on_project_expenses_too(self):
        lines, expense = self._linked(2, doctype=PROJECT_EXPENSE)

        with self.assertRaises(frappe.ValidationError):
            self._set_amount(PROJECT_EXPENSE, expense, 1)

        self.assertEqual(self._amount(PROJECT_EXPENSE, expense), self._total(lines))


class TestRuleTwoPaidByHandWhileShort(ExpenseRulesFixture):
    def test_marking_a_part_linked_expense_paid_by_hand_is_refused(self):
        lines, expense = self._linked(2, extra=10000)
        self.assertEqual(self._state(NON_PROJECT_EXPENSE, expense).status, RECONCILIATION_PENDING)

        with self.assertRaises(frappe.ValidationError) as caught:
            self._save(NON_PROJECT_EXPENSE, expense, status=PAID)

        message = str(caught.exception)
        self.assertIn(expense, message)
        self.assertIn("2 bank lines", message)
        self.assertIn("₹10,000", message)  # what is left
        self.assertEqual(self._state(NON_PROJECT_EXPENSE, expense).status, RECONCILIATION_PENDING)

    def test_marking_a_fully_linked_expense_paid_by_hand_is_allowed(self):
        """The branch the refusal must not catch. The status is forced back through a raw write --
        the document layer would never leave a filled expense Reconciliation Pending."""
        _lines, expense = self._linked(2)
        frappe.db.set_value(
            NON_PROJECT_EXPENSE, expense, "status", RECONCILIATION_PENDING, update_modified=False
        )
        frappe.db.commit()

        self._save(NON_PROJECT_EXPENSE, expense, status=PAID)

        self.assertEqual(self._state(NON_PROJECT_EXPENSE, expense).status, PAID)

    def test_an_expense_with_no_lines_can_be_marked_paid_by_hand(self):
        expense = self._unlinked()

        self._save(NON_PROJECT_EXPENSE, expense, status=PAID)

        self.assertEqual(self._state(NON_PROJECT_EXPENSE, expense).status, PAID)


class TestRuleThreeDelete(ExpenseRulesFixture):
    def test_deleting_an_expense_with_live_lines_is_refused(self):
        """⚠️ `force=True` ON PURPOSE. Frappe's own dynamic-link check would refuse this delete too --
        the slip names the expense -- so a plain delete would pass for a reason that has nothing to do
        with rule 3. `force` turns that check off, which is exactly what `unreconcile_created.delete_created`
        does, so what refuses here can only be our rule."""
        _lines, expense = self._linked(3)

        with self.assertRaises(frappe.ValidationError) as caught:
            frappe.delete_doc(NON_PROJECT_EXPENSE, expense, force=True, ignore_permissions=True)

        self.assertIn("3 bank lines", str(caught.exception))
        self.assertIn("Unreconcile", str(caught.exception))
        self.assertTrue(frappe.db.exists(NON_PROJECT_EXPENSE, expense))

    def test_once_every_slip_is_reversed_the_delete_goes_through(self):
        """What keeps Unreconcile's own delete of an import-created expense working: `unreconcile_row`
        stamps the slip Reversed BEFORE it carries the verdict out, so the count this rule reads is 0.

        The same `force=True` that path uses -- the Reversed slip is KEPT (ADR-0020 D3) and still names
        the expense, so Frappe's link check would otherwise refuse a delete the undo must be able to make.
        """
        lines, expense = self._linked(1)
        unreconcile_row(row=lines[0]["name"], legs="all", reason="wrong expense")

        frappe.delete_doc(NON_PROJECT_EXPENSE, expense, force=True, ignore_permissions=True)
        frappe.db.commit()

        self.assertFalse(frappe.db.exists(NON_PROJECT_EXPENSE, expense))
        self.non_project_expenses.remove(expense)

    def test_an_expense_with_no_lines_deletes_as_it_always_did(self):
        expense = self._unlinked()

        frappe.delete_doc(NON_PROJECT_EXPENSE, expense, ignore_permissions=True)
        frappe.db.commit()

        self.assertFalse(frappe.db.exists(NON_PROJECT_EXPENSE, expense))
        self.non_project_expenses.remove(expense)


class TestRuleFourEverySaveReDerives(ExpenseRulesFixture):
    def test_raising_the_amount_flips_paid_back_to_pending_and_clears_the_date(self):
        lines, expense = self._linked(3)
        paid = self._state(NON_PROJECT_EXPENSE, expense)
        self.assertEqual(paid.status, PAID)
        self.assertIsNotNone(paid.payment_date)

        self._set_amount(NON_PROJECT_EXPENSE, expense, self._total(lines) + 10000)

        after = self._state(NON_PROJECT_EXPENSE, expense)
        self.assertEqual(after.status, RECONCILIATION_PENDING)
        self.assertIsNone(after.payment_date)

    def test_lowering_it_back_onto_the_lines_returns_it_to_paid_on_the_latest_line_date(self):
        lines, expense = self._linked(3)
        self._set_amount(NON_PROJECT_EXPENSE, expense, self._total(lines) + 10000)

        self._set_amount(NON_PROJECT_EXPENSE, expense, self._total(lines))

        after = self._state(NON_PROJECT_EXPENSE, expense)
        self.assertEqual(after.status, PAID)
        self.assertEqual(after.payment_date, max(line["added_on"] for line in lines).date())

    def test_an_edit_that_touches_nothing_financial_leaves_paid_and_its_date_alone(self):
        lines, expense = self._linked(2)
        before = self._state(NON_PROJECT_EXPENSE, expense)

        self._save(NON_PROJECT_EXPENSE, expense, description="renamed by a person")

        after = self._state(NON_PROJECT_EXPENSE, expense)
        self.assertEqual(after.status, PAID)
        self.assertEqual(after.payment_date, before.payment_date)

    def test_a_hand_edited_payment_date_is_re_derived_from_the_lines(self):
        """Rule 4 re-works out the DATE, not only the status (#1302: "and the payment date").

        ⚠️ THE ONE SILENT EFFECT IN THIS CHANGE, so it is pinned rather than left incidental: a person
        correcting a settled expense's date by hand sees the save succeed and the field revert in the
        same transaction. The date belongs to the bank lines, so it is re-derived, not refused. The
        other three rules all refuse out loud; this one does not, and that asymmetry is deliberate.
        """
        lines, expense = self._linked(3)
        latest = max(line["added_on"] for line in lines).date()

        self._save(NON_PROJECT_EXPENSE, expense, payment_date="2020-01-01")

        after = self._state(NON_PROJECT_EXPENSE, expense)
        self.assertEqual(after.status, PAID)
        self.assertEqual(after.payment_date, latest)

    def test_a_status_the_lines_contradict_is_put_back(self):
        """Story 25: an expense's status always matches its lines. Rejecting money the bank has
        already moved is exactly the state rule 4 makes unreachable."""
        _lines, expense = self._linked(2)

        self._save(NON_PROJECT_EXPENSE, expense, status="Rejected")

        self.assertEqual(self._state(NON_PROJECT_EXPENSE, expense).status, PAID)

    def test_an_expense_with_no_lines_keeps_whatever_status_it_is_saved_with(self):
        """The control: nearly every expense in the system has no bank lines, and none of this
        applies to it."""
        expense = self._unlinked()

        self._save(NON_PROJECT_EXPENSE, expense, status="Rejected")

        after = self._state(NON_PROJECT_EXPENSE, expense)
        self.assertEqual(after.status, "Rejected")
        self.assertIsNone(after.payment_date)


class TestTheImportsOwnWritesPassTheRules(ExpenseRulesFixture):
    """The rules have NO bypass flag, so the import's own settle and undo must satisfy them."""

    def test_linking_lines_that_fill_an_expense_still_marks_it_paid(self):
        lines, expense = self._linked(3)

        after = self._state(NON_PROJECT_EXPENSE, expense)
        self.assertEqual(after.status, PAID)
        self.assertEqual(after.payment_date, max(line["added_on"] for line in lines).date())

    def test_a_part_fill_still_leaves_it_pending_with_no_date(self):
        _lines, expense = self._linked(2, extra=10000)

        after = self._state(NON_PROJECT_EXPENSE, expense)
        self.assertEqual(after.status, RECONCILIATION_PENDING)
        self.assertIsNone(after.payment_date)

    def test_undoing_one_line_of_a_run_still_moves_it_back_to_pending(self):
        lines, expense = self._linked(3)

        unreconcile_row(row=lines[0]["name"], legs="all", reason="wrong person")

        after = self._state(NON_PROJECT_EXPENSE, expense)
        self.assertEqual(after.status, RECONCILIATION_PENDING)
        self.assertIsNone(after.payment_date)
        self.assertEqual(self._amount(NON_PROJECT_EXPENSE, expense), self._total(lines))


class TestAnExistingOneToOneSettledExpense(ExpenseRulesFixture):
    """Story 41: history is not rewritten. Every settled expense on the site today has one slip
    within ₹5 of its amount, and an ordinary save must leave it exactly as it is."""

    def test_it_saves_and_stays_paid_on_its_own_date(self):
        lines, expense = self._linked(1)
        before = self._state(NON_PROJECT_EXPENSE, expense)
        self.assertEqual(before.status, PAID)

        self._save(NON_PROJECT_EXPENSE, expense, comment="touched")

        after = self._state(NON_PROJECT_EXPENSE, expense)
        self.assertEqual(after.status, PAID)
        self.assertEqual(after.payment_date, before.payment_date)
        self.assertEqual(Decimal(str(after.amount)), Decimal(str(before.amount)))
