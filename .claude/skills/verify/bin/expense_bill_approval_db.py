"""The approval part of the Expense bills walk's DB read (#1644).

    devenv.sh script <task> .claude/skills/verify/bin/expense_bill_approval_db.py <bill> [<bill> ...]

Prints one line `EXPENSE_BILL_APPROVAL_DB {json}`: {bill: {"bill": {...}, "expense": {...}, "versions": {...}}},
where versions counts the Version rows each user wrote on the bill and on its Expense. Also `"pending"`: the Pending
Vendor Invoices by document type, which the PO and WO pills list.
"""

import json
import sys

import frappe

answer = {}
for name in sys.argv[1:]:
    bill = frappe.db.get_value("Expense Bill", name, ["name", "expense_doctype", "expense", "status", "bill_check",
                                                      "approved_by", "approved_on", "rejection_reason", "invoice_no",
                                                      "invoice_date", "is_latest"], as_dict=True)
    expense = frappe.db.get_value(bill.expense_doctype, bill.expense,
                                  ["invoice_attachment", "invoice_ref", "invoice_date", "no_invoice_by"], as_dict=True)
    versions = {}
    for doctype, docname in (("Expense Bill", name), (bill.expense_doctype, bill.expense)):
        for owner in frappe.get_all("Version", filters={"ref_doctype": doctype, "docname": docname}, pluck="owner"):
            versions.setdefault(doctype, {}).setdefault(owner, 0)
            versions[doctype][owner] += 1
    answer[name] = {"bill": bill, "expense": expense, "versions": versions}
answer["pending"] = {
    doctype: frappe.get_all("Vendor Invoices", filters={"status": "Pending", "document_type": doctype}, pluck="document_name")
    for doctype in ("Procurement Orders", "Service Requests")
}
print("EXPENSE_BILL_APPROVAL_DB " + json.dumps(answer, default=str))
