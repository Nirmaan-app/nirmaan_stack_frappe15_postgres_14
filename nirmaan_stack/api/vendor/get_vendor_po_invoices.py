# nirmaan_stack/nirmaan_stack/api/vendor/get_vendor_po_invoices.py

import frappe
import json

@frappe.whitelist()
def get_po_ledger_data(vendor_id):
    """
    Fetches all POs for a vendor. It now converts all currency fields (total_amount,
    payment amount, invoice amount) into integers (paise) on the server to
    avoid floating-point inaccuracies on the frontend.
    """
    if not vendor_id:
        frappe.throw("Vendor ID is a required parameter.")

    vendor_pos = frappe.get_all(
            "Procurement Orders",
            filters={"vendor": vendor_id, "status": ["!=", "Merged"], "creation": [">=", "2025-04-01"]},
            fields=["name", "creation", "total_amount", "project_name", "vendor_name", "invoice_data"]
        )

    if not vendor_pos:
        return []

    # 2. Loop through each PO to process its children
    for po in vendor_pos:
        po_name = po.get("name")
        
        # --- FIX: Convert PO total_amount to paise (integer) ---
        po['total_amount'] = int(round((po.get('total_amount') or 0) * 100))

        # Find linked payments
        payments = frappe.get_all(
            "Project Payments",
            filters={ "vendor": vendor_id, "document_type": "Procurement Orders", "document_name": po_name, "status": "Paid", "payment_date": [">=", "2025-04-01"] },
            fields=["name", "payment_date", "creation", "amount", "utr", "tds"]
        )

        # --- FIX: Convert payment amounts to paise (integer) ---
        for payment in payments:
            payment['amount'] = int(round((frappe.utils.flt(payment.get('amount')) or 0) * 100))
        po["project_payments"] = payments
        
        # Parse Invoice JSON
        invoice_data_dict = po.pop("invoice_data", None)
        parsed_invoices = []
        
        if invoice_data_dict and isinstance(invoice_data_dict, dict) and invoice_data_dict.get("data"):
            for date, invoice_details in invoice_data_dict["data"].items():
                if isinstance(invoice_details, dict):
                    # --- FIX: Convert invoice amount to paise (integer) ---
                    invoice_details['amount'] = int(round((frappe.utils.flt(invoice_details.get('amount')) or 0) * 100))
                    invoice_details["date"] = date
                    parsed_invoices.append(invoice_details)
        
        po["invoices"] = parsed_invoices

    return vendor_pos


    
# import frappe

# @frappe.whitelist()
# def get_po_ledger_data(vendor_id):
#     """
#     Fetches all POs for a vendor and enriches each PO object with a
#     nested list of its associated 'Paid' payments. This creates a clean,
#     PO-centric data structure for the frontend ledger view.
#     """
#     if not vendor_id:
#         frappe.throw("Vendor ID is a required parameter.")

#     # 1. Get all relevant POs for the vendor.
#     # We use status != 'Merged' as a common filter. Adjust if needed.
#     vendor_pos = frappe.get_all(
#         "Procurement Orders",
#         filters={"vendor": vendor_id, "status": ["!=", "Merged"]},
#         # Fetch all fields required for the ledger display
#         fields=["name", "creation", "total_amount", "project_name", "vendor_name"]
#     )

#     if not vendor_pos:
#         return []

#     # 2. Loop through each PO to find its children payments.
#     for po in vendor_pos:
#         po_name = po.get("name")

#         # Find all 'Paid' payments linked directly to this specific PO and Vendor.
#         payments = frappe.get_all(
#             "Project Payments",
#             filters={
#                 "vendor": vendor_id,
#                 "document_type": "Procurement Orders",
#                 "document_name": po_name,
#                 "status": "Paid"
#             },
#             fields=["name", "payment_date", "creation", "amount", "utr","tds"]
#         )
#         # Add the found payments as a nested list to the PO dictionary.
#         po["project_payments"] = payments

#     # 3. Return the fully enriched list of POs.
#     return vendor_pos