import frappe
import json
from ..Notifications.pr_notifications import PrNotification, get_admin_users, get_allowed_lead_users, get_allowed_procurement_users, get_allowed_manager_users
from frappe import _

from frappe.model.document import Document
from frappe.utils import flt, get_datetime, add_months, now_datetime
from datetime import datetime
from functools import lru_cache
import math # Though not used in the final version 3 logic, kept if needed later
# from ...api.approve_vendor_quotes import generate_pos_from_selection

# Import only necessary components from typing (TypedDict is not built-in)
# 'Any' might still be useful for generic dictionary values if strict typing isn't needed there.
from typing import TypedDict

# Constants for Auto-Approval Logic
AUTO_APPROVAL_THRESHOLD = 20000.0  # ₹20,000
AUTO_APPROVED_PR_COUNT_KEY = "auto_approved_pr_count"
SKIP_PR_INTERVAL = 8 # Skip auto-approval for every 8th PR

# Helper functions for managing the auto-approval counter
def get_auto_approval_counter() -> int:
    """Retrieves the current auto-approved PR count from Frappe Singles."""
    count = frappe.db.get_single_value("Auto Approval Counter Settings", AUTO_APPROVED_PR_COUNT_KEY)
    return int(count) if count is not None else 0

def increment_auto_approval_counter():
    """Increments the auto-approved PR count. Resets if it reaches SKIP_PR_INTERVAL."""
    current_count = get_auto_approval_counter()
    new_count = current_count + 1
    if new_count >= SKIP_PR_INTERVAL:
        frappe.db.set_single_value("Auto Approval Counter Settings", AUTO_APPROVED_PR_COUNT_KEY, 0)
        # frappe.log_simple(f"Auto-approval counter reset to 0 after reaching {SKIP_PR_INTERVAL}.")
    else:
        frappe.db.set_single_value("Auto Approval Counter Settings", AUTO_APPROVED_PR_COUNT_KEY, new_count)
        # frappe.log_simple(f"Auto-approval counter incremented to {new_count}.")

def reset_auto_approval_counter():
    """Resets the auto-approved PR count to 0."""
    frappe.db.set_single_value("Auto Approval Counter Settings", AUTO_APPROVED_PR_COUNT_KEY, 0)
    # frappe.log_simple("Auto-approval counter explicitly reset to 0.")

# Structure matching the required return type of get_historical_average_quote
# Using built-in 'list' and 'dict' for generic types (Python 3.9+)
class HistoricalAverageResult(TypedDict):
    averageRate: float
    contributingQuotes: list[dict[str, any]] # List of Approved Quotation dicts

# Structure for intermediate processed quote data
class ProcessedQuote(TypedDict):
    parsedQuote: float
    parsedQuantity: float
    creationDate: 'datetime'
    originalQuote: dict[str, any] # Keep the original dict from frappe.get_all


# ----------------------------------------------------------------------
# Helper Function: Calculate Historical Average Quote Rate for an Item
# ----------------------------------------------------------------------

# Using lru_cache for memoization
@lru_cache(maxsize=128)
def get_historical_average_quote_cached(item_id: str) -> HistoricalAverageResult:
    """
    Fetches approved quotes for the item and calculates the historical average rate.
    This function acts as a wrapper to fetch data and call the core logic,
    allowing the core logic to be potentially testable with mocked data.

    Args:
        item_id: The name (ID) of the item to calculate the rate for.

    Returns:
        A HistoricalAverageResult dictionary.
    """
    # Fetch all potentially relevant approved quotations for this item
    # We filter by docstatus=1 assuming "Approved Quotations" are submitted documents
    all_approved_quotes = frappe.get_all(
        "Approved Quotations",
        filters={"item_id": item_id},
        fields=["name", "creation", "quote", "quantity", "item_id"], # Include fields needed
        order_by="creation desc"
    )
    print(f"Fetcher for quotes: {item_id}", all_approved_quotes)

    # Call the main calculation logic
    return calculate_historical_average_quote(all_approved_quotes, item_id)


# Using built-in list/dict and Union operator | for Optional (Python 3.10+)
# If using Python 3.9, you'd need `from typing import Union` and use `Union[list[dict[str, Any]], None]`
def calculate_historical_average_quote(
    all_approved_quotes: list[dict[str, any]] | None, # Use list | None for optional list
    item_id: str
) -> HistoricalAverageResult:
    """
    Calculates a representative historical quote rate for an item based on provided approved quotes.
    Follows specific priority rules (as described before).

    Args:
        all_approved_quotes: List of approved quotation dictionaries or None.
        item_id: The ID of the item to analyze.

    Returns:
        An object containing the calculated averageRate and the list of quotes used in the calculation.
    """
    base_result: HistoricalAverageResult = {"averageRate": 0.0, "contributingQuotes": []}
    print(f"Calculating historical average quote for item: {item_id}", all_approved_quotes)

    if not all_approved_quotes:
        # frappe.log_warning(...) # Optional logging
        print(f"No approved quotes found for item {item_id}. Exiting")
        return base_result

    # 1. Filter, Validate, Parse, and Sort
    valid_item_quotes: list[ProcessedQuote] = [] # Use built-in list type hint
    for q in all_approved_quotes:
        try:
            # Ensure required fields exist and are not None before parsing
            if q.get("quote") is None or q.get("quantity") is None or q.get("creation") is None:
                continue

            parsed_quote = flt(q.get("quote"))
            parsed_quantity = flt(q.get("quantity"))
            creation_date = get_datetime(q.get("creation"))

            # Filter out items with invalid/missing essential data
            if parsed_quote > 0 and parsed_quantity > 0 and creation_date:
                # Note: We still create a dict that matches the ProcessedQuote structure
                valid_item_quotes.append({
                    "parsedQuote": parsed_quote,
                    "parsedQuantity": parsed_quantity,
                    "creationDate": creation_date,
                    "originalQuote": q
                })
        except (ValueError, TypeError) as e:
            # frappe.log_warning(...) # Optional logging
            pass # Skip this quote if parsing fails

    # Sort descending (most recent first)
    valid_item_quotes.sort(key=lambda x: x["creationDate"], reverse=True)
    print(f"Valid item quotes for {item_id}: {valid_item_quotes}")

    # --- Requirement 1: Check for Any Valid Approved Quotes ---
    if not valid_item_quotes:
        # frappe.log_info(...) # Optional logging
        print(f"No valid approved quotes found for item {item_id}. Exiting")
        return base_result

    # --- Requirement 2: Check for Single Valid Approved Quote ---
    if len(valid_item_quotes) == 1:
        # frappe.log_info(...) # Optional logging
        print(f"Single valid approved quote found for item {item_id}: {valid_item_quotes[0]}")
        return {
            "averageRate": valid_item_quotes[0]["parsedQuote"],
            "contributingQuotes": [valid_item_quotes[0]["originalQuote"]]
        }

    # --- Requirement 3: Filter by Last 3 Months ---
    three_months_ago = add_months(now_datetime(), -3)

    recent_quotes = [
        q for q in valid_item_quotes if q["creationDate"] >= three_months_ago
    ]

    # Determine which set of quotes to use for calculation
    quotes_to_calculate: list[ProcessedQuote] # Use built-in list type hint
    calculation_reason: str

    if len(recent_quotes) == 1:
        # --- Requirement 4: Check Single Quote Within 3 Months ---
        # frappe.log_info(...) # Optional logging
        return {
            "averageRate": recent_quotes[0]["parsedQuote"],
            "contributingQuotes": [recent_quotes[0]["originalQuote"]]
        }
    elif len(recent_quotes) > 1:
        # --- Requirement 5: Calculate Weighted Average (if > 1 recent quote) ---
        # frappe.log_info(...) # Optional logging
        quotes_to_calculate = recent_quotes
        calculation_reason = "last 3 months"
    else:
        # --- Requirement 6: Fallback Calculation (if 0 recent quotes, use all valid) ---
        # frappe.log_info(...) # Optional logging
        quotes_to_calculate = valid_item_quotes # Use all valid quotes
        calculation_reason = "all historical"

    # --- Perform Weighted Average Calculation ---
    sum_of_quote_times_quantity = 0.0
    sum_of_quantities = 0.0

    for pq in quotes_to_calculate:
        sum_of_quote_times_quantity += pq["parsedQuote"] * pq["parsedQuantity"]
        sum_of_quantities += pq["parsedQuantity"]

    calculated_average_rate = 0.0
    if sum_of_quantities > 0:
         calculated_average_rate = sum_of_quote_times_quantity / sum_of_quantities
    # else:
        # Optional logging for zero quantity sum
        # frappe.log_warning(...)

    return {
        "averageRate": calculated_average_rate,
        "contributingQuotes": [pq["originalQuote"] for pq in quotes_to_calculate]
    }


# ----------------------------------------------------------------------
# Main Validation Function for Procurement Request
# ----------------------------------------------------------------------

def validate_procurement_request(doc: Document) -> bool:
    """
    Validates a Procurement Request based on specified checks.

    Args:
        doc: The Procurement Request document object.

    Returns:
        True if all checks pass, False otherwise.
        (Consider raising frappe.ValidationError in hooks)
    """
    get_historical_average_quote_cached.cache_clear()

    # procurement_list_json = doc.get("procurement_list")
    # items = []
    items = doc.get("order_list", [])
    # if procurement_list_json:
    #     try:
    #         data = json.loads(procurement_list_json)
    #         # Ensure 'list' exists and is a list, otherwise default to empty list
    #         items = data.get("list", []) if isinstance(data.get("list"), list) else []
    #     except json.JSONDecodeError:
    #         frappe.msgprint(f"Error parsing procurement list JSON for {doc.name}", indicator="red", title="Validation Error")
    #         return False # Invalid format fails the check

    if not items:
        frappe.msgprint(f"Procurement Request {doc.name} has no items in 'order_list'.", indicator="orange", title="Validation Info")
        return True # Passes based on amount < 5000

    total_estimated_amount = 0.0
    pending_items_count = 0

    # --- Check 1: No "Request" status items ---
    for item in items:
        # Check if item is a dictionary before accessing keys
        # if not isinstance(item, dict):
        #      frappe.msgprint(f"Invalid item format found in procurement list for {doc.name}.", indicator="red", title="Validation Error")
        #      return False # Invalid item format

        current_item_status = item.get("status")

        if current_item_status == "Request":
            item_display = item.get('item_name') or item.get('item_id', 'Unknown Item')
            frappe.msgprint(f"Procurement Request {doc.name} contains item '{item_display}' with status 'Request'. Please add the item to the database first.", indicator="red", title="Validation Failed")
            return False # Fail check 1

    # --- Checks 2, 3 & 4: Calculate total estimated amount for "Pending" items ---
    for item in items:
        current_item_status = item.get("status")

        # Already checked item is a dict
        if current_item_status == "Pending":
            pending_items_count += 1
            item_id = item.get("item_id") # Assuming 'name' holds the Item Code/ID
            item_display_name = item.get('item_name') or item_id or 'Unknown Item' # For messages
            quantity = item.get("quantity")

            if not item_id:
                frappe.msgprint(f"Item '{item_display_name}' in Procurement Request {doc.name} is missing an ID ('item_id' field).", indicator="red", title="Validation Failed")
                return False

            # Validate quantity
            if quantity is None: # Check if quantity is missing
                frappe.msgprint(
                    f"Item '{item_display_name}' in PR {doc.name} is missing a quantity value.", 
                    indicator="red", 
                    title="Validation Failed"
                )
                return False

            try:
                numeric_quantity = flt(quantity) 
                if numeric_quantity <= 0:
                    frappe.msgprint(f"Item '{item_display_name}' in PR {doc.name} has zero or negative quantity.", indicator="red", title="Validation Failed")
                    return False
            except (ValueError, TypeError):
                 frappe.msgprint(f"Item '{item_display_name}' in PR {doc.name} has an invalid quantity value: '{numeric_quantity}'.", indicator="red", title="Validation Failed")
                 return False


            # --- Check 2 & 3: Get Estimated Rate ---
            try:
                rate_result = get_historical_average_quote_cached(item_id)
                print(f"Fetched rate for item {item_id}: {rate_result}")
                estimated_rate = rate_result["averageRate"]

                if estimated_rate <= 0:
                    frappe.msgprint(f"Could not determine a valid estimated rate (> 0) for item '{item_display_name}' (ID: {item_id}) based on historical approved quotes.", indicator="red", title="Validation Failed")
                    return False # Fail check 3
            except Exception as e:
                frappe.log_error(f"Error calculating rate for item {item_id} in PR {doc.name}: {e}", "Procurement Validation Error")
                frappe.msgprint(f"An error occurred while calculating the rate for item '{item_display_name}'.", indicator="red", title="System Error")
                return False


            # --- Check 4: Accumulate Total Amount ---
            item_amount = quantity * estimated_rate
            total_estimated_amount += item_amount
            print(f"Total estimated amount for PR {doc.name}: {total_estimated_amount:.2f}")
    if pending_items_count == 0:
         frappe.msgprint(f"Procurement Request {doc.name} has no items with status 'Pending'.", indicator="orange", title="Validation Info")
         return True # Passes amount check (0 < 5000)
    
    doc.db_set("target_value", total_estimated_amount, update_modified=False)


    # --- Check 5: Total Estimated Amount < 5000 ---
    threshold = 5000.0
    # Use frappe.compare to handle potential floating point inaccuracies if needed, though direct comparison is usually fine here.
    # from frappe.utils import compare
    # if compare(total_estimated_amount, '<', threshold):
    if total_estimated_amount < threshold:
        print(f"Total estimated amount for PR {doc.name}: {total_estimated_amount:.2f} < {threshold}")
        frappe.msgprint(f"Procurement Request {doc.name} passed validation. Total Estimated Amount: {total_estimated_amount:.2f}", indicator="green", title="Validation Passed")
        # Optional: Store the calculated amount
        # doc.db_set('custom_total_estimated_amount', total_estimated_amount, update_modified=False)
        return True # All checks passed
    else:
        frappe.msgprint(f"Procurement Request {doc.name} failed validation. Total Estimated Amount ({total_estimated_amount:.2f}) is not less than {threshold}.", indicator="red", title="Validation Failed")
        return False # Fail check 5


# ----------------------------------------------------------------------
# NEW Validation Function for PO Readiness
# ----------------------------------------------------------------------

def validate_procurement_request_for_po(doc: Document) -> bool:
    """
    Validates a Procurement Request for Purchase Order creation readiness.

    Checks:
    1. Workflow state must be "Vendor Selected".
    2. Total actual amount (sum of item quantity * item quote from list) < 20000.
    NOT REQUIRED CHECK Percentage difference between total estimated amount and total actual amount <= 5%.

    Args:
        doc: The Procurement Request document object.

    Returns:
        True if all checks pass, False otherwise.
    """
     # --- Start of Debugging ---
    frappe.msgprint("---- STARTING AUTO-APPROVAL VALIDATION ----", title="Debug Info")
    print("---- STARTING AUTO-APPROVAL VALIDATION ----")
    print(f"DEBUG1: Validating PR: {doc.name}")

    # --- Check 1: Workflow State ---
    required_state = "Vendor Selected"
    print(f"DEBUG2: [Check 1] Required State='{required_state}', Actual State='{doc.workflow_state}'")
    if doc.workflow_state != required_state:
        msg = f"Procurement Request {doc.name} is not in the required workflow state '{required_state}'. Current state: '{doc.workflow_state}'."
        frappe.msgprint(msg, indicator="orange", title="Validation Failed")
        print(f"DEBUG3: [FAIL] {msg}")
        return False
    print("DEBUG4: [PASS] Check 1: Workflow state is correct.")

    # --- Get Items from order_list ---
    items = doc.get("order_list", [])
    # data = None # Initialize data

    # *** FIX APPLIED HERE ***
    # if isinstance(procurement_list_data, str):
    #     try:
    #         data = json.loads(procurement_list_data)
    #     except json.JSONDecodeError:
    #         frappe.msgprint(f"Error parsing procurement list JSON for {doc.name}", indicator="red", title="Validation Error")
    #         return False
    # elif isinstance(procurement_list_data, dict):
    #     data = procurement_list_data # Already a dictionary
    # elif procurement_list_data is None:
    #      frappe.msgprint(f"Procurement list is missing for PR {doc.name} in state '{required_state}'.", indicator="red", title="Validation Failed")
    #      return False
    # else:
    #     frappe.msgprint(f"Unexpected data type for procurement list in {doc.name}", indicator="red", title="Validation Error")
    #     return False

    # Get items list safely
    # if data and isinstance(data.get("list"), list):
    #     items = data.get("list")
    # *** END OF FIX ***

    if not items:
        msg = f"Procurement list (order_list) is empty for PR {doc.name}."
        frappe.msgprint(msg, indicator="red", title="Validation Failed")
        print(f"DEBUG5: [FAIL] {msg}")
        return False
    print(f"DEBUG6: Found {len(items)} total items in order_list.")
    # --- Calculate Actual and Estimated Amounts ---
    total_actual_amount = 0.0
    items_processed_count = 0 
    # total_estimated_amount = 0.0
    print("DEBUG7: Iterating through items to calculate total actual amount for 'Pending' items...")
    # Count items used for calculation
    # get_historical_average_quote_cached.cache_clear() # Clear cache before calculations

    for item in items:
        print(f"DEBUG8: Processing item {item}")
        # if not isinstance(item, dict):
        #      frappe.msgprint(f"Invalid item format found in procurement list for {doc.name}.", indicator="red", title="Validation Error")
        #      return False
        if item.status != "Pending":
            # Skip items that are not "Pending"
            continue
        items_processed_count += 1 # Increment count for valid items
        item_id = item.item_id
        item_display_name = item.item_name or item_id or 'Unknown Item'
        quantity_str = item.quantity
        # *** IMPORTANT: Assumes 'quote' field exists in the item dict ***
        actual_quote_str = item.quote
        print(f"DEBUG8: Processing 'Pending' item: {item_display_name}, Qty: {quantity_str}, Quote: {actual_quote_str}")


        if not item_id:
            frappe.msgprint(f"Item '{item_display_name}' in PR {doc.name} is missing an ID ('name' field).", indicator="red", title="Validation Failed")
            return False

        # Validate and parse Quantity
        try:
            quantity = flt(quantity_str)
            if quantity <= 0:
                frappe.msgprint(f"Item '{item_display_name}' in PR {doc.name} has zero or negative quantity.", indicator="red", title="Validation Failed")
                return False
        except (ValueError, TypeError):
             frappe.msgprint(f"Item '{item_display_name}' in PR {doc.name} has an invalid quantity value: '{quantity_str}'.", indicator="red", title="Validation Failed")
             return False

        # Validate and parse Actual Quote from the item list
        if actual_quote_str is None:
             frappe.msgprint(f"Item '{item_display_name}' in PR {doc.name} is missing the selected 'quote' value in the procurement list.", indicator="red", title="Validation Failed")
             return False
        try:
            actual_quote = flt(actual_quote_str)
            if actual_quote < 0: # Allow zero quote? Assuming non-negative is required. Adjust if 0 is valid.
                frappe.msgprint(f"Item '{item_display_name}' in PR {doc.name} has a negative actual quote value: '{actual_quote_str}'.", indicator="red", title="Validation Failed")
                return False
        except (ValueError, TypeError):
             frappe.msgprint(f"Item '{item_display_name}' in PR {doc.name} has an invalid actual quote value: '{actual_quote_str}'.", indicator="red", title="Validation Failed")
             return False

        # Calculate Actual Amount component
        total_actual_amount += quantity * actual_quote

        # Calculate Estimated Amount component
        # try:
        #     rate_result = get_historical_average_quote_cached(item_id)
        #     estimated_rate = rate_result["averageRate"]
        #     if estimated_rate <= 0:
        #         frappe.msgprint(f"Could not determine a valid historical estimated rate (> 0) for item '{item_display_name}' (ID: {item_id}). Cannot perform comparison.", indicator="red", title="Validation Failed")
        #         continue # Skip this item, but continue with others
        # except Exception as e:
        #     frappe.log_error(f"Error calculating estimated rate for item {item_id} in PR {doc.name}: {e}", "Procurement PO Validation Error")
        #     frappe.msgprint(f"An error occurred while calculating the estimated rate for item '{item_display_name}'.", indicator="red", title="System Error")
        #     return False

        # total_estimated_amount += quantity * estimated_rate

    # If no 'Pending' items were found to process after filtering
    if items_processed_count == 0:
        msg = f"No 'Pending' items found in procurement list for PR {doc.name} to validate for PO."
        frappe.msgprint(msg, indicator="orange", title="Validation Info")
        print(f"DEBUG9: [FAIL] {msg}")
        # Decide if this state passes or fails. Usually, if no items, amounts are 0, so it might pass checks below.
        # Let's assume it should fail if the intent requires items.
        return False
    
    print(f"DEBUG10: Total 'Pending' items processed: {items_processed_count}")
    print(f"DEBUG11: Calculated Total Actual Amount: {total_actual_amount}")
    frappe.msgprint(f"Calculated Total PO Value: {total_actual_amount:.2f}", title="Debug Info")
    
    print(f"DEBUG12: [Check 2] Checking if {total_actual_amount} < {AUTO_APPROVAL_THRESHOLD}")
    # --- Auto-Approval Logic based on Value Threshold and Counter ---
    if total_actual_amount < AUTO_APPROVAL_THRESHOLD: # This covers anything under ₹20,000
        print("DEBUG13: [PASS] Check 2: Amount is below threshold. Proceeding to counter check.")
        current_auto_approved_count = get_auto_approval_counter()
        print(f"DEBUG14: [Check 3] Current auto-approval count is {current_auto_approved_count}. Skipping on {SKIP_PR_INTERVAL - 1}.")
        
        if current_auto_approved_count == (SKIP_PR_INTERVAL - 1): # This is the 9th PR (0-indexed count)
            msg = f"This is the {SKIP_PR_INTERVAL}th auto-approval candidate. Forcing manual review."
            frappe.msgprint(msg, indicator="orange", title="Manual Review Required")
            print(f"DEBUG15: [FAIL] {msg}")
            reset_auto_approval_counter()
            return False # Fail validation to force manual review
        else:
            msg = f"PR auto-approved! Amount is below threshold and it is not the {SKIP_PR_INTERVAL}th check."
            frappe.msgprint(msg, indicator="green", title="Auto-Approved")
            print(f"DEBUG16: [PASS] {msg}")
            increment_auto_approval_counter()
            frappe.msgprint(f"Procurement Request {doc.name} (Value: {total_actual_amount:.2f}) auto-approved. Auto-approval count: {get_auto_approval_counter()}/{SKIP_PR_INTERVAL-1}", indicator="green", title="Auto-Approved")
            return True # Auto-approve
    else:
        # If total actual amount is >= AUTO_APPROVAL_THRESHOLD, it fails auto-approval
        msg = f"Total Actual Amount ({total_actual_amount:.2f}) is not less than the auto-approval threshold of {AUTO_APPROVAL_THRESHOLD:.2f}."
        frappe.msgprint(f"Validation Failed: {msg}", indicator="red", title="Validation Failed")
        print(f"DEBUG17: [FAIL] Check 2: {msg}")
        return False

    # --- Check 3: Percentage Difference (This check is now only reached if total_actual_amount >= AUTO_APPROVAL_THRESHOLD) ---
    # This part of the code will now only be reached if the PR is NOT auto-approved by the above logic.
    # The original task implies that if it's auto-approved, no further checks are needed.
    # If the intent was to apply percentage difference check *after* the 20k threshold,
    # then this block should be moved inside the `else` block above, or the `return False`
    # for the threshold check should be removed and the percentage check applied.
    # Based on "Auto-approve PRs with values less than ₹20,000", if it's less, it's approved (or skipped).
    # If it's NOT less, it fails. So, the percentage difference check is effectively bypassed for now.
    # If this is not the desired behavior, further clarification is needed.
    # For now, I'm assuming the 20k threshold is the primary gate for auto-approval.
    # percentage_threshold = 5.0
    # percentage_difference = 0.0

    # if total_estimated_amount == 0:
    #     if total_actual_amount != 0:
    #         # Estimated is 0, but actual isn't. Infinite difference.
    #         frappe.msgprint(f"Validation Failed for PR {doc.name}: Total Estimated Amount is zero, but Total Actual Amount is {total_actual_amount:.2f}. Cannot calculate valid percentage difference.", indicator="red", title="Validation Failed")
    #         return False
    #     # else: both are 0, difference is 0%, which is <= 5%, so proceed.
    # else:
    #     difference = abs(total_estimated_amount - total_actual_amount)
    #     percentage_difference = (difference / total_estimated_amount) * 100

    # if percentage_difference > percentage_threshold:
    #     frappe.msgprint(
    #         f"Validation Failed for PR {doc.name}: Percentage difference between Estimated ({total_estimated_amount:.2f}) and Actual ({total_actual_amount:.2f}) amounts is {percentage_difference:.2f}%, which exceeds the threshold of {percentage_threshold}%.",
    #         indicator="red", title="Validation Failed"
    #     )
    #     return False

    # # --- All Checks Passed ---
    # frappe.msgprint(f"Procurement Request {doc.name} passed validation for PO creation.", indicator="green", title="Validation Passed")
    # return True

def after_insert(doc, method):
    # if(frappe.db.exists({"doctype": "Procurement Requests", "project": doc.project, "work_package": doc.work_package, "owner": doc.owner, "workflow_state": "Pending"})):
    # last_prs = frappe.db.get_list("Procurement Requests", 
    #                                  filters={
    #                                      "project": doc.project,
    #                                      "work_package": doc.work_package,
    #                                      "owner": doc.owner,
    #                                      "workflow_state": "Pending"
    #                                      },
    #                                      fields=['name', 'project', 'work_package', 'owner', 'workflow_state', 'procurement_list', 'category_list'],
    #                                      order_by='creation desc'
    #                                      )
    # project_data = frappe.get_doc("Projects", doc.project)
    # if len(last_prs)>1 and doc.work_package is not None:
    #     last_pr = last_prs[1]
    #     procurement_list = doc.procurement_list
    #     if isinstance(procurement_list, str):
    #         procurement_list = json.loads(procurement_list)
    #     new_item_ids = [item['name'] for item in procurement_list['list']]
    #     new_procurement_list = procurement_list

    #     last_procurement_list = last_pr.procurement_list
    #     if isinstance(last_procurement_list, str):
    #         last_procurement_list = json.loads(last_procurement_list)
    #     for item in last_procurement_list['list']:
    #         if item['name'] in new_item_ids:
    #             update_quantity(new_procurement_list, item['name'], item['quantity'])
    #         else:
    #             new_procurement_list['list'].append(item)
        
    #     # doc.procurement_list = new_procurement_list
        
    #     # new_category_list = doc.category_list
    #     # existing_names = {item['name'] for item in new_category_list['list']}
    #     # for item in last_pr.category_list['list']:
    #     #     if item['name'] not in existing_names:
    #     #         new_category_list['list'].append(item)
    #     combined_request = last_procurement_list['list'] + new_procurement_list['list']
    #     new_categories = []

    #     for item in combined_request:
    #         is_duplicate = any(
    #             category["name"] == item["category"] and category["status"] == item["status"]
    #             for category in new_categories
    #         )
    #         if not is_duplicate:
    #             makes = get_makes_for_category(project_data, item["category"])
    #             new_categories.append({"name": item["category"], "status": item["status"], "makes": makes})
            
    #     # doc.category_list = new_category_list
    #     # doc.save(ignore_permissions=True)
    #     frappe.db.set_value("Procurement Requests", doc.name, {
    #         "procurement_list": json.dumps(new_procurement_list),
    #         "category_list": json.dumps({"list" : new_categories})
    #     })
        
    #     comments = frappe.db.get_all("Nirmaan Comments", {
    #         "reference_name": last_pr.name
    #     })

    #     if len(comments)>0:
    #         for comment in comments:
    #             frappe.db.set_value("Nirmaan Comments", comment.name, {
    #                 "reference_name": doc.name
    #             })

    #     frappe.delete_doc("Procurement Requests", last_pr.name)
    if doc.work_package is not None and validate_procurement_request(doc):
        doc.workflow_state = "Approved"
        doc.save(ignore_permissions=True)
        doc.db_set("modified_by", "Administrator", update_modified=False)
         
    elif doc.work_package is not None:
        lead_admin_users = get_allowed_lead_users(doc) + get_admin_users()
        custom = True if doc.work_package is None else False
        if lead_admin_users:
            for user in lead_admin_users:
                if user["push_notification"] == "true":
                    # Dynamically generate notification title/body for each lead
                    notification_title = f"New {'Custom PR' if custom else 'PR'} Created for Project {doc.project}"
                    notification_body = (
                        f"Hi {user['full_name']}, a new {'custom procurement' if custom else 'procurement'} procurement request for the {doc.project if custom else doc.work_package}"
                        f"{' project' if custom else ' work package'} has been submitted and is awaiting your review."
                        )
                    click_action_url = f"{frappe.utils.get_url()}/frontend/procurement-requests?tab=Approve%20PR"
                    # Send notification for each lead
                    PrNotification(user, notification_title, notification_body, click_action_url)
                else:
                    print(f"push notifications were not enabled for user: {user['full_name']}")
        else:
            print("No project leads or admins found with push notifications enabled.")

        message = {
            "title": _(f"New {'Custom PR' if custom else 'PR'} Created"),
            "description": _(f"A new {'Custom PR' if custom else 'PR'}: {doc.name} has been created."),
            "project": doc.project,
            "work_package": doc.work_package if not custom else "Custom",
            "sender": doc.owner,
            "docname": doc.name
        }
        # Emit the event to the allowed users
        for user in lead_admin_users:
            new_notification_doc = frappe.new_doc('Nirmaan Notifications')
            new_notification_doc.recipient = user['name']
            new_notification_doc.recipient_role = user['role_profile']
            if frappe.session.user != 'Administrator':
                new_notification_doc.sender = frappe.session.user
            new_notification_doc.title = message["title"]
            new_notification_doc.description = message["description"]
            new_notification_doc.document = 'Procurement Requests'
            new_notification_doc.docname = doc.name
            new_notification_doc.project = doc.project
            new_notification_doc.work_package = doc.work_package if not custom else "Custom"
            new_notification_doc.seen = "false"
            new_notification_doc.type = "info"
            new_notification_doc.event_id = "pr:new"
            new_notification_doc.action_url = f"procurement-requests/{doc.name}?tab=Approve%20PR"
            new_notification_doc.insert()
            frappe.db.commit()

            message["notificationId"] = new_notification_doc.name
            print(f"running publish realtime for: {user}")

            frappe.publish_realtime(
                event="pr:new",  # Custom event name
                message=message,
                user=user['name']  # Notify only specific users
            )

def update_quantity(data, target_name, new_quantity):
    for item in data['list']:
        if item['name'] == target_name:
            item['quantity'] += new_quantity

def on_update(doc, method):
    custom = True if doc.work_package is None else False
    old_doc = doc.get_doc_before_save()
    # if old_doc and old_doc.workflow_state=='In Progress' and doc.workflow_state == "Vendor Selected":
    #     if validate_procurement_request_for_po(doc):
    #         doc.workflow_state = "Vendor Approved"
    #         doc.save(ignore_permissions=True)
    #         doc.db_set("modified_by", "Administrator", update_modified=False)

    #         # Generate POs (Ensure data is prepared correctly)
    #         procurement_list_data = doc.get("procurement_list") # Get potentially updated data
    #         items_data = None
    #         if isinstance(procurement_list_data, str): items_data = json.loads(procurement_list_data)
    #         elif isinstance(procurement_list_data, dict): items_data = procurement_list_data
    #         if items_data and isinstance(items_data.get("list"), list):
    #             items_list = items_data.get("list")
    #             items_arr = [item.get("name") for item in items_list if item.get("status") == "Pending"]
    #             selected_vendors = {item["name"]: item["vendor"] for item in items_list if item.get("status") == "Pending" and item.get("vendor")}

    #         po = generate_pos_from_selection(doc.project, doc.name, items_arr, selected_vendors, False )
    #         print(f"PO generated: {po}")
    #         po_doc = frappe.get_doc("Procurement Orders", po['po'])
    #         po_doc.db_set("owner", "Administrator", update_modified=False)
    #     else:
    #         lead_admin_users = get_allowed_lead_users(doc) + get_admin_users()
    #         if lead_admin_users:
    #             for user in lead_admin_users:
    #                 if user["push_notification"] == "true":
    #                     notification_title = None
    #                     if custom:
    #                         notification_title = f"New Custom PR: {doc.name} created and Vendors Selected!"
    #                     else:
    #                         notification_title = f"Vendors Selected for the PR: {doc.name}!"
    #                     notification_body = None
    #                     if custom:
    #                         notification_body = (
    #                             f"Hi {user['full_name']}, A new Custom PR: {doc.name} created and Vendors have been selected. "
    #                             "Please review it and proceed with approval or rejection."
    #                         )
    #                     else:
    #                         notification_body = (
    #                                 f"Hi {user['full_name']}, Vendors have been selected for the {doc.work_package} work package. "
    #                                 "Please review the selection and proceed with approval or rejection."
    #                             )
    #                     click_action_url = f"{frappe.utils.get_url()}/frontend/purchase-orders?tab=Approve%20PO"
    #                     print(f"click_action_url: {click_action_url}")
    #                     PrNotification(user, notification_title, notification_body, click_action_url)
    #                 else:
    #                     print(f"push notifications were not enabled for user: {user['full_name']}")

    #                 # send in-app notification for all allowed users
    #                 title = None
    #                 if custom:
    #                     title = f"New Custom PR created and Vendors Selected!"
    #                 else:
    #                     title = f"PR Status Updated!"

    #                 description = None
    #                 if custom:
    #                     description = f"A new Custom PR: {doc.name} created and Vendors have been selected."
    #                 else:
    #                     description = f"Vendors have been selected for the PR: {doc.name}!"
    #                 message = {
    #                     "title": _(title),
    #                     "description": _(description),
    #                     "project": doc.project,
    #                     "work_package": doc.work_package if not custom else "Custom",
    #                     "sender": frappe.session.user,
    #                     "docname": doc.name
    #                 }
    #                 new_notification_doc = frappe.new_doc('Nirmaan Notifications')
    #                 new_notification_doc.recipient = user['name']
    #                 new_notification_doc.recipient_role = user['role_profile']
    #                 if frappe.session.user != 'Administrator':
    #                     new_notification_doc.sender = frappe.session.user
    #                 new_notification_doc.title = message["title"]
    #                 new_notification_doc.description = message["description"]
    #                 new_notification_doc.document = 'Procurement Requests'
    #                 new_notification_doc.docname = doc.name
    #                 new_notification_doc.project = doc.project
    #                 new_notification_doc.work_package = doc.work_package if not custom else "Custom"
    #                 new_notification_doc.seen = "false"
    #                 new_notification_doc.type = "info"
    #                 new_notification_doc.event_id = "pr:vendorSelected"
    #                 new_notification_doc.action_url = f"purchase-orders/{doc.name}?tab=Approve%20PO"
    #                 new_notification_doc.insert()
    #                 frappe.db.commit()

    #                 message["notificationId"] = new_notification_doc.name
    #                 print(f"running publish realtime for: {user}")

    #                 frappe.publish_realtime(
    #                     event="pr:vendorSelected",  # Custom event name
    #                     message=message,
    #                     user=user['name']  # Notify only specific users
    #                 )
    #         else:
    #             print("No project leads or admins found with push notifications enabled.")
    if old_doc and old_doc.workflow_state=='Pending' and doc.workflow_state == "Vendor Selected":
        lead_admin_users = get_allowed_lead_users(doc) + get_admin_users()
        if lead_admin_users:
            for user in lead_admin_users:
                if user["push_notification"] == "true":
                    notification_title = None
                    if custom:
                        notification_title = f"New Custom PR: {doc.name} created and Vendors Selected!"
                    else:
                        notification_title = f"Vendors Selected for the PR: {doc.name}!"
                    notification_body = None
                    if custom:
                        notification_body = (
                            f"Hi {user['full_name']}, A new Custom PR: {doc.name} created and Vendors have been selected. "
                            "Please review it and proceed with approval or rejection."
                        )
                    else:
                        notification_body = (
                                f"Hi {user['full_name']}, Vendors have been selected for the {doc.work_package} work package. "
                                "Please review the selection and proceed with approval or rejection."
                            )
                    click_action_url = f"{frappe.utils.get_url()}/frontend/purchase-orders?tab=Approve%20PO"
                    print(f"click_action_url: {click_action_url}")
                    PrNotification(user, notification_title, notification_body, click_action_url)
                else:
                    print(f"push notifications were not enabled for user: {user['full_name']}")

                # send in-app notification for all allowed users
                title = None
                if custom:
                    title = f"New Custom PR created and Vendors Selected!"
                else:
                    title = f"PR Status Updated!"
                
                description = None
                if custom:
                    description = f"A new Custom PR: {doc.name} created and Vendors have been selected."
                else:
                    description = f"Vendors have been selected for the PR: {doc.name}!"
                message = {
                    "title": _(title),
                    "description": _(description),
                    "project": doc.project,
                    "work_package": doc.work_package if not custom else "Custom",
                    "sender": frappe.session.user,
                    "docname": doc.name
                }
                new_notification_doc = frappe.new_doc('Nirmaan Notifications')
                new_notification_doc.recipient = user['name']
                new_notification_doc.recipient_role = user['role_profile']
                if frappe.session.user != 'Administrator':
                    new_notification_doc.sender = frappe.session.user
                new_notification_doc.title = message["title"]
                new_notification_doc.description = message["description"]
                new_notification_doc.document = 'Procurement Requests'
                new_notification_doc.docname = doc.name
                new_notification_doc.project = doc.project
                new_notification_doc.work_package = doc.work_package if not custom else "Custom"
                new_notification_doc.seen = "false"
                new_notification_doc.type = "info"
                new_notification_doc.event_id = "pr:vendorSelected"
                new_notification_doc.action_url = f"purchase-orders/{doc.name}?tab=Approve%20PO"
                new_notification_doc.insert()
                frappe.db.commit()

                message["notificationId"] = new_notification_doc.name
                print(f"running publish realtime for: {user}")

                frappe.publish_realtime(
                    event="pr:vendorSelected",  # Custom event name
                    message=message,
                    user=user['name']  # Notify only specific users
                )
        else:
            print("No project leads or admins found with push notifications enabled.")


    elif old_doc and old_doc.workflow_state == "Pending" and doc.workflow_state == "Approved":
        proc_admin_users = get_allowed_procurement_users(doc) + get_admin_users()
        if proc_admin_users:
            for user in proc_admin_users:
                if user["push_notification"] == "true":
                    # Dynamically generate notification title/body for each lead
                    notification_title = f"New PR Request for Project {doc.project}"
                    notification_body = (
                        f"Hi {user['full_name']}, a new procurement request for the {doc.work_package} "
                        f"work package has been approved by {get_user_name(frappe.session.user)}, click here to take action."
                        )
                    click_action_url = f"{frappe.utils.get_url()}/frontend/procurement-requests?tab=New%20PR%20Request"
                    # Send notification for each lead
                    PrNotification(user, notification_title, notification_body, click_action_url)
                else:
                    print(f"push notifications were not enabled for user: {user['full_name']}")
        else:
            print("No Proc Execs or admins found with push notifications enabled.")

        message = {
            "title": _("New PR Request"),
            "description": _(f"New PR: {doc.name} has been approved."),
            "project": doc.project,
            "work_package": doc.work_package,
            "sender": frappe.session.user,
            "docname": doc.name
        }
        # Emit the event to the allowed users
        for user in proc_admin_users:
            new_notification_doc = frappe.new_doc('Nirmaan Notifications')
            new_notification_doc.recipient = user['name']
            new_notification_doc.recipient_role = user['role_profile']
            if frappe.session.user != 'Administrator':
                new_notification_doc.sender = frappe.session.user
            new_notification_doc.title = message["title"]
            new_notification_doc.description = message["description"]
            new_notification_doc.document = 'Procurement Requests'
            new_notification_doc.docname = doc.name
            new_notification_doc.project = doc.project
            new_notification_doc.work_package = doc.work_package
            new_notification_doc.seen = "false"
            new_notification_doc.type = "info"
            new_notification_doc.event_id = "pr:approved"
            new_notification_doc.action_url = f"procurement-requests/{doc.name}?tab=New%20PR%20Request"
            new_notification_doc.insert()
            frappe.db.commit()

            message["notificationId"] = new_notification_doc.name
            print(f"running publish realtime for: {user}")

            frappe.publish_realtime(
                event="pr:approved",  # Custom event name
                message=message,
                user=user['name']  # Notify only specific users
            )


    elif old_doc and old_doc.workflow_state in ('Pending', 'Vendor Selected') and doc.workflow_state == "Rejected":
        manager_admin_users = get_allowed_manager_users(doc) + get_admin_users()
        if manager_admin_users:
            for user in manager_admin_users:
                if user["push_notification"] == "true":
                    # Dynamically generate notification title/body for each lead
                    notification_body = None
                    if custom:
                        notification_body = (
                            f"Hi {user['full_name']}, the Custom PR: {doc.name} has been rejected by {get_user_name(frappe.session.user)}, click here to resolve."
                        )
                    else:
                        notification_body = (
                            f"Hi {user['full_name']}, the procurement request: {doc.name} for the {doc.work_package} "
                            f"work package has been rejected by {get_user_name(frappe.session.user)}, click here to resolve."
                        )
                    notification_title = f"{'Custom PR' if custom else 'PR'}: {doc.name} Rejected!"
                    click_action_url = f"{frappe.utils.get_url()}/frontend/prs&milestones/procurement-requests/{doc.name}"
                    # Send notification for each lead
                    PrNotification(user, notification_title, notification_body, click_action_url)
                else:
                    print(f"push notifications were not enabled for user: {user['full_name']}")
        else:
            print("No Managers or admins found with push notifications enabled.")

        message = {
            "title": _(f"{'Custom PR' if custom else 'PR'} Status Updated"),
            "description": _(f"{'Custom PR' if custom else 'PR'}: {doc.name} has been rejected."),
            "project": doc.project,
            "work_package": doc.work_package if not custom else "Custom",
            "sender": frappe.session.user,
            "docname": doc.name
        }
        # Emit the event to the allowed users
        for user in manager_admin_users:
            new_notification_doc = frappe.new_doc('Nirmaan Notifications')
            new_notification_doc.recipient = user['name']
            new_notification_doc.recipient_role = user['role_profile']
            if frappe.session.user != 'Administrator':
                new_notification_doc.sender = frappe.session.user
            new_notification_doc.title = message["title"]
            new_notification_doc.description = message["description"]
            new_notification_doc.document = 'Procurement Requests'
            new_notification_doc.docname = doc.name
            new_notification_doc.project = doc.project
            new_notification_doc.work_package = doc.work_package if not custom else "Custom"
            new_notification_doc.seen = "false"
            new_notification_doc.type = "info"
            new_notification_doc.event_id = "pr:rejected"
            new_notification_doc.action_url = f"prs&milestones/procurement-requests/{doc.name}"
            new_notification_doc.insert()
            frappe.db.commit()

            message["notificationId"] = new_notification_doc.name
            print(f"running publish realtime for: {user}")

            frappe.publish_realtime(
                event="pr:rejected",  # Custom event name
                message=message,
                user=user['name']  # Notify only specific users
            )

def get_makes_for_category(project, category):
    # Parse project_work_packages if it's a string
    project_work_packages = project.get('project_work_packages', "[]")
    if isinstance(project_work_packages, str):
        try:
            project_work_packages = json.loads(project_work_packages)
        except json.JSONDecodeError:
            raise ValueError("Invalid JSON in project_work_packages")

    # Flatten all category lists across work packages
    all_categories = [
        cat for wp in project_work_packages.get('work_packages', [])
        for cat in wp.get('category_list', {}).get('list', [])
    ]

    # Filter categories matching the given category name
    matching_categories = [cat for cat in all_categories if cat.get('name') == category]

    # Extract and flatten makes for the matched categories
    makes = [make for cat in matching_categories for make in cat.get('makes', [])]

    return makes
        

def get_user_name(id):
    nirmaan_users = frappe.db.get_list(
        'Nirmaan Users',
        fields=['name', 'full_name']
    )
    for item in nirmaan_users:
        if item['name'] == id:
            return item['full_name']
    return None


def on_trash(doc, method):
    frappe.db.delete("Nirmaan Comments", {
        "reference_name" : ("=", doc.name)
    })
    frappe.db.delete("Category BOQ Attachments", {
        "procurement_request" : ("=", doc.name)
    })
    
    print(f"flagged for delete pr document: {doc} {doc.modified_by} {doc.owner}")
    notifications = frappe.db.get_all("Nirmaan Notifications", 
                                      filters={"docname": doc.name},
                                      fields={"name", "recipient"}
                                      )

    if notifications:
        for notification in notifications:
            print(f"running delete notification event for user: {notification['recipient']} with {notification['name']}")
            message = {
            "title": _("PR Deleted"),
            "description": _(f"PR: {doc.name} has been deleted."),
            "docname": doc.name,
            "sender": frappe.session.user,
            "notificationId" : notification["name"]
            }
            frappe.publish_realtime(
                event="pr:delete",
                message=message,
                user=notification["recipient"]
            )
    frappe.db.delete("Nirmaan Notifications", {
        "docname": ("=", doc.name)
    })


def after_delete(doc, method):
    pass