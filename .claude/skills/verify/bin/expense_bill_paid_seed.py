"""Seed the Payment Done part of the Expense bills walk (`walk_expense_bills.py --part paid-replace`, #1643).

    devenv.sh script <task> .claude/skills/verify/bin/expense_bills_seed.py P<stamp>
    devenv.sh script <task> .claude/skills/verify/bin/expense_bill_paid_seed.py <stamp> <card spend> <wallet spend>

Gives each made-up Paid spend of `expense_bills_seed.py` a first bill: a one-page PDF filed on the spend and its
Expense bill, Not read and Pending (a seeded state: the env's reader key is refused), typed number "FIRST-<stamp>".
Also a made-up hand-keyed Paid Non-Project Expense (no statement: "Walk hand-keyed spend <stamp>", ₹640.00), which
must get no Expense bill, and the made-up Accountant Lead `walk-accountant-lead@example.com`, whom the app access gate leaves open. Prints one
line `EXPENSE_BILL_PAID_SEED {json}`. Writes to the env DB only (its own commit).
"""

import json
import sys

import frappe
from frappe.utils import add_days, nowdate
from frappe.utils.file_manager import save_file

from nirmaan_stack.services.expense_bills.receive import statement_line_of

stamp, card, wallet = sys.argv[1:4]
LEAD = "walk-accountant-lead@example.com"

if not frappe.db.exists("User", LEAD):
    user = frappe.new_doc("User")
    user.update({"email": LEAD, "first_name": "Walk Accountant Lead", "send_welcome_email": 0})
    user.flags.no_welcome_mail = True
    user.insert(ignore_permissions=True)
frappe.get_doc("User", LEAD).add_roles("Nirmaan Accountant Lead")
frappe.db.set_value("Nirmaan Users", LEAD, "role_profile", "Nirmaan Accountant Lead Profile", update_modified=False)


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


first = {}
for doctype, spend in (("Non Project Expenses", card), ("Project Expenses", wallet)):
    file_url = save_file(f"walk-first-bill-{spend}.pdf", one_page_pdf(f"Walk first bill {stamp}"), doctype, spend,
                         is_private=1).file_url
    frappe.db.set_value(doctype, spend, {"invoice_attachment": file_url, "invoice_ref": f"FIRST-{stamp}",
                                         "invoice_date": add_days(nowdate(), -5)}, update_modified=False)
    line, amount = statement_line_of(doctype, spend, 0)
    first[spend] = frappe.get_doc({
        "doctype": "Expense Bill", "expense_doctype": doctype, "expense": spend, "is_latest": 1, "bill_file": file_url,
        "uploaded_by": "walk-accountant@example.com", "bill_check": "Not read",
        "bill_check_reason": "The reader failed (ClientError).", "statement_line": line, "line_amount": float(amount),
        "status": "Pending",
    }).insert(ignore_permissions=True).name

# Raw, as `test_paid_invoice` plants one: a hand insert at Paid is refused (`guard_hand_save`).
hand_keyed = f"WALK-HAND-{stamp}"
cols = {"name": hand_keyed, "owner": LEAD, "modified_by": LEAD, "docstatus": 0, "idx": 0, "status": "Paid",
        "amount": 640.0, "description": f"Walk hand-keyed spend {stamp}", "type": "Petty Cash",
        "payment_date": nowdate()}
frappe.db.sql(
    f'INSERT INTO "tabNon Project Expenses" (creation, modified, {", ".join(cols)}) '
    f'VALUES (NOW(), NOW(), {", ".join(["%s"] * len(cols))})',
    tuple(cols.values()),
)

frappe.db.commit()
print("EXPENSE_BILL_PAID_SEED " + json.dumps({"lead": LEAD, "first": first, "hand_keyed": hand_keyed}))
