# nirmaan_stack/nirmaan_stack/api/vendor/get_vendor_po_invoices.py

import frappe
from frappe.utils import flt, get_datetime
import json

@frappe.whitelist()
def get_po_ledger_data(vendor_id):
    """
    Fetches all POs, their embedded Invoices from a JSON field, and related 
    Project Payments for a vendor. It returns them as a single, flat list of 
    chronologically sorted transactions. This version correctly maps the 
    project name to payments.
    """
    print(f"DEBUG LEDGER: ----- STARTING VENDOR LEDGER FOR {vendor_id} -----")
    
    if not vendor_id:
        frappe.throw("Vendor ID is a required parameter.")

    all_transactions = []
    log_counter = 1
    
    start_date = "2025-04-01"
    start_datetime=get_datetime(start_date)

    vendor_pos = frappe.get_all(
        "Procurement Orders",
        # filters={"vendor": vendor_id, "status": ["!=", "Merged"], "creation": [">=", start_date]},
        filters={"vendor": vendor_id, "status": ["!=", "Merged"]},
        fields=["name", "creation", "total_amount", "project_name", "invoice_data"]
    )
    print(f"DEBUG LEDGER: Found {len(vendor_pos)} Purchase Orders for vendor.")

    po_names = []
    # --- FIX Step 1: Create a map to store PO Name -> Project Name ---
    po_project_map = {}
    
    for po in vendor_pos:
        po_name = po.get("name")
        po_names.append(po_name)
        # Populate the map for later use
        po_project_map[po_name] = po.get("project_name", "N/A")

        po_amount = flt(po.get('total_amount', 0))
        all_transactions.append({
            "type": "PO Created", "date": get_datetime(po.get("creation")),
            "details": f"PO: {po.get('name')}", "amount": po_amount, "payment": 0,
            "project": po.get("project_name", "N/A")
        })
        print(f"DEBUG LEDGER {log_counter:02d}: ADDED [PO Created] - {po_name}, Amount: {po_amount}")
        log_counter += 1

        invoice_data_dict = po.get("invoice_data")
        
        if isinstance(invoice_data_dict, dict) and invoice_data_dict.get("data"):
            # This print statement is now more accurate.
            print(f"DEBUG LEDGER: Found and processing invoice data for PO {po_name}")
            for date_str, invoice_details in invoice_data_dict["data"].items():
                if isinstance(invoice_details, dict):
                    try:
                        transaction_date = get_datetime(date_str)
                    except ValueError:
                        print(f"DEBUG LEDGER {log_counter:02d}: SKIPPED [Invoice Date] - Invalid date format '{date_str}' in PO {po_name}")
                        log_counter += 1
                        continue

                    is_credit_note = flt(invoice_details.get("amount", 0)) < 0
                    inv_amount = flt(invoice_details.get('amount', 0))
                    inv_no = invoice_details.get('invoice_no')
                    
                    all_transactions.append({
                        "type": "Credit Note Recorded" if is_credit_note else "Invoice Recorded",
                        "date": transaction_date, "details": f"Invoice No: {inv_no}\nFor PO: {po_name}",
                        "amount": inv_amount, "payment": 0, "project": po.get("project_name", "N/A")
                    })
                    print(f"DEBUG LEDGER {log_counter:02d}: ADDED [Invoice Recorded] - {inv_no}, Amount: {inv_amount}")
                    log_counter += 1
        
    if po_names:
        payments = frappe.get_all(
            "Project Payments",
            filters={
                "vendor": vendor_id, "status": "Paid", "payment_date": [">=", start_date],
                "document_type": "Procurement Orders", "document_name": ["in", po_names]
            },
            fields=["name", "payment_date", "creation", "amount", "utr", "document_name", "project"]
        )
        print(f"DEBUG LEDGER: Found {len(payments)} related Project Payments.")

        for payment in payments:
            is_refund = flt(payment.get("amount", 0)) < 0
            payment_timestamp = payment.get("payment_date") or payment.get("creation")
            payment_amount = flt(payment.get("amount", 0))
            payment_name = payment.get("name")
            payment_po_link = payment.get("document_name")

            # --- FIX Step 2: Use the map to find the project name ---
            # Fallback to the payment's project ID if the PO isn't in our map for some reason.
            project_name_for_payment = po_project_map.get(payment_po_link, payment.get("project") or "N/A")

            all_transactions.append({
                "type": "Refund Received" if is_refund else "Payment Made",
                "date": get_datetime(payment_timestamp),
                "details": f"UTR: {payment.get('utr', 'N/A')}\nFor PO: {payment_po_link}",
                "amount": 0, "payment": payment_amount,
                "project": project_name_for_payment # Use the retrieved project name
            })
            # Updated print statement to show the resolved project name
            print(f"DEBUG LEDGER {log_counter:02d}: ADDED [Payment Made] - {payment_name}, Project: {project_name_for_payment}, Amount: {payment_amount}")
            log_counter += 1

    print(f"DEBUG LEDGER: Collected a total of {len(all_transactions)} transactions before sorting.")
     # --- FIX 2: Apply the date filter to the entire collection of transactions ---
    # This keeps only transactions on or after the start_date.
    filtered_transactions = [t for t in all_transactions if t["date"] >= start_datetime]
    print(f"DEBUG LEDGER: {len(filtered_transactions)} transactions remaining after filtering for dates >= {start_date}.")

    filtered_transactions.sort(key=lambda x: x["date"])
    print("DEBUG LEDGER: All transactions sorted by date.")

    for t in filtered_transactions:
        t["date"] = t["date"].strftime('%Y-%m-%d %H:%M:%S')

    print(f"DEBUG LEDGER: ----- RETURNING {len(all_transactions)} TRANSACTIONS FOR {vendor_id} -----")
    return filtered_transactions

# import frappe
# from frappe.utils import flt, get_datetime
# import json

# @frappe.whitelist()
# def get_po_ledger_data(vendor_id):
#     """
#     Fetches all POs, their embedded Invoices from a JSON field, and related 
#     Project Payments for a vendor. It returns them as a single, flat list of 
#     chronologically sorted transactions. This version uses print() for 
#     real-time console debugging and correctly handles pre-parsed JSON from Frappe.
#     """
#     print(f"DEBUG LEDGER: ----- STARTING VENDOR LEDGER FOR {vendor_id} -----")
    
#     if not vendor_id:
#         frappe.throw("Vendor ID is a required parameter.")

#     all_transactions = []
#     log_counter = 1
#     start_date = "2025-04-01"

#     vendor_pos = frappe.get_all(
#         "Procurement Orders",
#         filters={"vendor": vendor_id, "status": ["!=", "Merged"], "creation": [">=", start_date]},
#         fields=["name", "creation", "total_amount", "project_name", "invoice_data"]
#     )
#     print(f"DEBUG LEDGER: Found {len(vendor_pos)} Purchase Orders for vendor.")

#     po_names = []
#     for po in vendor_pos:
#         po_name = po.get("name")
#         po_names.append(po_name)

#         po_amount = flt(po.get('total_amount', 0))
#         all_transactions.append({
#             "type": "PO Created", "date": get_datetime(po.get("creation")),
#             "details": f"PO: {po.get('name')}", "amount": po_amount, "payment": 0,
#             "project": po.get("project_name", "N/A")
#         })
#         print(f"DEBUG LEDGER {log_counter:02d}: ADDED [PO Created] - {po_name}, Amount: {po_amount}")
#         log_counter += 1

#         ## --- FIX: Directly use the dictionary from Frappe, do not parse it again. ---
#         invoice_data_dict = po.get("invoice_data")
        
#         # Check if the data is a dictionary and has the 'data' key we need.
#         if isinstance(invoice_data_dict, dict) and invoice_data_dict.get("data"):
#             print(f"DEBUG LEDGER: Found valid invoice data for PO {po_name}")
#             for date_str, invoice_details in invoice_data_dict["data"].items():
#                 if isinstance(invoice_details, dict):
#                     try:
#                         transaction_date = get_datetime(date_str)
#                     except ValueError:
#                         print(f"DEBUG LEDGER {log_counter:02d}: SKIPPED [Invoice Date] - Invalid date format '{date_str}' in PO {po_name}")
#                         log_counter += 1
#                         continue

#                     is_credit_note = flt(invoice_details.get("amount", 0)) < 0
#                     inv_amount = flt(invoice_details.get('amount', 0))
#                     inv_no = invoice_details.get('invoice_no')
                    
#                     all_transactions.append({
#                         "type": "Credit Note Recorded" if is_credit_note else "Invoice Recorded",
#                         "date": transaction_date, "details": f"Invoice No: {inv_no}\nFor PO: {po_name}",
#                         "amount": inv_amount, "payment": 0, "project": po.get("project_name", "N/A")
#                     })
#                     print(f"DEBUG LEDGER {log_counter:02d}: ADDED [Invoice Recorded] - {inv_no}, Amount: {inv_amount}")
#                     log_counter += 1
        
#     if po_names:
#         payments = frappe.get_all(
#             "Project Payments",
#             filters={
#                 "vendor": vendor_id, "status": "Paid", "payment_date": [">=", start_date],
#                 "document_type": "Procurement Orders", "document_name": ["in", po_names]
#             },
#             fields=["name", "payment_date", "creation", "amount", "utr", "document_name", "project"]
#         )
#         print(f"DEBUG LEDGER: Found {len(payments)} related Project Payments.")

#         for payment in payments:
#             is_refund = flt(payment.get("amount", 0)) < 0
#             payment_timestamp = payment.get("payment_date") or payment.get("creation")
#             payment_amount = flt(payment.get("amount", 0))
#             payment_name = payment.get("name")

#             all_transactions.append({
#                 "type": "Refund Received" if is_refund else "Payment Made",
#                 "date": get_datetime(payment_timestamp),
#                 "details": f"UTR: {payment.get('utr', 'N/A')}\nFor PO: {payment.get('document_name')}",
#                 "amount": 0, "payment": payment_amount, "project": payment.get("project") or "N/A"
#             })
#             print(f"DEBUG LEDGER {log_counter:02d}: ADDED [Payment Made] - {payment_name}, Amount: {payment_amount}")
#             log_counter += 1

#     print(f"DEBUG LEDGER: Collected a total of {len(all_transactions)} transactions before sorting.")
#     all_transactions.sort(key=lambda x: x["date"])
#     print("DEBUG LEDGER: All transactions sorted by date.")

#     for t in all_transactions:
#         t["date"] = t["date"].strftime('%Y-%m-%d %H:%M:%S')

#     print(f"DEBUG LEDGER: ----- RETURNING {len(all_transactions)} TRANSACTIONS FOR {vendor_id} -----")
#     return all_transactions

# import frappe
# import json

# @frappe.whitelist()
# def get_po_ledger_data(vendor_id):
#     """
#     Fetches all POs for a vendor. It now converts all currency fields (total_amount,
#     payment amount, invoice amount) into integers (paise) on the server to
#     avoid floating-point inaccuracies on the frontend.
#     """
#     if not vendor_id:
#         frappe.throw("Vendor ID is a required parameter.")

#     vendor_pos = frappe.get_all(
#             "Procurement Orders",
#             filters={"vendor": vendor_id, "status": ["!=", "Merged"], "creation": [">=", "2025-04-01"]},
#             fields=["name", "creation", "total_amount", "project_name", "vendor_name", "invoice_data"]
#         )

#     if not vendor_pos:
#         return []

#     # 2. Loop through each PO to process its children
#     for po in vendor_pos:
#         po_name = po.get("name")
        
#         # --- FIX: Convert PO total_amount to paise (integer) ---
#         po['total_amount'] = int(round((po.get('total_amount') or 0)))

#         # Find linked payments
#         payments = frappe.get_all(
#             "Project Payments",
#             filters={ "vendor": vendor_id, "document_type": "Procurement Orders", "document_name": po_name, "status": "Paid", "payment_date": [">=", "2025-04-01"] },
#             fields=["name", "payment_date", "creation", "amount", "utr", "tds"]
#         )

#         # --- FIX: Convert payment amounts to paise (integer) ---
#         for payment in payments:
#             payment['amount'] = int(round((frappe.utils.flt(payment.get('amount')) or 0)))
#         po["project_payments"] = payments
        
#         # Parse Invoice JSON
#         invoice_data_dict = po.pop("invoice_data", None)
#         parsed_invoices = []
        
#         if invoice_data_dict and isinstance(invoice_data_dict, dict) and invoice_data_dict.get("data"):
#             for date, invoice_details in invoice_data_dict["data"].items():
#                 if isinstance(invoice_details, dict):
#                     # --- FIX: Convert invoice amount to paise (integer) ---
#                     invoice_details['amount'] = int(round((frappe.utils.flt(invoice_details.get('amount')) or 0)))
#                     invoice_details["date"] = date
#                     parsed_invoices.append(invoice_details)
        
#         po["invoices"] = parsed_invoices

#     return vendor_pos


 