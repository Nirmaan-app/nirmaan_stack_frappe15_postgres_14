import json

import frappe

# Statuses settable directly via set_sheet_status.
# "General specs" is intentionally excluded -- use set_general_specs_sheet instead.
_DIRECT_SET_STATUSES = frozenset({
    "Pending",
    "Hidden",
    "Config Done",
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


def _guard_sheet_not_parsing(boq_name: str, sheet_name: str) -> None:
    """Block any write to a sheet whose parse is in flight (#164 A3-backend).

    Reads parse_in_progress on the matching BoQ Sheet Draft child row; throws iff
    it is 1. A missing draft row -> get_value None -> pass-through (safe).
    sheet_name matched VERBATIM (#152).

    Canonical home is this leaf module: review_screen.py imports it (review_screen
    already imports from here, and this module must NOT import review_screen --
    that would be a circular import). The frontend parse-lock is the first line of
    defence; this guard is the durable backstop.
    """
    in_progress = frappe.db.get_value(
        "BoQ Sheet Draft",
        {"parent": boq_name, "parenttype": "BOQs", "sheet_name": sheet_name},
        "parse_in_progress",
    )
    if int(in_progress or 0) == 1:
        frappe.throw(
            "This sheet is being parsed. Wait for the parse to finish.",
            title="Parse in progress",
        )


def _guard_sheet_not_finalized(boq_name: str, sheet_name: str) -> None:
    """Block any config write to a Finalized sheet (A1 config freeze).

    Throws iff the draft's wizard_status == "Finalized". A missing draft row ->
    get_value None -> pass-through (safe). sheet_name matched VERBATIM (#152).
    The frontend offers an "Un-mark and edit" affordance (SheetConfigPanel) that
    calls unmark_sheet_parsed_check_done to lift the freeze; this is the backend
    backstop. Called in all five config writers, AFTER _guard_sheet_not_parsing.
    """
    status = frappe.db.get_value(
        "BoQ Sheet Draft",
        {"parent": boq_name, "parenttype": "BOQs", "sheet_name": sheet_name},
        "wizard_status",
    )
    if status == "Finalized":
        frappe.throw(
            "This sheet is Finalized and locked. Un-mark it from the sheet's "
            "config screen or review screen to make changes.",
            title="Sheet is Finalized",
        )


@frappe.whitelist(methods=["POST"])
def set_sheet_status(boq_name: str = None, sheet_name: str = None, status: str = None):
    """Set wizard_status on a sheet-draft child row.

    Allowed values: Pending, Hidden, Config Done, Skip, Parse failed.
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

    # #164: reject writes to a sheet whose parse is in flight.
    _guard_sheet_not_parsing(boq_name, sheet_name)
    # A1: reject config writes to a Finalized sheet (un-mark to edit).
    _guard_sheet_not_finalized(boq_name, sheet_name)

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

    # #164: reject writes to a sheet whose parse is in flight.
    _guard_sheet_not_parsing(boq_name, sheet_name)
    # A1: reject config writes to a Finalized sheet (un-mark to edit).
    _guard_sheet_not_finalized(boq_name, sheet_name)

    frappe.db.set_value("BoQ Sheet Draft", child_name, "sheet_label", label or "")
    frappe.db.commit()
    return {"status": "saved"}


@frappe.whitelist(methods=["POST"])
def set_general_specs_sheet(boq_name: str = None, sheet_names=None):
    """Designate a set of sheets as general-specifications sheets (replace-all semantics).

    Slice 2b-backend-3: sheet_names replaces the former single sheet_name_or_none param.
    sheet_names must be a list of sheet names (or a JSON-encoded array string).
    An empty list clears all designations.

    Validate-all-before-write: every name is checked for (a) existence in this BOQs
    and (b) non-Hidden status before any write is performed. The entire call is
    rejected if any name is invalid or Hidden (no partial write).

    M2.23 unchanged: never touches wizard_status on any BoQ Sheet Draft row.
    preamble_text is blank on designation; populated by the parse worker on re-parse.

    NOTE: the frontend single-string caller (doSetGeneralSpecs in BoqHubPage.tsx) is
    intentionally left broken by this slice and is updated in Slice 2b-frontend-ii.
    """
    if not boq_name:
        frappe.throw("boq_name is required.", title="Missing field: boq_name")
    if sheet_names is None:
        frappe.throw("sheet_names is required.", title="Missing field: sheet_names")

    if not frappe.db.exists("BOQs", boq_name):
        frappe.throw(f"BOQs '{boq_name}' not found.", title="Not found")

    # Normalize: accept JSON-array string or Python list (mirrors set_sheet_work_packages).
    if isinstance(sheet_names, str):
        try:
            sheet_names = json.loads(sheet_names)
        except (ValueError, TypeError):
            frappe.throw(
                "sheet_names must be a JSON array string or a list.",
                title="Invalid JSON",
            )
    if not isinstance(sheet_names, list):
        frappe.throw("sheet_names must be a list.", title="Invalid type")

    # Validate ALL names before any write (no partial write).
    for name in sheet_names:
        child_name = _get_child_name(boq_name, name)
        if not child_name:
            frappe.throw(
                f"Sheet '{name}' not found in BOQs '{boq_name}'. No changes were made.",
                title="Sheet not found",
            )
        # Non-Hidden only: Hidden sheets cannot be designated as general-specs.
        status = frappe.db.get_value("BoQ Sheet Draft", child_name, "wizard_status")
        if status == "Hidden":
            frappe.throw(
                f"Sheet '{name}' is Hidden and cannot be designated as a general-specs sheet."
                " No changes were made.",
                title="Sheet is Hidden",
            )
        # #164: reject if ANY named sheet's parse is in flight (no partial write).
        _guard_sheet_not_parsing(boq_name, name)
        # A1: reject if ANY named sheet is Finalized (no partial write).
        _guard_sheet_not_finalized(boq_name, name)

    # Replace-all: remove all existing designations, then insert one row per name.
    frappe.db.delete("BoQ General Specs Sheet", {"parent": boq_name, "parenttype": "BOQs"})
    for name in sheet_names:
        child = frappe.new_doc("BoQ General Specs Sheet")
        child.parent = boq_name
        child.parenttype = "BOQs"
        child.parentfield = "general_specs_sheets"
        child.source_sheet_name = name
        child.preamble_text = ""  # populated by parse worker; blank on designation
        child.insert(ignore_permissions=True)

    frappe.db.commit()
    return {"status": "saved"}


@frappe.whitelist(methods=["POST"])
def set_sheet_config(boq_name: str = None, sheet_name: str = None, sheet_config=None):
    """Write the per-sheet parser config JSON blob to a BoQ Sheet Draft child row.

    sheet_config may be a dict or a JSON-encoded string; both are accepted.
    Stores the config as a JSON string in the sheet_config field.
    To clear the config, pass sheet_config={} or sheet_config='{}' .

    Dirty-marker: if the sheet's current wizard_status is "Parsed" and the new
    config differs from the stored config (semantic compare with sort_keys
    normalization, not raw-string), the status is dropped to "Config Done" -- the
    config change invalidates the prior parse. A no-op save (identical config,
    including key-reordering) leaves a Parsed sheet as Parsed.
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

    # Normalize: accept dict or JSON string; validate JSON string if string.
    # Capture config_obj (Python object) for the semantic compare below.
    if isinstance(sheet_config, dict):
        config_obj = sheet_config
        config_str = json.dumps(sheet_config)
    else:
        try:
            config_obj = json.loads(sheet_config)
        except (ValueError, TypeError):
            frappe.throw(
                "sheet_config must be a valid JSON string or object.",
                title="Invalid JSON",
            )
            config_obj = {}  # unreachable; frappe.throw() raises
        config_str = sheet_config

    child_name = _get_child_name(boq_name, sheet_name)
    if not child_name:
        frappe.throw(
            f"Sheet '{sheet_name}' not found in BOQs '{boq_name}'.",
            title="Sheet not found",
        )

    # #164: reject writes to a sheet whose parse is in flight.
    _guard_sheet_not_parsing(boq_name, sheet_name)
    # A1: reject config writes to a Finalized sheet (un-mark to edit).
    _guard_sheet_not_finalized(boq_name, sheet_name)

    # Read current state for dirty-marker detection.
    current = frappe.db.get_value(
        "BoQ Sheet Draft",
        child_name,
        ["wizard_status", "sheet_config"],
        as_dict=True,
    )
    current_status = (current.wizard_status or "") if current else ""
    current_config_raw = (current.sheet_config or "") if current else ""

    # Sound semantic compare: normalize both sides with sort_keys=True.
    # Stored and incoming forms are both non-canonical (key order follows
    # insertion order or original string order), so a raw string compare
    # produces false "changed" reports on key-reordered but semantically
    # identical configs. sort_keys=True serialization is deterministic for
    # any two semantically-equal objects.
    # Note: Frappe may return JSON fieldtype values as already-deserialized
    # Python objects (dict/list) rather than raw strings; handle both.
    incoming_canonical = json.dumps(config_obj, sort_keys=True)
    if current_config_raw:
        try:
            if isinstance(current_config_raw, str):
                stored_obj = json.loads(current_config_raw)
            else:
                stored_obj = current_config_raw  # already deserialized by Frappe
            stored_canonical = json.dumps(stored_obj, sort_keys=True)
        except (ValueError, TypeError):
            stored_canonical = None  # malformed stored blob -> treat as changed
    else:
        stored_canonical = None  # no stored config -> always changed

    changed = incoming_canonical != stored_canonical

    # Dirty-marker: drop Parsed -> Config Done on an actual config change only.
    # Other statuses (Pending, Config Done, Skip, Hidden, Parse failed) are not
    # affected -- the marker is only meaningful for a post-parse sheet. A Finalized
    # sheet never reaches here: _guard_sheet_not_finalized rejects the write first.
    if current_status == "Parsed" and changed:
        frappe.db.set_value("BoQ Sheet Draft", child_name, "wizard_status", "Config Done")

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

    # #164: reject writes to a sheet whose parse is in flight.
    _guard_sheet_not_parsing(boq_name, sheet_name)
    # A1: reject config writes to a Finalized sheet (un-mark to edit).
    _guard_sheet_not_finalized(boq_name, sheet_name)

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


@frappe.whitelist()
def get_boq_work_packages(boq_name: str = None) -> dict:
    """Return work-package assignments for all sheets in a BoQ.

    Returns: { sheet_name: [work_header, ...] }
    Sheets with no assigned packages are OMITTED from the result (not returned as []).

    Read path: queries tabBoQ Sheet Work Package directly via frappe.db.get_all().
    Frappe's get_doc() does NOT hydrate grandchild rows (child of child), so
    the standard REST /api/resource/BOQs/:name path always returns empty
    work_packages on each sheet draft. This endpoint is the authoritative
    read path for work-package data.
    """
    if not boq_name:
        frappe.throw("boq_name is required.", title="Missing field: boq_name")

    if not frappe.db.exists("BOQs", boq_name):
        frappe.throw(f"BOQs '{boq_name}' not found.", title="Not found")

    # One query: all draft rows for this BoQ.
    drafts = frappe.db.get_all(
        "BoQ Sheet Draft",
        filters={"parent": boq_name, "parenttype": "BOQs"},
        fields=["name", "sheet_name"],
    )
    if not drafts:
        return {}

    draft_name_to_sheet = {d.name: d.sheet_name for d in drafts}

    # One query: all work-package rows for those draft rows.
    pkg_rows = frappe.db.get_all(
        "BoQ Sheet Work Package",
        filters={
            "parent": ("in", list(draft_name_to_sheet.keys())),
            "parenttype": "BoQ Sheet Draft",
        },
        fields=["parent", "work_header"],
        order_by="creation asc",
    )

    result: dict = {}
    for row in pkg_rows:
        sheet_name = draft_name_to_sheet.get(row.parent)
        if sheet_name is None:
            continue
        result.setdefault(sheet_name, []).append(row.work_header)

    return result
