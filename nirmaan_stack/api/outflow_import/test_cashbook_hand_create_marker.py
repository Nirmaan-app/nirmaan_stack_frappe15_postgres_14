# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""A hand Create from a line the Cashbook Statement import staged gives the Expense the Cashbook marker (#1592, kept
by #1708), so it waits in Pending Invoices Upload -> Cashbook; a hand Create from any other source's line does not.

Seam: the main-table endpoint `expenses.create_expense`, on the real-file Cashbook fixture's staged lines and on a
made-up Cashfree line.
Run: DEVENV test --module nirmaan_stack.api.outflow_import.test_cashbook_hand_create_marker
"""

import frappe

from nirmaan_stack.api.outflow_import.expenses import create_expense
from nirmaan_stack.api.outflow_import.test_cashbook_collect_payments import CollectPaymentCase
from nirmaan_stack.api.outflow_import.test_cashbook_import import _purge

NPE = "Non Project Expenses"


class TestAHandCreateKeepsTheCashbookMarker(CollectPaymentCase):
    def _created(self, row: str) -> frappe._dict:
        create_expense(row=row, doctype=NPE, expense_type="Petty Cash")
        match = frappe.db.get_value(
            "Outflow Row Match", {"import_row": row, "match_kind": "Settled"}, ["target_doctype", "target_name"],
            as_dict=True,
        )
        return frappe.db.get_value(match.target_doctype, match.target_name, ["name", "cashbook_batch"], as_dict=True)

    def test_a_wallet_spend_line_the_job_failed_carries_the_marker(self):
        line = frappe.get_all(
            "Outflow Import Row",
            filters={"import_batch": self.batch, "row_kind": "Wallet Spend", "row_status": "Pending match run"},
            pluck="name",
            limit=1,
        )[0]
        # The job could not create it: the line is Error, and a person creates it by hand.
        frappe.db.set_value("Outflow Import Row", line, "row_status", "Error", update_modified=False)
        frappe.db.commit()

        self.assertEqual(self._created(line).cashbook_batch, self.batch)

    def test_a_line_of_another_source_gets_no_marker(self):
        batch = frappe.get_doc(
            {"doctype": "Outflow Import Batch", "source": "Cashfree", "status": "Draft",
             "original_filename": "walk.csv", "uploaded_by": "Administrator"}
        ).insert(ignore_permissions=True)
        self.addCleanup(_purge, batch.name)
        line = frappe.get_doc(
            {"doctype": "Outflow Import Row", "import_batch": batch.name, "source": "Cashfree",
             "transfer_id": "CF" + self.suffix, "amount": 150, "direction": "Debit",
             "added_on": "2026-08-01 10:00:00", "row_status": "Mismatched", "remarks": "Hand create marker test"}
        ).insert(ignore_permissions=True)
        frappe.db.commit()

        self.assertFalse(self._created(line.name).cashbook_batch)
