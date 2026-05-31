import frappe

# Statuses settable directly via set_sheet_status.
# "General specs" is intentionally excluded -- use set_general_specs_sheet instead.
_DIRECT_SET_STATUSES = frozenset({
    "Pending",
    "Hidden",
    "Reviewed",
    "Skip",
    "Parse failed",
})


def _get_child_name(boq_name: str, sheet_name: str) -> str | None:
    """Return the BoQ Sheet Draft row name for (boq_name, sheet_name), or None."""
    return frappe.db.get_value(
        "BoQ Sheet Draft",
        {"parent": boq_name, "parenttype": "BOQs", "sheet_name": sheet_name},
        "name",
    )


@frappe.whitelist(methods=["POST"])
def set_sheet_status(boq_name: str = None, sheet_name: str = None, status: str = None):
    """Set wizard_status on a sheet-draft child row.

    Allowed values: Pending, Hidden, Reviewed, Skip, Parse failed.
    'General specs' cannot be set directly -- use set_general_specs_sheet; the
    backend stores a pointer on BOQs.general_specs_sheet and the frontend derives
    the displayed badge from it.
    """
    if not boq_name:
        frappe.throw("boq_name is required.", title="Missing field: boq_name")
    if not sheet_name:
        frappe.throw("sheet_name is required.", title="Missing field: sheet_name")
    if not status:
        frappe.throw("status is required.", title="Missing field: status")

    if not frappe.db.exists("BOQs", boq_name):
        frappe.throw(f"BOQs '{boq_name}' not found.", title="Not found")

    if status == "General specs":
        frappe.throw(
            "Use the set_general_specs_sheet endpoint to designate a sheet as"
            " General specs. The backend stores a pointer on BOQs.general_specs_sheet;"
            " the frontend derives the badge.",
            title="Use set_general_specs_sheet",
        )

    if status not in _DIRECT_SET_STATUSES:
        allowed = ", ".join(sorted(_DIRECT_SET_STATUSES))
        frappe.throw(
            f"Invalid status '{status}'. Allowed via this endpoint: {allowed}.",
            title="Invalid status",
        )

    child_name = _get_child_name(boq_name, sheet_name)
    if not child_name:
        frappe.throw(
            f"Sheet '{sheet_name}' not found in BOQs '{boq_name}'.",
            title="Sheet not found",
        )

    frappe.db.set_value("BoQ Sheet Draft", child_name, "wizard_status", status)
    frappe.db.commit()
    return {"status": "saved"}


@frappe.whitelist(methods=["POST"])
def set_sheet_label(boq_name: str = None, sheet_name: str = None, label: str = None):
    """Set or clear the optional sheet_label on a sheet-draft child row.

    Pass label=None or label='' to clear. No parser coupling.
    """
    if not boq_name:
        frappe.throw("boq_name is required.", title="Missing field: boq_name")
    if not sheet_name:
        frappe.throw("sheet_name is required.", title="Missing field: sheet_name")

    if not frappe.db.exists("BOQs", boq_name):
        frappe.throw(f"BOQs '{boq_name}' not found.", title="Not found")

    child_name = _get_child_name(boq_name, sheet_name)
    if not child_name:
        frappe.throw(
            f"Sheet '{sheet_name}' not found in BOQs '{boq_name}'.",
            title="Sheet not found",
        )

    frappe.db.set_value("BoQ Sheet Draft", child_name, "sheet_label", label or "")
    frappe.db.commit()
    return {"status": "saved"}


@frappe.whitelist(methods=["POST"])
def set_general_specs_sheet(boq_name: str = None, sheet_name_or_none: str = None):
    """Set or clear the general_specs_sheet pointer on a BOQs row.

    Division of responsibility:
    - Backend: stores the sheet name string on BOQs.general_specs_sheet.
    - Frontend: derives the 'General specs' display badge for the designated
      sheet card; handles warn-and-confirm (M2.23) before calling this endpoint.
    - Backend does NOT touch wizard_status on any BoQ Sheet Draft row.
    When cleared (None or ''), the frontend is responsible for reverting the
    released sheet's card display to Pending.
    """
    if not boq_name:
        frappe.throw("boq_name is required.", title="Missing field: boq_name")

    if not frappe.db.exists("BOQs", boq_name):
        frappe.throw(f"BOQs '{boq_name}' not found.", title="Not found")

    target = sheet_name_or_none or None
    if target:
        child_name = _get_child_name(boq_name, target)
        if not child_name:
            frappe.throw(
                f"Sheet '{target}' not found in BOQs '{boq_name}'.",
                title="Sheet not found",
            )

    frappe.db.set_value("BOQs", boq_name, "general_specs_sheet", target or "")
    frappe.db.commit()
    return {"status": "saved"}
