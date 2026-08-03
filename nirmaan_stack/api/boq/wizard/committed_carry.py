"""What moves between two COMMITTED sheets of a revision chain (ADR-0014, Amendment D).

Two things live here, and neither of them is row content:

  1. `stamp_revision_provenance` -- the D2 provenance triple (source_boq / source_commit_version /
     source_sheet_name) stamped on a revision's freshly committed `BoQ Sheet`. This is **all** a
     commit does for a revision.
  2. `committed_excel_row_match` -- the shared committed-tier D6 row match between two committed
     sheets, keyed by the durable Excel address. The rate carry in `cross_boq_carry` is its only
     production consumer. `version_addressed_excel_row_match` is its WITHIN-BoQ sibling (two
     versions of ONE sheet), consumed by `pricing`'s copy-forward; they are separate entry points by
     owner ruling, not one function behind a flag.

⚠️ AMENDMENT E (2026-07-28, owner-directed) restores ALL FOUR layers Amendment D deleted --
category, remark, colour and `remark` dismissal -- to the explicit per-sheet action. Each is
OPT-IN (category offered ON by default in the dialog, the annotations OFF), and every carried
record is STAMPED with `carried_from_boq` / `carried_from_version` / `carried_at`.

⚠️ BCS-S6 (2026-08-03) ADDS A FIFTH, `bcs_costs` -- the per-row BCS cost rates. "FOUR" above is
Amendment E's own count and is left as written because it is history, not the running total;
`LAYER_KEYS` is the live answer to how many layers there are. The fifth arrives on Amendment E's
terms and adds one of its own: it is opt-in (defaulting OFF -- categories are ON by an explicit
owner ruling that cost data has never had), it is stamped with the same three provenance fields,
and it carries a SHEET-LEVEL PRECONDITION -- the destination must have BCS switched on with its
columns confirmed, or the layer silently carries nothing. See `carry_bcs_cost_layer`.

Those two properties are the whole answer to Amendment D, which deleted the carry because
annotations arrived **un-asked-for** and **un-attributed**. Opt-in fixes the first; the stamp
fixes the second. Neither alone would have been enough, and a restoration with only one of them
would reproduce the original defect. Categories additionally carry a destination-eligibility
guard (see `carry_category_layer`).

**The COMMIT seam is UNCHANGED and still carries nothing but provenance** -- the Amendment D
history below describes the commit and remains accurate for it. What returned is the ACTION.

⚠️ AMENDMENT D (2026-07-23, owner-directed) REVERSED AMENDMENT C's annotation carry.
**The per-sheet carry moved RATES AND NOTHING ELSE.**

Amendment C had moved four ROW-ADDRESSED annotation layers (remark / colour / `remark` dismissal /
category) out of the commit seam and into the explicit per-sheet "Carry rates from original" action,
where the user picked them per layer with a Keep/Overwrite decision. That whole layer engine --
`LAYER_KEYS`, `_AnnotLayer`, `_ANNOT_LAYERS`, `_CarryCtx`, `build_carry_ctx`, `carry_layers`,
`plan_layer_counts`, `_walk_layers`, `_walk_annot_layer`, `_walk_category_layer` and the dest
column/version index helpers -- is DELETED, along with the `layers` parameter on
`apply_sheet_carry` and the `layers` block on `get_cross_boq_carry_plan`.

Why it is a deletion and not a feature flag: the annotations were arriving on the revision
un-asked-for and un-attributed. A carried remark is indistinguishable in the Review block from one
the user wrote on this revision (it renders as the same grey `Note` entry), so the carry silently
grew the revision's review list with the original author's text -- and with Overwrite armed it
superseded the user's own remark at the same row. Every one of these layers still has a first-class
write path in the pricing editor; only the cross-BoQ COPY of them is gone.

What is deliberately NOT affected:
  * `BoQ Cell Remark` / `BoQ Cell Color` / `BoQ Cell Dismissal` / `BoQ Row Category` keep their own
    endpoints and their own freeze-and-supersede lifecycles. No schema change, no migration.
  * Annotations ALREADY carried by an Amendment C build stay exactly where they are -- they are
    committed records now, and removing the feature does not retroactively un-write them.
  * FORMULAS never carried in either seam and still do not. They are hand-declared per sheet, and
    `_sheet_formulas_complete` remains the gate on the whole per-sheet carry action.
"""

import json
from dataclasses import dataclass

import frappe

from nirmaan_stack.api.boq.wizard.review_carry import (
    _source_sheet_name,
    revision_source_boq,
)
from nirmaan_stack.services.boq_category import persist as category_persist
# BCS-S6: the BCS readiness predicate, reached at the SERVICE layer on purpose. Importing
# `api/boq/wizard/bcs.py` (where it used to live) would close the ring
# committed_carry -> bcs -> pricing -> committed_carry, which `pricing.py`'s header forbids.
# api -> service is the one legal direction; this is the same shape as `category_persist` above.
from nirmaan_stack.services.boq_bcs.readiness import bcs_is_ready
from nirmaan_stack.services.boq_revision.normalize import normalize_n2
from nirmaan_stack.services.boq_revision.row_match import MatchRow, match_rows

_BOQ_SHEET = "BoQ Sheet"
_NODE = "BOQ Nodes"
_ROW_CATEGORY = "BoQ Row Category"

# Committed BOQ Nodes fields the excel-row twin map reads (both sides). source_row_number = the
# durable Excel address; description feeds the pure D6 match; `code` is the SERIAL NUMBER and feeds
# AMENDMENT G's opt-in second pass (commit_pipeline maps review `sl_no_value` -> `code`, so on a
# committed node the serial is always `code` -- BOTH sides of every carry here read committed nodes,
# so there is no cross-field translation anywhere).
_NODE_MATCH_FIELDS = ["source_row_number", "description", "level", "code"]


def stamp_revision_provenance(
    boq_name: str, sheet_name: str, dest_sheet_docname: str,
) -> int:
    """Stamp the D2 provenance triple on a revision sheet's freshly committed `BoQ Sheet`.
    Returns 1 when stamped, 0 for a non-revision / unmapped / no-source sheet.

    ⚠️ AMENDMENT C (C5): this used to be `carry_commit_overlay`, which ALSO carried five layers
    (formula / remark / colour / `remark` dismissal / category) silently at commit. **A revision
    commit carries NOTHING** -- still true, and keeping it true is what this function is for.

    ⚠️ The sentence that used to stand here said that, Amendment D having stripped the annotation
    carry from the per-sheet action too, no seam anywhere copied row content between a revision and
    its original EXCEPT the rates. **Amendment E (2026-07-28) falsified that**, and it is corrected
    rather than deleted so the claim is not reintroduced: the explicit per-sheet action
    `cross_boq_carry.apply_sheet_carry` moves the rates AND any of the four row-addressed layers the
    user ticks (category / remark / colour / `remark` dismissal), each stamped with its origin. The
    distinction that actually survives is **COMMIT vs. explicit ACTION** -- not rates vs. layers.

    **The stamp itself MUST stay.** `cross_boq_carry._resolve_sheet_carry` reads `source_sheet_name`
    off this row to find the source at all -- it is sheet-level IDENTITY, not row information, so it
    is not part of what "carries". It is written with `set_value(update_modified=False)`, never
    `doc.save` (the list-JSON `area_dimensions` wall on BoQ Sheet).
    """
    source_boq = revision_source_boq(boq_name)
    if not source_boq:
        return 0

    source_sheet_name = _source_sheet_name(boq_name, sheet_name)
    if not source_sheet_name:
        return 0  # a declared-New sheet has no source

    src = frappe.db.get_value(
        _BOQ_SHEET,
        {"boq": source_boq, "sheet_name": source_sheet_name, "is_current": 1},
        ["name", "commit_version"],
        as_dict=True,
    )
    if not src:
        return 0  # the source sheet has no current committed version

    frappe.db.set_value(
        _BOQ_SHEET, dest_sheet_docname,
        {
            "source_boq": source_boq,
            "source_commit_version": src.commit_version,
            "source_sheet_name": source_sheet_name,
        },
        update_modified=False,
    )
    return 1


# ---------------------------------------------------------------------------
# Excel-row twin map (pure D6 re-derivation)
# ---------------------------------------------------------------------------


def committed_excel_row_match(source_boq, source_sheet_docname, dest_boq, dest_sheet_docname):
    """The SHARED committed-tier D6 match between two committed sheets, keyed by the durable Excel
    address (source_row_number) on each side. Returns the full `RowMatchResult` -- the twin map
    (`original_to_revised`: source excel_row -> dest excel_row) PLUS the per-source-row outcome
    (`original_outcome`). The single owner of "match two committed sheets by row"; since Amendment D
    its one production consumer is the cross-BOQ RATE carry, which needs the outcome too to split
    its skip taxonomy. One matcher, no duplicate -- the plan the human reviewed and the plan apply
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
    tree-derived input here. Only matched pairs appear in the twin map; an unmatched row is absent.

    ⚠️ AMENDMENT G (WBC-S11, owner-directed): **this is the ONE production call site that enables the
    serial second pass**, so a row that MOVED still carries when its serial number and description
    both survive. Everything `cross_boq_carry` does with a sheet pair reads this single result --
    the rate plan, the "needs a new value" count, and the opt-in layer carry (categories / remarks /
    colours / dismissals) -- and the owner ruled they all move together: the boundary is structure
    vs. everything else, and the structural risk lives in the parse-time carry, not here. See
    `row_match`'s module docstring for the full ruling. `version_addressed_excel_row_match` below
    MUST NOT enable it; that is an owner ruling, not an oversight, and it is pinned by
    `test_the_within_boq_entry_point_does_NOT_pair_the_same_moved_row`."""
    orig = _match_rows_from_nodes(source_boq, source_sheet_docname)
    rev = _match_rows_from_nodes(dest_boq, dest_sheet_docname)
    return match_rows(orig, rev, serial_second_pass=True)


def _excel_twin_map(source_boq, source_sheet_docname, dest_boq, dest_sheet_docname) -> dict:
    """source excel_row -> dest excel_row for MATCHED content rows -- the twin-map projection of
    `committed_excel_row_match`. Production callers build from a match they already hold
    (`cross_boq_carry`), so this is the convenience form the tests drive the matcher through."""
    return committed_excel_row_match(
        source_boq, source_sheet_docname, dest_boq, dest_sheet_docname
    ).original_to_revised


def version_addressed_excel_row_match(
    source_boq, source_sheet_docname, dest_boq, dest_sheet_docname
):
    """The WITHIN-BoQ sibling of `committed_excel_row_match` -- same match, addressed by committed
    sheet DOCNAME alone, with NO `is_current` filter on the nodes.

    ⚠️ Read `committed_excel_row_match`'s docstring above for the load-bearing warning about what may
    and may not feed this match (never a tree-derived input). That warning is deliberately NOT
    restated here: one copy in the codebase, so it cannot be updated in one place and go stale in the
    other.

    WHY A SIBLING AND NOT A PARAMETER (owner ruling, ADR-0014 Amendment F R6): the two differ only in
    node visibility, but the cross-BoQ entry point's `is_current` filter is load-bearing there -- it
    is what stops that carry reading superseded nodes -- so it must not become optional. Within ONE
    BoQ the source is an OLDER version of the same sheet, and a re-commit froze its nodes to
    `is_current = 0`; the cross-BoQ matcher therefore sees NOTHING on the source side and returns an
    empty twin map. That single filter is the whole difference.

    Dropping it here is SAFE because the docname already pins the version: `BOQ Nodes.sheet` links
    the version-specific `BoQ Sheet` row, and `is_current` is uniform per sheet docname. This is the
    same reasoning `review_screen.get_committed_rows_at_version` states for its own version read.

    Returns the full `RowMatchResult`, exactly like the original -- the rate carry needs the per-row
    outcome, not just the twin map. Only matched pairs appear in `original_to_revised`; within one
    BoQ a pair is always (row N -> row N), because `match_rows` joins on the SAME Excel position.

    ⚠️ AMENDMENT G: this entry point does **NOT** enable the serial second pass, and that absence is
    LOAD-BEARING. `pricing.apply_copy_forward` is its only consumer and the owner ruled the
    within-BoQ copy-forward keeps the strict position rule, so a moved row does not carry here even
    with a byte-identical serial. The nodes DO carry their serials (`_content_match_rows` projects
    them on both readers) -- what differs is permission to use them, which is decided here and
    nowhere else. Do NOT "restore consistency" with `committed_excel_row_match` by adding the flag:
    that reads as a one-word tidy-up and is a silent behaviour change to a separate feature."""
    orig = _match_rows_from_nodes_at_version(source_boq, source_sheet_docname)
    rev = _match_rows_from_nodes_at_version(dest_boq, dest_sheet_docname)
    return match_rows(orig, rev)


def _match_rows_from_nodes(boq, sheet_docname) -> list:
    """Build the pure `MatchRow` list from one side's CURRENT committed content nodes. The cross-BoQ
    reader -- `is_current = 1` is load-bearing here (see `version_addressed_excel_row_match`)."""
    return _content_match_rows(
        frappe.db.get_all(
            _NODE,
            filters={"boq": boq, "sheet": sheet_docname, "is_current": 1},
            fields=_NODE_MATCH_FIELDS,
        )
    )


def _match_rows_from_nodes_at_version(boq, sheet_docname) -> list:
    """The same list from a committed sheet addressed by DOCNAME ALONE -- current or superseded. The
    within-BoQ reader; the docname pins the version, so `is_current` adds nothing but a blind spot."""
    return _content_match_rows(
        frappe.db.get_all(
            _NODE,
            filters={"boq": boq, "sheet": sheet_docname},
            fields=_NODE_MATCH_FIELDS,
        )
    )


def _content_match_rows(nodes) -> list:
    """Project committed node rows onto the pure `MatchRow` list: keyed by `source_row_number` (the
    durable Excel address), non-blank N2 description only.

    The ONE definition of "which committed rows enter a match" -- shared by both readers above so the
    two seams cannot disagree about what a content row is. Blank-description rows never enter (they
    carry nothing and demand nothing); a node with no Excel address has no durable identity."""
    return [
        MatchRow(
            row_id=n.source_row_number,
            excel_row=n.source_row_number,
            description=n.description or "",
            # AMENDMENT G's pass-2 key half. Projected on BOTH readers on purpose: "which committed
            # rows enter a match, and what do they look like" stays ONE definition, and whether the
            # serial may be USED is decided at the `match_rows` call, not by withholding the data.
            serial=n.code or "",
        )
        for n in nodes
        if n.source_row_number is not None and normalize_n2(n.description)
    ]


# ── Category carry (ADR-0014 Amendment E, R3) ──────────────────────────────────────
#
# Restores the layer engine Amendment D deleted, for the CATEGORY layer only, with the two
# additions that answer Amendment D's objection rather than merely reverse it:
#
#   1. PROVENANCE. Every carried record is stamped with the source BoQ + version + carry time
#      (`persist.carry_row_categories`, where the stamp is keyword-REQUIRED). Amendment D's
#      complaint was that carried rows were "un-asked-for and un-attributed"; the opt-in handles
#      asked-for, this handles attributed.
#   2. DESTINATION ELIGIBILITY. A source row may pair with a destination row the revision
#      classifies differently -- a Line Item that is now a subtotal or a blank. Writing a category
#      onto it would put a classification on a row the product says can never hold one, polluting
#      both the grid and the classifier's own evaluation corpus. The old commit-seam version could
#      not hit this (its destination was always freshly parsed and never re-classified); a
#      POST-commit carry can, so the guard is new code, not restored code.
#
# The layers Amendment D also deleted (remark / colour / `remark` dismissal) are NOT here -- they
# return in their own slice, opt-in and defaulting OFF.


#: The layer keys the carry API accepts. `_coerce_layers` restricts the wire payload to these and
#: DROPS an unknown key silently, so a frontend that learns about a new layer before the backend
#: does (or the reverse) cannot break the call.
#:
#: `categories` is offered ON by default in the dialog; the three annotation layers are offered OFF
#: by default (owner decision) -- that asymmetry lives in the FRONTEND, not here. The backend
#: default is "no layers at all", which is what an omitted `layers` payload means.
#: BCS-S6 appends `bcs_costs`. ONE registration lights BOTH carry surfaces -- the cross-BoQ
#: revision carry and the within-BoQ copy-forward both dispatch through `walk_layers` -- which is
#: why the BCS carry is a layer here rather than a bespoke action on either endpoint.
LAYER_KEYS = ("categories", "remarks", "colors", "remark_dismissals", "bcs_costs")

_REMARK = "BoQ Cell Remark"
_COLOR = "BoQ Cell Color"
_DISMISSAL = "BoQ Cell Dismissal"
_BCS = "BoQ Row BCS Rate"
_GRID = "BoQ Committed Sheet Grid"
_GRID_ROW = "BoQ Committed Sheet Grid Row"

#: The ONE dismissal kind that carries. The other four (`needs_rate` / `qty_anomaly` / `broken` /
#: `not_yet`) acknowledge COMPUTED conditions that a revision recomputes from scratch, so carrying
#: them would re-assert an acknowledgement nobody made about the new numbers. ADR-0014 D8's re-arm
#: taxonomy: `remark` is excluded from `_DISMISSAL_REARM_KINDS` because it survives a rate edit --
#: that same exclusion is why it, and only it, survives a revision.
_REMARK_DISMISSAL_KIND = "remark"


@dataclass(frozen=True)
class _CarryCtx:
    """The source + dest identity a layer carry needs, bundled so the six-address tuple never
    travels positionally through several functions -- `source_version` and `dest_version` are
    adjacent ints, a transposition footgun for durable committed writes.

    `twin` = source excel_row -> dest excel_row (the D6 re-derivation the caller already has).
    """

    source_boq: str
    source_sheet_name: str
    source_version: int
    dest_boq: str
    dest_sheet_name: str
    dest_version: int
    twin: dict
    grid_rows: list = None


def build_carry_ctx(
    *, source_boq, source_sheet_name, source_version,
    dest_boq, dest_sheet_name, dest_version, twin, grid_rows=None,
) -> _CarryCtx:
    """PUBLIC constructor for a layer-carry context. `cross_boq_carry` builds one from a match it
    has already derived; this is the one supported way to do it, so `_CarryCtx` stays private.

    KEYWORD-ONLY on purpose: see the transposition note on `_CarryCtx`.

    `grid_rows=None` is the POST-COMMIT default -- the colour layer reads the persisted grid back
    to learn which column letters survived. Only a commit seam would have an in-flight grid to
    pass, and no commit seam carries anything today."""
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


def zero_layer_outcome() -> dict:
    """A FRESH zero-count bucket dict (the walk mutates it in place).

    ONE shape for every layer, so the client reads a uniform result and a new layer never changes
    the payload's shape. Two buckets are layer-specific and stay 0 elsewhere, which is honest
    rather than sloppy -- they describe a way of NOT landing that only that layer has:

    carried    -- written onto a destination row that had no current record
    replaced   -- written over an existing current record (overwrite armed)
    kept       -- a destination record already existed and overwrite was NOT armed
    unmatched  -- the source row has no D6 twin in the revision (moved / reworded / removed)
    ineligible -- CATEGORIES ONLY: the twin exists but is not a Line Item / Preamble in the
                  revision, so it cannot hold a category. Annotations have no such restriction --
                  a note or a colour on a subtotal row is meaningful -- so this stays 0 for them.
    dropped    -- COLOURS ONLY: the cell's physical column LETTER did not survive into the
                  revision. Row-addressed layers have no column to lose, so this stays 0 for them.
    """
    return {"carried": 0, "replaced": 0, "kept": 0, "unmatched": 0,
            "ineligible": 0, "dropped": 0}


def carry_category_layer(ctx: _CarryCtx, *, apply: bool, overwrite: bool) -> dict:
    """Plan (apply=False) or perform (apply=True) the CATEGORY carry for one sheet pair.

    Row-addressed with a per-discipline fan-out: the identity is (excel_row, discipline), and the
    fan-out rides the row list rather than a loop over engines -- two engines that both classified
    the source coexist as independent destination rows and NEITHER is picked over the other. That
    is what keeps this pathway N-engine generic; no discipline is named anywhere in it.

    Carries the WHOLE layer, machine AND human, with the split preserved (see
    `persist.carry_row_categories`). Source rows with no twin land nothing, so genuinely new rows
    in the revision stay blank -> the amber Category cell + the Check-Category filter, exactly as
    a never-classified row does today. No re-classify is triggered.

    Presence-aware: a destination (excel_row, discipline) that ALREADY holds a current record --
    the user ran Classify on the revision, set a verdict, or carried once already -- is `kept`
    unless `overwrite` is asserted, in which case persist freezes the prior and supersedes it.

    ⚠️ A classification-FROZEN destination sheet takes NO category write at all. Frozen is
    category-only: rates are unaffected, which is the owner-locked separation between the
    classification freeze and the pricing lock. It is placed FIRST so a frozen sheet costs one
    cheap read and no work.

    ⚠️⚠️ THIS GUARD IS THE ONLY ONE ON THIS PATH -- it is NOT defence in depth. `cross_boq_carry`
    does not gate the freeze anywhere (unlike `set_row_category` / `start_classify`, which are
    guarded at the endpoint by `classify._guard_classification_not_frozen`). Deleting this check
    would let a carry write categories straight through a freeze. Pinned by
    `test_classification_frozen_destination_takes_no_write`.

    The SILENT-SKIP shape is deliberate: a carry with categories ticked against a frozen sheet
    still carries its rates and simply lands no category, rather than refusing the whole action.
    The plan read (apply=False) runs the same guard, so the dialog shows the layer with nothing to
    carry and disables it -- the user is never offered a write that would be dropped.

    PURE READ when apply=False -- safe to call for the dialog's counts. Returns the outcome dict.
    """
    outcome = zero_layer_outcome()
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
    eligible = category_persist.eligible_excel_rows(
        ctx.dest_boq, ctx.dest_sheet_name, ctx.dest_version
    )

    carry_rows = []
    for r in rows:
        dest_row = ctx.twin.get(r.excel_row)
        if dest_row is None:
            outcome["unmatched"] += 1
            continue
        if dest_row not in eligible:
            # The twin is real but the revision does not classify rows of its kind. Skipped
            # SILENTLY as far as the destination is concerned -- reported, never written.
            outcome["ineligible"] += 1
            continue
        taken = (dest_row, r.discipline) in present
        if taken and not overwrite:
            outcome["kept"] += 1
            continue
        outcome["replaced" if taken else "carried"] += 1
        if apply:
            payload = dict(r)
            payload["excel_row"] = dest_row  # re-key to the DEST Excel address
            carry_rows.append(payload)

    if apply and carry_rows:
        category_persist.carry_row_categories(
            ctx.dest_boq, ctx.dest_sheet_name, ctx.dest_version, carry_rows,
            source_boq=ctx.source_boq, source_version=ctx.source_version,
            overwrite=overwrite,
        )
    return outcome


# ── Annotation layers (ADR-0014 Amendment E, R5) ───────────────────────────────────
#
# Restores what Amendment D deleted for remark / colour / `remark` dismissal, opt-in and OFF by
# default, each carried record stamped with its origin. Amendment D's defect was specific and is
# addressed directly: a carried remark rendered in the Review block as the same grey `Note` entry
# as one written on the revision, so it arrived un-asked-for (no opt-in) and un-attributed (no
# provenance). Both halves now exist; neither alone would have been enough.


@dataclass(frozen=True)
class _AnnotLayer:
    """One annotation layer's carry spec. The three are near-twins (ADR-0010 F3: one parametric
    flow, not three copies) differing only in doctype, identity width, version/timestamp field
    names and payload."""

    doctype: str
    version_field: str
    stamped_at_field: str
    read_fields: tuple
    source_filters: dict
    cell_addressed: bool  # True -> col_letter joins the identity (colours)
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
    # A colour is a purely PHYSICAL cell tag -- the LETTER, not a logical column -- so survival is
    # letter-in-the-revised-sheet (D6 x D5), not a role match. This is the one layer that can be
    # `dropped`.
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
    # ONLY flag_kind == "remark" carries (see _REMARK_DISMISSAL_KIND). ROW-addressed: flag_kind is
    # a source/dest FILTER pinning the one carried kind, not an identity widener, so the identity
    # stays (excel_row) like remarks.
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
    """Classify (and optionally write) every source record of ONE annotation layer. See
    `zero_layer_outcome` for the buckets. NO commit -- the caller owns the transaction."""
    outcome = zero_layer_outcome()
    rows = frappe.db.get_all(
        spec.doctype, filters=_source_filters(ctx, spec), fields=list(spec.read_fields)
    )
    if not rows:
        return outcome

    carried_at = frappe.utils.now()
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
        # AMENDMENT E: the attribution half of the fix. Without this a carried remark is
        # indistinguishable from a locally-written one, which is the defect Amendment D deleted
        # the whole feature over.
        doc.carried_from_boq = ctx.source_boq
        doc.carried_from_version = ctx.source_version
        doc.carried_at = carried_at
        doc.insert(ignore_permissions=True)
        outcome["replaced" if prior_name else "carried"] += 1

    return outcome


def _dest_column_letters(dest_boq, dest_sheet_name, dest_version, grid_rows) -> set:
    """The revised sheet's SURVIVING column letters for the physical colour layer: the committed
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

    `grid_rows=None` (the post-commit default) reads the persisted grid back from
    `BoQ Committed Sheet Grid Row` -- the same rows `pricing.get_committed_sheet_grid` serves."""
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


# ── BCS cost carry (slice BCS-S6) ──────────────────────────────────────────────────
#
# The fifth layer, and the owner's ask verbatim: "Carry Rate from original (versioned sheet in
# same BOQ, or revised upload) gets a new option to copy the BCS Section; precondition: BCS
# enabled on the destination sheet AND its formulas confirmed."
#
# NO MIGRATION. `carried_from_boq` / `carried_from_version` / `carried_at` were provisioned on
# `BoQ Row BCS Rate` at BCS-S1 and marked "UNUSED in S1". This is what uses them.
#
# WHY IT MIRRORS `carry_category_layer` AND NOT `_ANNOT_LAYERS` (BCS-S6 R1): `carry_category_layer`
# is bespoke because it needed a SHEET-LEVEL GUARD SLOT, and `_walk_annot_layer` has none. BCS
# needs exactly that slot -- readiness is a fact about the destination SHEET, not about a row.
#
# ⚠️ IT DOES NOT COPY THE CATEGORY LAYER'S PER-DISCIPLINE FAN-OUT (R2). A BCS identity is a
# 4-tuple -- (boq, sheet_name VERBATIM #152, excel_row, committed_version). No col_letter, no
# discipline, at most ONE current record per address. A discipline loop here would iterate a
# dimension that does not exist.
#
# Two outcome buckets stay 0 for this layer, and honestly so:
#   `ineligible` -- categories-only. There is no node_type restriction on a cost: the BCS module
#                   docstring records that a qty-less Preamble IS costable, deliberately, because
#                   `save_row_bcs_rates` skips the priceability gate.
#   `dropped`    -- colours-only. Row-addressed, so there is no column letter to lose.

#: What a carried cost copies from the source record. `description` and `node` are DELIBERATELY
#: absent: both are per-DESTINATION facts (see `_dest_bcs_node_index`).
_BCS_CARRY_READ_FIELDS = (
    "excel_row", "supply_rate", "install_rate", "combined_rate",
    "is_filled", "rate_source", "bcs_rated_at",
)


def _dest_current_bcs(ctx: _CarryCtx) -> dict:
    """{dest excel_row -> docname} for the DESTINATION's current cost records. ONE query, and it
    doubles as the freeze target for an overwrite (no second lookup)."""
    return {
        r.excel_row: r.name
        for r in frappe.db.get_all(
            _BCS,
            filters={
                "boq": ctx.dest_boq, "sheet_name": ctx.dest_sheet_name,
                "committed_version": ctx.dest_version, "is_current": 1,
            },
            fields=["name", "excel_row"],
        )
    }


def _dest_max_bcs_version(ctx: _CarryCtx) -> dict:
    """{dest excel_row -> max bcs_version} over ALL the DESTINATION's cost records, current AND
    frozen. ONE grouped query; drives `max(prior) + 1` without a per-record max(). A frozen prior
    can exist with no current (an earlier carry superseded by a hand edit and back again), so a
    hardcoded 1 would collide."""
    return {
        r.excel_row: (r.mv or 0)
        for r in frappe.db.get_all(
            _BCS,
            filters={
                "boq": ctx.dest_boq, "sheet_name": ctx.dest_sheet_name,
                "committed_version": ctx.dest_version,
            },
            fields=["excel_row", "max(bcs_version) as mv"],
            group_by="excel_row",
        )
    }


def _dest_bcs_node_index(ctx: _CarryCtx) -> dict:
    """{dest excel_row -> (node docname, description)} for the DESTINATION committed sheet.

    BOTH values are per-DESTINATION and must NOT be copied from the source record:

    `node` is a per-VERSION pointer -- its own field description says node names change on
    re-commit -- so carrying the source's would point a destination cost row at a node belonging
    to another version. `save_row_bcs_rates` resolves it through `_resolve_committed_cell`; this
    is the batched form of the same read, filtered identically (sheet docname + commit_version).

    `description` is a carry-forward MATCH GUARD against the row the cost SITS ON (its field
    description says so), so it has to be that row's description -- which is also what the RATE
    carry writes on the mirrored `BoQ Cell Pricing.description`. Under the D6 match the two are
    normalize-equal anyway; taking the destination's keeps a later "the description changed under
    this cost" warning from firing on nothing but whitespace.

    Every value in `ctx.twin` is by construction a destination node of this sheet+version (the
    match is BUILT from these rows), so a lookup miss is structurally unreachable."""
    sheet = frappe.db.get_value(
        _BOQ_SHEET,
        {
            "boq": ctx.dest_boq,
            "sheet_name": ctx.dest_sheet_name,  # VERBATIM (#152)
            "commit_version": ctx.dest_version,
        },
        "name",
    )
    if not sheet:
        return {}
    return {
        n.source_row_number: (n.name, n.description)
        for n in frappe.db.get_all(
            _NODE,
            filters={"boq": ctx.dest_boq, "sheet": sheet, "commit_version": ctx.dest_version},
            fields=["name", "source_row_number", "description"],
        )
        if n.source_row_number is not None
    }


def carry_bcs_rows(
    dest_boq, dest_sheet_name, dest_version, rows, *, source_boq, source_version
) -> int:
    """Write a batch of carried BCS cost records -- freeze-and-supersede, then insert.

    ⚠️ PROVENANCE IS MANDATORY, not optional (BCS-S6 R6, and the exact shape of
    `persist.carry_row_categories`). `source_boq` / `source_version` sit after a bare `*` with no
    defaults, so an unstamped carried cost is a TypeError at the call site rather than a NULL
    discovered in the database months later. A stamp a caller MAY omit is a stamp that eventually
    WILL be omitted -- and an unattributed carried record is precisely what ADR-0014 Amendment D
    deleted the whole carry feature over.

    ⚠️ THIS DOES NOT CALL `bcs.save_row_bcs_rates`, and must not (R4). That endpoint is a
    WHOLE-ROW SNAPSHOT: it coerces every absent rate to 0.0 and writes all three
    unconditionally. Routing a carry through it would mean a source row holding only a combined
    rate silently ZEROED a supply/install pair the destination already held. It would also drag
    in that endpoint's four gates and its own commit, on a path that owns neither.

    ⚠️ `bcs_rated_at` is carried VERBATIM and therefore stays OLDER than the carry -- instructed
    on the field itself, mirroring `human_verdict_at`. `carried_at` is the fresh stamp. NEVER
    restamp `bcs_rated_at` to now(): the age is what would let a cost entered ON this version
    outrank an inherited one with no precedence code. (HONEST CAVEAT, BCS-S6: no live reader
    tie-breaks on it today. It is forward-looking, and honoured anyway -- the cheapest moment to
    get an age right is before something depends on it.)

    Each row dict carries the `_BCS_CARRY_READ_FIELDS` values with `excel_row` ALREADY re-mapped
    to the destination address by the caller's D6 twin, PLUS the destination-resolved `node` /
    `description`, the computed `bcs_version`, and `supersedes` (the prior current's docname, or
    None). Returns the count written. NO commit -- the caller owns the transaction."""
    carried_at = frappe.utils.now()
    count = 0
    for r in rows:
        prior = r.get("supersedes")
        if prior:
            # Freeze via set_value, NEVER doc.save -- the pricing-tier idiom that
            # `save_row_bcs_rates` itself uses.
            frappe.db.set_value(_BCS, prior, "is_current", 0)

        doc = frappe.new_doc(_BCS)
        doc.boq = dest_boq
        doc.sheet_name = dest_sheet_name  # VERBATIM (#152)
        doc.excel_row = r["excel_row"]
        doc.committed_version = dest_version
        doc.node = r.get("node")
        doc.description = r.get("description")
        # All THREE inputs travel independently. `combined_rate` is NOT a total of the two halves
        # (owner-locked, BCS-S2b) -- never sum them, never derive one from the others.
        doc.supply_rate = r.get("supply_rate") or 0.0
        doc.install_rate = r.get("install_rate") or 0.0
        doc.combined_rate = r.get("combined_rate") or 0.0
        doc.is_filled = 1 if r.get("is_filled") else 0
        # Provenance of the NUMBERS -- a property of the values, so it survives the copy. Distinct
        # from the three fields below, which are provenance of the RECORD.
        doc.rate_source = r.get("rate_source") or "Manual"
        doc.bcs_version = r["bcs_version"]
        doc.is_current = 1
        doc.bcs_rated_at = r.get("bcs_rated_at")
        doc.carried_from_boq = source_boq
        doc.carried_from_version = source_version
        doc.carried_at = carried_at
        doc.insert(ignore_permissions=True)
        count += 1
    return count


def carry_bcs_cost_layer(ctx: _CarryCtx, *, apply: bool, overwrite: bool) -> dict:
    """Plan (apply=False) or perform (apply=True) the BCS COST carry for one sheet pair.

    ⚠️ THE GUARD RUNS FIRST AND IS SHEET-SCOPED: a destination with no BCS section takes NO cost
    write at all. It is the owner's stated precondition -- BCS enabled on the destination AND its
    columns confirmed -- read through the ONE shared `bcs_is_ready`, so the carry and the BCS
    write path can never disagree about whether a sheet is set up.

    ⚠️ THE FAILURE SHAPE IS A SILENT SKIP, deliberately, and it is the most dangerous property of
    this layer. A not-ready destination yields the ZERO outcome: nothing written, no exception,
    and the rest of the carry -- rates included -- proceeds. Refusing the whole action instead
    would let one unconfigured cost section block a rate carry the user actually asked for. It is
    the same shape `carry_category_layer` takes against a classification-frozen sheet.

    ⚠️ WHAT MAKES THAT ACCEPTABLE IS THE PLAN READ RUNNING THE SAME GUARD. `walk_layers` dispatches
    plan and apply through this one function, so a not-ready sheet reports zeros to the dialog,
    which renders the layer disabled with nothing to carry. Without that symmetry the user would
    tick a layer showing "2 to copy", apply, and watch nothing happen with no explanation
    anywhere. Do NOT move the guard behind the `apply` branch.

    Presence-aware exactly like every other layer: a destination row that ALREADY holds a current
    cost is `kept` unless `overwrite` is asserted, in which case the prior is frozen and
    superseded. A source row with no D6 twin is `unmatched` and lands nothing, so a genuinely new
    row in the destination keeps a blank cost cell rather than inheriting a number that was never
    entered against it.

    PURE READ when apply=False -- safe to call for the dialog's counts. Returns the outcome dict.
    """
    outcome = zero_layer_outcome()
    if not bcs_is_ready(ctx.dest_boq, ctx.dest_sheet_name, ctx.dest_version):
        return outcome

    rows = frappe.db.get_all(
        _BCS,
        filters={
            "boq": ctx.source_boq, "sheet_name": ctx.source_sheet_name,
            "committed_version": ctx.source_version, "is_current": 1,
        },
        fields=list(_BCS_CARRY_READ_FIELDS),
    )
    if not rows:
        return outcome

    dest_current = _dest_current_bcs(ctx)
    dest_max_version = _dest_max_bcs_version(ctx) if apply else {}
    dest_nodes = _dest_bcs_node_index(ctx) if apply else {}

    carry_rows = []
    for r in rows:
        dest_row = ctx.twin.get(r.excel_row)
        if dest_row is None:
            outcome["unmatched"] += 1  # moved / reworded / removed -> cannot land
            continue
        prior_name = dest_current.get(dest_row)
        if prior_name and not overwrite:
            outcome["kept"] += 1  # a cost typed HERE is never clobbered by default
            continue
        outcome["replaced" if prior_name else "carried"] += 1
        if not apply:
            continue
        node, description = dest_nodes.get(dest_row, (None, None))
        payload = dict(r)
        payload["excel_row"] = dest_row  # re-key to the DEST Excel address
        payload["node"] = node
        payload["description"] = description
        payload["bcs_version"] = dest_max_version.get(dest_row, 0) + 1
        payload["supersedes"] = prior_name
        carry_rows.append(payload)

    if apply and carry_rows:
        carry_bcs_rows(
            ctx.dest_boq, ctx.dest_sheet_name, ctx.dest_version, carry_rows,
            source_boq=ctx.source_boq, source_version=ctx.source_version,
        )
    return outcome


def walk_layers(ctx: _CarryCtx, choices: dict, *, apply: bool) -> dict:
    """Run every SELECTED layer for one sheet pair. `choices` = {layer_key: {carry, overwrite}};
    an absent or carry-False layer is SKIPPED ENTIRELY and omitted from the result, so the summary
    reports what actually ran rather than rows of zeros the caller must interpret.

    The single dispatch point for both the plan (apply=False) and the write (apply=True), so a
    layer cannot be planned one way and applied another. NO commit -- the caller owns the
    transaction."""
    out = {}
    for key in LAYER_KEYS:
        choice = choices.get(key) or {}
        if not choice.get("carry"):
            continue
        overwrite = bool(choice.get("overwrite"))
        # THE dispatch table. The two BESPOKE layers are the ones needing a sheet-level guard slot
        # that `_walk_annot_layer` does not have -- categories for the classification freeze,
        # `bcs_costs` for BCS readiness. Everything else is the parametric annotation walk.
        if key == "categories":
            out[key] = carry_category_layer(ctx, apply=apply, overwrite=overwrite)
        elif key == "bcs_costs":
            out[key] = carry_bcs_cost_layer(ctx, apply=apply, overwrite=overwrite)
        else:
            out[key] = _walk_annot_layer(ctx, _ANNOT_LAYERS[key], apply=apply, overwrite=overwrite)
    return out
