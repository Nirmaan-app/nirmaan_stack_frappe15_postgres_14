"""Read Vendor Invoices as the "Invoice Added By" column shows them. Read-only.

    devenv.sh script <task> .claude/skills/verify/bin/vendor_invoice_recon_db.py <invoice> [<invoice> ...]

Prints one JSON line: {<invoice>: {document_name, document_type, status, uploaded_by, full_name}}; `full_name` is the uploader's
Nirmaan Users name, or null when there is none (the column then shows the email).
"""

import json
import sys

import frappe

answer = {}
for name in sys.argv[1:]:
    row = frappe.db.get_value("Vendor Invoices", name, ["document_name", "document_type", "status", "uploaded_by"], as_dict=True)
    row["full_name"] = frappe.db.get_value("Nirmaan Users", row.uploaded_by, "full_name") or None
    answer[name] = dict(row)
print(json.dumps(answer, default=str))
