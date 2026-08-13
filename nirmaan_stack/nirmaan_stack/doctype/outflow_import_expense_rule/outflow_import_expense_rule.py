# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Outflow Import Expense Rule -- keyword in a remark -> expense type, per ledger.

A Cashbook statement carries no expense type, so one is read from the remark text. This table is
that reading, and it is a DOCTYPE rather than a file for one reason: every row points at the NAME of
an `Expense Type`. A JSON asset would keep a dead name after a rename and the import would either
throw halfway through a batch or, worse, quietly book everything to the fallback. A `Link` field
makes Frappe refuse the delete, and `track_changes` records who changed a mapping and when.

⚠️ THE LEDGER IS PART OF THE RULE, NOT A FILTER ON IT. The two expense ledgers have almost disjoint
vocabularies -- on the live master 12 types are project-only, 25 are non-project-only, and just 2
carry both flags -- so `Material Transportation Charges` simply does not exist for a Non-Project
Expense. The same words therefore have to resolve differently depending on whether a project was
found: "Courier charges veeva project" is Material Transportation Charges, and "Courier charges"
alone is Postage & Courier. That is forced by the data, not chosen.

Identity is `(keyword, ledger)`, carried by the autoname format, so Frappe refuses a duplicate
outright rather than leaving two rules to disagree about one word.
"""

import frappe
from frappe.model.document import Document

# Which `Expense Type` flag a rule's ledger requires. The import re-asserts this at write time via
# `settle._assert_type_scope`; catching it here means a mapping that could never work is refused
# when it is written rather than when a batch is halfway through.
LEDGER_FLAG = {"Project": "project", "Non Project": "non_project"}


class OutflowImportExpenseRule(Document):
    def validate(self):
        self.keyword = (self.keyword or "").strip()
        if not self.keyword:
            frappe.throw("A keyword is required.", title="Missing keyword")

        flag = LEDGER_FLAG.get(self.ledger)
        if flag is None:
            frappe.throw(
                f"'{self.ledger}' is not a ledger this import writes to.", title="Unknown ledger"
            )

        # ⚠️ A RULE POINTING AT THE WRONG SIDE IS INERT, AND SILENTLY SO. `_assert_type_scope`
        # refuses the type at write time, so the row would fall to the fallback with nothing on
        # screen explaining why the rule the user wrote never fired.
        if not frappe.db.get_value("Expense Type", self.expense_type, flag):
            frappe.throw(
                f"'{self.expense_type}' is not available for a {self.ledger} expense. "
                f"Tick '{flag}' on that Expense Type, or choose one that already carries it.",
                title="Wrong side of the ledger",
            )


def on_doctype_update():
    frappe.db.add_index("Outflow Import Expense Rule", ["ledger", "active"], "oier_ledger_idx")
