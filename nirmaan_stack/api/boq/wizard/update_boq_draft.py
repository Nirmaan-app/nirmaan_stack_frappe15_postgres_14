import frappe


@frappe.whitelist(methods=["POST"])
def update_boq_draft(
    boq_name: str = None,
    boq_name_field: str = None,
    version: int = None,
    tax_treatment: str = None,
    notes: str = None,
):
    """Partial-update mutable metadata fields on a BOQs wizard-in-progress row.

    `boq_name` identifies the BOQs document (the Frappe document ID).
    `boq_name_field` sets the boq_name Data field (the human-readable title).
    """
    if not boq_name:
        frappe.throw("boq_name is required.", title="Missing field: boq_name")

    if not frappe.db.exists("BOQs", boq_name):
        frappe.throw(f"BOQs '{boq_name}' not found.", title="Not found")

    updates = {}
    if boq_name_field is not None:
        updates["boq_name"] = boq_name_field
    if version is not None:
        updates["version"] = int(version)
    if tax_treatment is not None:
        updates["tax_treatment"] = tax_treatment
    if notes is not None:
        updates["notes"] = notes

    for field, value in updates.items():
        frappe.db.set_value("BOQs", boq_name, field, value)

    frappe.db.commit()
    return {"status": "saved"}
