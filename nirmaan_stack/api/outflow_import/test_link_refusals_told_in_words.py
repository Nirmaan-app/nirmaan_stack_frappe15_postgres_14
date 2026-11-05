# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""The two hand-Link refusals #1606 left raw are told in words too (#1611).

    DEVENV test --module nirmaan_stack.api.outflow_import.test_link_refusals_told_in_words

* A Payment Link (Decide's one-line Link, `settle_row`) refused by `ofm_match_settled_target_unique`: another line
  already settled the same Txn Id to the Payment the person picked.
* A many-line Link (`link_rows_to_expense`) of two new lines that share one Txn Id: the index refuses the second
  row inside the same request, so no committed line holds the Txn Id.

The second line is given the first line's Txn Id by hand (test data only, `link_refusal_fixture.give_the_txn_id_of`).
Every batch, line, match row, payment and expense is this test's own and is deleted by its fixture's teardown.
"""

import json

import frappe

from nirmaan_stack.api.outflow_import.expenses import (
    AlreadyLinkedError,
    TxnIdTickedTwiceError,
    settle_row,
)
from nirmaan_stack.api.outflow_import.link_lines import link_rows_to_expense
from nirmaan_stack.api.outflow_import.link_refusal_fixture import assert_refused_in_words, give_the_txn_id_of
from nirmaan_stack.api.outflow_import.review import MATCH_DOCTYPE, ROW_DOCTYPE
from nirmaan_stack.api.outflow_import.test_link_rows_to_expense import LinkFixture
from nirmaan_stack.api.outflow_import.test_settle_payment import PaymentSettlementFixture
from nirmaan_stack.services.outflow_import.ledgers import PAYMENT_DOCTYPE
from nirmaan_stack.services.outflow_import.settle import NON_PROJECT_EXPENSE, AlreadyPaidError
from nirmaan_stack.services.outflow_import.status import OPEN_ROW_STATUSES, ROW_MATCHED
from nirmaan_stack.services.settlement import STATUS_PAID, STATUS_RECONCILIATION_PENDING


class TestAPaymentLinkOfATxnIdThatAlreadySettledIt(PaymentSettlementFixture):
    """Item 1: line A settled a Payment; line B carries A's Txn Id and is Linked to the same Payment."""

    def setUp(self):
        super().setUp()
        self.first = self._staged_row(amount="100")
        self.second = self._staged_row(amount="100")
        self.txn = give_the_txn_id_of(self.first, to=self.second)
        self.payment = self._approved_payment("100")
        settle_row(self.first, PAYMENT_DOCTYPE, self.payment)
        self.assertEqual(frappe.db.get_value(PAYMENT_DOCTYPE, self.payment, "status"), STATUS_PAID)

    def _assert_nothing_of_the_second_line_written(self):
        self.assertEqual(frappe.db.get_value(ROW_DOCTYPE, self.second, "row_status"), ROW_MATCHED)
        self.assertFalse(frappe.db.exists(MATCH_DOCTYPE, {"import_row": self.second}))

    def test_while_the_payment_is_paid_the_paid_guard_refuses_before_the_index(self):
        """The ordinary case: the line that settled the Payment made it Paid, and `settle_payment` refuses a Paid
        Payment under its row lock (`settle._lock_and_assert_payment_settleable`) before any match row is
        written."""
        assert_refused_in_words(
            self, lambda: settle_row(self.second, PAYMENT_DOCTYPE, self.payment), AlreadyPaidError, [self.payment]
        )
        self._assert_nothing_of_the_second_line_written()

    def test_once_the_administrator_moved_it_back_the_index_refuses_and_says_so_in_words(self):
        """The Administrator alone may move a Paid payment back by hand (`payment_steps`: the settled-back refusal
        exempts Administrator), and that leaves line A's Settled match row in place. The Payment is settleable
        again, so line B's Link reaches the match insert and `ofm_match_settled_target_unique` refuses it."""
        doc = frappe.get_doc(PAYMENT_DOCTYPE, self.payment)
        doc.status = STATUS_RECONCILIATION_PENDING
        doc.save(ignore_permissions=True)
        frappe.db.commit()

        first_batch = frappe.db.get_value(ROW_DOCTYPE, self.first, "import_batch")
        assert_refused_in_words(
            self,
            lambda: settle_row(self.second, PAYMENT_DOCTYPE, self.payment),
            AlreadyLinkedError,
            [self.txn, self.payment, self.first, first_batch],
        )
        self._assert_nothing_of_the_second_line_written()
        self.assertEqual(
            frappe.db.get_value(PAYMENT_DOCTYPE, self.payment, "status"), STATUS_RECONCILIATION_PENDING
        )


class TestTwoNewLinesWithOneTxnIdInOneLink(LinkFixture):
    """Item 2: two ticked lines, neither settled, share one Txn Id; the index refuses the second inside the
    request, so no committed line holds the Txn Id when the refusal is read."""

    def test_the_link_is_refused_naming_the_txn_id_the_ticked_lines_share(self):
        first, second = self._lines(2)
        txn = give_the_txn_id_of(first["name"], to=second["name"])
        expense = self._expense(amount=self._total([first, second]))

        assert_refused_in_words(
            self,
            lambda: link_rows_to_expense(
                rows=json.dumps([first["name"], second["name"]]),
                target_doctype=NON_PROJECT_EXPENSE,
                target_name=expense,
            ),
            TxnIdTickedTwiceError,
            [txn, expense],
        )
        for line in (first, second):
            self.assertIn(frappe.db.get_value(ROW_DOCTYPE, line["name"], "row_status"), OPEN_ROW_STATUSES)
        self.assertEqual(self._slips(expense), [])
