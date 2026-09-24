# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Recording a bank CREDIT -- as a `Project Inflow` (B6), or as a `Non Project Inflow` (#1266).

    bench --site localhost run-tests --app nirmaan_stack \
        --module nirmaan_stack.api.outflow_import.test_inflows

⚠️ RUNS AGAINST THE LIVE SITE DATABASE AND CREATES REAL `Project Inflows`, which every financial
consumer in this app sums with NO filter. A leak here is not a slow test -- it is money appearing on
somebody's project, moving its cashflow gap, and possibly releasing a CEO Hold. Everything created
is tracked and purged in `tearDownClass`: the inflows, their `Version` rows (the doctype carries
`track_changes`), then the match records, the import rows and the batch.

⚠️ #1266 MAKES IT CREATE REAL `Non Project Inflows` TOO. Those are purged the same way and by the
same list discipline: a stray one reads as company money received to anyone reading that list.

⚠️ THE VENDOR-REFUND TESTS CREATE REAL `Vendor Refunds` against real paid POs, and each one LOWERS its
PO's `amount_paid`. They are purged by the same list discipline as the other inflow books -- by raw
delete, which runs no hook -- so `setUpClass` captures each refund PO's stored paid figures and
`tearDownClass` writes THOSE back, never a recompute (a recompute moves a PO whose stored figure
already disagreed with its payments).

What is pinned hardest is the set of REFUSALS. A wrongly created inflow is invisible -- there is no
status to look wrong and no approval queue it fails to leave -- so the guards carry more weight than
the happy path.

The non-project receipt path (B7: a NEGATIVE `Non Project Expense`) was REMOVED at #1266 with its
tests (ADR-0016 Amendment A-D2); `TestTheReceiptPathIsGone` pins that it stays gone.
"""

import unittest
from dataclasses import replace
from decimal import Decimal

import frappe

from nirmaan_stack.api.outflow_import import inflows as inflows_module
from nirmaan_stack.api.outflow_import.expenses import (
    MoneyAlreadyRecordedError,
    RecordedMoneyNeedsConfirmationError,
)
from nirmaan_stack.api.outflow_import.inflows import (
    _already_created_by_import,
    create_inflow,
    create_non_project_inflow,
    create_vendor_refund,
    get_inflow_context,
    get_vendor_refund_documents,
)
from nirmaan_stack.api.outflow_import.review import (
    BATCH_DOCTYPE,
    MATCH_DOCTYPE,
    ROW_DOCTYPE,
    get_outflow_rows,
)
from nirmaan_stack.api.outflow_import.long_reference_fixture import _give_row_a_long_narration
from nirmaan_stack.api.outflow_import.upload import _stage_batch
from nirmaan_stack.services.outflow_import import parser as parser_module
from nirmaan_stack.services.outflow_import import settle as settle_module
from nirmaan_stack.services.outflow_import.contains_guard import match_surface
from nirmaan_stack.services.outflow_import.ledgers import LEDGER_NOUNS, RECEIVED_LEDGER_DOCTYPES
from nirmaan_stack.services.outflow_import.parser import parse_statement
from nirmaan_stack.services.outflow_import.settle import (
    DIRECTION_CREDIT,
    INFLOW_DOCTYPE,
    NON_PROJECT_EXPENSE,
    NON_PROJECT_INFLOW,
    PROJECT_EXPENSE,
    VENDOR_REFUND,
    AmountMismatchError,
    InflowNotRecordableError,
    apply_statement_attachment,
    create_non_project_inflow_from_row,
    create_vendor_refund_from_row,
    format_amount_for,
    statement_attachment_field,
)
from nirmaan_stack.services.outflow_import.status import ROW_SETTLED
from nirmaan_stack.api.outflow_import.unreconcile import get_unreconcile_plan, unreconcile_row

SOURCE = "ICICI Bank Statement"
FIXTURE = (
    frappe.get_app_path("nirmaan_stack")
    + "/services/outflow_import/tests/fixtures/icici_sample.csv"
)

#: What a Vendor Refund's hook writes on its PO, captured before the suite and restored after it.
_REFUND_PO_FIGURES = ["amount_paid", "amount_due", "modified", "modified_by"]


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
    non_project_inflows: list = []
    vendor_refunds: list = []

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        # PER-CLASS lists: on the base they would be one shared object and the first tearDownClass
        # would delete rows a later class still needs. Same reason `test_expenses` does this.
        cls.batches = []
        cls.inflows = []
        # #1266: the `Non Project Inflows` this suite creates. Same discipline.
        cls.non_project_inflows = []
        # Every `Vendor Refunds` record a vendor-refund test created.
        cls.vendor_refunds = []

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
        # Two real PAID POs of one real vendor on one real project -- what a Vendor Refund is
        # allocated against. Each was paid at least the Rs 1,000 a refund test records.
        pair = frappe.db.sql(
            """
            SELECT vendor, project, array_agg(name ORDER BY name) AS names
            FROM "tabProcurement Orders"
            WHERE status = 'Delivered' AND amount_paid >= 1000
              AND vendor IS NOT NULL AND project IS NOT NULL
            GROUP BY vendor, project HAVING COUNT(*) >= 2
            ORDER BY vendor, project LIMIT 1
            """,
            as_dict=True,
        )[0]
        cls.vendor, cls.refund_project = pair.vendor, pair.project
        cls.refund_pos = list(pair.names[:2])
        # A refund lowers its PO's stored paid figures; the raw purge below cannot put them back.
        cls.refund_po_figures = {
            po: frappe.db.get_value(
                "Procurement Orders", po, _REFUND_PO_FIGURES, as_dict=True
            )
            for po in cls.refund_pos
        }
        frappe.db.commit()

    @classmethod
    def tearDownClass(cls):
        if cls.inflows:
            frappe.db.delete(
                "Version", {"ref_doctype": INFLOW_DOCTYPE, "docname": ["in", cls.inflows]}
            )
            for name in cls.inflows:
                frappe.db.delete(INFLOW_DOCTYPE, {"name": name})
        if cls.non_project_inflows:
            frappe.db.delete(
                "Version",
                {"ref_doctype": NON_PROJECT_INFLOW, "docname": ["in", cls.non_project_inflows]},
            )
            # The statement's second `File` row, attached to the record after the commit.
            frappe.db.delete(
                "File",
                {
                    "attached_to_doctype": NON_PROJECT_INFLOW,
                    "attached_to_name": ["in", cls.non_project_inflows],
                },
            )
            for name in cls.non_project_inflows:
                frappe.db.delete(NON_PROJECT_INFLOW, {"name": name})
        if cls.vendor_refunds:
            for side in ("Version", "Nirmaan Versions"):
                frappe.db.delete(side, {"ref_doctype": VENDOR_REFUND, "docname": ["in", cls.vendor_refunds]})
            frappe.db.delete(
                "File",
                {"attached_to_doctype": VENDOR_REFUND, "attached_to_name": ["in", cls.vendor_refunds]},
            )
            frappe.db.delete(
                "Deleted Document",
                {"deleted_doctype": VENDOR_REFUND, "deleted_name": ["in", cls.vendor_refunds]},
            )
            for name in cls.vendor_refunds:
                frappe.db.delete(VENDOR_REFUND, {"name": name})
        # The raw purge ran no refund hook: put back each PO's figures exactly as found.
        for po, figures in cls.refund_po_figures.items():
            frappe.db.set_value("Procurement Orders", po, figures, update_modified=False)
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
                # #1259: the cheque column, which the stored match surface can carry.
                "reference_id",
                "added_on",
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
            fields=["name", "amount", "row_status"],
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

    def _receive(self, row=None, inflow_type="FD Closures", **kwargs):
        """Record a credit row as a `Non Project Inflow` (#1266), tracking it for the purge."""
        row = row or self._next_credit_row()
        summary = create_non_project_inflow(row=row["name"], inflow_type=inflow_type, **kwargs)
        self.non_project_inflows.append(summary["settled"]["name"])
        return row, summary

    REFUND_AMOUNT = Decimal("1000.00")

    def _refund_row(self, amount=None):
        """An open credit row whose amount is set to `amount` (Rs 1,000 by default).

        ⚠️ THE FIXTURE'S CREDITS RUN TO Rs 25 LAKH, more than any one real PO was paid, and a refund
        may not exceed what its documents were paid. The row is this suite's own staged row and is
        purged with its batch, so its figure is the test's to set."""
        row = self._next_credit_row()
        amount = amount if amount is not None else self.REFUND_AMOUNT
        frappe.db.set_value(ROW_DOCTYPE, row["name"], "amount", amount, update_modified=False)
        frappe.db.commit()
        row["amount"] = amount
        return row

    def _po(self, name, amount):
        return {"document_type": "Procurement Orders", "document_name": name, "amount": amount}

    def _misc(self, amount, document_name="", description=None):
        """A Misc. Expense part: against no document."""
        part = {"document_type": "Misc. Expense", "document_name": document_name, "amount": amount}
        if description is not None:
            part["description"] = description
        return part

    def _refund(self, row=None, **kwargs):
        """Record a credit row as a `Vendor Refund`, tracking it for the purge."""
        row = row or self._refund_row()
        kwargs.setdefault("vendor", self.vendor)
        kwargs.setdefault("project", self.refund_project)
        kwargs.setdefault("allocations", [self._po(self.refund_pos[0], str(row["amount"]))])
        summary = create_vendor_refund(row=row["name"], **kwargs)
        self.vendor_refunds.extend(r["name"] for r in summary["records"])
        return row, summary

    def _twin_of(self, row_name, **changes):
        """A second staged row for the same credit, as an overlapping statement would produce."""
        twin = frappe.copy_doc(frappe.get_doc(ROW_DOCTYPE, row_name))
        twin.row_status = "Mismatched"
        twin.outcome_note = None
        twin.decided_at = None
        twin.decided_by = None
        twin.settlement_origin = None
        twin.update(changes)
        twin.insert(ignore_permissions=True)
        frappe.db.commit()
        self.addCleanup(lambda: frappe.db.delete(ROW_DOCTYPE, {"name": twin.name}))
        return {"name": twin.name, "row_status": twin.row_status}

    def _assert_nothing_written(self, row, count_before):
        """A refusal leaves no record, no match leg, and the row where it was."""
        self.assertEqual(frappe.db.count(NON_PROJECT_INFLOW), count_before)
        self.assertEqual(frappe.db.count(MATCH_DOCTYPE, {"import_row": row["name"]}), 0)
        self.assertEqual(
            frappe.db.get_value(ROW_DOCTYPE, row["name"], "row_status"), row["row_status"]
        )

    def _refusal(self, row, error=MoneyAlreadyRecordedError, create=None):
        """The refusal message; a create that was NOT refused is tracked for the purge, then fails.

        A bare `assertRaises` leaks the record when the guard is reverted to show a test RED.
        `create` defaults to `create_inflow`; `_non_project_call` passes the non-project path."""
        try:
            if create is None:
                summary = create_inflow(row=row["name"], project=self.project)
                bucket = self.inflows
            else:
                summary, bucket = create(row), self.non_project_inflows
        except error as refused:
            return str(refused)
        bucket.append(summary["settled"]["name"])
        self.fail(f"the create was not refused with {error.__name__}")

    def _non_project_call(self, row):
        return create_non_project_inflow(row=row["name"], inflow_type="Loan Received")


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
        self.assertEqual(Decimal(str(inflow.amount)), Decimal(str(row["amount"])))
        self.assertEqual(inflow.payment_date, row["added_on"].date())
        # #1259 (inverted): an ICICI credit stores its whole match surface, not the short reference.
        self.assertEqual(inflow.utr, match_surface(row["remarks"], row["reference_id"]))
        self.assertNotEqual(inflow.utr, row["bank_reference_no"])
        self.assertIsNone(inflow.invoice)

    def test_the_amount_is_a_real_number_because_the_column_is_Currency(self):
        """INVERTED at #1255: `Project Inflows.amount` was a **Data** column holding bare numeric
        strings, and this test used to pin the string. It is Currency now, so the settle writer
        hands it a number -- a string here would mean `format_amount_for` still treats the inflow
        ledger as text."""
        row, summary = self._record()
        stored = frappe.db.get_value(INFLOW_DOCTYPE, summary["settled"]["name"], "amount")
        self.assertIsInstance(stored, float)
        self.assertEqual(Decimal(str(stored)), Decimal(str(row["amount"])))
        self.assertEqual(format_amount_for(INFLOW_DOCTYPE, Decimal(str(stored))), stored)

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


class TestALongReferenceIsWrittenWhole(InflowFixture):
    """#1254: `Project Inflows.utr` is Text, so a long bank narration saves whole.

    Since #1259 an ICICI credit stores its own narration, so the long text goes on `remarks`."""

    def test_creating_an_inflow_stores_the_whole_narration(self):
        row = self._next_credit_row()
        narration = _give_row_a_long_narration(self, row["name"])

        _, summary = self._record(row=row)

        self.assertEqual(
            frappe.db.get_value(INFLOW_DOCTYPE, summary["settled"]["name"], "utr"), narration
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
    two imports of one credit contend on nothing. These lookups are the guard instead: the import's
    own earlier inflow, then the recorded-money guard every write endpoint shares (#1260)."""

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

    def _plant_inflow(self, row, utr, *, amount_delta=0):
        planted = frappe.new_doc(INFLOW_DOCTYPE)
        planted.update(
            {
                "project": self.project,
                "customer": self.customer,
                "utr": utr,
                "amount": format_amount_for(
                    INFLOW_DOCTYPE, Decimal(str(row["amount"])) + Decimal(amount_delta)
                ),
                "payment_date": row["added_on"].date(),
            }
        )
        planted.insert(ignore_permissions=True)
        frappe.db.commit()
        # Removed after THIS test, not the class: a refused row stays open, so the next test picks the
        # same row, and a planted record left behind would refuse it too.
        self.addCleanup(self._purge_planted, planted.name)
        return planted.name

    @staticmethod
    def _purge_planted(name):
        frappe.db.delete("Version", {"ref_doctype": INFLOW_DOCTYPE, "docname": name})
        frappe.db.delete(INFLOW_DOCTYPE, {"name": name})
        frappe.db.commit()

    def test_an_inflow_keyed_in_by_hand_blocks_the_import(self):
        """The measured hole: 330 of 463 live inflows carry a `utr` and NONE came from this import."""
        row = self._next_credit_row()
        planted = self._plant_inflow(row, row["bank_reference_no"])

        self.assertIn(planted, self._refusal(row))

    def test_an_inflow_carrying_the_whole_narration_blocks_the_import(self):
        """#1259: an ICICI settle stores the narration, so the check must be the contains-match. The
        old exact compare against `bank_reference_no` could never see this record."""
        row = self._next_credit_row()
        planted = self._plant_inflow(row, row["remarks"])

        self.assertIn(planted, self._refusal(row))
        self.assertNotEqual(
            frappe.db.get_value(ROW_DOCTYPE, row["name"], "row_status"), ROW_SETTLED
        )

    def test_a_reference_with_words_around_it_inside_the_narration_blocks_the_import(self):
        row = self._next_credit_row()
        self.assertTrue(row["bank_reference_no"], "fixture precondition: the credit has a reference")
        planted = self._plant_inflow(row, f"{row['bank_reference_no']} ICICI receipt")

        self.assertIn(planted, self._refusal(row))

    def test_a_different_amount_on_the_same_reference_asks_before_recording(self):
        """Inverted at #1260 (it asserted the create went through). A hit whose amount is off by more
        than the settle window leaves the line Mismatched in the match run, so the button refuses
        until the call confirms -- and then records."""
        row = self._next_credit_row()
        planted = self._plant_inflow(row, row["remarks"], amount_delta=500)

        self.assertIn(planted, self._refusal(row, error=RecordedMoneyNeedsConfirmationError))
        self.assertNotEqual(
            frappe.db.get_value(ROW_DOCTYPE, row["name"], "row_status"), ROW_SETTLED
        )
        self.assertEqual(frappe.db.count(MATCH_DOCTYPE, {"import_row": row["name"]}), 0)

        row, summary = self._record(row=row, confirm_mismatch=1)
        self.assertTrue(summary["settled"]["name"])

    def test_a_non_project_inflow_already_recorded_as_a_project_inflow_is_refused(self):
        """Ported from the receipt path (#1260): the recorded-money guard runs on this endpoint too,
        so whether a duplicate is caught never depends on which card the reviewer clicked."""
        row = self._next_credit_row()
        planted = self._plant_inflow(row, row["remarks"])
        before = frappe.db.count(NON_PROJECT_INFLOW)

        self.assertIn(planted, self._refusal(row, create=self._non_project_call))
        self._assert_nothing_written(row, before)

    def test_a_non_project_inflow_with_the_amount_off_asks_before_recording(self):
        row = self._next_credit_row()
        self._plant_inflow(row, row["remarks"], amount_delta=500)
        before = frappe.db.count(NON_PROJECT_INFLOW)

        self._refusal(
            row, error=RecordedMoneyNeedsConfirmationError, create=self._non_project_call
        )
        self._assert_nothing_written(row, before)

        row, summary = self._receive(row=row, confirm_mismatch=True)
        self.assertTrue(summary["settled"]["name"])

    def test_a_junk_reference_inside_the_narration_does_not_refuse(self):
        """Inverted at #1259 (it asserted a blank key). A reference with no eligible token --
        `ICICI`, a short code -- never refuses a receipt, even when the narration contains it."""
        row = self._next_credit_row()
        self._plant_inflow(row, "ICICI")

        row, summary = self._record(row=row)
        self.assertTrue(summary["settled"]["name"])

    def test_the_import_lookup_ignores_a_blank_transfer_id(self):
        class _Bare:
            transfer_id = ""

        self.assertEqual(_already_created_by_import(_Bare()), {})


class TestTheNonProjectInflowDuplicateGuards(InflowFixture):
    """#1268 (ADR-0016 A-D2): the duplicate check knows about `Non Project Inflows`.

    Its own class, so its own staged batch: recording CONSUMES a credit row, and the fixture holds
    few of them."""

    def _plant_non_project_inflow(self, row, utr, *, amount_delta=0):
        planted = frappe.new_doc(NON_PROJECT_INFLOW)
        planted.update(
            {
                "inflow_type": "FD Closures",
                "utr": utr,
                "amount": format_amount_for(
                    NON_PROJECT_INFLOW, Decimal(str(row["amount"])) + Decimal(amount_delta)
                ),
                "payment_date": row["added_on"].date(),
            }
        )
        planted.insert(ignore_permissions=True)
        frappe.db.commit()
        # Per test, for the reason `_plant_inflow` gives.
        self.addCleanup(self._purge_planted_non_project, planted.name)
        return planted.name

    @staticmethod
    def _purge_planted_non_project(name):
        frappe.db.delete("Version", {"ref_doctype": NON_PROJECT_INFLOW, "docname": name})
        frappe.db.delete(NON_PROJECT_INFLOW, {"name": name})
        frappe.db.commit()

    def test_a_non_project_inflow_keyed_in_by_hand_refuses_a_second_one(self):
        row = self._next_credit_row()
        planted = self._plant_non_project_inflow(row, row["remarks"])
        before = frappe.db.count(NON_PROJECT_INFLOW)

        refusal = self._refusal(row, create=self._non_project_call)
        self.assertIn(f"received on Non Project Inflow {planted}", refusal)
        self._assert_nothing_written(row, before)

    def test_a_non_project_inflow_keyed_in_by_hand_refuses_a_project_inflow(self):
        """Whichever card the reviewer clicks, the same money is not recorded in the other book."""
        row = self._next_credit_row()
        planted = self._plant_non_project_inflow(row, row["remarks"])
        before = frappe.db.count(INFLOW_DOCTYPE)

        self.assertIn(planted, self._refusal(row))
        self.assertEqual(frappe.db.count(INFLOW_DOCTYPE), before)
        self.assertEqual(frappe.db.count(MATCH_DOCTYPE, {"import_row": row["name"]}), 0)

    def test_a_non_project_inflow_with_the_amount_off_asks_before_recording_another(self):
        row = self._next_credit_row()
        planted = self._plant_non_project_inflow(row, row["remarks"], amount_delta=500)
        before = frappe.db.count(NON_PROJECT_INFLOW)

        refusal = self._refusal(
            row, error=RecordedMoneyNeedsConfirmationError, create=self._non_project_call
        )
        self.assertIn(planted, refusal)
        self._assert_nothing_written(row, before)

    def test_a_second_import_of_a_credit_recorded_as_a_non_project_inflow_is_refused(self):
        """An EARLIER IMPORT made the record: the twin line is refused and nothing is written."""
        row, summary = self._receive()
        twin = self._twin_of(row["name"])
        before = frappe.db.count(NON_PROJECT_INFLOW)

        # Through `_refusal`, so a reverted guard fails the test WITHOUT leaking a live record.
        refusal = self._refusal(
            twin,
            error=InflowNotRecordableError,
            create=lambda r: create_non_project_inflow(row=r["name"], inflow_type="FD Closures"),
        )
        self.assertIn(summary["settled"]["name"], refusal)
        self._assert_nothing_written(twin, before)

        # And the project-inflow card is refused on the same fact.
        self.assertIn(summary["settled"]["name"], self._refusal(twin, error=InflowNotRecordableError))

    def test_one_non_project_inflow_justifies_only_one_line_across_imports(self):
        """A DIFFERENT line carrying the same narration (next month's, say) may not skip on a record
        an import already created: it asks, naming the record and the batch it came from."""
        row, summary = self._receive()
        batch = frappe.db.get_value(ROW_DOCTYPE, row["name"], "import_batch")
        other = self._twin_of(row["name"], transfer_id=f"{frappe.generate_hash(length=10)}-OTHER")
        before = frappe.db.count(NON_PROJECT_INFLOW)

        refusal = self._refusal(
            other, error=RecordedMoneyNeedsConfirmationError, create=self._non_project_call
        )
        self.assertIn(f"Non Project Inflow {summary['settled']['name']} already accounts", refusal)
        self.assertIn(f"recorded from batch {batch}", refusal)
        self._assert_nothing_written(other, before)


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


class TestTheCustomerReceivableReport(InflowFixture):
    """#1255: the report summed the inflow amount through a text-parsing CASE, which PostgreSQL
    refuses outright once the column is numeric. It must run, and count a fractional inflow exactly.

    ⚠️ A DELTA, NOT A TOTAL -- the live site's inflows drift, so this measures the customer's total
    before and after planting one inflow.
    """

    def _customer_inflow_total(self):
        from nirmaan_stack.api.reports.customer_receivable_report import (
            get_customer_receivables_report,
        )

        for entry in get_customer_receivables_report():
            if entry["customer"] == self.customer:
                return Decimal(str(entry["total_inflow"]))
        return Decimal(0)

    def test_a_planted_inflow_moves_the_customer_s_total_by_its_exact_amount(self):
        before = self._customer_inflow_total()
        planted = frappe.new_doc(INFLOW_DOCTYPE)
        planted.update(
            {
                "project": self.project,
                "customer": self.customer,
                "utr": f"TEST-RECV-{frappe.generate_hash(length=10)}",
                "amount": 1234.56,
                "payment_date": frappe.utils.today(),
            }
        )
        planted.insert(ignore_permissions=True)
        frappe.db.commit()
        self.inflows.append(planted.name)

        # The report's payload is floats, so the paise are compared to 2 places.
        self.assertAlmostEqual(float(self._customer_inflow_total() - before), 1234.56, places=2)


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
        # #1266: the fifth ledger copies `Project Inflows`' Inflow Details, field name included.
        self.assertEqual(statement_attachment_field(NON_PROJECT_INFLOW), "inflow_attachment")
        self.assertEqual(statement_attachment_field(VENDOR_REFUND), "refund_attachment")
        for doctype in ("Project Payments", PROJECT_EXPENSE, "Non Project Expenses"):
            self.assertEqual(statement_attachment_field(doctype), "payment_attachment")

    def test_a_non_project_inflow_is_a_received_ledger_with_a_display_noun(self):
        """#1266: the received block of the settled panel and every duplicate note name it. The old
        `Non Project Expenses` is NOT in the received list (owner ruling 2026-09-24) -- a leftover B7
        receipt falls into the block's `Other` slot instead."""
        self.assertIn(NON_PROJECT_INFLOW, RECEIVED_LEDGER_DOCTYPES)
        self.assertNotIn(NON_PROJECT_EXPENSE, RECEIVED_LEDGER_DOCTYPES)
        self.assertEqual(
            LEDGER_NOUNS[NON_PROJECT_INFLOW], ("Non Project Inflow", "Non Project Inflows")
        )
        self.assertTrue(frappe.db.exists("DocType", NON_PROJECT_INFLOW))

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

    def test_no_ledger_keeps_the_data_amount_shape_any_more(self):
        # INVERTED TWICE, and both inversions are the record. At #1255 this ledger left the
        # bare-string shape it shared with `Project Expenses`; on 16 Sep 2026 `Project Expenses`
        # left too, so NOTHING stores an amount as text and `format_amount_for` lost its branch.
        for amount in (Decimal("44275"), Decimal("2500.50")):
            self.assertEqual(format_amount_for(INFLOW_DOCTYPE, amount), float(amount))
            self.assertEqual(format_amount_for(PROJECT_EXPENSE, amount), float(amount))
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
# #1266 -- a credit that belongs to NO project, recorded as a `Non Project Inflow` (ADR-0016
# Amendment A-D2). It replaced the B7 non-project receipt, which wrote a NEGATIVE `Non Project
# Expense`. The amount stored here is POSITIVE: the record is money received by its own doctype, so
# no sign has to carry that meaning.
# =================================================================================================


class TestTheNonProjectInflow(InflowFixture):
    """The happy path. ⚠️ AT MOST SIX CONSUMING TESTS PER CLASS: the ICICI fixture holds six open
    credits, and recording consumes one."""

    def test_it_carries_the_bank_row_s_own_figures_at_a_positive_amount(self):
        """⚠️ THE CLIENT NEVER SENDS A FIGURE. Amount, date and reference are read server-side."""
        row, summary = self._receive(inflow_type="Interest Payouts", description="FD 0057 interest")

        doc = frappe.db.get_value(
            NON_PROJECT_INFLOW,
            summary["settled"]["name"],
            ["inflow_type", "description", "amount", "payment_date", "utr", "inflow_attachment"],
            as_dict=True,
        )
        self.assertEqual(doc.inflow_type, "Interest Payouts")
        self.assertEqual(doc.description, "FD 0057 interest")
        # A real number, because the column is Currency, and the bank's own magnitude -- positive.
        self.assertIsInstance(doc.amount, float)
        self.assertGreater(doc.amount, 0)
        self.assertEqual(Decimal(str(doc.amount)), Decimal(str(row["amount"])))
        self.assertEqual(doc.payment_date, row["added_on"].date())
        # The full settlement reference -- on an ICICI credit, its whole match surface.
        self.assertEqual(doc.utr, match_surface(row["remarks"], row["reference_id"]))
        self.assertEqual(doc.inflow_attachment, "/private/files/test-statement.csv")

    def test_a_long_narration_is_stored_whole_as_the_utr(self):
        """`utr` is Text, copied from `Project Inflows` (#1254), so a long narration saves whole."""
        row = self._next_credit_row()
        narration = _give_row_a_long_narration(self, row["name"])

        _, summary = self._receive(row=row)

        self.assertEqual(
            frappe.db.get_value(NON_PROJECT_INFLOW, summary["settled"]["name"], "utr"), narration
        )

    def test_the_row_flips_to_settled_with_a_match_leg_recording_who_settled_it(self):
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
            ["target_doctype", "target_name", "target_amount", "match_kind", "matched_by"],
            as_dict=True,
        )
        self.assertEqual(match.target_doctype, NON_PROJECT_INFLOW)
        self.assertEqual(match.target_name, summary["settled"]["name"])
        self.assertEqual(match.match_kind, "Settled")
        self.assertEqual(Decimal(str(match.target_amount)), Decimal(str(row["amount"])))
        self.assertEqual(match.matched_by, frappe.session.user)

    def test_the_summary_reports_a_created_record(self):
        row, summary = self._receive()
        self.assertEqual(summary["settled"]["doctype"], NON_PROJECT_INFLOW)
        self.assertTrue(summary["settled"]["created"])
        self.assertEqual(summary["settled"]["amount"], float(row["amount"]))
        self.assertIsNone(summary["settled"]["original_amount"])
        self.assertFalse(summary["settled"]["amount_changed"])

    def test_the_screen_s_row_read_carries_the_record_so_the_line_can_link_it(self):
        """#1266 owner pick A: `get_outflow_rows` -- the ONLY read the screen uses -- sends a settled
        line's match records, so `rowSettlementLinks` can render the link to the record. It used to
        send `matches: []` on every row, so a created record was never linked."""
        row, summary = self._receive()
        page = get_outflow_rows(scope="all", batch=self.batch.name, limit=200)["rows"]
        by_name = {r["name"]: r for r in page}

        settled = [(m["target_doctype"], m["target_name"]) for m in by_name[row["name"]]["matches"]]
        self.assertEqual(settled, [(NON_PROJECT_INFLOW, summary["settled"]["name"])])
        # An open line carries none.
        open_rows = [r for r in page if r["row_status"] != ROW_SETTLED]
        self.assertTrue(open_rows)
        self.assertTrue(all(r["matches"] == [] for r in open_rows))

    def test_others_is_recorded_when_it_carries_a_description(self):
        _, summary = self._receive(inflow_type="Others", description="Vendor refund, PO 0123")
        doc = frappe.db.get_value(
            NON_PROJECT_INFLOW, summary["settled"]["name"], ["inflow_type", "description"], as_dict=True
        )
        self.assertEqual((doc.inflow_type, doc.description), ("Others", "Vendor refund, PO 0123"))


class TestTheNonProjectInflowRefusals(InflowFixture):
    """Each refusal writes NOTHING: no record, no match leg, and the row where it was."""

    def _refused(self, row, error, **kwargs):
        before = frappe.db.count(NON_PROJECT_INFLOW)
        with self.assertRaises(error):
            create_non_project_inflow(row=row["name"], **kwargs)
        self._assert_nothing_written(row, before)

    def test_a_debit_is_refused(self):
        """A debit recorded here would book money that LEFT the account as money received."""
        self._refused(self._next_debit_row(), InflowNotRecordableError, inflow_type="FD Closures")

    def test_a_missing_type_is_refused(self):
        for missing in ("", None, "   "):
            self._refused(self._next_credit_row(), InflowNotRecordableError, inflow_type=missing)

    def test_an_unknown_type_is_refused(self):
        self._refused(
            self._next_credit_row(), InflowNotRecordableError, inflow_type="Interest Received"
        )

    def test_others_without_a_description_is_refused(self):
        for blank in (None, "", "   "):
            self._refused(
                self._next_credit_row(),
                InflowNotRecordableError,
                inflow_type="Others",
                description=blank,
            )

    def test_a_credit_of_zero_or_less_is_refused(self):
        row = self._next_credit_row()
        # ⚠️ RESTORED AFTERWARDS: every test in this class refuses, so the next test picks the SAME
        # row and would otherwise meet a zeroed amount and fail on the wrong guard.
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
        self._refused(row, AmountMismatchError, inflow_type="FD Closures")

    def test_the_service_refuses_a_missing_or_debit_direction(self):
        """The service is callable by anything, so it re-checks the direction the endpoint read."""

        class _Row:
            amount = 1000
            added_on_date = None
            settlement_reference = "REF-1"

        for direction in (None, "", "Debit"):
            with self.assertRaises(InflowNotRecordableError):
                create_non_project_inflow_from_row(
                    _Row(), actor="Administrator", inflow_type="FD Closures", direction=direction
                )

    def test_an_already_settled_row_is_refused(self):
        row, _ = self._receive()
        before = frappe.db.count(NON_PROJECT_INFLOW)
        with self.assertRaises(frappe.ValidationError) as caught:
            create_non_project_inflow(row=row["name"], inflow_type="FD Closures")
        self.assertIn("already settled", str(caught.exception))
        self.assertEqual(frappe.db.count(NON_PROJECT_INFLOW), before)
        # The one leg from the first recording, and no second one; the row stays Settled.
        self.assertEqual(frappe.db.count(MATCH_DOCTYPE, {"import_row": row["name"]}), 1)
        self.assertEqual(frappe.db.get_value(ROW_DOCTYPE, row["name"], "row_status"), ROW_SETTLED)


# =================================================================================================
# A credit a VENDOR paid back, recorded as a `Vendor Refund` naming the vendor. It creates no payment,
# and each PO part lowers that PO's paid amount by the part.
# =================================================================================================


class TestTheVendorRefund(InflowFixture):
    """The happy path. ⚠️ AT MOST SIX CONSUMING TESTS PER CLASS: the fixture holds six open credits."""

    def _paid(self, po):
        return frappe.db.get_value("Procurement Orders", po, "amount_paid")

    def test_a_split_refund_writes_one_vendor_refund_per_document_and_no_payment(self):
        """⚠️ THE CLIENT SENDS WHO AND HOW MUCH. Date and reference are read off the row, and the parts
        must add up to the row's amount. Nothing lands in `Project Payments`; each PO's paid amount
        drops by its part."""
        first, second = self.refund_pos
        paid_before = {po: self._paid(po) for po in self.refund_pos}
        payments_before = frappe.db.count("Project Payments", {"vendor": self.vendor})
        row = self._refund_row()
        row, summary = self._refund(
            row=row,
            # JSON, as the screen posts it.
            allocations=frappe.as_json([self._po(first, 600), self._po(second, "400.00")]),
        )

        records = summary["records"]
        self.assertEqual([r["doctype"] for r in records], [VENDOR_REFUND, VENDOR_REFUND])
        for record, po, part in zip(records, (first, second), (600.0, 400.0)):
            refund = frappe.db.get_value(
                VENDOR_REFUND,
                record["name"],
                ["vendor", "project", "document_type", "document_name", "amount", "utr",
                 "payment_date", "refund_attachment"],
                as_dict=True,
            )
            self.assertEqual((refund.vendor, refund.project), (self.vendor, self.refund_project))
            self.assertEqual((refund.document_type, refund.document_name), ("Procurement Orders", po))
            self.assertEqual(refund.amount, part)
            self.assertEqual(refund.utr, match_surface(row["remarks"], row["reference_id"]))
            self.assertEqual(refund.payment_date, row["added_on"].date())
            self.assertEqual(refund.refund_attachment, "/private/files/test-statement.csv")
            self.assertEqual(
                Decimal(str(paid_before[po])) - Decimal(str(self._paid(po))), Decimal(str(part))
            )
        self.assertEqual(frappe.db.count("Project Payments", {"vendor": self.vendor}), payments_before)

        legs = frappe.get_all(
            MATCH_DOCTYPE,
            filters={"import_row": row["name"]},
            fields=["target_doctype", "target_amount", "created_by_import", "match_kind"],
            order_by="target_amount desc",
        )
        self.assertEqual(
            [(l.target_doctype, l.target_amount, l.created_by_import, l.match_kind) for l in legs],
            [(VENDOR_REFUND, 600.0, 1, "Settled"), (VENDOR_REFUND, 400.0, 1, "Settled")],
        )
        self.assertEqual(frappe.db.get_value(ROW_DOCTYPE, row["name"], "row_status"), ROW_SETTLED)

    def test_a_misc_expense_part_is_its_own_vendor_refund_against_no_document(self):
        """PO parts plus the rest as a Misc. Expense: one record each, the misc one naming no document
        and taking nothing off any PO's refundable amount."""
        po = self.refund_pos[0]

        def refunded():
            return {
                d["name"]: d
                for d in get_vendor_refund_documents(self.vendor, self.refund_project)["Procurement Orders"]
            }[po]["refunded"]

        before = refunded()
        row, summary = self._refund(
            row=self._refund_row(),
            allocations=frappe.as_json([self._po(po, "600"), self._misc("400")]),
        )
        records = summary["records"]
        self.assertEqual([r["amount"] for r in records], [600.0, 400.0])
        misc = frappe.db.get_value(
            VENDOR_REFUND,
            records[1]["name"],
            ["vendor", "project", "document_type", "document_name", "amount", "refund_attachment"],
            as_dict=True,
        )
        self.assertEqual((misc.vendor, misc.project), (self.vendor, self.refund_project))
        self.assertEqual((misc.document_type, misc.document_name), ("Misc. Expense", None))
        self.assertEqual(misc.amount, 400.0)
        self.assertEqual(misc.refund_attachment, "/private/files/test-statement.csv")
        # Only the PO part counts against the PO.
        self.assertEqual(Decimal(str(refunded())) - Decimal(str(before)), Decimal("600"))
        self.assertEqual(frappe.db.count(MATCH_DOCTYPE, {"import_row": row["name"]}), 2)
        self.assertEqual(frappe.db.get_value(ROW_DOCTYPE, row["name"], "row_status"), ROW_SETTLED)

    def test_without_a_project_each_refund_takes_its_document_s_project(self):
        """The project is optional: a PO part records the PO's project, a Misc. Expense part records none,
        and the Misc. Expense keeps its description."""
        po = self.refund_pos[0]
        _, summary = self._refund(
            row=self._refund_row(),
            project=None,
            allocations=[self._po(po, "700"), self._misc("300", description="  Scaffolding deposit  ")],
        )
        by_type = {
            r.document_type: r
            for r in frappe.get_all(
                VENDOR_REFUND,
                filters={"name": ["in", [x["name"] for x in summary["records"]]]},
                fields=["document_type", "project", "description"],
            )
        }
        self.assertEqual(by_type["Procurement Orders"].project, self.refund_project)
        self.assertIsNone(by_type["Procurement Orders"].description)
        self.assertIsNone(by_type["Misc. Expense"].project)
        self.assertEqual(by_type["Misc. Expense"].description, "Scaffolding deposit")

        # The vendor-wide list covers this project's POs too, and names each one's project.
        everywhere = get_vendor_refund_documents(self.vendor)["Procurement Orders"]
        here = get_vendor_refund_documents(self.vendor, self.refund_project)["Procurement Orders"]
        self.assertTrue({d["name"] for d in here} <= {d["name"] for d in everywhere})
        for document in everywhere:
            self.assertTrue(document["project"])
            self.assertTrue(document["project_name"])

    def test_an_earlier_refund_lowers_what_the_next_may_take(self):
        """A document cannot be refunded more, in total, than was paid on it. Measured as a change:
        other tests in this class refund the same PO and their records live until the class ends."""
        po = self.refund_pos[0]

        def offered():
            return {
                d["name"]: d
                for d in get_vendor_refund_documents(self.vendor, self.refund_project)["Procurement Orders"]
            }[po]

        before = offered()
        self._refund(row=self._refund_row())
        after = offered()
        self.assertEqual(
            Decimal(str(after["refunded"])) - Decimal(str(before["refunded"])), self.REFUND_AMOUNT
        )
        self.assertEqual(
            Decimal(str(after["refundable"])),
            Decimal(str(after["paid"])) - Decimal(str(after["refunded"])),
        )

        over = Decimal(str(after["refundable"])).quantize(Decimal("0.01")) + Decimal("0.01")
        row = self._refund_row(amount=over)
        count = frappe.db.count(VENDOR_REFUND)
        with self.assertRaises(InflowNotRecordableError) as caught:
            create_vendor_refund(
                row=row["name"], vendor=self.vendor, project=self.refund_project,
                allocations=[self._po(po, str(over))],
            )
        self.assertIn("already refunded", str(caught.exception))
        self.assertEqual(frappe.db.count(VENDOR_REFUND), count)

    def test_undo_deletes_the_vendor_refunds(self):
        row, summary = self._refund()
        name = summary["records"][0]["name"]
        result = unreconcile_row(row=row["name"], legs="all", reason="test: vendor refund undo")
        self.assertEqual([leg["verdict"] for leg in result["reversed"]], ["delete_created"])
        self.assertFalse(frappe.db.exists(VENDOR_REFUND, name))
        self.assertNotEqual(frappe.db.get_value(ROW_DOCTYPE, row["name"], "row_status"), ROW_SETTLED)

    def test_a_vendor_refund_line_is_only_undone_whole(self):
        """Reversing ONE refund of a split would strand the line part-allocated, where no refund can be
        recorded again -- so the plan offers Reverse all only and the write refuses a part."""
        first, second = self.refund_pos
        row, summary = self._refund(allocations=[self._po(first, "600"), self._po(second, "400")])
        names = [r["name"] for r in summary["records"]]

        plan = get_unreconcile_plan(row["name"])
        self.assertTrue(plan["reverse_all_only"])
        with self.assertRaises(frappe.ValidationError) as caught:
            unreconcile_row(row=row["name"], legs=frappe.as_json([plan["legs"][0]["match"]]), reason="test: part")
        self.assertIn("undone whole", str(caught.exception))
        for name in names:
            self.assertTrue(frappe.db.exists(VENDOR_REFUND, name))
        self.assertEqual(frappe.db.get_value(ROW_DOCTYPE, row["name"], "row_status"), ROW_SETTLED)

        result = unreconcile_row(row=row["name"], legs="all", reason="test: whole")
        self.assertEqual([leg["verdict"] for leg in result["reversed"]], ["delete_created", "delete_created"])
        for name in names:
            self.assertFalse(frappe.db.exists(VENDOR_REFUND, name))
        self.assertNotEqual(frappe.db.get_value(ROW_DOCTYPE, row["name"], "row_status"), ROW_SETTLED)

    def test_a_credit_recorded_as_a_refund_cannot_then_become_an_inflow(self):
        """The same money is not recorded again in another book, whichever card is clicked next."""
        row, summary = self._refund()
        twin = self._twin_of(row["name"])
        before = frappe.db.count(INFLOW_DOCTYPE)

        refusal = self._refusal(twin, error=InflowNotRecordableError)
        self.assertIn(summary["records"][0]["name"], refusal)
        self.assertEqual(frappe.db.count(INFLOW_DOCTYPE), before)

    def test_a_vendor_refund_is_a_received_ledger_with_a_display_noun(self):
        self.assertIn(VENDOR_REFUND, RECEIVED_LEDGER_DOCTYPES)
        self.assertEqual(LEDGER_NOUNS[VENDOR_REFUND], ("Vendor Refund", "Vendor Refunds"))
        self.assertTrue(frappe.db.exists("DocType", VENDOR_REFUND))

    def test_the_list_offers_only_paid_documents_newest_first(self):
        offered = get_vendor_refund_documents(self.vendor, self.refund_project)
        # A Misc. Expense names no document, so it has no list.
        self.assertEqual(set(offered), {"Procurement Orders", "Service Requests"})
        pos = offered["Procurement Orders"]
        for name in self.refund_pos:
            self.assertIn(name, [po["name"] for po in pos])
        self.assertEqual([po["creation"] for po in pos], sorted((po["creation"] for po in pos), reverse=True))
        for kind in offered.values():
            for document in kind:
                self.assertGreater(document["paid"], 0)


class TestTheVendorRefundRefusals(InflowFixture):
    """Each refusal writes NOTHING: no record, no match leg, and the row where it was."""

    def _refused(self, row, error=InflowNotRecordableError, expect=None, **kwargs):
        picks = {
            "vendor": self.vendor,
            "project": self.refund_project,
            "allocations": [self._po(self.refund_pos[0], str(row["amount"]))],
        }
        picks.update(kwargs)
        before = frappe.db.count(VENDOR_REFUND)
        with self.assertRaises(error) as caught:
            create_vendor_refund(row=row["name"], **picks)
        if expect:
            self.assertIn(expect, str(caught.exception))
        self.assertEqual(frappe.db.count(VENDOR_REFUND), before)
        self.assertEqual(frappe.db.count(MATCH_DOCTYPE, {"import_row": row["name"]}), 0)
        self.assertNotEqual(frappe.db.get_value(ROW_DOCTYPE, row["name"], "row_status"), ROW_SETTLED)

    def test_a_debit_is_refused(self):
        row = self._next_debit_row()
        self._refused(row, allocations=[self._po(self.refund_pos[0], str(row["amount"]))])

    def test_a_missing_vendor_or_allocation_is_refused(self):
        """The project is NOT required -- see `test_without_a_project_each_refund_takes_its_document_s_project`."""
        row = self._refund_row()
        for missing in ("", None, "   "):
            self._refused(row, vendor=missing)
        for empty in (None, [], "[]"):
            self._refused(row, allocations=empty)

    def test_a_document_that_is_not_a_po_or_wo_is_refused(self):
        row = self._refund_row()
        for kind, name in (("Project Payments", "PAY-1"), ("Project Expenses", "EXP-1")):
            self._refused(
                row,
                allocations=[{"document_type": kind, "document_name": name, "amount": "1000"}],
                expect="PO, a Work Order or a Misc. Expense",
            )

    def test_a_misc_expense_names_no_document_is_positive_and_appears_once(self):
        row = self._refund_row()
        first = self.refund_pos[0]
        self._refused(row, allocations=[self._misc("1000", document_name=first)], expect="leave the document blank")
        self._refused(row, allocations=[self._misc("0"), self._po(first, "1000")], expect="greater than 0")
        self._refused(row, allocations=[self._misc("500"), self._misc("500")], expect="Misc. Expense is chosen twice")
        self._refused(row, allocations=[self._po(first, "600"), self._misc("300")], expect="must match")

    def test_another_vendor_s_or_another_project_s_document_is_refused(self):
        row = self._refund_row()
        self._refused(row, vendor="VEN-NOT-A-VENDOR", expect="is not VEN-NOT-A-VENDOR's PO")
        self._refused(row, project="NOT-THIS-PROJECT", expect="is not on project NOT-THIS-PROJECT")

    def test_amounts_must_be_positive_within_paid_unique_and_add_up_to_the_refund(self):
        row = self._refund_row()
        first, second = self.refund_pos
        for bad in ("0", "-100"):
            self._refused(
                row, allocations=[self._po(first, bad), self._po(second, "1000")], expect="greater than 0"
            )
        self._refused(
            row, allocations=[self._po(first, "500"), self._po(first, "500")], expect="chosen twice"
        )
        self._refused(
            row, allocations=[self._po(first, "600"), self._po(second, "399.99")], expect="must match"
        )
        paid = frappe.db.get_value("Procurement Orders", first, "amount_paid")
        over = Decimal(str(paid)).quantize(Decimal("0.01")) + Decimal("0.01")
        big = self._refund_row(amount=over)
        self._refused(big, allocations=[self._po(first, str(over))], expect="no more than")

    def test_a_merged_or_unpaid_po_is_refused_and_not_offered(self):
        """A merged PO's payments moved to its master PO; an unpaid one has nothing to refund."""
        row = self._refund_row()
        for filters in (
            {"status": "Merged"},
            {"status": ["!=", "Merged"], "amount_paid": ["in", [0, None]]},
        ):
            po = frappe.db.get_value(
                "Procurement Orders",
                {**filters, "vendor": ["is", "set"], "project": ["is", "set"]},
                ["name", "vendor", "project"],
                as_dict=True,
            )
            if not po:
                continue
            self._refused(
                row,
                vendor=po.vendor,
                project=po.project,
                allocations=[self._po(po.name, "1000")],
            )
            offered = get_vendor_refund_documents(po.vendor, po.project)["Procurement Orders"]
            self.assertNotIn(po.name, [d["name"] for d in offered])

    def test_the_service_refuses_a_missing_or_debit_direction(self):
        class _Row:
            amount = 1000
            added_on_date = None
            settlement_reference = "REF-1"

        for direction in (None, "", "Debit"):
            with self.assertRaises(InflowNotRecordableError):
                create_vendor_refund_from_row(
                    _Row(),
                    actor="Administrator",
                    vendor=self.vendor,
                    project=self.refund_project,
                    allocations=[self._po(self.refund_pos[0], "1000")],
                    direction=direction,
                )

    def test_an_already_settled_row_is_refused(self):
        row, _ = self._refund()
        before = frappe.db.count(VENDOR_REFUND)
        with self.assertRaises(frappe.ValidationError) as caught:
            create_vendor_refund(
                row=row["name"],
                vendor=self.vendor,
                project=self.refund_project,
                allocations=[self._po(self.refund_pos[0], "1000")],
            )
        self.assertIn("already settled", str(caught.exception))
        self.assertEqual(frappe.db.count(VENDOR_REFUND), before)
        self.assertEqual(frappe.db.count(MATCH_DOCTYPE, {"import_row": row["name"]}), 1)


class TestTheReceiptPathIsGone(unittest.TestCase):
    """ADR-0016 Amendment A-D2: the endpoint and service are REMOVED, not just the card -- a live
    endpoint nobody calls can still write negative expenses."""

    def test_the_receipt_endpoint_no_longer_exists(self):
        self.assertFalse(hasattr(inflows_module, "create_non_project_receipt"))

    def test_the_receipt_service_no_longer_exists(self):
        self.assertFalse(hasattr(settle_module, "create_non_project_receipt_from_row"))


class TestTheIncomeExpenseTypes(unittest.TestCase):
    """The four `non_project = 1` income Expense Type fixtures (owner ruling Q19).

    Kept at #1266 although the import no longer writes them: they stay in `fixtures/expense_type.json`
    and are still offered by the manual Non-Project Expense dialog, which Amendment A-D3 leaves
    untouched. ⚠️ They must carry `non_project = 1` and not `project`, or that dialog cannot offer them.
    """

    INCOME_TYPES = ("Interest Received", "Fixed Deposit Proceeds", "Loan Received", "Advance Returned")

    def test_each_one_exists_and_is_scoped_non_project(self):
        for name in self.INCOME_TYPES:
            scoped = frappe.db.get_value(
                "Expense Type", name, ["non_project", "project"], as_dict=True
            )
            self.assertIsNotNone(scoped, f"{name!r} is missing -- run `bench migrate`")
            self.assertTrue(scoped.non_project, f"{name!r} must carry non_project = 1")
            self.assertFalse(scoped.project, f"{name!r} must NOT be offered on the project side")
