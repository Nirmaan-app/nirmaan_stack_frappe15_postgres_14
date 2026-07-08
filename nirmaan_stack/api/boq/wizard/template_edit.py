# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""
Template-editor CRUD endpoints on the ONE master `BoQ Template` (ADR-0013 A1-D10, task A-T5).

The master template is admin-edited-directly: an Admin / Estimates Executive extends it in a
custom editor (add / edit / delete / reparent rows with renumber-on-insert; add / remove /
reorder sheets; set per-sheet work packages). These endpoints are that editor's write half.
They operate on the dedicated template doctypes:

  - `BoQ Template`        -- the single master row (provenance touched on every write).
  - `BoQ Template Sheet`  -- child table of the master (sheet_name / sheet_order / disposition
                             / sheet_config / work_packages JSON-list / preamble_text).
  - `BoQ Template Row`    -- a SEPARATE doctype keyed by `template` + `sheet_name`, the
                             structural-only row store (row_index, classification, level,
                             parent_index[-1 sentinel], attached_to_index[0 sentinel], path,
                             description, unit, make_model, is_rate_only, attached_notes).

The row create/delete endpoints REUSE the exact pointer-remap math the create-flow review-row
path uses -- the pure `row_renumber.*` helpers (F3-lite: one parametric core, two thin
callers). The ONLY structural difference vs `template_rows.py`: a `BoQ Template Row` has no
`human_parent` (no overlay layer -- the seed already flattened it), so only `parent_index`
and `attached_to_index` are remapped.

LOAD-BEARING invariants (violating any silently corrupts the tree / data):
  * SENTINELS: parent_index -1 = root (0 is a valid row_index); attached_to_index 0 = not
    attached. A newly-created row MUST set parent_index=-1 for a root, NOT the Int default 0.
  * sheet_name matched VERBATIM everywhere (#152) -- trailing/leading spaces are identity;
    never .trim() for a filter / key.
  * LIST-JSON WALL: `attached_notes` (BoQ Template Row) and `work_packages` (BoQ Template
    Sheet) hold a Python LIST -> a row carrying them is removed via raw `frappe.db.delete`
    (never `frappe.delete_doc` / `doc.save`, which throw "... cannot be a list"), and
    `work_packages` is written json.dumps'd via `frappe.db.set_value` (raw SQL, no
    get_valid_dict). `sheet_config` is a DICT-JSON -> auto-serialized, do NOT json.dumps it.
  * We NEVER `doc.save()` the master (its `sheets` children carry the list-JSON work_packages)
    -- sheet ops go through direct child insert + raw db.delete + set_value.

Role gate: Admin + Estimates Executive (plus the Administrator user), asserted FIRST on every
endpoint -- these are direct-callable APIs; a UI gate is not enough. `frappe.db.commit()` runs
after the DML (writes touch `last_updated_by` / `last_updated_on` on the master).
"""
from __future__ import annotations

import json

import frappe
from frappe import _
from frappe.utils import now_datetime

from nirmaan_stack.api.boq.wizard.review_screen import _ASSIGNABLE_CLASSIFICATIONS
from nirmaan_stack.api.boq.wizard.row_renumber import (
    _delete_remap,
    _delete_remap_attached,
    _insert_shift,
    _insert_shift_attached,
)

# Roles allowed to seed / hand-edit the master template (ADR-0013 A1-D10). The Administrator
# user is always allowed (handled in the gate). Mirrors template_admin's manager set.
_TEMPLATE_EDIT_ROLES: frozenset[str] = frozenset(
    {
        "Nirmaan Admin Profile",
        "Nirmaan Estimates Executive Profile",
    }
)

_VALID_DISPOSITIONS: frozenset[str] = frozenset({"data", "general_specs"})

# Minimal single-area sheet_config for a hand-built new sheet (A1-D3 -- template sheets are
# single-area; qty values are stripped, so this is a bare column-config skeleton the admin
# then fills in the editor). A DICT -> auto-serialized on write (never json.dumps'd).
_DEFAULT_SHEET_CONFIG: dict = {
    "header_row": 1,
    "area_dimensions": [],
    "column_role_map": {},
    "column_headers": {},
}


# ---------------------------------------------------------------------------
# Role gate + master provenance
# ---------------------------------------------------------------------------

def _require_template_editor() -> None:
    """Throw PermissionError unless the session user may edit the master template.

    Allowed = the Administrator user OR a Nirmaan Users row whose role_profile is one of
    _TEMPLATE_EDIT_ROLES (Admin / Estimates Executive). Nirmaan Users is keyed by the user
    email (== the User docname), so it is looked up with the RAW session user -- matching the
    established wizard convention (pricing.py / draft_lock.py). The Administrator user has no
    such row, so it is short-circuited."""
    user = frappe.session.user
    if user == "Administrator":
        return
    role_profile = frappe.db.get_value("Nirmaan Users", user, "role_profile") or ""
    if role_profile not in _TEMPLATE_EDIT_ROLES:
        frappe.throw(
            _("You are not permitted to edit the BoQ master template."),
            frappe.PermissionError,
        )


def _assert_template(template: str) -> None:
    if not template:
        frappe.throw(_("template is required."), title="Missing field: template")
    if not frappe.db.exists("BoQ Template", template):
        frappe.throw(_("BoQ Template '{0}' not found.").format(template), title="Not found")


def _touch_master(template: str) -> None:
    """Stamp provenance (last_updated_by / last_updated_on) on the master. set_value writes
    raw SQL (no doc.save -> the master's list-JSON `work_packages` children never load into
    get_valid_dict, so the list-JSON wall can never fire here)."""
    frappe.db.set_value(
        "BoQ Template",
        template,
        {"last_updated_by": frappe.session.user, "last_updated_on": now_datetime()},
    )


def _coerce_list(val, field: str) -> list:
    """HTTP delivers list params as a JSON string; a Python caller passes a real list.
    Normalize both to a list; anything else throws."""
    if val is None:
        return []
    if isinstance(val, str):
        try:
            val = json.loads(val)
        except (ValueError, TypeError):
            frappe.throw(_("{0} must be a JSON array.").format(field), title="Invalid " + field)
    if not isinstance(val, list):
        frappe.throw(_("{0} must be a list.").format(field), title="Invalid " + field)
    return val


def _coerce_dict(val, field: str) -> dict:
    """Normalize a dict param (JSON string over HTTP, real dict from Python) to a dict."""
    if val is None:
        return {}
    if isinstance(val, str):
        try:
            val = json.loads(val)
        except (ValueError, TypeError):
            frappe.throw(_("{0} must be a JSON object.").format(field), title="Invalid " + field)
    if not isinstance(val, dict):
        frappe.throw(_("{0} must be an object.").format(field), title="Invalid " + field)
    return val


# ---------------------------------------------------------------------------
# Template row helpers (BoQ Template Row keyed by template + sheet_name VERBATIM)
# ---------------------------------------------------------------------------

def _load_row_pointers(template: str, sheet_name: str) -> list:
    """Every BoQ Template Row for (template, sheet_name VERBATIM) with only the fields the
    renumber/remap needs. A template row has NO human_parent (no overlay), so only
    parent_index + attached_to_index are pointers. Ordered by row_index for determinism."""
    return frappe.db.get_all(
        "BoQ Template Row",
        filters={"template": template, "sheet_name": sheet_name},
        fields=["name", "row_index", "parent_index", "attached_to_index"],
        order_by="row_index asc",
    )


def _sheet_child(template: str, sheet_name: str):
    """Return the BoQ Template Sheet child dict for (template, sheet_name VERBATIM) or None."""
    rows = frappe.db.get_all(
        "BoQ Template Sheet",
        filters={"parent": template, "parenttype": "BoQ Template", "sheet_name": sheet_name},
        fields=["name", "sheet_name", "sheet_order"],
        limit=1,
    )
    return rows[0] if rows else None


def _reparent_creates_cycle(template: str, sheet_name: str, row_index: int, new_parent: int) -> bool:
    """True if reparenting the row at `row_index` under `new_parent` would create a cycle --
    i.e. new_parent is `row_index` itself, or a DESCENDANT of it. Walk UP from new_parent via
    parent_index; if the ancestor chain reaches `row_index`, the target sits BELOW the row
    being moved, so the move would loop. The create-flow restructure has the equivalent batch
    cycle-guard (RestructureModal); the editor needs parity or a cycle would corrupt every
    tree walk (depths / commit)."""
    if new_parent == row_index:
        return True
    parent_of = {
        r.row_index: r.parent_index
        for r in frappe.db.get_all(
            "BoQ Template Row",
            filters={"template": template, "sheet_name": sheet_name},
            fields=["row_index", "parent_index"],
        )
    }
    seen: set = set()
    cur = new_parent
    while cur is not None and cur >= 0:
        if cur == row_index:
            return True
        if cur in seen:  # defensive: a pre-existing cycle -- stop rather than loop forever
            break
        seen.add(cur)
        cur = parent_of.get(cur)
    return False


# ---------------------------------------------------------------------------
# Row CRUD endpoints
# ---------------------------------------------------------------------------

@frappe.whitelist(methods=["POST"])
def template_create_row(
    template: str = None,
    sheet_name: str = None,
    anchor_row_index=None,
    position: str = None,
    classification: str = None,
    parent_index=None,
    description: str = None,
    unit: str = None,
    make_model: str = None,
) -> dict:
    """Insert a hand-built BoQ Template Row above/below an anchor via renumber-on-insert.

    Every existing row at row_index >= insertion_index shifts +1; its parent_index /
    attached_to_index pointers are remapped through the identical shift so the tree is never
    left dangling. The new row lands at row_index=insertion_index with the correct sentinels
    (parent_index=-1 for a root, attached_to_index=0), is_rate_only=0, no source provenance.

    Params (HTTP -> ints arrive as strings and are coerced):
      anchor_row_index -- the reference row's current row_index (must exist in the sheet).
      position         -- "above" | "below". insertion_index = anchor (above) / anchor+1 (below).
      classification   -- one of the 4 ASSIGNABLE classes (line_item / preamble / note / spacer).
      parent_index     -- the NEW row's parent as a CURRENT (pre-insert) row_index, or -1 /
                          blank for root; remapped through the same insert-shift.
      description, unit, make_model -- optional text (blank -> None).

    Returns {"status": "saved", "new_row_index": insertion_index}.
    """
    _require_template_editor()

    if position not in ("above", "below"):
        frappe.throw(_("position must be 'above' or 'below'."), title="Invalid position")
    if not sheet_name:
        frappe.throw(_("sheet_name is required."), title="Missing field: sheet_name")
    if anchor_row_index is None:
        frappe.throw(_("anchor_row_index is required."), title="Missing field: anchor_row_index")
    if not classification:
        frappe.throw(_("classification is required."), title="Missing field: classification")
    if classification not in _ASSIGNABLE_CLASSIFICATIONS:
        frappe.throw(
            _("'{0}' is not an assignable classification; allowed: {1}.").format(
                classification, ", ".join(sorted(_ASSIGNABLE_CLASSIFICATIONS))
            ),
            title="Invalid classification",
        )
    _assert_template(template)

    try:
        anchor_row_index = int(anchor_row_index)
    except (ValueError, TypeError):
        frappe.throw(_("anchor_row_index must be an integer."), title="Invalid anchor_row_index")

    # parent_index: blank / None -> -1 (root); else an int in the PRE-insert keyspace.
    if parent_index is None or parent_index == "":
        parent_index = -1
    else:
        try:
            parent_index = int(parent_index)
        except (ValueError, TypeError):
            frappe.throw(_("parent_index must be an integer."), title="Invalid parent_index")

    if not frappe.db.exists(
        "BoQ Template Row",
        {"template": template, "sheet_name": sheet_name, "row_index": anchor_row_index},
    ):
        frappe.throw(
            _("Anchor row_index {0} does not exist in sheet '{1}'.").format(anchor_row_index, sheet_name),
            title="Invalid anchor",
        )
    if parent_index >= 0 and not frappe.db.exists(
        "BoQ Template Row",
        {"template": template, "sheet_name": sheet_name, "row_index": parent_index},
    ):
        frappe.throw(
            _("Parent row_index {0} does not exist in sheet '{1}'.").format(parent_index, sheet_name),
            title="Invalid parent",
        )

    insertion_index = anchor_row_index if position == "above" else anchor_row_index + 1

    # --- Renumber-on-insert: shift row_index + remap pointers for every affected row ---
    for r in _load_row_pointers(template, sheet_name):
        old_idx = r.row_index
        new_idx = old_idx + 1 if old_idx >= insertion_index else old_idx
        new_parent = _insert_shift(r.parent_index, insertion_index)
        new_attached = _insert_shift_attached(r.attached_to_index, insertion_index)
        changed = {}
        if new_idx != old_idx:
            changed["row_index"] = new_idx
        if new_parent != r.parent_index:
            changed["parent_index"] = new_parent
        if new_attached != r.attached_to_index:
            changed["attached_to_index"] = new_attached
        if changed:
            frappe.db.set_value("BoQ Template Row", r.name, changed)

    # The new row's parent was a PRE-insert reference -- remap through the same shift.
    new_row_parent = _insert_shift(parent_index, insertion_index)

    doc = frappe.new_doc("BoQ Template Row")
    doc.template = template
    doc.sheet_name = sheet_name
    doc.row_index = insertion_index
    doc.source_row_number = None  # hand-built: no source workbook row
    doc.classification = classification
    doc.level = 0                 # derived on read / at commit
    doc.parent_index = new_row_parent
    doc.path = ""
    doc.attached_to_index = 0     # 0 sentinel: not attached
    # attached_notes deliberately left unset (a new row has none) -- avoids the list-JSON wall.
    doc.sl_no_value = None
    doc.description = description or None
    doc.unit = unit or None
    doc.make_model = make_model or None
    doc.is_rate_only = 0
    doc.insert(ignore_permissions=True)

    _touch_master(template)
    frappe.db.commit()

    return {"status": "saved", "new_row_index": insertion_index}


@frappe.whitelist(methods=["POST"])
def template_edit_row(
    row_name: str = None,
    description=None,
    unit=None,
    make_model=None,
    classification: str = None,
    parent_index=None,
) -> dict:
    """Patch the provided fields on ONE BoQ Template Row (identified by its docname).

    Only fields that are not None are touched. A reparent (parent_index provided) is
    validated: a real parent (>= 0) must exist in the SAME sheet and cannot be the row
    itself; blank / -1 makes the row a root (-1 sentinel). Does NOT renumber (row_index is
    unchanged) -- it only rewrites the parent pointer / content fields.

    Returns {"status": "saved", "changed": [<field>, ...]}.
    """
    _require_template_editor()

    if not row_name:
        frappe.throw(_("row_name is required."), title="Missing field: row_name")

    row = frappe.db.get_value(
        "BoQ Template Row",
        row_name,
        ["name", "template", "sheet_name", "row_index"],
        as_dict=True,
    )
    if not row:
        frappe.throw(_("BoQ Template Row '{0}' not found.").format(row_name), title="Row not found")

    changed: dict = {}
    if description is not None:
        changed["description"] = description or None
    if unit is not None:
        changed["unit"] = unit or None
    if make_model is not None:
        changed["make_model"] = make_model or None
    if classification is not None:
        if classification not in _ASSIGNABLE_CLASSIFICATIONS:
            frappe.throw(
                _("'{0}' is not an assignable classification; allowed: {1}.").format(
                    classification, ", ".join(sorted(_ASSIGNABLE_CLASSIFICATIONS))
                ),
                title="Invalid classification",
            )
        changed["classification"] = classification
    if parent_index is not None:
        if parent_index == "":
            new_parent = -1
        else:
            try:
                new_parent = int(parent_index)
            except (ValueError, TypeError):
                frappe.throw(_("parent_index must be an integer."), title="Invalid parent_index")
        if new_parent >= 0:
            if new_parent == row.row_index:
                frappe.throw(_("A row cannot be its own parent."), title="Invalid parent")
            if not frappe.db.exists(
                "BoQ Template Row",
                {"template": row.template, "sheet_name": row.sheet_name, "row_index": new_parent},
            ):
                frappe.throw(
                    _("Parent row_index {0} does not exist in sheet '{1}'.").format(
                        new_parent, row.sheet_name
                    ),
                    title="Invalid parent",
                )
            if _reparent_creates_cycle(row.template, row.sheet_name, row.row_index, new_parent):
                frappe.throw(
                    _("Reparenting row {0} under {1} would create a cycle (the target is a "
                      "descendant of this row).").format(row.row_index, new_parent),
                    title="Invalid parent",
                )
        changed["parent_index"] = new_parent

    if changed:
        frappe.db.set_value("BoQ Template Row", row.name, changed)
        _touch_master(row.template)
        frappe.db.commit()

    return {"status": "saved", "changed": sorted(changed.keys())}


@frappe.whitelist(methods=["POST"])
def template_delete_row(template: str = None, sheet_name: str = None, row_index=None) -> dict:
    """Delete a BoQ Template Row and reverse-renumber the sheet.

    Unlike the create-flow (where only a synthetic row is deletable), EVERY template row is
    editable -- there is no parser/human provenance to protect. The deleted row's children
    (any row pointing at deleted_index via parent_index) are re-pointed to the deleted row's
    own parent (grandparent) so the tree stays connected; then every row at row_index >
    deleted_index shifts -1 and pointers into that range shift -1. The row is removed via
    raw frappe.db.delete (attached_notes is a list-JSON -> delete_doc would throw).

    Returns {"status": "deleted"}.
    """
    _require_template_editor()

    if not sheet_name:
        frappe.throw(_("sheet_name is required."), title="Missing field: sheet_name")
    if row_index is None:
        frappe.throw(_("row_index is required."), title="Missing field: row_index")
    _assert_template(template)

    try:
        row_index = int(row_index)
    except (ValueError, TypeError):
        frappe.throw(_("row_index must be an integer."), title="Invalid row_index")

    target = frappe.db.get_value(
        "BoQ Template Row",
        {"template": template, "sheet_name": sheet_name, "row_index": row_index},
        ["name", "parent_index"],
        as_dict=True,
    )
    if not target:
        frappe.throw(
            _("Row with row_index={0} not found in sheet '{1}'.").format(row_index, sheet_name),
            title="Row not found",
        )

    deleted_index = row_index
    # Grandparent for the orphaned children: a template row has no human_parent overlay, so
    # the effective parent IS parent_index (>= 0), else -1 (a root's children become roots).
    grandparent = (
        target.parent_index if (target.parent_index is not None and target.parent_index >= 0) else -1
    )

    rows = _load_row_pointers(template, sheet_name)

    # Raw delete FIRST (attached_notes list-JSON wall -> never delete_doc), then remap.
    frappe.db.delete("BoQ Template Row", {"name": target.name})

    for r in rows:
        if r.name == target.name:
            continue
        old_idx = r.row_index
        new_idx = old_idx - 1 if old_idx > deleted_index else old_idx
        new_parent = _delete_remap(r.parent_index, deleted_index, grandparent)
        new_attached = _delete_remap_attached(r.attached_to_index, deleted_index)
        changed = {}
        if new_idx != old_idx:
            changed["row_index"] = new_idx
        if new_parent != r.parent_index:
            changed["parent_index"] = new_parent
        if new_attached != r.attached_to_index:
            changed["attached_to_index"] = new_attached
        if changed:
            frappe.db.set_value("BoQ Template Row", r.name, changed)

    _touch_master(template)
    frappe.db.commit()

    return {"status": "deleted"}


# ---------------------------------------------------------------------------
# Sheet ops (BoQ Template Sheet child of BoQ Template)
# ---------------------------------------------------------------------------

@frappe.whitelist(methods=["POST"])
def template_add_sheet(
    template: str = None,
    sheet_name: str = None,
    sheet_label: str = None,
    disposition: str = "data",
    sheet_config=None,
) -> dict:
    """Append a hand-built BoQ Template Sheet to the master (A1-D10 -- new whole-sheet
    additions are hand-built in the editor, no bulk append).

    sheet_order = current MAX + 1 (a new sheet lands last). sheet_config defaults to a minimal
    single-area column skeleton; a caller-supplied dict is stored as-is (DICT-JSON,
    auto-serialized). The child is inserted DIRECTLY (parent/parenttype/parentfield set) so we
    never doc.save the master (its work_packages list-JSON children would trip the wall).
    disposition must be 'data' | 'general_specs'.

    Returns {"status": "saved", "sheet_order": <n>}.
    """
    _require_template_editor()

    if not sheet_name:
        frappe.throw(_("sheet_name is required."), title="Missing field: sheet_name")
    _assert_template(template)

    disposition = disposition or "data"
    if disposition not in _VALID_DISPOSITIONS:
        frappe.throw(
            _("disposition must be one of: {0}.").format(", ".join(sorted(_VALID_DISPOSITIONS))),
            title="Invalid disposition",
        )

    if _sheet_child(template, sheet_name) is not None:
        frappe.throw(
            _("Sheet '{0}' already exists in this template.").format(sheet_name),
            title="Duplicate sheet",
        )

    # sheet_order = max existing + 1 (1 if the template has no sheets yet).
    existing = frappe.db.get_all(
        "BoQ Template Sheet",
        filters={"parent": template, "parenttype": "BoQ Template"},
        fields=["sheet_order"],
    )
    max_order = max((int(s.sheet_order or 0) for s in existing), default=0)
    new_order = max_order + 1

    cfg = _coerce_dict(sheet_config, "sheet_config") if sheet_config is not None else dict(_DEFAULT_SHEET_CONFIG)

    child = frappe.new_doc("BoQ Template Sheet")
    child.parent = template
    child.parenttype = "BoQ Template"
    child.parentfield = "sheets"
    child.idx = new_order
    child.sheet_name = sheet_name
    child.sheet_order = new_order
    child.sheet_label = sheet_label or None
    child.disposition = disposition
    child.sheet_config = cfg      # DICT-JSON -> auto-serialized (never json.dumps a dict)
    # work_packages / preamble_text left unset on a fresh sheet.
    child.insert(ignore_permissions=True)

    _touch_master(template)
    frappe.db.commit()

    return {"status": "saved", "sheet_order": new_order}


@frappe.whitelist(methods=["POST"])
def template_remove_sheet(template: str = None, sheet_name: str = None) -> dict:
    """Remove a sheet from the master: raw-delete the BoQ Template Sheet child AND every
    BoQ Template Row under (template, sheet_name VERBATIM).

    Both carry a list-JSON field (work_packages on the sheet, attached_notes on the row), so
    BOTH are removed via raw frappe.db.delete -- delete_doc would throw the list-JSON wall.
    sheet_order gaps left by the removal are harmless (row_index/sheet_order are sort keys,
    re-tightened by template_reorder_sheets if desired).

    Returns {"status": "deleted"}.
    """
    _require_template_editor()

    if not sheet_name:
        frappe.throw(_("sheet_name is required."), title="Missing field: sheet_name")
    _assert_template(template)

    if _sheet_child(template, sheet_name) is None:
        frappe.throw(
            _("Sheet '{0}' does not exist in this template.").format(sheet_name),
            title="Sheet not found",
        )

    # Raw deletes (list-JSON wall): sheet child + all its rows.
    frappe.db.delete(
        "BoQ Template Sheet",
        {"parent": template, "parenttype": "BoQ Template", "sheet_name": sheet_name},
    )
    frappe.db.delete("BoQ Template Row", {"template": template, "sheet_name": sheet_name})

    _touch_master(template)
    frappe.db.commit()

    return {"status": "deleted"}


@frappe.whitelist(methods=["POST"])
def template_reorder_sheets(template: str = None, ordered_sheet_names=None) -> dict:
    """Set sheet_order (and grid idx) on the master's sheets to the given order.

    `ordered_sheet_names` (JSON array over HTTP) lists sheet_names in the desired order; each
    must exist in the template (matched VERBATIM). sheet_order/idx are assigned 1..N in list
    order. A name not present in the template throws (no silent partial reorder).

    Returns {"status": "saved"}.
    """
    _require_template_editor()

    _assert_template(template)
    ordered = _coerce_list(ordered_sheet_names, "ordered_sheet_names")
    if not ordered:
        frappe.throw(_("ordered_sheet_names is required."), title="Missing field: ordered_sheet_names")

    name_by_sheet = {
        s.sheet_name: s.name
        for s in frappe.db.get_all(
            "BoQ Template Sheet",
            filters={"parent": template, "parenttype": "BoQ Template"},
            fields=["name", "sheet_name"],
        )
    }
    # `ordered` MUST be a COMPLETE, duplicate-free permutation of the template's sheets. A
    # subset (or a duplicate) would leave omitted sheets at a stale sheet_order that collides
    # with the reassigned 1..N values -- ambiguous ordering for the picker + the clone (both
    # sort by sheet_order asc). Reject rather than silently corrupt the order.
    ordered_set = set(ordered)
    if len(ordered) != len(ordered_set):
        frappe.throw(_("ordered_sheet_names contains duplicate names."), title="Invalid order")
    all_names = set(name_by_sheet.keys())
    if ordered_set != all_names:
        missing = sorted(all_names - ordered_set)
        unknown = sorted(ordered_set - all_names)
        frappe.throw(
            _("ordered_sheet_names must list EVERY template sheet exactly once. "
              "Missing: {0}; unknown: {1}.").format(missing or "none", unknown or "none"),
            title="Incomplete order",
        )

    for i, sn in enumerate(ordered):
        frappe.db.set_value(
            "BoQ Template Sheet", name_by_sheet[sn], {"sheet_order": i + 1, "idx": i + 1}
        )

    _touch_master(template)
    frappe.db.commit()

    return {"status": "saved"}


@frappe.whitelist(methods=["POST"])
def template_set_sheet_wp(template: str = None, sheet_name: str = None, work_headers=None) -> dict:
    """Set the sheet's work_packages JSON list (LIST-JSON -> json.dumps'd, written via raw
    set_value so it never passes through get_valid_dict / the list-JSON wall).

    `work_headers` (JSON array over HTTP, real list from Python) is a list of Work Headers
    docnames; passing [] clears the sheet's WP. sheet_name matched VERBATIM.

    Returns {"status": "saved", "work_packages": [...]}.
    """
    _require_template_editor()

    if not sheet_name:
        frappe.throw(_("sheet_name is required."), title="Missing field: sheet_name")
    _assert_template(template)

    child = _sheet_child(template, sheet_name)
    if child is None:
        frappe.throw(
            _("Sheet '{0}' does not exist in this template.").format(sheet_name),
            title="Sheet not found",
        )

    wp = _coerce_list(work_headers, "work_headers")
    # Coerce every entry to a string (docname) -- defensive; the editor sends strings.
    wp = [str(w) for w in wp]

    frappe.db.set_value("BoQ Template Sheet", child.name, "work_packages", json.dumps(wp))

    _touch_master(template)
    frappe.db.commit()

    return {"status": "saved", "work_packages": wp}
