import frappe
from frappe import _
from frappe.utils.caching import redis_cache

@frappe.whitelist()
@redis_cache(shared=True)
def generate_project_wise_invoice_data(project_id: str):
    """
    Generate consolidated invoice data for all Procurement Orders in a project.
    
    Args:
        project_id (str): The ID of the project for which invoice data is to be generated.
        
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
            - procurement_order (str) (PO ID)
            - vendor (str) (Vendor ID)
            - vendor_name (str) (Vendor Name)
            
    Raises:
        frappe.DoesNotExistError: If the project is not found.
        Exception: For other unexpected errors.
    """
    try:
        # Validate project existence; if not found, throw a DoesNotExistError.
        if not frappe.db.exists("Projects", project_id):
            frappe.throw(_("Project {0} not found").format(project_id), frappe.DoesNotExistError)

        # Fetch all procurement orders for the given project.
        procurement_orders = frappe.get_all(
            "Procurement Orders",
            filters={
                "project": project_id,
                "status": ("not in", [ "Merged", "Inactive", "PO Amendment"])
                },
            fields=["name", "invoice_data", "vendor", "vendor_name"]
        )

        invoice_entries = []

        # Loop through each procurement order and extract invoice data.
        for po in procurement_orders:
            # Skip if there is no invoice data or if the structure is not a dict.
            if not po.get("invoice_data") or not isinstance(po.invoice_data, dict):
                continue

            # Expecting invoice_data to have a "data" key with a dictionary of invoice entries.
            invoice_data = po.invoice_data.get("data", {})

            for date_str, invoice_item in invoice_data.items():
                # Validate that required keys are present before adding the entry.
                if not all(key in invoice_item for key in ["invoice_no", "amount", "updated_by"]):
                    frappe.log_error(
                        _("Invalid invoice data structure in PO {0}").format(po.name),
                        "Invoice Data Validation"
                    )
                    continue

                entry = {
                    "date": date_str,
                    "invoice_no": invoice_item["invoice_no"],
                    "amount": invoice_item["amount"],
                    "updated_by": invoice_item["updated_by"],
                    "invoice_attachment_id": invoice_item.get("invoice_attachment_id"),
                    "procurement_order": po.name,
                    "vendor": po.vendor,
                    "vendor_name": po.vendor_name
                }
                invoice_entries.append(entry)

        formatted_invoice_entries = {
            # "invoice_entries": sorted(invoice_entries, key=lambda x: x["date"]),
            "invoice_entries": invoice_entries,  # Optionally sort if needed
            "total_invoices": len(invoice_entries),
            "total_amount": sum(entry["amount"] for entry in invoice_entries)
        }

        return {"message": formatted_invoice_entries, "status": 200}

    except frappe.DoesNotExistError as e:
        # If project is not found, throw error without http_status_code keyword.
        frappe.throw(
            _("Project not found: {0}").format(project_id),
            frappe.DoesNotExistError
        )
    except Exception as e:
        # Log any other errors and throw a generic error message.
        frappe.log_error(
            _("Error generating invoice data for project {0}: {1}").format(project_id, str(e)),
            "Invoice Generation Error"
        )
        frappe.throw(
            _("An error occurred while generating invoice data. Please check the error logs.")
        )
