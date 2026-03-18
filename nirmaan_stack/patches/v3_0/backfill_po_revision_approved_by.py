import frappe


def execute():
    """Backfill approved_by and approval_date for existing Approved PO Revisions."""
    approved = frappe.get_all(
        "PO Revisions",
        filters={"status": "Approved"},
        fields=["name", "modified_by", "modified"],
    )
    for rev in approved:
        full_name = frappe.db.get_value("User", rev.modified_by, "full_name") or rev.modified_by
        frappe.db.set_value(
            "PO Revisions",
            rev.name,
            {"approved_by": full_name, "approval_date": rev.modified},
            update_modified=False,
        )
    if approved:
        frappe.db.commit()
