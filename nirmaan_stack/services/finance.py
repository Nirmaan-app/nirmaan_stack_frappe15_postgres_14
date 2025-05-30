import frappe, json
import frappe.model
import frappe.model.document
from frappe.utils import flt
from decimal import Decimal
from frappe import _

# your_app_name/api/payment_requests.py (or where this function resides)
import frappe
from frappe.utils import flt # flt is fine for this, no need for Decimal unless very high precision needed
import json

def get_source_document_financials(source_doc: frappe.model.document.Document) -> dict:
    """
    Calculates relevant financial totals from a PO or SR document.
    """
    payable_total = 0.0
    total_value_without_gst = 0.0 # This will be (sum of item base amounts) + additional charges before their GST

    if source_doc.doctype == "Procurement Orders":
        items_base_total = 0.0  # Sum of (qty * rate) for all items
        items_gst_total = 0.0   # Sum of GST calculated for all items

        order_list_data = source_doc.get("order_list")
        if isinstance(order_list_data, str):
            try:
                order_list_data = json.loads(order_list_data) # Use json.loads for plain Python
            except json.JSONDecodeError:
                frappe.log_error(f"Invalid JSON in order_list for PO {source_doc.name}", frappe.get_traceback())
                order_list_data = {} # Default to empty if parse fails

        if order_list_data and isinstance(order_list_data.get("list"), list):
            for item in order_list_data.get("list"):
                if not isinstance(item, dict): continue # Skip malformed items

                qty = flt(item.get("quantity"))
                rate = flt(item.get("quote")) # Assuming 'quote' is the rate field in PO items
                tax_percent = flt(item.get("tax")) # e.g., 18 for 18%

                item_base_amount = qty * rate
                item_gst_amount = item_base_amount * (tax_percent / 100.0)

                items_base_total += item_base_amount
                items_gst_total += item_gst_amount
        
        loading_charges = flt(source_doc.get("loading_charges"))
        freight_charges = flt(source_doc.get("freight_charges"))

        # Assuming GST on additional charges is fixed at 18% as per your frontend logic
        gst_on_loading_charges = loading_charges * 0.18
        gst_on_freight_charges = freight_charges * 0.18
        
        total_additional_charges_gst = gst_on_loading_charges + gst_on_freight_charges
        total_additional_charges_base = loading_charges + freight_charges

        total_value_without_gst = items_base_total + total_additional_charges_base
        payable_total = items_base_total + items_gst_total + total_additional_charges_base + total_additional_charges_gst

    elif source_doc.doctype == "Service Requests":
        service_items_base_total = 0.0
        
        service_list_data = source_doc.get("service_order_list")
        if isinstance(service_list_data, str):
            try:
                service_list_data = json.loads(service_list_data)
            except json.JSONDecodeError:
                frappe.log_error(f"Invalid JSON in service_order_list for SR {source_doc.name}", frappe.get_traceback())
                service_list_data = {}

        if service_list_data and isinstance(service_list_data.get("list"), list):
            for item in service_list_data.get("list"):
                if not isinstance(item, dict): continue

                qty = flt(item.get("quantity"))
                rate = flt(item.get("rate"))
                service_items_base_total += qty * rate
        
        total_value_without_gst = service_items_base_total # Assuming services don't have item-wise tax in your model
        
        # SR GST logic: If doc.gst is a percentage string like "18"
        sr_gst_enabled =  source_doc.get("gst", "false") == "true" # e.g., "true" or "false"
        if sr_gst_enabled:
            gst_amount_on_services = total_value_without_gst * (18.0 / 100.0)
            payable_total = total_value_without_gst + gst_amount_on_services
        else: # No GST or GST is "0"
            payable_total = total_value_without_gst

    else:
        frappe.throw(_("Unsupported document type for financial calculation: {0}").format(source_doc.doctype))

    return {
        "payable_total": round(payable_total, 2),
        "total_without_gst": round(total_value_without_gst, 2),
    }

def get_total_paid(src):
    """
    Calculates the total 'Paid' amount for a given source document.
    """
    sum_field = "sum(CAST(amount as numeric)) as total_paid"

    paid_payments = frappe.get_all(
        "Project Payments",
        filters=[
            ["status", "=", "Paid"],
            ["document_type", "=", src.doctype],
            ["document_name", "=", src.name]
        ],
        fields=[sum_field]
    )
    if paid_payments and paid_payments[0] and paid_payments[0].total_paid is not None:
        return flt(paid_payments[0].total_paid)
    return 0.0
    # return frappe.db.get_value(
    #     "Project Payments",
    #     {"document_type":src.doctype, "document_name":src.name,
    #      "status":["in",("Paid")]},
    #      sum_field
    # ) or 0

    # return frappe.db.sql("""
    #     SELECT sum(CAST(amount as numeric)) as total_paid
    #     FROM `tabProject Payments`
    #     WHERE document_type = %s
    #     AND document_name = %s
    #     AND status IN ('Paid')            
    # """, (src.doctype, src.name), as_dict=1)[0].total_paid or 0
    # result = frappe.db.sql("""
    #     SELECT SUM(CAST(amount as numeric))
    #     FROM `tabProject Payments`
    #     WHERE document_type = %(document_type)s
    #       AND document_name = %(document_name)s
    #       AND status IN ('Paid')
    # """, {
    #     "document_type": src.doctype,
    #     "document_name": src.name
    # }, as_list=True)

    # if result and result[0] and result[0][0] is not None:
    #     return flt(result[0][0])
    # return 0.0

def get_total_pending(src):
    """
    Calculates the total 'Requested' or 'Approved' (but not yet Paid/Cancelled)
    amount for a given source document.
    """
    sum_field = "sum(CAST(amount as numeric)) as total_pending"

    pending_payments = frappe.get_all(
        "Project Payments",
        filters=[
            ["status", "in", ("Requested", "Approved", "Rejected")],
            ["document_type", "=", src.doctype],
            ["document_name", "=", src.name]
        ],
        fields=[sum_field]
    )
    if pending_payments and pending_payments[0] and pending_payments[0].total_pending is not None:
        return flt(pending_payments[0].total_pending)
    return 0.0
    # return frappe.db.get_value(
    #     "Project Payments",
    #     {"document_type":src.doctype, "document_name":src.name,
    #      "status": ["in", ("Requested", "Approved")]},
    #      sum_field
    # ) or 0

    # return frappe.db.sql("""
    #     SELECT sum(CAST(amount as numeric)) as total_pending
    #     FROM `tabProject Payments`
    #     WHERE document_type = %s
    #     AND document_name = %s
    #     AND status IN ('Requested', 'Approved')            
    # """, (src.doctype, src.name), as_dict=1)[0].total_pending or 0
    # result = frappe.db.sql("""
    #     SELECT SUM(CAST(amount as numeric))
    #     FROM `tabProject Payments`
    #     WHERE document_type = %(document_type)s
    #       AND document_name = %(document_name)s
    #       AND status IN ('Requested', 'Approved')
    # """, {
    #     "document_type": src.doctype,
    #     "document_name": src.name
    # }, as_list=True)

    # if result and result[0] and result[0][0] is not None:
    #     return flt(result[0][0])
    # return 0.0