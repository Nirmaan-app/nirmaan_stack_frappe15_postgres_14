import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import flt, nowdate

ALLOWED_DOCS = {"Procurement Orders", "Service Requests"}

@frappe.whitelist()
def create_payment_request(data: str) -> str:
    """
    Create a new Project Payments doc in a single transaction.

    Args:
        data (json str) = {
            "doctype" : "Procurement Orders" | "Service Requests",
            "docname": "<PO/000/00000/25-26>",
            "amount" : 12345.67
        }
    Returns: JSON string { "name": "<PAY-00042-087>" }
    """
    payload = frappe.parse_json(data)
    doctype = payload.get("doctype")
    docname = payload.get("docname")
    amount  = flt(payload.get("amount"))

    if doctype not in ALLOWED_DOCS:
        frappe.throw(_("Not allowed for doctype {0}").format(doctype))

    if amount <= 0:
        frappe.throw(_("Amount must be greater than zero"))

    # ── fetch source document inside the txn ───────────────────────
    src = frappe.get_doc(doctype, docname)

    # ── calculate financials --------------------------------------
    from nirmaan_stack.services.finance import (
        get_source_document_financials,        # returns grand_total, grand_total_excl_gst
        get_total_paid,   # returns sum of approved+paid Project Payments
        get_total_pending # returns sum of Requested (pending) Payments
    )
    totals = get_source_document_financials(src)
    paid         = get_total_paid(src)
    pending      = get_total_pending(src)
    available    = totals.get("payable_total") - paid - pending
    print(f"paid: {paid}, pending: {pending}, available: {available}, grand: {totals}")

    if amount > (available + 10):
        frappe.throw(_(
            "Maximum amount you can request is {0} (available balance)"
        ).format(frappe.format_value(available, "Currency")))

    # ── create payment doc  (ACID wrapper) ─────────────────────────
    pay = frappe.new_doc("Project Payments")
    pay.update({
        "document_type" : doctype,
        "document_name" : docname,
        "project"       : src.project,
        "vendor"        : src.vendor,
        "amount"        : round(amount),
        "status"        : "Requested",
    })
    pay.insert()
    frappe.db.commit()

    return frappe.as_json({"name": pay.name})


# --------------------------------------------------------------------------------
#  update_payment_request   (fulfil or delete)
# --------------------------------------------------------------------------------

@frappe.whitelist()
def update_payment_request(data: str) -> str:
    """
    Fulfil or delete a Project Payments document in ONE transaction.

    Args (json str):
    {
      "action" : "fulfil" | "delete",
      "name"   : "<PAY-00042-087>",
      "utr"    : "...",            # required for fulfil
      "tds"    : 123.45,           # optional
      "pay_date": "2025-05-24",    # optional, defaults to today
      "file_url"   : "..."         # optional, proof of payment
    }
    Returns: {"status":"success"}
    """
    args = frappe.parse_json(data)
    action = args.get("action")
    name   = args.get("name")

    if action not in ("fulfil", "delete"):
        frappe.throw(_("Invalid action"))

    pay = frappe.get_doc("Project Payments", name)
    if action == "delete":
        _delete_payment(pay)
    else:
        _fulfil_payment(pay, args)

    frappe.db.commit()
    return frappe.as_json({"status": "success"})


# ---------------- helpers --------------------------------------------------------
def _delete_payment(pay):
    # if pay.status != "Requested":
    #     frappe.throw(_("Only 'Requested' payments may be deleted"))
    pay.delete()

def _fulfil_payment(pay, args):
    if pay.status != "Approved":
        frappe.throw(_("Payment is already processed or not approved"))

    utr = (args.get("utr") or "").strip()
    if not utr:
        frappe.throw(_("UTR is required"))
    
    dup = frappe.db.get_value(
        "Project Payments",
        {"utr" : utr},
        "name"
    )

    if dup and dup != pay.name:
        frappe.throw(f"UTR {utr} already exists in payment {dup}")

    pay.status        = "Paid"
    pay.utr           = utr
    pay.tds           = flt(args.get("tds") or 0)
    pay.payment_date  = args.get("pay_date") or nowdate()

    pay.save()                    # row-level lock until commit

    # optional proof upload
    file_url = args.get("file_url")
    if file_url:
        _attach_file(pay, file_url)


def _attach_file(pay, file_url: str):
    pay.payment_attachment = file_url
    pay.save()
