"""The rules of a BOQ Line Estimate -- the materials one BOQ line item needs (New Estimations).

Pure (ADR-0010 B1): no `frappe.db`, no request context. Every function takes plain values and returns a
problem sentence, or None when the input is fine. The controller (`integrations/controllers/boq_line_estimate.py`)
loads what these need, calls them, and throws the first problem.

Owner rulings these encode (plan "BOQ Estimates", decisions F, G, H, I):
  * F -- an estimate belongs to a BOQ line item (node_type "Line Item") on the sheet's current version.
  * G -- the same Items record may appear twice only with different makes; a custom item only once per
    name + unit (case and surrounding spaces ignored).
  * H -- whole numbers only for the units counted in pieces (`WHOLE_NUMBER_UNITS`).
  * I -- estimates are read-only on Completed and Handover projects.
"""

import math

ITEM_TYPE_NORMAL = "Normal"
ITEM_TYPE_CUSTOM = "Custom"
ITEM_TYPES = (ITEM_TYPE_NORMAL, ITEM_TYPE_CUSTOM)

LINE_ITEM_NODE_TYPE = "Line Item"

# Decision A. The only BOQ status the Estimates tab shows, and so the only one estimates are saved on.
SELECTED_BOQ_STATUS = "Selected"

# Decision I. Project statuses on which estimates can no longer be added, changed or deleted.
READ_ONLY_PROJECT_STATUSES = ("Completed", "Handover")

# Decision H. Compared lower-cased and trimmed. The units list holds "NOS" today; "set" is kept for when it is added.
WHOLE_NUMBER_UNITS = ("nos", "set")


def _clean(value) -> str:
    return (value or "").strip()


def line_problem(node: dict | None) -> str | None:
    """Why `node` (a BOQ Nodes row as {node_type, is_current}) cannot hold an estimate, or None."""
    if not node:
        return "This BOQ line item no longer exists."
    if node.get("node_type") != LINE_ITEM_NODE_TYPE:
        return "Estimates can only be added to line items, not to headings, notes or subtotals."
    if not node.get("is_current"):
        return (
            "This BOQ line item is on an older version of the sheet, because the sheet was committed again. "
            "Re-attach the estimate to the current line item before changing it."
        )
    return None


def boq_problem(boq_status: str | None) -> str | None:
    """Why estimates cannot be saved on a BOQ in `boq_status`, or None. The Estimates tab shows Selected BOQs only
    (decision A, owner 11 Nov); the server refuses the rest too, so a save through the API cannot reach a BOQ the
    screens never show (review issue 5). Deleting is not refused: leftovers on a BOQ that stopped being Selected
    can still be cleared."""
    if _clean(boq_status) != SELECTED_BOQ_STATUS:
        return f"Estimates can only be saved on a Selected BOQ. This BOQ is {_clean(boq_status) or 'not set'}."
    return None


def project_problem(project_status: str | None) -> str | None:
    """Why estimates on a project in `project_status` cannot be changed (decision I), or None."""
    if _clean(project_status) in READ_ONLY_PROJECT_STATUSES:
        return f"Estimates are read-only on a {_clean(project_status)} project."
    return None


def is_whole_number_unit(unit: str | None) -> bool:
    """True for a unit counted in whole pieces (decision H)."""
    return _clean(unit).lower() in WHOLE_NUMBER_UNITS


def item_row_problem(row: dict) -> str | None:
    """Why one item row is not valid on its own, or None.

    `row` carries item_type, item_id, item_name, unit, category and quantity. For a Normal row the caller has
    already filled item_name, unit and category from the Items record.
    """
    item_type = _clean(row.get("item_type"))
    if item_type not in ITEM_TYPES:
        return "Choose Normal or Custom as the item type."
    if item_type == ITEM_TYPE_NORMAL:
        if not _clean(row.get("item_id")):
            return "Pick an item from the Items list."
    else:
        if _clean(row.get("item_id")):
            return "A custom item cannot point to an Items record. Change its type to Normal."
        if not _clean(row.get("item_name")):
            return "Type the custom item's name."
        if not _clean(row.get("unit")):
            return "Choose the custom item's unit."
        if not _clean(row.get("category")):
            return "Choose the custom item's category."
    quantity = row.get("quantity")
    try:
        quantity = float(quantity)
    except (TypeError, ValueError):
        return "Enter a quantity above 0."
    # isfinite: JSON accepts Infinity and NaN; int(inf) would raise below instead of returning a message.
    if not math.isfinite(quantity) or not quantity > 0:
        return "Enter a quantity above 0."
    if is_whole_number_unit(row.get("unit")) and quantity != int(quantity):
        return f"{_clean(row.get('unit'))} is counted in whole numbers. Enter a quantity without decimals."
    return None


def reattach_matches(older: list[dict], current: list[dict], taken: set) -> tuple[dict, list[dict]]:
    """Decision M: match estimates left on an older version of a sheet to the sheet's current line items.

    `older` holds {estimate, excel_row, description} for each estimate whose line item was frozen by a
    re-commit; `current` holds {node, excel_row, description} for the sheet's current line items; `taken`
    names current line items that already have an estimate. A match needs the same Excel row AND identical
    description text (99.2% of re-committed lines in the 6 Nov dry run). Each current line item takes at most
    one estimate; nothing is guessed. When two older estimates want the same line (the sheet was committed twice
    without a Re-attach in between), the newest wins: higher `version` (the sheet's commit version), then later
    `modified`. Returns ({estimate: node}, [unmatched older rows, by Excel row]).
    """
    by_row: dict = {}
    for line in current:
        by_row.setdefault(line.get("excel_row"), []).append(line)
    used = set(taken)
    moves: dict = {}
    unmatched: list[dict] = []
    newest_first = sorted(older, key=lambda o: (o.get("version") or 0, str(o.get("modified") or "")), reverse=True)
    for old in newest_first:
        found = None
        for line in by_row.get(old.get("excel_row"), []):
            if line["node"] not in used and (line.get("description") or "") == (old.get("description") or ""):
                found = line["node"]
                break
        if found:
            moves[old["estimate"]] = found
            used.add(found)
        else:
            unmatched.append(old)
    unmatched.sort(key=lambda o: o.get("excel_row") or 0)
    return moves, unmatched


# The state of an estimate a re-commit left on an older version (owner, 11 Nov: Re-attach COPIES onto the new
# version and keeps the old one as a backup; Undo removes the copy; Remove old removes the backup).
STATE_CAN_COPY = "can_copy"  # its line is unchanged and has no estimate yet: Re-attach copies it there
STATE_COPIED = "copied"  # its line on the new version holds exactly its materials: Undo or Remove old
# Its unchanged line on the new version holds OTHER materials: a copy edited since, or materials typed there by
# hand -- nothing recorded tells the two apart (review issue 3). So it is never treated as a backup: not undone,
# not taken by "Remove all old", and offered like a changed line (Add to a line, or Remove), so no material that
# exists only here is lost.
STATE_LINE_HAS_OTHER = "line_has_other"
STATE_CHANGED = "changed"  # its line changed (or another older estimate took it): Add to a line, or Remove
# Its line item (or that line's sheet) was deleted from the BOQ tables, which an estimate does not prevent
# (hooks.py `ignore_links_on_delete`). Never copied; listed so it is not hidden: Add to a line, or Remove.
STATE_LINE_MISSING = "line_missing"


def items_signature(items: list[dict]) -> tuple:
    """What an estimate's materials are, ignoring row order and row names: two estimates with the same signature
    hold the same materials. A Normal row is its item, make, unit and quantity; a custom row its name, unit and
    quantity (case and surrounding spaces ignored)."""
    sig = []
    for row in items:
        normal = _clean(row.get("item_type")) == ITEM_TYPE_NORMAL
        key = _clean(row.get("item_id")) if normal else _clean(row.get("item_name")).lower()
        make = _clean(row.get("make")).lower() if normal else ""
        sig.append((normal, key, make, _clean(row.get("unit")).lower(), round(float(row.get("quantity") or 0), 6)))
    return tuple(sorted(sig))


def older_states(older: list[dict], current: list[dict], current_estimates: dict) -> dict:
    """The state of each older estimate of one sheet.

    `older` holds {estimate, excel_row, description, version, modified, items}; `current` the sheet's current line
    items as {node, excel_row, description}; `current_estimates` maps a current line item to the estimate on it as
    {estimate, items}. An older estimate's line on the new version is found by the Re-attach rule (same Excel row and
    text, newest first). Returns {estimate: {state, node, copy}}: `node` is that line (None when it changed) and
    `copy` the estimate on it, if any.
    """
    targets, _unmatched = reattach_matches(older, current, set())
    out = {}
    for old in older:
        node = targets.get(old["estimate"])
        if not node:
            out[old["estimate"]] = {"state": STATE_CHANGED, "node": None, "copy": None}
            continue
        on_line = current_estimates.get(node)
        if not on_line:
            state, copy = STATE_CAN_COPY, None
        elif items_signature(on_line["items"]) == items_signature(old.get("items") or []):
            state, copy = STATE_COPIED, on_line["estimate"]
        else:
            state, copy = STATE_LINE_HAS_OTHER, on_line["estimate"]
        out[old["estimate"]] = {"state": state, "node": node, "copy": copy}
    return out


def duplicate_key(row: dict) -> tuple:
    """The key two rows of one estimate may not share (decision G)."""
    if _clean(row.get("item_type")) == ITEM_TYPE_NORMAL:
        return (ITEM_TYPE_NORMAL, _clean(row.get("item_id")), _clean(row.get("make")))
    return (ITEM_TYPE_CUSTOM, _clean(row.get("item_name")).lower(), _clean(row.get("unit")).lower())


def duplicate_problem(rows: list[dict]) -> str | None:
    """Why `rows` hold the same item twice (decision G), naming the item, or None."""
    seen = set()
    for row in rows:
        key = duplicate_key(row)
        if key in seen:
            name = _clean(row.get("item_name")) or _clean(row.get("item_id"))
            if key[0] == ITEM_TYPE_NORMAL:
                return f'"{name}" is in this estimate twice with the same make. Change one make, or merge the quantities.'
            return f'The custom item "{name}" is in this estimate twice. Merge the quantities into one row.'
        seen.add(key)
    return None
