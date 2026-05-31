import json

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


@frappe.whitelist(methods=["POST"])
def set_sheet_config(boq_name: str = None, sheet_name: str = None, sheet_config=None):
    """Write the per-sheet parser config JSON blob to a BoQ Sheet Draft child row.

    sheet_config may be a dict or a JSON-encoded string; both are accepted.
    Stores the config as a JSON string in the sheet_config field.
    To clear the config, pass sheet_config={} or sheet_config='{}' .
    URL: /api/method/nirmaan_stack.api.boq.wizard.update_sheet_draft.set_sheet_config
    """
    if not boq_name:
        frappe.throw("boq_name is required.", title="Missing field: boq_name")
    if not sheet_name:
        frappe.throw("sheet_name is required.", title="Missing field: sheet_name")
    if sheet_config is None:
        frappe.throw("sheet_config is required.", title="Missing field: sheet_config")

    if not frappe.db.exists("BOQs", boq_name):
        frappe.throw(f"BOQs '{boq_name}' not found.", title="Not found")

    # Normalize: accept dict or JSON string; validate JSON string if string
    if isinstance(sheet_config, dict):
        config_str = json.dumps(sheet_config)
    else:
        try:
            json.loads(sheet_config)
        except (ValueError, TypeError):
            frappe.throw(
                "sheet_config must be a valid JSON string or object.",
                title="Invalid JSON",
            )
        config_str = sheet_config

    child_name = _get_child_name(boq_name, sheet_name)
    if not child_name:
        frappe.throw(
            f"Sheet '{sheet_name}' not found in BOQs '{boq_name}'.",
            title="Sheet not found",
        )

    frappe.db.set_value("BoQ Sheet Draft", child_name, "sheet_config", config_str)
    frappe.db.commit()
    return {"status": "saved"}


@frappe.whitelist(methods=["POST"])
def set_sheet_work_packages(boq_name: str = None, sheet_name: str = None, work_headers=None):
    """Set the work-package assignments for a BoQ Sheet Draft child row.

    work_headers is a list of Work Headers docnames (or a JSON-encoded string
    representing such a list). Replace-all semantics: existing assignments are
    cleared and replaced by the new list. An empty list clears all assignments.

    Validation: every docname in work_headers must exist in Work Headers. If any
    one does not, the entire call is rejected and NO write is performed.
    URL: /api/method/nirmaan_stack.api.boq.wizard.update_sheet_draft.set_sheet_work_packages
    """
    if not boq_name:
        frappe.throw("boq_name is required.", title="Missing field: boq_name")
    if not sheet_name:
        frappe.throw("sheet_name is required.", title="Missing field: sheet_name")
    if work_headers is None:
        frappe.throw("work_headers is required.", title="Missing field: work_headers")

    if not frappe.db.exists("BOQs", boq_name):
        frappe.throw(f"BOQs '{boq_name}' not found.", title="Not found")

    # Normalize: accept JSON string or list
    if isinstance(work_headers, str):
        try:
            work_headers = json.loads(work_headers)
        except (ValueError, TypeError):
            frappe.throw(
                "work_headers must be a JSON array string or a list.",
                title="Invalid JSON",
            )
    if not isinstance(work_headers, list):
        frappe.throw("work_headers must be a list.", title="Invalid type")

    # Validate ALL docnames before any write (no partial write)
    for wh_name in work_headers:
        if not frappe.db.exists("Work Headers", wh_name):
            frappe.throw(
                f"Work Headers '{wh_name}' not found. No changes were made.",
                title="Not found",
            )

    child_name = _get_child_name(boq_name, sheet_name)
    if not child_name:
        frappe.throw(
            f"Sheet '{sheet_name}' not found in BOQs '{boq_name}'.",
            title="Sheet not found",
        )

    # Replace-all: clear existing, insert new
    frappe.db.delete("BoQ Sheet Work Package", {
        "parent": child_name,
        "parenttype": "BoQ Sheet Draft",
    })
    for wh_name in work_headers:
        pkg = frappe.new_doc("BoQ Sheet Work Package")
        pkg.parent = child_name
        pkg.parenttype = "BoQ Sheet Draft"
        pkg.parentfield = "work_packages"
        pkg.work_header = wh_name
        pkg.insert(ignore_permissions=True)

    frappe.db.commit()
    return {"status": "saved"}
