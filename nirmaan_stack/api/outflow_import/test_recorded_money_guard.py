# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Link, Allocate and Create expense refuse a line whose money is already recorded (#1260).

    bench --site localhost run-tests --app nirmaan_stack \
        --module nirmaan_stack.api.outflow_import.test_recorded_money_guard

Each endpoint asks the match run's own question for the line's source -- Cashfree: the exact
reference on a Paid payment or expense; ICICI: the contains-guard -- even when no match run ever
ran. A line the run would SKIP is refused and nothing is written; a line the run would leave
MISMATCHED naming a record is refused unless the call confirms. The credit endpoints are pinned in
`test_inflows.TestTheDuplicateGuards`.

⚠️ RUNS AGAINST THE LIVE SITE DATABASE. Every record is inserted raw (no hooks), tracked, and purged
in `tearDown`, together with the Versions and Files the settles mint.

⚠️ THE PLANTED "ALREADY RECORDED" RECORD IS AN EXPENSE WHEREVER THE TARGET IS A PAYMENT. A Paid
payment carrying the reference would be refused by `settle_payment`'s own UTR guard first, and the
test would prove that guard rather than this one.
"""

import json
import os
import unittest
from datetime import datetime
from decimal import Decimal

import frappe

from nirmaan_stack.api.outflow_import.link_lines import link_rows_to_expense
from nirmaan_stack.api.outflow_import.expenses import (
    MoneyAlreadyRecordedError,
    RecordedMoneyNeedsConfirmationError,
    allocate_row,
    check_partial_settle,
    create_expense,
    settle_row,
    settle_row_partial,
)
from nirmaan_stack.api.outflow_import.test_settle_payment import (
    PartialSettlementFixture,
    PaymentSettlementFixture,
)
from nirmaan_stack.services.outflow_import.candidates import load_recorded_by_contains
from nirmaan_stack.services.outflow_import.contains_guard import match_surface
from nirmaan_stack.services.outflow_import.normalize import normalize_reference
from nirmaan_stack.services.outflow_import.partial_settle import INTENT_PART_PAYMENT
from nirmaan_stack.api.outflow_import.test_settle_payment import SETTLEABLE
from nirmaan_stack.services.outflow_import.settle import NON_PROJECT_EXPENSE
from nirmaan_stack.services.outflow_import.status import (
    ROW_MISMATCHED,
    ROW_PARTIALLY_ALLOCATED,
    ROW_SETTLED,
)

MATCH_DOCTYPE = "Outflow Row Match"
ROW_DOCTYPE = "Outflow Import Row"
BATCH_DOCTYPE = "Outflow Import Batch"
PAYMENT = "Project Payments"
CASHFREE = "Cashfree"
ICICI = "ICICI Bank Statement"
LINE_DATE = datetime(2026, 9, 1, 11, 0, 0)


class RecordedMoneyFixture(PaymentSettlementFixture):
    """Lines staged directly, records planted raw, per test.

    `setUp` is replaced, not extended: the parent stages a whole statement and runs a match per
    test, and these tests must hold WITHOUT a match run. Its `tearDown` still purges the batches,
    payments, POs and the allocation project; this class adds the expenses it plants and creates.
    """

    def setUp(self):
        self.batches, self.payments, self.pos = [], [], []
        self.non_project_expenses = []
        self.project = frappe.db.get_value("Projects", {}, "name")
        self.non_project_type = frappe.db.get_value(
            "Expense Type", {"non_project": 1, "project": 0}, "name"
        )

    def tearDown(self):
        if self.non_project_expenses:
            names = self.non_project_expenses
            frappe.db.delete("Version", {"ref_doctype": NON_PROJECT_EXPENSE, "docname": ["in", names]})
            frappe.db.delete(
                "File", {"attached_to_doctype": NON_PROJECT_EXPENSE, "attached_to_name": ["in", names]}
            )
            for name in names:
                frappe.db.delete(NON_PROJECT_EXPENSE, {"name": name})
        super().tearDown()

    # --- arrange --------------------------------------------------------------------------------

    def _line(self, *, source, amount, direction="Debit", reference=None, narration="",
              reference_id=""):
        """One staged line in its own batch of `source`, still `Mismatched` -- no match run."""
        batch = frappe.new_doc(BATCH_DOCTYPE)
        batch.update({"source": source, "status": "In Review", "source_file": self.ALLOC_STATEMENT})
        batch.insert(ignore_permissions=True)
        self.batches.append(batch.name)

        transfer_id = f"rmg-{frappe.generate_hash(length=10)}"
        reference = reference if reference is not None else transfer_id
        row = frappe.new_doc(ROW_DOCTYPE)
        row.update(
            {
                "import_batch": batch.name,
                "source": source,
                "transfer_id": transfer_id,
                "amount": float(amount),
                "direction": direction,
                "bank_reference_no": reference,
                "normalized_reference": normalize_reference(reference),
                "remarks": narration,
                "reference_id": reference_id,
                "added_on": LINE_DATE,
                "status_raw": "SUCCESS",
                "row_status": ROW_MISMATCHED,
            }
        )
        row.insert(ignore_permissions=True)
        frappe.db.commit()
        return row.name

    def _non_project_expense(self, *, amount, status, payment_ref=None):
        """A `Non Project Expenses` row, raw: no hooks, no project, nothing else moves."""
        name = f"TEST-RMG-{frappe.generate_hash(length=12)}"
        frappe.db.sql(
            """
            INSERT INTO "tabNon Project Expenses"
                (name, creation, modified, modified_by, owner, docstatus, idx,
                 amount, status, description, type, payment_ref, payment_date)
            VALUES (%s, NOW(), NOW(), %s, %s, 0, 0, %s, %s, %s, %s, %s, %s)
            """,
            (name, "Administrator", "Administrator", float(amount), status,
             "Recorded-money guard test", self.non_project_type, payment_ref,
             LINE_DATE.date() if status == "Paid" else None),
        )
        self.non_project_expenses.append(name)
        frappe.db.commit()
        return name

    def _slip(self, row, expense, amount, *, kind="Settled"):
        """One live `Settled` slip: the link an earlier import wrote between `row` and `expense`."""
        staged = frappe.db.get_value(
            ROW_DOCTYPE, row, ["import_batch", "transfer_id"], as_dict=True
        )
        match = frappe.new_doc(MATCH_DOCTYPE)
        match.update(
            {
                "import_row": row,
                "import_batch": staged.import_batch,
                "transfer_id": staged.transfer_id,
                "target_doctype": NON_PROJECT_EXPENSE,
                "target_name": expense,
                "target_amount": float(amount),
                "match_kind": "Settled",
                "match_basis": "Manual",
            }
        )
        match.insert(ignore_permissions=True)
        if kind != "Settled":
            # The controller refuses `Reversed` as an INITIAL state -- a row here means money was
            # written, and reversal is a later stamp. So stamp it, exactly as Unreconcile does.
            frappe.db.set_value(MATCH_DOCTYPE, match.name, "match_kind", kind, update_modified=False)
        frappe.db.commit()
        return match.name

    @staticmethod
    def _narration():
        # Only the salted piece is an eligible token (6+ characters with a digit), so no live
        # record can hit this line by accident.
        return f"MMT/IMPS/{frappe.generate_hash(length=12).upper()}9/TEST VENDOR"

    # --- assert ---------------------------------------------------------------------------------

    def _assert_nothing_written(self, row, *, status=ROW_MISMATCHED, approved=()):
        self.assertEqual(frappe.db.get_value(ROW_DOCTYPE, row, "row_status"), status)
        self.assertEqual(frappe.db.count(MATCH_DOCTYPE, {"import_row": row}), 0)
        for doctype, name in approved:
            self.assertEqual(frappe.db.get_value(doctype, name, "status"), SETTLEABLE)

    def _created_from(self, row):
        """Non Project Expenses carrying what a create from `row` would write as `payment_ref` --
        counted by that reference rather than across the live table, which other writers share."""
        staged = frappe.db.get_value(ROW_DOCTYPE, row, ["bank_reference_no", "remarks"], as_dict=True)
        refs = [r for r in (staged.bank_reference_no, staged.remarks) if r]
        return frappe.db.count(NON_PROJECT_EXPENSE, {"payment_ref": ["in", refs]})


class TestLinkRefusesRecordedMoney(RecordedMoneyFixture):
    """`settle_row` -- Link a line to an Approved record."""

    def test_the_worked_example_a_line_paid_on_one_expense_cannot_link_another(self):
        """#1260's own example: a Cashfree Rs 5,000 line already Paid on one expense must not be
        Linked to a different Approved Rs 5,000 expense."""
        row = self._line(source=CASHFREE, amount="5000")
        reference = frappe.db.get_value(ROW_DOCTYPE, row, "bank_reference_no")
        paid = self._non_project_expense(amount="5000", status="Paid", payment_ref=reference)
        approved = self._non_project_expense(amount="5000", status=SETTLEABLE)

        with self.assertRaises(MoneyAlreadyRecordedError) as caught:
            settle_row(row, NON_PROJECT_EXPENSE, approved)

        self.assertIn("Non Project Expense", str(caught.exception))
        self.assertIn("Recorded-money guard test", str(caught.exception))
        self._assert_nothing_written(row, approved=[(NON_PROJECT_EXPENSE, approved)])
        self.assertEqual(frappe.db.get_value(NON_PROJECT_EXPENSE, paid, "status"), "Paid")

    def test_an_amount_off_record_is_refused_unless_confirmed(self):
        row = self._line(source=CASHFREE, amount="5000")
        reference = frappe.db.get_value(ROW_DOCTYPE, row, "bank_reference_no")
        self._non_project_expense(amount="7000", status="Paid", payment_ref=reference)
        approved = self._non_project_expense(amount="5000", status=SETTLEABLE)

        with self.assertRaises(RecordedMoneyNeedsConfirmationError):
            settle_row(row, NON_PROJECT_EXPENSE, approved)
        self._assert_nothing_written(row, approved=[(NON_PROJECT_EXPENSE, approved)])

        settle_row(row, NON_PROJECT_EXPENSE, approved, confirm_mismatch=1)
        self.assertEqual(frappe.db.get_value(ROW_DOCTYPE, row, "row_status"), ROW_SETTLED)
        self.assertEqual(frappe.db.get_value(NON_PROJECT_EXPENSE, approved, "status"), "Paid")

    def test_an_icici_line_whose_reference_sits_in_the_narration_cannot_link(self):
        narration = self._narration()
        row = self._line(source=ICICI, amount="5000", narration=narration)
        utr = narration.split("/")[2]
        self._non_project_expense(amount="5000", status="Paid", payment_ref=f"{utr} ICICI")
        approved = self._non_project_expense(amount="5000", status=SETTLEABLE)

        with self.assertRaises(MoneyAlreadyRecordedError):
            settle_row(row, NON_PROJECT_EXPENSE, approved)
        self._assert_nothing_written(row, approved=[(NON_PROJECT_EXPENSE, approved)])

    def test_a_clean_line_still_links(self):
        row = self._line(source=CASHFREE, amount="5000")
        approved = self._non_project_expense(amount="5000", status=SETTLEABLE)

        settle_row(row, NON_PROJECT_EXPENSE, approved)

        self.assertEqual(frappe.db.get_value(ROW_DOCTYPE, row, "row_status"), ROW_SETTLED)


class TestPartialSettleRefusesRecordedMoney(PartialSettlementFixture):
    """`settle_row_partial` -- Link to a LARGER Approved payment, carrying the balance forward.

    On the real split fixture, so that without the guard the partial settle would SUCCEED: the test
    goes red because the money is recorded twice, not because the fixture cannot split.
    """

    def _paid_expense_on_the_transfer(self, amount):
        reference = frappe.db.get_value(ROW_DOCTYPE, self.partial_row.name, "bank_reference_no")
        name = f"TEST-RMG-{frappe.generate_hash(length=12)}"
        frappe.db.sql(
            """
            INSERT INTO "tabNon Project Expenses"
                (name, creation, modified, modified_by, owner, docstatus, idx,
                 amount, status, description, payment_ref, payment_date)
            VALUES (%s, NOW(), NOW(), %s, %s, 0, 0, %s, 'Paid', %s, %s, %s)
            """,
            (name, "Administrator", "Administrator", float(amount), "Recorded-money guard test",
             reference, LINE_DATE.date()),
        )
        frappe.db.commit()
        self.addCleanup(self._purge_expense, name)
        return name

    @staticmethod
    def _purge_expense(name):
        frappe.db.delete(NON_PROJECT_EXPENSE, {"name": name})
        frappe.db.commit()

    def test_a_line_paid_on_an_expense_cannot_be_part_settled_onto_a_payment(self):
        self._paid_expense_on_the_transfer(self.BANK)

        with self.assertRaises(MoneyAlreadyRecordedError):
            settle_row_partial(self.partial_row.name, self.big_payment, INTENT_PART_PAYMENT)

        self._assert_partial_untouched()

    def _assert_partial_untouched(self):
        frappe.db.commit()
        self.assertEqual(float(frappe.db.get_value(PAYMENT, self.big_payment, "amount")), self.RECORD)
        self.assertEqual(frappe.db.get_value(PAYMENT, self.big_payment, "status"), SETTLEABLE)
        self.assertEqual(self._balance_of(self.big_payment), [])
        self.assertEqual(frappe.db.count(MATCH_DOCTYPE, {"import_row": self.partial_row.name}), 0)

    # --- check_partial_settle: the refusal comes BEFORE the "carry the rest?" question (#1269) ---

    def test_the_check_refuses_a_line_already_recorded_and_writes_nothing(self):
        """#1269's own example: the screen asks this before it offers the split."""
        self._paid_expense_on_the_transfer(self.BANK)

        with self.assertRaises(MoneyAlreadyRecordedError) as caught:
            check_partial_settle(self.partial_row.name, self.big_payment)

        self.assertIn("Non Project Expense", str(caught.exception))
        self._assert_partial_untouched()

    def test_the_check_passes_a_clean_line_and_writes_nothing(self):
        self.assertEqual(check_partial_settle(self.partial_row.name, self.big_payment), {"ok": True})
        self._assert_partial_untouched()

    def test_the_check_leaves_an_amount_off_hit_to_the_real_call(self):
        """An amount-off hit is a question the reviewer may answer yes to, so it is asked when the
        split is sent -- the check only puts the refusals nobody can overrule first."""
        self._paid_expense_on_the_transfer(self.BANK + 50000)

        self.assertEqual(check_partial_settle(self.partial_row.name, self.big_payment), {"ok": True})
        self._assert_partial_untouched()
        with self.assertRaises(RecordedMoneyNeedsConfirmationError):
            settle_row_partial(self.partial_row.name, self.big_payment, INTENT_PART_PAYMENT)


class TestAllocateRefusesRecordedMoney(RecordedMoneyFixture):
    """`allocate_row` -- split a line across Approved payments."""

    def _targets(self, *payments):
        return json.dumps([{"target_doctype": PAYMENT, "target_name": p} for p in payments])

    def test_a_duplicate_line_is_refused_and_no_payment_moves(self):
        row = self._line(source=CASHFREE, amount="100")
        reference = frappe.db.get_value(ROW_DOCTYPE, row, "bank_reference_no")
        self._non_project_expense(amount="100", status="Paid", payment_ref=reference)
        pays = [self._approved_payment("60"), self._approved_payment("40")]

        with self.assertRaises(MoneyAlreadyRecordedError):
            allocate_row(row=row, targets=self._targets(*pays))

        self._assert_nothing_written(row, approved=[(PAYMENT, p) for p in pays])

    def test_an_amount_off_line_is_refused_unless_confirmed(self):
        row = self._line(source=CASHFREE, amount="100")
        reference = frappe.db.get_value(ROW_DOCTYPE, row, "bank_reference_no")
        self._non_project_expense(amount="70", status="Paid", payment_ref=reference)
        pays = [self._approved_payment("60"), self._approved_payment("40")]

        with self.assertRaises(RecordedMoneyNeedsConfirmationError):
            allocate_row(row=row, targets=self._targets(*pays))
        self._assert_nothing_written(row, approved=[(PAYMENT, p) for p in pays])

        result = allocate_row(row=row, targets=self._targets(*pays), confirm_mismatch="true")
        self.assertEqual(result["row_status"], ROW_SETTLED)

    def test_a_line_s_own_earlier_legs_never_refuse_its_next_one(self):
        """The first leg writes the line's reference onto a Paid payment. Read as "already
        recorded", every second Allocate on a partly allocated transfer would refuse itself."""
        row = self._line(source=CASHFREE, amount="100")
        first, second = self._approved_payment("60"), self._approved_payment("40")

        self.assertEqual(
            allocate_row(row=row, targets=self._targets(first))["row_status"],
            ROW_PARTIALLY_ALLOCATED,
        )
        self.assertEqual(
            allocate_row(row=row, targets=self._targets(second))["row_status"], ROW_SETTLED
        )


class TestCreateExpenseRefusesRecordedMoney(RecordedMoneyFixture):
    """`create_expense` -- the known gap: it had no ledger duplicate check at all."""

    def _create(self, row, **kwargs):
        summary = create_expense(row, NON_PROJECT_EXPENSE, self.non_project_type, **kwargs)
        self.non_project_expenses.append(summary["settled"]["name"])
        return summary

    def test_a_cashfree_line_already_paid_on_a_payment_is_refused(self):
        row = self._line(source=CASHFREE, amount="5000")
        reference = frappe.db.get_value(ROW_DOCTYPE, row, "bank_reference_no")
        paid = self._insert_payment(
            amount=5000, status="Paid", utr=reference, payment_date=LINE_DATE.date(), link_po=False
        )
        before = self._created_from(row)

        with self.assertRaises(MoneyAlreadyRecordedError) as caught:
            self._create(row)

        self.assertIn(paid, str(caught.exception))
        self.assertEqual(self._created_from(row), before)
        self._assert_nothing_written(row)

    def test_an_icici_line_already_recorded_is_refused(self):
        narration = self._narration()
        row = self._line(source=ICICI, amount="5000", narration=narration)
        self._non_project_expense(amount="5000", status="Paid", payment_ref=narration.split("/")[2])
        before = self._created_from(row)

        with self.assertRaises(MoneyAlreadyRecordedError):
            self._create(row)

        self.assertEqual(self._created_from(row), before)
        self._assert_nothing_written(row)

    def test_an_amount_off_line_is_refused_unless_confirmed(self):
        narration = self._narration()
        row = self._line(source=ICICI, amount="5000", narration=narration)
        self._non_project_expense(amount="9000", status="Paid", payment_ref=narration.split("/")[2])
        before = self._created_from(row)

        with self.assertRaises(RecordedMoneyNeedsConfirmationError):
            self._create(row)
        self.assertEqual(self._created_from(row), before)
        self._assert_nothing_written(row)

        self._create(row, confirm_mismatch=True)
        self.assertEqual(frappe.db.get_value(ROW_DOCTYPE, row, "row_status"), ROW_SETTLED)

    def test_a_clean_line_still_creates(self):
        row = self._line(source=CASHFREE, amount="5000")

        summary = self._create(row)

        self.assertTrue(summary["settled"]["created"])


class TestPartLinkedExpensesAreSeen(RecordedMoneyFixture):
    """ADR-0027 R3: a line already linked to a Reconciliation Pending expense is already recorded.

    A salary run is settled by many bank lines and the expense stays Reconciliation Pending until the
    last of them arrives. Until #1301 the duplicate guards read Paid records only, so an overlapping
    statement could bring one of those lines again and link the same money twice while it still fitted
    under the amount. The comparison is line-against-ITS-OWN-SLIP, never against the whole run.
    """

    RUN_AMOUNT = "160000"
    LINE_AMOUNT = "5000"

    def _a_run_with_one_line_linked(self, narration, *, kind="Settled"):
        """A part-linked expense and the earlier line that settled part of it."""
        expense = self._non_project_expense(
            amount=self.RUN_AMOUNT, status="Reconciliation Pending"
        )
        linked = self._line(source=ICICI, amount=self.LINE_AMOUNT, narration=narration)
        self._slip(linked, expense, self.LINE_AMOUNT, kind=kind)
        return expense

    def test_a_reimported_line_of_a_part_linked_run_cannot_be_linked_again(self):
        narration = self._narration()
        self._a_run_with_one_line_linked(narration)
        again = self._line(source=ICICI, amount=self.LINE_AMOUNT, narration=narration)
        approved = self._non_project_expense(amount=self.LINE_AMOUNT, status=SETTLEABLE)

        with self.assertRaises(MoneyAlreadyRecordedError) as caught:
            settle_row(again, NON_PROJECT_EXPENSE, approved)

        message = str(caught.exception)
        # An expense is named by its description, not its hash id (`status._described_record`).
        self.assertIn("Recorded-money guard test", message)
        self.assertIn("Non Project Expense", message)
        self.assertIn("still being reconciled", message)
        self.assertNotIn("as Paid", message)
        self._assert_nothing_written(again, approved=[(NON_PROJECT_EXPENSE, approved)])

    def test_an_unrelated_line_of_the_same_amount_is_not_blocked(self):
        self._a_run_with_one_line_linked(self._narration())
        other = self._line(source=ICICI, amount=self.LINE_AMOUNT, narration=self._narration())
        approved = self._non_project_expense(amount=self.LINE_AMOUNT, status=SETTLEABLE)

        settle_row(other, NON_PROJECT_EXPENSE, approved)

        self.assertEqual(frappe.db.get_value(ROW_DOCTYPE, other, "row_status"), ROW_SETTLED)

    def test_a_reconciliation_pending_expense_with_no_lines_blocks_nothing(self):
        """The widening is to expenses that HAVE live slips, not to the whole status."""
        narration = self._narration()
        self._non_project_expense(
            amount=self.LINE_AMOUNT, status="Reconciliation Pending", payment_ref=narration
        )
        row = self._line(source=ICICI, amount=self.LINE_AMOUNT, narration=narration)
        approved = self._non_project_expense(amount=self.LINE_AMOUNT, status=SETTLEABLE)

        settle_row(row, NON_PROJECT_EXPENSE, approved)

        self.assertEqual(frappe.db.get_value(ROW_DOCTYPE, row, "row_status"), ROW_SETTLED)

    def test_a_reversed_slip_is_not_a_link(self):
        """Unreconcile put the line back; its money is no longer recorded anywhere."""
        narration = self._narration()
        self._a_run_with_one_line_linked(narration, kind="Reversed")
        again = self._line(source=ICICI, amount=self.LINE_AMOUNT, narration=narration)
        approved = self._non_project_expense(amount=self.LINE_AMOUNT, status=SETTLEABLE)

        settle_row(again, NON_PROJECT_EXPENSE, approved)

        self.assertEqual(frappe.db.get_value(ROW_DOCTYPE, again, "row_status"), ROW_SETTLED)

    def test_the_line_is_compared_with_its_own_slip_not_with_the_whole_run(self):
        """A Rs 5,000 line against a Rs 1,60,000 expense is a duplicate, not a Rs 1,55,000
        discrepancy -- which is what comparing it with the whole run would report."""
        narration = self._narration()
        self._a_run_with_one_line_linked(narration)
        again = self._line(source=ICICI, amount=self.LINE_AMOUNT, narration=narration)
        approved = self._non_project_expense(amount=self.LINE_AMOUNT, status=SETTLEABLE)

        with self.assertRaises(MoneyAlreadyRecordedError):
            settle_row(again, NON_PROJECT_EXPENSE, approved)

    def test_the_same_line_cannot_be_linked_to_the_same_run_twice(self):
        """The case the widening exists for, and the one `writing` used to mute.

        `link_rows_to_expense` tells the guard it is about to write the target, so that an
        already-Paid target keeps its own "somebody beat you to it" sentence. A Reconciliation
        Pending expense WITH ROOM is not refused by the settle at all, so without R3's exemption for
        the target's own slips an overlapping statement could link the same money to the same run
        again and still fit under the amount.
        """
        narration = self._narration()
        run = self._a_run_with_one_line_linked(narration)
        again = self._line(source=ICICI, amount=self.LINE_AMOUNT, narration=narration)

        with self.assertRaises(MoneyAlreadyRecordedError):
            link_rows_to_expense(
                rows=json.dumps([again]),
                target_doctype=NON_PROJECT_EXPENSE,
                target_name=run,
            )

        self._assert_nothing_written(again)
        self.assertEqual(
            frappe.db.count(MATCH_DOCTYPE, {"target_name": run, "match_kind": "Settled"}), 1
        )

    def test_one_hitting_slip_does_not_drag_its_whole_run_into_the_pool(self):
        """A run has many slips; a line hits ONE of them, and only that one is a candidate.

        The final join carries `import_row` for exactly this. Without it the pool returns every slip
        of a hit expense, so `pick_recorded_group` is handed several rows of one record and may sum
        two lines' money into one "already recorded" total.
        """
        mine, sibling = self._narration(), self._narration()
        run = self._non_project_expense(amount="160000", status="Reconciliation Pending")
        self._slip(self._line(source=ICICI, amount="5000", narration=mine), run, "5000")
        self._slip(self._line(source=ICICI, amount="7000", narration=sibling), run, "7000")

        asking = self._line(source=ICICI, amount="5000", narration=mine)
        pool = [
            t
            for t in load_recorded_by_contains([frappe.get_doc(ROW_DOCTYPE, asking)])
            if t.name == run
        ]

        self.assertEqual([t.amount for t in pool], [Decimal("5000")])

    def test_a_paid_expense_still_reads_as_paid(self):
        """Paid-record behaviour is unchanged by the widening."""
        narration = self._narration()
        self._non_project_expense(
            amount=self.LINE_AMOUNT, status="Paid", payment_ref=narration
        )
        row = self._line(source=ICICI, amount=self.LINE_AMOUNT, narration=narration)
        approved = self._non_project_expense(amount=self.LINE_AMOUNT, status=SETTLEABLE)

        with self.assertRaises(MoneyAlreadyRecordedError) as caught:
            settle_row(row, NON_PROJECT_EXPENSE, approved)
        self.assertIn("as Paid", str(caught.exception))


class TestTheSlipBranchMirrorsTheMatchSurface(RecordedMoneyFixture):
    """The per-slip reference in SQL is a MIRROR of `contains_guard.match_surface` (#1301).

    ⚠️ IT MAY NEVER BE NARROWER, for the reason `test_review.TestTheContainsQueryMirrorsThePureTokens`
    gives about the tokeniser: a record the pure guard would hit but the query never returns is a
    duplicate that silently arrives as work. `match_surface` has two branches -- the cheque column is
    appended only when the narration carries no run of 6+ digits -- and both are driven here, against
    the real tables, because the branch joins `Outflow Row Match` and `Outflow Import Row` by name.
    """

    def _slip_reference(self, *, narration, reference_id):
        """What the pool hands the guard as this slip's reference, for a line that hits it."""
        expense = self._non_project_expense(amount="160000", status="Reconciliation Pending")
        linked = self._line(
            source=ICICI, amount="5000", narration=narration, reference_id=reference_id
        )
        self._slip(linked, expense, "5000")
        asking = self._line(
            source=ICICI, amount="5000", narration=narration, reference_id=reference_id
        )
        staged = frappe.get_doc(ROW_DOCTYPE, asking)
        pool = [
            t
            for t in load_recorded_by_contains([staged])
            if t.name == expense and t.doctype == NON_PROJECT_EXPENSE
        ]
        self.assertEqual(len(pool), 1, "the slip must come back exactly once, not once per sibling")
        return pool[0].reference

    def test_a_narration_carrying_a_long_number_stands_alone(self):
        narration = self._narration()
        self.assertEqual(
            self._slip_reference(narration=narration, reference_id="000734123"),
            match_surface(narration, "000734123"),
        )

    def test_a_cheque_clearing_narration_takes_the_cheque_column(self):
        """`CLG/SUMAN ELECTRIC UDYOGS P/HSB` has no run of 6+ digits; without the cheque number two
        such lines for the same payee are the same text."""
        narration = "CLG/TEST ELECTRIC UDYOGS P/HSB"
        cheque = f"{frappe.generate_hash(length=4)}1234567"
        reference = self._slip_reference(narration=narration, reference_id=cheque)
        self.assertEqual(reference, match_surface(narration, cheque))
        self.assertIn(cheque, reference)


class TestTheScreenKnowsTheConfirmationError(unittest.TestCase):
    """ADR-0010 F1: the screen offers "... anyway?" by matching this class NAME (`exc_type`). A rename
    on one side alone would silently turn every confirmation into a plain refusal."""

    def test_the_frontend_matches_the_class_name(self):
        # Joined by hand: `get_app_path` scrubs each segment (lower-case, `-` -> `_`).
        path = os.path.join(
            frappe.get_app_path("nirmaan_stack"), "..", "frontend", "src", "pages",
            "outflow-import", "outflowTableModel.ts",
        )
        with open(path) as handle:
            source = handle.read()
        self.assertIn(
            f'RECORDED_MONEY_NEEDS_CONFIRMATION = "{RecordedMoneyNeedsConfirmationError.__name__}"',
            source,
        )

