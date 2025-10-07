import frappe
from frappe import _
from frappe.utils.caching import redis_cache

@frappe.whitelist()
@redis_cache(shared=True)
def generate_all_sr_invoice_data():
    """
    Generate consolidated invoice data for all Service Receipts in the system.
    
    Returns:
        dict: {
                "message": {
                    "invoice_entries": List[InvoiceEntry],
                    "total_invoices": number,
                    "total_amount": number
                 },
                 "status": 200
              }
        where InvoiceEntry includes:
            - invoice_no (str)
            - amount (number)
            - invoice_attachment_id (str, optional)
            - updated_by (str)
            - date (str)  (The key from each invoice_data object)
            - service_receipt (str) (SR ID)
            - project (str, optional) (Project ID, if available on SR)
            - vendor (str) (Vendor ID)
            - vendor_name (str) (Vendor Name)
            
    Raises:
        Exception: For unexpected errors.
    """
    try:
        # Fetch all Service Receipts from the system.
        # Include 'project', 'vendor', 'vendor_name' fields.
        service_receipts = frappe.get_all(
            "Service Requests", # Assuming the DocType name for Service Receipts
            filters={}, # No filters applied, fetches all
            fields=["name", "invoice_data", "vendor", "project"]
        )

        invoice_entries = []

        # Loop through each service receipt and extract invoice data.
        for sr in service_receipts:
            # Skip if there is no invoice data or if the structure is not a dict.
            if not sr.get("invoice_data") or not isinstance(sr.invoice_data, dict):
                continue

            # Expecting invoice_data to have a "data" key with a dictionary of invoice entries.
            invoice_data_dict = sr.invoice_data.get("data", {})

            for date_str, invoice_item in invoice_data_dict.items():
                # Validate that required keys are present before adding the entry.
                if not all(key in invoice_item for key in ["invoice_no", "amount", "updated_by"]):
                    frappe.log_error(
                        _("Invalid invoice data structure in Service Receipt {0}").format(sr.name),
                        "Service Receipt Invoice Data Validation"
                    )
                    continue

                entry = {
                    "date": date_str,
                    "invoice_no": invoice_item["invoice_no"],
                    "amount": invoice_item["amount"],
                    "updated_by": invoice_item["updated_by"],
                    "invoice_attachment_id": invoice_item.get("invoice_attachment_id"),
                    "service_request": sr.name, # Use 'service_receipt' as the key for SR ID
                    "project": sr.project,
                    "vendor": sr.vendor,
                    "vendor_name": sr.vendor_name
                }
                invoice_entries.append(entry)

        formatted_invoice_entries = {
            "invoice_entries": invoice_entries,
            "total_invoices": len(invoice_entries),
            "total_amount": sum(entry["amount"] for entry in invoice_entries)
        }

        return {"message": formatted_invoice_entries, "status": 200}

    except Exception as e:
        # Log any errors and throw a generic error message.
        frappe.log_error(
            _("Error generating all SR invoice data: {0}").format(str(e)),
            "All SR Invoice Generation Error"
        )
        frappe.throw(
            _("An error occurred while generating all SR invoice data. Please check the error logs.")
        )