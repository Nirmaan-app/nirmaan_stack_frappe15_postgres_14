# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Move a Cashbook spend's expense: Rectify with the Cashbook source (#1757, spec #1753).

    devenv.sh test --module nirmaan_stack.api.outflow_import.test_cashbook_rectify

Seam: the Move plan and write calls (`cashbook_rectify.get_cashbook_rectify_plan`, `rectify_cashbook_rows`), on a
Cashbook statement imported end to end by the job run inline (`test_cashbook_bills.CashbookBillsCase`: the bill
download and the reading replaced). Read back the way the screens read it: the line, its Settled match, the expense,
the expense's bills.

Lines of the fixture used here (made-up statement `cashbook_statement.xlsx`):
  ONE_LINK   a Wallet Spend of Rs 2,380 by Meera Iyer, booked Non Project, one bill (1.jpeg)
  PART_SPEND a Wallet Spend of Rs 17,446 by Asha Menon, Non Project; its part refund REF-PART_SPEND (Rs 11,248, the
             wallet holder Asha Menon its To) booked beside it at minus itself
  CREDIT     a Wallet Credit of Rs 9,000, booked Non Project at minus itself
"""

import json
from decimal import Decimal

import frappe

from nirmaan_stack.api.expenses.test_expense_bills import FakeReader, bills_of, run_reading
from nirmaan_stack.api.outflow_import import cashbook_rectify
from nirmaan_stack.api.outflow_import.test_cashbook_bills import ONE_LINK, CashbookBillsCase
from nirmaan_stack.services.expense_bills.bill_check import BillRead

REASON = "The remark names the site"
PROJECT_EXPENSE = "Project Expenses"
NON_PROJECT_EXPENSE = "Non Project Expenses"
PART_SPEND = "OBO9000000000004PARTSP"
PART_REFUND = "REF-" + PART_SPEND
CREDIT = "PTM9000000006"

#: What a Move keeps from the old expense (spec #1753 story 17), beside the bill.
_KEPT = ("amount", "status", "payment_date", "payment_ref", "invoice_ref", "invoice_date", "invoice_attachment",
         "type", "comment", "cashbook_batch")


class CashbookRectifyCase(CashbookBillsCase):
    """Two made-up Won projects and one Tendering one; the statement imported, every bill read."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.projects = []
        cls.orchid = cls._project("Testorchid Heights", "Won")
        cls.lotus = cls._project("Testlotus Annexe", "Won")
        cls.tender = cls._project("Testtender Plaza", "Tendering")
        frappe.db.commit()

    @classmethod
    def tearDownClass(cls):
        frappe.db.rollback()
        for name in cls.projects:
            try:
                frappe.delete_doc("Projects", name, force=True, ignore_permissions=True)
                frappe.db.commit()
            except Exception:
                frappe.db.rollback()
                print(f"cashbook rectify test purge: could not delete project {name}")
        super().tearDownClass()

    @classmethod
    def _project(cls, name: str, tendering_status: str) -> str:
        doc = frappe.new_doc("Projects")
        doc.project_name = f"{name} {frappe.generate_hash(length=4)}"
        doc.tendering_status = tendering_status
        doc.project_start_date = frappe.utils.now()[:19]
        doc.project_end_date = frappe.utils.add_to_date(frappe.utils.now()[:19], years=1)[:19]
        doc.project_scopes = {"scopes": []}
        doc.insert(ignore_permissions=True)
        cls.projects.append(doc.name)
        return doc.name

    def setUp(self):
        super().setUp()
        self._run()
        self.addCleanup(self._purge_comments)

    def _purge_comments(self):
        frappe.db.rollback()
        frappe.db.delete("Comment", {"reference_doctype": "Outflow Import Row", "reference_name": ["in", self._lines()]})
        for doctype, name in self._targets().values():
            frappe.db.delete("Comment", {"reference_doctype": doctype, "reference_name": name})
        frappe.db.commit()

    def _line(self, txn: str):
        return frappe.get_doc("Outflow Import Row", {"import_batch": self.batch, "transfer_id": txn + self.suffix})

    def _legs(self, txn: str):
        return frappe.get_all(
            "Outflow Row Match",
            filters={"import_row": self._line(txn).name},
            fields=["*"],
            order_by="creation asc",
        )

    def _read(self, txn: str, verdict_total: Decimal):
        """Run the bill's reading so it carries a verdict."""
        expense = self._expense(txn)
        (bill,) = bills_of(expense.doctype, expense.name)
        run_reading(bill.name, FakeReader(BillRead(total=verdict_total, invoice_no="TESTBILL-7")))

    def _plan(self, *txns: str) -> dict:
        return cashbook_rectify.get_cashbook_rectify_plan(json.dumps([self._line(t).name for t in txns]))

    def _move(self, txns, project, reason=REASON, expense_type=None) -> dict:
        names = [self._line(t).name for t in txns]
        return cashbook_rectify.rectify_cashbook_rows(json.dumps(names), project or "", reason, expense_type)


class TestASpendWithItsBillMovesToAProject(CashbookRectifyCase):
    def test_the_old_expense_goes_and_a_new_one_on_the_project_keeps_money_date_txn_paid_by_and_the_bill(self):
        self._read(ONE_LINK, Decimal("1999.00"))  # a Mismatched verdict, so its keeping is visible
        old = self._expense(ONE_LINK)
        [old_bill] = bills_of(old.doctype, old.name)
        self.assertEqual(old_bill.bill_check, "Mismatched")

        result = self._move([ONE_LINK], self.orchid)

        [line] = result["lines"]
        self.assertTrue(line["rectified"], line)
        self.assertFalse(frappe.db.exists(NON_PROJECT_EXPENSE, old.name))
        new = self._expense(ONE_LINK)
        self.assertEqual((new.doctype, new.projects), (PROJECT_EXPENSE, self.orchid))
        for field in _KEPT:
            self.assertEqual(str(new.get(field)), str(old.get(field)), field)
        self.assertEqual(float(new.amount), 2380.0)
        self.assertEqual(new.payment_ref, ONE_LINK + self.suffix)
        # Paid by is the wallet holder who spent it: the statement's From.
        self.assertEqual(new.payment_by, "Meera Iyer")

        # The bill and its whole verdict follow; nothing is retired.
        [bill] = bills_of(new.doctype, new.name)
        self.assertEqual(bill.name, old_bill.name)
        self.assertEqual(
            (bill.is_latest, bill.bill_check, bill.bill_check_reason, bill.status, bill.statement_line),
            (1, "Mismatched", old_bill.bill_check_reason, old_bill.status, old_bill.statement_line),
        )
        # Its one File follows the expense.
        self.assertEqual(
            frappe.db.count("File", {"file_url": new.invoice_attachment, "attached_to_doctype": PROJECT_EXPENSE,
                                     "attached_to_name": new.name}),
            1,
        )

        # The line points at the new expense, and its Txn Id is held by one Settled match.
        moved = self._line(ONE_LINK)
        self.assertEqual(
            (moved.row_status, moved.suggested_doctype, moved.suggested_name, moved.resolved_project),
            ("Settled", PROJECT_EXPENSE, new.name, self.orchid),
        )
        reversed_leg, settled_leg = self._legs(ONE_LINK)
        self.assertEqual((reversed_leg.match_kind, reversed_leg.reversal_reason), ("Reversed", REASON))
        self.assertEqual(
            (settled_leg.match_kind, settled_leg.target_name, settled_leg.transfer_id, settled_leg.source,
             settled_leg.created_by_import),
            ("Settled", new.name, ONE_LINK + self.suffix, "Cashbook", 1),
        )


class TestAProjectSpendMovesOn(CashbookRectifyCase):
    def setUp(self):
        super().setUp()
        self._move([ONE_LINK], self.orchid)
        self.on_orchid = self._expense(ONE_LINK)

    def test_to_another_project_it_keeps_paid_by_and_its_bill(self):
        [bill] = bills_of(PROJECT_EXPENSE, self.on_orchid.name)

        result = self._move([ONE_LINK], self.lotus)

        self.assertTrue(result["lines"][0]["rectified"], result)
        new = self._expense(ONE_LINK)
        self.assertEqual((new.doctype, new.projects, new.payment_by), (PROJECT_EXPENSE, self.lotus, "Meera Iyer"))
        self.assertFalse(frappe.db.exists(PROJECT_EXPENSE, self.on_orchid.name))
        self.assertEqual([b.name for b in bills_of(PROJECT_EXPENSE, new.name)], [bill.name])
        self.assertEqual(self._line(ONE_LINK).resolved_project, self.lotus)

    def test_to_non_project_it_leaves_the_project_with_its_bill(self):
        [bill] = bills_of(PROJECT_EXPENSE, self.on_orchid.name)

        result = self._move([ONE_LINK], None)

        self.assertTrue(result["lines"][0]["rectified"], result)
        new = self._expense(ONE_LINK)
        self.assertEqual(new.doctype, NON_PROJECT_EXPENSE)
        self.assertEqual((float(new.amount), new.payment_ref), (2380.0, ONE_LINK + self.suffix))
        self.assertEqual([b.name for b in bills_of(NON_PROJECT_EXPENSE, new.name)], [bill.name])
        line = self._line(ONE_LINK)
        self.assertEqual((line.suggested_doctype, line.resolved_project), (NON_PROJECT_EXPENSE, None))

    def test_a_comment_on_the_new_expense_names_the_old_one_who_and_why(self):
        self._move([ONE_LINK], self.lotus)
        new = self._expense(ONE_LINK)
        comments = frappe.get_all(
            "Comment", filters={"reference_doctype": PROJECT_EXPENSE, "reference_name": new.name,
                                "comment_type": "Comment"}, pluck="content",
        )
        self.assertEqual(len(comments), 1, comments)
        self.assertIn(self.on_orchid.name, comments[0])
        self.assertIn("Administrator", comments[0])
        self.assertIn(REASON, comments[0])


class TestMoneyComingBackStaysNegative(CashbookRectifyCase):
    def test_a_wallet_credit_moved_to_a_project_is_minus_its_amount_paid_by_its_holder(self):
        result = self._move([CREDIT], self.orchid)

        self.assertTrue(result["lines"][0]["rectified"], result)
        new = self._expense(CREDIT)
        self.assertEqual((new.doctype, new.projects), (PROJECT_EXPENSE, self.orchid))
        self.assertEqual(float(new.amount), -9000.0)
        self.assertEqual(new.payment_by, "Asha Menon")
        self.assertEqual(float(self._legs(CREDIT)[-1].target_amount), -9000.0)


class TestASpendAndItsRefundMoveTogether(CashbookRectifyCase):
    def test_ticked_together_both_go_to_the_project_the_refund_still_negative(self):
        result = self._move([PART_SPEND, PART_REFUND], self.orchid)

        self.assertEqual([line["rectified"] for line in result["lines"]], [True, True], result)
        spend, refund = self._expense(PART_SPEND), self._expense(PART_REFUND)
        self.assertEqual((spend.doctype, spend.projects, float(spend.amount)), (PROJECT_EXPENSE, self.orchid, 17446.0))
        self.assertEqual((refund.doctype, refund.projects, float(refund.amount)), (PROJECT_EXPENSE, self.orchid, -11248.0))
        # Money coming back: Paid by is the To, the wallet holder.
        self.assertEqual((spend.payment_by, refund.payment_by), ("Asha Menon", "Asha Menon"))

    def test_the_spend_alone_is_refused_in_the_plan_and_the_write_naming_its_refund(self):
        before = self._expense(PART_SPEND)

        [planned] = self._plan(PART_SPEND)["lines"]
        [written] = self._move([PART_SPEND], self.orchid)["lines"]

        self.assertIn(PART_REFUND + self.suffix, planned["refusal"])
        self.assertFalse(written["rectified"])
        self.assertEqual(written["reason"], planned["refusal"])
        self.assertEqual(self._expense(PART_SPEND).name, before.name)

    def test_the_refund_alone_is_refused_naming_its_spend(self):
        [planned] = self._plan(PART_REFUND)["lines"]
        [written] = self._move([PART_REFUND], self.orchid)["lines"]

        self.assertIn(PART_SPEND + self.suffix, planned["refusal"])
        self.assertFalse(written["rectified"])
        self.assertEqual(self._expense(PART_REFUND).doctype, NON_PROJECT_EXPENSE)

    def test_when_the_refund_cannot_move_its_spend_does_not_move_either(self):
        refund = self._expense(PART_REFUND)
        # Raw, the test's own setup: a refund no longer Paid is refused (story 29).
        frappe.db.set_value(NON_PROJECT_EXPENSE, refund.name, "status", "Approved")
        frappe.db.commit()
        spend = self._expense(PART_SPEND)

        result = self._move([PART_SPEND, PART_REFUND], self.orchid)

        self.assertEqual([line["rectified"] for line in result["lines"]], [False, False], result)
        self.assertIn("not Paid", result["lines"][1]["reason"])
        self.assertIn(PART_REFUND + self.suffix, result["lines"][0]["reason"])
        self.assertEqual(self._expense(PART_SPEND).name, spend.name)
        self.assertEqual(self._expense(PART_REFUND).name, refund.name)
