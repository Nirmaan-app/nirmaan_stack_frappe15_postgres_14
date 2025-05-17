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
@redis_cache(shared=True)
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





# --- Procurement Request Status Functions (MODIFIED helper as per new "Approved PR" definition) ---
def _get_pr_derived_status_v2(pr_doc_dict, project_po_list_excluding_cancelled):
    # pr_doc_dict: A dictionary representing a Procurement Request document.
    # project_po_list_excluding_cancelled: List of PO dicts for the project, status not "Cancelled".
    # This list CAN include "Merged" POs.

    if not pr_doc_dict:
        frappe.log_error("_get_pr_derived_status_v2 called with empty pr_doc_dict", "PR Status Calculation")
        return "Unknown"

    pr_name = pr_doc_dict.get("name")
    if not pr_name:
        frappe.log_error("_get_pr_derived_status_v2: PR document dictionary missing 'name'.", "PR Status Calculation")
        return "Unknown"

    # --- Parse PR Items ---
    parsed_pr_items = []
    pr_items_list_data = pr_doc_dict.get("procurement_list")
    if pr_items_list_data:
        try:
            items_data_intermediate = json.loads(pr_items_list_data) if isinstance(pr_items_list_data, str) else pr_items_list_data
            if isinstance(items_data_intermediate, dict) and isinstance(items_data_intermediate.get("list"), list):
                parsed_pr_items = [item for item in items_data_intermediate.get("list") if isinstance(item, dict)]
            elif isinstance(items_data_intermediate, list): # Handle if it's directly a list of items
                 parsed_pr_items = [item for item in items_data_intermediate if isinstance(item, dict)]
        except json.JSONDecodeError:
            frappe.log_error(f"JSONDecodeError parsing procurement_list for PR {pr_name}. Data: {pr_items_list_data}", "PR Status Calculation")
        except Exception:
            frappe.log_error(f"Error parsing procurement_list for PR {pr_name}: {frappe.get_traceback()}", "PR Status Calculation")

    # --- Determine Status based on priority ---

    # Priority 1: "Deleted PR"
    if parsed_pr_items and all(item.get("status") == 'Deleted' for item in parsed_pr_items):
        return "Deleted PR"

    # Priority 2: "New PR"
    workflow_state = pr_doc_dict.get("workflow_state", "")
    if workflow_state in ['Pending', 'Approved', 'Rejected', 'Draft']:
        return 'New PR'

    # --- Logic for "Approved PR" ---
    active_pr_items = [item for item in parsed_pr_items if item.get("status") != 'Deleted']

    if not active_pr_items:
        return 'Open PR' # Cannot be "Approved PR" if no active items to cover

    # Filter POs relevant to *this* PR from the provided list (which already excludes "Cancelled" POs)
    related_pos_for_this_pr = [
        po for po in project_po_list_excluding_cancelled if po.get("procurement_request") == pr_name
    ]

    # For item coverage, POs that are not "Cancelled" are considered.
    # This INCLUDES "Merged" POs as per the new requirement.
    # `related_pos_for_this_pr` already fulfills the "not Cancelled" condition.
    candidate_pos_for_item_coverage = related_pos_for_this_pr

    if not candidate_pos_for_item_coverage:
        # If there are active PR items but no POs (that aren't Cancelled) linked to this PR,
        # then not all active PR items can be covered.
        return 'Open PR'

    all_active_pr_items_found_in_a_po = True
    for pr_item in active_pr_items:
        pr_item_child_name = pr_item.get("name")
        if not pr_item_child_name:
            frappe.log_warning(f"PR {pr_name} has an item in procurement_list without a 'name'. Considering it not covered.", "PR Status Calculation")
            all_active_pr_items_found_in_a_po = False
            break

        item_is_covered_by_a_po = False
        for po_doc_dict in candidate_pos_for_item_coverage: # Iterate through non-cancelled POs (incl. Merged)
            po_order_list_data = po_doc_dict.get("order_list")
            po_items_in_order = []
            if po_order_list_data:
                try:
                    po_list_intermediate = json.loads(po_order_list_data) if isinstance(po_order_list_data, str) else po_order_list_data
                    if isinstance(po_list_intermediate, dict) and isinstance(po_list_intermediate.get("list"), list):
                        po_items_in_order = [item_po for item_po in po_list_intermediate.get("list") if isinstance(item_po, dict)]
                    elif isinstance(po_list_intermediate, list):
                        po_items_in_order = [item_po for item_po in po_list_intermediate if isinstance(item_po, dict)]
                except Exception:
                     frappe.log_error(f"Error parsing order_list for PO {po_doc_dict.get('name')} when checking PR {pr_name}: {frappe.get_traceback()}", "PR Status Item Coverage")

            if any(po_item.get("name") == pr_item_child_name for po_item in po_items_in_order):
                item_is_covered_by_a_po = True
                break

        if not item_is_covered_by_a_po:
            all_active_pr_items_found_in_a_po = False
            break

    if all_active_pr_items_found_in_a_po:
        return 'Approved PO'

    # Priority 4: "Open PR" (fallback for all other cases)
    return 'Open PR'


@frappe.whitelist()
@redis_cache(shared=True)
def get_project_pr_status_counts(project_id: str):
    if not project_id:
        frappe.throw(_("Project ID is required."))

    if not frappe.has_permission("Procurement Requests", "read"):
        frappe.throw(_("Not permitted to read Procurement Requests."), frappe.PermissionError)
    if not frappe.has_permission("Procurement Orders", "read"):
        frappe.throw(_("Not permitted to read Procurement Orders."), frappe.PermissionError)

    project_prs = frappe.get_all(
        "Procurement Requests",
        filters={"project": project_id},
        fields=["name", "workflow_state", "procurement_list"],
        limit_page_length=0
    )

    # Fetch POs excluding "Cancelled" ones. "Merged" POs are included here.
    # _get_pr_derived_status_v2 will use this list and consider "Merged" POs
    # as valid for covering PR items.
    project_pos_excluding_cancelled = frappe.get_all(
        "Procurement Orders",
        filters={
            "project": project_id,
            "status": ["not in", ["Cancelled"]]
        },
        fields=["name", "procurement_request", "order_list", "status"],
        limit_page_length=0
    )

    status_counts = {
        "New PR": 0,
        "Deleted PR": 0,
        "Approved PO": 0,
        "Open PR": 0,
        "Unknown": 0
    }

    pr_statuses_dict = {}

    for pr_data in project_prs:
        pr_doc_dict = frappe._dict(pr_data)
        derived_status = _get_pr_derived_status_v2(pr_doc_dict, project_pos_excluding_cancelled)
        pr_statuses_dict[pr_doc_dict.get("name", f"UnnamedPR_{len(pr_statuses_dict)}")] = derived_status

        if derived_status in status_counts:
            status_counts[derived_status] += 1
        else:
            status_counts["Unknown"] += 1
            frappe.log_error(f"Unexpected derived status '{derived_status}' for PR {pr_doc_dict.get('name')} using _get_pr_derived_status_v2", "PR Status Count")

    if status_counts.get("Unknown") == 0:
        status_counts.pop("Unknown", None)

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
@redis_cache(shared=True)
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