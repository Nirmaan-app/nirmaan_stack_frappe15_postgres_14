import frappe
from frappe import _

@frappe.whitelist()
def generate_all_po_invoice_data():
    """
    Generate consolidated invoice data for all APPROVED invoices in Procurement Orders.

    Returns:
        dict: {
                "message": {
                    "invoice_entries": List[InvoiceEntry],
                    "total_invoices": number,
                    "total_amount": number,
                    "total_2b_activated": number,
                    "pending_2b_activation": number
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
            - project (str, optional) (Project ID, if available on PO)
            - vendor (str) (Vendor ID)
            - vendor_name (str) (Vendor Name)
            - is_2b_activated (bool, optional)
            - reconciled_date (str, optional)
            - reconciled_by (str, optional)

    Raises:
        Exception: For unexpected errors.
    """
    try:
        # Fetch all procurement orders from the system.
        # Include 'project' field as it might be relevant for some POs.
        procurement_orders = frappe.get_all(
            "Procurement Orders",
           filters={
                "status": ("not in", [ "Merged", "Inactive", "PO Amendment"])
                },
            fields=["name", "invoice_data", "vendor", "vendor_name", "project"]
        )

        invoice_entries = []
        total_2b_activated = 0

        # Loop through each procurement order and extract invoice data.
        for po in procurement_orders:
            # Skip if there is no invoice data or if the structure is not a dict.
            if not po.get("invoice_data") or not isinstance(po.invoice_data, dict):
                continue

            # Expecting invoice_data to have a "data" key with a dictionary of invoice entries.
            invoice_data_dict = po.invoice_data.get("data", {})

            for date_str, invoice_item in invoice_data_dict.items():
                # Validate that required keys are present before adding the entry.
                if not all(key in invoice_item for key in ["invoice_no", "amount", "updated_by"]):
                    frappe.log_error(
                        _("Invalid invoice data structure in PO {0}").format(po.name),
                        "Invoice Data Validation"
                    )
                    continue

                # Only include APPROVED invoices
                status = invoice_item.get("status", "Pending")
                if status != "Approved":
                    continue

                is_2b_activated = invoice_item.get("is_2b_activated", False)

                # Count 2B activated invoices
                if is_2b_activated:
                    total_2b_activated += 1

                entry = {
                    "date": date_str,
                    "invoice_no": invoice_item["invoice_no"],
                    "amount": invoice_item["amount"],
                    "updated_by": invoice_item["updated_by"],
                    "invoice_attachment_id": invoice_item.get("invoice_attachment_id"),
                    "procurement_order": po.name,
                    "project": po.project,
                    "vendor": po.vendor,
                    "vendor_name": po.vendor_name,
                    "is_2b_activated": is_2b_activated,
                    "reconciled_date": invoice_item.get("reconciled_date"),
                    "reconciled_by": invoice_item.get("reconciled_by")
                }
                invoice_entries.append(entry)

        total_invoices = len(invoice_entries)
        formatted_invoice_entries = {
            "invoice_entries": invoice_entries,
            "total_invoices": total_invoices,
            "total_amount": sum(entry["amount"] for entry in invoice_entries),
            "total_2b_activated": total_2b_activated,
            "pending_2b_activation": total_invoices - total_2b_activated
        }

        return {"message": formatted_invoice_entries, "status": 200}

    except Exception as e:
        # Log any errors and throw a generic error message.
        frappe.log_error(
            _("Error generating all PO invoice data: {0}").format(str(e)),
            "All PO Invoice Generation Error"
        )
        frappe.throw(
            _("An error occurred while generating all PO invoice data. Please check the error logs.")
        )