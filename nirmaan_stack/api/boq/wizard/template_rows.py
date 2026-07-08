# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""
Template-flow row create / delete -- renumber-on-insert (ADR-0013 D6, task T4).

Two whitelisted endpoints, TEMPLATE-ORIGIN ONLY (origin == "template"):

  create_review_row(boq_name, sheet_name, anchor_row_index, position, classification,
                    parent_index, description=None, unit=None) -> {status, new_row_index}
      Insert a user-created ("synthetic") BoQ Review Row above/below an anchor by
      RENUMBERING the sheet's row_index keyspace: every row at row_index >= the
      insertion point shifts +1, and every parent pointer (parent_index, human_parent)
      that referenced a shifted row is remapped +1 -- all in one transaction so the
      parent tree is never left dangling. The new row is auto-selected (is_excluded=0),
      flagged is_synthetic=1, and carries no source-row provenance.

  delete_review_row(boq_name, sheet_name, row_index) -> {status}
      Delete a USER-CREATED row (is_synthetic=1 only; a template/parser row is removed
      via deselect, never delete) and REVERSE-renumber: every row at row_index > the
      deleted index shifts -1, and pointers are remapped. A child that pointed AT the
      deleted row is re-pointed to the deleted row's own (effective) parent so the tree
      stays connected (see _delete_remap).

Why renumber (not a sort_order column): ADR-0013 D6 -- row_index IS the pre-commit sort
order; the rewrite is atomic, fully remapped, pre-commit, and the client re-fetches.
Nothing persists row_index across the finalize boundary.

Guards on BOTH endpoints (in order): required-param validation; BOQs exists;
origin == "template" (this flow only); review_screen._guard_sheet_not_frozen (a
Finalized sheet is read-only); draft_lock.acquire_or_refresh (single-editor draft lock,
shares this request's transaction). frappe.db.commit() after the DML.

sheet_name is matched VERBATIM everywhere (#152 -- trailing/leading spaces are real
identity; never .trim()). The classification of a new row must be one of the 4 ASSIGNABLE
classes (reused from review_screen, not re-listed here).
"""
from __future__ import annotations

import frappe
from frappe.utils import now_datetime

from nirmaan_stack.api.boq.wizard import draft_lock, review_screen
from nirmaan_stack.api.boq.wizard.review_screen import _ASSIGNABLE_CLASSIFICATIONS

# PARITY NOTE (A-T5): the pure renumber/remap pointer math (_insert_shift,
# _delete_remap, _insert_shift_attached, _delete_remap_attached) was EXTRACTED
# VERBATIM into row_renumber.py so the template-editor path (template_edit.py on
# BoQ Template Row) shares the exact same core -- one parametric core, two thin callers
# (ADR-0010 F3-lite). The behaviour here is byte-identical to the pre-extraction
# copies; test_template_rows.py's 17 tests defend it. Do NOT re-inline a private copy.
from nirmaan_stack.api.boq.wizard.row_renumber import (
    _delete_remap,
    _delete_remap_attached,
    _insert_shift,
    _insert_shift_attached,
)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _guard_template_write(boq_name: str, sheet_name: str) -> None:
    """Shared guard chain for both endpoints (ADR-0013 D6).

    Order: required params -> BOQs exists -> origin == "template" -> not-frozen ->
    acquire the draft single-editor lock. The origin assert fails fast BEFORE the
    freeze/lock work so an upload-origin BoQ can never renumber its keyspace. The lock
    is acquired LAST (after the freeze guard, before any write) and shares this
    request's transaction -- exactly the ordering save_review_edit uses.
    """
    if not boq_name:
        frappe.throw("boq_name is required.", title="Missing field: boq_name")
    if not sheet_name:
        frappe.throw("sheet_name is required.", title="Missing field: sheet_name")
    if not frappe.db.exists("BOQs", boq_name):
        frappe.throw(f"BOQs '{boq_name}' not found.", title="Not found")

    # Template-flow ONLY. An upload-origin BoQ must never create/delete rows: its
    # re-parse deletes-and-regenerates the whole sheet and would destroy any inserted
    # row (ADR-0013 D6). origin is a BOQ-level marker (D4), so ONE check gates both.
    origin = frappe.db.get_value("BOQs", boq_name, "origin")
    if origin != "template":
        frappe.throw(
            "Row create/delete is only available for template-origin BoQs.",
            title="Not a template BoQ",
        )

    # Finalized sheet == read-only (Slice D1 freeze). Reuse review_screen's guard so the
    # frozen-write message is identical across every draft write path.
    review_screen._guard_sheet_not_frozen(boq_name, sheet_name)

    # Draft-tier single-editor lock (B1 / ADR-0011): reject if another user holds this
    # (boq, sheet) draft fresh; refresh/acquire for the holder. Writes go through this
    # request's transaction (the endpoint owns the single trailing commit).
    draft_lock.acquire_or_refresh(boq_name, sheet_name, frappe.session.user, now_datetime())


def _load_pointer_rows(boq_name: str, sheet_name: str) -> list:
    """Load every BoQ Review Row for (boq, sheet_name VERBATIM) with only the fields the
    renumber/remap needs: name, row_index, parent_index, human_parent. Ordered by
    row_index for determinism (row_index is NOT a PG reserved word -- safe to order_by)."""
    return frappe.db.get_all(
        "BoQ Review Row",
        filters={"boq": boq_name, "sheet_name": sheet_name},
        fields=["name", "row_index", "parent_index", "human_parent", "attached_to_index"],
        order_by="row_index asc",
    )


# The four pure pointer-remap helpers (_insert_shift, _delete_remap,
# _insert_shift_attached, _delete_remap_attached) now live in row_renumber.py and are
# imported at the top of this module -- see the PARITY NOTE there. They are used below
# unchanged.


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@frappe.whitelist(methods=["POST"])
def create_review_row(
    boq_name: str = None,
    sheet_name: str = None,
    anchor_row_index=None,
    position: str = None,
    classification: str = None,
    parent_index=None,
    description: str = None,
    unit: str = None,
) -> dict:
    """Insert a user-created BoQ Review Row above/below an anchor via renumber-on-insert.

    Params (HTTP -- ints arrive as strings and are coerced):
      anchor_row_index -- the reference row's current row_index.
      position         -- "above" | "below". insertion_index = anchor (above) or
                          anchor + 1 (below).
      classification   -- one of the 4 ASSIGNABLE classes (line_item / preamble / note /
                          spacer); parser-only classes are rejected.
      parent_index     -- the NEW row's parent, as a CURRENT (pre-insert) row_index, or
                          -1 / blank for root. It is remapped through the same insert-shift
                          as every other pointer, so it stays valid after renumbering.
      description, unit -- optional text; blank -> None.

    RENUMBER (one transaction): every existing row at row_index >= insertion_index shifts
    +1; parent_index / human_parent pointers into that range shift +1. The new row is then
    inserted at row_index=insertion_index with is_excluded=0, is_synthetic=1, no
    source_row_number, human_parent=-1, chosen_source="parser".

    Returns {"status": "saved", "new_row_index": insertion_index}.
    URL: /api/method/nirmaan_stack.api.boq.wizard.template_rows.create_review_row
    """
    if anchor_row_index is None:
        frappe.throw("anchor_row_index is required.", title="Missing field: anchor_row_index")
    if position not in ("above", "below"):
        frappe.throw("position must be 'above' or 'below'.", title="Invalid position")
    if not classification:
        frappe.throw("classification is required.", title="Missing field: classification")
    if classification not in _ASSIGNABLE_CLASSIFICATIONS:
        frappe.throw(
            f"'{classification}' is not an assignable classification; allowed: "
            f"{', '.join(sorted(_ASSIGNABLE_CLASSIFICATIONS))}.",
            title="Invalid classification",
        )

    # Guards (validate params BEFORE origin/freeze/lock work); template-origin only.
    _guard_template_write(boq_name, sheet_name)

    try:
        anchor_row_index = int(anchor_row_index)
    except (ValueError, TypeError):
        frappe.throw("anchor_row_index must be an integer.", title="Invalid anchor_row_index")

    # parent_index: blank / None -> -1 (root); else an int reference in the PRE-insert keyspace.
    if parent_index is None or parent_index == "":
        parent_index = -1
    else:
        try:
            parent_index = int(parent_index)
        except (ValueError, TypeError):
            frappe.throw("parent_index must be an integer.", title="Invalid parent_index")

    # The anchor must be a real row in this sheet (insertion is positioned relative to it).
    if not frappe.db.exists(
        "BoQ Review Row",
        {"boq": boq_name, "sheet_name": sheet_name, "row_index": anchor_row_index},
    ):
        frappe.throw(
            f"Anchor row_index {anchor_row_index} does not exist in sheet '{sheet_name}'.",
            title="Invalid anchor",
        )

    # A real parent (>= 0) must reference an existing row in this sheet (pre-insert keyspace).
    if parent_index >= 0 and not frappe.db.exists(
        "BoQ Review Row",
        {"boq": boq_name, "sheet_name": sheet_name, "row_index": parent_index},
    ):
        frappe.throw(
            f"Parent row_index {parent_index} does not exist in sheet '{sheet_name}'.",
            title="Invalid parent",
        )

    insertion_index = anchor_row_index if position == "above" else anchor_row_index + 1

    # --- Renumber-on-insert: shift row_index + remap pointers for every affected row ---
    rows = _load_pointer_rows(boq_name, sheet_name)
    for r in rows:
        old_idx = r.row_index
        new_idx = old_idx + 1 if old_idx >= insertion_index else old_idx
        new_parent = _insert_shift(r.parent_index, insertion_index)
        new_human_parent = _insert_shift(r.human_parent, insertion_index)
        new_attached = _insert_shift_attached(r.attached_to_index, insertion_index)
        changed = {}
        if new_idx != old_idx:
            changed["row_index"] = new_idx
        if new_parent != r.parent_index:
            changed["parent_index"] = new_parent
        if new_human_parent != r.human_parent:
            changed["human_parent"] = new_human_parent
        if new_attached != r.attached_to_index:
            changed["attached_to_index"] = new_attached
        if changed:
            frappe.db.set_value("BoQ Review Row", r.name, changed)

    # The new row's parent was a PRE-insert reference -- remap it through the same shift so
    # it still points at the intended row after the renumber.
    new_row_parent = _insert_shift(parent_index, insertion_index)

    # --- Insert the new synthetic row at the freed insertion_index ---
    doc = frappe.new_doc("BoQ Review Row")
    doc.boq = boq_name
    doc.sheet_name = sheet_name
    doc.row_index = insertion_index
    doc.source_row_number = None  # user-created: no source workbook row
    doc.classification = classification
    doc.parent_index = new_row_parent
    doc.human_parent = -1          # -1 sentinel: no human override
    doc.human_is_root = 0
    doc.level = 0                  # derived on read (derive_effective_levels) / at commit
    doc.path = ""
    doc.description = description or None
    doc.unit = unit or None
    doc.is_excluded = 0            # auto-selected
    doc.is_synthetic = 1          # user-created (the delete-eligibility signal)
    doc.chosen_source = "parser"
    doc.insert(ignore_permissions=True)

    frappe.db.commit()

    return {"status": "saved", "new_row_index": insertion_index}


@frappe.whitelist(methods=["POST"])
def delete_review_row(boq_name: str = None, sheet_name: str = None, row_index=None) -> dict:
    """Delete a USER-CREATED BoQ Review Row and reverse-renumber the sheet.

    ONLY a synthetic row (is_synthetic=1) may be deleted -- a template/parser row is
    removed from the commit set via DESELECT (is_excluded), never destroyed. Attempting
    to delete a non-synthetic row throws.

    REVERSE-renumber (one transaction): the deleted row's children (any row pointing at
    deleted_index via parent_index or human_parent) are re-pointed to the deleted row's
    own effective parent (grandparent) so the tree stays connected; then every row at
    row_index > deleted_index shifts -1 and pointers into that range shift -1.

    Returns {"status": "deleted"}.
    URL: /api/method/nirmaan_stack.api.boq.wizard.template_rows.delete_review_row
    """
    if row_index is None:
        frappe.throw("row_index is required.", title="Missing field: row_index")

    _guard_template_write(boq_name, sheet_name)

    try:
        row_index = int(row_index)
    except (ValueError, TypeError):
        frappe.throw("row_index must be an integer.", title="Invalid row_index")

    target = frappe.db.get_value(
        "BoQ Review Row",
        {"boq": boq_name, "sheet_name": sheet_name, "row_index": row_index},
        ["name", "is_synthetic", "parent_index", "human_parent"],
        as_dict=True,
    )
    if not target:
        frappe.throw(
            f"Row with row_index={row_index} not found in sheet '{sheet_name}'.",
            title="Row not found",
        )
    # Only user-created rows are deletable; template/parser rows are deselected, not deleted.
    if not target.is_synthetic:
        frappe.throw(
            "Only user-created rows can be deleted. Deselect a template row instead.",
            title="Cannot delete template row",
        )

    deleted_index = row_index
    # The deleted row's EFFECTIVE parent (grandparent for its orphaned children): a real
    # human override wins over the parser parent_index; if neither is set (both -1) the
    # children become roots. Pre-delete keyspace -- _delete_remap applies the shift after.
    if target.human_parent is not None and target.human_parent >= 0:
        grandparent = target.human_parent
    elif target.parent_index is not None and target.parent_index >= 0:
        grandparent = target.parent_index
    else:
        grandparent = -1

    rows = _load_pointer_rows(boq_name, sheet_name)

    # Delete the row first (direct SQL delete -- BoQ Review Row has no controller hooks or
    # child tables), then remap the remaining snapshot.
    frappe.db.delete("BoQ Review Row", {"name": target.name})

    for r in rows:
        if r.name == target.name:
            continue
        old_idx = r.row_index
        new_idx = old_idx - 1 if old_idx > deleted_index else old_idx
        new_parent = _delete_remap(r.parent_index, deleted_index, grandparent)
        new_human_parent = _delete_remap(r.human_parent, deleted_index, grandparent)
        new_attached = _delete_remap_attached(r.attached_to_index, deleted_index)
        changed = {}
        if new_idx != old_idx:
            changed["row_index"] = new_idx
        if new_parent != r.parent_index:
            changed["parent_index"] = new_parent
        if new_human_parent != r.human_parent:
            changed["human_parent"] = new_human_parent
        if new_attached != r.attached_to_index:
            changed["attached_to_index"] = new_attached
        if changed:
            frappe.db.set_value("BoQ Review Row", r.name, changed)

    frappe.db.commit()

    return {"status": "deleted"}
