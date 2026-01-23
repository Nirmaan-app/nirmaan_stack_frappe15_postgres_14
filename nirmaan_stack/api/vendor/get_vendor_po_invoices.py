# nirmaan_stack/nirmaan_stack/api/vendor/get_vendor_po_invoices.py

import frappe
from frappe.utils import flt, get_datetime
import json

@frappe.whitelist()
def get_po_ledger_data(vendor_id):
    """
    Fetches all POs, Service Requests, their Invoices (from Vendor Invoices doctype),
    and related Project Payments. It calculates the SR total by summing quantity * rate
    from the nested 'service_order_list' JSON field.

    Updated in v3.0 to use Vendor Invoices doctype instead of invoice_data JSON.
    """
    if not vendor_id:
        frappe.throw("Vendor ID is a required parameter.")

    print(f"DEBUG LEDGER: ----- STARTING VENDOR LEDGER (PO & SR) FOR {vendor_id} -----")
    all_transactions = []
    log_counter = 1
    start_date = "2025-04-01"
    start_datetime = get_datetime(start_date)

    # --- Step 1: Fetch Purchase Orders ---
    vendor_pos = frappe.get_all(
        "Procurement Orders",
        filters={"vendor": vendor_id, "status": ("not in", [ "Merged", "Inactive", "PO Amendment"])},
        fields=["name", "creation", "total_amount", "project_name"]
    )
    print(f"DEBUG LEDGER: Found {len(vendor_pos)} total historical Purchase Orders.")

    doc_names = []
    doc_project_map = {}

    # Process POs
    for po in vendor_pos:
        doc_name = po.get("name")
        project_name_from_po = po.get("project_name", "N/A")
        doc_names.append(doc_name)
        doc_project_map[doc_name] = project_name_from_po
        all_transactions.append({
            "type": "PO Created",
            "date": get_datetime(po.get("creation")),
            "details": f"PO: {doc_name}",
            "amount": flt(po.get('total_amount', 0)),
            "payment": 0,
            "project": project_name_from_po
        })
        log_counter += 1

    # --- Step 2: Fetch Service Requests & Calculate Total from Child Table ---
    vendor_srs = frappe.get_all(
        "Service Requests",
        filters={"vendor": vendor_id, "status": ["!=", "Cancelled"]},
        fields=["name", "creation", "project", "service_order_list"]
    )
    print(f"DEBUG LEDGER: Found {len(vendor_srs)} total historical Service Requests.")

    project_ids_from_srs = {sr.get("project") for sr in vendor_srs if sr.get("project")}
    project_name_map = {}
    if project_ids_from_srs:
        project_docs = frappe.get_all("Projects", filters={"name": ["in", list(project_ids_from_srs)]}, fields=["name", "project_name"])
        project_name_map = {p.name: p.project_name for p in project_docs}

    # Process SRs
    for sr in vendor_srs:
        doc_name = sr.get("name")
        doc_names.append(doc_name)
        project_id = sr.get("project")
        resolved_project_name = project_name_map.get(project_id, project_id or "N/A")
        doc_project_map[doc_name] = resolved_project_name

        # Calculate SR total from service_order_list
        sr_total_amount = 0.0
        service_order_json = sr.get("service_order_list")

        if isinstance(service_order_json, dict) and isinstance(service_order_json.get("list"), list):
            service_order_list_data = service_order_json.get("list")
            print(f"DEBUG LEDGER: Calculating total from {len(service_order_list_data)} items for SR {doc_name}")
            for item in service_order_list_data:
                quantity = flt(item.get('quantity', 0))
                rate = flt(item.get('rate', 0))
                sr_total_amount += (quantity * rate)

        all_transactions.append({
            "type": "SR Created",
            "date": get_datetime(sr.get("creation")),
            "details": f"SR: {doc_name}",
            "amount": sr_total_amount,
            "payment": 0,
            "project": resolved_project_name
        })
        log_counter += 1

    # --- Step 3: Fetch Invoices from Vendor Invoices doctype ---
    if doc_names:
        vendor_invoices = frappe.get_all(
            "Vendor Invoices",
            filters={
                "vendor": vendor_id,
                "status": "Approved",
                "document_name": ["in", doc_names]
            },
            fields=["name", "document_type", "document_name", "invoice_no", "invoice_date", "invoice_amount"]
        )
        print(f"DEBUG LEDGER: Found {len(vendor_invoices)} approved Vendor Invoices.")

        for invoice in vendor_invoices:
            invoice_amount = flt(invoice.get("invoice_amount", 0))
            doc_name = invoice.get("document_name")
            doc_type_abbr = "PO" if invoice.get("document_type") == "Procurement Orders" else "SR"
            project_name_for_invoice = doc_project_map.get(doc_name, "N/A")

            # Determine if credit note or invoice
            transaction_type = "Credit Note Recorded" if invoice_amount < 0 else "Invoice Recorded"

            all_transactions.append({
                "type": transaction_type,
                "date": get_datetime(invoice.get("invoice_date")),
                "details": f"Invoice No: {invoice.get('invoice_no')}\nFor {doc_type_abbr}: {doc_name}",
                "amount": invoice_amount,
                "payment": 0,
                "project": project_name_for_invoice
            })
            log_counter += 1

    # --- Step 4: Fetch Payments ---
    if doc_names:
        payments = frappe.get_all(
            "Project Payments",
            filters={
                "vendor": vendor_id,
                "status": "Paid",
                "document_type": ["in", ["Procurement Orders", "Service Requests"]],
                "document_name": ["in", doc_names]
            },
            fields=["name", "payment_date", "creation", "amount", "utr", "document_name", "document_type"]
        )
        print(f"DEBUG LEDGER: Found {len(payments)} total historical Project Payments.")

        for payment in payments:
            linked_doc_name = payment.get("document_name")
            project_name_for_payment = doc_project_map.get(linked_doc_name, "N/A")
            doc_type_abbr = "PO" if payment.get("document_type") == "Procurement Orders" else "SR"
            all_transactions.append({
                "type": "Refund Received" if flt(payment.get("amount", 0)) < 0 else "Payment Made",
                "date": get_datetime(payment.get("payment_date") or payment.get("creation")),
                "details": f"UTR: {payment.get('utr', 'N/A')}\nFor {doc_type_abbr}: {linked_doc_name}",
                "amount": 0,
                "payment": flt(payment.get("amount", 0)),
                "project": project_name_for_payment
            })
            log_counter += 1

    # --- Step 5: Final Filtering, Sorting, and Formatting ---
    print(f"DEBUG LEDGER: Collected a total of {len(all_transactions)} transactions before date filtering.")
    filtered_transactions = [t for t in all_transactions if t["date"] >= start_datetime]
    print(f"DEBUG LEDGER: {len(filtered_transactions)} transactions remaining after filtering for dates >= {start_date}.")
    filtered_transactions.sort(key=lambda x: x["date"])
    for t in filtered_transactions:
        t["date"] = t["date"].strftime('%Y-%m-%d %H:%M:%S')
    print(f"DEBUG LEDGER: ----- RETURNING {len(filtered_transactions)} TRANSACTIONS FOR {vendor_id} -----")
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
