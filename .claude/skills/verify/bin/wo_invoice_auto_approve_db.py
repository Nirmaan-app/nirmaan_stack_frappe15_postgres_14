"""Read what the Work Order invoice auto-approval walk wrote (`walk_wo_invoice_auto_approve.py`). Read-only.

    devenv.sh script <task> .claude/skills/verify/bin/wo_invoice_auto_approve_db.py <work order> <invoice no> ...

Prints one JSON line: {<invoice no>: {"invoice": {name, status, approved_by, auto_approved,
auto_approve_skip_reasons, invoice_amount} or null, "record": {name, status, vendor_invoice} or null}}, the
record being the WO Generated Invoice of that number, if any.
"""

import json
import sys

import frappe

wo, numbers = sys.argv[1], sys.argv[2:]
out = {}
for number in numbers:
    invoice = frappe.db.get_value(
        "Vendor Invoices", {"document_type": "Service Requests", "document_name": wo, "invoice_no": number},
        ["name", "status", "approved_by", "auto_approved", "auto_approve_skip_reasons", "invoice_amount"],
        as_dict=True, order_by="creation desc")
    record = frappe.db.get_value("WO Generated Invoice", {"work_order": wo, "invoice_no": number},
                                 ["name", "status", "vendor_invoice"], as_dict=True)
    out[number] = {"invoice": invoice, "record": record}
print(json.dumps(out, default=str))
