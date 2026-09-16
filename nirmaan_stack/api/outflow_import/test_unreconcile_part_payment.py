# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Unreconcile a line settled with a Part payment: the split is undone (#1279, parent #1270, ADR-0022).

A Rs 1,00,000 payment part-settled by a Rs 60,000 transfer is split into the Paid Rs 60,000 and an
Approved Rs 40,000 leftover. Unreconciling that line deletes the leftover, gives the original its
Rs 1,00,000 back, joins the PO's two terms into one and reverts the original to Approved -- but only
while the leftover is untouched.

⚠️ RUNS AGAINST THE LIVE SITE DATABASE. The leftover is minted (and deleted) by the code under test, so
its Comments, Versions, `Nirmaan Versions` copy and `Deleted Document` row are purged by name.
"""

import frappe

from nirmaan_stack.api.outflow_import.expenses import settle_row, settle_row_partial
from nirmaan_stack.api.outflow_import.test_settle_payment import PartialSettlementFixture
from nirmaan_stack.api.outflow_import.unreconcile import get_unreconcile_plan, unreconcile_row
from nirmaan_stack.services.outflow_import.partial_settle import INTENT_PART_PAYMENT
from nirmaan_stack.services.outflow_import.status import (
    ROW_MATCHED,
    ROW_MISMATCHED,
    ROW_SETTLED,
)
from nirmaan_stack.services.outflow_import.unreconcile import (
    VERDICT_REFUSED,
    VERDICT_UNSPLIT_PAYMENT,
    WHAT_HAPPENS_UNSPLIT,
)
from nirmaan_stack.api.outflow_import.test_settle_payment import SETTLEABLE

MATCH_DOCTYPE = "Outflow Row Match"
ROW_DOCTYPE = "Outflow Import Row"
PAYMENT = "Project Payments"


class PartPaymentFixture(PartialSettlementFixture):
    PO_TOTAL = 100000.0
    RECORD = 100000.0
    BANK = 60000.0
    BALANCE = 40000.0

    def setUp(self):
        super().setUp()
        self.minted = []

    def tearDown(self):
        names = list(dict.fromkeys(self.payments + self.minted))
        frappe.db.delete("Comment", {"reference_doctype": PAYMENT, "reference_name": ["in", names]})
        frappe.db.delete("Version", {"ref_doctype": PAYMENT, "docname": ["in", names]})
        frappe.db.delete("Nirmaan Versions", {"ref_doctype": PAYMENT, "docname": ["in", names]})
        frappe.db.delete(
            "Deleted Document", {"deleted_doctype": PAYMENT, "deleted_name": ["in", names]}
        )
        frappe.db.delete("File", {"attached_to_doctype": PAYMENT, "attached_to_name": ["in", names]})
        frappe.db.commit()
        super().tearDown()

    def _part_settle(self):
        settle_row_partial(self.partial_row.name, self.big_payment, INTENT_PART_PAYMENT)
        (leftover,) = self._balance_of(self.big_payment)
        self.minted.append(leftover)
        return self.partial_row.name, leftover

    def _leg(self, row, payment):
        return frappe.db.get_value(
            MATCH_DOCTYPE, {"import_row": row, "target_name": payment}, "name"
        )

    def _payment(self, name):
        return frappe.db.get_value(
            PAYMENT, name, ["status", "utr", "payment_date", "amount"], as_dict=True
        )

    def _assert_split_standing(self, row, leftover):
        """Nothing was written: the split and the settle are exactly as the partial settle left them."""
        self.assertTrue(frappe.db.exists(PAYMENT, leftover))
        stored = self._payment(self.big_payment)
        self.assertEqual(stored.status, "Paid")
        self.assertEqual(float(stored.amount), self.BANK)
        self.assertEqual(len(self._terms()), 2)
        self.assertEqual(
            frappe.db.get_value(MATCH_DOCTYPE, self._leg(row, self.big_payment), "match_kind"),
            "Settled",
        )
        self.assertEqual(frappe.db.get_value(ROW_DOCTYPE, row, "row_status"), ROW_SETTLED)


class TestAnUntouchedLeftover(PartPaymentFixture):
    def test_the_plan_says_the_split_is_undone(self):
        row, leftover = self._part_settle()
        (leg,) = get_unreconcile_plan(row=row)["legs"]
        self.assertEqual(leg["verdict"], VERDICT_UNSPLIT_PAYMENT)
        self.assertEqual(leg["what_happens"], WHAT_HAPPENS_UNSPLIT)
        self.assertEqual(leg["leftover"], leftover)
        self.assertEqual(leg["leftover_amount"], self.BALANCE)
        self.assertEqual(leg["restored_amount"], self.RECORD)
        self.assertTrue(leg["joins_terms"])

    def test_unreconcile_deletes_the_leftover_restores_the_original_and_joins_the_terms(self):
        row, leftover = self._part_settle()

        result = unreconcile_row(row=row, legs="all", reason="wrong payment picked")

        self.assertFalse(frappe.db.exists(PAYMENT, leftover), "the leftover is deleted")
        stored = self._payment(self.big_payment)
        self.assertEqual(stored.status, SETTLEABLE)
        self.assertEqual(float(stored.amount), self.RECORD)
        self.assertFalse(stored.utr)
        self.assertFalse(stored.payment_date)

        (term,) = self._terms()
        self.assertEqual(float(term.amount), self.PO_TOTAL, "one term summing to the PO total")
        self.assertEqual(term.project_payment, self.big_payment)
        self.assertEqual(term.label, "Advance Payment")
        self.assertEqual(term.term_status, SETTLEABLE)
        self.assertEqual(
            float(frappe.db.get_value("Procurement Orders", self.split_po, "amount_paid") or 0), 0.0
        )

        self.assertEqual(
            frappe.db.get_value(MATCH_DOCTYPE, self._leg(row, self.big_payment), "match_kind"),
            "Reversed",
        )
        self.assertIn(result["row_status"], (ROW_MATCHED, ROW_MISMATCHED))
        self.assertEqual(frappe.db.get_value(ROW_DOCTYPE, row, "row_status"), result["row_status"])

        (reversed_leg,) = result["reversed"]
        self.assertEqual(reversed_leg["verdict"], VERDICT_UNSPLIT_PAYMENT)
        self.assertEqual(reversed_leg["leftover"], leftover)
        self.assertEqual(reversed_leg["restored_amount"], self.RECORD)
        self.assertEqual(reversed_leg["amount_after"], self.RECORD)

    def test_the_original_keeps_its_partial_comment_and_gains_one_for_the_undo(self):
        row, leftover = self._part_settle()
        unreconcile_row(row=row, legs="all", reason="wrong payment picked")
        comments = frappe.get_all(
            "Comment",
            filters={"reference_doctype": PAYMENT, "reference_name": self.big_payment,
                     "comment_type": "Comment"},
            pluck="content",
            order_by="creation asc",
        )
        self.assertTrue(any("Partially settled from a bank statement" in c for c in comments))
        self.assertTrue(
            any("wrong payment picked" in c and leftover in c and "undone" in c for c in comments),
            comments,
        )

    def test_the_restored_payment_settles_against_another_line(self):
        row, _ = self._part_settle()
        unreconcile_row(row=row, legs="all", reason="wrong payment picked")
        other = self._staged_row(amount=str(self.RECORD))
        settle_row(row=other, target_doctype=PAYMENT, target_name=self.big_payment)
        self.assertEqual(self._payment(self.big_payment).status, "Paid")


class TestALeftoverThatIsNotUntouched(PartPaymentFixture):
    def _refused(self, row, leftover, fragment):
        (leg,) = get_unreconcile_plan(row=row)["legs"]
        self.assertEqual(leg["verdict"], VERDICT_REFUSED)
        self.assertIn(fragment, leg["reason"])
        with self.assertRaises(frappe.ValidationError) as caught:
            unreconcile_row(row=row, legs="all", reason="wrong payment picked")
        self.assertIn(fragment, str(caught.exception))
        frappe.db.rollback()
        self._assert_split_standing(row, leftover)

    def test_a_leftover_paid_by_another_transfer_is_refused_until_that_transfer_is_undone(self):
        row, leftover = self._part_settle()
        other = self._staged_row(amount=str(self.BALANCE))
        settle_row(row=other, target_doctype=PAYMENT, target_name=leftover)

        self._refused(
            row, leftover,
            f"Its leftover {leftover} was paid by another transfer on "
            f"{frappe.utils.now_datetime().strftime('%d-%b-%Y')}. Unreconcile that transfer first.",
        )

        # The sentence is an instruction, so following it must work: the balance's own transfer is
        # undoable, and then the split is.
        unreconcile_row(row=other, legs="all", reason="paid the wrong balance")
        self.assertEqual(self._payment(leftover).status, SETTLEABLE)
        unreconcile_row(row=row, legs="all", reason="wrong payment picked")
        self.assertFalse(frappe.db.exists(PAYMENT, leftover))
        self.assertEqual(float(self._payment(self.big_payment).amount), self.RECORD)
        self.assertEqual(len(self._terms()), 1)

    def test_the_balance_of_a_ceo_split_is_still_refused(self):
        """Only the leftover of a partial settle that still stands reverts like any payment. A balance
        whose parent carries no Settled leg from its own request keeps the old refusal."""
        row, leftover = self._part_settle()
        other = self._staged_row(amount=str(self.BALANCE))
        settle_row(row=other, target_doctype=PAYMENT, target_name=leftover)
        frappe.db.set_value(
            MATCH_DOCTYPE, self._leg(row, self.big_payment), "matched_at",
            frappe.utils.add_days(frappe.utils.now_datetime(), 3), update_modified=False,
        )
        frappe.db.commit()
        (leg,) = get_unreconcile_plan(row=other)["legs"]
        self.assertEqual(leg["title"], "Part of a split payment")

    def test_a_leftover_edited_since_the_split_is_refused(self):
        row, leftover = self._part_settle()
        # Through the document layer, so the Version a real edit leaves is there to be read.
        doc = frappe.get_doc(PAYMENT, leftover)
        doc.amount = 39000
        doc.flags.from_outflow_import = True
        doc.save(ignore_permissions=True, ignore_version=False)
        frappe.db.commit()

        self._refused(row, leftover, f"Its leftover {leftover} was edited on")

    def test_a_leftover_with_tds_is_refused(self):
        row, leftover = self._part_settle()
        # RAW, NO HOOKS, and that is the point: no import path writes `tds` any more, so the fixture
        # plants the legacy figure the payments screen can leave (as `test_reverse_allocation` does).
        frappe.db.set_value(PAYMENT, leftover, "tds", 400, update_modified=False)
        frappe.db.commit()

        self._refused(
            row, leftover,
            f"Its leftover {leftover} has TDS on it. Fix the tax on the Payments screen first.",
        )
