"""Seed the All Payments part of the Expense bills walk (`walk_expense_bills.py --part all-payments`, #1648).

    devenv.sh script <task> .claude/skills/verify/bin/all_payments_bill_seed.py <stamp>

Makes made-up Paid records whose Against text starts "WalkAP-<stamp>" (the All Payments search's default field), each
with a real private bill file attached to its Expense (so the Invoice link opens):

* Non-Project Expenses "WalkAP-<stamp> mismatched": latest Expense bill Mismatched, Pending.
* Project Expenses "WalkAP-<stamp> matched": latest Expense bill Matched, Auto-approved.
* Non-Project Expenses "WalkAP-<stamp> nobill": a bill on the Expense but no Expense bill (one attached before launch).
* Project Payments against "WalkAP-<stamp>-PO" (a PO payment) and "WalkAP-<stamp>-WO" (a WO payment).

The Bill check results are seeded (the env's reader key is refused, so a reading gives only Not read).
Prints one line `ALL_PAYMENTS_BILL_SEED {json}`: {slug: {"doctype", "name", "invoice"}}. Writes to the env DB and its
private files only (its own commit).
"""

import json
import sys

import frappe
from frappe.utils import now_datetime, nowdate

from nirmaan_stack.services.outflow_import.card_types import FALLBACK_EXPENSE_TYPE

stamp = sys.argv[1]
NPE, PE = "Non Project Expenses", "Project Expenses"
ACCOUNTANT = "walk-accountant@example.com"
project = frappe.get_all("Projects", pluck="name", order_by="creation asc", limit=1)[0]
project_type = frappe.db.get_value("Expense Type", {"project": 1}, "name")


def pdf(text: str) -> bytes:
    """A one-page PDF reading `text` (the upload check refuses a file that is not a readable PDF)."""
    stream = f"BT /F1 14 Tf 60 760 Td ({text}) Tj ET"
    objects = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
        f"<< /Length {len(stream)} >>\nstream\n{stream}\nendstream",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    body, offsets = "%PDF-1.4\n%\xe2\xe3\xcf\xd3\n", []
    for i, obj in enumerate(objects, 1):
        offsets.append(len(body))
        body += f"{i} 0 obj\n{obj}\nendobj\n"
    xref = len(body)
    body += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n" + "".join(f"{o:010d} 00000 n \n" for o in offsets)
    body += f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n"
    return body.encode("latin-1")


def spend(doctype: str, slug: str) -> dict:
    fields = {"projects": project, "type": project_type} if doctype == PE else {"type": FALLBACK_EXPENSE_TYPE}
    name = frappe.get_doc({"doctype": doctype, "status": "Paid", "amount": 1000, "payment_date": nowdate(),
                           "description": f"WalkAP-{stamp} {slug}", **fields}).insert(ignore_permissions=True).name
    # A file with bytes of its own (Frappe reuses the URL of any File with the same content).
    file = frappe.get_doc({"doctype": "File", "file_name": f"walkap-{stamp}-{slug}.pdf", "is_private": 1,
                           "attached_to_doctype": doctype, "attached_to_name": name,
                           "content": pdf(f"WalkAP {stamp} {slug}")}).insert(
        ignore_permissions=True)
    # `set_value` skips the Expense's doc_events on purpose: the walk's Expense bills are seeded, not received.
    frappe.db.set_value(doctype, name, "invoice_attachment", file.file_url, update_modified=False)
    return {"doctype": doctype, "name": name, "invoice": file.file_url}


def bill(expense: dict, **state) -> str:
    return frappe.get_doc({"doctype": "Expense Bill", "expense_doctype": expense["doctype"], "expense": expense["name"],
                           "is_latest": 1, "bill_file": expense["invoice"], "uploaded_by": ACCOUNTANT,
                           "line_amount": 1000, "read_claimed_at": now_datetime(), **state}).insert(
        ignore_permissions=True).name


def payment(slug: str, document_type: str) -> dict:
    name = f"WALKAP-{stamp}-{slug}"
    # Raw on purpose: a bare Paid payment row is all All Payments reads; validate would demand a real PO / WO.
    frappe.db.sql(
        """INSERT INTO "tabProject Payments" (name, creation, modified, modified_by, owner, docstatus, idx,
               amount, status, document_type, document_name, payment_date)
           VALUES (%s, NOW(), NOW(), 'Administrator', 'Administrator', 0, 0, 5000, 'Paid', %s, %s, %s)""",
        (name, document_type, f"WalkAP-{stamp}-{slug}", nowdate()),
    )
    return {"doctype": "Project Payments", "name": name, "invoice": ""}


seeded = {
    "mismatched": spend(NPE, "mismatched"),
    "matched": spend(PE, "matched"),
    "nobill": spend(NPE, "nobill"),
    "po": payment("PO", "Procurement Orders"),
    "wo": payment("WO", "Service Requests"),
}
bill(seeded["mismatched"], bill_check="Mismatched", read_total=1250, status="Pending")
bill(seeded["matched"], bill_check="Matched", read_total=1000, status="Approved", auto_approved=1,
     approved_by="System", approved_on=now_datetime())
frappe.db.commit()
print("ALL_PAYMENTS_BILL_SEED " + json.dumps(seeded))
