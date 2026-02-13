"""
Patch: migrate_payment_terms_to_json

Migrates existing plain-text customer_po_payment_terms values in the
Customer Po Child Table to the new structured JSON format.

For any record that has a non-empty, non-JSON value in customer_po_payment_terms,
the patch converts it to:
    [{"label": "Payment", "percentage": 100, "description": "<original text>"}]

Safe to re-run: Yes (idempotent — skips records that are already valid JSON arrays
or that have empty/null values).
"""

import json
import frappe


def execute():
    """
    Convert legacy plain-text customer_po_payment_terms to structured JSON.
    """

    # Fetch ALL child table rows (including NULL/empty payment_terms)
    records = frappe.db.sql(
        """
        SELECT name, parent, customer_po_payment_terms
        FROM `tabCustomer PO Child Table`
        """,
        as_dict=True
    )

    if not records:
        print("No customer_po_payment_terms records found. Nothing to migrate.")
        return

    migrated = 0
    skipped = 0
    migrated_projects = []
    skipped_projects = []

    for rec in records:
        raw = (rec.get("customer_po_payment_terms") or "").strip()

        # Check if it's already valid JSON array — skip if so
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, list):
                skipped += 1
                skipped_projects.append(rec.get("parent", "unknown"))
                continue
        except (json.JSONDecodeError, TypeError):
            pass  # Not JSON — needs migration

        # Convert plain text to structured JSON
        new_value = json.dumps([{
            "label": "payment",
            "percentage": 100,
            "description": raw
        }])

        # Use raw SQL to avoid updating modified on child or parent
        frappe.db.sql(
            """
            UPDATE `tabCustomer PO Child Table`
            SET customer_po_payment_terms = %s
            WHERE name = %s
            """,
            (new_value, rec["name"])
        )
        migrated += 1
        migrated_projects.append(rec.get("parent", "unknown"))

    frappe.db.commit()

    print(f"Payment terms migration complete:")
    print(f"  - Migrated: {migrated} record(s) — Projects: {', '.join(set(migrated_projects)) if migrated_projects else 'none'}")
    print(f"  - Skipped: {skipped} record(s) — Projects: {', '.join(set(skipped_projects)) if skipped_projects else 'none'}")
