"""Template lifecycle + management endpoints (ADR-0013 D10).

A BoQ template is a project-less `BOQs` doc with `is_template = 1`. These endpoints
drive the authoring/management surface:

  - list_all_templates()    -- read every template (Draft/Published/Deprecated) for the
                               management page, with a per-template sheet count.
  - publish_template(boq)   -- Draft/Deprecated -> Published (selectable in the picker).
  - deprecate_template(boq) -- -> Deprecated (hidden from the picker; existing clones OK).
  - unpublish_template(boq) -- -> Draft.
  - duplicate_template(boq) -- deep-copy a template to a NEW is_template Draft template.
  - delete_template(boq)    -- delete a template + its review rows (+ WP grandchildren).

All endpoints are gated to the template-manager roles (Admin + Estimates Executive) plus
the Administrator user (ADR-0013 D10).

NOTE (companion change required OUTSIDE this file's ownership): a project-less template
insert (duplicate_template, and the upload authoring path in upload_file.py) is currently
BLOCKED by `integrations/controllers/boqs.py::before_insert`, which throws "Project is
required" when `not doc.project`. That controller must be relaxed to permit
`is_template = 1` docs without a project, e.g.:

    if not doc.project and not doc.is_template:
        frappe.throw(_("Project is required"))

The read/status/delete endpoints here do NOT depend on that relaxation.
"""

import json

import frappe
from frappe import _

# Roles allowed to author / manage BoQ templates (ADR-0013 D10). The Administrator
# user is always allowed (handled in _user_role_profile / the gate).
MANAGE_TEMPLATE_ROLES = frozenset(
    {
        "Nirmaan Admin Profile",
        "Nirmaan Estimates Executive Profile",
    }
)

# JSON fields on BoQ Review Row whose stored value is a Python LIST. Frappe's
# get_valid_dict() rejects a Python list for a JSON fieldtype ("cannot be a list"),
# so any list value must be json.dumps()'d before insert. Dict-valued JSON fields
# (qty_by_area, rate_by_area, amount_by_area, append_notes_raw, *_accept_snapshot) are
# auto-serialized by Frappe -- do NOT dumps those. Mirrors parse_run._LIST_JSON_FIELDS
# and adds edit_log (also a list) since duplicate preserves the full authoring state.
_LIST_JSON_FIELDS = frozenset(
    {
        "attached_notes",
        "classifier_warnings",
        "preamble_candidate_signals",
        "edit_log",
    }
)

# BoQ Sheet Draft config fields carried on a duplicate. Transient job/failure flags
# (parse_in_progress, ai_in_progress, gemini_in_progress, parse_failure_*,
# commit_failure_*) are intentionally NOT copied -- a duplicate starts with a clean
# runtime state. work_packages (a grandchild table) is copied separately.
_SHEET_DRAFT_COPY_FIELDS = (
    "sheet_name",
    "sheet_order",
    "wizard_status",
    "sheet_label",
    "sheet_config",
    "has_prior_parse",
    "last_parsed_at",
)


# ---------------------------------------------------------------------------
# Role gate
# ---------------------------------------------------------------------------

def _user_role_profile(user: str) -> str:
    """Role profile for a user. Nirmaan Users is named by lowercased email; the
    Administrator user has no Nirmaan Users row so it is mapped to admin explicitly."""
    if user == "Administrator":
        return "Nirmaan Admin Profile"
    user_key = user.strip().lower() if user else ""
    return frappe.db.get_value("Nirmaan Users", user_key, "role_profile") or ""


def _require_template_manager() -> None:
    """Throw PermissionError unless the session user may manage templates."""
    user = frappe.session.user
    if user == "Administrator":
        return
    if _user_role_profile(user) not in MANAGE_TEMPLATE_ROLES:
        frappe.throw(
            _("You are not permitted to manage BoQ templates."),
            frappe.PermissionError,
        )


def _assert_is_template(boq: str) -> None:
    """Validate `boq` exists AND is a template. Throws otherwise."""
    if not boq:
        frappe.throw(_("boq is required."), title=_("Missing field: boq"))
    row = frappe.db.get_value("BOQs", boq, ["name", "is_template"], as_dict=True)
    if not row:
        frappe.throw(_("BOQs '{0}' not found.").format(boq), title=_("Not found"))
    if not row.is_template:
        frappe.throw(
            _("BOQs '{0}' is not a template.").format(boq),
            title=_("Not a template"),
        )


# ---------------------------------------------------------------------------
# 1. List
# ---------------------------------------------------------------------------

@frappe.whitelist()
def list_all_templates():
    """Every `is_template=1` BOQs (incl. Draft/Deprecated) for the management page.

    Returns a list of dicts: name, boq_name, template_status, origin, source_template,
    creation, modified, sheet_count.
    """
    _require_template_manager()

    templates = frappe.get_all(
        "BOQs",
        filters={"is_template": 1},
        fields=[
            "name",
            "boq_name",
            "template_status",
            "origin",
            "source_template",
            "creation",
            "modified",
        ],
        order_by="modified desc",
    )
    if not templates:
        return []

    # One query for sheet counts across all templates (avoid an N+1 count loop).
    names = [t.name for t in templates]
    counts: dict = {}
    for row in frappe.db.get_all(
        "BoQ Sheet Draft",
        filters={"parent": ("in", names), "parenttype": "BOQs"},
        fields=["parent"],
    ):
        counts[row.parent] = counts.get(row.parent, 0) + 1

    for t in templates:
        t["sheet_count"] = counts.get(t.name, 0)

    return templates


# ---------------------------------------------------------------------------
# 2. Status transitions
# ---------------------------------------------------------------------------

def _set_template_status(boq: str, status: str) -> dict:
    _require_template_manager()
    _assert_is_template(boq)
    # Direct DB write: template_status is independent of the status-transition
    # guards in the BOQs controller.validate (which only gate the `status` field).
    frappe.db.set_value("BOQs", boq, "template_status", status)
    frappe.db.commit()
    return {"status": "saved", "boq": boq, "template_status": status}


@frappe.whitelist(methods=["POST"])
def publish_template(boq: str = None):
    """Mark a template Published (selectable in the Create-from-Template picker)."""
    return _set_template_status(boq, "Published")


@frappe.whitelist(methods=["POST"])
def deprecate_template(boq: str = None):
    """Mark a template Deprecated (hidden from the picker; existing clones unaffected)."""
    return _set_template_status(boq, "Deprecated")


@frappe.whitelist(methods=["POST"])
def unpublish_template(boq: str = None):
    """Return a template to Draft (removed from the picker; re-editable)."""
    return _set_template_status(boq, "Draft")


# ---------------------------------------------------------------------------
# 3. Duplicate
# ---------------------------------------------------------------------------

@frappe.whitelist(methods=["POST"])
def duplicate_template(boq: str = None):
    """Deep-copy a template to a NEW, independent `is_template=1` Draft template.

    Copies: BOQs header fields, sheet_drafts (config) + their work_packages grandchild
    rows, general_specs_sheets, and every BoQ Review Row. The new template is
    project-less (project=None) and starts at template_status="Draft" with
    source_template=None (a template has no source template of its own).

    Returns: {"status": "saved", "name": <new template name>, "boq_name": <...>}.
    """
    _require_template_manager()
    _assert_is_template(boq)

    src = frappe.get_doc("BOQs", boq)

    # --- Build the new template BOQs doc (project-less). ---
    new_doc = frappe.new_doc("BOQs")
    new_doc.is_template = 1
    new_doc.template_status = "Draft"
    new_doc.origin = src.origin or "upload"
    new_doc.source_template = None
    new_doc.project = None  # a template is project-less (ADR-0013 D1)
    new_doc.boq_name = f"{src.boq_name} (Copy)" if src.boq_name else "Template (Copy)"
    new_doc.tax_treatment = src.tax_treatment
    new_doc.notes = src.notes
    new_doc.wizard_state = src.wizard_state
    new_doc.source_sheet_name = src.source_sheet_name
    new_doc.area_dimensions = src.area_dimensions
    new_doc.source_file_url = src.source_file_url

    # sheet_drafts children (config only; grandchild work_packages copied post-insert).
    for d in src.sheet_drafts:
        new_doc.append(
            "sheet_drafts",
            {f: d.get(f) for f in _SHEET_DRAFT_COPY_FIELDS},
        )

    # general_specs_sheets children (general-specs membership + preamble text).
    for gs in src.general_specs_sheets:
        new_doc.append(
            "general_specs_sheets",
            {
                "source_sheet_name": gs.get("source_sheet_name"),
                "preamble_text": gs.get("preamble_text"),
            },
        )

    new_doc.insert(ignore_permissions=True)

    # --- Copy work_packages grandchild rows (child of BoQ Sheet Draft). ---
    # Frappe get_doc does NOT hydrate grandchildren, so read them directly and
    # re-insert against the NEW draft rows, matched by sheet_name VERBATIM (#152).
    src_drafts = frappe.db.get_all(
        "BoQ Sheet Draft",
        filters={"parent": src.name, "parenttype": "BOQs"},
        fields=["name", "sheet_name"],
    )
    src_draft_name_to_sheet = {d.name: d.sheet_name for d in src_drafts}
    if src_draft_name_to_sheet:
        sheet_to_headers: dict = {}
        for row in frappe.db.get_all(
            "BoQ Sheet Work Package",
            filters={
                "parent": ("in", list(src_draft_name_to_sheet.keys())),
                "parenttype": "BoQ Sheet Draft",
            },
            fields=["parent", "work_header"],
            order_by="creation asc",
        ):
            sn = src_draft_name_to_sheet.get(row.parent)
            if sn is None:
                continue
            sheet_to_headers.setdefault(sn, []).append(row.work_header)

        # sheet_name -> new draft child name (VERBATIM match).
        new_sheet_to_draft = {d.sheet_name: d.name for d in new_doc.sheet_drafts}
        for sn, headers in sheet_to_headers.items():
            new_child_name = new_sheet_to_draft.get(sn)
            if not new_child_name:
                continue
            for wh in headers:
                pkg = frappe.new_doc("BoQ Sheet Work Package")
                pkg.parent = new_child_name
                pkg.parenttype = "BoQ Sheet Draft"
                pkg.parentfield = "work_packages"
                pkg.work_header = wh
                pkg.insert(ignore_permissions=True)

    # --- Copy every BoQ Review Row (structure + authoring state). ---
    src_rows = frappe.get_all(
        "BoQ Review Row",
        filters={"boq": src.name},
        fields=["name"],
        order_by="sheet_name asc, row_index asc",
    )
    for r in src_rows:
        src_row = frappe.get_doc("BoQ Review Row", r.name)
        new_row = frappe.copy_doc(src_row)
        new_row.boq = new_doc.name
        # Defensive: re-serialize any list-valued JSON field (loaded values are
        # normally already strings, but guard against the "cannot be a list" insert
        # error regardless of how the source was loaded).
        for field in _LIST_JSON_FIELDS:
            val = new_row.get(field)
            if isinstance(val, list):
                new_row.set(field, json.dumps(val))
        new_row.insert(ignore_permissions=True)

    frappe.db.commit()

    return {"status": "saved", "name": new_doc.name, "boq_name": new_doc.boq_name}


# ---------------------------------------------------------------------------
# 4. Delete
# ---------------------------------------------------------------------------

@frappe.whitelist(methods=["POST"])
def delete_template(boq: str = None):
    """Delete a template BOQs doc + its review rows (and WP grandchildren).

    Guards `is_template=1` so this can never delete a live project BOQ. The BOQs
    delete cascades its own child rows (sheet_drafts, general_specs_sheets), but NOT
    the grandchild work_packages -- those are removed explicitly first.
    """
    _require_template_manager()
    _assert_is_template(boq)

    # Standalone (not-a-child) review rows linked by the `boq` field.
    frappe.db.delete("BoQ Review Row", {"boq": boq})

    # Grandchildren: work_packages under this template's sheet_drafts. Delete BEFORE
    # the BOQs delete (which drops the draft rows) so they are not orphaned.
    draft_names = frappe.db.get_all(
        "BoQ Sheet Draft",
        filters={"parent": boq, "parenttype": "BOQs"},
        pluck="name",
    )
    if draft_names:
        frappe.db.delete(
            "BoQ Sheet Work Package",
            {"parent": ("in", draft_names), "parenttype": "BoQ Sheet Draft"},
        )

    frappe.delete_doc("BOQs", boq, ignore_permissions=True)
    frappe.db.commit()

    return {"status": "deleted", "boq": boq}
