"""
BoQ Wizard -- review flags (S3, ADR-0033).

After a parse Claude checks each sheet by itself (S2). This module turns its answers into the
review rules:

* SURE CHANGES (apply_sure_changes) -- a High-confidence "preamble -> line_item" answer is written
  into the PARSED result; the parser's own type is kept in the hidden `parser_classification`.
* FLAGS (row_flags / sheet_flag_state) -- "Check type" and "Check parent". A flag is NEVER STORED:
  it is worked out from facts already on the row (Claude's answer, the parsed type and parent, the
  user's own change, the "Looks OK" mark, the edit history), so no edit path has to keep it up to
  date. The review data, the counts and the finalize block all read sheet_flag_state.
* LOOKS OK (mark_row_looks_ok / unmark_row_looks_ok) -- one row per call, tick and undo; there is
  deliberately no bulk form.
* FINALIZE BLOCK (guard_finalize) -- the last check of mark_sheet_parsed_check_done.
* REVERT CASCADE (plan_child_reverts / children_left_behind) -- the children a change of one row
  moved, for revert_to_parser (owner ruling R20), and the ones it does not bring back (R27).

Gemini is never read here.
"""
from __future__ import annotations

import json
import re
from typing import Any

import frappe
from frappe.utils import get_datetime, now_datetime

from nirmaan_stack.api.boq.wizard import ai_run_log, draft_lock
from nirmaan_stack.api.boq.wizard.review_screen import (
    _SHEET_FINALIZED,
    _affirm_fields,
    _apply_and_save_row_edit,
    _get_sheet_wizard_status,
    _guard_sheet_not_frozen,
    _row_has_override,
    resolve_effective,
)
from nirmaan_stack.api.boq.wizard.update_sheet_draft import _guard_sheet_not_parsing
from nirmaan_stack.services.boq_ai_assist import _row_has_qty
from nirmaan_stack.services.boq_revision.carry import COPIED
from nirmaan_stack.services.boq_revision.reasons import NEEDS_REVIEW

_REVIEW_ROW = "BoQ Review Row"

# Reason codes (S4 words them; no AI name, no suggestion text).
REASON_TYPE_DOUBT = "type_doubt"
REASON_UNIT_QTY = "unit_qty_not_item"
REASON_PARENT_DOUBT = "parent_doubt"

# A sheet is "heavy" when MORE than this share of its non-blank rows is flagged.
HEAVY_SHEET_PCT = 40.0
# The finalize refusal names at most this many rows, then "and N more".
REFUSAL_ROW_LIMIT = 20

CHECK_RUNNING_MESSAGE = (
    "The automatic check is still running on this sheet. Try again when it finishes."
)

_LINE_ITEM = "line_item"
_PREAMBLE = "preamble"
_SPACER = "spacer"
_SURE_CONFIDENCE = "High"

# The edit-history wording this module READS. Both are written elsewhere, by code this slice does
# not own, and are pinned by test_review_flags.TestHistoryWordingPins: a change to either wording
# must fail the suite, not silently change which flags are open.
#   - save_review_restructure stamps every child it re-maps "parent moved: row <N> reclassified ..."
#   - every revert path stamps its restores with a reason that contains "reverted".
CHILD_MOVE_REASON_PREFIX = "parent moved:"
REVERT_REASON_WORD = "reverted"
_CHILD_MOVE_RE = re.compile(r"^parent moved: row (\d+) reclassified")
_CASCADE_REVERT_RE = re.compile(r"^reverted with row (\d+)\b")

# Everything the rules read from a row. The finalize block and the counts fetch exactly this.
FLAG_FIELDS = [
    "name", "row_index", "source_row_number",
    "classification", "parent_index", "parser_classification",
    "human_classification", "human_parent", "human_is_root",
    "ai_suggestion_status", "ai_suggested_classification", "ai_classification_confidence",
    "ai_suggested_parent", "ai_suggested_is_root",
    "unit", "qty_total", "qty_by_area",
    "is_excluded", "revision_carry_status",
    "edit_log", "ai_flags_ok", "ai_flags_ok_at",
]


def cascade_revert_reason(row_index: int) -> str:
    """The history reason a child gets when it returns with the revert of row `row_index`."""
    return f"reverted with row {row_index} (parent restore)"


# ---------------------------------------------------------------------------
# Edit-history readers (pure)
# ---------------------------------------------------------------------------

def _get(row: Any, key: str) -> Any:
    if isinstance(row, dict):
        return row.get(key)
    return getattr(row, key, None)


def _log_entries(raw: Any) -> list:
    """The row's edit history as a list of dicts, whatever shape it arrived in."""
    if isinstance(raw, str):
        try:
            raw = json.loads(raw) if raw else []
        except (ValueError, TypeError):
            return []
    if not isinstance(raw, list):
        return []
    return [e for e in raw if isinstance(e, dict)]


def standing_parent_moves(edit_log: Any) -> list:
    """The parent changes of a row that still stand, oldest first.

    Each item: {"moved_by": <row index whose restructure moved this row, or None for the row's
    own change>, "from": <parent before, None = top level>}. A plain revert wipes the list (the
    row is back at its baseline); a cascade revert removes the moves the reverted row caused.
    """
    standing: list = []
    for entry in _log_entries(edit_log):
        if entry.get("field") != "human_parent":
            continue
        reason = entry.get("reason") or ""
        cascade = _CASCADE_REVERT_RE.match(reason)
        if cascade:
            owner = int(cascade.group(1))
            while standing and standing[-1]["moved_by"] == owner:
                standing.pop()
            continue
        if REVERT_REASON_WORD in reason:
            standing = []
            continue
        moved = _CHILD_MOVE_RE.match(reason)
        standing.append({
            "moved_by": int(moved.group(1)) if moved else None,
            "from": entry.get("from"),
        })
    return standing


def _has_parent_override(row: Any) -> bool:
    parent = _get(row, "human_parent")
    return bool(_get(row, "human_is_root")) or (parent is not None and int(parent) >= 0)


def user_changed_parent(row: Any) -> bool:
    """True when the row's standing parent is the USER's own choice -- not one the re-mapping of
    another row's children put there (R18: such a child keeps its "Check parent")."""
    if not _has_parent_override(row):
        return False
    standing = standing_parent_moves(_get(row, "edit_log"))
    return not standing or standing[-1]["moved_by"] is None


def user_changed_type(row: Any) -> bool:
    """True when a human type is stored AND it differs from the parsed one. "Change parent" also
    stores a human type, equal to the type the row already has; that is not a type change."""
    human = _get(row, "human_classification")
    return bool(human) and human != _get(row, "classification")


def looks_ok_holds(row: Any) -> bool:
    """The "Looks OK" mark counts until the row is reverted: a history entry whose reason contains
    "reverted", later than the mark, ends it. No revert path has to know about the mark."""
    if not _get(row, "ai_flags_ok"):
        return False
    marked_at = _get(row, "ai_flags_ok_at")
    if not marked_at:
        return True
    marked_at = get_datetime(marked_at)
    for entry in _log_entries(_get(row, "edit_log")):
        if REVERT_REASON_WORD not in (entry.get("reason") or "") or not entry.get("at"):
            continue
        if get_datetime(entry["at"]) > marked_at:
            return False
    return True


def plan_child_reverts(rows: list, row_index: int) -> list:
    """The children that return when row `row_index` is reverted (R20).

    A child returns when its LATEST standing parent change was made by a restructure of that row;
    a child the user moved again afterwards is left alone. Several moves by the same row are undone
    together, back to the parent the child had before the OLDEST of them.

    Returns [{"row_index", "name", "target"}], target = the parent to return to (None = top level).
    """
    plan: list = []
    for row in rows:
        child_index = _get(row, "row_index")
        if child_index is None or int(child_index) == row_index or not _has_parent_override(row):
            continue
        standing = standing_parent_moves(_get(row, "edit_log"))
        first = len(standing)
        while first > 0 and standing[first - 1]["moved_by"] == row_index:
            first -= 1
        if first == len(standing):
            continue
        plan.append({
            "row_index": int(child_index),
            "name": _get(row, "name"),
            "target": standing[first]["from"],
        })
    return plan


def children_left_behind(rows: list, row_index: int) -> list:
    """The children a restructure of row `row_index` moved that do NOT return when it is reverted,
    because a later move of the child still stands (the user's own, or another row's). The mirror
    of plan_child_reverts, for the revert's reply (R27). Returns the child row indexes, in row order.
    """
    returning = {item["row_index"] for item in plan_child_reverts(rows, row_index)}
    left: list = []
    for row in rows:
        child_index = _get(row, "row_index")
        if child_index is None or int(child_index) == row_index or int(child_index) in returning:
            continue
        if not _has_parent_override(row):
            continue
        standing = standing_parent_moves(_get(row, "edit_log"))
        if any(move["moved_by"] == row_index for move in standing):
            left.append(int(child_index))
    return left


# ---------------------------------------------------------------------------
# The flags (pure)
# ---------------------------------------------------------------------------

def _no_flags() -> dict:
    return {
        "check_type": False, "check_parent": False, "reasons": [], "doubts": [],
        "looks_ok": False, "checked": False,
    }


def row_flags(row: Any, check_status: str) -> dict:
    """The open flags of one row.

    check_type / check_parent -- the flag is OPEN.
    reasons  -- the reason codes of the open flags.
    doubts   -- every reason code that applies to the row, open or already dealt with.
    looks_ok -- the "Looks OK" mark is set and still counts.
    checked  -- the row was flagged and nothing is open any more.
    """
    out = _no_flags()
    # No run-log record for the sheet's current parse = parsed before this rule existed: no flags
    # until it is re-parsed (owner ruling Q-a).
    if check_status == ai_run_log.CHECK_NOT_RUN:
        return out
    if _get(row, "is_excluded") or _get(row, "revision_carry_status") == COPIED:
        return out

    parsed_type = _get(row, "classification")
    # Claude's answers count only when a run for THIS parse finished: a failed or unfinished check
    # leaves the unit / quantity rule alone (D1), and old suggestions never become flags (D4).
    answered = check_status == ai_run_log.CHECK_DONE and bool(_get(row, "ai_suggestion_status"))

    # A row Claude surely re-typed carries Claude's type as its parsed type, so the two are equal
    # and it has no type doubt -- unless a later run names yet another type.
    type_doubts: list = []
    claude_type = _get(row, "ai_suggested_classification")
    if answered and claude_type and claude_type != parsed_type:
        type_doubts.append(REASON_TYPE_DOUBT)
    if parsed_type != _LINE_ITEM and ((_get(row, "unit") or "").strip() or _row_has_qty(row)):
        type_doubts.append(REASON_UNIT_QTY)

    # The doubt is measured against the PARSED parent, so it does not come and go as the row is
    # moved; the flag is closed once the row sits on the parent Claude named, whoever put it there.
    parent_doubt = on_claudes_parent = False
    if answered:
        parsed_parent = _parsed_parent(row)
        current_parent = resolve_effective(row)["effective_parent_index"]
        claude_parent = _get(row, "ai_suggested_parent")
        if _get(row, "ai_suggested_is_root"):
            parent_doubt = parsed_parent is not None
            on_claudes_parent = current_parent is None
        elif claude_parent is not None and int(claude_parent) >= 0:
            parent_doubt = int(claude_parent) != parsed_parent
            on_claudes_parent = int(claude_parent) == current_parent

    if not type_doubts and not parent_doubt:
        return out

    looks_ok = looks_ok_holds(row)
    out["doubts"] = type_doubts + ([REASON_PARENT_DOUBT] if parent_doubt else [])
    out["looks_ok"] = looks_ok
    if type_doubts and not looks_ok and not user_changed_type(row):
        out["check_type"] = True
        out["reasons"].extend(type_doubts)
    if parent_doubt and not looks_ok and not on_claudes_parent and not user_changed_parent(row):
        out["check_parent"] = True
        out["reasons"].append(REASON_PARENT_DOUBT)
    out["checked"] = not (out["check_type"] or out["check_parent"])
    return out


def summarize(rows: list, flags_by_index: dict, check_status: str, running: bool = False) -> dict:
    """The sheet-level counts. `flagged_pct` is the share of NON-BLANK rows that carry any doubt,
    open or already checked -- it describes the sheet and does not fall as the user works."""
    non_blank = flagged = flagged_non_blank = 0
    kinds = {"type": 0, "parent": 0, "both": 0}
    # The same three kinds over EVERY flagged row, open or already checked: `by_kind` empties as
    # the user works, and the screen's "all checked" line still has to say what was flagged.
    flagged_kinds = {"type": 0, "parent": 0, "both": 0}
    open_rows: list = []
    for row in rows:
        if _get(row, "is_excluded"):
            continue
        blank = resolve_effective(row)["effective_classification"] == _SPACER
        if not blank:
            non_blank += 1
        flags = flags_by_index.get(_get(row, "row_index")) or _no_flags()
        if not flags["doubts"]:
            continue
        flagged += 1
        if not blank:
            flagged_non_blank += 1
        parent_doubted = REASON_PARENT_DOUBT in flags["doubts"]
        type_doubted = any(reason != REASON_PARENT_DOUBT for reason in flags["doubts"])
        flagged_kinds["both" if type_doubted and parent_doubted else "type" if type_doubted else "parent"] += 1
        if flags["check_type"] and flags["check_parent"]:
            kinds["both"] += 1
        elif flags["check_type"]:
            kinds["type"] += 1
        elif flags["check_parent"]:
            kinds["parent"] += 1
        else:
            continue
        open_rows.append(_get(row, "source_row_number"))
    pct = round(100.0 * flagged_non_blank / non_blank, 1) if non_blank else 0.0
    return {
        "check_status": check_status,
        "check_running": bool(running),
        "to_check": len(open_rows),
        "by_kind": kinds,
        "flagged_by_kind": flagged_kinds,
        "checked": flagged - len(open_rows),
        "flagged": flagged,
        "non_blank_rows": non_blank,
        "flagged_pct": pct,
        "heavy": pct > HEAVY_SHEET_PCT,
        "open_rows": open_rows,
    }


def flags_for_rows(rows: list, check_status: str) -> dict:
    return {_get(r, "row_index"): row_flags(r, check_status) for r in rows}


# ---------------------------------------------------------------------------
# Database readers
# ---------------------------------------------------------------------------

def _fetch_rows(boq_name: str, sheet_name: str | None = None) -> list:
    filters: dict = {"boq": boq_name}
    fields = list(FLAG_FIELDS)
    if sheet_name is not None:
        filters["sheet_name"] = sheet_name        # VERBATIM (#152)
    else:
        fields.append("sheet_name")
    return frappe.db.get_all(_REVIEW_ROW, filters=filters, fields=fields, order_by="row_index asc")


def sheet_flag_state(boq_name: str, sheet_name: str, rows: list | None = None) -> dict:
    """THE single reader: {"flags": {row_index: row_flags}, "summary": summarize(...)}.

    get_review_rows passes the rows it already holds; the finalize block and the counts fetch
    their own. They must all come through here, or a button and its refusal can disagree.
    """
    state = ai_run_log.check_state(boq_name, sheet_name)
    if rows is None:
        rows = _fetch_rows(boq_name, sheet_name)
    flags = flags_for_rows(rows, state["status"])
    return {"flags": flags, "summary": summarize(rows, flags, state["status"], state["running"])}


@frappe.whitelist()
def get_check_summary(boq_name: str = None) -> dict:
    """The sheet-level counts of every sheet of a BoQ that has review rows (hub, parse-done summary).

    Returns {"sheets": {<sheet_name>: <summarize() dict>}}. Read-only.
    URL: /api/method/nirmaan_stack.api.boq.wizard.review_flags.get_check_summary
    """
    if not boq_name:
        frappe.throw("boq_name is required.", title="Missing field: boq_name")
    if not frappe.db.exists("BOQs", boq_name):
        frappe.throw(f"BOQs '{boq_name}' not found.", title="Not found")

    by_sheet: dict = {}
    for row in _fetch_rows(boq_name):
        by_sheet.setdefault(row.sheet_name, []).append(row)
    states = ai_run_log.check_states(boq_name)
    sheets: dict = {}
    for sheet_name, rows in by_sheet.items():
        state = states.get(sheet_name) or {"status": ai_run_log.CHECK_NOT_RUN, "running": False}
        flags = flags_for_rows(rows, state["status"])
        sheets[sheet_name] = summarize(rows, flags, state["status"], state["running"])
    return {"sheets": sheets}


# ---------------------------------------------------------------------------
# Sure changes (AC1)
# ---------------------------------------------------------------------------

def apply_sure_changes(boq_name: str, sheet_name: str) -> int:
    """Write Claude's SURE "preamble -> line_item" answers into the parsed result. No commit.

    Called right after _apply_ai_suggestions, in the same transaction -- so a superseded run,
    which that function refuses, never reaches here. Returns the number of rows re-typed.

    NOT applied, and so left to the "Check type" flag:
      - any other type change, at any confidence, and every parent answer;
      - a row with a standing human or accepted-AI change (its type is the user's);
      - a row with a child that is itself a preamble: a sub-heading under an item is a must-fix
        error, which the user did not cause (owner ruling Q-f);
      - every row of a Finalized sheet, which is read-only (owner ruling Q-e).
    """
    if _get_sheet_wizard_status(boq_name, sheet_name) == _SHEET_FINALIZED:
        return 0
    rows = frappe.db.get_all(
        _REVIEW_ROW,
        filters={"boq": boq_name, "sheet_name": sheet_name},      # VERBATIM (#152)
        fields=[
            "name", "row_index", "classification", "parent_index", "parser_classification",
            "human_classification", "human_parent", "human_is_root",
            "ai_suggestion_status", "gemini_suggestion_status",
            "ai_suggested_classification", "ai_classification_confidence",
            "ai_suggested_parent", "ai_suggested_is_root",
        ],
        order_by="row_index asc",
    )
    preamble_parents = set()
    for row in rows:
        effective = resolve_effective(row)
        if (
            effective["effective_classification"] == _PREAMBLE
            and effective["effective_parent_index"] is not None
        ):
            preamble_parents.add(effective["effective_parent_index"])

    changed = 0
    for row in rows:
        if not (
            row.ai_suggestion_status
            and row.ai_suggested_classification == _LINE_ITEM
            and row.ai_classification_confidence == _SURE_CONFIDENCE
            and row.classification == _PREAMBLE
            and not row.parser_classification
        ):
            continue
        if _row_has_override(row) or row.row_index in preamble_parents:
            continue
        # Raw write on purpose: BoQ Review Row has no doc_events, and this is the parsed layer,
        # which a doc.save() would stamp as a human edit. Nothing stored is derived from the
        # parsed type: levels are derived on read (derive_effective_levels) and a note's
        # attachment follows its parent row whatever that row's type is.
        frappe.db.set_value(
            _REVIEW_ROW, row.name,
            {"classification": _LINE_ITEM, "parser_classification": _PREAMBLE},
            update_modified=False,
        )
        changed += 1
    return changed


# ---------------------------------------------------------------------------
# Revert cascade (R20) -- called only by review_screen.revert_to_parser
# ---------------------------------------------------------------------------

_CASCADE_FIELDS = [
    "name", "row_index", "source_row_number", "classification", "human_classification",
    "parent_index", "human_parent", "human_is_root", "edit_log", "revision_carry_status",
]


def revert_loop_message(row_excel: Any, child_excel: Any) -> str:
    return (
        f"Row {row_excel} can't be reverted yet: putting row {child_excel} back under it would "
        f"create a loop. Move row {child_excel} first, then revert again."
    )


def _cascade_rows(boq_name: str, sheet_name: str) -> list:
    return frappe.db.get_all(
        _REVIEW_ROW,
        filters={"boq": boq_name, "sheet_name": sheet_name},      # VERBATIM (#152)
        fields=_CASCADE_FIELDS,
        order_by="row_index asc",
    )


def _parsed_parent(row: Any) -> int | None:
    parent = _get(row, "parent_index")
    return None if parent in (None, -1) else int(parent)


def guard_child_reverts(boq_name: str, sheet_name: str, row_index: int) -> None:
    """Refuse the revert of `row_index` -- before anything is written -- when a child it would put
    back would end up above itself (owner ruling on R20: refuse, change nothing)."""
    rows = _cascade_rows(boq_name, sheet_name)
    plan = plan_child_reverts(rows, row_index)
    if not plan:
        return
    by_index = {int(r.row_index): r for r in rows}
    parents = {idx: resolve_effective(r)["effective_parent_index"] for idx, r in by_index.items()}
    # After its own revert the row sits under its parsed parent again.
    if row_index in by_index:
        parents[row_index] = _parsed_parent(by_index[row_index])
    for item in plan:
        parents[item["row_index"]] = item["target"]

    row_excel = _get(by_index.get(row_index), "source_row_number")
    for item in plan:
        child, target = item["row_index"], item["target"]
        if target is not None and target not in by_index:
            # Cannot happen on an uploaded BoQ (rows are never deleted there); refuse rather
            # than guess where the child belongs.
            frappe.throw(
                f"Row {row_excel} can't be reverted: the row its child was moved from no longer "
                f"exists.",
                title="Cannot revert",
            )
        seen = {child}
        current = target
        while current is not None:
            if current == child:
                frappe.throw(
                    revert_loop_message(row_excel, _get(by_index[child], "source_row_number")),
                    title="Cannot revert yet",
                )
            if current in seen:
                break       # a loop that was already there, not one this child would make
            seen.add(current)
            current = parents.get(current)


def children_not_returned(boq_name: str, sheet_name: str, row_index: int) -> list:
    """children_left_behind for a sheet's stored rows. Read by revert_to_parser BEFORE it writes."""
    return children_left_behind(_cascade_rows(boq_name, sheet_name), row_index)


def revert_moved_children(boq_name: str, sheet_name: str, row_index: int) -> list:
    """Put back the children the restructure(s) of `row_index` moved. No commit: the caller's
    single commit carries the row's own revert and these together.

    Each child goes back to the parent it had before the move; when that is its parsed parent the
    human parent is cleared, so the child is at its baseline again. Written through the shared
    chokepoint, with a "reverted" reason naming the row -- which also ends the child's "Looks OK".
    Returns the child row indexes, in row order.
    """
    rows = _cascade_rows(boq_name, sheet_name)
    reason = cascade_revert_reason(row_index)
    done: list = []
    for item in plan_child_reverts(rows, row_index):
        child = frappe.get_doc(_REVIEW_ROW, item["name"])
        target = item["target"]
        if target == _parsed_parent(child):
            _apply_and_save_row_edit(child, boq_name, sheet_name, "human_parent", None, reason=reason)
        elif target is None:
            _apply_and_save_row_edit(
                child, boq_name, sheet_name, "human_parent", None, reason=reason, set_root=True,
            )
        else:
            _apply_and_save_row_edit(
                child, boq_name, sheet_name, "human_parent", int(target), reason=reason,
            )
        if child.revision_carry_status == NEEDS_REVIEW:
            # The chokepoint counts any parent write as the reviewer's confirmation; a revert is
            # the opposite, exactly as for the row reverted directly.
            frappe.db.set_value(_REVIEW_ROW, child.name, _affirm_fields(False), update_modified=False)
        done.append(item["row_index"])
    return done


# ---------------------------------------------------------------------------
# Looks OK (AC3)
# ---------------------------------------------------------------------------

@frappe.whitelist(methods=["POST"])
def mark_row_looks_ok(boq_name: str = None, sheet_name: str = None, row_index=None) -> dict:
    """The reviewer's "Looks OK" on ONE flagged row: its open flags close.

    An acknowledgement, not a data edit: a direct column write, no edit history, the row stays
    "Original" (the same shape as affirm_revision_row). Refused on a Finalized sheet, while a
    parse is running, and on a row with no open flag -- so the mark is set only where it matters.
    There is deliberately NO bulk form and no "clear all" (owner ruling R13).

    Returns {ok, row_index, ai_flags_ok: 1}.
    URL: /api/method/nirmaan_stack.api.boq.wizard.review_flags.mark_row_looks_ok
    """
    if not boq_name:
        frappe.throw("boq_name is required.", title="Missing field: boq_name")
    if not sheet_name:
        frappe.throw("sheet_name is required.", title="Missing field: sheet_name")
    if row_index is None:
        frappe.throw("row_index is required.", title="Missing field: row_index")
    if not frappe.db.exists("BOQs", boq_name):
        frappe.throw(f"BOQs '{boq_name}' not found.", title="Not found")

    _guard_sheet_not_frozen(boq_name, sheet_name)
    _guard_sheet_not_parsing(boq_name, sheet_name)
    draft_lock.acquire_or_refresh(boq_name, sheet_name, frappe.session.user, now_datetime())

    try:
        row_index = int(row_index)
    except (ValueError, TypeError):
        frappe.throw("row_index must be an integer.", title="Invalid row_index")

    rows = frappe.db.get_all(
        _REVIEW_ROW,
        filters={"boq": boq_name, "sheet_name": sheet_name, "row_index": row_index},  # VERBATIM (#152)
        fields=FLAG_FIELDS,
    )
    if not rows:
        frappe.throw(
            f"Row with row_index={row_index} not found in sheet '{sheet_name}'.",
            title="Row not found",
        )
    row = rows[0]
    flags = row_flags(row, ai_run_log.check_state(boq_name, sheet_name)["status"])
    if not (flags["check_type"] or flags["check_parent"]):
        frappe.throw(
            f"Row {row.source_row_number} has no open flag to confirm.", title="Nothing to confirm"
        )

    # Raw write on purpose (no doc_events on BoQ Review Row): an acknowledgement must not stamp
    # edited_at or append to edit_log.
    frappe.db.set_value(_REVIEW_ROW, row.name, {
        "ai_flags_ok": 1,
        "ai_flags_ok_by": frappe.session.user,
        "ai_flags_ok_at": frappe.utils.now(),
    })
    frappe.db.commit()
    return {"ok": True, "row_index": row_index, "ai_flags_ok": 1}


def no_looks_ok_message(row_excel: Any) -> str:
    return f"Row {row_excel} has no Looks OK to undo."


@frappe.whitelist(methods=["POST"])
def unmark_row_looks_ok(boq_name: str = None, sheet_name: str = None, row_index=None) -> dict:
    """Undo the "Looks OK" of ONE row (S4a): the mark is cleared and the row's flags follow the
    ordinary rules again -- still closed where the user has since changed the type or parent.

    The mirror of mark_row_looks_ok: a direct column write, no edit history, one row per call and
    no bulk form (R13). Refused on a Finalized sheet, while a parse is running, and on a row whose
    mark is not standing (never ticked, or already ended by a revert).

    Returns {ok, row_index, ai_flags_ok: 0}.
    URL: /api/method/nirmaan_stack.api.boq.wizard.review_flags.unmark_row_looks_ok
    """
    if not boq_name:
        frappe.throw("boq_name is required.", title="Missing field: boq_name")
    if not sheet_name:
        frappe.throw("sheet_name is required.", title="Missing field: sheet_name")
    if row_index is None:
        frappe.throw("row_index is required.", title="Missing field: row_index")
    if not frappe.db.exists("BOQs", boq_name):
        frappe.throw(f"BOQs '{boq_name}' not found.", title="Not found")

    _guard_sheet_not_frozen(boq_name, sheet_name)
    _guard_sheet_not_parsing(boq_name, sheet_name)
    draft_lock.acquire_or_refresh(boq_name, sheet_name, frappe.session.user, now_datetime())

    try:
        row_index = int(row_index)
    except (ValueError, TypeError):
        frappe.throw("row_index must be an integer.", title="Invalid row_index")

    rows = frappe.db.get_all(
        _REVIEW_ROW,
        filters={"boq": boq_name, "sheet_name": sheet_name, "row_index": row_index},  # VERBATIM (#152)
        fields=FLAG_FIELDS,
    )
    if not rows:
        frappe.throw(
            f"Row with row_index={row_index} not found in sheet '{sheet_name}'.",
            title="Row not found",
        )
    row = rows[0]
    if not looks_ok_holds(row):
        frappe.throw(no_looks_ok_message(row.source_row_number), title="Nothing to undo")

    # Raw write on purpose, as in mark_row_looks_ok: no doc_events on BoQ Review Row, and undoing
    # an acknowledgement is no more an edit than making it.
    frappe.db.set_value(_REVIEW_ROW, row.name, {
        "ai_flags_ok": 0,
        "ai_flags_ok_by": None,
        "ai_flags_ok_at": None,
    })
    frappe.db.commit()
    return {"ok": True, "row_index": row_index, "ai_flags_ok": 0}


# ---------------------------------------------------------------------------
# Finalize block (AC5)
# ---------------------------------------------------------------------------

def finalize_refusal(open_rows: list) -> str:
    """ "Check the N flagged rows before finalizing: rows 22, 26." -- Excel row numbers, at most
    REFUSAL_ROW_LIMIT of them, then "and N more"."""
    count = len(open_rows)
    shown = ", ".join(str(r) for r in open_rows[:REFUSAL_ROW_LIMIT])
    more = count - REFUSAL_ROW_LIMIT
    if more > 0:
        shown += f" and {more} more"
    if count == 1:
        return f"Check the 1 flagged row before finalizing: row {shown}."
    return f"Check the {count} flagged rows before finalizing: rows {shown}."


def guard_finalize(boq_name: str, sheet_name: str) -> None:
    """The LAST check of mark_sheet_parsed_check_done: refuse while the check is still running, and
    while any flag is open. Raised as an error because the screen already shows a server error as
    it is; a sheet with nothing open passes through and finalizes exactly as before."""
    # A dead run must not hold the sheet: fail it now rather than on the next poll.
    ai_run_log.heal_on_read(boq_name, sheet_name)
    summary = sheet_flag_state(boq_name, sheet_name)["summary"]
    if summary["check_running"]:
        frappe.throw(CHECK_RUNNING_MESSAGE, title="Check still running")
    if summary["open_rows"]:
        frappe.throw(finalize_refusal(summary["open_rows"]), title="Rows to check")
