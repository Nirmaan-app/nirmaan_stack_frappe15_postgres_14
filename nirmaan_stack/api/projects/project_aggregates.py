import frappe
from frappe import _
from frappe.utils import flt, create_batch # Use flt for safe float conversion
import json
from frappe.utils.caching import redis_cache


def _calculate_sr_totals(sr_doc):
    """
    Returns {total_incl_gst, total_excl_gst} for one SR.
    `total_amount` on the SR doc is computed by `validate` on every save and
    already includes GST when gst === "true". No item iteration needed.
    """
    total_incl_gst = flt(sr_doc.get("total_amount"))
    total_excl_gst = total_incl_gst / 1.18 if sr_doc.get("gst") == "true" else total_incl_gst
    return {"total_incl_gst": total_incl_gst, "total_excl_gst": total_excl_gst}

#@redis_cache(shared=True)
@frappe.whitelist()
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

    # `total_amount` is denormalized on the parent — one query is enough.
    service_requests = frappe.get_all(
        "Service Requests",
        filters=sr_filters,
        fields=["name", "gst", "total_amount"]
    )

    total_sr_value_inc_gst = total_sr_value_excl_gst = 0.0
    for sr in service_requests:
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
        # Chunk the `document_name IN (...)` list so the generated query never exceeds sqlparse's
        # 10,000-token cap (a project can have thousands of approved SRs). SUM is associative, so adding
        # the per-chunk partial sums is byte-identical to one big IN query.
        for chunk in create_batch(sr_names, 500):
            paid_payments_for_srs = frappe.get_all(
                "Project Payments",
                filters=[
                    ["status", "=", "Paid"],
                    ["document_type", "=", "Service Requests"],
                    ["document_name", "in", list(chunk)]
                ],
                fields=[sum_field]
            )
            if paid_payments_for_srs and paid_payments_for_srs[0] and paid_payments_for_srs[0].total_paid is not None:
                total_amount_paid_for_srs += flt(paid_payments_for_srs[0].total_paid)

    print(f"DEBUG: Returning SR Aggregates: GST Total={total_sr_value_inc_gst}, Paid Total={total_amount_paid_for_srs}")

    result = {
        "total_sr_value_inc_gst": round(total_sr_value_inc_gst, 2),
        "total_sr_value_excl_gst": round(total_sr_value_excl_gst, 2),
        "total_amount_paid_for_srs": round(total_amount_paid_for_srs, 2)
    }

    return result





# --- Procurement Request Status Functions (MODIFIED helper as per new "Approved PR" definition) ---
# def _get_pr_derived_status_v2(pr_doc_dict, project_po_list_excluding_cancelled):
#     # pr_doc_dict: A dictionary representing a Procurement Request document.
#     # project_po_list_excluding_cancelled: List of PO dicts for the project, status not "Cancelled".
#     # This list CAN include "Merged" POs.

#     if not pr_doc_dict:
#         frappe.log_error("_get_pr_derived_status_v2 called with empty pr_doc_dict", "PR Status Calculation")
#         return "Unknown"

#     pr_name = pr_doc_dict.get("name")
#     if not pr_name:
#         frappe.log_error("_get_pr_derived_status_v2: PR document dictionary missing 'name'.", "PR Status Calculation")
#         return "Unknown"

#     # --- Parse PR Items ---
#     parsed_pr_items = []
#     pr_items_list_data = pr_doc_dict.get("order_list")
#     if pr_items_list_data:
#         try:
#             items_data_intermediate = json.loads(pr_items_list_data) if isinstance(pr_items_list_data, str) else pr_items_list_data
#             if isinstance(items_data_intermediate, list):
#                 parsed_pr_items = [item for item in items_data_intermediate if isinstance(item, dict)]
#             elif isinstance(items_data_intermediate, list): # Handle if it's directly a list of items
#                  parsed_pr_items = [item for item in items_data_intermediate if isinstance(item, dict)]
#         except json.JSONDecodeError:
#             frappe.log_error(f"JSONDecodeError parsing procurement_list for PR {pr_name}. Data: {pr_items_list_data}", "PR Status Calculation")
#         except Exception:
#             frappe.log_error(f"Error parsing procurement_list for PR {pr_name}: {frappe.get_traceback()}", "PR Status Calculation")

#     # --- Determine Status based on priority ---

#     # Priority 1: "Deleted PR"
#     if parsed_pr_items and all(item.get("status") == 'Deleted' for item in parsed_pr_items):
#         return "Deleted PR"

#     # Priority 2: "New PR"
#     workflow_state = pr_doc_dict.get("workflow_state", "")
#     if workflow_state in ['Pending', 'Approved', 'Rejected', 'Draft']:
#         return 'New PR'

#     # --- Logic for "Approved PR" ---
#     active_pr_items = [item for item in parsed_pr_items if item.get("status") != 'Deleted']

#     if not active_pr_items:
#         return 'Open PR' # Cannot be "Approved PR" if no active items to cover

#     # Filter POs relevant to *this* PR from the provided list (which already excludes "Cancelled" POs)
#     related_pos_for_this_pr = [
#         po for po in project_po_list_excluding_cancelled if po.get("procurement_request") == pr_name
#     ]

#     # For item coverage, POs that are not "Cancelled" are considered.
#     # This INCLUDES "Merged" POs as per the new requirement.
#     # `related_pos_for_this_pr` already fulfills the "not Cancelled" condition.
#     candidate_pos_for_item_coverage = related_pos_for_this_pr

#     if not candidate_pos_for_item_coverage:
#         # If there are active PR items but no POs (that aren't Cancelled) linked to this PR,
#         # then not all active PR items can be covered.
#         return 'Open PR'

#     all_active_pr_items_found_in_a_po = True
#     for pr_item in active_pr_items:
#         pr_item_child_name = pr_item.get("name")
#         if not pr_item_child_name:
#             frappe.log_warning(f"PR {pr_name} has an item in procurement_list without a 'name'. Considering it not covered.", "PR Status Calculation")
#             all_active_pr_items_found_in_a_po = False
#             break

#         item_is_covered_by_a_po = False
#         for po_doc_dict in candidate_pos_for_item_coverage: # Iterate through non-cancelled POs (incl. Merged)
#             po_order_list_data = po_doc_dict.get("items")
#             po_items_in_order = []
#             if po_order_list_data:
#                 try:
#                     po_list_intermediate = json.loads(po_order_list_data) if isinstance(po_order_list_data, str) else po_order_list_data
#                     if isinstance(po_list_intermediate, list):
#                         po_items_in_order = [item_po for item_po in po_list_intermediate if isinstance(item_po, dict)]
#                     elif isinstance(po_list_intermediate, list):
#                         po_items_in_order = [item_po for item_po in po_list_intermediate if isinstance(item_po, dict)]
#                 except Exception:
#                      frappe.log_error(f"Error parsing order_list for PO {po_doc_dict.get('name')} when checking PR {pr_name}: {frappe.get_traceback()}", "PR Status Item Coverage")

#             if any(po_item.get("name") == pr_item_child_name for po_item in po_items_in_order):
#                 item_is_covered_by_a_po = True
#                 break

#         if not item_is_covered_by_a_po:
#             all_active_pr_items_found_in_a_po = False
#             break

#     if all_active_pr_items_found_in_a_po:
#         return 'Approved PO'

#     # Priority 4: "Open PR" (fallback for all other cases)
#     return 'Open PR'


# @frappe.whitelist()
# @redis_cache(shared=True)

# def get_project_pr_status_counts(project_id: str):
#     if not project_id:
#         frappe.throw(_("Project ID is required."))

#     if not frappe.has_permission("Procurement Requests", "read"):
#         frappe.throw(_("Not permitted to read Procurement Requests."), frappe.PermissionError)
#     if not frappe.has_permission("Procurement Orders", "read"):
#         frappe.throw(_("Not permitted to read Procurement Orders."), frappe.PermissionError)

#     project_prs = frappe.get_all(
#         "Procurement Requests",
#         filters={"project": project_id},
#         fields=["name", "workflow_state", "order_list"],
#         limit_page_length=0
#     )

#     # Fetch POs excluding "Cancelled" ones. "Merged" POs are included here.
#     # _get_pr_derived_status_v2 will use this list and consider "Merged" POs
#     # as valid for covering PR items.
#     project_pos_excluding_cancelled = frappe.get_all(
#         "Procurement Orders",
#         filters={
#             "project": project_id,
#             "status": ["not in", ["Cancelled"]]
#         },
#         fields=["name", "procurement_request", "items", "status"],
#         limit_page_length=0
#     )

#     status_counts = {
#         "New PR": 0,
#         "Deleted PR": 0,
#         "Approved PO": 0,
#         "Open PR": 0,
#         "Unknown": 0
#     }

#     pr_statuses_dict = {}

#     for pr_data in project_prs:
#         pr_doc_dict = frappe._dict(pr_data)
#         derived_status = _get_pr_derived_status_v2(pr_doc_dict, project_pos_excluding_cancelled)
#         pr_statuses_dict[pr_doc_dict.get("name", f"UnnamedPR_{len(pr_statuses_dict)}")] = derived_status

#         if derived_status in status_counts:
#             status_counts[derived_status] += 1
#         else:
#             status_counts["Unknown"] += 1
#             frappe.log_error(f"Unexpected derived status '{derived_status}' for PR {pr_doc_dict.get('name')} using _get_pr_derived_status_v2", "PR Status Count")

#     if status_counts.get("Unknown") == 0:
#         status_counts.pop("Unknown", None)

#     result = {
#         "status_counts": status_counts,
#         "pr_statuses": pr_statuses_dict
#     }
#     return result


# --- FINAL VERSION ---
def _get_pr_derived_status_v2(pr_doc, project_po_list_excluding_cancelled):
    """
    Calculates the derived status of a single Procurement Request document.

    Args:
        pr_doc (Document): A full Frappe document object for a Procurement Request.
        project_po_list_excluding_cancelled (list[Document]): A list of full PO document objects for the project.

    Returns:
        str: The calculated status ("New PR", "Approved PO", "Open PR", "Deleted PR").
    """
    if not pr_doc:
        frappe.log_error("_get_pr_derived_status_v2 called with empty pr_doc", "PR Status Calculation")
        return "Unknown"

    pr_name = pr_doc.name
    pr_items = pr_doc.get("order_list") or []

    if pr_items and all(item.status == 'Deleted' for item in pr_items):
        return "Deleted PR"

    if pr_doc.workflow_state in ['Pending', 'Approved', 'Rejected', 'Draft']:
        return 'New PR'

    active_pr_items = [item for item in pr_items if item.status != 'Deleted']

    if not active_pr_items:
        return 'Open PR'

    related_pos_for_this_pr = [po_doc for po_doc in project_po_list_excluding_cancelled if po_doc.procurement_request == pr_name]

    if not related_pos_for_this_pr:
        return 'Open PR'

    all_active_pr_items_found_in_a_po = True
    for pr_item in active_pr_items:
        # Get the Item ID from the PR item, which we will use for matching.
        pr_item_id_to_match = pr_item.item_id
        if not pr_item_id_to_match:
            # If a PR item has no Item ID, it can't be matched. Consider it not covered.
            frappe.log_warning(f"PR {pr_doc.name} has an active item without an item_id. Considering it not covered.")
            all_active_pr_items_found_in_a_po = False
            break

        item_is_covered_by_a_po = False
        for po_doc in related_pos_for_this_pr:
            po_items = po_doc.get("items") or []
            
            # --- FIX: Comparing `item_id` from both child tables as requested ---
            if any(po_item.item_id == pr_item_id_to_match for po_item in po_items):
                item_is_covered_by_a_po = True
                break
        
        if not item_is_covered_by_a_po:
            all_active_pr_items_found_in_a_po = False
            break

    if all_active_pr_items_found_in_a_po:
        return 'Approved PO'

    return 'Open PR'

#@redis_cache(shared=True)
@frappe.whitelist()
def get_project_pr_status_counts(project_id: str):
    """
    Fetches all PRs for a project, calculates their derived status by inspecting
    child tables, and returns the aggregate counts and individual statuses.
    """
    if not project_id:
        frappe.throw(_("Project ID is required."))

    if not frappe.has_permission("Procurement Requests", "read"):
        frappe.throw(_("Not permitted to read Procurement Requests."), frappe.PermissionError)
    if not frappe.has_permission("Procurement Orders", "read"):
        frappe.throw(_("Not permitted to read Procurement Orders."), frappe.PermissionError)

    # Parent rows in bulk (no per-doc get_doc).
    prs = frappe.get_all(
        "Procurement Requests",
        filters={"project": project_id},
        fields=["name", "workflow_state"],
        limit_page_length=0,
    )
    pos = frappe.get_all(
        "Procurement Orders",
        filters={"project": project_id, "status": ["not in", ["Cancelled"]]},
        fields=["name", "procurement_request"],
        limit_page_length=0,
    )
    pr_names = [p["name"] for p in prs]
    po_names = [p["name"] for p in pos]

    # Child rows in bulk, grouped by parent — this replaces hydrating EVERY PR and PO
    # document (the former get_doc-per-name N+1: hundreds of doc loads on a large project).
    # `_get_pr_derived_status_v2` only reads the order_list items (status + item_id) and
    # the PO items (item_id), so we fetch just those two child tables.
    # Chunk the `parent IN (...)` lists via create_batch. Bounded per project today, but
    # chunking keeps a very large project from tripping sqlparse's 10k-token cap on prod
    # and matches the pattern used elsewhere in this file.
    pr_items_by_parent = {}
    if pr_names:
        for chunk in create_batch(pr_names, 500):
            for it in frappe.get_all(
                "Procurement Request Item Detail",
                filters={"parent": ["in", chunk], "parentfield": "order_list"},
                fields=["parent", "status", "item_id"],
                limit_page_length=0,
            ):
                pr_items_by_parent.setdefault(it["parent"], []).append(
                    frappe._dict(status=it["status"], item_id=it["item_id"])
                )
    po_items_by_parent = {}
    if po_names:
        for chunk in create_batch(po_names, 500):
            for it in frappe.get_all(
                "Purchase Order Item",
                filters={"parent": ["in", chunk]},
                fields=["parent", "item_id"],
                limit_page_length=0,
            ):
                po_items_by_parent.setdefault(it["parent"], []).append(
                    frappe._dict(item_id=it["item_id"])
                )

    # Lightweight doc-like objects so `_get_pr_derived_status_v2` is reused verbatim
    # (byte-identical to the old get_doc path — same fields, same logic).
    project_prs_docs = [
        frappe._dict(
            name=p["name"],
            workflow_state=p["workflow_state"],
            order_list=pr_items_by_parent.get(p["name"], []),
        )
        for p in prs
    ]
    project_pos_docs = [
        frappe._dict(
            name=p["name"],
            procurement_request=p["procurement_request"],
            items=po_items_by_parent.get(p["name"], []),
        )
        for p in pos
    ]

    status_counts = {"New PR": 0, "Approved PO": 0, "Open PR": 0, "Deleted PR": 0}
    pr_statuses_dict = {}

    for pr_doc in project_prs_docs:
        derived_status = _get_pr_derived_status_v2(pr_doc, project_pos_docs)
        pr_statuses_dict[pr_doc.name] = derived_status
        status_counts[derived_status] = status_counts.get(derived_status, 0) + 1

    # status_counts.pop("Deleted PR", None)

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

#@redis_cache(shared=True)
@frappe.whitelist()
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
        ["status", "not in", ["Cancelled", "Merged", "PO Amendment","Inactive"]]
    ]

    purchase_orders_data = frappe.get_all(
        "Procurement Orders",
        filters=po_filters,
        fields=["name", "total_amount","amount","tax_amount", "loading_charges", "freight_charges"] # Fields needed for total calculation
    )

    total_po_value_inc_gst = 0.0
    total_po_value_excl_gst = 0.0
    total_gst_on_items = 0.0
    final_total_gst = 0.0
    po_amounts_dict = {}
    for po_data_item in purchase_orders_data:
        # po_as_dict = frappe._dict(po_data_item)
        # totals = _calculate_po_totals_for_doc(po_as_dict)
        po_amounts_dict[po_data_item.get("name")] = {
            "total_incl_gst": po_data_item.get("total_amount", 0.0), 
            "total_excl_gst": po_data_item.get("amount", 0.0)
            }
        
        # total_po_value_inc_gst += totals.get("total_incl_gst", 0.0)
        # total_po_value_excl_gst += totals.get("total_excl_gst", 0.0)
        # total_gst_on_items += totals.get("total_gst_on_items", 0.0)
        # final_total_gst += totals.get("final_total_gst", 0.0)
        total_po_value_inc_gst += po_data_item.get("total_amount", 0.0)
        total_po_value_excl_gst += po_data_item.get("amount", 0.0)
        total_gst_on_items += po_data_item.get("tax_amount", 0.0)
        final_total_gst += po_data_item.get("tax_amount", 0.0)

    po_names = list(po_amounts_dict.keys())
    total_amount_paid_for_pos = 0.0
    if po_names:
        # sum_field = "sum(CAST(COALESCE(amount, 0) AS numeric)) as total_paid"
        sum_field = "sum(CAST(amount as numeric)) as total_paid"

        # Chunk the `document_name IN (...)` list (a project can have thousands of POs) to stay under
        # sqlparse's 10,000-token cap. SUM is associative -> per-chunk partial sums add up byte-identically.
        for chunk in create_batch(po_names, 500):
            paid_payments_for_pos = frappe.get_all(
                "Project Payments",
                filters=[
                    ["status", "=", "Paid"],
                    ["document_type", "=", "Procurement Orders"],
                    ["document_name", "in", list(chunk)]
                ],
                fields=[sum_field]
            )
            if paid_payments_for_pos and paid_payments_for_pos[0] and paid_payments_for_pos[0].total_paid is not None:
                total_amount_paid_for_pos += flt(paid_payments_for_pos[0].total_paid)
            
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


# getting PO items for a specific PO
# Add this new function to your existing Python API file

@frappe.whitelist()
def get_purchase_order_with_items(po_name: str):
    """
    Given a Purchase Order name (ID), this function returns the full
    document object, including its child tables (like 'items').
    This is used to bypass frontend permission issues where child tables are
    silently filtered out from the response of standard API calls.
    """
    if not po_name:
        frappe.throw(_("Purchase Order name is required."))

    # Security check: Ensure the user has permission to read the parent PO document.
    if not frappe.has_permission("Procurement Orders", "read", doc=po_name):
        frappe.throw(_("Not permitted to read Purchase Order {0}").format(po_name), frappe.PermissionError)

    # On the server, frappe.get_doc ALWAYS fetches the full document with child tables.
    po_doc = frappe.get_doc("Procurement Orders", po_name)

    # po_doc.as_dict() converts the entire document, including the list of items,
    # into a clean dictionary format that can be sent as JSON.
    return po_doc.as_dict()


# --- Projects-list financial rollup (perf: server aggregate, not client fetch-all) -----

_ROLLUP_KEYS = (
    "total_project_invoiced",
    "po_wo_amount",
    "inflow",
    "outflow",
    "liabilities",
    "total_credit_purchase",
    "total_credit_paid",
)


@frappe.whitelist()
def get_projects_financial_rollup():
    """Per-project financial totals for the Projects-list financial columns.

    Replaces the client-side fetch-all-then-reduce (the six `useProjectsList*` bulk hooks
    at limit:100000 + `getProjectFinancials` in projects.tsx). Aggregates on the server and
    returns one small dict; the browser does a per-row lookup.

    Global (all projects) by design — the financial columns are shown only to privileged
    roles (Admin / PMO / Accountant), and the client fetched global data too.

    Byte-identical to the client math (rows fetched then summed with `flt`, mirroring the
    frontend `parseNumber`, so NULL/blank -> 0 and mixed text/numeric storage is safe):
      - total_project_invoiced = Σ Project Invoices.amount
      - po_wo_amount           = Σ PO.total_amount (status NOT IN Merged,Inactive) + Σ SR.total_amount (status=Approved)
      - inflow                 = Σ Project Inflows.amount
      - outflow                = Σ Project Payments.amount (status=Paid) + Σ Project Expenses.amount (status=Paid; link field 'projects')
      - liabilities            = Σ po_amount_delivered − Σ min(amount_paid, po_amount_delivered)   (min is PER-PO, then summed)
      - total_credit_purchase  = Σ PO Payment Terms.amount (payment_type=Credit) on those POs

    `cashflow_gap` (= outflow + liabilities − inflow) and `project_value_gst` stay on the
    client (the latter is a field on the Projects doc). Returns
    ``{ project_name: { <_ROLLUP_KEYS> } }``.
    """
    rollup = {}

    def bucket(project):
        if not project:
            return None
        row = rollup.get(project)
        if row is None:
            row = {k: 0.0 for k in _ROLLUP_KEYS}
            rollup[project] = row
        return row

    # total_project_invoiced — Project Invoices, no filter.
    for r in frappe.get_all("Project Invoices", fields=["project", "amount"], limit_page_length=0):
        b = bucket(r.get("project"))
        if b is not None:
            b["total_project_invoiced"] += flt(r.get("amount"))

    # POs — po_wo_amount + liabilities (per-PO min), and the valid-PO -> project map for credit.
    valid_po_project = {}
    pos = frappe.get_all(
        "Procurement Orders",
        filters={"status": ["not in", ["Merged", "Inactive"]]},
        fields=["name", "project", "total_amount", "po_amount_delivered", "amount_paid"],
        limit_page_length=0,
    )
    for po in pos:
        b = bucket(po.get("project"))
        if b is None:
            continue
        b["po_wo_amount"] += flt(po.get("total_amount"))
        delivered = flt(po.get("po_amount_delivered"))
        paid = flt(po.get("amount_paid"))
        b["liabilities"] += delivered - min(paid, delivered)
        valid_po_project[po.get("name")] = po.get("project")

    # SRs — po_wo_amount (Approved only).
    for sr in frappe.get_all(
        "Service Requests",
        filters={"status": "Approved"},
        fields=["project", "total_amount"],
        limit_page_length=0,
    ):
        b = bucket(sr.get("project"))
        if b is not None:
            b["po_wo_amount"] += flt(sr.get("total_amount"))

    # inflow — Project Inflows, no filter.
    for r in frappe.get_all("Project Inflows", fields=["project", "amount"], limit_page_length=0):
        b = bucket(r.get("project"))
        if b is not None:
            b["inflow"] += flt(r.get("amount"))

    # outflow — Paid Payments + Paid Expenses (Expenses link field is `projects`, plural).
    for r in frappe.get_all(
        "Project Payments", filters={"status": "Paid"}, fields=["project", "amount"], limit_page_length=0
    ):
        b = bucket(r.get("project"))
        if b is not None:
            b["outflow"] += flt(r.get("amount"))
    for r in frappe.get_all(
        "Project Expenses", filters={"status": "Paid"}, fields=["projects", "amount"], limit_page_length=0
    ):
        b = bucket(r.get("projects"))
        if b is not None:
            b["outflow"] += flt(r.get("amount"))

    # total_credit_purchase — Credit terms on the valid (non-Merged/Inactive) POs.
    # This is a CROSS-PROJECT rollup, so valid_po_project holds EVERY non-Merged/Inactive
    # PO (thousands). Chunk the `parent IN (...)` list via create_batch so the generated
    # query never exceeds sqlparse's 10k-token cap on prod (same fix as lines above). Each
    # PO falls in exactly one chunk, so the sums just accumulate across batches.
    if valid_po_project:
        for chunk in create_batch(list(valid_po_project.keys()), 500):
            for term in frappe.get_all(
                "PO Payment Terms",
                filters={"payment_type": "Credit", "parent": ["in", chunk]},
                fields=["parent", "amount", "term_status"],
                limit_page_length=0,
            ):
                b = bucket(valid_po_project.get(term.get("parent")))
                if b is not None:
                    amt = flt(term.get("amount"))
                    b["total_credit_purchase"] += amt
                    if term.get("term_status") == "Paid":
                        b["total_credit_paid"] += amt

    return rollup