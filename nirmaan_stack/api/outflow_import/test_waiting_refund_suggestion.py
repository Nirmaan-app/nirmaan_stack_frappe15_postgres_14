# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""The import run suggests a waiting Vendor Refund for a bank credit line (#1402, ADR-0032).

A bank statement's match run (the ICICI contains-guard run) attaches to each open credit line the
waiting refund(s) the pure rule `services/outflow_import/refund_suggestion` finds, and the screen's row
read hands them to the decision dialog ready to confirm. The accountant still confirms: the run writes
nothing to a refund, and the suggestion settles only through `waiting_refund_match.match_waiting_refunds`.

The only rule live on today's data is the bank reference: ICICI has no account or IFSC column.

⚠️ THE ENDPOINTS COMMIT. Same purge discipline as `test_waiting_refund_match` (its fixture).
"""

import frappe

from nirmaan_stack.api.outflow_import.review import ROW_DOCTYPE, SCOPE_ALL, get_outflow_rows, match_batch
from nirmaan_stack.api.outflow_import.test_waiting_refund_match import BankLineRefundFixture
from nirmaan_stack.api.vendor_refunds.waiting_refunds import mark_received_without_bank_line
from nirmaan_stack.services.outflow_import.normalize import normalize_reference
from nirmaan_stack.services.outflow_import.status import ROW_SETTLED
from nirmaan_stack.services.vendor_refunds import CANCELLED, RECEIVED


class TestTheRunSuggestsAWaitingRefund(BankLineRefundFixture):
    """⚠️ AT MOST SIX CONSUMING TESTS PER CLASS: the fixture holds six open credits."""

    def _line_with_reference(self, amount, reference):
        """An open credit line whose bank reference is `reference`."""
        row = self._refund_row(amount)
        frappe.db.set_value(
            ROW_DOCTYPE, row["name"],
            {"bank_reference_no": reference, "normalized_reference": normalize_reference(reference)},
            update_modified=False,
        )
        frappe.db.commit()
        return row

    def _shown(self, row):
        """The suggestion the screen's row read carries for this line."""
        rows = get_outflow_rows(scope=SCOPE_ALL, batch=self.batch.name, limit=500)["rows"]
        return next(r for r in rows if r["name"] == row["name"]).get("waiting_refund_suggestion")

    def _cancel(self, refund):
        doc = frappe.get_doc("Vendor Refunds", refund)
        doc.status = CANCELLED
        doc.save(ignore_permissions=True)
        frappe.db.commit()

    def test_a_waiting_refund_with_the_line_s_reference_is_suggested_ready_to_confirm(self):
        po, _adj = self._overpaid_po(-1180)
        reference = f"UTR1402{frappe.generate_hash(length=8)}"
        refund = self._waiting(po, 1180, utr=reference.lower())
        row = self._line_with_reference(1180, reference)

        match_batch(self.batch.name)

        self.assertEqual(
            self._shown(row),
            {
                "vendor": self.vendor,
                "basis": "Bank reference",
                "refunds": [{"name": refund, "amount": 1180.0, "label": po}],
            },
        )
        self.assertEqual(frappe.db.get_value("Vendor Refunds", refund, "status"), "Reconciliation Pending",
                         "the run only suggests")
        # The accountant confirms the suggestion as it stands.
        self._match(row, [r["name"] for r in self._shown(row)["refunds"]])
        self.assertEqual(frappe.db.get_value("Vendor Refunds", refund, "status"), RECEIVED)
        self.assertEqual(frappe.db.get_value(ROW_DOCTYPE, row["name"], "row_status"), ROW_SETTLED)

    def test_two_waiting_refunds_sharing_the_line_s_reference_are_suggested_as_a_split(self):
        first_po, _ = self._overpaid_po(-1180)
        second_po, _ = self._overpaid_po(-820)
        reference = f"UTR1402{frappe.generate_hash(length=8)}"
        first = self._waiting(first_po, 1180, utr=reference)
        second = self._waiting(second_po, 820, utr=reference)
        row = self._line_with_reference(2000, reference)

        match_batch(self.batch.name)

        shown = self._shown(row)
        self.assertEqual(sorted(r["name"] for r in shown["refunds"]), sorted([first, second]))
        self.assertEqual(sum(r["amount"] for r in shown["refunds"]), 2000)

    def test_a_refund_that_stopped_waiting_is_no_longer_suggested(self):
        po, _adj = self._overpaid_po(-1180)
        reference = f"UTR1402{frappe.generate_hash(length=8)}"
        refund = self._waiting(po, 1180, utr=reference)
        row = self._line_with_reference(1180, reference)
        match_batch(self.batch.name)
        self.assertIsNotNone(self._shown(row))

        self._cancel(refund)

        self.assertIsNone(self._shown(row), "the read drops a suggestion the pool no longer holds")
        match_batch(self.batch.name)
        self.assertIsNone(frappe.db.get_value(ROW_DOCTYPE, row["name"], "suggested_refunds"),
                          "a re-run clears it")

    def test_a_line_with_no_waiting_refund_of_its_reference_gets_no_suggestion(self):
        po, _adj = self._overpaid_po(-1180)
        self._waiting(po, 1180, utr="SOMETHING-ELSE")
        row = self._line_with_reference(1180, f"UTR1402{frappe.generate_hash(length=8)}")

        match_batch(self.batch.name)

        self.assertIsNone(self._shown(row))
        self.assertIsNone(frappe.db.get_value(ROW_DOCTYPE, row["name"], "suggested_refunds"))

    def test_a_refund_received_with_no_bank_line_is_suggested_for_its_late_bank_line(self):
        po, _adj = self._overpaid_po(-1180)
        reference = f"UTR1402{frappe.generate_hash(length=8)}"
        refund = self._waiting(po, 1180, utr=reference)
        mark_received_without_bank_line(refund=refund, reason="test: vendor confirmed by email")
        row = self._line_with_reference(1180, reference)

        match_batch(self.batch.name)

        self.assertEqual(
            self._shown(row),
            {
                "vendor": self.vendor,
                "basis": "Bank reference",
                "refunds": [{"name": refund, "amount": 1180.0, "label": po}],
            },
        )
        self._match(row, [refund])
        self.assertEqual(frappe.db.get_value("Vendor Refunds", refund, ["status", "no_bank_line"]), (RECEIVED, 0))
