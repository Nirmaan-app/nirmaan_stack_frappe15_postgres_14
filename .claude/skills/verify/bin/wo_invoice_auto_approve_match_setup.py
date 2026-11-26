"""Set up the "unsigned copy whose amounts match" step of `walk_wo_invoice_auto_approve.py` (ADR-0050 decision 1).

    devenv.sh script <task> .claude/skills/verify/bin/wo_invoice_auto_approve_match_setup.py <work order> <accountant>

Clears what counts as billed on the Work Order but its Approved invoices: the made-up Accountant rejects every
Pending invoice on it (through `approve_vendor_invoice`, as on screen; the walk's own and any copied from
production), and Administrator voids every generated invoice not yet uploaded (an interrupted run leaves some).
Then Administrator generates the WO's FINAL for the rest of its total (`generate_invoice` at the largest amount
Generate allows), so Approved invoices + the FINAL = the WO total and rule 2 approves its copy even unsigned.
Writes to the env DB only (its own commits): run it on a throwaway env.

Prints one JSON line: {"record": {name, invoice_no, amount, ...}, "approved", "total", "paid", "rejected", "voided"}.
"""

import json
import sys

import frappe

from nirmaan_stack.api.invoices.approve_vendor_invoice import approve_vendor_invoice
from nirmaan_stack.api.service_requests import generated_invoices as gi_api

wo, accountant = sys.argv[1], sys.argv[2]

frappe.set_user(accountant)
rejected = []
for row in frappe.get_all("Vendor Invoices", filters={"document_type": "Service Requests", "document_name": wo,
                                                       "status": "Pending"}, fields=["name", "invoice_no"]):
    approve_vendor_invoice(row.name, "Rejected", "Walk setup: room for the matching unsigned copy")
    rejected.append(row.invoice_no)
frappe.db.commit()

frappe.set_user("Administrator")
voided = []
for name in frappe.get_all("WO Generated Invoice", filters={"work_order": wo, "status": "Generated"}, pluck="name"):
    gi_api.void_invoice(name, "Walk setup: room for the matching unsigned copy")
    voided.append(name)
frappe.db.commit()
state = gi_api._billing_state(frappe.get_doc("Service Requests", wo))
record = gi_api.generate_invoice(wo, amount=state["max_amount"])
frappe.db.commit()

sr = frappe.get_doc("Service Requests", wo)
approved = frappe.db.sql(
    """SELECT COALESCE(SUM(invoice_amount), 0) FROM "tabVendor Invoices"
       WHERE document_type = 'Service Requests' AND document_name = %s AND status = 'Approved'""", wo)[0][0]
print(json.dumps({"record": record, "approved": float(approved), "total": float(sr.total_amount or 0),
                  "paid": float(sr.amount_paid or 0), "rejected": rejected,
                  "voided": voided}, default=str))
