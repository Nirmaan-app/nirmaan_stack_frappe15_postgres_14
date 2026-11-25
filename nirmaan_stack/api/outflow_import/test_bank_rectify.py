# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Move an expense a person created from a bank or Cashfree line: Rectify with the bank sources (#1760, spec #1753
stories 5, 33, 44).

    devenv.sh test --module nirmaan_stack.api.outflow_import.test_bank_rectify

Seam: the Move plan and write calls (`rectify.get_rectify_plan`, `rectify.rectify_lines`), on a line staged as an
upload stages it and recorded with Create (`expenses.create_expense`), the way a person records it. Read back the way
the screens read it: the line, its Settled match, the expense.

⚠️ RUNS AGAINST THE ENV'S DATABASE. Every record hangs off the fixture's throwaway Won project and batches, and is
purged in tearDown (`CreatedUnreconcileFixture`).
"""

import json

import frappe

from nirmaan_stack.api.outflow_import import rectify
from nirmaan_stack.api.outflow_import.expenses import allocate_row, create_expense
from nirmaan_stack.api.outflow_import.review import get_batch_rows
from nirmaan_stack.api.outflow_import.test_unreconcile_created import (
    BATCH_DOCTYPE,
    MATCH_DOCTYPE,
    NON_PROJECT_EXPENSE,
    PROJECT_EXPENSE,
    CreatedUnreconcileFixture,
)

ICICI = "ICICI Bank Statement"
CASHFREE = "Cashfree"
REASON = "The remark names the site"
ROW_DOCTYPE = "Outflow Import Row"

#: What a Move keeps from the old expense.
_KEPT = ("amount", "status", "payment_date", "payment_ref", "type", "comment")


class BankRectifyCase(CreatedUnreconcileFixture):
    """A bank or Cashfree line staged as its upload stages it, then recorded with Create as a Non Project Expense."""

    def _bank_line(self, source: str, amount: float = 4250.0) -> str:
        batch = frappe.new_doc(BATCH_DOCTYPE)
        batch.update({"source": source, "status": "In Review", "source_file": self.ALLOC_STATEMENT})
        batch.insert(ignore_permissions=True)
        self.batches.append(batch.name)
        utr = f"TESTUTR{frappe.generate_hash(length=10).upper()}"
        row = frappe.new_doc(ROW_DOCTYPE)
        row.update(
            {
                "import_batch": batch.name,
                "source": source,
                "transfer_id": utr,
                "amount": amount,
                "direction": "Debit" if source == ICICI else None,
                "added_on": "2026-10-14 11:20:00",
                "bank_reference_no": utr,
                "settlement_reference": utr,
                "beneficiary_name": "Testvendor Hardware Stores",
                "remarks": "site cement Testorchid",
                "row_status": "Mismatched",
            }
        )
        row.insert(ignore_permissions=True)
        frappe.db.commit()
        return row.name

    def _created(self, source: str) -> tuple[str, str]:
        """A line of `source` and the Non Project Expense a person created from it with Create."""
        row = self._bank_line(source)
        name = create_expense(
            row=row,
            doctype=NON_PROJECT_EXPENSE,
            expense_type=self._type_both_ledgers_take(),
            comment="paid from the bank",
        )["settled"]["name"]
        self.created.append((NON_PROJECT_EXPENSE, name))
        return row, name

    def _type_both_ledgers_take(self) -> str:
        name = frappe.db.get_value("Expense Type", {"project": 1, "non_project": 1}, "name")
        if not name:
            self.skipTest("no Expense Type both ledgers take on this site")
        return name

    def _live_leg(self, row: str):
        return frappe.get_all(
            MATCH_DOCTYPE,
            filters={"import_row": row, "match_kind": "Settled"},
            fields=["target_doctype", "target_name", "transfer_id", "source", "created_by_import"],
        )

    def _move(self, rows, project, reason=REASON) -> dict:
        result = rectify.rectify_lines(json.dumps(rows), project or "", reason, None)
        for line in result["lines"]:
            for leg in self._live_leg(line["row"]):
                self.created.append((leg.target_doctype, leg.target_name))
        return result


class TestACreatedBankExpenseMovesToAProject(BankRectifyCase):
    def _assert_moved(self, source: str):
        row, old_name = self._created(source)
        old = frappe.get_doc(NON_PROJECT_EXPENSE, old_name)
        project = self._allocation_project()

        result = self._move([row], project)

        [line] = result["lines"]
        self.assertTrue(line["rectified"], line)
        self.assertFalse(frappe.db.exists(NON_PROJECT_EXPENSE, old_name))
        [leg] = self._live_leg(row)
        self.assertEqual((leg.target_doctype, leg.source, leg.created_by_import), (PROJECT_EXPENSE, source, 1))
        self.assertEqual(leg.transfer_id, frappe.db.get_value(ROW_DOCTYPE, row, "transfer_id"))
        new = frappe.get_doc(PROJECT_EXPENSE, leg.target_name)
        self.assertEqual(new.projects, project)
        for field in _KEPT:
            self.assertEqual(str(new.get(field)), str(old.get(field)), field)
        self.assertEqual(float(new.amount), 4250.0)
        self.assertEqual(frappe.db.get_value(ROW_DOCTYPE, row, "row_status"), "Settled")

    def test_a_created_icici_expense_moves_to_a_project(self):
        self._assert_moved(ICICI)

    def test_a_created_cashfree_expense_moves_to_a_project(self):
        self._assert_moved(CASHFREE)


class TestThePlanShowsTheBankLine(BankRectifyCase):
    def test_it_shows_the_lines_remark_utr_beneficiary_amount_and_date(self):
        for source in (ICICI, CASHFREE):
            with self.subTest(source):
                row, name = self._created(source)
                utr = frappe.db.get_value(ROW_DOCTYPE, row, "transfer_id")

                plan = rectify.get_rectify_plan(json.dumps([row]))

                self.assertEqual(plan["source"], source)
                [line] = plan["lines"]
                self.assertIsNone(line["refusal"])
                self.assertEqual(
                    {k: line[k] for k in ("remark", "utr", "beneficiary", "amount", "date", "ledger", "expense")},
                    {
                        "remark": "site cement Testorchid",
                        "utr": utr,
                        "beneficiary": "Testvendor Hardware Stores",
                        "amount": 4250.0,
                        "date": "2026-10-14",
                        "ledger": NON_PROJECT_EXPENSE,
                        "expense": name,
                    },
                )


class TestAMovedBankExpenseMovesBackToNonProject(BankRectifyCase):
    def test_a_project_expense_goes_back_to_non_project_with_its_money_date_and_utr(self):
        row, old_name = self._created(ICICI)
        old = frappe.get_doc(NON_PROJECT_EXPENSE, old_name)
        self._move([row], self._allocation_project())

        result = self._move([row], None)

        self.assertTrue(result["lines"][0]["rectified"], result)
        [leg] = self._live_leg(row)
        self.assertEqual((leg.target_doctype, leg.created_by_import), (NON_PROJECT_EXPENSE, 1))
        back = frappe.get_doc(NON_PROJECT_EXPENSE, leg.target_name)
        self.assertNotEqual(back.name, old_name)
        for field in _KEPT:
            self.assertEqual(str(back.get(field)), str(old.get(field)), field)


class TestALineSettledToMoreThanOneRecordIsRefused(BankRectifyCase):
    def test_a_line_allocated_across_two_payments_is_refused_and_left_as_it_was(self):
        row = self._staged_row(amount="90")
        payments = [self._approved_payment("60"), self._approved_payment("30")]
        allocate_row(
            row=row,
            targets=json.dumps([{"target_doctype": "Project Payments", "target_name": p} for p in payments]),
        )

        plan = rectify.get_rectify_plan(json.dumps([row]))
        result = self._move([row], self._allocation_project())

        split = "This line settled more than one record, so it cannot be moved in part."
        self.assertEqual(plan["lines"][0]["refusal"], split)
        self.assertEqual(result["lines"][0], {"row": row, "rectified": False, "reason": split})
        self.assertEqual(sorted(leg.target_name for leg in self._live_leg(row)), sorted(payments))


class TestALinkedLineIsRefused(BankRectifyCase):
    def test_a_line_linked_to_an_existing_expense_is_not_moved(self):
        row, name = self._linked(NON_PROJECT_EXPENSE)

        result = self._move([row], self._allocation_project())

        [line] = result["lines"]
        self.assertFalse(line["rectified"])
        self.assertIn("Unreconcile it instead", line["reason"])
        self.assertTrue(frappe.db.exists(NON_PROJECT_EXPENSE, name))


#: What the replacement keeps that Create never writes (owner, 2026-11-26): the account paid into, the approval dates.
CARRIED = {
    "pay_to_account_name": "Testvendor Hardware Stores",
    "pay_to_account_number": "000111222333",
    "pay_to_ifsc": "TEST0001234",
    "pay_to_bank_name": "Testbank",
    "pay_to_bank_branch": "Testnagar",
    "approval_date": "2026-10-12",
    "ceo_approval_date": "2026-10-13",
}


class TestAMoveKeepsWhatAPersonAddedLater(BankRectifyCase):
    def test_the_pay_to_account_approval_dates_and_a_persons_comment_follow_the_expense(self):
        row, old_name = self._created(CASHFREE)
        # As a data fix or a person left them on the Paid expense, after Create.
        frappe.db.set_value(NON_PROJECT_EXPENSE, old_name, CARRIED, update_modified=False)
        frappe.get_doc(NON_PROJECT_EXPENSE, old_name).add_comment("Comment", text="Type corrected from Office Rent")
        frappe.db.commit()

        result = self._move([row], self._allocation_project())

        self.assertTrue(result["lines"][0]["rectified"], result)
        [leg] = self._live_leg(row)
        new = frappe.get_doc(leg.target_doctype, leg.target_name)
        self.assertEqual({k: str(new.get(k)) for k in CARRIED}, CARRIED)
        comments = frappe.get_all(
            "Comment",
            filters={"reference_doctype": new.doctype, "reference_name": new.name, "comment_type": "Comment"},
            pluck="content",
        )
        self.assertIn("Type corrected from Office Rent", comments)


class TestTheTableKnowsACreatedLine(BankRectifyCase):
    """The Bulk Import table offers Move on a bank line only when its expense was created with Create."""

    def test_a_created_lines_match_says_so_and_a_linked_lines_does_not(self):
        created, _ = self._created(ICICI)
        linked, _ = self._linked(NON_PROJECT_EXPENSE)

        rows = {}
        for row in (created, linked):
            batch = frappe.db.get_value(ROW_DOCTYPE, row, "import_batch")
            rows.update({r["name"]: r for r in get_batch_rows(batch)["rows"]})

        self.assertEqual([m["created_by_import"] for m in rows[created]["matches"]], [1])
        self.assertEqual([m["created_by_import"] for m in rows[linked]["matches"]], [0])
