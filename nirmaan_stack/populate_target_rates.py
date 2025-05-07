import frappe
from frappe.utils import now, add_months, get_datetime
from decimal import Decimal, ROUND_HALF_UP, InvalidOperation

# ... (your add_selected_quotation function if it's in the same file) ...
# def add_selected_quotation(target_rate_doc, approved_quote_dict):
#    # ... your implementation ...

@frappe.whitelist() # <--- ADD THIS DECORATOR
def populate_target_rates():
    try:
        # Step 0: Clear existing data (optional, but good for a full refresh)
        frappe.db.sql("DELETE FROM `tabSelected Quotations`")
        frappe.db.sql("DELETE FROM `tabTarget Rates`")
        # frappe.db.commit() # Commit deletions if you want them separate.
                           # Otherwise, the final commit will handle it.

        print("Cleared existing target rates and selected quotations.", "TargetRatePopulation")

        items = frappe.get_all("Items", fields=["name", "item_name", "unit_name"])
        admin_user = "Administrator"

        for item_doc in items:
            item_id = item_doc.name
            item_name = item_doc.item_name
            item_unit = item_doc.unit_name

            print(f"Processing item: {item_id} ({item_name})", "TargetRatePopulation")

            approved_quotes_raw = frappe.db.sql("""
                SELECT
                    name, item_id, item_name, vendor, procurement_order, unit,
                    quantity, quote, city, state, category, procurement_package, make, creation
                FROM `tabApproved Quotations`
                WHERE item_id = %s
                ORDER BY creation DESC
            """, (item_id,), as_dict=True)

            approved_quotes = []
            for q_raw in approved_quotes_raw:
                try:
                    q_raw.quote_val = Decimal(q_raw.quote)
                    q_raw.quantity_val = Decimal(q_raw.quantity)
                    if q_raw.quote_val <= Decimal(0):
                        print(f"Item {item_id}, Quote {q_raw.name}: Zero or negative rate, considered invalid.", "TargetRatePopulation")
                        continue
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

            if not approved_quotes:
                print(f"Item {item_id}: No valid approved quotes. Setting rate to -1.", "TargetRatePopulation")
                target_rate_doc.rate = "-1"
                try:
                    target_rate_doc.insert(ignore_permissions=True, ignore_mandatory=True)
                except Exception as e:
                    frappe.log_error(f"Error inserting target rate for item {item_id} (no quotes): {e}", "TargetRatePopulation")
                continue

            latest_quote = approved_quotes[0]

            if len(approved_quotes) == 1:
                print(f"Item {item_id}: One valid approved quote. Using rate: {latest_quote.quote_val}", "TargetRatePopulation")
                target_rate_doc.rate = str(latest_quote.quote_val)
                add_selected_quotation(target_rate_doc, latest_quote) # Ensure this function is defined or imported
                try:
                    target_rate_doc.insert(ignore_permissions=True, ignore_mandatory=True)
                except Exception as e:
                    frappe.log_error(f"Error inserting target rate for item {item_id} (one quote): {e}", "TargetRatePopulation")
                continue

            if len(approved_quotes) > 1:
                print(f"Item {item_id}: {len(approved_quotes)} valid approved quotes. Checking 3-month filter.", "TargetRatePopulation")
                three_months_ago = add_months(now(), -3)

                recent_quotes = []
                for q in approved_quotes:
                    if get_datetime(q.creation) >= get_datetime(three_months_ago):
                        if q.quantity_val > Decimal(0):
                             recent_quotes.append(q)
                        else:
                            print(f"Item {item_id}, Quote {q.name}: Recent quote has non-positive quantity '{q.quantity}'. Excluding from average.", "TargetRatePopulation")

                if not recent_quotes:
                    print(f"Item {item_id}: No valid quotes in last 3 months. Using latest overall valid quote rate: {latest_quote.quote_val}", "TargetRatePopulation")
                    target_rate_doc.rate = str(latest_quote.quote_val)
                    add_selected_quotation(target_rate_doc, latest_quote)
                elif len(recent_quotes) == 1:
                    single_recent_quote = recent_quotes[0]
                    print(f"Item {item_id}: One valid quote in last 3 months. Using rate: {single_recent_quote.quote_val}", "TargetRatePopulation")
                    target_rate_doc.rate = str(single_recent_quote.quote_val)
                    add_selected_quotation(target_rate_doc, single_recent_quote)
                else:
                    print(f"Item {item_id}: {len(recent_quotes)} valid quotes in last 3 months. Calculating average.", "TargetRatePopulation")
                    total_value = Decimal(0)
                    total_quantity = Decimal(0)
                    quotes_for_average = []

                    for q_avg in recent_quotes:
                        total_value += q_avg.quote_val * q_avg.quantity_val
                        total_quantity += q_avg.quantity_val
                        quotes_for_average.append(q_avg)

                    if total_quantity > 0:
                        avg_rate_val = (total_value / total_quantity).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
                        target_rate_doc.rate = str(avg_rate_val)
                        print(f"Item {item_id}: Calculated average rate: {avg_rate_val}", "TargetRatePopulation")
                        for sq in quotes_for_average:
                            add_selected_quotation(target_rate_doc, sq)
                    else:
                        frappe.log_warning(f"Item {item_id}: Total quantity for average was zero. Fallback to latest overall valid quote rate: {latest_quote.quote_val}", "TargetRatePopulation")
                        target_rate_doc.rate = str(latest_quote.quote_val)
                        add_selected_quotation(target_rate_doc, latest_quote)
                try:
                    target_rate_doc.insert(ignore_permissions=True, ignore_mandatory=True)
                except Exception as e:
                    frappe.log_error(f"Error inserting target rate for item {item_id} (multiple quotes logic): {e}", "TargetRatePopulation")

        frappe.db.commit()
        print("Target Rate population process finished.", "TargetRatePopulation")
        return {"status": "success", "message": "Target Rates and Selected Quotations repopulated successfully."}
    except Exception as e:
        frappe.db.rollback() # Rollback in case of error
        frappe.log_error(frappe.get_traceback(), "PopulateTargetRatesError")
        # Return a dictionary so client can parse it, or frappe.throw
        return {"status": "error", "message": f"An error occurred: {str(e)}"}


def add_selected_quotation(target_rate_doc, approved_quote_dict):
    # Ensure 'selected_quotations' is the actual child table fieldname in 'Target Rates' DocType
    sq = target_rate_doc.append("selected_quotations", {})
    sq.item_id = approved_quote_dict.item_id
    sq.item_name = approved_quote_dict.item_name
    sq.vendor_name = approved_quote_dict.vendor
    sq.procurement_order = approved_quote_dict.procurement_order
    sq.unit = approved_quote_dict.unit
    sq.quantity = str(approved_quote_dict.quantity_val)
    sq.quote = str(approved_quote_dict.quote_val)
    sq.city = approved_quote_dict.city
    sq.state = approved_quote_dict.state
    sq.category = approved_quote_dict.category
    sq.procurement_package = approved_quote_dict.procurement_package
    sq.make = approved_quote_dict.make