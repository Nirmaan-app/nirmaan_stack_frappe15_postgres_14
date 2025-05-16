import frappe
from frappe import _
from frappe.utils import flt # Use flt for safe float conversion
import json
from frappe.utils.caching import redis_cache


def _calculate_sr_totals(sr_doc):
    total_excl_gst = 0
    if sr_doc.get("service_order_list"):
        try:
            service_list = json.loads(sr_doc.service_order_list) if isinstance(sr_doc.service_order_list, str) else sr_doc.service_order_list
            if isinstance(service_list, dict) and isinstance(service_list.get("list"), list):
                for item in service_list.get("list"):
                    total_excl_gst += flt(item.get("rate")) * flt(item.get("quantity"))
        except Exception as e:
            print(f"Error parsing service_order_list for SR {sr_doc.name}: {e}")
            frappe.log_error(f"Error parsing service_order_list for SR {sr_doc.name}: {frappe.get_traceback()}", "SR Aggregate Calculation")

    if sr_doc.get("gst") == "true":
        return {"total_incl_gst":  total_excl_gst * 1.18, "total_excl_gst": total_excl_gst}
    return {"total_incl_gst":  total_excl_gst, "total_excl_gst": total_excl_gst}

@frappe.whitelist()
@redis_cache(ttl=5*60)
def get_project_sr_summary_aggregates(project_id: str):
    """
    Calculates and returns aggregated summary for Service Requests of a given project.
    The results of this function are cached for 5 minutes.

    Args:
        project_id (str): The ID of the project.

    Returns:
        dict: Aggregated values:
              - total_sr_value_inc_gst
              - total_sr_value_excl_gst
              - total_amount_paid_for_srs
    """
    if not project_id:
        frappe.throw(_("Project ID is required."))

    if not frappe.has_permission("Service Requests", "read"): # Basic permission check
        frappe.throw(_("Not permitted to read Service Requests."), frappe.PermissionError)

    # Base filters for SRs relevant to this summary
    sr_filters = [
        ["project", "=", project_id],
        ["status", "=", "Approved"] # Only considering "Approved" SRs for these totals
    ]

    # Fetch necessary fields from Service Requests for calculations
    service_requests = frappe.get_all(
        "Service Requests",
        filters=sr_filters,
        fields=["name", "service_order_list", "gst"] # Fields needed for total calculation
        # limit_page_length = 0 # Get all matching for accurate sum
    )

    total_sr_value_inc_gst = total_sr_value_excl_gst = 0.0
    for sr in service_requests:
        # frappe.get_all returns list of dicts, ensure it's a FrappeDict for consistent .get behavior
        totals = _calculate_sr_totals(frappe._dict(sr))
        total_sr_value_inc_gst += totals.get("total_incl_gst", 0.0)
        total_sr_value_excl_gst += totals.get("total_excl_gst", 0.0)

    # Fetch "Paid" Project Payments linked to these Service Requests
    # This requires knowing which payments are for SRs and for this project
    # Option 1: If SR name is directly in ProjectPayments.document_name
    sr_names = [sr.get("name") for sr in service_requests]
    total_amount_paid_for_srs = 0
    if sr_names:
        sum_field = "sum(CAST(amount as numeric)) as total_paid"
        paid_payments_for_srs = frappe.get_all(
            "Project Payments",
            filters=[
                ["status", "=", "Paid"],
                ["document_type", "=", "Service Requests"],
                ["document_name", "in", sr_names]
            ],
            fields=[sum_field]
        )
        if paid_payments_for_srs and paid_payments_for_srs[0] and paid_payments_for_srs[0].total_paid is not None:
            total_amount_paid_for_srs = flt(paid_payments_for_srs[0].total_paid)
        else:
            print(f"DEBUG: No 'Paid' payments found for SRs: {sr_names} or sum was null.")

    print(f"DEBUG: Returning SR Aggregates: GST Total={total_sr_value_inc_gst}, Paid Total={total_amount_paid_for_srs}")

    result = {
        "total_sr_value_inc_gst": round(total_sr_value_inc_gst, 2),
        "total_sr_value_excl_gst": round(total_sr_value_excl_gst, 2),
        "total_amount_paid_for_srs": round(total_amount_paid_for_srs, 2)
    }

    return result





# Need ProcurementRequest, ProcurementOrder, ApprovedQuotations types if not already imported for other fns
# For this function, we primarily need PR and PO.
# from ... (your types if needed for type hinting, but frappe.get_all returns dicts)

# Helper function (can be shared if already defined for ProjectPRSummaryTable client-side)
# This needs access to PO data for the given project to determine derived status
def _get_pr_derived_status(pr_doc_dict, project_po_list):
    # pr_doc_dict is a dict from frappe.get_all("Procurement Requests")
    # project_po_list is a list of PO dicts for the same project
    if not pr_doc_dict: return "Unknown"

    workflow_state = pr_doc_dict.get("workflow_state", "")
    if workflow_state in ['Pending', 'Approved', 'Rejected', 'Draft']:
        return 'New PR'

    pr_items_list_data = pr_doc_dict.get("procurement_list")
    pr_items = []
    if pr_items_list_data:
        try:
            pr_items_data = json.loads(pr_items_list_data) if isinstance(pr_items_list_data, str) else pr_items_list_data
            if isinstance(pr_items_data, dict) and isinstance(pr_items_data.get("list"), list):
                pr_items = pr_items_data.get("list")
        except Exception:
            pass # Could log error

    if not pr_items: return 'Open PR' # Or handle as error

    # Filter POs specific to this PR
    related_pos = [po for po in project_po_list if po.get("procurement_request") == pr_doc_dict.get("name")]

    all_items_processed = True
    for pr_item in pr_items:
        if not isinstance(pr_item, dict): continue
        if pr_item.get("status") == 'Deleted':
            continue
        
        # Check if this PR item is present in any of the related PO's order_list
        item_in_po = False
        for po_doc_dict in related_pos:
            po_order_list_data = po_doc_dict.get("order_list")
            po_items = []
            if po_order_list_data:
                try:
                    po_list_parsed = json.loads(po_order_list_data) if isinstance(po_order_list_data, str) else po_order_list_data
                    if isinstance(po_list_parsed, dict) and isinstance(po_list_parsed.get("list"), list):
                        po_items = po_list_parsed.get("list")
                except Exception:
                    pass
            
            if any(po_item.get("name") == pr_item.get("name") for po_item in po_items if isinstance(po_item, dict)):
                item_in_po = True
                break
        
        if not item_in_po:
            all_items_processed = False
            break
            
    return 'Approved PO' if all_items_processed else 'Open PR'


@frappe.whitelist()
@redis_cache(ttl=5*60) # Cache for 5 minutes
def get_project_pr_status_counts(project_id: str):
    if not project_id:
        frappe.throw(_("Project ID is required."))

    if not frappe.has_permission("Procurement Requests", "read"):
        frappe.throw(_("Not permitted to read Procurement Requests."), frappe.PermissionError)
    if not frappe.has_permission("Procurement Orders", "read"): # Also need to read POs
        frappe.throw(_("Not permitted to read Procurement Orders."), frappe.PermissionError)

    print(f"DEBUG (get_project_pr_status_counts): Cache MISS for project_id: {project_id}. Calculating fresh.")

    # Fetch all PRs for the project
    # Only fetch fields needed for statusRender logic
    project_prs = frappe.get_all(
        "Procurement Requests",
        filters={"project": project_id},
        fields=["name", "workflow_state", "procurement_list"] # procurement_list for item details
        # limit_page_length=0 # Get all for accurate count
    )

    # Fetch all POs for the project to assist in PR status calculation
    project_pos = frappe.get_all(
        "Procurement Orders",
        filters={"project": project_id, "status": ["not in", ["Cancelled", "Merged"]]}, # Relevant POs
        fields=["name", "procurement_request", "order_list"] # procurement_request to link back to PR
        # limit_page_length=0
    )
    
    status_counts = {"New PR": 0, "Open PR": 0, "Approved PO": 0}

    # Filter out PRs where all items are 'Deleted' before counting
    # active_project_prs = []
    # for pr_data in project_prs:
        # pr_doc_dict = frappe._dict(pr_data)
        # pr_items_list_data = pr_doc_dict.get("procurement_list")
        # has_active_items = True
        # if pr_items_list_data:
        #     try:
        #         pr_items_data = json.loads(pr_items_list_data) if isinstance(pr_items_list_data, str) else pr_items_list_data
        #         if isinstance(pr_items_data, dict) and isinstance(pr_items_data.get("list"), list):
        #             if any(item.get("status") != "Deleted" for item in pr_items_data.get("list") if isinstance(item,dict)):
        #                 has_active_items = True
        #     except Exception: pass
        
        # if has_active_items:
            # active_project_prs.append(pr_doc_dict)

    active_project_prs = [frappe._dict(pr) for pr in project_prs]
    pr_statuses_dict = {}
    for pr_doc_dict in active_project_prs:
        derived_status = _get_pr_derived_status(pr_doc_dict, project_pos)
        pr_statuses_dict[pr_doc_dict.get("name", "N/A")] = derived_status
        if derived_status in status_counts:
            status_counts[derived_status] += 1
        else: # Should not happen if derived_status is one of the three
            status_counts[derived_status] = 1 
            print(f"WARNING: Unexpected derived status '{derived_status}' for PR {pr_doc_dict.name}")


    print(f"DEBUG: Returning PR Status Counts: {status_counts} for project {project_id}")
    result = {
        "status_counts": status_counts,
        "pr_statuses": pr_statuses_dict
    }
    return result





# Helper function to calculate totals for a single PO document
def _calculate_po_totals_for_doc(po_doc_dict):
    """
    Calculates total including and excluding GST for a single PO document.
    po_doc_dict should be a frappe._dict or a standard dict.
    """
    total_excl_gst_items = 0
    total_gst_on_items = 0

    if po_doc_dict.get("order_list"):
        try:
            order_list_data = po_doc_dict.order_list
            if isinstance(order_list_data, str):
                order_list_data = json.loads(order_list_data)
            
            order_items = []
            if isinstance(order_list_data, dict) and isinstance(order_list_data.get("list"), list):
                order_items = order_list_data.get("list")
            elif isinstance(order_list_data, list): # Handle if it's directly a list of items
                order_items = order_list_data

            for item in order_items:
                if isinstance(item, dict):
                    price = flt(item.get("quote")) # Assuming 'quote' is the final price per unit
                    quantity = flt(item.get("quantity"))
                    if quantity == 0 and price > 0: quantity = 1
                    
                    item_total = price * quantity
                    total_excl_gst_items += item_total
                    
                    tax_percent = flt(item.get("tax"))
                    total_gst_on_items += (item_total * tax_percent) / 100
                else:
                    print(f"WARNING (_calculate_po_totals_for_doc): Unexpected item format for PO {po_doc_dict.name}: {item}")
        except Exception as e:
            print(f"Error parsing order_list for PO {po_doc_dict.name}: {e}")
            frappe.log_error(f"Error parsing order_list for PO {po_doc_dict.name}: {frappe.get_traceback()}", "PO Aggregate Calculation")

    loading_charges = flt(po_doc_dict.get("loading_charges"))
    freight_charges = flt(po_doc_dict.get("freight_charges"))

    # Assuming GST on loading/freight is 18% if applicable, adjust if different
    gst_on_loading = loading_charges * 0.18
    gst_on_freight = freight_charges * 0.18

    final_total_excl_gst = total_excl_gst_items + loading_charges + freight_charges
    final_total_gst = total_gst_on_items + gst_on_loading + gst_on_freight
    final_total_incl_gst = final_total_excl_gst + final_total_gst
    
    return {
        "total_incl_gst": final_total_incl_gst,
        "total_excl_gst": final_total_excl_gst,
        "total_gst_on_items": total_gst_on_items,
        "final_total_gst": final_total_gst,
    }


@frappe.whitelist()
@redis_cache(ttl=5*60) # Cache for 5 minutes
def get_project_po_summary_aggregates(project_id: str):
    if not project_id:
        frappe.throw(_("Project ID is required."))

    if not frappe.has_permission("Procurement Orders", "read"):
        frappe.throw(_("Not permitted to read Procurement Orders."), frappe.PermissionError)
    if not frappe.has_permission("Project Payments", "read"):
        frappe.throw(_("Not permitted to read Project Payments."), frappe.PermissionError)

    print(f"DEBUG (get_project_po_summary_aggregates): Cache MISS for project_id: {project_id}. Calculating fresh.")

    # Relevant POs for this project (excluding Cancelled/Merged)
    po_filters = [
        ["project", "=", project_id],
        ["status", "not in", ["Cancelled", "Merged", "PO Amendment"]]
    ]

    purchase_orders_data = frappe.get_all(
        "Procurement Orders",
        filters=po_filters,
        fields=["name", "order_list", "loading_charges", "freight_charges"] # Fields needed for total calculation
    )

    total_po_value_inc_gst = 0.0
    total_po_value_excl_gst = 0.0
    total_gst_on_items = 0.0
    final_total_gst = 0.0
    po_amounts_dict = {}
    for po_data_item in purchase_orders_data:
        po_as_dict = frappe._dict(po_data_item)
        totals = _calculate_po_totals_for_doc(po_as_dict)
        po_amounts_dict[po_data_item.get("name")] = {
            "total_incl_gst": totals.get("total_incl_gst", 0.0), 
            "total_excl_gst": totals.get("total_excl_gst", 0.0)
            }
        
        total_po_value_inc_gst += totals.get("total_incl_gst", 0.0)
        total_po_value_excl_gst += totals.get("total_excl_gst", 0.0)
        total_gst_on_items += totals.get("total_gst_on_items", 0.0)
        final_total_gst += totals.get("final_total_gst", 0.0)

    po_names = po_amounts_dict.keys()
    total_amount_paid_for_pos = 0.0
    if po_names:
        # sum_field = "sum(CAST(COALESCE(amount, 0) AS numeric)) as total_paid"
        sum_field = "sum(CAST(amount as numeric)) as total_paid"

        paid_payments_for_pos = frappe.get_all(
            "Project Payments",
            filters=[
                ["status", "=", "Paid"],
                ["document_type", "=", "Procurement Orders"],
                ["document_name", "in", po_names]
            ],
            fields=[sum_field]
        )
        if paid_payments_for_pos and paid_payments_for_pos[0] and paid_payments_for_pos[0].total_paid is not None:
            total_amount_paid_for_pos = flt(paid_payments_for_pos[0].total_paid)
        else:
            print(f"DEBUG: No 'Paid' payments found for POs: {po_names} or sum was null/0.")
            
    result = {
        "total_po_value_inc_gst": round(total_po_value_inc_gst, 2),
        "total_po_value_excl_gst": round(total_po_value_excl_gst, 2),
        "total_amount_paid_for_pos": round(total_amount_paid_for_pos, 2),
        "total_gst_on_items": round(total_gst_on_items, 2),
        "final_total_gst": round(final_total_gst, 2),
        "po_amounts_dict": po_amounts_dict
    }
    print(f"DEBUG: Returning PO Aggregates (freshly calculated): {result}")
    return result