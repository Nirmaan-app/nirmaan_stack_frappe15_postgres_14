"""Everything that moves between two COMMITTED sheets of a revision chain.

⚠️ AMENDMENT C (2026-07-23) is landing across slices C1-C6. This module was `commit_overlay.py`;
the layer engine below is now presence-aware and overwrite-capable so it can ALSO serve the
post-commit per-sheet carry (`cross_boq_carry.apply_sheet_carry`, C2). **C1 changes no commit-time
behaviour**: at commit the destination is a brand-new committed version, so nothing is ever already
present, so every record takes the `carried` branch exactly as before. C5 is what removes the
commit-time carry (and `_carry_formulas` with it, permanently -- formulas are hand-declared under
Amendment C and never carry in either seam).

Original S6/S8 header (#1104, ADR-0014 D8) follows -- accurate until C5 lands:

---

S6/S8 (#1104, ADR-0014 D8) -- the commit-time annotation/formula/category OVERLAY carry.

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
_ROW_CATEGORY = "BoQ Row Category"
# The faithful committed grid -- read only for the COLOR layer's surviving-letter check when no
# in-flight grid is supplied (a post-commit carry, Amendment C).
_GRID = "BoQ Committed Sheet Grid"
_GRID_ROW = "BoQ Committed Sheet Grid Row"

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


def build_carry_ctx(
    *, source_boq, source_sheet_name, source_version,
    dest_boq, dest_sheet_name, dest_version, twin, grid_rows=None,
) -> _CarryCtx:
    """PUBLIC constructor for a layer-carry context (Amendment C, C2). The post-commit carry lives
    in `cross_boq_carry` and must build one of these from a match it already derived; this is the
    one supported way to do it, so `_CarryCtx` stays private to the engine.

    KEYWORD-ONLY on purpose: `source_version` and `dest_version` are adjacent ints, a transposition
    footgun for durable committed writes. `grid_rows=None` is the POST-COMMIT default (the colour
    layer reads the persisted grid); only the commit seam has an in-flight grid to pass."""
    return _CarryCtx(
        source_boq=source_boq,
        source_sheet_name=source_sheet_name,
        source_version=source_version,
        dest_boq=dest_boq,
        dest_sheet_name=dest_sheet_name,
        dest_version=dest_version,
        twin=twin,
        grid_rows=grid_rows,
    )


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
    # Amendment C (C1): the four row-addressed layers now run through the shared presence-aware
    # engine. At COMMIT the dest is a brand-new committed version, so nothing is ever already
    # present -> every record takes the `carried` branch and the counts below are byte-identical to
    # the pre-Amendment-C implementation. `overwrite` is irrelevant here for the same reason.
    # `_guarded` (the per-layer savepoint) stays a COMMIT-SEAM concern -- it exists to protect the
    # commit, so the post-commit caller does NOT use it (C2 owns one atomic transaction instead).
    for key in LAYER_KEYS:
        outcome = _guarded(
            key,
            lambda key=key: carry_layers(ctx, {key: {"carry": True, "overwrite": False}})[key],
        )
        # `_guarded` returns 0 on a rolled-back layer; a success returns the bucket dict.
        summary[key] = (outcome["carried"] + outcome["replaced"]) if outcome else 0
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


def committed_excel_row_match(source_boq, source_sheet_docname, dest_boq, dest_sheet_docname):
    """The SHARED committed-tier D6 match between two committed sheets, keyed by the durable Excel
    address (source_row_number) on each side. Returns the full `RowMatchResult` -- the twin map
    (`original_to_revised`: source excel_row -> dest excel_row) PLUS the per-source-row outcome
    (`original_outcome`: MATCHED | REMOVED | AMBIGUOUS). The single owner of "match two committed
    sheets by row", consumed by BOTH S8's commit overlay (needs only the twin map) and S9's
    cross-BOQ rate carry (needs the outcome too, to split its skip taxonomy into removed vs
    ambiguous). One matcher, no duplicate -- the plan the human reviewed and the plan apply
    enforces stay derivable from the same call.

    Reads BOTH sides' committed `BOQ Nodes` and re-runs the certified pure `match_rows`
    (Amendment B: same Excel row + same description, each position unique per side).

    ⚠️ This run is now PROVABLY IDENTICAL to the parse-seam run in `review_carry.py`. Under the old
    description-bucket key the two could legitimately disagree -- this side fed the committed
    ADR-0009 EFFECTIVE `level` while the parse side fed the parser-native `level`, and a human
    re-parent between review and commit moved one and not the other. Amendment B bars `level` from
    the matcher entirely, and both remaining inputs (`source_row_number`, `description`) are
    immutable after parse and are not functions of the tree. That equivalence is exactly what lets
    the committed tier RE-DERIVE the copied set with no new schema -- so never reintroduce a
    tree-derived input here. Only matched pairs appear in the twin map; an unmatched row is absent."""
    orig = _match_rows_from_nodes(source_boq, source_sheet_docname)
    rev = _match_rows_from_nodes(dest_boq, dest_sheet_docname)
    return match_rows(orig, rev)


def _excel_twin_map(source_boq, source_sheet_docname, dest_boq, dest_sheet_docname) -> dict:
    """source excel_row -> dest excel_row for MATCHED content rows -- the twin map alone (S8's
    layer carries need only this projection of `committed_excel_row_match`)."""
    return committed_excel_row_match(
        source_boq, source_sheet_docname, dest_boq, dest_sheet_docname
    ).original_to_revised


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
            excel_row=n.source_row_number,
            description=n.description or "",
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


# ---------------------------------------------------------------------------
# The layer engine (Amendment C, C1). Presence-aware + overwrite-capable, so ONE implementation
# serves the commit seam (fresh dest -> nothing is ever already present -> byte-identical to
# pre-Amendment-C) and the post-commit per-sheet carry (a dest that may already hold the user's own
# work, or a previous carry's).
#
# Every source record lands in EXACTLY ONE bucket:
#   carried    the dest address was empty                       -> inserted
#   replaced   the dest address was taken, overwrite ON         -> prior frozen, then inserted
#   kept       the dest address was taken, overwrite OFF        -> untouched (the default)
#   unmatched  the source row has no D6 twin                    -> cannot land
#   dropped    (cell-addressed only) twin exists, letter gone   -> cannot land
#
# `apply=False` walks WITHOUT writing, so the counts the human reviews and the writes apply
# performs come from ONE function and cannot drift -- the same principle `_classify_carry` follows
# for rates.
#
# ⚠️ VERSION NUMBERING: an insert takes `max(prior) + 1`, NEVER a hardcoded 1. A frozen prior can
# exist with no current (write-then-clear leaves `is_current=0` behind -- `save_row_remark`'s CLEAR
# branch), and re-using 1 would collide with it.
# ---------------------------------------------------------------------------

#: The four ROW-ADDRESSED layers Amendment C carries. Formula is deliberately ABSENT -- it is the
#: one layer that is hand-declared and never carries (D8's "logical-axis -> neither"; and the
#: carry button is gated on formulas being complete, so a formula carry would be unreachable).
LAYER_KEYS = ("remarks", "colors", "remark_dismissals", "categories")


@dataclass(frozen=True)
class _AnnotLayer:
    """One pricing-annotation layer's carry spec. The three annotation layers are near-twins
    (ADR-0010 F3: one parametric flow, not three copies) differing only in doctype, identity
    width, version/timestamp field names and payload."""

    doctype: str
    version_field: str
    stamped_at_field: str
    read_fields: tuple
    source_filters: dict
    cell_addressed: bool  # True -> col_letter joins the identity (colors)
    payload: object       # Callable[[frappe._dict], dict] -- the layer-specific doc fields


_ANNOT_LAYERS = {
    "remarks": _AnnotLayer(
        doctype=_REMARK,
        version_field="remark_version",
        stamped_at_field="remarked_at",
        read_fields=("excel_row", "remark", "description"),
        source_filters={},
        cell_addressed=False,
        payload=lambda r: {"remark": r.remark, "description": r.description},
    ),
    # A color is a purely PHYSICAL cell tag -- the LETTER, not a logical column -- so survival is
    # letter-in-the-revised-sheet (D6 x D5), not a role match.
    "colors": _AnnotLayer(
        doctype=_COLOR,
        version_field="color_version",
        stamped_at_field="colored_at",
        read_fields=("excel_row", "col_letter", "color", "description"),
        source_filters={},
        cell_addressed=True,
        payload=lambda r: {
            "col_letter": r.col_letter, "color": r.color, "description": r.description,
        },
    ),
    # ONLY flag_kind == "remark" carries -- the 4 COMPUTED kinds are re-armed by a revision (D8).
    # ROW-addressed: flag_kind is a source/dest FILTER pinning the one carried kind, not an
    # identity widener, so the identity stays (excel_row) like remarks.
    "remark_dismissals": _AnnotLayer(
        doctype=_DISMISSAL,
        version_field="dismissal_version",
        stamped_at_field="dismissed_at",
        read_fields=("excel_row", "description", "dismissed_by"),
        source_filters={"flag_kind": _REMARK_DISMISSAL_KIND},
        cell_addressed=False,
        payload=lambda r: {
            "flag_kind": _REMARK_DISMISSAL_KIND,
            "description": r.description,
            "dismissed_by": r.dismissed_by,
            "is_finalized": 0,
        },
    ),
}


def _zero_layer_outcome() -> dict:
    """A FRESH zero-count bucket dict (mutated in place by the walk)."""
    return {"carried": 0, "replaced": 0, "kept": 0, "unmatched": 0, "dropped": 0}


def _source_filters(ctx: _CarryCtx, spec: _AnnotLayer) -> dict:
    return {
        "boq": ctx.source_boq, "sheet_name": ctx.source_sheet_name,
        "committed_version": ctx.source_version, "is_current": 1,
        **spec.source_filters,
    }


def _dest_current_map(ctx: _CarryCtx, spec: _AnnotLayer) -> dict:
    """{identity -> docname} for the DEST's current records of this layer. ONE query (not one per
    source record -- the largest live sheet carries ~940 rows), and it doubles as the freeze
    target for an overwrite (no second lookup)."""
    fields = ["name", "excel_row"] + (["col_letter"] if spec.cell_addressed else [])
    rows = frappe.db.get_all(
        spec.doctype,
        filters={
            "boq": ctx.dest_boq, "sheet_name": ctx.dest_sheet_name,
            "committed_version": ctx.dest_version, "is_current": 1,
            **spec.source_filters,
        },
        fields=fields,
    )
    return {
        (r.excel_row, r.col_letter if spec.cell_addressed else None): r.name
        for r in rows
    }


def _dest_max_version_map(ctx: _CarryCtx, spec: _AnnotLayer) -> dict:
    """{identity -> max version} over ALL of the DEST's records for this layer (current AND frozen).
    ONE grouped query; drives the `max(prior) + 1` insert version without a per-record max()."""
    group = "excel_row, col_letter" if spec.cell_addressed else "excel_row"
    fields = ["excel_row"] + (["col_letter"] if spec.cell_addressed else [])
    rows = frappe.db.get_all(
        spec.doctype,
        filters={
            "boq": ctx.dest_boq, "sheet_name": ctx.dest_sheet_name,
            "committed_version": ctx.dest_version,
            **spec.source_filters,
        },
        fields=fields + [f"max({spec.version_field}) as mv"],
        group_by=group,
    )
    return {
        (r.excel_row, r.col_letter if spec.cell_addressed else None): (r.mv or 0)
        for r in rows
    }


def _walk_annot_layer(ctx: _CarryCtx, spec: _AnnotLayer, *, apply: bool, overwrite: bool) -> dict:
    """Classify (and optionally write) every source record of ONE annotation layer. See the bucket
    table above. NO commit -- the caller owns the transaction."""
    outcome = _zero_layer_outcome()
    rows = frappe.db.get_all(
        spec.doctype, filters=_source_filters(ctx, spec), fields=list(spec.read_fields)
    )
    if not rows:
        return outcome

    dest_current = _dest_current_map(ctx, spec)
    dest_max_version = _dest_max_version_map(ctx, spec) if apply else {}
    survivors = (
        _dest_column_letters(ctx.dest_boq, ctx.dest_sheet_name, ctx.dest_version, ctx.grid_rows)
        if spec.cell_addressed
        else None
    )

    for r in rows:
        dest_row = ctx.twin.get(r.excel_row)
        if dest_row is None:
            outcome["unmatched"] += 1  # non-MATCHED source row -> cannot land
            continue
        col = r.col_letter if spec.cell_addressed else None
        if spec.cell_addressed and col not in survivors:
            outcome["dropped"] += 1  # the letter didn't survive the column diff
            continue

        identity = (dest_row, col)
        prior_name = dest_current.get(identity)
        if prior_name and not overwrite:
            outcome["kept"] += 1  # the dest already holds work -> NEVER clobbered by default
            continue

        if not apply:
            outcome["replaced" if prior_name else "carried"] += 1
            continue

        if prior_name:
            # Freeze via set_value (NEVER doc.save) -- the pricing-tier idiom (save_row_remark).
            frappe.db.set_value(spec.doctype, prior_name, "is_current", 0)

        doc = frappe.new_doc(spec.doctype)
        doc.boq = ctx.dest_boq
        doc.sheet_name = ctx.dest_sheet_name  # VERBATIM (#152)
        doc.excel_row = dest_row
        doc.committed_version = ctx.dest_version
        for field, value in spec.payload(r).items():
            setattr(doc, field, value)
        setattr(doc, spec.version_field, dest_max_version.get(identity, 0) + 1)
        doc.is_current = 1
        setattr(doc, spec.stamped_at_field, frappe.utils.now())
        doc.insert(ignore_permissions=True)
        outcome["replaced" if prior_name else "carried"] += 1

    return outcome


def carry_layers(ctx: _CarryCtx, choices: dict) -> dict:
    """WRITE the selected layers. `choices` = {layer_key: {"carry": bool, "overwrite": bool}};
    an absent or carry-False layer is skipped entirely (and reports zeros). Returns
    {layer_key: outcome}. NO commit -- the caller owns the transaction (the commit seam shares
    `_commit_one_sheet`'s; the C2 endpoint owns its own atomic one)."""
    return _walk_layers(ctx, choices, apply=True)


def plan_layer_counts(ctx: _CarryCtx) -> dict:
    """READ-ONLY: what each layer WOULD do, with overwrite OFF -- so `carried` is the carryable
    count and `kept` is the conflict count, both independent of any toggle the user has not set
    yet. The C2 plan endpoint renames these to {carryable, present, ...} at the API boundary."""
    return _walk_layers(
        ctx, {key: {"carry": True, "overwrite": False} for key in LAYER_KEYS}, apply=False
    )


def _walk_layers(ctx: _CarryCtx, choices: dict, *, apply: bool) -> dict:
    out = {}
    for key in LAYER_KEYS:
        choice = choices.get(key) or {}
        if not choice.get("carry"):
            out[key] = _zero_layer_outcome()
            continue
        overwrite = bool(choice.get("overwrite"))
        if key == "categories":
            out[key] = _walk_category_layer(ctx, apply=apply, overwrite=overwrite)
        else:
            out[key] = _walk_annot_layer(ctx, _ANNOT_LAYERS[key], apply=apply, overwrite=overwrite)
    return out


def _dest_column_letters(dest_boq, dest_sheet_name, dest_version, grid_rows) -> set:
    """The revised sheet's SURVIVING column letters for the physical color layer: the committed
    grid's column universe (physical presence, incl. unmapped columns) UNION the committed
    column_role_map keys. The union honours S4's structural-presence principle -- a MAPPED column
    survives even when it is empty in a fresh unpriced revision (openpyxl's read-only grid skips
    trailing empty padding, so a grid-only universe could miss it)."""
    cols = _dest_column_universe(dest_boq, dest_sheet_name, dest_version, grid_rows)
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


def _dest_column_universe(dest_boq, dest_sheet_name, dest_version, grid_rows) -> set:
    """The set of column letters present in the revised committed grid.

    `grid_rows` = the just-written faithful grid ({row_number, cells: {col_letter: value}}), which
    the COMMIT seam has in hand. Amendment C: a POST-COMMIT carry has no in-flight grid, so
    `grid_rows=None` reads the persisted grid back from `BoQ Committed Sheet Grid Row` instead --
    the same rows `pricing.get_committed_sheet_grid` serves."""
    if grid_rows is None:
        grid_name = frappe.db.get_value(
            _GRID,
            {
                "boq": dest_boq, "source_sheet_name": dest_sheet_name,
                "commit_version": dest_version,
            },
            "name",
        )
        grid_rows = (
            frappe.db.get_all(
                _GRID_ROW,
                filters={"parent": grid_name, "parenttype": _GRID},
                fields=["cells"],
            )
            if grid_name
            else []
        )
        grid_rows = [
            {"cells": json.loads(r.cells) if isinstance(r.cells, str) else (r.cells or {})}
            for r in grid_rows
        ]

    cols: set = set()
    for row in grid_rows or []:
        cells = row.get("cells") or {}
        cols.update(cells.keys())
    return cols


def _walk_category_layer(ctx: _CarryCtx, *, apply: bool, overwrite: bool) -> dict:
    """CATEGORY carry (row-addressed + per-discipline fan-out, D8). Carries the WHOLE layer
    (machine + human) at the dest version, keyed (excel_row, discipline). The per-discipline fan-out
    rides the row list -- two engines coexist as independent rows, never pick one. The FIELD SPLIT
    is preserved by the persist owner's `carry_row_categories` (NEVER `set_human_verdict`, which
    would replicate #1096's freeze bug inside carry). NEW dest rows land blank (no source -> not
    inserted -> CL-6 amber + the Check-Category filter). No re-classify.

    Amendment C: presence-aware. A dest (excel_row, discipline) that ALREADY has a current record
    -- because the user ran Classify, set a verdict, or carried once already -- is `kept` unless
    overwrite is asserted, in which case persist freezes the prior and supersedes it.

    ⚠️ A classification-FROZEN dest sheet takes NO category write at all (defence in depth: C2's
    endpoint gates this too). Frozen is category-only -- rates, remarks and colours are unaffected,
    which is the owner-locked separation between the classification freeze and the pricing lock."""
    outcome = _zero_layer_outcome()
    if category_persist.is_sheet_classification_frozen(
        ctx.dest_boq, ctx.dest_sheet_name, ctx.dest_version
    ):
        return outcome

    rows = frappe.db.get_all(
        _ROW_CATEGORY,
        filters={
            "boq": ctx.source_boq, "sheet_name": ctx.source_sheet_name,
            "committed_version": ctx.source_version, "is_current": 1,
        },
        fields=category_persist.CARRY_READ_FIELDS,
    )
    if not rows:
        return outcome

    present = category_persist.current_category_keys(
        ctx.dest_boq, ctx.dest_sheet_name, ctx.dest_version
    )

    carry_rows = []
    for r in rows:
        dest_row = ctx.twin.get(r.excel_row)
        if dest_row is None:
            outcome["unmatched"] += 1  # non-MATCHED source row -> cannot land
            continue
        taken = (dest_row, r.discipline) in present
        if taken and not overwrite:
            outcome["kept"] += 1
            continue
        outcome["replaced" if taken else "carried"] += 1
        if apply:
            payload = dict(r)
            payload["excel_row"] = dest_row  # re-key to the dest Excel address
            carry_rows.append(payload)

    if apply and carry_rows:
        category_persist.carry_row_categories(
            ctx.dest_boq, ctx.dest_sheet_name, ctx.dest_version, carry_rows, overwrite=overwrite
        )
    return outcome
