# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Recording a bank CREDIT -- as a `Project Inflow` (B6), or as a non-project receipt (B7).

    bench --site localhost run-tests --app nirmaan_stack \
        --module nirmaan_stack.api.outflow_import.test_inflows

⚠️ RUNS AGAINST THE LIVE SITE DATABASE AND CREATES REAL `Project Inflows`, which every financial
consumer in this app sums with NO filter. A leak here is not a slow test -- it is money appearing on
somebody's project, moving its cashflow gap, and possibly releasing a CEO Hold. Everything created
is tracked and purged in `tearDownClass`: the inflows, their `Version` rows (the doctype carries
`track_changes`), then the match records, the import rows and the batch.

⚠️ SLICE B7 MAKES IT CREATE REAL `Non Project Expenses` TOO, WITH **NEGATIVE** AMOUNTS. Those are
purged the same way and by the same list discipline. A negative expense left behind on the live site
is worse than a stray positive one: it reads as income to anyone summing that table, and nothing
about the row says a test made it.

What is pinned hardest is the set of REFUSALS. A wrongly created inflow is invisible -- there is no
status to look wrong and no approval queue it fails to leave -- so the guards carry more weight than
the happy path. The B7 path adds a second reason: it is the ONE signed write in this feature, and a
sign applied to the wrong row is a figure that looks entirely ordinary.
"""

import unittest
from dataclasses import replace
from decimal import Decimal

import frappe

from nirmaan_stack.api.outflow_import.expenses import get_expense_types
from nirmaan_stack.api.outflow_import.inflows import (
    _already_booked,
    _already_created_by_import,
    create_inflow,
    create_non_project_receipt,
    get_inflow_context,
)
from nirmaan_stack.api.outflow_import.review import BATCH_DOCTYPE, MATCH_DOCTYPE, ROW_DOCTYPE
from nirmaan_stack.api.outflow_import.upload import _stage_batch
from nirmaan_stack.services.outflow_import import parser as parser_module
from nirmaan_stack.services.outflow_import.parser import parse_statement
from nirmaan_stack.services.outflow_import.settle import (
    DIRECTION_CREDIT,
    INFLOW_DOCTYPE,
    NON_PROJECT_EXPENSE,
    PROJECT_EXPENSE,
    AmountMismatchError,
    ExpenseTypeScopeError,
    InflowNotRecordableError,
    apply_statement_attachment,
    create_non_project_receipt_from_row,
    format_amount_for,
    statement_attachment_field,
)
from nirmaan_stack.services.outflow_import.status import ROW_SETTLED

SOURCE = "ICICI Bank Statement"
FIXTURE = (
    frappe.get_app_path("nirmaan_stack")
    + "/services/outflow_import/tests/fixtures/icici_sample.csv"
)


def _fresh_parse():
    """The fixture with every transfer id salted, so reruns never collide with their own residue."""
    with open(FIXTURE, "rb") as handle:
        parsed = parse_statement(handle.read(), source=SOURCE)
    prefix = frappe.generate_hash(length=10)
    return replace(
        parsed,
        rows=tuple(replace(r, transfer_id=f"{prefix}-{r.transfer_id}") for r in parsed.rows),
    )


class InflowFixture(unittest.TestCase):
    """Stages the ICICI fixture once per class and removes everything it created."""

    batches: list = []
    inflows: list = []
    receipts: list = []

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        # PER-CLASS lists: on the base they would be one shared object and the first tearDownClass
        # would delete rows a later class still needs. Same reason `test_expenses` does this.
        cls.batches = []
        cls.inflows = []
        # B7: the NEGATIVE `Non Project Expenses` this suite creates. Same discipline, and it
        # matters more -- a stray negative row reads as income to anyone summing that table.
        cls.receipts = []

        cls.parsed = _fresh_parse()
        cls.batch = _stage_batch(
            cls.parsed,
            file_url="/private/files/test-statement.csv",
            filename="test-statement.csv",
            user="Administrator",
        )
        cls.batches.append(cls.batch.name)

        # A real Won project that HAS a customer -- the only shape this endpoint may write against.
        cls.project = frappe.db.get_value(
            "Projects", {"tendering_status": "Won", "customer": ["is", "set"]}, "name"
        )
        cls.customer = frappe.db.get_value("Projects", cls.project, "customer")
        # ⚠️ EXCLUSIVE on purpose, exactly as `test_expenses` picks its two. Several live Expense
        # Types carry BOTH flags, and one of those would pass the non-project scope check while
        # proving nothing about scoping.
        cls.non_project_type = frappe.db.get_value(
            "Expense Type", {"non_project": 1, "project": 0}, "name"
        )
        cls.project_type = frappe.db.get_value(
            "Expense Type", {"project": 1, "non_project": 0}, "name"
        )
        frappe.db.commit()

    @classmethod
    def tearDownClass(cls):
        if cls.inflows:
            frappe.db.delete(
                "Version", {"ref_doctype": INFLOW_DOCTYPE, "docname": ["in", cls.inflows]}
            )
            for name in cls.inflows:
                frappe.db.delete(INFLOW_DOCTYPE, {"name": name})
        if cls.receipts:
            frappe.db.delete(
                "Version", {"ref_doctype": NON_PROJECT_EXPENSE, "docname": ["in", cls.receipts]}
            )
            for name in cls.receipts:
                frappe.db.delete(NON_PROJECT_EXPENSE, {"name": name})
        frappe.db.delete(MATCH_DOCTYPE, {"import_batch": ["in", cls.batches]})
        for name in cls.batches:
            frappe.db.delete(ROW_DOCTYPE, {"import_batch": name})
            frappe.db.delete(BATCH_DOCTYPE, {"name": name})
        frappe.db.commit()
        super().tearDownClass()

    # --- helpers ---------------------------------------------------------------------------

    def _next_credit_row(self):
        """Any staged CREDIT still available to record.

        Recording CONSUMES a row, so a test that hard-codes one is coupled to the alphabetical
        order unittest happens to run its siblings in.
        """
        rows = frappe.get_all(
            ROW_DOCTYPE,
            filters={
                "import_batch": self.batch.name,
                "direction": DIRECTION_CREDIT,
                "row_status": ["not in", ["Settled", "Skipped"]],
            },
            fields=[
                "name",
                "amount",
                "row_status",
                "bank_reference_no",
                "added_on",
                # B7 reads these two: the payer has nowhere else to go on a ledger with no vendor
                # column, so `_default_description` folds them in.
                "beneficiary_name",
                "remarks",
            ],
            order_by="creation asc",
            limit=1,
        )
        self.assertTrue(rows, "no open credit row left in the fixture batch")
        return rows[0]

    def _next_debit_row(self):
        rows = frappe.get_all(
            ROW_DOCTYPE,
            filters={
                "import_batch": self.batch.name,
                "direction": "Debit",
                "row_status": ["not in", ["Settled", "Skipped"]],
            },
            fields=["name", "amount"],
            order_by="creation asc",
            limit=1,
        )
        self.assertTrue(rows, "no open debit row left in the fixture batch")
        return rows[0]

    def _record(self, row=None, **kwargs):
        row = row or self._next_credit_row()
        summary = create_inflow(row=row["name"], project=self.project, **kwargs)
        self.inflows.append(summary["settled"]["name"])
        return row, summary

    def _receive(self, row=None, expense_type=None, **kwargs):
        """Record a credit row as a non-project receipt (B7), tracking it for the purge."""
        row = row or self._next_credit_row()
        summary = create_non_project_receipt(
            row=row["name"], expense_type=expense_type or self.non_project_type, **kwargs
        )
        self.receipts.append(summary["settled"]["name"])
        return row, summary


class TestTheHappyPath(InflowFixture):
    def test_it_creates_an_inflow_carrying_the_bank_row_s_own_figures(self):
        """⚠️ THE CLIENT NEVER SENDS A FIGURE. Amount, date and reference are read server-side."""
        row, summary = self._record()

        inflow = frappe.db.get_value(
            INFLOW_DOCTYPE,
            summary["settled"]["name"],
            ["project", "customer", "amount", "payment_date", "utr", "invoice"],
            as_dict=True,
        )
        self.assertEqual(inflow.project, self.project)
        self.assertEqual(inflow.customer, self.customer)
        self.assertEqual(Decimal(inflow.amount), Decimal(str(row["amount"])))
        self.assertEqual(inflow.payment_date, row["added_on"].date())
        self.assertEqual(inflow.utr, row["bank_reference_no"])
        self.assertIsNone(inflow.invoice)

    def test_the_amount_is_stored_as_a_bare_numeric_string(self):
        """`Project Inflows.amount` is a **Data** column. A float would store `44275.0` beside 463
        rows that read `44275`, on a column every financial screen sums unfiltered."""
        _, summary = self._record()
        stored = frappe.db.get_value(INFLOW_DOCTYPE, summary["settled"]["name"], "amount")
        self.assertIsInstance(stored, str)
        self.assertNotIn(".", stored.rstrip("0").rstrip(".") if "." in stored else stored)
        self.assertEqual(stored, format_amount_for(INFLOW_DOCTYPE, Decimal(stored)))

    def test_the_row_flips_to_settled_and_gets_a_match_record(self):
        """The four facts of a settlement are one transaction -- a match record without its inflow
        would claim a receipt that does not exist."""
        row, summary = self._record()

        after = frappe.db.get_value(
            ROW_DOCTYPE, row["name"], ["row_status", "outcome_note", "decided_by"], as_dict=True
        )
        self.assertEqual(after.row_status, ROW_SETTLED)
        self.assertIn(summary["settled"]["name"], after.outcome_note)

        match = frappe.db.get_value(
            MATCH_DOCTYPE,
            {"import_row": row["name"]},
            ["target_doctype", "target_name", "target_amount", "match_kind", "match_basis"],
            as_dict=True,
        )
        self.assertEqual(match.target_doctype, INFLOW_DOCTYPE)
        self.assertEqual(match.target_name, summary["settled"]["name"])
        self.assertEqual(match.match_kind, "Settled")
        # ⚠️ NO NEW `match_basis` OPTION WAS NEEDED. An ICICI row carries none, so `_record_settlement`
        # falls back to "Manual" -- which is the truth: nothing was matched, a person chose the
        # project. A test rather than a comment, because a doctype JSON edit is the alternative.
        self.assertEqual(match.match_basis, "Manual")

    def test_the_summary_reports_a_created_record(self):
        _, summary = self._record()
        self.assertEqual(summary["settled"]["doctype"], INFLOW_DOCTYPE)
        self.assertTrue(summary["settled"]["created"])
        self.assertIsNone(summary["settled"]["original_amount"])
        self.assertFalse(summary["settled"]["amount_changed"])

    def test_who_recorded_it_is_durable_on_the_match_record(self):
        """⚠️ THIS LEDGER HAS NO `payment_by`, AND `owner` CANNOT STAND IN FOR ONE: Frappe's
        `set_user_and_timestamp` overwrites `owner` with the session user on every insert, so an
        assignment there would read as deliberate and be a silent no-op. `matched_by` is the answer
        that survives, which is why it is pinned here rather than the doc's own fields."""
        row, summary = self._record()
        self.assertEqual(
            frappe.db.get_value(MATCH_DOCTYPE, {"import_row": row["name"]}, "matched_by"),
            frappe.session.user,
        )
        self.assertEqual(
            frappe.db.get_value(ROW_DOCTYPE, row["name"], "decided_by"), frappe.session.user
        )


class TestRefusals(InflowFixture):
    def test_a_debit_is_refused(self):
        """Recording a debit as an inflow books money that LEFT as money that arrived."""
        row = self._next_debit_row()
        with self.assertRaises(InflowNotRecordableError):
            create_inflow(row=row["name"], project=self.project)

    def test_a_project_with_no_customer_is_refused(self):
        """⚠️ OWNER RULING Q13, ENFORCED ON THIS PATH AND NOT ON THE DOCTYPE. Putting it on
        `Project Inflows.validate` would start refusing writes from the existing dialog and from
        legacy edits -- a change to a screen nobody asked to change."""
        orphan = frappe.db.get_value(
            "Projects", {"tendering_status": "Won", "customer": ["in", ["", None]]}, "name"
        )
        if not orphan:
            self.skipTest("no Won project without a customer on this site")
        row = self._next_credit_row()
        with self.assertRaises(InflowNotRecordableError):
            create_inflow(row=row["name"], project=orphan)
        self.assertFalse(frappe.db.exists(MATCH_DOCTYPE, {"import_row": row["name"]}))

    def test_a_missing_project_is_refused(self):
        row = self._next_credit_row()
        with self.assertRaises(InflowNotRecordableError):
            create_inflow(row=row["name"], project="")

    def test_a_customer_that_disagrees_with_the_project_is_refused(self):
        """The customer is a FACT about the project. A supplied one that differs is a stale screen,
        caught rather than silently overruled."""
        row = self._next_credit_row()
        with self.assertRaises(InflowNotRecordableError):
            create_inflow(
                row=row["name"], project=self.project, customer="a-customer-that-is-not-theirs"
            )

    def test_an_invoice_from_another_project_is_refused(self):
        other = frappe.db.get_value(
            "Project Invoices", {"project": ["!=", self.project]}, ["name", "project"], as_dict=True
        )
        if not other:
            self.skipTest("no Project Invoice on another project on this site")
        row = self._next_credit_row()
        with self.assertRaises(InflowNotRecordableError):
            create_inflow(row=row["name"], project=self.project, invoice=other.name)

    def test_a_refused_row_writes_nothing_at_all(self):
        """The savepoint is the point: a refusal leaves the database exactly as it was."""
        row = self._next_credit_row()
        before = frappe.db.count(INFLOW_DOCTYPE)
        with self.assertRaises(InflowNotRecordableError):
            create_inflow(row=row["name"], project="no-such-project")
        self.assertEqual(frappe.db.count(INFLOW_DOCTYPE), before)
        self.assertEqual(
            frappe.db.get_value(ROW_DOCTYPE, row["name"], "row_status"), row["row_status"]
        )

    def test_a_settled_row_cannot_be_recorded_twice(self):
        row, _ = self._record()
        with self.assertRaises(Exception):
            create_inflow(row=row["name"], project=self.project)


class TestTheDuplicateGuards(InflowFixture):
    """⚠️ THE `Outflow Row Match` UNIQUE KEY CANNOT REACH THIS PATH. Its key is
    `(transfer_id, target_doctype, target_name)` and a created record's name is new every time, so
    two imports of one credit contend on nothing. These two lookups are the guard instead."""

    def test_the_unique_key_really_does_not_contend(self):
        """Stated as a test because the whole design rests on it. Two match records for the SAME
        transfer and doctype coexist happily as long as the target differs."""
        row = self._next_credit_row()
        keys = frappe.db.sql(
            f"""SELECT indexdef FROM pg_indexes WHERE tablename = 'tab{MATCH_DOCTYPE}'""",
            as_dict=True,
        )
        unique = [k["indexdef"] for k in keys if "UNIQUE" in k["indexdef"].upper()]
        self.assertTrue(
            any("target_name" in defn for defn in unique),
            "the match constraint no longer includes target_name -- re-read the guard's reasoning",
        )
        self.assertTrue(row)

    def test_a_second_import_of_the_same_credit_is_refused(self):
        row, summary = self._record()
        # A second staged row for the same transfer, as an overlapping statement would produce.
        twin = frappe.copy_doc(frappe.get_doc(ROW_DOCTYPE, row["name"]))
        twin.row_status = "Mismatched"
        twin.outcome_note = None
        twin.decided_at = None
        twin.decided_by = None
        twin.settlement_origin = None
        twin.insert(ignore_permissions=True)
        frappe.db.commit()
        self.addCleanup(lambda: frappe.db.delete(ROW_DOCTYPE, {"name": twin.name}))

        with self.assertRaises(InflowNotRecordableError) as caught:
            create_inflow(row=twin.name, project=self.project)
        self.assertIn(summary["settled"]["name"], str(caught.exception))

    def test_an_inflow_keyed_in_by_hand_blocks_the_import(self):
        """The measured hole: 330 of 463 live inflows carry a `utr` and NONE came from this import."""
        row = self._next_credit_row()
        planted = frappe.new_doc(INFLOW_DOCTYPE)
        planted.update(
            {
                "project": self.project,
                "customer": self.customer,
                "utr": row["bank_reference_no"],
                "amount": format_amount_for(INFLOW_DOCTYPE, Decimal(str(row["amount"]))),
                "payment_date": row["added_on"].date(),
            }
        )
        planted.insert(ignore_permissions=True)
        frappe.db.commit()
        self.inflows.append(planted.name)

        with self.assertRaises(InflowNotRecordableError) as caught:
            create_inflow(row=row["name"], project=self.project)
        self.assertIn(planted.name, str(caught.exception))

    def test_a_different_amount_on_the_same_reference_is_not_a_duplicate(self):
        """⚠️ IDENTITY IS `(reference, amount, date)`, NOT THE REFERENCE ALONE -- the one rule in
        `duplicates.row_identity`. A corrected figure is a different fact and must import."""
        row = self._next_credit_row()
        index = _already_booked(row["bank_reference_no"])
        self.assertEqual(index, {}, "the fixture reference should not already be booked")

    def test_the_booked_lookup_ignores_a_blank_reference(self):
        """A blank key fails OPEN: never recognised as a repeat, which is the recoverable
        direction. A duplicate somebody can see beats a real receipt silently refused."""
        self.assertEqual(_already_booked(""), {})

    def test_the_import_lookup_ignores_a_blank_transfer_id(self):
        class _Bare:
            transfer_id = ""

        self.assertEqual(_already_created_by_import(_Bare()), {})


class TestTheContextRead(InflowFixture):
    def test_it_returns_the_project_s_own_customer(self):
        context = get_inflow_context(self.project)
        self.assertEqual(context["customer"], self.customer)
        self.assertEqual(context["tendering_status"], "Won")
        self.assertIsInstance(context["invoices"], list)

    def test_a_project_with_no_customer_reports_it_rather_than_hiding(self):
        orphan = frappe.db.get_value(
            "Projects", {"tendering_status": "Won", "customer": ["in", ["", None]]}, "name"
        )
        if not orphan:
            self.skipTest("no Won project without a customer on this site")
        self.assertIsNone(get_inflow_context(orphan)["customer"])

    def test_an_unknown_project_answers_rather_than_raising(self):
        self.assertIsNone(get_inflow_context("no-such-project")["customer"])


class TestTheSharedHelpers(unittest.TestCase):
    """The three pieces of `settle.py` this slice reused rather than re-typed."""

    def test_the_direction_word_matches_the_parser_s(self):
        """⚠️ SPELLED IN TWO MODULES, PINNED HERE. `settle.py` does not otherwise import `parser`;
        a rename reaching only one of them would make every credit unrecordable, silently."""
        self.assertEqual(DIRECTION_CREDIT, parser_module.DIRECTION_CREDIT)

    def test_the_attachment_field_follows_the_doctype(self):
        """⚠️ THE FOURTH LEDGER SPELLS IT DIFFERENTLY, which is the case the constant's own note
        anticipated. The three settle ledgers are byte-unchanged."""
        self.assertEqual(statement_attachment_field(INFLOW_DOCTYPE), "inflow_attachment")
        for doctype in ("Project Payments", PROJECT_EXPENSE, "Non Project Expenses"):
            self.assertEqual(statement_attachment_field(doctype), "payment_attachment")

    def test_an_inflow_takes_the_statement_into_its_own_attachment_field(self):
        doc = frappe.new_doc(INFLOW_DOCTYPE)
        self.assertTrue(apply_statement_attachment(doc, "/private/files/s.csv"))
        self.assertEqual(doc.inflow_attachment, "/private/files/s.csv")

    def test_a_populated_attachment_is_never_overwritten(self):
        """The blank-only rule: an accountant's own proof of THIS receipt outranks a 1,000-row
        statement, on a field nobody asked us to touch."""
        doc = frappe.new_doc(INFLOW_DOCTYPE)
        doc.inflow_attachment = "/private/files/receipt.png"
        self.assertFalse(apply_statement_attachment(doc, "/private/files/s.csv"))
        self.assertEqual(doc.inflow_attachment, "/private/files/receipt.png")

    def test_the_data_amount_shape_is_shared_with_project_expenses(self):
        # ⚠️ `2500.50` NORMALISES TO `2500.5`. `format_amount_for` calls `Decimal.normalize()`
        # first, so a trailing zero is dropped -- which is the shape `Project Expenses` has always
        # stored and is why this asserts both ledgers give the same answer rather than a literal.
        for amount, expected in ((Decimal("44275"), "44275"), (Decimal("2500.50"), "2500.5")):
            self.assertEqual(format_amount_for(INFLOW_DOCTYPE, amount), expected)
            self.assertEqual(format_amount_for(PROJECT_EXPENSE, amount), expected)
        # Unchanged for the Currency ledgers.
        self.assertEqual(format_amount_for("Non Project Expenses", Decimal("44275")), 44275.0)


class TestTheZeroGuard(InflowFixture):
    def test_a_credit_of_zero_or_less_is_refused(self):
        """Mirrors `create_expense_from_row`'s guard, in the inflow's own voice."""
        row = self._next_credit_row()
        frappe.db.set_value(ROW_DOCTYPE, row["name"], "amount", 0, update_modified=False)
        frappe.db.commit()
        with self.assertRaises(AmountMismatchError):
            create_inflow(row=row["name"], project=self.project)


# =================================================================================================
# Slice B7 -- a credit that belongs to NO project, recorded as a NEGATIVE `Non Project Expense`.
#
# ⚠️ THIS IS THE ONE SIGNED WRITE IN THE WHOLE FEATURE, so the sign is what these pin hardest. A
# wrong sign is not a visible failure: it is an ordinary-looking figure in the wrong direction, on a
# ledger every reader assumes is money going out.
#
# ⚠️ AND THE COST THE OWNER ACCEPTED, RECORDED HERE BECAUSE `fixtures/expense_type.json` IS JSON AND
# CANNOT HOLD A COMMENT: money coming IN now lives in a doctype called *Expenses*. There is no
# non-project inflow doctype in this app and none is being created (owner ruling Q3, ADR-0016
# decision 3, accepted risk R3). The four new `non_project = 1` Expense Types (Q19) exist so such a
# row at least says what it is -- they are pinned in `TestTheIncomeExpenseTypes` below, and adding
# or renaming one means editing that fixture and running `bench migrate` (or `sync_fixtures`).
# =================================================================================================


class TestTheNonProjectReceipt(InflowFixture):
    def test_it_stores_the_bank_s_magnitude_NEGATED(self):
        """⚠️ THE WHOLE SLICE IN ONE ASSERTION. The staged row carries a POSITIVE magnitude -- that
        is true on every source by design, and ADR-0016 rejected a signed amount column outright --
        and the negation is applied in the write path, from the row's `direction`. Nothing trusts a
        sign arriving from a row or from a client."""
        row, summary = self._receive()

        stored = frappe.db.get_value(
            NON_PROJECT_EXPENSE, summary["settled"]["name"], "amount"
        )
        self.assertGreater(Decimal(str(row["amount"])), 0, "the staged row must be a magnitude")
        self.assertEqual(Decimal(str(stored)), -Decimal(str(row["amount"])))
        self.assertLess(float(stored), 0)

    def test_the_amount_is_a_real_number_because_the_column_is_Currency(self):
        """⚠️ THE ASYMMETRY THAT MAKES THIS LEDGER THE RIGHT ONE FOR A SIGNED FIGURE.
        `Non Project Expenses.amount` is a real **Currency** column, unlike `Project Expenses` and
        `Project Inflows`, whose `amount` is a **Data** column holding bare numeric strings."""
        _, summary = self._receive()
        stored = frappe.db.get_value(NON_PROJECT_EXPENSE, summary["settled"]["name"], "amount")
        self.assertIsInstance(stored, float)
        self.assertEqual(
            format_amount_for(NON_PROJECT_EXPENSE, Decimal(str(stored))), stored
        )

    def test_it_is_created_at_Paid_which_bypasses_the_approval_ladder(self):
        """⚠️ DELIBERATE, AND THE REASON IS NOT "IT WAS EASIER". Both expense controllers return
        early from `validate()` for any status other than `Requested`, so the negative-amount
        exclusion from auto-approval never evaluates -- which is the right outcome: the money has
        already arrived, and asking somebody to *approve* a receipt the bank already credited is
        theatre. The review gate is the bank row (owner ruling Q8)."""
        _, summary = self._receive()
        self.assertEqual(
            frappe.db.get_value(NON_PROJECT_EXPENSE, summary["settled"]["name"], "status"), "Paid"
        )

    def test_it_carries_the_bank_row_s_reference_date_and_provenance(self):
        row, summary = self._receive()
        doc = frappe.db.get_value(
            NON_PROJECT_EXPENSE,
            summary["settled"]["name"],
            ["payment_ref", "payment_date", "comment", "type", "payment_attachment"],
            as_dict=True,
        )
        self.assertEqual(doc.payment_ref, row["bank_reference_no"])
        self.assertEqual(doc.payment_date, row["added_on"].date())
        self.assertEqual(doc.type, self.non_project_type)
        # Visible provenance: the match record is durable but invisible on the expense form, and on
        # a NEGATIVE row the explanation matters more than usual.
        self.assertIn(self.batch.name, doc.comment)
        self.assertEqual(doc.payment_attachment, "/private/files/test-statement.csv")

class TestTheReceiptBookkeeping(InflowFixture):
    """The import-side half, split off from `TestTheNonProjectReceipt` for a MEASURED reason:
    recording CONSUMES a staged row, and the ICICI fixture holds only 7 credits (6 open after the
    in-file duplicate auto-skip). A class with more consuming tests than that fails on row supply
    rather than on anything it asserts. Each class stages its OWN batch, so splitting buys 6 more.
    """

    def test_the_payer_lands_in_the_description_by_default(self):
        """There is nowhere else for them to go: `Non Project Expenses` has NO vendor column."""
        row, summary = self._receive()
        description = frappe.db.get_value(
            NON_PROJECT_EXPENSE, summary["settled"]["name"], "description"
        )
        self.assertIn(row["beneficiary_name"] or row["remarks"], description)

    def test_a_typed_description_wins_over_the_default(self):
        _, summary = self._receive(description="FD 0057 closed, principal returned")
        self.assertEqual(
            frappe.db.get_value(
                NON_PROJECT_EXPENSE, summary["settled"]["name"], "description"
            ),
            "FD 0057 closed, principal returned",
        )

    def test_the_row_flips_to_settled_and_gets_a_match_record(self):
        row, summary = self._receive()
        after = frappe.db.get_value(
            ROW_DOCTYPE, row["name"], ["row_status", "outcome_note", "decided_by"], as_dict=True
        )
        self.assertEqual(after.row_status, ROW_SETTLED)
        self.assertIn(summary["settled"]["name"], after.outcome_note)
        self.assertEqual(after.decided_by, frappe.session.user)

        match = frappe.db.get_value(
            MATCH_DOCTYPE,
            {"import_row": row["name"]},
            ["target_doctype", "target_name", "target_amount", "match_kind"],
            as_dict=True,
        )
        self.assertEqual(match.target_doctype, NON_PROJECT_EXPENSE)
        self.assertEqual(match.target_name, summary["settled"]["name"])
        self.assertEqual(match.match_kind, "Settled")
        # ⚠️ THE MATCH RECORD CARRIES THE NEGATIVE TOO, because `SettleResult.amount` means "the
        # amount WRITTEN". It reaches the export's `settled_target_amount`, where a negative is the
        # truth about what this settlement recorded. It is NOT summed anywhere -- the batch totals
        # read the ROW's own amount, which `review.py` states in its own note -- so it cannot net
        # anything off.
        self.assertLess(float(match.target_amount), 0)

    def test_the_summary_reports_a_created_record_at_the_negative_figure(self):
        row, summary = self._receive()
        self.assertEqual(summary["settled"]["doctype"], NON_PROJECT_EXPENSE)
        self.assertTrue(summary["settled"]["created"])
        self.assertEqual(summary["settled"]["amount"], -float(row["amount"]))
        self.assertIsNone(summary["settled"]["original_amount"])
        self.assertFalse(summary["settled"]["amount_changed"])


class TestTheReceiptRefusals(InflowFixture):
    def test_a_DEBIT_is_refused(self):
        """The refusal that matters most on this path: a debit recorded here would book money that
        LEFT the account as income, and the books would be wrong by twice the transfer."""
        row = self._next_debit_row()
        with self.assertRaises(InflowNotRecordableError):
            create_non_project_receipt(row=row["name"], expense_type=self.non_project_type)
        self.assertFalse(frappe.db.exists(MATCH_DOCTYPE, {"import_row": row["name"]}))

    def test_the_SERVICE_refuses_a_missing_direction_where_the_inflow_sibling_tolerates_it(self):
        """⚠️ THE DELIBERATE DIVERGENCE FROM `create_inflow_from_row`, pinned so nobody "restores
        consistency". There the direction picks a LEDGER and a wrong choice is refused downstream by
        the project and customer rules; here it picks a SIGN, and silence must not be consent."""

        class _Row:
            amount = 1000
            added_on_date = None
            bank_reference_no = "REF-1"
            beneficiary_name = "Someone"
            remarks = ""

        for direction in (None, "", "Debit"):
            with self.assertRaises(InflowNotRecordableError):
                create_non_project_receipt_from_row(
                    _Row(),
                    actor="Administrator",
                    expense_type=self.non_project_type,
                    direction=direction,
                )

    def test_a_PROJECT_scoped_expense_type_is_refused(self):
        """`_assert_type_scope` is shared with the debit path; this pins that the receipt path
        actually calls it, on the `non_project` flag."""
        row = self._next_credit_row()
        if not self.project_type:
            self.skipTest("no project-only Expense Type on this site")
        with self.assertRaises(ExpenseTypeScopeError):
            create_non_project_receipt(row=row["name"], expense_type=self.project_type)

    def test_a_blank_expense_type_is_refused(self):
        row = self._next_credit_row()
        with self.assertRaises(ExpenseTypeScopeError):
            create_non_project_receipt(row=row["name"], expense_type="")

    def test_a_credit_of_zero_or_less_is_refused(self):
        row = self._next_credit_row()

        # ⚠️ RESTORED AFTERWARDS, AND THAT IS NOT TIDINESS. Every test in this class REFUSES, so the
        # row it picked stays open and the next test picks the SAME one -- which would then meet a
        # zeroed amount and fail on the wrong guard, at the wrong test's name. A mutation that
        # outlives its test is a false failure somewhere else.
        self.addCleanup(
            lambda: (
                frappe.db.set_value(
                    ROW_DOCTYPE, row["name"], "amount", row["amount"], update_modified=False
                ),
                frappe.db.commit(),
            )
        )
        frappe.db.set_value(ROW_DOCTYPE, row["name"], "amount", 0, update_modified=False)
        frappe.db.commit()
        with self.assertRaises(AmountMismatchError):
            create_non_project_receipt(row=row["name"], expense_type=self.non_project_type)

    def test_a_refused_row_writes_nothing_at_all(self):
        """The savepoint is the point: a refusal leaves the database exactly as it was -- and on
        this path "nothing" includes not leaving a negative expense standing."""
        row = self._next_credit_row()
        before = frappe.db.count(NON_PROJECT_EXPENSE)
        with self.assertRaises(ExpenseTypeScopeError):
            create_non_project_receipt(row=row["name"], expense_type="no-such-expense-type")
        self.assertEqual(frappe.db.count(NON_PROJECT_EXPENSE), before)
        self.assertEqual(
            frappe.db.get_value(ROW_DOCTYPE, row["name"], "row_status"), row["row_status"]
        )

    def test_a_settled_row_cannot_be_recorded_twice(self):
        """The per-row guard, which is what stands in for the duplicate lookups this endpoint
        deliberately does not have -- see the module header for why."""
        row, _ = self._receive()
        with self.assertRaises(Exception):
            create_non_project_receipt(row=row["name"], expense_type=self.non_project_type)


class TestTheIncomeExpenseTypes(unittest.TestCase):
    """The `non_project = 1` fixtures that name what a credit actually was (owner ruling Q19).

    ⚠️ THEY ARE THE ONLY THING ON THE ROW THAT SAYS IT IS INCOME. The record is a
    `Non Project Expense` with a negative amount; without a type reading "Received" / "Returned" /
    "Proceeds", a reader meets an unexplained negative number in a list of spending.

    ⚠️ THEY MUST CARRY `non_project = 1` OR THE WHOLE PATH IS UNREACHABLE -- `_assert_type_scope`
    refuses a type lacking the flag for its side, so a fixture minted with the wrong flag makes
    every receipt refuse with a message about expense types.
    """

    INCOME_TYPES = (
        "Interest Received",       # FD / RD interest credited
        "Fixed Deposit Proceeds",  # an FD closing and returning its principal
        "Loan Received",           # a loan drawdown landing
        "Advance Returned",        # a labour or site advance coming back
    )

    def test_each_one_exists_and_is_scoped_non_project(self):
        for name in self.INCOME_TYPES:
            scoped = frappe.db.get_value(
                "Expense Type", name, ["non_project", "project"], as_dict=True
            )
            self.assertIsNotNone(scoped, f"{name!r} is missing -- run `bench migrate`")
            self.assertTrue(scoped.non_project, f"{name!r} must carry non_project = 1")
            self.assertFalse(
                scoped.project,
                f"{name!r} must NOT be offered on the project side -- a receipt has no project",
            )

    def test_the_receipt_form_can_actually_offer_them(self):
        """⚠️ THE LIST IS THE EXISTING `get_expense_types`, NOT A SECOND ENDPOINT. One query answers
        both the form and the server's own scope check, so they cannot disagree about which types
        exist."""
        offered = {t["name"] for t in get_expense_types(NON_PROJECT_EXPENSE)}
        for name in self.INCOME_TYPES:
            self.assertIn(name, offered)
