import frappe
from frappe.utils import cint

from nirmaan_stack.api.boq.wizard import directional_guard


@frappe.whitelist(methods=["POST"])
def update_boq_draft(
    boq_name: str = None,
    boq_name_field: str = None,
    version: int = None,
    tax_treatment: str = None,
    notes: str = None,
    confirm_orphan=None,
):
    """Partial-update mutable metadata fields on a BOQs wizard-in-progress row.

    `boq_name` identifies the BOQs document (the Frappe document ID).
    `boq_name_field` sets the boq_name Data field (the human-readable title).
    """
    if not boq_name:
        frappe.throw("boq_name is required.", title="Missing field: boq_name")

    if not frappe.db.exists("BOQs", boq_name):
        frappe.throw(f"BOQs '{boq_name}' not found.", title="Not found")

    # C0 / ADR-0011 directional guard (D18, per-BoQ): version / tax_treatment are BoQ-ROOT metadata
    # that every committed sheet snapshotted, so changing them desyncs downstream pricing across the
    # WHOLE BoQ -- WITHOUT going through commit (the one non-redundant directional vector). Guard when
    # a MATERIAL field actually CHANGES + the BoQ has priced work, unless confirm_orphan. Cosmetic
    # fields (boq_name title, notes) never guard. WRITES NOTHING on reject.
    if not directional_guard._truthy(confirm_orphan):
        material_change = (
            (version is not None
                and int(version) != cint(frappe.db.get_value("BOQs", boq_name, "version")))
            or (tax_treatment is not None
                and tax_treatment != frappe.db.get_value("BOQs", boq_name, "tax_treatment"))
        )
        if material_change:
            n = directional_guard.boq_downstream_priced_count(boq_name)
            if n:
                # Amendment A1: name any Live pricers across the BoQ.
                live = directional_guard.boq_live_pricing_holders(boq_name)
                live_clause = ""
                if live:
                    who = "; ".join(f"{name} on '{s}'" for s, name in live)
                    live_clause = f" Live now: {who}."
                frappe.throw(
                    f"{directional_guard.ORPHAN_MARKER}: this BoQ has {n} priced cell(s) across its "
                    f"committed sheets.{live_clause} Changing the version / tax treatment desyncs "
                    f"their pricing basis. Confirm to proceed.",
                    title="This affects priced sheets",
                )

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
