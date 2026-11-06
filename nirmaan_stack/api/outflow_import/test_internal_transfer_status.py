# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Every screen and action treats an `Internal Transfer` line as final (#1620, spec #1619).

Nothing makes such a line yet at #1620, so each test stages one by hand and drives the endpoints a person
uses: the match run leaves it alone, it is under All and in no other tab or the Skipped popup, every hand
action refuses it with a sentence, and the summary keeps it out of Still open.

⚠️ RUNS AGAINST THE LIVE SITE DATABASE. Every batch and row this suite makes is purged in tearDown.
"""

import json
import unittest

import frappe

from nirmaan_stack.api.outflow_import.bulk_unreconcile import bulk_unreconcile_rows
from nirmaan_stack.api.outflow_import.expenses import allocate_row, create_expense, settle_row
from nirmaan_stack.api.outflow_import.internal_transfer_fixture import purge_imports
from nirmaan_stack.api.outflow_import.link_lines import link_rows_to_expense
from nirmaan_stack.api.outflow_import.review import (
    export_outflow_rows,
    get_outflow_rows,
    get_outflow_summary,
    match_batch,
    skip_row,
    unskip_row,
)
from nirmaan_stack.api.outflow_import.unreconcile import unreconcile_row
from nirmaan_stack.api.outflow_import.upload import BATCH_DOCTYPE, ROW_DOCTYPE
from nirmaan_stack.services.outflow_import.status import ROW_INTERNAL_TRANSFER, ROW_MISMATCHED

ICICI = "ICICI Bank Statement"


class InternalTransferLineFixture(unittest.TestCase):
    """Lines staged directly, as Administrator (who passes every role check)."""

    def setUp(self):
        super().setUp()
        frappe.set_user("Administrator")
        self.batches = []

    def tearDown(self):
        frappe.db.rollback()
        frappe.set_user("Administrator")
        purge_imports(self.batches, suite="internal transfer test purge")
        super().tearDown()

    def _batch(self, source=ICICI) -> str:
        doc = frappe.new_doc(BATCH_DOCTYPE)
        doc.update({"source": source, "status": "In Review"})
        doc.insert(ignore_permissions=True)
        self.batches.append(doc.name)
        return doc.name

    def _line(self, batch, *, status=ROW_INTERNAL_TRANSFER, direction="Debit", amount=5100.0, source=ICICI,
              transfer_id=None, status_raw="SUCCESS") -> str:
        transfer_id = transfer_id or f"it-{frappe.generate_hash(length=10)}"
        row = frappe.new_doc(ROW_DOCTYPE)
        row.update(
            {
                "import_batch": batch,
                "source": source,
                "transfer_id": transfer_id,
                "bank_reference_no": transfer_id,
                "amount": amount,
                "status_raw": status_raw,
                "direction": direction,
                "row_status": status,
                "remarks": "Made-up own move to a wallet",
                "added_on": "2026-03-04 10:00:00",
            }
        )
        row.insert(ignore_permissions=True)
        frappe.db.commit()
        return row.name

    def _status(self, row) -> str:
        return frappe.db.get_value(ROW_DOCTYPE, row, "row_status")


class TestTheMatchRunLeavesItAlone(InternalTransferLineFixture):
    def test_a_match_run_does_not_change_an_internal_transfer_line(self):
        batch = self._batch()
        line = self._line(batch)
        self._line(batch, status=ROW_MISMATCHED)
        match_batch(batch)
        self.assertEqual(self._status(line), ROW_INTERNAL_TRANSFER)


class TestItsTabIsAllOnly(InternalTransferLineFixture):
    def _names(self, scope, batch):
        return {r["name"] for r in get_outflow_rows(scope=scope, batch=batch, limit=200)["rows"]}

    def test_it_is_under_all_and_in_no_other_tab_or_the_skipped_popup(self):
        batch = self._batch()
        out_line = self._line(batch)
        in_line = self._line(batch, direction="Credit")
        self.assertTrue({out_line, in_line} <= self._names("all", batch))
        for scope in (
            "not_matched_outflow",
            "partly_outflow",
            "matched_outflow",
            "not_matched_inflow",
            "settled_inflow",
            "skipped",
            "skipped_outflow",
            "skipped_inflow",
        ):
            self.assertFalse({out_line, in_line} & self._names(scope, batch), scope)

    def test_the_all_count_matches_its_rows(self):
        batch = self._batch()
        self._line(batch)
        page = get_outflow_rows(scope="all", batch=batch, limit=200)
        self.assertEqual(page["tab_counts"]["all"], 1)
        self.assertEqual(page["status_counts"][ROW_INTERNAL_TRANSFER], 1)

    def test_the_export_names_it_under_its_own_status(self):
        batch = self._batch()
        self._line(batch)
        rows = export_outflow_rows(scope="all", batch=batch)["rows"]
        self.assertEqual([r["row_status"] for r in rows], [ROW_INTERNAL_TRANSFER])


class TestTheSummaryLeavesItOutOfOpenWork(InternalTransferLineFixture):
    def test_still_open_is_unchanged_and_the_status_is_counted_on_its_own(self):
        batch = self._batch()
        self._line(batch, status=ROW_MISMATCHED, amount=100.0)
        before = get_outflow_summary(batch=batch)["totals"]
        self._line(batch, amount=9000.0)
        totals = get_outflow_summary(batch=batch)["totals"]
        for key in ("open_rows", "open_value", "total_rows", "total_value", "skipped_rows", "settled_rows"):
            self.assertEqual(totals[key], before[key], key)
        self.assertEqual(totals["by_status"][ROW_INTERNAL_TRANSFER]["count"], 1)


class TestEveryHandActionRefusesIt(InternalTransferLineFixture):
    """Each refusal is a sentence that names the status, and the line is left as it was."""

    def _refused(self, action):
        with self.assertRaises(frappe.ValidationError) as caught:
            action()
        frappe.db.rollback()
        self.assertIn("Internal Transfer", str(caught.exception))

    def test_skip(self):
        line = self._line(self._batch())
        self._refused(lambda: skip_row(line, "a reason"))
        self.assertEqual(self._status(line), ROW_INTERNAL_TRANSFER)

    def test_unskip(self):
        line = self._line(self._batch())
        self._refused(lambda: unskip_row(line, "a reason"))
        self.assertEqual(self._status(line), ROW_INTERNAL_TRANSFER)

    def test_unreconcile(self):
        line = self._line(self._batch())
        self._refused(lambda: unreconcile_row(line, "all", "a reason"))
        self.assertEqual(self._status(line), ROW_INTERNAL_TRANSFER)

    def test_bulk_unreconcile(self):
        line = self._line(self._batch())
        result = bulk_unreconcile_rows(json.dumps([line]), "a reason")
        entry = result["lines"][0] if "lines" in result else result["results"][0]
        self.assertFalse(entry["undone"])
        self.assertIn("Internal Transfer", entry["reason"])
        self.assertEqual(self._status(line), ROW_INTERNAL_TRANSFER)

    def test_link(self):
        line = self._line(self._batch())
        self._refused(lambda: link_rows_to_expense(json.dumps([line]), "Non Project Expenses", "made-up-expense"))
        self.assertEqual(self._status(line), ROW_INTERNAL_TRANSFER)

    def test_allocate(self):
        line = self._line(self._batch())
        self._refused(lambda: allocate_row(line, json.dumps([{"target_doctype": "Project Payments", "target_name": "made-up-payment"}])))
        self.assertEqual(self._status(line), ROW_INTERNAL_TRANSFER)

    def test_create(self):
        line = self._line(self._batch())
        self._refused(lambda: create_expense(line, "Non Project Expenses", "made-up-type"))
        self.assertEqual(self._status(line), ROW_INTERNAL_TRANSFER)

    def test_confirm(self):
        line = self._line(self._batch())
        self._refused(lambda: settle_row(line, "Project Payments", "made-up-payment"))
        self.assertEqual(self._status(line), ROW_INTERNAL_TRANSFER)
