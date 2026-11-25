"""Seed the Work Order invoice auto-approval walk (`walk_wo_invoice_auto_approve.py`, ADR-0050) on an env DB.

    devenv.sh script <task> .claude/skills/verify/bin/wo_invoice_auto_approve_seed.py <procurement user>

- `walk-accountant@example.com`, a made-up Accountant the app access gate leaves open (the one the Vendor Invoice
  Recon walk uses; every Accountant copied from production holds an asset, so the gate locks them).
- On an Approved GST-off Work Order the procurement user can see, whose invoices have caught up with its payments
  (Generate's least amount is ₹0) and with room left, three new generated invoices of ₹1,000, ₹1,100 and ₹1,200,
  made through `generate_invoice` as Administrator. Each run makes three more.

Prints one JSON line: {"wo", "project", "accountant", "records": [{name, invoice_no, amount}], "total", "paid",
"approved"} (the WO's figures before the walk). Writes to the env DB only (its own commit).
"""

import json
import sys

import frappe

from nirmaan_stack.api.service_requests import generated_invoices as gi_api

ACCOUNTANT = "walk-accountant@example.com"
procurement = sys.argv[1]


def ensure_accountant():
    if not frappe.db.exists("User", ACCOUNTANT):
        user = frappe.new_doc("User")
        user.update({"email": ACCOUNTANT, "first_name": "Walk", "last_name": "Accountant", "send_welcome_email": 0})
        user.flags.no_welcome_mail = True
        user.insert(ignore_permissions=True)
    if "Nirmaan Accountant" not in frappe.get_roles(ACCOUNTANT):
        frappe.get_doc("User", ACCOUNTANT).add_roles("Nirmaan Accountant")
    # The app's gates read the Nirmaan Users role profile; its `on_update` only fills asset departments. Written
    # only when it differs, so a second run touches nothing.
    values = {"full_name": "Walk Accountant", "role_profile": "Nirmaan Accountant Profile"}
    if frappe.db.get_value("Nirmaan Users", ACCOUNTANT, list(values), as_dict=True) != values:
        frappe.db.set_value("Nirmaan Users", ACCOUNTANT, values, update_modified=False)
    frappe.db.commit()


def pick_work_order():
    projects = frappe.get_all("User Permission", filters={"user": procurement, "allow": "Projects"}, pluck="for_value")
    filters = {"status": "Approved", "gst": "false", "project_gst": ("is", "set")}
    if projects:
        filters["project"] = ("in", projects)
    for name in frappe.get_all("Service Requests", filters=filters, pluck="name", order_by="modified desc"):
        sr = frappe.get_doc("Service Requests", name)
        state = gi_api._billing_state(sr)
        if not state["final"] and state["min_amount"] == 0 and state["max_amount"] >= 10_000:
            return sr
    sys.exit(f"no Approved GST-off Work Order with room to generate on {procurement}'s projects")


ensure_accountant()
sr = pick_work_order()
frappe.set_user("Administrator")
records = [gi_api.generate_invoice(sr.name, amount=amount) for amount in (1_000, 1_100, 1_200)]
frappe.db.commit()
approved = frappe.db.sql(
    """SELECT COALESCE(SUM(invoice_amount), 0) FROM "tabVendor Invoices"
       WHERE document_type = 'Service Requests' AND document_name = %s AND status = 'Approved'""", sr.name)[0][0]
print(json.dumps({
    "wo": sr.name, "project": sr.project, "accountant": ACCOUNTANT,
    "records": [{"name": r["name"], "invoice_no": r["invoice_no"], "amount": r["amount"]} for r in records],
    "total": float(sr.total_amount or 0), "paid": float(sr.amount_paid or 0), "approved": float(approved),
}))
