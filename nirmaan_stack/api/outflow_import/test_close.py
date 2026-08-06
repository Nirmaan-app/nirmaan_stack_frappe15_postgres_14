# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Tests for closing and reopening an import batch (Bulk Import Outflow, slice S6).

⚠️ RUNS AGAINST THE LIVE SITE DATABASE. Everything created is purged in `tearDownClass`.

The property these defend is the one that is easy to get subtly wrong: closing must record the
abandonment WITHOUT manufacturing per-row decisions, and the batch status must stay correct
afterwards as rows keep changing.
"""

import unittest
from dataclasses import replace

import frappe

from nirmaan_stack.api.outflow_import.review import (
    MATCH_DOCTYPE,
    close_batch,
    get_close_preview,
    reopen_batch,
    skip_row,
)
from nirmaan_stack.api.outflow_import.upload import BATCH_DOCTYPE, ROW_DOCTYPE, _stage_batch
from nirmaan_stack.services.outflow_import.parser import parse_statement
from nirmaan_stack.services.outflow_import.status import OPEN_ROW_STATUSES

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


class CloseFixture(unittest.TestCase):
    batches: list = []

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.batches = []

    @classmethod
    def tearDownClass(cls):
        frappe.db.delete(MATCH_DOCTYPE, {"import_batch": ["in", cls.batches]})
        for name in cls.batches:
            frappe.db.delete(ROW_DOCTYPE, {"import_batch": name})
            frappe.db.delete(BATCH_DOCTYPE, {"name": name})
        frappe.db.commit()
        super().tearDownClass()

    def _stage(self):
        batch = _stage_batch(
            _fresh_parse(),
            file_url="/private/files/test-statement.csv",
            filename="test-statement.csv",
            user="Administrator",
        )
        type(self).batches.append(batch.name)
        frappe.db.commit()
        return batch

    def _statuses(self, batch):
        return [
            r["row_status"]
            for r in frappe.get_all(
                ROW_DOCTYPE, filters={"import_batch": batch}, fields=["row_status"]
            )
        ]


class TestClosePreview(CloseFixture):
    def test_preview_reports_what_would_be_abandoned(self):
        batch = self._stage()
        preview = get_close_preview(batch.name)
        open_rows = [s for s in self._statuses(batch.name) if s in OPEN_ROW_STATUSES]
        self.assertEqual(preview["abandoned_rows"], len(open_rows))
        self.assertGreater(preview["abandoned_amount"], 0)
        self.assertEqual(len(preview["rows"]), len(open_rows))

    def test_preview_excludes_terminal_rows(self):
        batch = self._stage()
        preview = get_close_preview(batch.name)
        # The auto-skipped rows (failed transfer, in-file duplicate) are already terminal and are
        # not being abandoned by anyone.
        for row in preview["rows"]:
            self.assertIn(row["row_status"], OPEN_ROW_STATUSES)


class TestCloseBatch(CloseFixture):
    def test_closing_marks_the_batch_completed_with_exceptions(self):
        batch = self._stage()
        result = close_batch(batch.name, reason="Rest of the statement is next month's work")
        self.assertEqual(result["status"], "Completed with exceptions")
        self.assertEqual(
            frappe.db.get_value(BATCH_DOCTYPE, batch.name, "status"),
            "Completed with exceptions",
        )

    def test_closing_records_who_when_and_why(self):
        batch = self._stage()
        close_batch(batch.name, reason="Deferred")
        after = frappe.db.get_value(
            BATCH_DOCTYPE, batch.name, ["closed_at", "closed_by", "close_reason"], as_dict=True
        )
        self.assertIsNotNone(after.closed_at)
        self.assertEqual(after.closed_by, frappe.session.user)
        self.assertEqual(after.close_reason, "Deferred")

    def test_the_reason_is_optional(self):
        # Unlike a per-row manual skip, which always requires one -- closing abandons rows in bulk
        # without claiming a decision about any individual one.
        batch = self._stage()
        close_batch(batch.name)
        self.assertIsNone(frappe.db.get_value(BATCH_DOCTYPE, batch.name, "close_reason"))

    def test_closing_does_NOT_convert_open_rows_to_skipped(self):
        # THE point of this slice. A skip is a decision; auto-skipping on close would fabricate one
        # on every row and destroy the fact that they were never decided at all.
        batch = self._stage()
        before = self._statuses(batch.name)
        close_batch(batch.name)
        self.assertEqual(sorted(self._statuses(batch.name)), sorted(before))
        self.assertTrue(any(s in OPEN_ROW_STATUSES for s in self._statuses(batch.name)))

    def test_closing_leaves_no_skip_reason_on_any_row(self):
        batch = self._stage()
        close_batch(batch.name)
        reasons = frappe.get_all(
            ROW_DOCTYPE,
            filters={"import_batch": batch.name, "row_status": ["in", list(OPEN_ROW_STATUSES)]},
            fields=["skip_reason"],
        )
        self.assertTrue(all(r["skip_reason"] is None for r in reasons))

    def test_a_batch_with_nothing_open_closes_as_plain_completed(self):
        # `Completed with exceptions` would be a lie here -- there were no exceptions.
        batch = self._stage()
        for row in frappe.get_all(
            ROW_DOCTYPE,
            filters={"import_batch": batch.name, "row_status": ["in", list(OPEN_ROW_STATUSES)]},
            fields=["name"],
        ):
            skip_row(row["name"], "not ours")
        result = close_batch(batch.name)
        self.assertEqual(result["status"], "Completed")

    def test_closing_is_not_a_freeze(self):
        # Bookkeeping, not a lock: an abandoned row can still be decided afterwards.
        batch = self._stage()
        close_batch(batch.name)
        open_row = frappe.get_all(
            ROW_DOCTYPE,
            filters={"import_batch": batch.name, "row_status": ["in", list(OPEN_ROW_STATUSES)]},
            fields=["name"],
            limit=1,
        )[0]
        skip_row(open_row["name"], "handled offline")
        self.assertEqual(
            frappe.db.get_value(ROW_DOCTYPE, open_row["name"], "row_status"), "Skipped"
        )

    def test_deciding_the_last_open_row_of_a_closed_batch_makes_it_plainly_completed(self):
        # The flag is read on EVERY rollup, not only at close time, which is what lets the status
        # correct itself without either action knowing about the other.
        batch = self._stage()
        close_batch(batch.name)
        for row in frappe.get_all(
            ROW_DOCTYPE,
            filters={"import_batch": batch.name, "row_status": ["in", list(OPEN_ROW_STATUSES)]},
            fields=["name"],
        ):
            skip_row(row["name"], "handled offline")
        self.assertEqual(frappe.db.get_value(BATCH_DOCTYPE, batch.name, "status"), "Completed")


class TestReopenBatch(CloseFixture):
    def test_reopening_clears_the_close_and_the_status(self):
        batch = self._stage()
        close_batch(batch.name, reason="oops")
        reopen_batch(batch.name)
        after = frappe.db.get_value(
            BATCH_DOCTYPE, batch.name, ["closed_at", "closed_by", "close_reason", "status"],
            as_dict=True,
        )
        self.assertIsNone(after.closed_at)
        self.assertIsNone(after.closed_by)
        self.assertIsNone(after.close_reason)
        self.assertNotEqual(after.status, "Completed with exceptions")

    def test_reopening_a_batch_that_was_never_closed_is_harmless(self):
        batch = self._stage()
        reopen_batch(batch.name)
        self.assertIsNone(frappe.db.get_value(BATCH_DOCTYPE, batch.name, "closed_at"))

    def test_close_and_reopen_round_trip_restores_the_original_status(self):
        batch = self._stage()
        before = frappe.db.get_value(BATCH_DOCTYPE, batch.name, "status")
        close_batch(batch.name)
        reopen_batch(batch.name)
        self.assertEqual(frappe.db.get_value(BATCH_DOCTYPE, batch.name, "status"), before)


if __name__ == "__main__":
    unittest.main()
