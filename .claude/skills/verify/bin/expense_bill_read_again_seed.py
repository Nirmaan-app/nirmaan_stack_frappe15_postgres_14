"""Seed the Read again part of the Expense bills walk (`walk_expense_bills.py`, #1645) on an env DB.

    devenv.sh script <task> .claude/skills/verify/bin/expense_bills_seed.py R<stamp>    # the two spends
    devenv.sh script <task> .claude/skills/verify/bin/expense_bill_read_again_seed.py <stamp> <card spend> <wallet spend>

Puts a made-up bill on each spend, in the two states Read again reaches (seeded: the env's reader gives only Not
read, and a stopped reading needs a worker killed mid-read):

* the card spend: Not read, "The reader failed (ClientError).", waiting in Pending Approval -> Credit Card;
* the wallet spend: Checking with its claim taken 20 minutes ago (past the 15-minute job limit), so Pending Approval
  -> Cashbook shows it Not read, "The reading stopped." Its line's wallet holder becomes "Walk Reread Holder
  <stamp>", so the walk finds this row alone.

Prints one line `EXPENSE_BILL_READ_AGAIN_SEED {json}`. Writes to the env DB only (its own commit).
"""

import json
import sys

import frappe
from frappe.utils import add_to_date, now_datetime
from frappe.utils.file_manager import save_file

stamp, card, wallet = sys.argv[1:4]
NPE, PE = "Non Project Expenses", "Project Expenses"


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


def bill(doctype: str, expense: str, slug: str, **state) -> str:
    line, amount = frappe.db.get_value("Outflow Row Match", {"target_doctype": doctype, "target_name": expense,
                                                             "match_kind": "Settled"}, ["import_row", "target_amount"])
    pdf = one_page_pdf(f"Walk {slug} {stamp} - Grand Total Rs {amount}")
    file_url = save_file(f"walk-{slug}-{stamp}.pdf", pdf, doctype, expense, is_private=1).file_url
    frappe.db.set_value(doctype, expense, "invoice_attachment", file_url, update_modified=False)
    return frappe.get_doc({"doctype": "Expense Bill", "expense_doctype": doctype, "expense": expense, "is_latest": 1,
                           "bill_file": file_url, "uploaded_by": "walk-accountant@example.com", "statement_line": line,
                           "line_amount": amount, "status": "Pending", **state}).insert(ignore_permissions=True).name


holder = f"Walk Reread Holder {stamp}"
wallet_line = frappe.db.get_value("Outflow Row Match", {"target_doctype": PE, "target_name": wallet}, "import_row")
frappe.db.set_value("Outflow Import Row", wallet_line, "added_by_raw", holder, update_modified=False)

answer = {
    "card": card,
    "card_holder": frappe.db.get_value("Credit Card Statement",
                                       frappe.db.get_value(NPE, card, "credit_card_statement"), "holder"),
    "card_bill": bill(NPE, card, "reread-card", bill_check="Not read",
                      bill_check_reason="The reader failed (ClientError).", read_claimed_at=now_datetime()),
    "wallet": wallet,
    "wallet_holder": holder,
    "wallet_bill": bill(PE, wallet, "reread-wallet", bill_check="Checking",
                        read_claimed_at=add_to_date(now_datetime(), minutes=-20)),
}
frappe.db.commit()
print("EXPENSE_BILL_READ_AGAIN_SEED " + json.dumps(answer))
