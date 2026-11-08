"""Seed the decisions part of the Vendor Invoice Recon walk (`walk_vendor_invoice_recon.py --part decisions`, #1638).

- `walk-accountant@example.com`, the made-up Accountant the uploader part also uses.
- `walk-procurement@example.com` and `walk-hr@example.com`, made-up users without an invoice-approval role
  (Procurement Executive and HR Executive profiles), who call the approve endpoint directly.
- Three Pending Vendor Invoices on a Purchase Order, numbered `WALK-1638-…`: the Accountant approves one and
  rejects one on screen, and the two non-approvers try to approve the third. Pending ones a past run left are used
  again, so a rerun adds only what the last one decided.

    devenv.sh script <task> .claude/skills/verify/bin/po_invoice_decision_seed.py

Prints one JSON line: {"approve", "reject", "refuse": <invoice>, "accountant", "procurement", "hr": <email>}.
Writes to the env DB only (its own commit). The invoices are inserted as Administrator through the doc, so every
Vendor Invoices hook runs; a Pending invoice moves no PO total.
"""

import json

import frappe
from frappe.utils import nowdate

PREFIX = "WALK-1638-"
USERS = {
    "accountant": ("walk-accountant@example.com", "Walk", "Accountant", "Nirmaan Accountant Profile", "Nirmaan Accountant"),
    "procurement": ("walk-procurement@example.com", "Walk", "Procurement", "Nirmaan Procurement Executive Profile",
                    "Nirmaan Procurement Executive"),
    "hr": ("walk-hr@example.com", "Walk", "HR", "Nirmaan HR Executive Profile", "Nirmaan HR Executive"),
}


def ensure_user(email: str, first: str, last: str, profile: str, role: str) -> None:
    if not frappe.db.exists("User", email):
        user = frappe.new_doc("User")
        user.update({"email": email, "first_name": first, "last_name": last, "send_welcome_email": 0})
        user.flags.no_welcome_mail = True
        user.insert(ignore_permissions=True)
    frappe.get_doc("User", email).add_roles(role)
    # The app's gates read the Nirmaan Users role profile (see vendor_invoice_recon_seed.py for why set_value).
    frappe.db.set_value("Nirmaan Users", email, {"full_name": f"{first} {last}", "role_profile": profile},
                        update_modified=False)


for email, *rest in USERS.values():
    ensure_user(email, *rest)

pending = frappe.get_all("Vendor Invoices", filters={"status": "Pending", "invoice_no": ["like", PREFIX + "%"]},
                         order_by="creation asc", pluck="name")
if len(pending) < 3:
    # Bill the PO of the newest real Pending PO invoice, so the row shows a real PO, project and vendor.
    parent = frappe.get_all("Vendor Invoices", filters={"status": "Pending", "document_type": "Procurement Orders",
                                                        "invoice_no": ["not like", PREFIX + "%"]},
                            fields=["document_name", "project", "vendor"], order_by="creation desc", limit=1)
    assert parent, "the env holds no Pending PO invoice to copy a PO from"
    for _ in range(3 - len(pending)):
        doc = frappe.new_doc("Vendor Invoices")
        doc.update({
            "document_type": "Procurement Orders", **parent[0],
            "invoice_no": PREFIX + frappe.generate_hash(length=6).upper(), "invoice_date": nowdate(),
            "invoice_amount": 118, "invoice_base_amount": 100, "invoice_gst_amount": 18,
            "status": "Pending", "uploaded_by": USERS["accountant"][0],
        })
        doc.insert(ignore_permissions=True)
        pending.append(doc.name)

frappe.db.commit()
print(json.dumps({"refuse": pending[0], "approve": pending[1], "reject": pending[2],
                  **{key: user[0] for key, user in USERS.items()}}))
