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
