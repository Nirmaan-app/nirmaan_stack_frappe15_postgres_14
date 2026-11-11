"""Seed the approval part of the Expense bills walk (`walk_expense_bills.py`, #1644) on an env DB.

    devenv.sh script <task> .claude/skills/verify/bin/expense_bill_approval_seed.py <stamp>

The env's reader key is refused, so a real reading ends Not read; this seeds the one state a reading cannot give
there: a made-up card spend (₹1,180.00, holder "WALK APPROVAL HOLDER <stamp>") whose bill was read Mismatched
(₹1,250.00) and waits in Pending Approval -> Credit Card. The Accountant typed "TYPED-<stamp>" and a date three days
ago on the spend. Also two made-up users the app access gate leaves open: an Accountant Lead (marks No invoice) and
a PMO Executive (outside the approvers). Prints one line `EXPENSE_BILL_APPROVAL_SEED {json}`. Writes to the env DB
only (its own commit).
"""

import json
import sys

import frappe
from frappe.utils import add_days, now_datetime, nowdate
from frappe.utils.file_manager import save_file

from nirmaan_stack.services.outflow_import.card_types import FALLBACK_EXPENSE_TYPE

stamp = sys.argv[1]
NPE = "Non Project Expenses"

USERS = {
    "walk-accountant-lead@example.com": ("Nirmaan Accountant Lead Profile", ("Nirmaan Accountant Lead",)),
    "walk-pmo@example.com": ("Nirmaan PMO Executive Profile", ("Nirmaan PMO Executive",)),
}
for email, (profile, roles) in USERS.items():
    if not frappe.db.exists("User", email):
        user = frappe.new_doc("User")
        user.update({"email": email, "first_name": email.split("@")[0].replace("-", " ").title(), "send_welcome_email": 0})
        user.flags.no_welcome_mail = True
        user.insert(ignore_permissions=True)
    frappe.get_doc("User", email).add_roles(*roles)
    frappe.db.set_value("Nirmaan Users", email, "role_profile", profile, update_modified=False)

holder = f"WALK APPROVAL HOLDER {stamp}"
statement = frappe.get_doc({"doctype": "Credit Card Statement", "holder": holder,
                            "company": "STRATOS INFRA TECHNOLOGIES PVT LTD", "statement_date": nowdate(),
                            "period_from": nowdate(), "period_to": nowdate()}).insert(ignore_permissions=True).name
typed_date = add_days(nowdate(), -3)
spend = frappe.get_doc({"doctype": NPE, "type": FALLBACK_EXPENSE_TYPE, "status": "Paid", "amount": 1180,
                        "payment_date": nowdate(), "payment_ref": f"WALKBAKERY{stamp} Bangalore IN - {stamp}",
                        "description": f"Walk bakery spend {stamp}", "credit_card_statement": statement,
                        "invoice_ref": f"TYPED-{stamp}", "invoice_date": typed_date}).insert(ignore_permissions=True).name
batch = frappe.get_doc({"doctype": "Outflow Import Batch", "source": "ICICI Credit Card Statement"}).insert(
    ignore_permissions=True).name
line = frappe.get_doc({"doctype": "Outflow Import Row", "import_batch": batch, "transfer_id": f"WALKB{stamp}",
                       "amount": 1180, "row_status": "Settled", "direction": "Debit"}).insert(ignore_permissions=True).name
frappe.get_doc({"doctype": "Outflow Row Match", "import_row": line, "import_batch": batch, "transfer_id": f"WALKB{stamp}",
                "target_doctype": NPE, "target_name": spend, "target_amount": 1180, "match_kind": "Settled",
                "match_basis": "card statement", "created_by_import": 1}).insert(ignore_permissions=True)


def one_page_pdf(text: str) -> bytes:
    """A readable one-page PDF with one line of text (the upload hook refuses a damaged one)."""
    stream = f"BT /F1 14 Tf 1 0 0 1 60 760 Tm ({text}) Tj ET"
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


pdf = one_page_pdf(f"Walk Bakery {stamp} - Grand Total Rs 1,250.00")
file_url = save_file(f"walk-bakery-{stamp}.pdf", pdf, NPE, spend, is_private=1).file_url
frappe.db.set_value(NPE, spend, "invoice_attachment", file_url, update_modified=False)
bill = frappe.get_doc({"doctype": "Expense Bill", "expense_doctype": NPE, "expense": spend, "is_latest": 1,
                       "bill_file": file_url, "uploaded_by": "walk-accountant@example.com",
                       "bill_check": "Mismatched", "bill_check_reason": "The bill's total is ₹1,250.00; the statement line is ₹1,180.00.",
                       "read_claimed_at": now_datetime(), "read_total": 1250, "statement_line": line, "line_amount": 1180,
                       "status": "Pending"}).insert(ignore_permissions=True).name

frappe.db.commit()
print("EXPENSE_BILL_APPROVAL_SEED " + json.dumps({"spend": spend, "bill": bill, "holder": holder,
                                                  "typed_date": str(typed_date), "file_url": file_url}))
