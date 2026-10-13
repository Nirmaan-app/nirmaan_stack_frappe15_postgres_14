# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Matching a bank credit line to a waiting Vendor Refund, and undoing it (#1401, ADR-0032).

A waiting refund (Reconciliation Pending, recorded from "Adjust Payments" before the bank line) counts
for nothing. Matching a credit line to it makes it Received with the line's reference and date, creates
no new record and writes one bank-match leg per refund (not created by the import). Only then does it
count: the PO's paid amount drops, the adjustment balance clears and the PO unlocks. One line may be
split across several waiting refunds by hand; together they must add up to the line exactly (owner,
2026-10-13). Unreconcile sends a matched refund back to waiting, keeps it, frees the line and brings the
balance and the lock back.

⚠️ THE ENDPOINTS COMMIT. The bank lines are `InflowFixture`'s staged ICICI batch (purged with it); the
POs, payments, adjustments and refunds are raw-SQL or endpoint rows on the fixture's real vendor and
project, purged by name in `tearDown`; the vendor's credit is put back as found by the fixture.
"""

import frappe
from frappe.utils import getdate

from nirmaan_stack.api.outflow_import.expenses import MoneyAlreadyRecordedError
from nirmaan_stack.api.outflow_import.waiting_refund_match import get_waiting_vendor_refunds, match_waiting_refunds
from nirmaan_stack.api.outflow_import.review import MATCH_DOCTYPE, ROW_DOCTYPE, match_batch
from nirmaan_stack.api.outflow_import.test_inflows import InflowFixture
from nirmaan_stack.api.outflow_import.unreconcile import get_unreconcile_plan, unreconcile_row
from nirmaan_stack.api.po_revisions.revision_po_check import check_po_in_pending_revisions
from nirmaan_stack.api.vendor_refunds import po_refund_fixture
from nirmaan_stack.api.vendor_refunds.list_refunds import get_vendor_refunds
from nirmaan_stack.api.vendor_refunds.po_refund_fixture import ADJ, PO
from nirmaan_stack.api.vendor_refunds.waiting_refunds import (
    mark_received_without_bank_line,
    record_waiting_refund,
    update_waiting_refund,
)
from nirmaan_stack.services.outflow_import.settle import InflowNotRecordableError
from nirmaan_stack.services.outflow_import.status import ROW_SETTLED, ROW_SKIPPED
from nirmaan_stack.services.vendor_refunds import CANCELLED, RECEIVED, RECONCILIATION_PENDING

VENDOR_REFUNDS = "Vendor Refunds"

#: Each PO is worth 10,000 and was paid 11,180: up to 1,180 genuinely overpaid.
TOTAL, PAID = 10000.0, 11180.0


class BankLineRefundFixture(InflowFixture):
    """Overpaid POs and waiting refunds on the fixture's vendor, purged by name after each test. Also
    read by `test_waiting_refund_suggestion` (#1402).

    ⚠️ AT MOST SIX CONSUMING TESTS PER CLASS: the fixture holds six open credits."""

    def setUp(self):
        frappe.set_user("Administrator")
        self.pos, self.adjustments, self.refunds = [], [], []

    def tearDown(self):
        frappe.set_user("Administrator")
        po_refund_fixture.purge(po_refund_fixture.po_scopes(self.pos, self.adjustments, self.refunds))

    # ── fixture ─────────────────────────────────────────────────────────────────

    def _overpaid_po(self, remaining):
        """A PO of the fixture's vendor paid 11,180 on 10,000 through one real Paid payment, its
        adjustment Pending at `remaining` (negative: the vendor owes that much back)."""
        po, adj = po_refund_fixture.overpaid_po(
            "TEST-1401", self.refund_project, self.vendor, PAID, TOTAL, remaining
        )
        self.pos.append(po)
        self.adjustments.append(adj)
        return po, adj

    def _waiting(self, po, amount, utr="TYPED-BY-PROCUREMENT", payment_date="2026-10-01"):
        """A waiting refund recorded through the real "Adjust Payments" endpoint."""
        name = record_waiting_refund(po_id=po, amount=amount, utr=utr, payment_date=payment_date)["refund"]
        self.refunds.append(name)
        return name

    def _reference_of(self, row):
        return frappe.db.get_value(ROW_DOCTYPE, row["name"], "settlement_reference")

    def _figures(self, po, adj):
        return (
            frappe.db.get_value(PO, po, "amount_paid"),
            frappe.db.get_value(ADJ, adj, ["remaining_impact", "status"]),
            check_po_in_pending_revisions(po)["is_payment_locked"],
        )

    def _match(self, row, refunds, **kwargs):
        return match_waiting_refunds(row=row["name"], refunds=frappe.as_json(refunds), **kwargs)


class TestMatchingAWaitingRefund(BankLineRefundFixture):
    """⚠️ AT MOST SIX CONSUMING TESTS PER CLASS: the fixture holds six open credits."""

    # ── the match ───────────────────────────────────────────────────────────────

    def test_matching_one_waiting_refund_makes_it_received_and_clears_the_adjustment(self):
        po, adj = self._overpaid_po(-1180)
        refund = self._waiting(po, 1180)
        self.assertIn(refund, [r["name"] for r in get_waiting_vendor_refunds(self.vendor)])
        self.assertEqual(self._figures(po, adj), (PAID, (-1180, "Pending"), True))
        row = self._refund_row(1180)
        refunds_before = frappe.db.count(VENDOR_REFUNDS)

        summary = self._match(row, [refund])

        self.assertEqual(frappe.db.count(VENDOR_REFUNDS), refunds_before, "matching creates no refund")
        doc = frappe.db.get_value(VENDOR_REFUNDS, refund, ["status", "utr", "payment_date", "amount"], as_dict=True)
        self.assertEqual(doc.status, RECEIVED)
        self.assertEqual(doc.utr, self._reference_of(row))
        self.assertEqual(getdate(doc.payment_date), getdate(row["added_on"]))
        self.assertEqual(doc.amount, 1180)
        legs = frappe.get_all(
            MATCH_DOCTYPE, {"import_row": row["name"]},
            ["target_doctype", "target_name", "target_amount", "created_by_import", "match_kind"],
        )
        self.assertEqual(
            [(l.target_doctype, l.target_name, l.target_amount, l.created_by_import, l.match_kind) for l in legs],
            [(VENDOR_REFUNDS, refund, 1180, 0, "Settled")],
        )
        self.assertEqual(frappe.db.get_value(ROW_DOCTYPE, row["name"], "row_status"), ROW_SETTLED)
        self.assertEqual(summary["records"], [{"doctype": VENDOR_REFUNDS, "name": refund, "amount": 1180.0}])
        # Only now does it count: paid drops, the balance clears, the lock lifts.
        paid, (remaining, status), locked = self._figures(po, adj)
        self.assertEqual(paid, PAID - 1180)
        self.assertEqual((abs(remaining), status, locked), (0, "Done", False))
        self.assertNotIn(refund, [r["name"] for r in get_waiting_vendor_refunds(self.vendor)])

    def test_one_line_split_across_two_waiting_refunds_on_two_pos(self):
        first_po, first_adj = self._overpaid_po(-1180)
        second_po, second_adj = self._overpaid_po(-820)
        first, second = self._waiting(first_po, 1180), self._waiting(second_po, 820)
        row = self._refund_row(2000)

        self._match(row, [first, second])

        for refund in (first, second):
            self.assertEqual(frappe.db.get_value(VENDOR_REFUNDS, refund, "status"), RECEIVED)
        self.assertEqual(
            sorted(frappe.get_all(MATCH_DOCTYPE, {"import_row": row["name"]}, pluck="target_name")),
            sorted([first, second]),
        )
        self.assertEqual(frappe.db.get_value(ROW_DOCTYPE, row["name"], "row_status"), ROW_SETTLED)
        for po, adj, part in ((first_po, first_adj, 1180), (second_po, second_adj, 820)):
            paid, (remaining, status), locked = self._figures(po, adj)
            self.assertEqual((paid, status, locked), (PAID - part, "Done", False))

    def test_refunds_that_do_not_add_up_to_the_line_are_refused_and_nothing_is_written(self):
        po, adj = self._overpaid_po(-1180)
        refund = self._waiting(po, 1180)
        row = self._refund_row(1500)

        with self.assertRaises(InflowNotRecordableError) as caught:
            self._match(row, [refund])

        self.assertIn("must match exactly", str(caught.exception))
        self.assertEqual(frappe.db.get_value(VENDOR_REFUNDS, refund, "status"), RECONCILIATION_PENDING)
        self.assertEqual(frappe.db.count(MATCH_DOCTYPE, {"import_row": row["name"]}), 0)
        self.assertEqual(self._figures(po, adj), (PAID, (-1180, "Pending"), True))

    def test_a_refund_that_is_not_waiting_is_refused(self):
        po, _adj = self._overpaid_po(-1180)
        refund = self._waiting(po, 1180)
        doc = frappe.get_doc(VENDOR_REFUNDS, refund)
        doc.status = CANCELLED
        doc.save(ignore_permissions=True)
        frappe.db.commit()
        row = self._refund_row(1180)

        with self.assertRaises(InflowNotRecordableError) as caught:
            self._match(row, [refund])

        self.assertIn(f"{refund} is Cancelled", str(caught.exception))
        self.assertEqual(frappe.db.count(MATCH_DOCTYPE, {"import_row": row["name"]}), 0)

    def test_a_waiting_refund_carrying_the_line_s_reference_is_not_money_already_recorded(self):
        """The credit duplicate guard counts only Received refunds: a waiting one whose typed UTR is the
        line's own reference is what the line should be matched to, not a reason to skip it."""
        po, _adj = self._overpaid_po(-1180)
        row = self._refund_row(1180)
        # Dated as the line, so the guard's date window would hold it if it counted.
        refund = self._waiting(po, 1180, utr=self._reference_of(row), payment_date=str(getdate(row["added_on"])))

        match_batch(self.batch.name)

        self.assertNotEqual(frappe.db.get_value(ROW_DOCTYPE, row["name"], "row_status"), ROW_SKIPPED)
        self._match(row, [refund])

        self.assertEqual(frappe.db.get_value(VENDOR_REFUNDS, refund, "status"), RECEIVED)

    def test_a_received_refund_carrying_the_line_s_reference_still_is(self):
        row = self._refund_row(1180)
        recorded_po, _ = self._overpaid_po(-1180)
        recorded = frappe.get_doc({
            "doctype": VENDOR_REFUNDS, "vendor": self.vendor, "document_type": PO,
            "document_name": recorded_po, "amount": 1180, "status": RECEIVED,
            "utr": self._reference_of(row), "payment_date": row["added_on"],
        }).insert(ignore_permissions=True)
        self.refunds.append(recorded.name)
        frappe.db.commit()
        waiting_po, _ = self._overpaid_po(-1180)
        waiting = self._waiting(waiting_po, 1180)

        with self.assertRaises(MoneyAlreadyRecordedError) as caught:
            self._match(row, [waiting])

        self.assertIn(recorded.name, str(caught.exception))
        self.assertEqual(frappe.db.get_value(VENDOR_REFUNDS, waiting, "status"), RECONCILIATION_PENDING)

    # ── unreconcile ─────────────────────────────────────────────────────────────

    def test_unreconcile_sends_a_matched_refund_back_to_waiting_and_frees_the_line(self):
        po, adj = self._overpaid_po(-1180)
        refund = self._waiting(po, 1180, utr="TYPED-BY-PROCUREMENT", payment_date="2026-10-01")
        row = self._refund_row(1180)
        self._match(row, [refund])

        plan = get_unreconcile_plan(row["name"])
        self.assertEqual([leg["verdict"] for leg in plan["legs"]], ["unmatch_refund"])
        result = unreconcile_row(row=row["name"], legs="all", reason="test: wrong refund matched")

        self.assertEqual([leg["verdict"] for leg in result["reversed"]], ["unmatch_refund"])
        doc = frappe.db.get_value(VENDOR_REFUNDS, refund, ["status", "utr", "payment_date", "amount"], as_dict=True)
        self.assertIsNotNone(doc, "a matched waiting refund is kept")
        self.assertEqual(
            (doc.status, doc.utr, getdate(doc.payment_date), doc.amount),
            (RECONCILIATION_PENDING, "TYPED-BY-PROCUREMENT", getdate("2026-10-01"), 1180),
        )
        self.assertNotEqual(frappe.db.get_value(ROW_DOCTYPE, row["name"], "row_status"), ROW_SETTLED)
        # The balance and the lock come back, the paid amount with them.
        self.assertEqual(self._figures(po, adj), (PAID, (-1180, "Pending"), True))
        self.assertIn(refund, [r["name"] for r in get_waiting_vendor_refunds(self.vendor)])

        # The line is free: it can be matched again.
        self._match(row, [refund])
        self.assertEqual(frappe.db.get_value(VENDOR_REFUNDS, refund, "status"), RECEIVED)


class TestMatchingANoBankLineRefund(BankLineRefundFixture):
    """#1403: an Admin marked a waiting refund Received with no bank line. It already counts, and it stays
    in the waiting pool, so the late bank line is matched to it (adding the bank leg, removing the "No
    bank proof" mark) instead of becoming a second refund. Unreconcile returns it to "Received, no bank
    line": it keeps counting."""

    def _no_bank_line(self, po, amount, **kwargs):
        refund = self._waiting(po, amount, **kwargs)
        mark_received_without_bank_line(refund=refund, reason="test: vendor confirmed by email")
        return refund

    def _mark(self, refund):
        return frappe.db.get_value(
            VENDOR_REFUNDS, refund,
            ["status", "no_bank_line", "no_bank_line_by", "no_bank_line_reason", "utr", "payment_date"],
            as_dict=True,
        )

    def _counted(self, po, adj):
        paid, (remaining, status), locked = self._figures(po, adj)
        return paid, abs(remaining) < 1, status, locked

    def test_a_late_bank_line_is_matched_to_it_with_no_second_refund(self):
        po, adj = self._overpaid_po(-1180)
        refund = self._no_bank_line(po, 1180)
        counted = (PAID - 1180, True, "Done", False)
        self.assertEqual(self._counted(po, adj), counted, "it counts before any bank line")
        self.assertIn(refund, [r["name"] for r in get_waiting_vendor_refunds(self.vendor)])
        row = self._refund_row(1180)
        refunds_before = frappe.db.count(VENDOR_REFUNDS)

        self._match(row, [refund])

        self.assertEqual(frappe.db.count(VENDOR_REFUNDS), refunds_before, "no second refund")
        mark = self._mark(refund)
        self.assertEqual((mark.status, mark.no_bank_line), (RECEIVED, 0), "the bank leg removes the badge")
        self.assertEqual(
            (mark.no_bank_line_by, mark.no_bank_line_reason),
            ("Administrator", "test: vendor confirmed by email"),
            "who marked it, and why, stay as its history",
        )
        self.assertEqual(mark.utr, self._reference_of(row))
        legs = frappe.get_all(MATCH_DOCTYPE, {"import_row": row["name"]}, ["target_name", "created_by_import"])
        self.assertEqual([(l.target_name, l.created_by_import) for l in legs], [(refund, 0)])
        self.assertEqual(frappe.db.get_value(ROW_DOCTYPE, row["name"], "row_status"), ROW_SETTLED)
        # It counted already; the match moves nothing.
        self.assertEqual(self._counted(po, adj), counted)
        self.assertNotIn(refund, [r["name"] for r in get_waiting_vendor_refunds(self.vendor)])

    def test_its_typed_reference_is_not_money_already_recorded_until_matched(self):
        po, _adj = self._overpaid_po(-1180)
        row = self._refund_row(1180)
        refund = self._no_bank_line(
            po, 1180, utr=self._reference_of(row), payment_date=str(getdate(row["added_on"]))
        )

        match_batch(self.batch.name)

        self.assertNotEqual(frappe.db.get_value(ROW_DOCTYPE, row["name"], "row_status"), ROW_SKIPPED)
        self._match(row, [refund])
        self.assertEqual(self._mark(refund).no_bank_line, 0)

    def test_unreconcile_returns_it_to_received_with_no_bank_line(self):
        po, adj = self._overpaid_po(-1180)
        refund = self._no_bank_line(po, 1180, utr="TYPED-BY-PROCUREMENT", payment_date="2026-10-01")
        row = self._refund_row(1180)
        self._match(row, [refund])

        plan = get_unreconcile_plan(row["name"])
        self.assertEqual([leg["verdict"] for leg in plan["legs"]], ["unmatch_refund"])
        self.assertIn("no bank line", plan["legs"][0]["what_happens"])
        unreconcile_row(row=row["name"], legs="all", reason="test: wrong refund matched")

        mark = self._mark(refund)
        self.assertEqual(
            (mark.status, mark.no_bank_line, mark.utr, getdate(mark.payment_date)),
            (RECEIVED, 1, "TYPED-BY-PROCUREMENT", getdate("2026-10-01")),
        )
        self.assertNotEqual(frappe.db.get_value(ROW_DOCTYPE, row["name"], "row_status"), ROW_SETTLED)
        # It still counts: paid stays down, the balance stays clear, the PO stays unlocked.
        self.assertEqual(self._counted(po, adj), (PAID - 1180, True, "Done", False))
        self.assertIn(refund, [r["name"] for r in get_waiting_vendor_refunds(self.vendor)])

        # The line is free and the refund waits for it again.
        self._match(row, [refund])
        self.assertEqual(self._mark(refund).no_bank_line, 0)


class TestABankMatchedRefundKeepsItsUtr(BankLineRefundFixture):
    """While a bank line is matched to a refund, its UTR is the line's reference, and Unreconcile reads
    it to know the match is still its own. So the UTR is fixed until the match is undone; the rest of
    its paperwork stays editable (story 10)."""

    def _row_of(self, po, refund):
        return next(r for r in get_vendor_refunds(PO, po) if r["name"] == refund)

    def test_its_utr_is_fixed_while_matched_and_editable_again_once_unmatched(self):
        po, _adj = self._overpaid_po(-1180)
        refund = self._waiting(po, 1180)
        row = self._refund_row(1180)
        self._match(row, [refund])
        reference = self._reference_of(row)
        self.assertTrue(self._row_of(po, refund)["bank_matched"], "the edit dialog locks the UTR on this")

        with self.assertRaises(frappe.ValidationError):
            update_waiting_refund(refund=refund, utr="TYPED-AFTER-THE-MATCH")
        update_waiting_refund(refund=refund, utr=reference, description="the slip came later")
        self.assertEqual(
            frappe.db.get_value(VENDOR_REFUNDS, refund, ["utr", "description"]), (reference, "the slip came later")
        )

        result = unreconcile_row(row=row["name"], legs="all", reason="test: wrong refund matched")
        self.assertEqual([leg["verdict"] for leg in result["reversed"]], ["unmatch_refund"])
        self.assertFalse(self._row_of(po, refund)["bank_matched"])

        update_waiting_refund(refund=refund, utr="TYPED-AGAIN")
        self.assertEqual(frappe.db.get_value(VENDOR_REFUNDS, refund, "utr"), "TYPED-AGAIN")
