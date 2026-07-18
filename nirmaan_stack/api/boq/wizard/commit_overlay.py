"""S6/S8 (#1104, ADR-0014 D8) -- the commit-time annotation/formula/category OVERLAY carry.

At commit, a revision silently carries the re-arm-EXEMPT layers forward onto the freshly committed
sheet, so a committed revision arrives fully annotated, categorised and formula-complete -- and
stamps the D2 provenance triple (source_boq / source_commit_version / source_sheet_name) on the
committed `BoQ Sheet`. The re-arm taxonomy IS the carry taxonomy (D8):

    Carry exactly what the system EXEMPTS from re-arm; never carry what it re-arms.

  Carries (re-arm-EXEMPT):  amount FORMULA (a declaration) | REMARK | COLOR |
                            `remark` DISMISSAL | the whole CATEGORY layer (machine + human).
  Never carries (re-armed): the 4 COMPUTED dismissals (needs_rate/qty_anomaly/broken/not_yet) +
                            the reconciliation CHOICE -- they acknowledge computed conditions a
                            revision recomputes, and S9's own rate carry would re-arm them on
                            arrival (the carried record would vanish moments after landing).

Addressing families (D8):
  * Formula -- LOGICAL axis (value_field, value_key, rate_subkey); `target_col` is a guard, never
    a key. Re-validate against the DEST amount descriptors via the shared
    `pricing._formula_target_matches_column` (a role SWAP re-resolves for free); no match -> drop
    silently; an uncovered dest amount column stays uncovered -> `_sheet_formulas_complete` stays
    false = fail-closed (no NEW gate here).
  * Remark + `remark` dismissal -- ROW-addressed: the D6 twin maps source `excel_row` -> dest.
  * Color -- CELL-addressed by letter: twin `excel_row` AND the letter must have survived the
    column diff (present in the revised committed grid).
  * Category -- ROW-addressed + per-discipline fan-out; the whole layer carries (machine + human)
    via the persist owner's `carry_row_categories` (NEVER `set_human_verdict`). NEW rows land
    blank -> CL-6's amber. No re-classify.

Runs ONLY inside `_commit_one_sheet` for a FINALIZED sheet of a revision BoQ whose mapped source
has a current committed version. A non-revision (upload/template) commit never enters here -> it
stays byte-identical. Best-effort PER LAYER (owner-chosen): the core commit + the provenance stamp
always stand; a single layer's carry that raises rolls back ONLY that layer (a DB savepoint) and
is logged. Shares `_commit_one_sheet`'s transaction -- NO self-commit (the trailing per-sheet
commit flushes the whole sheet atomically).
"""

from __future__ import annotations

import json
from dataclasses import dataclass

import frappe

from nirmaan_stack.api.boq.wizard import pricing
from nirmaan_stack.api.boq.wizard.review_carry import (
    _source_sheet_name,
    revision_source_boq,
)
from nirmaan_stack.services.boq_category import persist as category_persist
from nirmaan_stack.services.boq_revision.normalize import normalize_n2
from nirmaan_stack.services.boq_revision.row_match import MatchRow, match_rows

_BOQ_SHEET = "BoQ Sheet"
_NODE = "BOQ Nodes"
_FORMULA = "BoQ Cell Amount Formula"
_REMARK = "BoQ Cell Remark"
_COLOR = "BoQ Cell Color"
_DISMISSAL = "BoQ Cell Dismissal"

# The ONE dismissal kind that carries (D8): a `remark` dismissal is annotation on its own track
# and SURVIVES a rate edit -- it is the single kind EXCLUDED from pricing._DISMISSAL_REARM_KINDS.
# The 4 computed kinds acknowledge conditions a revision recomputes -> never carried.
_REMARK_DISMISSAL_KIND = "remark"

# Committed BOQ Nodes fields the excel-row twin map reads (both sides). source_row_number = the
# durable Excel address = the annotation identity's `excel_row`; description + level feed the pure
# D6 match (level only tiebreaks a duplicate-description cluster).
_NODE_MATCH_FIELDS = ["source_row_number", "description", "level"]


@dataclass(frozen=True)
class _CarryCtx:
    """The source + dest identity a layer carry needs, bundled so the six-address tuple never
    travels positionally through five functions -- source_version and dest_version are adjacent
    ints, a transposition footgun for durable committed writes. `twin` = source excel_row -> dest
    excel_row (the D6 re-derivation); `grid_rows` = the dest faithful grid (color-survivor check).
    """

    source_boq: str
    source_sheet_name: str
    source_version: int
    dest_boq: str
    dest_sheet_name: str
    dest_version: int
    twin: dict
    grid_rows: list


def _empty_summary() -> dict:
    """The zero summary -- returned for a non-revision / unmapped / no-source sheet (a no-op)."""
    return {
        "provenance": 0, "formulas": 0, "remarks": 0, "colors": 0,
        "remark_dismissals": 0, "categories": 0,
    }


def carry_commit_overlay(
    boq_name: str, sheet_name: str, dest_version: int,
    dest_sheet_docname: str, grid_rows: list,
) -> dict:
    """Carry the re-arm-exempt overlay layers + stamp the provenance triple for a revision sheet.

    Called from `_commit_one_sheet` AFTER the node tree is written, ONLY for a finalized sheet.
    `dest_version` is the sheet's fresh commit_version; `dest_sheet_docname` the just-written
    committed `BoQ Sheet` name; `grid_rows` the faithful grid ({row_number, cells}) for the color
    survivor check. Returns a per-layer count summary (for logging / tests).

    A no-op (zero summary) when the BoQ is not a revision, this sheet is a declared-New (unmapped)
    sheet, or the mapped source has no current committed version -- nothing to carry.
    """
    source_boq = revision_source_boq(boq_name)
    if not source_boq:
        return _empty_summary()

    source_sheet_name = _source_sheet_name(boq_name, sheet_name)
    if not source_sheet_name:
        return _empty_summary()

    src = frappe.db.get_value(
        _BOQ_SHEET,
        {"boq": source_boq, "sheet_name": source_sheet_name, "is_current": 1},
        ["name", "commit_version"],
        as_dict=True,
    )
    if not src:
        return _empty_summary()
    source_sheet_docname = src.name
    source_version = src.commit_version

    # 1. Provenance triple (D2) -- OUTSIDE any savepoint (owner-chosen: it must ALWAYS land so S9
    #    can find the source, even if a layer carry rolls back). set_value(update_modified=False),
    #    never doc.save (the list-JSON area_dimensions wall on BoQ Sheet).
    frappe.db.set_value(
        _BOQ_SHEET, dest_sheet_docname,
        {
            "source_boq": source_boq,
            "source_commit_version": source_version,
            "source_sheet_name": source_sheet_name,
        },
        update_modified=False,
    )

    # 2. The excel-row twin map: source excel_row -> dest excel_row (pure D6 re-derivation).
    twin = _excel_twin_map(source_boq, source_sheet_docname, boq_name, dest_sheet_docname)

    ctx = _CarryCtx(
        source_boq=source_boq, source_sheet_name=source_sheet_name, source_version=source_version,
        dest_boq=boq_name, dest_sheet_name=sheet_name, dest_version=dest_version,
        twin=twin, grid_rows=grid_rows,
    )

    # 3. Per-layer best-effort carries -- each in its own savepoint (a bad layer never drops the
    #    others; the core commit + provenance above always stand).
    summary = _empty_summary()
    summary["provenance"] = 1
    summary["formulas"] = _guarded("formulas", lambda: _carry_formulas(ctx))
    summary["remarks"] = _guarded("remarks", lambda: _carry_remarks(ctx))
    summary["colors"] = _guarded("colors", lambda: _carry_colors(ctx))
    summary["remark_dismissals"] = _guarded("remark_dismissals", lambda: _carry_remark_dismissals(ctx))
    summary["categories"] = _guarded("categories", lambda: _carry_categories(ctx))
    return summary


def _guarded(label: str, fn):
    """Run one layer's carry inside a DB savepoint (best-effort, owner-chosen). On success release
    the savepoint and return the layer's count; on ANY error roll back to the savepoint (undoing
    ONLY that layer, so the core commit + earlier layers stand) and log. The rollback runs BEFORE
    the log write -- a Postgres error aborts the txn until a rollback, so logging first would fail.
    """
    sp = f"boq_overlay_{label}_{frappe.generate_hash(length=8)}"
    frappe.db.savepoint(sp)
    try:
        count = fn()
        frappe.db.release_savepoint(sp)
        return count
    except Exception:
        frappe.db.rollback(save_point=sp)
        frappe.log_error(
            title="BoQ revision overlay carry",
            message=f"commit overlay: {label} carry failed for this sheet\n\n"
                    f"{frappe.get_traceback()}",
        )
        return 0


# ---------------------------------------------------------------------------
# Excel-row twin map (pure D6 re-derivation)
# ---------------------------------------------------------------------------


def _excel_twin_map(source_boq, source_sheet_docname, dest_boq, dest_sheet_docname) -> dict:
    """source excel_row -> dest excel_row for MATCHED content rows (a self-contained D6 match on
    the committed tier).

    Reads BOTH sides' committed `BOQ Nodes` (source_row_number = the durable Excel address = the
    annotation `excel_row`) and re-runs the certified `match_rows`, keyed by source_row_number on
    each side so the map is excel_row -> excel_row directly. The DESCRIPTION key is the primary
    signal and is byte-stable (human review never edits a description), so this reproduces the
    intent of S6's parse-time pairing for the common (unique-description) case.

    NOTE on `level`: this reads the committed `BOQ Nodes.level` (the ADR-0009 EFFECTIVE-tree
    nesting depth) on BOTH sides, not the parser-native level -- the committed source has no other.
    Using the SAME committed convention on both sides keeps section-header identification internally
    consistent. `level` feeds ONLY the duplicate-description (N=M>1) section tiebreak; a unique
    description ignores it, and a genuine mismatch degrades to AMBIGUOUS -> the annotation SAFELY
    drops (never a wrong carry). Only MATCHED pairs appear; a REMOVED / AMBIGUOUS / NEW row is
    absent -> its annotations drop.
    """
    orig = _match_rows_from_nodes(source_boq, source_sheet_docname)
    rev = _match_rows_from_nodes(dest_boq, dest_sheet_docname)
    return match_rows(orig, rev).original_to_revised


def _match_rows_from_nodes(boq, sheet_docname) -> list:
    """Build the pure `MatchRow` list from one side's committed content nodes (non-blank N2
    description, keyed by source_row_number = the durable Excel address)."""
    nodes = frappe.db.get_all(
        _NODE,
        filters={"boq": boq, "sheet": sheet_docname, "is_current": 1},
        fields=_NODE_MATCH_FIELDS,
    )
    return [
        MatchRow(
            row_id=n.source_row_number,
            description=n.description or "",
            order=n.source_row_number or 0,
            level=n.level,
        )
        for n in nodes
        if n.source_row_number is not None and normalize_n2(n.description)
    ]


# ---------------------------------------------------------------------------
# Layer carries. Each writes fresh is_current=1 / version=1 records into the DEST triple (a brand
# new committed_version -> provably no prior records, so no freeze-and-supersede) WITHOUT committing
# (the per-sheet transaction owns the commit).
# ---------------------------------------------------------------------------


def _carry_formulas(ctx: _CarryCtx) -> int:
    """Amount FORMULA carry (logical axis, D8). Re-validate each source formula against the DEST
    amount descriptors via the shared `_formula_target_matches_column`; carry a match with
    `target_col` RE-RESOLVED from the matched dest descriptor (a role SWAP re-resolves for free --
    the identity is value_field/value_key/rate_subkey, never the letter); drop a no-match silently.
    An uncovered dest amount column is simply left uncovered -> the gate stays fail-closed."""
    source_formulas = pricing._current_formula_records(
        ctx.source_boq, ctx.source_sheet_name, ctx.source_version
    )
    if not source_formulas:
        return 0
    dest_descs = pricing._committed_amount_descriptors(
        ctx.dest_boq, ctx.dest_sheet_name, ctx.dest_version
    )

    carried = 0
    for f in source_formulas:
        if f.get("formula") is None:
            continue  # a cleared formula leaves no current record; defensive
        tvf, tvk, trs = (
            f.get("target_value_field"),
            f.get("target_value_key"),
            f.get("target_rate_subkey"),
        )
        match = next(
            (d for d in dest_descs
             if pricing._formula_target_matches_column(tvf, tvk, trs, d)),
            None,
        )
        if match is None:
            continue  # drop silently -- D5's config gate already surfaced the missing column
        version = pricing._next_formula_version(
            ctx.dest_boq, ctx.dest_sheet_name, ctx.dest_version, tvf, tvk, trs
        )
        doc = frappe.new_doc(_FORMULA)
        doc.boq = ctx.dest_boq
        doc.sheet_name = ctx.dest_sheet_name  # VERBATIM (#152)
        doc.committed_version = ctx.dest_version
        doc.target_value_field = tvf
        doc.target_value_key = tvk
        doc.target_rate_subkey = trs
        doc.target_col = match["col"]  # RE-RESOLVED from the dest descriptor (guard, not key)
        doc.description = f.get("description")
        doc.formula = json.dumps(f.get("formula"))  # the read parsed it to an object; re-dump
        doc.formula_version = version
        doc.is_current = 1
        doc.defined_at = frappe.utils.now()
        doc.is_finalized = 0
        doc.insert(ignore_permissions=True)
        carried += 1
    return carried


def _carry_remarks(ctx: _CarryCtx) -> int:
    """REMARK carry (row-addressed, D6 only): map source excel_row -> dest excel_row; drop a
    non-MATCHED source row."""
    rows = frappe.db.get_all(
        _REMARK,
        filters={
            "boq": ctx.source_boq, "sheet_name": ctx.source_sheet_name,
            "committed_version": ctx.source_version, "is_current": 1,
        },
        fields=["excel_row", "remark", "description"],
    )
    carried = 0
    for r in rows:
        dest_row = ctx.twin.get(r.excel_row)
        if dest_row is None:
            continue  # non-MATCHED source row -> drop
        doc = frappe.new_doc(_REMARK)
        doc.boq = ctx.dest_boq
        doc.sheet_name = ctx.dest_sheet_name  # VERBATIM (#152)
        doc.excel_row = dest_row
        doc.committed_version = ctx.dest_version
        doc.remark = r.remark
        doc.description = r.description
        doc.remark_version = 1  # fresh dest triple -> no prior -> v1
        doc.is_current = 1
        doc.remarked_at = frappe.utils.now()
        doc.insert(ignore_permissions=True)
        carried += 1
    return carried


def _carry_colors(ctx: _CarryCtx) -> int:
    """COLOR carry (cell-addressed by letter, D6 x D5): map source excel_row -> dest excel_row AND
    require the col_letter to have survived the column diff. A color is a purely PHYSICAL cell tag
    -- the letter, not a logical column -- so survival is letter-in-the-revised-sheet, not a role
    match."""
    rows = frappe.db.get_all(
        _COLOR,
        filters={
            "boq": ctx.source_boq, "sheet_name": ctx.source_sheet_name,
            "committed_version": ctx.source_version, "is_current": 1,
        },
        fields=["excel_row", "col_letter", "color", "description"],
    )
    if not rows:
        return 0
    dest_columns = _dest_column_letters(
        ctx.dest_boq, ctx.dest_sheet_name, ctx.dest_version, ctx.grid_rows
    )

    carried = 0
    for r in rows:
        dest_row = ctx.twin.get(r.excel_row)
        if dest_row is None:
            continue  # non-MATCHED source row -> drop
        if r.col_letter not in dest_columns:
            continue  # the letter didn't survive the column diff -> drop
        doc = frappe.new_doc(_COLOR)
        doc.boq = ctx.dest_boq
        doc.sheet_name = ctx.dest_sheet_name  # VERBATIM (#152)
        doc.excel_row = dest_row
        doc.col_letter = r.col_letter
        doc.committed_version = ctx.dest_version
        doc.color = r.color
        doc.description = r.description
        doc.color_version = 1  # fresh dest triple -> no prior -> v1
        doc.is_current = 1
        doc.colored_at = frappe.utils.now()
        doc.insert(ignore_permissions=True)
        carried += 1
    return carried


def _dest_column_letters(dest_boq, dest_sheet_name, dest_version, grid_rows) -> set:
    """The revised sheet's SURVIVING column letters for the physical color layer: the committed
    grid's column universe (physical presence, incl. unmapped columns) UNION the committed
    column_role_map keys. The union honours S4's structural-presence principle -- a MAPPED column
    survives even when it is empty in a fresh unpriced revision (openpyxl's read-only grid skips
    trailing empty padding, so a grid-only universe could miss it)."""
    cols = _dest_column_universe(grid_rows)
    role_map = frappe.db.get_value(
        _BOQ_SHEET,
        {"boq": dest_boq, "sheet_name": dest_sheet_name, "commit_version": dest_version},
        "column_role_map",
    )
    if role_map:
        try:
            parsed = json.loads(role_map) if isinstance(role_map, str) else role_map
            if isinstance(parsed, dict):
                cols.update(parsed.keys())
        except (ValueError, TypeError):
            pass
    return cols


def _dest_column_universe(grid_rows) -> set:
    """The set of column letters present in the revised committed grid. grid_rows = the just-
    written faithful grid ({row_number, cells: {col_letter: value}})."""
    cols: set = set()
    for row in grid_rows or []:
        cells = row.get("cells") or {}
        cols.update(cells.keys())
    return cols


def _carry_remark_dismissals(ctx: _CarryCtx) -> int:
    """`remark` DISMISSAL carry (row-addressed, D6 only). ONLY flag_kind == "remark" carries -- the
    4 COMPUTED kinds are re-armed by a revision and never carry. Map source excel_row -> dest."""
    rows = frappe.db.get_all(
        _DISMISSAL,
        filters={
            "boq": ctx.source_boq, "sheet_name": ctx.source_sheet_name,
            "committed_version": ctx.source_version, "is_current": 1,
            "flag_kind": _REMARK_DISMISSAL_KIND,
        },
        fields=["excel_row", "description", "dismissed_by"],
    )
    carried = 0
    for r in rows:
        dest_row = ctx.twin.get(r.excel_row)
        if dest_row is None:
            continue  # non-MATCHED source row -> drop
        doc = frappe.new_doc(_DISMISSAL)
        doc.boq = ctx.dest_boq
        doc.sheet_name = ctx.dest_sheet_name  # VERBATIM (#152)
        doc.excel_row = dest_row
        doc.flag_kind = _REMARK_DISMISSAL_KIND
        doc.committed_version = ctx.dest_version
        doc.description = r.description
        doc.dismissal_version = 1  # fresh dest triple -> no prior -> v1
        doc.is_current = 1
        doc.dismissed_at = frappe.utils.now()
        doc.dismissed_by = r.dismissed_by
        doc.is_finalized = 0
        doc.insert(ignore_permissions=True)
        carried += 1
    return carried


def _carry_categories(ctx: _CarryCtx) -> int:
    """CATEGORY carry (row-addressed + per-discipline fan-out, D8). Carry the WHOLE layer (machine
    + human) at the dest version, keyed (excel_row, discipline). The per-discipline fan-out rides
    the row list -- two engines coexist as independent rows, never pick one. Field split preserved
    by the persist owner's `carry_row_categories` (NEVER `set_human_verdict`). NEW dest rows land
    blank (no source -> not inserted -> CL-6 amber + Check-Category filter). No re-classify."""
    rows = frappe.db.get_all(
        "BoQ Row Category",
        filters={
            "boq": ctx.source_boq, "sheet_name": ctx.source_sheet_name,
            "committed_version": ctx.source_version, "is_current": 1,
        },
        fields=category_persist.CARRY_READ_FIELDS,
    )
    carry_rows = []
    for r in rows:
        dest_row = ctx.twin.get(r.excel_row)
        if dest_row is None:
            continue  # non-MATCHED source row -> drop
        payload = dict(r)
        payload["excel_row"] = dest_row  # re-key to the dest Excel address
        carry_rows.append(payload)
    return category_persist.carry_row_categories(
        ctx.dest_boq, ctx.dest_sheet_name, ctx.dest_version, carry_rows
    )
