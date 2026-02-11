"""
Migration patch to convert Nirmaan Attachments (DC/MIR type) to PO Delivery Documents.

This patch:
1. Queries Nirmaan Attachments where attachment_type is 'po delivery challan' or
   'material inspection report' AND associated_doctype = 'Procurement Orders'
2. Creates stub PO Delivery Documents records (no items, is_stub=1)
3. Preserves original timestamps for historical accuracy
4. Does NOT modify or delete original Nirmaan Attachments records

Note: Stub records can be updated later via the UI to add item-level data.
"""

import frappe
from frappe import _


def execute():
    """Migrate DC/MIR attachments to PO Delivery Documents doctype."""
    print("\n" + "=" * 60)
    print("DC/MIR TO PO DELIVERY DOCUMENTS MIGRATION")
    print("=" * 60)

    existing_count = frappe.db.count("PO Delivery Documents")
    print(f"\nExisting PO Delivery Documents: {existing_count}")

    stats = {
        "processed": 0,
        "created": 0,
        "skipped": 0,
        "errors": 0,
    }

    # Query all DC/MIR attachments for Procurement Orders
    attachments = frappe.db.sql(
        """
        SELECT
            name, project, attachment, attachment_type,
            associated_docname, attachment_link_docname,
            attachment_ref, creation, owner
        FROM "tabNirmaan Attachments"
        WHERE attachment_type IN ('po delivery challan', 'material inspection report')
        AND associated_doctype = 'Procurement Orders'
        ORDER BY creation ASC
        """,
        as_dict=True,
    )

    print(f"Found {len(attachments)} DC/MIR attachments to migrate")

    for att in attachments:
        stats["processed"] += 1
        try:
            # Idempotency check: skip if already migrated
            existing = frappe.db.exists(
                "PO Delivery Documents",
                {"nirmaan_attachment": att.name},
            )
            if existing:
                stats["skipped"] += 1
                continue

            # Map attachment_type to PO Delivery Documents type
            dc_type = (
                "Delivery Challan"
                if att.attachment_type == "po delivery challan"
                else "Material Inspection Report"
            )

            # Create stub record
            doc = frappe.new_doc("PO Delivery Documents")
            doc.update(
                {
                    "procurement_order": att.associated_docname,
                    "project": att.project,
                    "vendor": att.attachment_link_docname,
                    "type": dc_type,
                    "nirmaan_attachment": att.name,
                    "reference_number": att.attachment_ref,
                    "dc_date": str(att.creation)[:10] if att.creation else None,
                    "is_signed_by_client": 0,
                    "is_stub": 1,
                }
            )

            doc.flags.ignore_permissions = True
            doc.flags.ignore_mandatory = True
            doc.insert()

            # Preserve original creation timestamp
            if att.creation:
                frappe.db.set_value(
                    "PO Delivery Documents",
                    doc.name,
                    {
                        "creation": att.creation,
                        "modified": att.creation,
                        "owner": att.owner,
                    },
                    update_modified=False,
                )

            stats["created"] += 1

        except Exception as e:
            stats["errors"] += 1
            frappe.log_error(
                title="DC/MIR Migration Error",
                message=f"Failed to migrate attachment {att.name}: {str(e)}\n{frappe.get_traceback()}",
            )

    frappe.db.commit()

    final_count = frappe.db.count("PO Delivery Documents")

    print("\n" + "-" * 60)
    print("MIGRATION SUMMARY")
    print("-" * 60)
    print(f"  Attachments processed:      {stats['processed']}")
    print(f"  PO Delivery Docs created:   {stats['created']}")
    print(f"  Skipped (already migrated): {stats['skipped']}")
    print(f"  Errors:                     {stats['errors']}")
    print(f"\n  Total PO Delivery Docs:     {existing_count} -> {final_count} (+{final_count - existing_count})")
    print("=" * 60 + "\n")

    frappe.logger().info(
        f"DC/MIR migration: created={stats['created']}, "
        f"skipped={stats['skipped']}, errors={stats['errors']}"
    )
