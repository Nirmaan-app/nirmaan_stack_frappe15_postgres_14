# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Tests for the read-only production preview of duplicate skips (#1261).

⚠️ RUNS AGAINST THE LIVE SITE DATABASE, and the preview reads the WHOLE site on purpose -- that is what
the owner runs. So every assertion about verdicts is scoped to this suite's own batches, whose
references are random and dated 2031 so no live record can hit them. The write-nothing test snapshots
the whole import tables, because "nothing anywhere changed" is the claim.
"""

import io
import json
from contextlib import redirect_stdout
from datetime import timedelta
from unittest import mock

import frappe

from nirmaan_stack.api.outflow_import import duplicate_preview as P
from nirmaan_stack.api.outflow_import.review import _FROZEN_ROW_STATUSES, _match_order, match_batch
from nirmaan_stack.api.outflow_import.test_review import (
    _GUARD_DAY,
    OutflowReviewFixture,
    _random_reference,
    _stage_icici_statement,
)
from nirmaan_stack.api.outflow_import.upload import BATCH_DOCTYPE, ROW_DOCTYPE
from nirmaan_stack.services.outflow_import.status import (
    ROW_MISMATCHED,
    ROW_SKIPPED,
    STAGED_NOTE_NO_SETTLEMENT_PATH,
)


def _snapshot() -> dict:
    """Every import row, match record and batch, with every column a match run writes."""
    return {
        "rows": frappe.db.sql(
            """SELECT name, row_status, outcome_note, skip_reason, duplicate_basis::text AS basis,
                      resolved_vendor, suggested_doctype, suggested_name, auto_matched, match_basis,
                      suggestion_rule, modified
               FROM "tabOutflow Import Row" ORDER BY name""",
            as_dict=True,
        ),
        "matches": frappe.db.sql(
            """SELECT name, import_row, target_doctype, target_name, match_kind, modified
               FROM "tabOutflow Row Match" ORDER BY name""",
            as_dict=True,
        ),
        "batches": frappe.db.sql(
            """SELECT * FROM "tabOutflow Import Batch" ORDER BY name""", as_dict=True,
        ),
    }


class TestTheDuplicateSkipPreview(OutflowReviewFixture):
    """The base class stages a Cashfree export; this adds two ICICI statements and plants the records.

    Every verdict kind the owner must see is present, so no assertion below can pass on an empty report:
    a Cashfree expense skip and an amount-off note, an ICICI skip and an amount-off note, and a line in
    the LATER statement blocked by a record the EARLIER statement's preview skip used (#1258).
    """

    @classmethod
    def setUpClass(cls):
        cls.refs = {key: _random_reference() for key in ("pay", "off", "acct", "old_skip")}
        cls.tid_prefix = f"T1261{frappe.generate_hash(length=6).upper()}"
        super().setUpClass()

        cls.before = _snapshot()
        cls.printed = io.StringIO()
        with redirect_stdout(cls.printed):
            cls.report_return = P.run()
        cls.after = _snapshot()
        cls.report = P.build_preview()

    @classmethod
    def _line(cls, key, narration, amount, *, day=_GUARD_DAY):
        return {
            "key": key, "tid": f"{cls.tid_prefix}{key.upper()}", "narration": narration,
            "amount": amount, "credit": False, "cheque": "", "day": day,
        }

    @classmethod
    def _plant_targets(cls):
        r, d = cls.refs, _GUARD_DAY.date()

        # Cashfree (the base batch): a Paid expense on 0004 -> skip; Rs 100 off on 0007 -> Mismatched.
        four, seven = cls._row("0004"), cls._row("0007")
        cls.exp_paid = cls._insert_project_expense(
            amount=four.amount, status="Paid", payment_ref=four.bank_reference_no,
            payment_date=four.added_on.date(),
        )
        cls.exp_short = cls._insert_project_expense(
            amount=seven.amount + 100, status="Paid", payment_ref=seven.bank_reference_no,
            payment_date=seven.added_on.date(),
        )

        cls.first = _stage_icici_statement(
            [
                cls._line("pay", f"MMT/IMPS/{r['pay']}/TESTPAYEE/SBIN0017034", 12500),
                cls._line("off", f"MMT/IMPS/{r['off']}/TESTPAYEE/SBIN0017034", 20000),
                cls._line("acct1", f"NEFT-{r['acct']}-TEST VENDOR PVT-UTIB0000052", 15000),
                cls._line("plain", "NEFT-NOTHINGHERE-TEST VENDOR", 3333),
                cls._line("frozen", f"MMT/IMPS/{r['pay']}/FROZEN", 12500),
            ],
            f"test-1261-first-{cls.tid_prefix}.csv",
        )
        cls.batches.append(cls.first.name)
        cls.second = _stage_icici_statement(
            [cls._line("acct3", f"NEFT-{r['acct']}-TEST VENDOR PVT/APR", 15000, day=_GUARD_DAY + timedelta(days=5))],
            f"test-1261-second-{cls.tid_prefix}.csv",
        )
        cls.batches.append(cls.second.name)
        # The second statement is uploaded LATER, so every match order puts it after the first.
        frappe.db.set_value(
            BATCH_DOCTYPE, cls.second.name, "uploaded_at",
            frappe.utils.add_to_date(frappe.db.get_value(BATCH_DOCTYPE, cls.first.name, "uploaded_at"), seconds=1),
            update_modified=False,
        )

        cls.rec_pay = cls._insert_payment_row(amount=12500, status="Paid", utr=r["pay"], payment_date=d)
        cls.rec_off = cls._insert_payment_row(amount=20500, status="Paid", utr=r["off"], payment_date=d)
        cls.rec_acct = cls._insert_payment_row(amount=15000, status="Paid", utr=r["acct"], payment_date=d)

        # A person skipped this line -- frozen, so neither the run nor the preview may consider it.
        frappe.db.set_value(
            ROW_DOCTYPE, cls._name_of(cls.first.name, "frozen"),
            {"row_status": ROW_SKIPPED, "outcome_note": "Skipped by a person."}, update_modified=False,
        )
        # An ICICI duplicate skip from BEFORE #1258: its note names a record, but it stored no basis, so it
        # claims nothing. The owner must see how many of these production has (domain doc, #1258 gap).
        cls.old_skip_batch = _stage_icici_statement(
            [cls._line("oldskip", f"MMT/IMPS/{r['old_skip']}/OLD", 4000)],
            f"test-1261-old-{cls.tid_prefix}.csv",
        )
        cls.batches.append(cls.old_skip_batch.name)
        cls.old_skip = cls._name_of(cls.old_skip_batch.name, "oldskip")
        frappe.db.set_value(
            ROW_DOCTYPE, cls.old_skip,
            {"row_status": ROW_SKIPPED, "outcome_note": "Already recorded as Paid on Project Payment PAY-OLD.",
             "duplicate_basis": None},
            update_modified=False,
        )

    @classmethod
    def _name_of(cls, batch, key):
        return frappe.db.get_value(
            ROW_DOCTYPE, {"import_batch": batch, "transfer_id": f"{cls.tid_prefix}{key.upper()}"}, "name",
        )

    def _entries(self, report=None):
        """This suite's entries, keyed by transfer suffix (Cashfree) or line key (ICICI)."""
        out = {}
        for block in (report or self.report)["batches"]:
            if block["batch"] not in self.batches:
                continue
            for entry in block["rows"]:
                tid = entry["transfer_id"]
                key = tid[len(self.tid_prefix):].lower() if tid.startswith(self.tid_prefix) else tid[-4:]
                out[key] = entry
        return out

    # --- writes nothing ------------------------------------------------------------------------------

    def test_running_it_writes_nothing(self):
        self.assertEqual(self.before["rows"], self.after["rows"])
        self.assertEqual(self.before["matches"], self.after["matches"])
        self.assertEqual(self.before["batches"], self.after["batches"])

    def test_the_database_itself_refuses_a_write_during_the_preview(self):
        """The guarantee is structural: a READ ONLY transaction, so a future edit that writes fails loudly."""
        real_build = P.build_preview

        def _writes(batch=None):
            frappe.db.sql(
                'UPDATE "tabOutflow Import Batch" SET modified = modified WHERE name = %s', (self.first.name,)
            )
            return real_build(batch=self.first.name)

        with mock.patch.object(P, "build_preview", _writes), redirect_stdout(io.StringIO()):
            # Frappe turns PostgreSQL's ReadOnlySqlTransaction into its own read-only-mode error.
            with self.assertRaises(frappe.InReadOnlyMode):
                P.run()
        # ...and the session is writable again afterwards.
        frappe.db.sql('UPDATE "tabOutflow Import Batch" SET modified = modified WHERE name = %s', (self.first.name,))
        frappe.db.rollback()

    # --- the verdicts --------------------------------------------------------------------------------

    def test_every_verdict_kind_is_present(self):
        entries = self._entries()
        self.assertEqual(entries["0004"]["verdict"], ROW_SKIPPED)
        self.assertEqual(entries["0007"]["verdict"], ROW_MISMATCHED)
        self.assertEqual(entries["pay"]["verdict"], ROW_SKIPPED)
        self.assertEqual(entries["off"]["verdict"], ROW_MISMATCHED)
        self.assertEqual(entries["acct1"]["verdict"], ROW_SKIPPED)
        self.assertEqual(entries["acct3"]["verdict"], ROW_MISMATCHED)

    def test_a_row_the_guard_says_nothing_about_and_a_frozen_row_are_not_listed(self):
        entries = self._entries()
        self.assertNotIn("plain", entries)
        self.assertNotIn("frozen", entries)

    def test_each_entry_names_its_records(self):
        entries = self._entries()
        self.assertEqual([r["name"] for r in entries["0004"]["records"]], [self.exp_paid])
        self.assertEqual([r["name"] for r in entries["pay"]["records"]], [self.rec_pay])
        self.assertEqual([r["doctype"] for r in entries["pay"]["records"]], ["Project Payments"])
        self.assertIn(self.rec_acct, entries["acct3"]["note"])

    def test_a_skip_in_an_earlier_batch_blocks_a_later_line_as_the_real_run_would(self):
        """RED if the preview does not carry its unpersisted skips forward to later batches."""
        note = self._entries()["acct3"]["note"]
        self.assertIn("already accounts", note)
        self.assertIn(self.first.name, note)

    def test_its_verdicts_equal_a_real_match_run(self):
        """The preview is taken first; then the real run on this suite's batches, in the run's own order."""
        entries = self._entries()
        order = _match_order(
            frappe.get_all(BATCH_DOCTYPE, filters={"name": ["in", self.batches]}, fields=["name", "uploaded_at"])
        )
        for batch in order:
            match_batch(batch)

        rows = frappe.get_all(
            ROW_DOCTYPE, filters={"import_batch": ["in", self.batches]},
            fields=["name", "transfer_id", "row_status", "outcome_note", "import_batch"],
        )
        # Rows frozen when the preview ran (the planted ones, and the fixture's lines skipped at upload).
        frozen = {r["name"] for r in self.before["rows"] if r["row_status"] in _FROZEN_ROW_STATUSES}
        self.assertIn(self._name_of(self.first.name, "frozen"), frozen)
        checked = 0
        for row in rows:
            if row["name"] in frozen:
                continue
            tid = row["transfer_id"]
            key = tid[len(self.tid_prefix):].lower() if tid.startswith(self.tid_prefix) else tid[-4:]
            with self.subTest(key=key):
                entry = entries.get(key)
                if entry is None:
                    self.assertNotEqual(row["row_status"], ROW_SKIPPED)
                    self.assertNotIn("Already recorded", row["outcome_note"] or "")
                    self.assertNotIn("already accounts", row["outcome_note"] or "")
                else:
                    self.assertEqual(row["row_status"], entry["verdict"])
                    self.assertEqual(row["outcome_note"], entry["note"])
                    self.assertEqual(row["name"], entry["row"])
                    checked += 1
        # Every listed entry was checked against the run, and there were at least the six planted ones.
        self.assertEqual(checked, len(entries))
        self.assertGreaterEqual(checked, 6)
        self.assertEqual(
            frappe.db.get_value(ROW_DOCTYPE, self._name_of(self.first.name, "plain"), "outcome_note"),
            STAGED_NOTE_NO_SETTLEMENT_PATH,
        )

    # --- the older basis-less skips ------------------------------------------------------------------

    def test_an_icici_duplicate_skip_with_no_stored_basis_is_counted(self):
        names = {s["row"] for s in self.report["unclaimed_skips"]}
        self.assertIn(self.old_skip, names)
        self.assertEqual(self.report["totals"]["unclaimed_skips"], len(self.report["unclaimed_skips"]))

    # --- the output ----------------------------------------------------------------------------------

    def test_the_output_is_grouped_by_batch_with_a_count_summary(self):
        text = self.printed.getvalue()
        first_at = text.index(f"Batch {self.first.name}")
        second_at = text.index(f"Batch {self.second.name}")
        self.assertLess(first_at, second_at)
        # Each batch's rows sit under its own header.
        self.assertLess(first_at, text.index(self._name_of(self.first.name, "pay")))
        self.assertLess(text.index(self._name_of(self.first.name, "pay")), second_at)
        self.assertLess(second_at, text.index(self._name_of(self.second.name, "acct3")))
        totals = self.report["totals"]
        self.assertIn(f"Would skip:                    {totals['skip']}", text)
        self.assertIn(f"Would stay Mismatched (named): {totals['mismatched']}", text)
        self.assertIn("WROTE NOTHING", text)

    def test_the_bench_entry_point_prints_rather_than_returns(self):
        """`bench execute` json-dumps a truthy return value after the text -- noise the owner would have to read past."""
        self.assertIsNone(self.report_return)

    def test_the_report_is_json_serialisable(self):
        json.dumps(self.report, default=str)

    def test_a_mistyped_batch_is_refused_rather_than_reported_empty(self):
        with self.assertRaises(frappe.ValidationError):
            P.build_preview(batch=f"OFI-NO-SUCH-{frappe.generate_hash(length=6)}")

    def test_a_single_batch_can_be_previewed(self):
        report = P.build_preview(batch=self.first.name)
        self.assertEqual([b["batch"] for b in report["batches"]], [self.first.name])
