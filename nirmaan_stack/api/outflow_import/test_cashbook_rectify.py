# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Move a Cashbook spend's expense: Rectify with the Cashbook source (#1757, spec #1753).

    devenv.sh test --module nirmaan_stack.api.outflow_import.test_cashbook_rectify

Seam: the Move plan and write calls (`rectify.get_rectify_plan`, `rectify.rectify_lines`), on a
Cashbook statement imported end to end by the job run inline (`test_cashbook_bills.CashbookBillsCase`: the bill
download and the reading replaced). Read back the way the screens read it: the line, its Settled match, the expense,
the expense's bills.

The import plans against the suite's own expense-type rules and project aliases (`expense_rules`, none by default),
never the site's: the seed (#1756) types a courier remark "Postage & Courier", which a project does not take. With no
rules each line is typed the fallback Petty Cash, which both ledgers take; `TestANonProjectOnlyTypeNeedsAProjectType`
gives the import a rule like the seed's.

Lines of the fixture used here (made-up statement `cashbook_statement.xlsx`):
  ONE_LINK   a Wallet Spend of Rs 2,380 by Meera Iyer, booked Non Project, one bill (1.jpeg)
  PART_SPEND a Wallet Spend of Rs 17,446 by Asha Menon, Non Project; its part refund REF-PART_SPEND (Rs 11,248, the
             wallet holder Asha Menon its To) booked beside it at minus itself
  CREDIT     a Wallet Credit of Rs 9,000, booked Non Project at minus itself
"""

import json
from decimal import Decimal
from unittest.mock import patch

import frappe

from nirmaan_stack.api.expenses.test_expense_bills import FakeReader, bills_of, run_reading
from nirmaan_stack.api.outflow_import import cashbook as cb
from nirmaan_stack.api.outflow_import import rectify
from nirmaan_stack.api.outflow_import.test_cashbook_bills import ONE_LINK, CashbookBillsCase
from nirmaan_stack.api.outflow_import.test_porter_rectify import _purge_history
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

    #: The expense-type rules the import types each line by (`candidates.load_expense_rules`' shape).
    expense_rules = {"Project": (), "Non Project": ()}

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
        with patch.object(cb, "load_expense_rules", lambda: self.expense_rules), \
                patch.object(cb, "load_project_aliases", lambda: ()):
            super().setUp()
        self._run()
        # Runs before the import's purge (cleanups are last-in, first-out), while the matches still name the expenses
        # a Move left history on: the Porter Rectify suite's helper.
        self.addCleanup(_purge_history, self.batch)

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
        return rectify.get_rectify_plan(json.dumps([self._line(t).name for t in txns]))

    def _move(self, txns, project, reason=REASON, expense_type=None) -> dict:
        names = [self._line(t).name for t in txns]
        return rectify.rectify_lines(json.dumps(names), project or "", reason, expense_type)


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
                                "comment_type": "Comment"}, pluck="content", order_by="creation desc",
        )
        # The newest is this move's; the earlier move's comment came along with the expense (owner, 2026-11-26).
        self.assertEqual(len(comments), 2, comments)
        self.assertIn(f"({PROJECT_EXPENSE} {self.on_orchid.name} on ", comments[0])
        self.assertIn(f"{PROJECT_EXPENSE} {new.name} on ", comments[0])
        self.assertIn("Administrator", comments[0])
        self.assertIn(REASON, comments[0])
        self.assertIn(f"{PROJECT_EXPENSE} {self.on_orchid.name} on ", comments[1])
        self.assertNotIn(new.name, comments[1])


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


class TestEachRefusalIsSaidBeforeConfirmAndMovesNothing(CashbookRectifyCase):
    """Each condition is set raw on the expense the import created (the test's own setup), then asked of the plan and
    the write: the same sentence from both, and the expense left where it was."""

    def _refused(self, words: str, legs: int = 1):
        before = self._expense(ONE_LINK)
        [planned] = self._plan(ONE_LINK)["lines"]
        [written] = self._move([ONE_LINK], self.orchid)["lines"]
        self.assertIn(words, planned["refusal"] or "")
        self.assertEqual((written["rectified"], written["reason"]), (False, planned["refusal"]))
        self.assertEqual(self._expense(ONE_LINK).name, before.name)
        self.assertEqual(len(self._legs(ONE_LINK)), legs)

    def _set(self, field: str, value):
        expense = self._expense(ONE_LINK)
        frappe.db.set_value(expense.doctype, expense.name, field, value, update_modified=False)
        frappe.db.commit()
        return expense

    def test_an_expense_not_paid(self):
        self._set("status", "Approved")
        self._refused("Approved, not Paid")

    def test_a_reimbursements_expense(self):
        self._set("reimbursement", "TEST-REIMB-0001")
        self._refused("Reimbursement TEST-REIMB-0001")

    def test_an_expense_requests_expense(self):
        self._set("request_id", "TEST-EXREQ-0001")
        self._refused("Expense Request TEST-EXREQ-0001")

    def test_an_expense_carrying_a_payment_tds_deduction(self):
        expense = self._expense(ONE_LINK)
        tds = frappe.get_doc(
            {"doctype": "Payment TDS Deduction", "non_project_expense": expense.name, "tds_amount": 10,
             "status": "Pending"}
        )
        tds.name = f"TEST-TDS-{frappe.generate_hash(length=6)}"
        tds.db_insert()
        frappe.db.commit()
        self.addCleanup(self._drop, "Payment TDS Deduction", tds.name)
        self._refused(f"Payment TDS Deduction {tds.name}")

    def test_a_bill_still_being_read(self):
        expense = self._expense(ONE_LINK)
        [bill] = bills_of(expense.doctype, expense.name)
        self.assertEqual(bill.bill_check, "Checking")
        frappe.db.set_value("Expense Bill", bill.name, "read_claimed_at", frappe.utils.now_datetime())
        frappe.db.commit()
        self._refused("being read")

    def test_a_reading_that_stopped_long_ago_holds_nothing(self):
        expense = self._expense(ONE_LINK)
        [bill] = bills_of(expense.doctype, expense.name)
        frappe.db.set_value("Expense Bill", bill.name, "read_claimed_at", frappe.utils.add_days(frappe.utils.now_datetime(), -2))
        frappe.db.commit()
        [planned] = self._plan(ONE_LINK)["lines"]
        self.assertIsNone(planned["refusal"])
        self.assertTrue(self._move([ONE_LINK], self.orchid)["lines"][0]["rectified"])

    def test_an_expense_on_a_cheque(self):
        expense = self._expense(ONE_LINK)
        cheque = frappe.new_doc("Cheques")
        cheque.name = f"TEST-CHQ-{frappe.generate_hash(length=6)}"
        cheque.cheque_no = "TEST000123"
        cheque.db_insert()
        line = frappe.get_doc(
            {"doctype": "Cheque Line", "parent": cheque.name, "parenttype": "Cheques", "parentfield": "lines",
             "payment_doctype": expense.doctype, "payment_name": expense.name}
        )
        line.name = f"TEST-CHQL-{frappe.generate_hash(length=6)}"
        line.db_insert()
        frappe.db.commit()
        self.addCleanup(self._drop, "Cheques", cheque.name)
        self.addCleanup(self._drop, "Cheque Line", line.name)
        self._refused("on Cheque TEST000123")

    def test_a_line_settled_to_more_than_one_record(self):
        line = self._line(ONE_LINK)
        extra = frappe.get_doc(
            {"doctype": "Outflow Row Match", "import_row": line.name, "import_batch": self.batch,
             "target_doctype": "Project Payments", "target_name": "TEST-PAYMENT-0001", "match_kind": "Settled",
             "target_amount": 1}
        )
        extra.name = f"TEST-MATCH-{frappe.generate_hash(length=6)}"
        extra.db_insert()
        frappe.db.commit()
        self._refused("more than one record", legs=2)

    def test_a_project_not_won_or_missing_refuses_the_whole_write(self):
        for project in (self.tender, "TEST-NO-SUCH-PROJECT"):
            with self.assertRaises(frappe.ValidationError):
                self._move([ONE_LINK], project)
        self.assertEqual(self._expense(ONE_LINK).doctype, NON_PROJECT_EXPENSE)

    def test_an_accountant_can_neither_plan_nor_move(self):
        from nirmaan_stack.api.outflow_import.test_skip_row import ACCOUNTANT, _Users

        users = _Users()
        self.addCleanup(users.purge)
        accountant = users.make(ACCOUNTANT)
        frappe.set_user(accountant)
        try:
            with self.assertRaises(frappe.PermissionError):
                self._plan(ONE_LINK)
            with self.assertRaises(frappe.PermissionError):
                self._move([ONE_LINK], self.orchid)
        finally:
            frappe.set_user("Administrator")

    def _drop(self, doctype: str, name: str):
        frappe.db.rollback()
        try:
            frappe.db.delete(doctype, name)
            frappe.db.commit()
        except Exception:
            frappe.db.rollback()
            print(f"cashbook rectify test purge: could not delete {doctype} {name}")


class TestTheTypeFitsTheDestination(CashbookRectifyCase):
    def test_a_chosen_type_goes_on_the_new_expense_and_the_line(self):
        self._move([ONE_LINK], self.orchid, expense_type="Material Purchases")

        self.assertEqual(self._expense(ONE_LINK).type, "Material Purchases")
        self.assertEqual(self._line(ONE_LINK).suggested_expense_type, "Material Purchases")

    def test_a_type_the_destination_does_not_take_is_refused_and_nothing_moves(self):
        self._move([ONE_LINK], self.orchid, expense_type="Material Purchases")
        on_orchid = self._expense(ONE_LINK)

        [line] = self._move([ONE_LINK], None)["lines"]

        self.assertFalse(line["rectified"])
        self.assertIn("not an expense type for Non Project Expenses", line["reason"])
        self.assertEqual(self._expense(ONE_LINK).name, on_orchid.name)
        [line] = self._move([ONE_LINK], None, expense_type="Petty Cash")["lines"]
        self.assertTrue(line["rectified"], line)


class TestANonProjectOnlyTypeNeedsAProjectType(CashbookRectifyCase):
    """A rule like the seed's "courier" one (#1756) types the courier spend with a type only Non Project Expenses
    take. A Move to a project keeps the expense's own type unless a type is chosen, so it is refused until one is."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.courier_type = frappe.get_doc({
            "doctype": "Expense Type", "expense_name": f"Testcourier Office {frappe.generate_hash(length=4)}",
            "non_project": 1, "project": 0,
        }).insert(ignore_permissions=True).name
        frappe.db.commit()
        cls.expense_rules = {"Project": (), "Non Project": (("courier", cls.courier_type),)}

    @classmethod
    def tearDownClass(cls):
        frappe.db.rollback()
        try:
            frappe.db.delete("Expense Type", {"name": cls.courier_type})
            frappe.db.commit()
        except Exception:
            frappe.db.rollback()
            print(f"cashbook rectify test purge: could not remove expense type {cls.courier_type}")
        super().tearDownClass()

    def test_moved_to_a_project_it_is_refused_without_a_type_and_moves_with_a_project_type(self):
        old = self._expense(ONE_LINK)
        self.assertEqual((old.doctype, old.type), (NON_PROJECT_EXPENSE, self.courier_type))
        plan = self._plan(ONE_LINK)
        [planned] = plan["lines"]
        self.assertEqual((planned["refusal"], planned["expense_type"]), (None, self.courier_type))
        # What the dialog offers for the destination: the project ledger does not take the line's own type.
        self.assertNotIn(self.courier_type, plan["types"][PROJECT_EXPENSE])
        self.assertIn(self.courier_type, plan["types"][NON_PROJECT_EXPENSE])

        [line] = self._move([ONE_LINK], self.orchid)["lines"]

        self.assertFalse(line["rectified"])
        self.assertEqual(line["reason"], f"'{self.courier_type}' is not an expense type for Project Expenses.")
        self.assertEqual(self._expense(ONE_LINK).name, old.name)
        self.assertEqual(len(self._legs(ONE_LINK)), 1)

        [line] = self._move([ONE_LINK], self.orchid, expense_type="Material Purchases")["lines"]

        self.assertTrue(line["rectified"], line)
        new = self._expense(ONE_LINK)
        self.assertEqual((new.doctype, new.projects, new.type), (PROJECT_EXPENSE, self.orchid, "Material Purchases"))
        self.assertEqual(self._line(ONE_LINK).suggested_expense_type, "Material Purchases")


class TestThePlanShowsTheWalletSpend(CashbookRectifyCase):
    def test_each_line_its_placement_and_details_and_the_choices(self):
        self._read(ONE_LINK, Decimal("1999.00"))
        expense = self._expense(ONE_LINK)

        plan = self._plan(ONE_LINK)

        [line] = plan["lines"]
        self.assertIsNone(line["refusal"])
        self.assertEqual(
            (line["txn_id"], line["ledger"], line["project"], line["expense"], line["amount"]),
            (ONE_LINK + self.suffix, NON_PROJECT_EXPENSE, None, expense.name, 2380.0),
        )
        self.assertEqual(
            (line["date"], line["spender"], line["counterparty"], line["remark"], line["money_in"],
             line["expense_type"]),
            (str(expense.payment_date), "Meera Iyer", "TESTPAYEE COURIER ONE",
             "Courier charges from bngl to Ahemadbad", False, "Petty Cash"),
        )
        self.assertEqual((line["bill"]["file"], line["bill"]["check"]), (expense.invoice_attachment, "Mismatched"))
        self.assertTrue(line["bill"]["check_reason"])
        won = {p["name"] for p in plan["projects"]}
        self.assertIn(self.orchid, won)
        self.assertNotIn(self.tender, won)
        self.assertIn("Material Purchases", plan["types"][PROJECT_EXPENSE])
        self.assertNotIn("Material Purchases", plan["types"][NON_PROJECT_EXPENSE])
        self.assertIn("Petty Cash", plan["types"][NON_PROJECT_EXPENSE])
        self.assertEqual(plan["source"], "Cashbook")


class TestTheEditDialogFindsTheExpensesLine(CashbookRectifyCase):
    def test_a_cashbook_expense_names_its_import_line_and_txn_id_and_follows_a_move(self):
        expense = self._expense(ONE_LINK)
        line = self._line(ONE_LINK)
        expected = {"import_batch": self.batch, "import_row": line.name, "transfer_id": ONE_LINK + self.suffix}

        self.assertEqual(rectify.get_move_line(expense.doctype, expense.name), expected)
        self._move([ONE_LINK], self.orchid)
        new = self._expense(ONE_LINK)
        self.assertEqual(rectify.get_move_line(new.doctype, new.name), expected)

    def test_an_expense_with_no_import_line_has_none(self):
        self.assertIsNone(rectify.get_move_line(NON_PROJECT_EXPENSE, "TEST-NO-SUCH-EXPENSE"))
