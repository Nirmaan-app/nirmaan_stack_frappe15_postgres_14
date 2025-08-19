# apps/nirmaan_stack/nirmaan_stack/patches/v2_5/populate_amount_paid_for_sr_and_po.py

import frappe
from frappe.utils import flt

def execute():
    """
    Patch to populate the 'amount_paid' field for existing Service Requests and Procurement Orders
    using the Frappe ORM (frappe.get_all).
    - Service Requests: Updates records with status 'Approved'.
    - Procurement Orders: Updates records with status NOT IN ['Merged', 'Cancelled'].
    """
    print("\nStarting patch to populate 'amount_paid' for SR and PO (ORM Version)...")

    # A good practice to ensure the latest schema is loaded
    frappe.reload_doctype("Service Requests")
    frappe.reload_doctype("Procurement Orders") # Assuming this is the correct DocType name
    frappe.reload_doctype("Project Payments")

    # --- Process Service Requests ---
    process_parent_doctype(
        doctype="Service Requests",
        filters={"status": "Approved"}
    )

    # --- Process Procurement Orders ---
    process_parent_doctype(
        doctype="Procurement Orders", # Please verify this is the exact name of your PO DocType
        filters={"status": ["not in", ["Merged", "Cancelled"]]}
    )

    # --- Commit all database changes ---
    # This is crucial for the updates to be saved.
    frappe.db.commit()

    print("\nPatch completed successfully. 'amount_paid' has been updated for relevant SRs and POs.")


def process_parent_doctype(doctype, filters):
    """
    A generic helper function to fetch parent documents, calculate the sum of
    their 'Paid' payments using the ORM, and update the 'amount_paid' field.

    Args:
        doctype (str): The name of the parent DocType (e.g., "Service Requests").
        filters (dict): A dictionary of filters to apply when fetching parent documents.
    """
    print(f"\nProcessing DocType: {doctype}...")

    parent_docs = frappe.get_all(doctype, filters=filters, fields=["name"])

    if not parent_docs:
        print(f"No documents found for {doctype} with specified filters. Skipping.")
        return

    print(f"Found {len(parent_docs)} documents to update for {doctype}.")
    
    updated_count = 0
    # Loop through each parent document (SR or PO)
    for parent in parent_docs:
        
        # --- ORM-based Calculation ---
        # 1. Fetch all relevant payment amounts for THIS parent document in a single, efficient query.
        # This is the performant ORM approach, avoiding the N+1 problem.
        paid_payments = frappe.get_all(
            "Project Payments",
            filters={
                "document_type": doctype,
                "document_name": parent.name,
                "status": "Paid",
            },
            fields=["amount"]  # Fetch only the data we need.
        )

        # 2. Calculate the total in Python.
        # This is a concise and safe way to sum the amounts from the list of dictionaries
        # returned by frappe.get_all. flt() handles any non-numeric values gracefully.
        total_paid = sum(flt(p.amount) for p in paid_payments)

        # 3. Update the parent document's 'amount_paid' field directly in the DB.
        frappe.db.set_value(doctype, parent.name, "amount_paid", total_paid, update_modified=False)
        updated_count += 1
        
        # Optional: Add progress indicator for very large datasets
        if updated_count % 100 == 0:
            print(f"  ... updated {updated_count} records")

    print(f"Successfully updated 'amount_paid' for {updated_count} {doctype} documents.")