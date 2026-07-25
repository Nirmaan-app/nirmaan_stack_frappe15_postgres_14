# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Cross-BOQ carry: the ORIGINAL's rates into a committed revision (ADR-0014 D9, as amended by
AMENDMENT C and then AMENDMENT D).

One explicit, deliberate action per SHEET, launched from the pricing editor after the user has
declared that sheet's amount formulas by hand. It is `pricing.py`'s same-BOQ copy-forward
classifier pointed cross-BOQ:

  * A source-driven, per-CELL rate plan (one Excel row yields several entries, one per
    area/rate_kind), DESTINATION-keyed `(dest_excel_row, area, rate_kind)` -- the source and dest
    Excel rows can differ, so each plan entry carries BOTH. Unmatched dest rows never enter the
    plan (they have no source rate); they are reported as `needs_new_value_count` and found via the
    editor's "Show unpriced" filter.
  * The `(area, rate_kind)` re-resolution runs against the DESTINATION's rate columns
    (`_current_rate_column_index`), so a column MOVE re-resolves and the source's bare `col_letter`
    is NEVER a write target.
  * A split skip taxonomy: `removed` (unpaired) / `no_rate_column` / `non_priceable` / `invalid`.
  * Plan AND apply RE-DERIVE everything server-side via the SAME classifier (`_classify_carry`)
    over a freshly-derived D6 match -- a client-supplied outcome / target column / rate is NEVER
    trusted.
  * `apply_sheet_carry` is SYNCHRONOUS and ATOMIC: one lock acquire, one commit, full rollback on
    any error.

⚠️ AMENDMENT D (2026-07-23, owner-directed) REVERSES AMENDMENT C's annotation carry. **This action
moves RATES AND NOTHING ELSE.** The four row-addressed annotation layers (remark / colour / `remark`
dismissal / category) are no longer planned, no longer offered and no longer written: the `layers`
parameter, the `layers` block on the plan payload, `_plan_layer_counts`, `_coerce_layers` and the
whole engine behind them in `committed_carry` are DELETED. A carried remark was indistinguishable
in the pricing editor's Review block from one written on the revision itself, so the carry silently
grew the revision's review list with the original author's text -- and with Overwrite armed it
superseded the user's own remark at the same row. Each layer keeps its own first-class write path;
only the cross-BoQ copy is gone. See `committed_carry`'s module docstring for the full rationale.

SOURCE VERSION: rates carry from the source sheet's CURRENT committed version, version-PINNED --
the same version the structure reads. **AMENDMENT C reversed W6/A10's
cross-version rate read**: once a revision exists the original is not edited further, so its current
committed version is its final state and the carry moves exactly what a user looking at the original
can see. `revision._carry_counts` is pinned identically, so the mapping screen's count and the carry
can never disagree. `source_boq` / `source_version` params are advisory: the server re-derives the
real source from `BOQs.source_boq` + each sheet's committed provenance and never trusts the client
for identity.

⚠️ AMENDMENT C (C6) removed the hub's whole-BoQ long job (`start_cross_boq_carry`,
`_carry_rates_worker`, `get_cross_boq_carry_status`, the Redis marker/status block and the
`boq:carry_rates_done` event). The per-sheet failure isolation they were built for IS the new unit
of work.
"""

import json

import frappe
from frappe.utils import now_datetime

from nirmaan_stack.api.boq.wizard import pricing
from nirmaan_stack.api.boq.wizard.committed_carry import committed_excel_row_match
from nirmaan_stack.api.boq.wizard.review_carry import _source_sheet_name, revision_source_boq
from nirmaan_stack.api.boq.wizard.review_screen import (
    get_committed_rows,
    get_committed_rows_at_version,
)

_BOQ_SHEET = "BoQ Sheet"
_NODE = "BOQ Nodes"


# The split skip taxonomy (ADR-0014 D9). The PLAN reasons a source cell can be classified as a
# hard skip, plus `invalid` which is apply-time only (a decision referencing no real carryable cell).
# "ambiguous" was RETIRED by Amendment B (the match no longer has an ambiguity class) and DROPPED
# in W5 together with `boqTypes.ts` + the `CrossBoqCarryDialog` fixtures -- both sides at once,
# because removing it backend-only would leave the frontend summing an `undefined`.
_PLAN_SKIP_REASONS = ("removed", "no_rate_column", "non_priceable")
_APPLY_SKIP_REASONS = _PLAN_SKIP_REASONS + ("invalid",)


def _zero_apply_skips() -> dict:
    """A FRESH zero-count dict over the apply-time skip taxonomy (a new dict each call -- the
    counters are mutated in place)."""
    return {reason: 0 for reason in _APPLY_SKIP_REASONS}


# ── Source resolution (server-authoritative -- never trust the client for identity) ─
class _SheetCarry:
    """The source + dest identity a single sheet's carry needs, resolved server-side. Bundled so
    the eight identifiers never travel positionally (source_version and dest_version are adjacent
    ints -- a transposition footgun for durable committed writes)."""

    __slots__ = (
        "source_boq", "source_sheet_name", "source_version", "source_sheet_docname",
        "dest_boq", "dest_sheet_name", "dest_version", "dest_sheet_docname",
    )

    def __init__(self, source_boq, source_sheet_name, source_version, source_sheet_docname,
                 dest_boq, dest_sheet_name, dest_version, dest_sheet_docname):
        self.source_boq = source_boq
        self.source_sheet_name = source_sheet_name
        self.source_version = source_version
        self.source_sheet_docname = source_sheet_docname
        self.dest_boq = dest_boq
        self.dest_sheet_name = dest_sheet_name
        self.dest_version = dest_version
        self.dest_sheet_docname = dest_sheet_docname


def _dest_committed_sheets(dest_boq, sheet_names=None) -> list:
    """The revision's CURRENT committed sheets (is_current=1), optionally filtered to `sheet_names`
    (a whitelist for a scoped carry). sheet_name VERBATIM (#152)."""
    filters = {"boq": dest_boq, "is_current": 1}
    rows = frappe.db.get_all(
        _BOQ_SHEET, filters=filters,
        fields=["name", "sheet_name", "commit_version", "source_boq", "source_sheet_name"],
        order_by="sheet_order asc",
    )
    if sheet_names:
        wanted = set(sheet_names)
        rows = [r for r in rows if r.sheet_name in wanted]
    return rows


def _resolve_sheet_carry(dest_boq, dest_sheet_row) -> _SheetCarry | None:
    """Resolve a dest committed sheet's SOURCE side, or None when there is nothing to carry (a
    declared-New sheet with no source, or a source sheet with no current committed version).

    Identity comes from the committed provenance stamped at commit (D2/D8): `source_sheet_name`
    off the dest `BoQ Sheet`, `source_boq` off `BOQs.source_boq`. Rates read from the source
    sheet's CURRENT committed version -- freshest, chain-aware. Falls back to the draft pointer
    (`BoQ Sheet Draft.source_sheet_name`) when a sheet predates the S8 provenance stamp."""
    source_boq = revision_source_boq(dest_boq)
    if not source_boq:
        return None  # not a revision -> nothing to carry

    source_sheet_name = dest_sheet_row.source_sheet_name or _source_sheet_name(
        dest_boq, dest_sheet_row.sheet_name
    )
    if not source_sheet_name:
        return None  # declared-New sheet -> no source

    src = frappe.db.get_value(
        _BOQ_SHEET,
        {"boq": source_boq, "sheet_name": source_sheet_name, "is_current": 1},
        ["name", "commit_version"],
        as_dict=True,
    )
    if not src:
        return None  # the source sheet has no current committed version

    return _SheetCarry(
        source_boq=source_boq,
        source_sheet_name=source_sheet_name,
        source_version=src.commit_version,
        source_sheet_docname=src.name,
        dest_boq=dest_boq,
        dest_sheet_name=dest_sheet_row.sheet_name,
        dest_version=dest_sheet_row.commit_version,
        dest_sheet_docname=dest_sheet_row.name,
    )


# ── The shared classifier (plan + apply both call it -- NO drift, NO client trust) ──
def _classify_carry(ctx: _SheetCarry, match) -> list:
    """Classify EVERY filled source cell for carry into the dest sheet. Source-driven, per-cell,
    destination-keyed. `match` = the D6 `RowMatchResult` (the twin map + per-source-row outcome),
    passed in so plan and apply re-derive it once each from the same call. PURE READ (no writes).

    Each plan row:
      {source_excel_row, dest_excel_row, description, dest_description, source_rate, area,
       rate_kind, source_boq, source_version,
       outcome: 1|2|3,          # 1 HARD SKIP / 2 clean copy / 3 conflict
       skip_reason,             # outcome 1 only: removed|no_rate_column|non_priceable
       target_col_letter,       # the RE-RESOLVED dest rate column (null on a skip)
       current_rate, reason}
    """
    twin = match.original_to_revised   # source excel_row -> dest excel_row (matched pairs only)

    # Dest current version: node descriptions + the restricted rate-role inverse + filled cells.
    dest_rows = get_committed_rows(boq_name=ctx.dest_boq, sheet_name=ctx.dest_sheet_name)
    dest_desc_by_row = {
        r.get("source_row_number"): r.get("description") for r in (dest_rows.get("rows") or [])
    }
    rate_index = pricing._current_rate_column_index(dest_rows.get("column_descriptors") or [])
    dest_filled = {
        (p["excel_row"], p["col_letter"]): p
        for p in pricing.get_sheet_pricing(
            boq_name=ctx.dest_boq, sheet_name=ctx.dest_sheet_name,
            committed_version=ctx.dest_version,
        )["pricing"]
        if p.get("is_filled")
    }

    # Source rates: the priced cells (the copy SOURCE), read VERSION-PINNED to the source sheet's
    # CURRENT committed version -- the same version the structure below reads.
    #
    # ⚠️ AMENDMENT C (owner-directed, 2026-07-23) REVERSES Amendment B W6 / ADR-0014 A10, which
    # had made this one read cross-version. The owner's rule: once a revision exists, the original
    # is not edited further, so its current committed version IS its final state, and the carry
    # should move exactly what a user looking at the original can see. Rates and structure are
    # therefore symmetric again -- W6's deliberate asymmetry is retired, not overlooked.
    #
    # The cost, accepted and made VISIBLE rather than silent: `BoQ Cell Pricing.is_current` is
    # scoped per committed version, so a source sheet priced BEFORE its last re-commit has its
    # rates orphaned on the frozen version and this read returns zero for them. The mapping
    # screen's count (`revision._carry_counts`) is pinned identically, so the count and the carry
    # still cannot disagree -- the screen promises zero and the carry lands zero. Restoring W6 =
    # reverting to `pricing.current_sheet_pricing_any_version`.
    src_pricing = pricing.get_sheet_pricing(
        boq_name=ctx.source_boq,
        sheet_name=ctx.source_sheet_name,
        committed_version=ctx.source_version,
    )["pricing"]
    src_desc_by_row = {
        r.get("source_row_number"): r.get("description")
        for r in (
            get_committed_rows_at_version(
                boq_name=ctx.source_boq, sheet_name=ctx.source_sheet_name,
                committed_version=ctx.source_version,
            ).get("rows") or []
        )
    }

    plan = []
    for p in src_pricing:
        if not p.get("is_filled"):
            continue
        src_excel_row = p["excel_row"]
        area = p.get("area")
        rate_kind = p.get("rate_kind")
        row = {
            "source_excel_row": src_excel_row,
            "dest_excel_row": None,
            "description": src_desc_by_row.get(src_excel_row),
            "dest_description": None,
            "source_rate": p.get("rate"),
            "area": area,
            "rate_kind": rate_kind,
            "source_boq": ctx.source_boq,
            # The version this RATE actually lives on -- not necessarily the source sheet's
            # current committed version (W6: an orphaned rate carries its own older version).
            # Sheet-level provenance stays `ctx.source_version` in the plan envelope.
            "source_version": p.get("committed_version"),
            "outcome": pricing._CF_SKIP,
            "skip_reason": None,
            "target_col_letter": None,
            "current_rate": None,
            "reason": None,
        }
        # (1a) TWIN -- the source row must have a matched dest twin. Amendment B collapsed the
        # match to "paired or not", so the old ambiguous/removed split is gone: there is exactly one
        # not-carried reason here. A row fails to pair because it moved, was reworded, or is not in
        # the revision at all -- from the pricing screen's point of view those are the same
        # instruction ("price it by hand"). Unmatched DEST rows are unreachable here (the plan is
        # source-driven) -- the grid is their review surface (S10).
        dest_excel_row = twin.get(src_excel_row)
        if dest_excel_row is None:
            row["skip_reason"] = "removed"
            row["reason"] = ("This row has no matching row in the revision (moved, reworded or "
                             "removed) -- not carried.")
            plan.append(row)
            continue
        row["dest_excel_row"] = dest_excel_row
        row["dest_description"] = dest_desc_by_row.get(dest_excel_row)
        # (1b/1c/2/3) SHARED resolver (pricing._resolve_rate_carry_target -- one home with the
        # same-BOQ copy-forward, so the two carry paths cannot drift): re-resolve the rate column by
        # (area, rate_kind) against the DEST columns (a column MOVE re-resolves; a role SWAP is
        # free; the source's bare col_letter is NEVER a write target), the priceability re-gate on
        # the DEST node (allow_non_priceable NOT honoured), and clean-vs-conflict. Reason strings
        # stay local (revision phrasing).
        target_col, skip_reason, dest = pricing._resolve_rate_carry_target(
            rate_index, dest_filled, ctx.dest_boq, ctx.dest_sheet_name, dest_excel_row,
            ctx.dest_version, area, rate_kind,
        )
        if skip_reason == "no_rate_column":
            row["skip_reason"] = "no_rate_column"
            row["reason"] = "This rate column does not exist in the revision -- not carried."
            plan.append(row)
            continue
        if skip_reason == "non_priceable":
            row["skip_reason"] = "non_priceable"
            row["reason"] = "This row is not priceable in the revision -- not carried."
            plan.append(row)
            continue
        row["target_col_letter"] = target_col
        if dest is not None:
            row["outcome"] = pricing._CF_CONFLICT
            row["current_rate"] = dest.get("rate")
        else:
            row["outcome"] = pricing._CF_CLEAN
        plan.append(row)
    return plan


def _plan_counts(plan) -> dict:
    """Roll a plan up into the count summary the dialog reads (clean + conflict + the 4 plan skips;
    `invalid` is apply-time only, so it is absent here)."""
    counts = {"clean": 0, "conflict": 0, **{reason: 0 for reason in _PLAN_SKIP_REASONS}}
    for r in plan:
        if r["outcome"] == pricing._CF_CLEAN:
            counts["clean"] += 1
        elif r["outcome"] == pricing._CF_CONFLICT:
            counts["conflict"] += 1
        else:
            counts[r["skip_reason"]] += 1
    return counts


def _count_new_priceable_rows(ctx: _SheetCarry, match) -> int:
    """Count the UNMATCHED dest rows that are PRICEABLE -- the "N rows need new values" figure the
    results modal shows. Unmatched dest rows never enter the source-driven plan, so they are counted
    here from the match + the dest nodes.

    Amendment B: "unmatched" replaces the old D6 `NEW` outcome. It is a strictly wider set (a dest
    row that moved or was reworded is now unmatched rather than paired), which is correct for this
    figure -- such a row genuinely has no carried rate and does need a value typed.
    """
    new_rows = list(match.unmatched_revised())
    if not new_rows:
        return 0
    nodes = frappe.db.get_all(
        _NODE,
        filters={"boq": ctx.dest_boq, "sheet": ctx.dest_sheet_docname, "is_current": 1},
        fields=["source_row_number", "node_type", "qty", "name"],
    )
    priceable_by_row = {
        n.source_row_number: pricing._node_priceable_without_override(
            n.node_type, n.name, n.qty
        )
        for n in nodes
    }
    return sum(1 for r in new_rows if priceable_by_row.get(r))


# ── Endpoint: read-only plan ───────────────────────────────────────────────────────
@frappe.whitelist()
def get_cross_boq_carry_plan(source_boq=None, source_version=None, dest_boq=None,
                             sheet_names=None) -> dict:
    """READ-ONLY. Classify EVERY filled source rate on the ORIGINAL for carry into the revision
    `dest_boq`, per committed sheet. `source_boq` / `source_version` are advisory -- the server
    re-derives the real source per-sheet (BOQs.source_boq + committed provenance + the source
    sheet's CURRENT committed version) and never trusts the client for identity.

    Returns {source_boq, dest_boq, sheets: [{sheet_name, source_sheet_name, source_version,
    dest_version, plan, counts, formulas_complete, needs_new_value_count}]}.
    URL: /api/method/nirmaan_stack.api.boq.wizard.cross_boq_carry.get_cross_boq_carry_plan
    """
    resolved_source = _require_revision(dest_boq)
    _assert_source_boq_matches(dest_boq, source_boq, resolved_source)
    sheet_names = _coerce_sheet_names(sheet_names)

    sheets = []
    for dest_row in _dest_committed_sheets(dest_boq, sheet_names):
        ctx = _resolve_sheet_carry(dest_boq, dest_row)
        if ctx is None:
            continue  # no source (declared-New / uncommitted source) -> not in the plan
        pricing._assert_carry_versions_distinct(
            ctx.source_boq, ctx.source_version, ctx.dest_boq, ctx.dest_version
        )
        match = committed_excel_row_match(
            ctx.source_boq, ctx.source_sheet_docname, ctx.dest_boq, ctx.dest_sheet_docname
        )
        plan = _classify_carry(ctx, match)
        sheets.append({
            "sheet_name": ctx.dest_sheet_name,
            "source_sheet_name": ctx.source_sheet_name,
            "source_version": ctx.source_version,
            "dest_version": ctx.dest_version,
            "plan": plan,
            "counts": _plan_counts(plan),
            "formulas_complete": bool(
                pricing._sheet_formulas_complete(
                    ctx.dest_boq, ctx.dest_sheet_name, ctx.dest_version
                )
            ),
            "needs_new_value_count": _count_new_priceable_rows(ctx, match),
        })
    return {"source_boq": resolved_source, "dest_boq": dest_boq, "sheets": sheets}


# ── Endpoint: the SYNCHRONOUS per-sheet carry (Amendment C, C2; rates-only since Amendment D) ──
@frappe.whitelist(methods=["POST"])
def apply_sheet_carry(dest_boq=None, sheet_name=None, decisions=None) -> dict:
    """Carry ONE sheet's rates from the original, synchronously.

    Amendment C's replacement for the hub's whole-BoQ long job: the pricing editor is the launch
    point, one sheet is the unit, and the caller is sitting on the screen -- so this returns the
    summary directly instead of a job id. Precedent + volume proof: `pricing.apply_copy_forward`
    does the same row counts over the same `_write_cell_price_record` core synchronously.

    ATOMIC: one lock acquire, one commit, and a full rollback on ANY error.

    `decisions` = [{dest_excel_row, area, rate_kind, overwrite}] (presence = "carry this cell";
    `overwrite` matters only for a conflict). The server RE-DERIVES every rate outcome, target
    column and rate, so a client-supplied outcome / column / rate is never trusted.

    ⚠️ AMENDMENT D: the `layers` parameter is GONE. Annotations are not carried by any seam. A
    stale client still POSTING `layers` is harmless: the whitelisted HTTP path routes through
    `frappe.call`, which filters kwargs to the signature, so the extra key is dropped and the call
    writes rates only. (A direct PYTHON call with `layers=` does no filtering and raises TypeError
    -- the tolerance is a property of the HTTP seam, not of this function.)

    Returns {ok, copied, conflicts_overwritten, conflicts_kept, skipped}.
    URL: /api/method/nirmaan_stack.api.boq.wizard.cross_boq_carry.apply_sheet_carry
    """
    _require_revision(dest_boq)
    if not sheet_name:
        frappe.throw("sheet_name is required.", title="Missing field: sheet_name")

    dest_rows = _dest_committed_sheets(dest_boq, [sheet_name])
    if not dest_rows:
        frappe.throw(
            f"Sheet '{sheet_name}' has no current committed version on this revision.",
            title="Not committed",
        )
    ctx = _resolve_sheet_carry(dest_boq, dest_rows[0])
    if ctx is None:
        frappe.throw(
            "This sheet has no matching sheet in the original -- there is nothing to carry.",
            title="No source sheet",
        )

    try:
        summary, reason = _apply_sheet_carry(
            ctx,
            _coerce_decisions_list(decisions),
            frappe.session.user,
        )
    except Exception:
        frappe.db.rollback()  # ATOMIC -- a mid-apply failure leaves NOTHING written
        raise

    if reason:
        message = _APPLY_BLOCK_MESSAGE[reason]
        if reason == "categories_incomplete":
            # the ONLY block that names the destination sheet -- two BOQs are in play, so
            # "this sheet" would be ambiguous (owner requirement, Slice G2c).
            message = message.format(sheet=ctx.dest_sheet_name)
        frappe.throw(message, title=_APPLY_BLOCK_TITLE[reason])

    summary["ok"] = True
    return summary


#: The known gate blocks `_apply_sheet_carry` reports, as user-facing copy. The worker path
#: (C6 removes it) routes these same reasons into its per-sheet `failed[]` instead.
_APPLY_BLOCK_MESSAGE = {
    "locked_deliberate": "This sheet is locked for editing. Unlock it before carrying.",
    "formulas_incomplete": (
        "Every amount column on this sheet needs a declared formula before anything can be "
        "carried. Define the missing amount formulas first."
    ),
    # {sheet} is filled with the DESTINATION sheet name at the throw site (two BOQs are in play, so
    # "this sheet" would be ambiguous -- owner requirement, Slice G2c). This is the only block whose
    # message is a template; the endpoint formats it, the others are plain.
    "categories_incomplete": (
        "Nothing was carried. The destination sheet '{sheet}' still has rows without a category - "
        "every line item and preamble needs one. Your existing rates are untouched. Categorise the "
        "destination, then run the carry again and the rates will come across. An admin can override "
        "this to carry before classification is complete."
    ),
    "locked": "Another user is editing this sheet right now. Try again once they finish.",
}
_APPLY_BLOCK_TITLE = {
    "locked_deliberate": "Sheet locked",
    "formulas_incomplete": "Formulas incomplete",
    "categories_incomplete": "Categories incomplete",
    "locked": "Being edited",
}


def _apply_sheet_carry(ctx: _SheetCarry, decisions, user):
    """Apply ONE sheet's carry decisions. Returns (summary, None) on success (committed) or
    (None, reason) for a known-gate block ('locked_deliberate' | 'formulas_incomplete' | 'locked').
    An UNEXPECTED error propagates to the caller (the synchronous endpoint's rollback). Mirrors
    `pricing.apply_copy_forward`'s inner logic, cross-BOQ. RATES ONLY (Amendment D).

    The server RE-DERIVES the plan (via `_classify_carry` over a fresh D6 match) keyed by
    (dest_excel_row, area, rate_kind) -- a client-supplied outcome / target col / rate is NEVER
    trusted, so a crafted POST cannot write a wrong column or an outcome-1 row."""
    # Version pair-guard (defensive: a revision's source is a different BOQ, so this never fires,
    # but it is the single home for "read == write sheet-version").
    pricing._assert_carry_versions_distinct(
        ctx.source_boq, ctx.source_version, ctx.dest_boq, ctx.dest_version
    )

    # SHEET-LEVEL gates -- a block fails THIS sheet in isolation (never the batch). The deliberate
    # lock + mandatory amount-formula gate mirror apply_copy_forward; here they route to a reason.
    if pricing._get_sheet_is_locked(ctx.dest_boq, ctx.dest_sheet_name, ctx.dest_version):
        return None, "locked_deliberate"
    if not pricing._sheet_formulas_complete(
        ctx.dest_boq, ctx.dest_sheet_name, ctx.dest_version
    ):
        return None, "formulas_incomplete"
    # CATEGORY GATE (Slice G2c) -- carried rates land on the DESTINATION sheet, so the DESTINATION's
    # categories govern (NOT the source). ONE shared condition (pricing._categories_gate_ok) drives
    # this and the save/copy-forward throws; here we keep this file's reason-tuple idiom so the block
    # surfaces as the mapped friendly message. Sheet-level, checked ONCE (never per row); the admin
    # override on the DEST sheet is the only escape. AFTER formula (which keeps precedence), BEFORE
    # the transient-lock acquire -- so a block returns before any write and nothing is mutated.
    if not pricing._categories_gate_ok(
        ctx.dest_boq, ctx.dest_sheet_name, ctx.dest_version
    ):
        return None, "categories_incomplete"

    try:
        # ONE single-editor-lock acquire on the dest version -- a lock held by ANOTHER user throws
        # (BOQ_PRICING_LOCKED) -> this sheet fails isolated.
        pricing.acquire_or_refresh(
            ctx.dest_boq, ctx.dest_sheet_name, ctx.dest_version, user, now_datetime()
        )
    except Exception:
        frappe.db.rollback()
        return None, "locked"

    match = committed_excel_row_match(
        ctx.source_boq, ctx.source_sheet_docname, ctx.dest_boq, ctx.dest_sheet_docname
    )
    plan_by_cell = {
        (r["dest_excel_row"], r["area"], r["rate_kind"]): r
        for r in _classify_carry(ctx, match)
        if r["dest_excel_row"] is not None  # skips never key a decision
    }

    summary = {
        "copied": 0,
        "conflicts_overwritten": 0,
        "conflicts_kept": 0,
        "skipped": _zero_apply_skips(),
    }

    for d in decisions:
        if not isinstance(d, dict):
            summary["skipped"]["invalid"] += 1
            continue
        try:
            dest_excel_row = pricing._coerce_int(d.get("dest_excel_row"), "dest_excel_row")
        except Exception:
            summary["skipped"]["invalid"] += 1
            continue
        key = (dest_excel_row, d.get("area"), d.get("rate_kind"))
        r = plan_by_cell.get(key)
        if r is None:
            summary["skipped"]["invalid"] += 1  # references no real carryable cell
            continue
        if r["outcome"] == pricing._CF_SKIP:
            summary["skipped"][r["skip_reason"]] += 1  # NEVER written (server-enforced)
            continue
        if r["outcome"] == pricing._CF_CONFLICT and not pricing._coerce_bool(d.get("overwrite")):
            summary["conflicts_kept"] += 1
            continue
        # Resolve the DEST node + write via the shared core (no per-cell commit). The target col is
        # the RE-RESOLVED dest column; the rate is the SOURCE rate; description = the DEST row's.
        node = pricing._resolve_committed_cell(
            ctx.dest_boq, ctx.dest_sheet_name, dest_excel_row, ctx.dest_version
        )
        pricing._write_cell_price_record(
            node["name"], ctx.dest_boq, ctx.dest_sheet_name, dest_excel_row,
            r["target_col_letter"], ctx.dest_version, float(r["source_rate"] or 0.0),
            r["area"], r["rate_kind"], r["dest_description"],
        )
        if r["outcome"] == pricing._CF_CONFLICT:
            summary["conflicts_overwritten"] += 1
        else:
            summary["copied"] += 1

    # AMENDMENT D: nothing but rates is written here. The annotation-layer block that used to ride
    # this same transaction is deleted -- see the module docstring.
    frappe.db.commit()  # ONE commit for THIS sheet (per-sheet isolation)
    return summary, None


# ── Small shared guards / coercions ────────────────────────────────────────────────
def _require_revision(dest_boq) -> str:
    """Validate dest_boq exists and is a revision (origin=revision with source_boq set), returning
    the server-resolved ORIGINAL (`BOQs.source_boq`) -- the authoritative source identity."""
    if not dest_boq:
        frappe.throw("dest_boq is required.", title="Missing field: dest_boq")
    if not frappe.db.exists("BOQs", dest_boq):
        frappe.throw(f"BOQs '{dest_boq}' not found.", title="Not found")
    resolved = revision_source_boq(dest_boq)
    if not resolved:
        frappe.throw("This BoQ is not a revision -- nothing to carry rates from.",
                     title="Not a revision")
    return resolved


def _assert_source_boq_matches(dest_boq, source_boq, resolved_source) -> None:
    """The endpoints accept `source_boq` for API-contract stability with S10, but the server never
    trusts the client for identity -- it re-derives the original from `BOQs.source_boq`. If the
    client DID pass a source_boq it must MATCH (reject a mismatch rather than silently ignoring it).
    (`source_version` stays advisory: the real per-sheet source version is the source sheet's
    CURRENT committed version, resolved in `_resolve_sheet_carry`.)"""
    if source_boq and source_boq != resolved_source:
        frappe.throw(
            f"source_boq {source_boq!r} does not match this revision's original "
            f"{resolved_source!r}.",
            title="Source mismatch",
        )


def _coerce_sheet_names(sheet_names):
    """sheet_names may arrive as a JSON string over HTTP -> a list, or None (all sheets)."""
    if sheet_names is None or sheet_names == "":
        return None
    if isinstance(sheet_names, str):
        try:
            sheet_names = json.loads(sheet_names)
        except (ValueError, TypeError):
            frappe.throw("sheet_names must be a JSON list.", title="Invalid sheet_names")
    if not isinstance(sheet_names, list):
        frappe.throw("sheet_names must be a list.", title="Invalid sheet_names")
    return sheet_names


def _coerce_decisions_list(decisions):
    """One sheet's decision list; may arrive as a JSON string over HTTP. Mirrors
    `pricing.apply_copy_forward`'s coercion (the per-sheet twin of `_coerce_decisions`)."""
    if isinstance(decisions, str):
        try:
            decisions = json.loads(decisions or "[]")
        except (ValueError, TypeError):
            frappe.throw("decisions must be a JSON list.", title="Invalid decisions")
    decisions = decisions or []
    if not isinstance(decisions, list):
        frappe.throw("decisions must be a list.", title="Invalid decisions")
    return decisions
