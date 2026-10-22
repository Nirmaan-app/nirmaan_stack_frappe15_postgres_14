# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Link a TDS challan to the TDS Payment expense that records it (#1544) — the challan list's Link / Unlink.

⚠️ "TDS" HERE IS **TAX DEDUCTED AT SOURCE**, not the Technical Data Sheet family under `api/tds/`.

A deposit of tax is booked twice by hand: as a challan (the receipt, which Pay TDS spends against
deductions) and as a non-project *TDS Payment* expense (the money in the expense books). Nothing creates
or links either automatically; this records which expense is the challan's. Which expense may be linked
is the challan's own rule (`TDSChallanAttachment._validate_tds_payment_expense`), so the save goes
through the document and Desk and this endpoint refuse the same things.
"""

import frappe

CHALLAN_DOCTYPE = "TDS Challan Attachment"


@frappe.whitelist(methods=["POST"])
def set_challan_expense(challan, expense=None):
    """Set (or, with no expense, clear) the challan's TDS Payment expense. Needs write on the challan."""
    doc = frappe.get_doc(CHALLAN_DOCTYPE, challan)
    doc.tds_payment_expense = (expense or "").strip() or None
    doc.save()
    frappe.db.commit()
    return {"challan": doc.name, "tds_payment_expense": doc.tds_payment_expense}
