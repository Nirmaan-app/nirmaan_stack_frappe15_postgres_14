# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Tests for expense settlement -- the only write path in Bulk Import Outflow (slice S5).

⚠️ RUNS AGAINST THE LIVE SITE DATABASE and, unlike the earlier suites, this one genuinely creates
and mutates EXPENSES. Everything it touches is tracked and purged in `tearDownClass`, and it never
creates a `Project Payments` document (only raw rows, which the other suites already justify).

What is pinned hardest here is the set of refusals. A settlement that succeeds when it should not
is invisible -- the money already moved, so the books simply become quietly wrong -- which makes
the guards more load-bearing than the happy path.
"""

import unittest
from dataclasses import replace
from decimal import Decimal

import frappe

from nirmaan_stack.api.outflow_import.expenses import (
    create_expense,
    get_expense_types,
    settle_expense,
)
from nirmaan_stack.api.outflow_import.review import MATCH_DOCTYPE
from nirmaan_stack.api.outflow_import.upload import BATCH_DOCTYPE, ROW_DOCTYPE, _stage_batch
from nirmaan_stack.services.outflow_import.parser import parse_statement
from nirmaan_stack.services.outflow_import.settle import (
    NON_PROJECT_EXPENSE,
    PROJECT_EXPENSE,
    AlreadyPaidError,
    AmountMismatchError,
    ExpenseTypeScopeError,
    WrongStatusError,
    format_amount_for,
)

FIXTURE = (
    frappe.get_app_path("nirmaan_stack")
    + "/services/outflow_import/tests/fixtures/cashfree_sample.csv"
)


def _fresh_parse():
    with open(FIXTURE, "rb") as handle:
        parsed = parse_statement(handle.read(), source="Cashfree")
    prefix = frappe.generate_hash(length=10)
    return replace(
        parsed,
        rows=tuple(replace(r, transfer_id=f"{prefix}-{r.transfer_id}") for r in parsed.rows),
    )


class SettlementFixture(unittest.TestCase):
    batches: list = []
    project_expenses: list = []
    non_project_expenses: list = []

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        # PER-CLASS lists: declared on the base they would be one shared object, and the first
        # tearDownClass would delete rows the later classes still need.
        cls.batches = []
        cls.project_expenses = []
        cls.non_project_expenses = []

        cls.parsed = _fresh_parse()
        cls.batch = _stage_batch(
            cls.parsed,
            file_url="/private/files/test-statement.csv",
            filename="test-statement.csv",
            user="Administrator",
        )
        cls.batches.append(cls.batch.name)
        cls.project = frappe.db.get_value("Projects", {}, "name")
        # EXCLUSIVE types on purpose. Several live Expense Types carry BOTH flags -- "Travel
        # Expenses (Bus)" and "(Train)" are valid for project AND non-project -- so a type picked
        # on `project=1` alone would legitimately pass the non-project scope check and make
        # test_a_project_type_is_refused_on_a_non_project_expense assert nothing.
        cls.project_type = frappe.db.get_value(
            "Expense Type", {"project": 1, "non_project": 0}, "name"
        )
        cls.non_project_type = frappe.db.get_value(
            "Expense Type", {"non_project": 1, "project": 0}, "name"
        )
        frappe.db.commit()

    @classmethod
    def tearDownClass(cls):
        frappe.db.delete(MATCH_DOCTYPE, {"import_batch": ["in", cls.batches]})
        for name in cls.batches:
            frappe.db.delete(ROW_DOCTYPE, {"import_batch": name})
            frappe.db.delete(BATCH_DOCTYPE, {"name": name})
        for name in cls.project_expenses:
            frappe.db.delete(PROJECT_EXPENSE, {"name": name})
        for name in cls.non_project_expenses:
            frappe.db.delete(NON_PROJECT_EXPENSE, {"name": name})
        frappe.db.commit()
        super().tearDownClass()

    def _row(self, suffix):
        """The FIRST staged row whose transfer id ends with `suffix`.

        Order matters: the fixture repeats one transfer id, and the SECOND occurrence is
        auto-skipped as an in-file duplicate. `frappe.db.get_value` with a filter returns one
        arbitrary match, which picked the skipped copy and made every settlement refuse.
        """
        rows = frappe.get_all(
            ROW_DOCTYPE,
            filters={"import_batch": self.batch.name, "transfer_id": ["like", f"%{suffix}"]},
            fields=["name", "amount", "row_status", "transfer_id"],
            order_by="creation asc",
            limit=1,
        )
        self.assertTrue(rows, f"no staged row ending {suffix!r}")
        return rows[0]

    def _next_settleable_row(self):
        """Any row still available to settle.

        Settling CONSUMES a row, so a test that hard-codes one is coupled to the alphabetical order
        unittest happens to run its siblings in. Picking dynamically keeps each test independent of
        which rows the others used.
        """
        rows = frappe.get_all(
            ROW_DOCTYPE,
            filters={
                "import_batch": self.batch.name,
                "row_status": ["not in", ["Settled", "Skipped"]],
            },
            fields=["name", "amount", "row_status", "beneficiary_name"],
            order_by="creation asc",
            limit=1,
        )
        self.assertTrue(rows, "no settleable row left in the fixture batch")
        return rows[0]

    def _make_expense(self, doctype, amount, status="Approved", description="planted by test"):
        doc = frappe.new_doc(doctype)
        doc.update({"type": self.project_type if doctype == PROJECT_EXPENSE else self.non_project_type,
                    "status": status,
                    "amount": format_amount_for(doctype, Decimal(str(amount))),
                    "description": description})
        if doctype == PROJECT_EXPENSE:
            doc.projects = self.project
        doc.insert(ignore_permissions=True)
        bucket = (
            self.project_expenses if doctype == PROJECT_EXPENSE else self.non_project_expenses
        )
        bucket.append(doc.name)
        frappe.db.commit()
        return doc.name


class TestSettleExistingExpense(SettlementFixture):
    def test_settles_an_approved_project_expense(self):
        row = self._next_settleable_row()
        expense = self._make_expense(PROJECT_EXPENSE, row["amount"])

        result = settle_expense(row["name"], PROJECT_EXPENSE, expense)

        after = frappe.db.get_value(
            PROJECT_EXPENSE, expense, ["status", "payment_ref", "payment_date", "payment_by"],
            as_dict=True,
        )
        self.assertEqual(after.status, "Paid")
        self.assertTrue(after.payment_ref)
        self.assertIsNotNone(after.payment_date)
        # payment_by is the FINALISING user -- never the statement's gateway-truncated "Added by".
        self.assertEqual(after.payment_by, frappe.session.user)
        self.assertEqual(result["settled"]["name"], expense)
        self.assertFalse(result["settled"]["created"])

    def test_the_import_row_becomes_settled_and_records_who(self):
        row = self._next_settleable_row()
        expense = self._make_expense(PROJECT_EXPENSE, row["amount"])
        settle_expense(row["name"], PROJECT_EXPENSE, expense)

        after = frappe.db.get_value(
            ROW_DOCTYPE, row["name"], ["row_status", "outcome_note", "decided_by"], as_dict=True
        )
        self.assertEqual(after.row_status, "Settled")
        self.assertIn(expense, after.outcome_note)
        self.assertEqual(after.decided_by, frappe.session.user)

    def test_a_settled_match_record_is_written_with_kind_settled(self):
        row = self._next_settleable_row()
        expense = self._make_expense(PROJECT_EXPENSE, row["amount"])
        settle_expense(row["name"], PROJECT_EXPENSE, expense)

        matches = frappe.get_all(
            MATCH_DOCTYPE,
            filters={"import_row": row["name"]},
            fields=["match_kind", "target_doctype", "target_name"],
        )
        self.assertEqual(len(matches), 1)
        self.assertEqual(matches[0]["match_kind"], "Settled")
        self.assertEqual(matches[0]["target_name"], expense)

    def test_a_requested_non_project_expense_is_now_refused_too(self):
        """⚠️ THIS TEST WAS INVERTED AT V1, and the inversion is the owner's ruling Q3.

        v2 settled a `Requested` non-project expense, reasoning that the doctype has no separate
        approval step in practice so an Approved-only pool would be empty. The owner overruled it:
        the import PAYS what someone has already approved, and "the queue is empty" is not a reason
        to pay something nobody approved. An empty pool is the correct answer when nothing is
        approved -- the 7 live `Requested` non-project expenses are approved in the expense screen
        exactly as they always were.

        The two expense doctypes now behave IDENTICALLY here; the asymmetry this test used to pin
        is gone.
        """
        row = self._next_settleable_row()
        expense = self._make_expense(NON_PROJECT_EXPENSE, row["amount"], status="Requested")
        with self.assertRaises(WrongStatusError):
            settle_expense(row["name"], NON_PROJECT_EXPENSE, expense)
        self.assertEqual(
            frappe.db.get_value(NON_PROJECT_EXPENSE, expense, "status"), "Requested"
        )


class TestRefusals(SettlementFixture):
    def test_an_already_paid_expense_is_refused_distinctly(self):
        # Someone settled it between the reviewer seeing it and confirming. A distinct error type
        # so the caller can react differently than to a never-settleable status.
        row = self._next_settleable_row()
        expense = self._make_expense(PROJECT_EXPENSE, row["amount"], status="Paid")
        with self.assertRaises(AlreadyPaidError):
            settle_expense(row["name"], PROJECT_EXPENSE, expense)

    def test_a_requested_project_expense_is_refused(self):
        row = self._next_settleable_row()
        expense = self._make_expense(PROJECT_EXPENSE, row["amount"], status="Requested")
        with self.assertRaises(WrongStatusError):
            settle_expense(row["name"], PROJECT_EXPENSE, expense)

    def test_a_differing_amount_is_refused(self):
        # Settling a Rs 5,000 expense from a Rs 50,000 transfer would record the wrong thing
        # twice over: the expense as paid, and the transfer as accounted for.
        #
        # ⚠️ THE MARGIN WAS +1 UNTIL 2026-08-06 AND IS NOW +100. Re 1 is INSIDE the rounding
        # tolerance the owner introduced that day, so the old fixture stopped testing a refusal and
        # started testing an acceptance -- while still being named "is_refused". Pinning a refusal
        # now needs an amount the window cannot reach.
        row = self._next_settleable_row()
        expense = self._make_expense(PROJECT_EXPENSE, float(row["amount"]) + 100)
        with self.assertRaises(AmountMismatchError):
            settle_expense(row["name"], PROJECT_EXPENSE, expense)

    def test_an_amount_within_the_rounding_tolerance_is_accepted(self):
        """The other half of the ruling: the bank rounds a paise amount to the whole rupee, and
        that difference must settle. Without this, 31.4% of the ledger could never be bulk-settled.
        """
        row = self._next_settleable_row()
        expense = self._make_expense(PROJECT_EXPENSE, float(row["amount"]) - 0.31)
        settle_expense(row["name"], PROJECT_EXPENSE, expense)
        self.assertEqual(frappe.db.get_value(PROJECT_EXPENSE, expense, "status"), "Paid")

    def test_a_payment_can_never_be_settled_through_this_path(self):
        """⚠️ STILL TRUE AT V2, FOR A DIFFERENT REASON, AND THE REASON IS THE POINT.

        Under v2 this refusal meant "no code path to a payment exists". V3 built that path -- but
        it lives on `settle_row`, and a caller still on the older `settle_expense` name has not
        opted into paying payments. Silently widening what an existing endpoint writes is precisely
        the surprise this feature must not produce.

        The exception class changed with the meaning: `WrongStatusError` says "the target is in a
        status that was never settleable", which is not what happened here -- the target may be
        perfectly settleable and the ENDPOINT is wrong. It is a plain ValidationError naming the
        one to use instead.
        """
        row = self._next_settleable_row()
        with self.assertRaises(frappe.ValidationError) as caught:
            settle_expense(row["name"], "Project Payments", "PAY-does-not-matter")
        self.assertNotIsInstance(caught.exception, WrongStatusError)
        self.assertIn("settle_row", str(caught.exception))

    def test_a_row_cannot_be_settled_twice(self):
        row = self._next_settleable_row()
        first = self._make_expense(PROJECT_EXPENSE, row["amount"])
        second = self._make_expense(PROJECT_EXPENSE, row["amount"])
        settle_expense(row["name"], PROJECT_EXPENSE, first)
        with self.assertRaises(frappe.ValidationError):
            settle_expense(row["name"], PROJECT_EXPENSE, second)
        # The second expense is untouched -- the refusal happened before any write.
        self.assertEqual(frappe.db.get_value(PROJECT_EXPENSE, second, "status"), "Approved")

    def test_a_skipped_row_cannot_be_settled(self):
        row = self._row("0002")  # the FAILED transfer, auto-skipped at upload
        expense = self._make_expense(PROJECT_EXPENSE, row["amount"])
        with self.assertRaises(frappe.ValidationError):
            settle_expense(row["name"], PROJECT_EXPENSE, expense)

    def test_a_failed_settlement_leaves_nothing_behind(self):
        # Savepoint isolation: the refusal must not leave a match record claiming a settlement
        # that never happened.
        #
        # ⚠️ THE MARGIN WAS +5 UNTIL 2026-08-07 AND IS NOW +100 -- THE SECOND TIME THIS FILE HAS
        # BEEN BITTEN BY IT (see `test_a_differing_amount_is_refused`, bitten at +1 in the other
        # direction on 2026-08-06). Rs 5 became the settle window's INCLUSIVE boundary, so this
        # fixture stopped provoking a refusal and started provoking an acceptance, while still
        # asserting one. A test that pins a REFUSAL by amount must sit clearly OUTSIDE the window,
        # never one step past its edge -- the edge moves.
        row = self._next_settleable_row()
        expense = self._make_expense(PROJECT_EXPENSE, float(row["amount"]) + 100)
        with self.assertRaises(AmountMismatchError):
            settle_expense(row["name"], PROJECT_EXPENSE, expense)
        self.assertEqual(frappe.db.count(MATCH_DOCTYPE, {"import_row": row["name"]}), 0)
        self.assertNotEqual(frappe.db.get_value(ROW_DOCTYPE, row["name"], "row_status"), "Settled")


class TestCreateExpense(SettlementFixture):
    def test_creates_a_project_expense_already_paid(self):
        row = self._next_settleable_row()
        result = create_expense(
            row["name"], PROJECT_EXPENSE, self.project_type, project=self.project
        )
        name = result["settled"]["name"]
        self.project_expenses.append(name)

        doc = frappe.db.get_value(
            PROJECT_EXPENSE, name,
            ["status", "amount", "payment_ref", "payment_by", "projects", "description", "comment"],
            as_dict=True,
        )
        self.assertEqual(doc.status, "Paid")
        self.assertTrue(result["settled"]["created"])
        self.assertEqual(doc.projects, self.project)
        self.assertEqual(doc.payment_by, frappe.session.user)
        # Visible provenance: the match record is durable but invisible on the expense form.
        self.assertIn(self.batch.name, doc.comment)

    def test_the_project_amount_is_stored_as_a_bare_numeric_string(self):
        # Project Expenses.amount is a Data column; 2,574 live rows hold '2935', not '2935.0'.
        row = self._next_settleable_row()
        result = create_expense(
            row["name"], PROJECT_EXPENSE, self.project_type, project=self.project
        )
        self.project_expenses.append(result["settled"]["name"])
        stored = frappe.db.get_value(PROJECT_EXPENSE, result["settled"]["name"], "amount")
        self.assertNotIn(",", stored)
        self.assertEqual(Decimal(stored), Decimal(str(row["amount"])))

    def test_creates_a_non_project_expense_without_payment_by(self):
        # Non Project Expenses has no payment_by and no vendor column at all.
        row = self._next_settleable_row()
        result = create_expense(row["name"], NON_PROJECT_EXPENSE, self.non_project_type)
        name = result["settled"]["name"]
        self.non_project_expenses.append(name)
        doc = frappe.db.get_value(
            NON_PROJECT_EXPENSE, name, ["status", "amount", "description"], as_dict=True
        )
        self.assertEqual(doc.status, "Paid")
        self.assertEqual(Decimal(str(doc.amount)), Decimal(str(row["amount"])))

    def test_the_beneficiary_lands_in_the_description_by_default(self):
        # Without it a non-project expense loses who was actually paid -- there is no vendor field.
        row = self._next_settleable_row()
        result = create_expense(row["name"], NON_PROJECT_EXPENSE, self.non_project_type)
        self.non_project_expenses.append(result["settled"]["name"])
        description = frappe.db.get_value(
            NON_PROJECT_EXPENSE, result["settled"]["name"], "description"
        )
        self.assertIn(row["beneficiary_name"], description)

    def test_a_project_type_is_refused_on_a_non_project_expense(self):
        # Nothing in the app enforces this today -- the two dialogs simply query different lists.
        row = self._next_settleable_row()
        with self.assertRaises(ExpenseTypeScopeError):
            create_expense(row["name"], NON_PROJECT_EXPENSE, self.project_type)

    def test_a_project_expense_without_a_project_is_refused(self):
        row = self._next_settleable_row()
        with self.assertRaises(WrongStatusError):
            create_expense(row["name"], PROJECT_EXPENSE, self.project_type)


class TestExpenseTypeScoping(SettlementFixture):
    def test_each_kind_only_offers_its_own_types(self):
        project_types = {t["name"] for t in get_expense_types(PROJECT_EXPENSE)}
        non_project_types = {t["name"] for t in get_expense_types(NON_PROJECT_EXPENSE)}
        self.assertTrue(project_types)
        self.assertTrue(non_project_types)
        for name in project_types:
            self.assertTrue(frappe.db.get_value("Expense Type", name, "project"))
        for name in non_project_types:
            self.assertTrue(frappe.db.get_value("Expense Type", name, "non_project"))


class TestFormatAmountFor(unittest.TestCase):
    def test_project_expenses_get_a_bare_string(self):
        self.assertEqual(format_amount_for(PROJECT_EXPENSE, Decimal("5000")), "5000")
        self.assertEqual(format_amount_for(PROJECT_EXPENSE, Decimal("5000.00")), "5000")
        self.assertEqual(format_amount_for(PROJECT_EXPENSE, Decimal("351.72")), "351.72")

    def test_non_project_expenses_get_a_number(self):
        self.assertIsInstance(format_amount_for(NON_PROJECT_EXPENSE, Decimal("5000")), float)


if __name__ == "__main__":
    unittest.main()
