# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Move a Cashbook spend to Internal Transfer, keeping its bill as the transfer's proof (#1762, spec #1753 stories
13, 27-28).

    devenv.sh test --module nirmaan_stack.api.outflow_import.test_cashbook_rectify_transfer

Seam: the Move plan and write calls (`rectify.get_rectify_plan`, `rectify.rectify_lines`) on a Cashbook statement
imported end to end (`test_cashbook_rectify.CashbookRectifyCase`). Read back the way the screens read it: the line,
its Internal Transfer record, the expense, the bills.
"""

import frappe

from nirmaan_stack.api.expenses.test_expense_bills import bills_of
from nirmaan_stack.api.outflow_import import rectify
from nirmaan_stack.api.outflow_import.test_cashbook_bills import ONE_LINK
from nirmaan_stack.api.outflow_import.test_cashbook_rectify import (
    PART_REFUND,
    PART_SPEND,
    REASON,
    CashbookRectifyCase,
)

INTERNAL_TRANSFER = "Internal Transfer"
WALLET = "Cashbook Employee Wallet"
CARD = "ICICI Credit Card"


class TransferCase(CashbookRectifyCase):
    def setUp(self):
        super().setUp()
        # Runs before the import's purge (last in, first out): the bills' Files now sit on the transfer records.
        self.addCleanup(self._purge_record_files)

    def _purge_record_files(self):
        frappe.db.rollback()
        records = frappe.get_all(INTERNAL_TRANSFER, filters={"import_row": ["in", self._lines()]}, pluck="name")
        if records:
            frappe.db.delete("File", {"attached_to_doctype": INTERNAL_TRANSFER, "attached_to_name": ["in", records]})
            frappe.db.commit()

    def _to_transfer(self, txns, other_end=CARD, detail="Card ending 4321", reason=REASON) -> dict:
        names = [self._line(t).name for t in txns]
        return rectify.rectify_lines(
            frappe.as_json(names), reason=reason, destination=INTERNAL_TRANSFER, other_end=other_end, detail=detail
        )

    def _record(self, txn: str):
        return frappe.get_doc(INTERNAL_TRANSFER, {"import_row": self._line(txn).name})


class TestASpendWithItsBillMovesToInternalTransfer(TransferCase):
    def test_the_record_keeps_the_bill_as_proof_no_expense_is_left_and_the_line_is_internal_transfer(self):
        old = self._expense(ONE_LINK)
        [old_bill] = bills_of(old.doctype, old.name)
        self.assertTrue(old_bill.bill_file)

        result = self._to_transfer([ONE_LINK])

        [line] = result["lines"]
        self.assertTrue(line["rectified"], line)
        # No expense is left: the old one is gone and no live match names another.
        self.assertFalse(frappe.db.exists(old.doctype, old.name))
        self.assertEqual([leg.match_kind for leg in self._legs(ONE_LINK)], ["Reversed"])
        self.assertEqual(self._legs(ONE_LINK)[0].reversal_reason, REASON)
        self.assertEqual(self._line(ONE_LINK).row_status, INTERNAL_TRANSFER)

        record = self._record(ONE_LINK)
        self.assertEqual(
            (record.from_place, record.to_place, record.detail, record.direction, float(record.amount)),
            (WALLET, CARD, "Card ending 4321", "Out", 2380.0),
        )
        self.assertEqual((record.made_by, record.marked_by, record.mark_reason), ("by hand", "Administrator", REASON))
        # The bill is the record's proof, and its one File now belongs to the record, so no delete takes it.
        self.assertEqual(record.proof, old_bill.bill_file)
        self.assertEqual(
            frappe.db.count("File", {"file_url": record.proof, "attached_to_doctype": INTERNAL_TRANSFER,
                                     "attached_to_name": record.name}),
            1,
        )
        # The Expense bill stays, as history.
        [bill] = frappe.get_all("Expense Bill", filters={"name": old_bill.name}, fields=["is_latest", "bill_file"])
        self.assertEqual((bill.is_latest, bill.bill_file), (0, old_bill.bill_file))


class TestASpendAndItsRefundBothBecomeTransfers(TransferCase):
    def test_each_line_gets_its_own_record_the_refund_coming_back_from_the_far_end(self):
        result = self._to_transfer([PART_SPEND, PART_REFUND], other_end=CARD, detail="")

        self.assertTrue(all(line["rectified"] for line in result["lines"]), result)
        spend, refund = self._record(PART_SPEND), self._record(PART_REFUND)
        self.assertEqual((spend.from_place, spend.to_place, spend.direction), (WALLET, CARD, "Out"))
        self.assertEqual((refund.from_place, refund.to_place, refund.direction), (CARD, WALLET, "In"))
        # A refund carries no bill, so its record has no proof.
        self.assertFalse(refund.proof)
        for txn in (PART_SPEND, PART_REFUND):
            self.assertEqual(self._line(txn).row_status, INTERNAL_TRANSFER)
            self.assertEqual([leg.match_kind for leg in self._legs(txn)], ["Reversed"])


class TestAMoveToInternalTransferIsRefused(TransferCase):
    def _nothing_moved(self, txn: str, expense):
        self.assertTrue(frappe.db.exists(expense.doctype, expense.name))
        self.assertEqual(self._line(txn).row_status, "Settled")
        self.assertFalse(frappe.db.exists(INTERNAL_TRANSFER, {"import_row": self._line(txn).name}))

    def test_to_the_lines_own_wallet_or_to_no_place_the_whole_write_is_refused(self):
        expense = self._expense(ONE_LINK)
        for other_end in (WALLET, "", "Somewhere Else"):
            with self.assertRaises(frappe.ValidationError, msg=other_end):
                self._to_transfer([ONE_LINK], other_end=other_end)
        self._nothing_moved(ONE_LINK, expense)

    def test_to_a_destination_that_is_none_of_the_three(self):
        expense = self._expense(ONE_LINK)
        with self.assertRaises(frappe.ValidationError):
            rectify.rectify_lines(frappe.as_json([self._line(ONE_LINK).name]), reason=REASON, destination="Internal")
        self._nothing_moved(ONE_LINK, expense)

    def test_without_a_reason(self):
        expense = self._expense(ONE_LINK)
        with self.assertRaises(frappe.ValidationError):
            self._to_transfer([ONE_LINK], reason="  ")
        self._nothing_moved(ONE_LINK, expense)

    def test_a_spend_without_its_refund_is_refused_naming_it(self):
        expense = self._expense(PART_SPEND)
        result = self._to_transfer([PART_SPEND])
        [line] = result["lines"]
        self.assertFalse(line["rectified"])
        self.assertIn(PART_REFUND, line["reason"])
        self._nothing_moved(PART_SPEND, expense)

    def test_the_mark_still_refuses_a_settled_line(self):
        from nirmaan_stack.api.outflow_import.internal_transfer_actions import mark_internal_transfer

        expense = self._expense(ONE_LINK)
        with self.assertRaises(frappe.ValidationError):
            mark_internal_transfer(self._line(ONE_LINK).name, CARD, REASON)
        self._nothing_moved(ONE_LINK, expense)


class TestEachPageRowSaysWhetherMoveAcceptsIt(CashbookRectifyCase):
    """Unreconcile is hidden on a line Move accepts (story 53) and kept on a refused or Linked line (story 54). The
    page read sends `can_move`, Move's own plan verdict for the line, so the screen keeps no copy of the rule."""

    def _can_move(self) -> dict:
        from nirmaan_stack.api.outflow_import.review import SCOPE_ALL, get_outflow_rows

        rows = get_outflow_rows(scope=SCOPE_ALL, batch=self.batch, limit=100)["rows"]
        return {row["transfer_id"][: -len(self.suffix)]: row["can_move"] for row in rows}

    def test_a_created_spend_is_accepted_and_a_spend_with_its_refund_is_too(self):
        can_move = self._can_move()
        self.assertIs(can_move[ONE_LINK], True)
        # Ticked alone the plan refuses each, naming the other; as a pair Move takes them, so neither offers Unreconcile.
        self.assertIs(can_move[PART_SPEND], True)
        self.assertIs(can_move[PART_REFUND], True)

    def test_a_refused_line_is_not(self):
        expense = self._expense(ONE_LINK)
        frappe.db.set_value(expense.doctype, expense.name, "status", "Approved", update_modified=False)
        frappe.db.commit()
        self.assertIs(self._can_move()[ONE_LINK], False)

    def test_a_line_linked_to_an_existing_record_is_not(self):
        [leg] = self._legs(ONE_LINK)
        frappe.db.set_value("Outflow Row Match", leg.name, "created_by_import", 0, update_modified=False)
        frappe.db.commit()
        self.assertIs(self._can_move()[ONE_LINK], False)

    def test_an_open_line_is_not(self):
        # Every line of the statement but the Settled ones is open, skipped or an Internal Transfer.
        settled = set(self._targets())
        self.assertTrue(all(not moved for txn, moved in self._can_move().items() if txn not in settled))


class TestThePlanOffersInternalTransfer(CashbookRectifyCase):
    def test_the_wallet_is_the_own_side_every_other_place_a_far_end_and_the_spender_the_detail(self):
        plan = self._plan(ONE_LINK)

        self.assertEqual(plan["transfer"]["own_place"], WALLET)
        self.assertIn(CARD, plan["transfer"]["other_ends"])
        self.assertNotIn(WALLET, plan["transfer"]["other_ends"])
        # As Mark starts it: the wallet holder who spent it.
        [line] = plan["lines"]
        self.assertEqual(line["transfer_detail"], "Meera Iyer")


class TestSentBackTheProofStaysOnTheLine(TransferCase):
    def test_the_record_goes_and_its_bill_file_is_kept_on_the_line(self):
        from nirmaan_stack.api.outflow_import.internal_transfer_actions import send_back_to_mismatched

        self._to_transfer([ONE_LINK])
        record = self._record(ONE_LINK)
        line = self._line(ONE_LINK).name

        send_back_to_mismatched(line, "Not ours after all")

        self.assertFalse(frappe.db.exists(INTERNAL_TRANSFER, record.name))
        self.assertEqual(self._line(ONE_LINK).row_status, "Mismatched")
        # The bill is never lost: its File now sits on the line, as an open Collect payment's bill does (#1595).
        self.assertEqual(
            frappe.db.count("File", {"file_url": record.proof, "attached_to_doctype": "Outflow Import Row",
                                     "attached_to_name": line}),
            1,
        )
