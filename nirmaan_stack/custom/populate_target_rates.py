import frappe
from frappe.utils import now, add_months, get_datetime
from decimal import Decimal, ROUND_HALF_UP, InvalidOperation

def populate_target_rates():
    # Step 0: Clear existing data (optional, but good for a full refresh)
    frappe.db.sql("DELETE FROM `tabSelected Quotations`")
    frappe.db.sql("DELETE FROM `tabTarget Rates`")
    frappe.db.commit() # Commit deletions before starting new inserts
    frappe.log_info("Cleared existing target rates and selected quotations.", "TargetRatePopulation")

    items = frappe.get_all("Items", fields=["name", "item_name", "unit_name"])
    admin_user = "Administrator" # Or frappe.session.user if run in a user context

    for item_doc in items:
        item_id = item_doc.name
        item_name = item_doc.item_name
        item_unit = item_doc.unit_name

        frappe.log_info(f"Processing item: {item_id} ({item_name})", "TargetRatePopulation")

        approved_quotes_raw = frappe.db.sql("""
            SELECT
                name, item_id, item_name, vendor, procurement_order, unit,
                quantity, quote, city, state, category, procurement_package, make, creation
            FROM `tabApproved Quotations`
            WHERE item_id = %s AND docstatus < 2
            ORDER BY creation DESC
        """, (item_id,), as_dict=True)

        # Filter for valid quotes (quote and quantity can be converted to Decimal and quote != 0)
        approved_quotes = []
        for q_raw in approved_quotes_raw:
            try:
                # Validate and convert quote and quantity
                q_raw.quote_val = Decimal(q_raw.quote)
                q_raw.quantity_val = Decimal(q_raw.quantity)
                if q_raw.quote_val == Decimal(0): # Explicitly check for 0 rate after conversion
                    frappe.log_info(f"Item {item_id}, Quote {q_raw.name}: Zero rate, considered invalid.", "TargetRatePopulation")
                    continue # Skip this quote
                approved_quotes.append(q_raw)
            except (InvalidOperation, TypeError, ValueError) as e:
                frappe.log_warning(f"Item {item_id}, Quote {q_raw.name}: Invalid numeric data for quote/quantity ('{q_raw.quote}', '{q_raw.quantity}'). Skipping quote. Error: {e}", "TargetRatePopulation")
                continue


        target_rate_doc = frappe.new_doc("Target Rates")
        target_rate_doc.owner = admin_user
        target_rate_doc.modified_by = admin_user
        target_rate_doc.item_id = item_id
        target_rate_doc.item_name = item_name
        target_rate_doc.unit = item_unit
        # target_rate_doc.name will be auto-generated on insert by Frappe

        # CASE 1: No valid approved quotations found
        if not approved_quotes:
            frappe.log_info(f"Item {item_id}: No valid approved quotes. Setting rate to -1.", "TargetRatePopulation")
            target_rate_doc.rate = "-1"
            try:
                target_rate_doc.insert(ignore_permissions=True, ignore_mandatory=True)
            except Exception as e:
                frappe.log_error(f"Error inserting target rate for item {item_id} (no quotes): {e}", "TargetRatePopulation")
            continue # Next item

        latest_quote = approved_quotes[0] # Most recent valid quote

        # CASE 2: Exactly one valid approved quotation found
        if len(approved_quotes) == 1:
            frappe.log_info(f"Item {item_id}: One valid approved quote. Using rate: {latest_quote.quote_val}", "TargetRatePopulation")
            target_rate_doc.rate = str(latest_quote.quote_val)
            add_selected_quotation(target_rate_doc, latest_quote)
            try:
                target_rate_doc.insert(ignore_permissions=True, ignore_mandatory=True)
            except Exception as e:
                frappe.log_error(f"Error inserting target rate for item {item_id} (one quote): {e}", "TargetRatePopulation")
            continue # Next item

        # CASE 3: More than one valid approved quotation
        if len(approved_quotes) > 1:
            frappe.log_info(f"Item {item_id}: {len(approved_quotes)} valid approved quotes. Checking 3-month filter.", "TargetRatePopulation")
            three_months_ago = add_months(now(), -3)
            
            recent_quotes = []
            for q in approved_quotes:
                if get_datetime(q.creation) >= get_datetime(three_months_ago):
                    # Further ensure quantity is positive for averaging
                    if q.quantity_val > Decimal(0):
                         recent_quotes.append(q)
                    else:
                        frappe.log_info(f"Item {item_id}, Quote {q.name}: Recent quote has non-positive quantity '{q.quantity}'. Excluding from average.", "TargetRatePopulation")
            
            # Sub-case 3a: Filtered result (recent_quotes) contains 0 quotes
            if not recent_quotes:
                frappe.log_info(f"Item {item_id}: No valid quotes in last 3 months. Using latest overall valid quote rate: {latest_quote.quote_val}", "TargetRatePopulation")
                target_rate_doc.rate = str(latest_quote.quote_val)
                add_selected_quotation(target_rate_doc, latest_quote)
            
            # Sub-case 3b: Filtered result contains 1 recent quote
            elif len(recent_quotes) == 1:
                single_recent_quote = recent_quotes[0]
                frappe.log_info(f"Item {item_id}: One valid quote in last 3 months. Using rate: {single_recent_quote.quote_val}", "TargetRatePopulation")
                target_rate_doc.rate = str(single_recent_quote.quote_val)
                add_selected_quotation(target_rate_doc, single_recent_quote)

            # Sub-case 3c: More than one recent quote available
            else: # len(recent_quotes) > 1
                frappe.log_info(f"Item {item_id}: {len(recent_quotes)} valid quotes in last 3 months. Calculating average.", "TargetRatePopulation")
                total_value = Decimal(0)
                total_quantity = Decimal(0)
                quotes_for_average = []

                for q_avg in recent_quotes: # recent_quotes already filtered for quantity_val > 0
                    total_value += q_avg.quote_val * q_avg.quantity_val
                    total_quantity += q_avg.quantity_val
                    quotes_for_average.append(q_avg)
                
                if total_quantity > 0:
                    avg_rate_val = (total_value / total_quantity).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
                    target_rate_doc.rate = str(avg_rate_val)
                    frappe.log_info(f"Item {item_id}: Calculated average rate: {avg_rate_val}", "TargetRatePopulation")
                    for sq in quotes_for_average:
                        add_selected_quotation(target_rate_doc, sq)
                else:
                    # This case should ideally not be hit if recent_quotes are pre-filtered for quantity > 0
                    # But as a fallback, use the latest overall valid quote.
                    frappe.log_warning(f"Item {item_id}: Total quantity for average was zero. Fallback to latest overall valid quote rate: {latest_quote.quote_val}", "TargetRatePopulation")
                    target_rate_doc.rate = str(latest_quote.quote_val)
                    add_selected_quotation(target_rate_doc, latest_quote)
            
            try:
                target_rate_doc.insert(ignore_permissions=True, ignore_mandatory=True)
            except Exception as e:
                frappe.log_error(f"Error inserting target rate for item {item_id} (multiple quotes logic): {e}", "TargetRatePopulation")

    frappe.db.commit()
    frappe.log_info("Target Rate population process finished.", "TargetRatePopulation")

def add_selected_quotation(target_rate_doc, approved_quote_dict):
    sq = target_rate_doc.append("selected_quotations", {}) # Assuming 'selected_quotations' is the child table fieldname
    sq.item_id = approved_quote_dict.item_id
    sq.item_name = approved_quote_dict.item_name
    sq.vendor_name = approved_quote_dict.vendor
    sq.procurement_order = approved_quote_dict.procurement_order
    sq.unit = approved_quote_dict.unit
    sq.quantity = str(approved_quote_dict.quantity_val) # Store original or converted string
    sq.quote = str(approved_quote_dict.quote_val)       # Store original or converted string
    sq.city = approved_quote_dict.city
    sq.state = approved_quote_dict.state
    sq.category = approved_quote_dict.category
    sq.procurement_package = approved_quote_dict.procurement_package
    sq.make = approved_quote_dict.make
    # Frappe ORM handles name, parent, parenttype, parentfield, idx, creation, modified etc for child docs

# To run this (e.g., from bench console or a server script):
# populate_target_rates()
# frappe.db.commit() # if not run via scheduler which might auto-commit