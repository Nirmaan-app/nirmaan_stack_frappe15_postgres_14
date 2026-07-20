# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""BoQ "Create from Template" -- row selection + two-direction cascade (T3 / ADR-0013 D5).

Selection persists as the `is_excluded` Check on `BoQ Review Row` (default 0 = selected;
inert for upload-origin BOQs). This module owns the single write path that toggles it with
the two cascades D5 mandates, both computed over the EFFECTIVE parent graph
(`review_screen.resolve_effective` -> effective_parent_index, which honours human / AI /
parser layers exactly like the review tree the user sees):

  - DESELECT (excluded truthy): exclude the target row AND its entire descendant subtree.
  - SELECT   (excluded falsy):  include the target row AND its ancestor preamble chain, so a
                                selected line item can never be an orphan under an excluded
                                group (structural error #8). Every ancestor up the chain is
                                pulled back in to keep the tree connected.

Only ELIGIBLE rows (effective_classification in {preamble, line_item}) STORE the flag;
non-eligible rows (note / spacer / subtotal_marker / header_repeat) RIDE ALONG with their
nearest eligible ancestor and are derived at read / commit, never written here (D5). The
graph MATH lives in the two PURE, frappe-free module-level helpers `_descendants` /
`_ancestor_chain` (cycle-safe via a visited set) -- these mirror the frontend
`templateSelection.ts` cascade to be built in Wave 3 (F1 parity target); keep them pure.

Guards mirror every review_screen write endpoint: BOQs-exists, origin == 'template'
(template-flow only), `_guard_sheet_not_frozen` + `_guard_sheet_not_parsing`, and the
draft-tier single-editor lock (`draft_lock.acquire_or_refresh`) AFTER the freeze guards and
BEFORE the write. `frappe.db.commit()` runs after the writes. sheet_name is matched VERBATIM
(#152) -- never trimmed for identity.
"""
from __future__ import annotations

import frappe
from frappe.utils import now_datetime

from nirmaan_stack.api.boq.wizard import draft_lock
from nirmaan_stack.api.boq.wizard.review_screen import (
    resolve_effective,
    _guard_sheet_not_frozen,
    _guard_sheet_not_parsing,
)

# Classes whose selection is STORED as is_excluded. Everything else (note / spacer /
# subtotal_marker / header_repeat) rides along with its nearest eligible ancestor and is
# derived at read / commit -- never written by the cascade (D5).
_ELIGIBLE_CLASSIFICATIONS: frozenset[str] = frozenset({"preamble", "line_item"})


# ---------------------------------------------------------------------------
# Pure cascade helpers (no frappe) -- F1 parity target with templateSelection.ts
# ---------------------------------------------------------------------------

def _build_children_map(parent_map: dict[int, int | None]) -> dict[int, list[int]]:
    """Invert `parent_map` (row_index -> effective_parent_index|None) into
    parent_index -> [child row_index, ...]. Rows with no parent (None) contribute
    no edge. Pure."""
    children: dict[int, list[int]] = {}
    for node, parent in parent_map.items():
        if parent is not None:
            children.setdefault(parent, []).append(node)
    return children


def _descendants(parent_map: dict[int, int | None], root: int) -> set[int]:
    """Return the set of ALL descendants of `root` in the effective parent graph
    (EXCLUDES `root` itself). Cycle-safe: a `visited` set (seeded with `root`) stops any
    loop from recursing forever, and never re-adds `root` if a descendant points back at it.

    `parent_map` maps row_index -> effective_parent_index (or None for a top-level row).
    Pure -- no frappe. Mirrors the frontend templateSelection.ts subtree walk (F1 parity)."""
    children = _build_children_map(parent_map)
    result: set[int] = set()
    visited: set[int] = {root}
    stack: list[int] = list(children.get(root, []))
    while stack:
        node = stack.pop()
        if node in visited:
            continue
        visited.add(node)
        result.add(node)
        stack.extend(children.get(node, []))
    return result


def _ancestor_chain(parent_map: dict[int, int | None], node: int) -> set[int]:
    """Return the set of ALL ancestors of `node`, walking effective_parent_index upward
    (EXCLUDES `node` itself). Cycle-safe: a `visited` set (seeded with `node`) stops the
    walk the moment the chain revisits any already-seen row (incl. `node`), so a cyclic or
    self-referential parent pointer terminates cleanly.

    `parent_map` maps row_index -> effective_parent_index (or None for a top-level row).
    Pure -- no frappe. Mirrors the frontend templateSelection.ts ancestor walk (F1 parity)."""
    result: set[int] = set()
    visited: set[int] = {node}
    cur = parent_map.get(node)
    while cur is not None and cur not in visited:
        visited.add(cur)
        result.add(cur)
        cur = parent_map.get(cur)
    return result


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------

@frappe.whitelist(methods=["POST"])
def set_row_excluded(
    boq_name: str = None,
    sheet_name: str = None,
    row_index=None,
    excluded=None,
) -> dict:
    """Toggle a BoQ Review Row's `is_excluded` selection flag with the D5 two-direction
    cascade, then return the FULL updated selection sets for the sheet.

    Args:
      boq_name    -- the (template-origin) BOQs docname.
      sheet_name  -- matched VERBATIM (#152); never trimmed for identity.
      row_index   -- the toggled row's 0-based row_index within the sheet (int-coerced).
      excluded    -- truthy => DESELECT (exclude row + descendant subtree); falsy => SELECT
                     (include row + ancestor preamble chain). HTTP strings "1"/"true"/"yes"
                     (case-insensitive) count as truthy.

    Cascade (both directions computed over the EFFECTIVE parent graph):
      DESELECT -> is_excluded=1 on the target + `_descendants(...)`.
      SELECT   -> is_excluded=0 on the target + `_ancestor_chain(...)`.
    Only ELIGIBLE rows (effective_classification in {preamble, line_item}) are written; a
    non-eligible row in the affected set rides along and is left untouched (D5). Writes use
    frappe.db.set_value (a selection flag is annotation, NOT a data edit -- it must not stamp
    edited_at / edit_log or re-open advisory flags, mirroring save_review_remark).

    Guards: BOQs-exists, origin == 'template', _guard_sheet_not_frozen,
    _guard_sheet_not_parsing, and the draft single-editor lock. commits after the writes.

    Returns:
      {"status": "saved",
       "excluded_indices": [...],   # every row_index in the sheet with is_excluded=1
       "included_indices": [...]}   # every row_index in the sheet with is_excluded=0
      (raw stored partition over ALL rows; the frontend derives ride-along display state for
      non-eligible rows from their nearest eligible ancestor.)

    URL: /api/method/nirmaan_stack.api.boq.wizard.template_select.set_row_excluded
    """
    if not boq_name:
        frappe.throw("boq_name is required.", title="Missing field: boq_name")
    if not sheet_name:
        frappe.throw("sheet_name is required.", title="Missing field: sheet_name")
    if row_index is None:
        frappe.throw("row_index is required.", title="Missing field: row_index")

    # Coerce `excluded` -- HTTP delivers it as a string. Mirror the mark_ai_accepted coercion.
    if isinstance(excluded, str):
        excluded_bool = excluded.strip().lower() in ("1", "true", "yes")
    else:
        excluded_bool = bool(excluded)

    try:
        row_index = int(row_index)
    except (ValueError, TypeError):
        frappe.throw("row_index must be an integer.", title="Invalid row_index")

    if not frappe.db.exists("BOQs", boq_name):
        frappe.throw(f"BOQs '{boq_name}' not found.", title="Not found")

    # Template-flow ONLY: selection is inert for upload-origin BOQs (is_excluded default 0).
    origin = frappe.db.get_value("BOQs", boq_name, "origin")
    if origin != "template":
        frappe.throw(
            "Row selection is only available for template-origin BoQs.",
            title="Not a template BoQ",
        )

    # Freeze guards BEFORE the lock + write (mirrors every review_screen write endpoint).
    _guard_sheet_not_frozen(boq_name, sheet_name)
    _guard_sheet_not_parsing(boq_name, sheet_name)

    # Draft-tier single-editor lock (B1 / ADR-0011): reject if another user is editing this
    # sheet's draft fresh; refresh/acquire for the holder. After the freeze guards, before
    # the write; shares this request's transaction.
    draft_lock.acquire_or_refresh(boq_name, sheet_name, frappe.session.user, now_datetime())

    # --- Load the whole sheet once; build the effective parent graph + eligibility +
    #     current is_excluded state (reused for the cascade, the writes, and the return
    #     sets). sheet_name VERBATIM (#152). Mirrors the save_review_edit cycle-guard fetch,
    #     extended with the AI layer (so the graph matches the rendered review tree) plus
    #     name + is_excluded for the write / return. ---
    sheet_rows = frappe.db.get_all(
        "BoQ Review Row",
        filters={"boq": boq_name, "sheet_name": sheet_name},
        fields=[
            "name", "row_index", "is_excluded",
            "classification", "human_classification",
            "parent_index", "human_parent", "human_is_root",
            "ai_suggestion_status", "ai_suggested_classification",
            "ai_suggested_parent", "ai_suggested_is_root",
        ],
    )

    parent_map: dict[int, int | None] = {}
    eff_class: dict[int, str] = {}
    name_by_idx: dict[int, str] = {}
    excluded_by_idx: dict[int, int] = {}
    for r in sheet_rows:
        idx = int(r.row_index)
        eff = resolve_effective(r)
        parent_map[idx] = eff["effective_parent_index"]
        eff_class[idx] = eff["effective_classification"]
        name_by_idx[idx] = r.name
        excluded_by_idx[idx] = 1 if r.is_excluded else 0

    if row_index not in name_by_idx:
        frappe.throw(
            f"Row with row_index={row_index} not found in sheet '{sheet_name}'.",
            title="Row not found",
        )

    # --- Compute the affected set from the correct cascade direction. ---
    if excluded_bool:
        # DESELECT: the row + its entire descendant subtree drop out.
        affected = {row_index} | _descendants(parent_map, row_index)
        new_val = 1
    else:
        # SELECT: the row + its ancestor chain come back in (keeps the tree connected so no
        # selected line item is left orphaned under an excluded preamble -- structural #8).
        affected = {row_index} | _ancestor_chain(parent_map, row_index)
        new_val = 0

    # --- Write is_excluded on the ELIGIBLE rows of the affected set only; skip no-ops and
    #     ride-along (non-eligible) rows. set_value (not doc.save): a selection flag is
    #     annotation, not a data edit -- no provenance / edit_log / flag-dismissal churn. ---
    for idx in affected:
        if eff_class.get(idx) not in _ELIGIBLE_CLASSIFICATIONS:
            continue  # ride-along: derived at read/commit, never stored (D5)
        if excluded_by_idx.get(idx) == new_val:
            continue  # already at the target value
        frappe.db.set_value(
            "BoQ Review Row", name_by_idx[idx], "is_excluded", new_val,
            update_modified=False,
        )
        excluded_by_idx[idx] = new_val

    frappe.db.commit()

    excluded_indices = sorted(i for i, v in excluded_by_idx.items() if v == 1)
    included_indices = sorted(i for i, v in excluded_by_idx.items() if v == 0)
    return {
        "status": "saved",
        "excluded_indices": excluded_indices,
        "included_indices": included_indices,
    }
