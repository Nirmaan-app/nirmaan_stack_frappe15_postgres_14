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

import inspect
import unittest
from dataclasses import replace
from decimal import Decimal
from unittest.mock import patch

import frappe

from nirmaan_stack.api.outflow_import.expenses import (
    _guard_is_a_debit,
    create_expense,
    get_expense_types,
    settle_expense,
    settle_row,
    settle_row_partial,
)
from nirmaan_stack.api.outflow_import.review import MATCH_DOCTYPE, ROW_DOCTYPE
from nirmaan_stack.services.outflow_import.ledgers import PAYMENT_DOCTYPE
from nirmaan_stack.services.outflow_import.partial_settle import INTENT_PART_PAYMENT
from nirmaan_stack.services.outflow_import.status import (
    ORIGIN_ACCEPTED,
    ORIGIN_NO_SUGGESTION,
    ORIGIN_OVERRIDDEN,
    is_received_direction,
)
from nirmaan_stack.api.outflow_import.upload import BATCH_DOCTYPE, ROW_DOCTYPE, _stage_batch
from nirmaan_stack.services.outflow_import.parser import parse_statement
from nirmaan_stack.services.outflow_import.settle import (
    NON_PROJECT_EXPENSE,
    PROJECT_EXPENSE,
    AlreadyPaidError,
    AmountMismatchError,
    ExpenseSettlementError,
    ExpenseTypeScopeError,
    WrongStatusError,
    create_expense_from_row,
    create_non_project_receipt_from_row,
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
        # X1 moved the expense settle onto `doc.save()`, so each settlement now mints a Version row
        # on a `track_changes` doctype. This suite writes to the LIVE database; its audit residue
        # is purged with the expenses it describes.
        for doctype, names in (
            (PROJECT_EXPENSE, cls.project_expenses),
            (NON_PROJECT_EXPENSE, cls.non_project_expenses),
        ):
            if names:
                frappe.db.delete("Version", {"ref_doctype": doctype, "docname": ["in", names]})
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

    def _origin_and_basis(self, row_name):
        m = frappe.get_all(
            MATCH_DOCTYPE, filters={"import_row": row_name},
            fields=["settlement_origin", "match_basis"],
        )[0]
        stamped = frappe.db.get_value(ROW_DOCTYPE, row_name, "settlement_origin")
        return m["settlement_origin"], m["match_basis"], stamped

    def test_a_HAND_FOUND_settlement_says_so_on_both_tiers(self):
        """⚠️ `match_basis` WAS HARDCODED TO "Manual" ON EVERY SETTLEMENT until slice Q1, so the
        record meaning MONEY WAS WRITTEN claimed a person had found all 849 of them when the
        machine had found 843. This fixture's rows carry no suggestion, so Manual is the TRUE
        answer here -- which is exactly why the next test matters more than this one."""
        row = self._next_settleable_row()
        expense = self._make_expense(PROJECT_EXPENSE, row["amount"])
        settle_expense(row["name"], PROJECT_EXPENSE, expense)

        origin, basis, stamped = self._origin_and_basis(row["name"])
        self.assertEqual(origin, ORIGIN_NO_SUGGESTION)
        self.assertEqual(basis, "Manual")
        self.assertEqual(stamped, ORIGIN_NO_SUGGESTION, "the row's copy must agree")

    def test_ACCEPTING_the_matchers_pick_records_the_TIER_not_Manual(self):
        """The case the old code got wrong on 843 of 849 rows."""
        row = self._next_settleable_row()
        expense = self._make_expense(PROJECT_EXPENSE, row["amount"])
        frappe.db.set_value(ROW_DOCTYPE, row["name"], {
            "suggested_doctype": PROJECT_EXPENSE,
            "suggested_name": expense,
            "match_basis": "account+IFSC",
        }, update_modified=False)
        frappe.db.commit()
        settle_expense(row["name"], PROJECT_EXPENSE, expense)

        origin, basis, stamped = self._origin_and_basis(row["name"])
        self.assertEqual(origin, ORIGIN_ACCEPTED)
        self.assertEqual(basis, "account+IFSC")
        self.assertEqual(stamped, ORIGIN_ACCEPTED)

    def test_OVERRIDING_the_matchers_pick_keeps_the_tier_and_says_overridden(self):
        """⚠️ TWO DIFFERENT QUESTIONS SIDE BY SIDE. The matcher DID find something on a strong tier
        and the reviewer still chose otherwise, so the tier stays `account+IFSC` while the origin
        says overridden. Collapsing them would lose which of the two happened."""
        row = self._next_settleable_row()
        chosen = self._make_expense(PROJECT_EXPENSE, row["amount"])
        frappe.db.set_value(ROW_DOCTYPE, row["name"], {
            "suggested_doctype": PROJECT_EXPENSE,
            "suggested_name": "SOMETHING-ELSE",
            "match_basis": "account+IFSC",
        }, update_modified=False)
        frappe.db.commit()
        settle_expense(row["name"], PROJECT_EXPENSE, chosen)

        origin, basis, _ = self._origin_and_basis(row["name"])
        self.assertEqual(origin, ORIGIN_OVERRIDDEN)
        self.assertEqual(basis, "account+IFSC")

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


class TestTheDirectionGuard(SettlementFixture):
    """A bank CREDIT can never spend money -- `expenses._guard_is_a_debit`.

    ⚠️ THE BUG THIS CLASS EXISTS FOR IS INVISIBLE ONCE IT HAPPENS. `_load_settleable_row` checked
    only `row_status`, so a Credit row -- money the bank put INTO the account -- could settle an
    approved `Project Payment` or mint a Paid expense. The record goes Paid, the transfer goes
    Settled, and the two figures agree; only the DIRECTION is wrong and no screen states it. There
    is no error to notice and nothing to reconcile against, which is why every refusal here is
    pinned with the write ALSO asserted to have not happened.

    ⚠️ THE FIXTURE IS A CASHFREE EXPORT, WHOSE ROWS CARRY NO DIRECTION AT ALL. That is the whole
    reason the guard is a POSITIVE test: a blank means "the statement did not say", never "this is a
    receipt", and refusing blanks would refuse every gateway row the feature was built for. The
    credit cases below therefore set the column deliberately, and restore it, so the refused row
    goes back into the pool the sibling tests draw from.
    """

    def _as_credit(self, row_name):
        """Make one staged row a bank credit, and put it back as it was afterwards.

        ⚠️ RESTORED IN A CLEANUP BECAUSE A REFUSED ROW IS NOT CONSUMED. It stays at the head of
        `_next_settleable_row`'s queue, so leaving it `Credit` would silently refuse the next test
        in this class as well -- and that test would then pass for the wrong reason.
        """
        previous = frappe.db.get_value(ROW_DOCTYPE, row_name, "direction") or ""

        def _restore():
            frappe.db.set_value(
                ROW_DOCTYPE, row_name, "direction", previous, update_modified=False
            )
            frappe.db.commit()

        self.addCleanup(_restore)
        frappe.db.set_value(ROW_DOCTYPE, row_name, "direction", "Credit", update_modified=False)
        frappe.db.commit()

    # --- the three money-out doors -------------------------------------------------------------

    def test_a_credit_can_never_settle_an_approved_expense(self):
        """⚠️ THE SHARPEST OF THE THREE: everything else about this settlement is valid. The expense
        is Approved, the amount matches to the paise, the row is settleable. Without the guard this
        call SUCCEEDS and books a deposit as a payment out."""
        row = self._next_settleable_row()
        expense = self._make_expense(PROJECT_EXPENSE, row["amount"])
        self._as_credit(row["name"])

        with self.assertRaises(ExpenseSettlementError) as caught:
            settle_row(row["name"], PROJECT_EXPENSE, expense)

        # ⚠️ THE REFUSAL NAMES THE RULE IT BROKE (the D1 register). A bare "invalid" would leave the
        # reviewer with a row they cannot dispose of and no idea the two credit routes exist.
        message = str(caught.exception).lower()
        self.assertIn("debit", message)
        self.assertIn("credit", message)
        # Nothing moved: not the expense, not the row, not a match record claiming a settlement.
        self.assertEqual(frappe.db.get_value(PROJECT_EXPENSE, expense, "status"), "Approved")
        self.assertNotEqual(
            frappe.db.get_value(ROW_DOCTYPE, row["name"], "row_status"), "Settled"
        )
        self.assertEqual(frappe.db.count(MATCH_DOCTYPE, {"import_row": row["name"]}), 0)

    def test_a_credit_can_never_settle_a_payment(self):
        """⚠️ THE TARGET DELIBERATELY DOES NOT EXIST, and that is the assertion. The guard runs
        before the payment is ever read, so a credit is refused for BEING a credit rather than for
        anything about what it was aimed at. Unguarded, this call reaches `frappe.get_doc` and
        raises a not-found instead -- a different type, which is what makes this test red."""
        row = self._next_settleable_row()
        self._as_credit(row["name"])

        with self.assertRaises(ExpenseSettlementError) as caught:
            settle_row(row["name"], PAYMENT_DOCTYPE, "PAY-no-such-payment")
        self.assertIn("credit", str(caught.exception).lower())
        self.assertEqual(frappe.db.count(MATCH_DOCTYPE, {"import_row": row["name"]}), 0)

    def test_a_credit_can_never_create_a_new_expense(self):
        """The create path matters at least as much as the settle. A settle at least has a record
        somebody approved in front of it; this one mints a `Paid` expense from the bank row alone,
        so an unguarded credit invents a brand-new payment-out document for money that arrived."""
        row = self._next_settleable_row()
        self._as_credit(row["name"])

        # ⚠️ NOT `assertRaises`, BECAUSE THE FAILING CASE HERE WRITES TO THE LIVE DATABASE. Against
        # unguarded code this call SUCCEEDS and mints a real `Project Expenses` document; a bare
        # `assertRaises` would fail and leave it behind, unowned by `tearDownClass`. Catching the
        # success explicitly lets the test register the row for purging and then fail honestly.
        try:
            created = create_expense(
                row["name"], PROJECT_EXPENSE, self.project_type, project=self.project
            )
        except ExpenseSettlementError:
            pass
        else:
            self.project_expenses.append(created["settled"]["name"])
            self.fail("a credit was allowed to create a Paid expense")

        self.assertNotEqual(
            frappe.db.get_value(ROW_DOCTYPE, row["name"], "row_status"), "Settled"
        )
        self.assertEqual(frappe.db.count(MATCH_DOCTYPE, {"import_row": row["name"]}), 0)

    def test_a_credit_can_never_be_partially_settled_either(self):
        """The third door, and the one that also performs surgery on a PO's terms -- an unguarded
        credit would leave a split sanction behind it as well as a wrongly-Paid record.

        ⚠️ THE MESSAGE IS ASSERTED, NOT JUST THE TYPE. Unguarded, this call reaches
        `_assert_partially_settleable` and is refused there for a DIFFERENT reason (the payment does
        not exist) -- a refusal that would satisfy a type-only assertion on the base ValidationError
        and quietly turn this into a test of nothing."""
        row = self._next_settleable_row()
        self._as_credit(row["name"])

        with self.assertRaises(ExpenseSettlementError) as caught:
            settle_row_partial(row["name"], "PAY-no-such-payment", INTENT_PART_PAYMENT)
        self.assertIn("credit", str(caught.exception).lower())
        self.assertEqual(frappe.db.count(MATCH_DOCTYPE, {"import_row": row["name"]}), 0)

    # --- what must still get through -----------------------------------------------------------

    def test_a_blank_direction_still_settles(self):
        """⚠️ THE HALF OF THE RULE THAT IS EASIEST TO BREAK BY "TIDYING" IT. Cashfree and Cashbook
        state no direction at all; a guard that refused anything not explicitly `Debit` would refuse
        every row from both sources -- the two the feature was built for."""
        row = self._next_settleable_row()
        # ⚠️ THE BLANK IS STATED, NOT INHERITED FROM THE FIXTURE. This test first ASSERTED that the
        # Cashfree fixture stores no direction; it stores "Debit". So the assertion failed while the
        # guard was working perfectly -- and, worse, had the fixture happened to agree, the blank
        # case this test exists for would have been covered only by luck, and would silently stop
        # being covered the day the fixture changed. A fixture's incidental value is not the fact
        # under test: state the input, exactly as `test_a_stated_debit_settles` below does.
        frappe.db.set_value(ROW_DOCTYPE, row["name"], "direction", "", update_modified=False)
        frappe.db.commit()
        expense = self._make_expense(PROJECT_EXPENSE, row["amount"])
        settle_row(row["name"], PROJECT_EXPENSE, expense)
        self.assertEqual(frappe.db.get_value(PROJECT_EXPENSE, expense, "status"), "Paid")

    def test_a_stated_debit_settles(self):
        row = self._next_settleable_row()
        frappe.db.set_value(ROW_DOCTYPE, row["name"], "direction", "Debit", update_modified=False)
        frappe.db.commit()
        expense = self._make_expense(PROJECT_EXPENSE, row["amount"])
        settle_row(row["name"], PROJECT_EXPENSE, expense)
        self.assertEqual(frappe.db.get_value(PROJECT_EXPENSE, expense, "status"), "Paid")


class TestTheGuardIsOnePredicate(unittest.TestCase):
    """⚠️ THE GUARD IS THE EXACT NEGATION OF `status.is_received_direction`, NOT A SECOND RULE.

    That predicate is the single POSITIVE test partitioning every settled row into `Received` and
    `Paid`. Re-spelling `direction == "Credit"` in the endpoint would be a second copy free to
    drift, and the drift presents as money settled on the debit side and then reported under
    Received -- two halves of one feature disagreeing about which way the money went. Pinning them
    against each other is what makes that impossible rather than merely unlikely.
    """

    def test_it_refuses_exactly_what_the_predicate_calls_received(self):
        for direction in ("", "   ", None, "Debit", "Credit", " Credit "):
            with self.subTest(direction=direction):
                refused = False
                try:
                    _guard_is_a_debit({"direction": direction})
                except frappe.ValidationError:
                    refused = True
                self.assertEqual(refused, is_received_direction(direction))


class TestTheAmountIsCorrectedToTheBank(SettlementFixture):
    """Slice X1 on the EXPENSE ledgers -- and on the `set_value` -> `doc.save()` switch it forced.

    ⚠️ THIS CLASS IS THE GATE ON THE RISKIEST CHANGE IN X1. Auditing an amount rewrite meant the
    expense write could no longer go through `frappe.db.set_value`, which skips the document
    lifecycle -- no `validate`, no `on_update`, and NO VERSION. Moving to `doc.save()` buys the
    audit, fixes a hook that had never fired on this path, and wakes a committer that would
    otherwise break the per-row savepoint. All three are pinned below.
    """

    def test_a_project_expense_short_by_paise_takes_the_bank_amount(self):
        row = self._next_settleable_row()
        expense = self._make_expense(PROJECT_EXPENSE, float(row["amount"]) - 0.31)

        settle_expense(row["name"], PROJECT_EXPENSE, expense)

        after = frappe.db.get_value(
            PROJECT_EXPENSE, expense, ["amount", "status"], as_dict=True
        )
        self.assertEqual(after.status, "Paid")
        self.assertEqual(Decimal(str(after.amount)), Decimal(str(row["amount"])))

    def test_the_corrected_project_amount_is_still_a_bare_numeric_string(self):
        """⚠️ `Project Expenses.amount` IS A DATA COLUMN and 2,574 live rows hold bare numeric
        strings. Writing a float through the rewrite would store '5000.0' beside every neighbour's
        '5000' -- the numeric CAST the candidate query relies on would still work, which is exactly
        why this drift would go unnoticed. `format_amount_for` is what prevents it, on the rewrite
        as much as on a create."""
        row = self._next_settleable_row()
        expense = self._make_expense(PROJECT_EXPENSE, float(row["amount"]) - 1)

        settle_expense(row["name"], PROJECT_EXPENSE, expense)

        stored = frappe.db.get_value(PROJECT_EXPENSE, expense, "amount")
        self.assertIsInstance(stored, str)
        self.assertNotIn(",", stored)
        self.assertEqual(Decimal(stored), Decimal(str(row["amount"])))

    def test_a_non_project_expense_takes_it_too_as_a_number(self):
        """The other ledger, and the other storage shape -- `Non Project Expenses.amount` is real
        Currency. The two expense doctypes are NOT twins and this is one of the three ways."""
        row = self._next_settleable_row()
        expense = self._make_expense(NON_PROJECT_EXPENSE, float(row["amount"]) - 0.68)

        settle_expense(row["name"], NON_PROJECT_EXPENSE, expense)

        stored = frappe.db.get_value(NON_PROJECT_EXPENSE, expense, "amount")
        self.assertEqual(Decimal(str(stored)), Decimal(str(row["amount"])))

    def test_the_bank_OVERPAYING_also_rewrites(self):
        """The deliberate half of the ruling: the record takes the LARGER figure, so this import can
        record spending above what was approved. Owner ruling 2026-08-09, consequence stated."""
        row = self._next_settleable_row()
        expense = self._make_expense(PROJECT_EXPENSE, float(row["amount"]) + 4)

        settle_expense(row["name"], PROJECT_EXPENSE, expense)

        self.assertEqual(
            Decimal(frappe.db.get_value(PROJECT_EXPENSE, expense, "amount")),
            Decimal(str(row["amount"])),
        )

    def test_an_equal_amount_is_left_exactly_as_it_was(self):
        row = self._next_settleable_row()
        expense = self._make_expense(PROJECT_EXPENSE, row["amount"])
        before = frappe.db.get_value(PROJECT_EXPENSE, expense, "amount")

        settle_expense(row["name"], PROJECT_EXPENSE, expense)

        self.assertEqual(frappe.db.get_value(PROJECT_EXPENSE, expense, "amount"), before)

    def test_the_settle_now_goes_through_the_document_lifecycle_at_all(self):
        """⚠️ THE PROXY FOR THE WHOLE SWITCH. A `set_value` write mints no Version however the
        doctype is configured, so a Version row here proves the settle went through `doc.save()`.
        The CEO-Hold cashflow hook rides the same lifecycle -- it had never fired on this path, and
        it does now."""
        row = self._next_settleable_row()
        expense = self._make_expense(PROJECT_EXPENSE, float(row["amount"]) - 0.9)

        settle_expense(row["name"], PROJECT_EXPENSE, expense)

        versions = frappe.get_all(
            "Version",
            filters={"ref_doctype": PROJECT_EXPENSE, "docname": expense},
            fields=["data"],
        )
        self.assertTrue(versions, "the settle wrote no Version -- it is still bypassing doc.save()")
        self.assertTrue(any("amount" in (v.get("data") or "") for v in versions))

    def test_a_failure_AFTER_the_expense_save_rolls_the_expense_back(self):
        """⚠️ THE SAVEPOINT REGRESSION, AND THE REASON IT HAD TO BE WRITTEN FOR X1.

        The pre-existing isolation test provokes a refusal in the amount GUARD, which throws before
        anything is saved -- so it cannot see a commit that happens DURING the save. `doc.save()`
        now fires hooks, one of which can reach `frappe.db.commit()`, and a commit inside the
        caller's savepoint makes the rollback a silent no-op. Forcing the failure AFTER the save is
        the only arrangement that catches it: if anything committed, the expense stays `Paid` here.
        """
        row = self._next_settleable_row()
        expense = self._make_expense(PROJECT_EXPENSE, float(row["amount"]) - 0.31)

        with patch(
            "nirmaan_stack.api.outflow_import.expenses._record_settlement",
            side_effect=RuntimeError("forced after the expense was saved"),
        ):
            with self.assertRaises(RuntimeError):
                settle_expense(row["name"], PROJECT_EXPENSE, expense)

        after = frappe.db.get_value(
            PROJECT_EXPENSE, expense, ["status", "amount"], as_dict=True
        )
        self.assertEqual(after.status, "Approved", "the settle committed inside its own savepoint")
        self.assertEqual(Decimal(after.amount), Decimal(str(float(row["amount"]) - 0.31)))
        self.assertEqual(frappe.db.count(MATCH_DOCTYPE, {"import_row": row["name"]}), 0)
        self.assertNotEqual(
            frappe.db.get_value(ROW_DOCTYPE, row["name"], "row_status"), "Settled"
        )

    def test_the_request_flag_does_not_leak_past_the_save(self):
        """`_outflow_import_write` restores the previous value in a `finally`. A leaked flag would
        silently suppress a CEO-Hold notification commit for unrelated later work in the same
        request -- the kind of bug that surfaces as "notifications stopped, sometimes"."""
        row = self._next_settleable_row()
        expense = self._make_expense(PROJECT_EXPENSE, row["amount"])

        settle_expense(row["name"], PROJECT_EXPENSE, expense)

        self.assertFalse(frappe.flags.get("outflow_import_settling"))


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


class TestTheDebitPathIsStillCLOSEDToASignedAmount(SettlementFixture):
    """⚠️ SLICE B7 OPENED A SIGNED WRITE IN `settle.py`. THESE PIN THAT IT DID NOT REACH HERE.

    B7 records a bank CREDIT that belongs to no project as a NEGATIVE `Non Project Expense`
    (`create_non_project_receipt_from_row`). `create_expense_from_row` -- the DEBIT path, and a live
    one -- keeps its `amount <= 0` guard exactly as it was, because for a debit that guard is
    correct: a transfer OUT of zero or less is not a spend.

    The safety here is structural rather than promised, and each half is pinned below:
      * the two functions are SEPARATE, so there is no mode flag whose wrong branch is one boolean
        away from turning every debit signed;
      * the signed one takes NO `doctype` argument, so a credit can never be written as a negative
        `Project Expense` -- whose `amount` is a **Data** column and whose project / vendor /
        payment_by fields mean nothing on a receipt.
    """

    def _row_at(self, amount):
        row = self._next_settleable_row()
        frappe.db.set_value(ROW_DOCTYPE, row["name"], "amount", amount, update_modified=False)
        frappe.db.commit()
        return row

    def test_a_zero_amount_row_is_still_refused(self):
        row = self._row_at(0)
        with self.assertRaises(AmountMismatchError):
            create_expense(row["name"], PROJECT_EXPENSE, self.project_type, project=self.project)

    def test_a_NEGATIVE_amount_row_is_still_refused(self):
        """The case B7 makes worth asserting rather than assuming.

        A staged row's `amount` is the positive MAGNITUDE on every source by design (ADR-0016
        rejected a signed amount column outright), so this shape should not occur -- which is
        exactly why the guard has to stay: if one ever did, this path must refuse it rather than
        create an expense that quietly reads as income.
        """
        row = self._row_at(-2500)
        with self.assertRaises(AmountMismatchError):
            create_expense(row["name"], PROJECT_EXPENSE, self.project_type, project=self.project)
        self.assertFalse(frappe.db.exists(MATCH_DOCTYPE, {"import_row": row["name"]}))

    def test_a_negative_amount_is_refused_on_the_NON_PROJECT_ledger_too(self):
        """The ledger B7 writes signed. Reaching it through the DEBIT endpoint must still refuse."""
        row = self._row_at(-2500)
        with self.assertRaises(AmountMismatchError):
            create_expense(row["name"], NON_PROJECT_EXPENSE, self.non_project_type)

    def test_the_signed_writer_is_a_separate_function_that_cannot_be_told_a_doctype(self):
        """A signature pin, because this is where "a credit never becomes a negative Project
        Expense" actually lives. Not a comment: an argument nobody can pass is a guarantee, and a
        `doctype` parameter added here would silently demote it to a convention."""
        params = inspect.signature(create_non_project_receipt_from_row).parameters
        self.assertNotIn("doctype", params)
        # And `direction` is REQUIRED on it -- the sibling `create_inflow_from_row` tolerates
        # `None`, which would be an open door where the direction chooses a SIGN.
        self.assertIs(params["direction"].default, inspect.Parameter.empty)
        # The debit writer still takes one, and still guards the amount. Two writers, two rules.
        self.assertIn("doctype", inspect.signature(create_expense_from_row).parameters)


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


class TestTheStatementIsAttachedToWhatItSettled(SettlementFixture):
    """The expense side of the 2026-08-10 attachment ruling.

    The rule itself -- blank-only, never overwrite -- is proven exhaustively on the payment path in
    `test_settle_payment`, against the same shared `apply_statement_attachment`. What these two
    cases prove is the WIRING on this side: that `expenses.settle_row` and `expenses.create_expense`
    both resolve the batch's `source_file` and hand it down. A rule that is right and never passed
    an argument writes nothing at all.
    """

    STATEMENT = "/private/files/test-statement.csv"

    def test_a_settled_expense_takes_the_statement(self):
        row = self._next_settleable_row()
        expense = self._make_expense(PROJECT_EXPENSE, row["amount"])
        settle_expense(row["name"], PROJECT_EXPENSE, expense)
        self.assertEqual(
            frappe.db.get_value(PROJECT_EXPENSE, expense, "payment_attachment"),
            self.STATEMENT,
        )

    def test_a_created_expense_is_born_carrying_the_statement(self):
        """A brand-new expense has no proof of its own, so the blank-only rule always lets this
        land -- which is the point: a record created FROM a statement should carry that statement."""
        row = self._next_settleable_row()
        result = create_expense(
            row["name"], PROJECT_EXPENSE, self.project_type, project=self.project
        )
        name = result["settled"]["name"]
        self.project_expenses.append(name)
        self.assertEqual(
            frappe.db.get_value(PROJECT_EXPENSE, name, "payment_attachment"), self.STATEMENT
        )


class TestFormatAmountFor(unittest.TestCase):
    def test_project_expenses_get_a_bare_string(self):
        self.assertEqual(format_amount_for(PROJECT_EXPENSE, Decimal("5000")), "5000")
        self.assertEqual(format_amount_for(PROJECT_EXPENSE, Decimal("5000.00")), "5000")
        self.assertEqual(format_amount_for(PROJECT_EXPENSE, Decimal("351.72")), "351.72")

    def test_non_project_expenses_get_a_number(self):
        self.assertIsInstance(format_amount_for(NON_PROJECT_EXPENSE, Decimal("5000")), float)


if __name__ == "__main__":
    unittest.main()
