"""Seed the All Invoices part of the Expense bills walk (`walk_expense_bills.py --part all-invoices`, #1646).

    devenv.sh script <task> .claude/skills/verify/bin/all_invoices_seed.py <stamp> <card spend> <wallet spend>

The two spends are `expense_bills_seed.py`'s (a made-up card spend and wallet spend with their statement lines). The
env's reader gives only Not read, so every other state is seeded here:

* the card spend: an older bill read Mismatched (₹1,250) and Rejected, "Walk: another shop", no longer latest; and
  its latest bill Matched (₹1,180), auto-approved by System, number "WAI-<stamp>" and today's date, mirrored onto the
  spend;
* the wallet spend (its wallet holder made "Walk Wallet Holder <stamp>"): its latest bill Not read, "The reader failed (ClientError).", Pending;
* a made-up Porter Invoice "WALKPRT<stamp>" whose PDF never arrived: Validate result Error, "Walk: the invoice could
  not be downloaded.".

Prints one line `ALL_INVOICES_SEED {json}`: {"card_old", "card_latest", "wallet", "porter"} names. Writes to the env
DB only (its own commit).
"""

import json
import sys

import frappe
from frappe.utils import now_datetime, nowdate

stamp, card, wallet = sys.argv[1:4]
NPE, PE = "Non Project Expenses", "Project Expenses"
#: Each spend's statement line (`expense_bills_seed.line_and_match`'s transfer id); the wallet's holder made unique.
card_line = frappe.db.get_value("Outflow Import Row", {"transfer_id": f"WALKN{stamp}"}, "name")
wallet_line = frappe.db.get_value("Outflow Import Row", {"transfer_id": f"WALKP{stamp}"}, "name")
frappe.db.set_value("Outflow Import Row", wallet_line, "added_by_raw", f"Walk Wallet Holder {stamp}")


def bill(doctype: str, expense: str, amount: float, slug: str, line: str, latest: int = 1, **state) -> str:
    return frappe.get_doc({
        "doctype": "Expense Bill", "expense_doctype": doctype, "expense": expense, "is_latest": latest,
        "bill_file": f"/private/files/walk-all-invoices-{slug}-{stamp}.pdf", "uploaded_by": "walk-accountant@example.com",
        "line_amount": amount, "statement_line": line, **state,
    }).insert(ignore_permissions=True).name


seeded = {
    "card_old": bill(NPE, card, 1180, "card-old", card_line, latest=0, bill_check="Mismatched", read_total=1250,
                     bill_check_reason="The bill's total is ₹1,250.00; the statement line is ₹1,180.00.",
                     status="Rejected", rejection_reason="Walk: another shop",
                     rejected_by="walk-accountant@example.com", rejected_on=now_datetime()),
    "card_latest": bill(NPE, card, 1180, "card", card_line, bill_check="Matched", read_total=1180, invoice_no=f"WAI-{stamp}",
                        invoice_date=nowdate(), status="Approved", auto_approved=1, approved_by="System",
                        approved_on=now_datetime()),
    "wallet": bill(PE, wallet, 2360, "wallet", wallet_line, bill_check="Not read",
                   bill_check_reason="The reader failed (ClientError).", status="Pending"),
}
frappe.db.set_value(NPE, card, {"invoice_attachment": f"/private/files/walk-all-invoices-card-{stamp}.pdf",
                                "invoice_ref": f"WAI-{stamp}", "invoice_date": nowdate()})
frappe.db.set_value(PE, wallet, "invoice_attachment", f"/private/files/walk-all-invoices-wallet-{stamp}.pdf")

porter = frappe.get_doc({
    "doctype": "Porter Invoice", "invoice_number": f"WALKPRT{stamp}", "validation_status": "Error",
    "validation_message": "Walk: the invoice could not be downloaded.", "city": "Testpur", "completed_orders": 2,
    "fare_total": 400, "tax_total": 72,
})
porter.name = f"WALKPRT{stamp}"
porter.db_insert()
seeded["porter"] = porter.name
frappe.db.commit()
print("ALL_INVOICES_SEED " + json.dumps(seeded))
