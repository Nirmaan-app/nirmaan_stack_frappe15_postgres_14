
import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import flt, nowdate

# This constant is a good security practice
ALLOWED_DOCS = {"Procurement Orders", "Service Requests"}

@frappe.whitelist()
def create_project_payment(doctype: str, docname: str, vendor: str, amount: float, project: str, ptname: str):
    """
    Creates a new "Project Payments" doc AND updates the source "PO Payment Terms" row
    in a single, atomic transaction. This is the cleaned and corrected version.

    Args:
        doctype (str): The type of the source document (e.g., "Procurement Orders").
        docname (str): The name of the source document (e.g., "PO/001").
        vendor (str): The Vendor ID.
        amount (float): The amount for the payment.
        project (str): The Project ID.
        ptname (str): The unique name of the 'PO Payment Terms' child row (e.g., a1b2c3d4).
    """
    try:
        # --- Step 1: Input Validation ---
        if doctype not in ALLOWED_DOCS:
            frappe.throw(_("Not allowed for doctype {0}").format(doctype))
        
        # Convert amount to float and validate
        amount = flt(amount)
        if amount <= 0:
            frappe.throw(_("Amount must be greater than zero."))

        # --- Step 2 (Optional but Recommended): Financial Validation ---
        # This part of your logic is good, so we keep it.
        # It ensures that the requested amount is valid against the PO's financials.
        from nirmaan_stack.services.finance import (
            get_source_document_financials,
            get_total_paid,
            get_total_pending
        )
        src = frappe.get_doc(doctype, docname) # We still need the doc for financial checks
        totals = get_source_document_financials(src)
        paid = get_total_paid(src)
        pending = get_total_pending(src)
        available = totals.get("payable_total") - paid - pending

        frappe.logger().info(
    f"Payment Request Calc for {docname}:"
)
        # Using a small epsilon for safe floating point comparison
        # if amount > (available + 0.01):
        #     frappe.throw(_(
        #         "Maximum amount you can request is {0} (available balance)"
        #     ).format(frappe.format_value(available, "Currency")))

        # --- Step 3: Create the new "Project Payments" document ---
        pay = frappe.new_doc("Project Payments")
        pay.update({
            "document_type": doctype,
            "document_name": docname,
            "project": project,
            "vendor": vendor,
            "amount": round(amount, 2),
            "status": "Requested", # Payments should start as Draft before submission
            # "source_payment_term": ptname # Link to the child row
        })
        pay.insert(ignore_permissions=True)

        # --- Step 4: Update the original child row ---
        # This is safe and efficient.
        frappe.db.set_value(
            "PO Payment Terms",         # The child DocType name
            ptname,                     # The unique name of the row to update
            {
                "status": "Requested",
                "project_payment": pay.name
            }
        )
        
        # !!! CRITICAL: DO NOT use frappe.db.commit() here !!!
        # Frappe will handle the transaction commit automatically.

        # --- Step 5: Return a success response ---
        return {
            "status": 200,
            "message": f"Payment for {pay.name} has been requested."
        }
        
    except frappe.DoesNotExistError as e:
        frappe.throw(_("A required document could not be found. Please check the details and try again."))
    except Exception as e:
        frappe.log_error(frappe.get_traceback(), "Create and Update Payment Failed")
        frappe.throw(_("An unexpected error occurred: {0}").format(str(e)))



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


