# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""S7a / plan-slice S9 (#1105, ADR-0014 D9) -- cross-BOQ RATE carry (backend).

The money. After a revision is committed, one explicit post-commit action pulls the ORIGINAL's
rates across into the revision. This is NOT net-new plumbing -- it is `pricing.py`'s same-BOQ
copy-forward classifier pointed cross-BOQ, wearing `classify.py`'s Redis-marker long-job
scaffolding:

  * A source-driven, per-CELL plan (one Excel row yields several entries, one per area/rate_kind),
    DESTINATION-keyed `(dest_excel_row, area, rate_kind)` -- the source and dest Excel rows DIFFER
    (D6 matches on description, not row number), so each plan entry carries BOTH. D6 `NEW` rows
    never enter the plan (they have no source rate) -- the grid is their review surface (S10).
  * The `(area, rate_kind)` re-resolution runs against the DESTINATION's rate columns
    (`_current_rate_column_index`), so a column MOVE re-resolves correctly and the source's bare
    `col_letter` is NEVER a write target.
  * A split skip taxonomy: `removed` (unpaired -- Amendment B collapsed D6 REMOVED+AMBIGUOUS
    into this one reason) / `no_rate_column`
    / `non_priceable` / `invalid`. Today's same-BOQ `non_match` conflated "gone" with "can't tell";
    cross-BOQ they need different human responses.
  * A long job with PER-SHEET failure isolation -- a loop over the per-sheet plan, NOT one giant
    transaction: one `acquire_or_refresh` + one `frappe.db.commit()` + rollback-on-failure per
    sheet, so a held lock (or an incomplete-formula sheet) fails ONE sheet, never the batch. Emits
    `boq:carry_rates_done {carried, failed}`.
  * Plan AND apply RE-DERIVE the plan server-side via the SAME classifier (`_classify_carry`) over
    a freshly-derived D6 match -- a client-supplied outcome / target column / rate is NEVER trusted.

SOURCE VERSION: rates carry from the source sheet's CURRENT committed version (`is_current=1`),
resolved per-sheet -- the freshest rates, chain-aware (a committed revision is itself revisable,
D1), and consistent with how `commit_overlay`'s twin map already reads both sides. The endpoint's
`source_boq` / `source_version` params are advisory: the server re-derives the real source from
`BOQs.source_boq` + each sheet's committed provenance (`BoQ Sheet.source_sheet_name`, stamped at
commit by S8) and never trusts the client for identity.
"""

import json

import frappe
from frappe.utils import now_datetime
from frappe.utils.background_jobs import get_job_status

from nirmaan_stack.api.boq.wizard import pricing
from nirmaan_stack.api.boq.wizard.commit_overlay import committed_excel_row_match
from nirmaan_stack.api.boq.wizard.review_carry import _source_sheet_name, revision_source_boq
from nirmaan_stack.api.boq.wizard.review_screen import (
    get_committed_rows,
    get_committed_rows_at_version,
)

_BOQ_SHEET = "BoQ Sheet"
_NODE = "BOQ Nodes"

_STATUS_PREFIX = "boq_carry_rates_status"
_MARKER_PREFIX = "boq_carry_rates_marker"
_STATUS_TTL_SEC = 3600  # 1h -- ample for a client to poll the fallback
_MARKER_TTL_SEC = 3600
_STALE_CARRY_SECONDS = 1200  # mirrors classify._STALE_CLASSIFY_SECONDS / parse_run

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


# ── Redis key + marker helpers (BOQ-scoped -- the job is whole-BOQ) ─────────────────
def _status_key(dest_boq):
    return f"{_STATUS_PREFIX}::{dest_boq}"


def _marker_key(dest_boq):
    return f"{_MARKER_PREFIX}::{dest_boq}"


def _set_marker(dest_boq, job_id, user):
    frappe.cache().set_value(
        _marker_key(dest_boq),
        {"job_id": job_id, "enqueued_at": frappe.utils.now(), "user": user},
        expires_in_sec=_MARKER_TTL_SEC,
    )


def _get_marker(dest_boq):
    return frappe.cache().get_value(_marker_key(dest_boq))


def _clear_marker(dest_boq):
    frappe.cache().delete_value(_marker_key(dest_boq))


def _maybe_self_heal(dest_boq, marker):
    """Given a present marker, return 'running' | 'cleared' | 'cleared_stale'. Clears the marker
    when the RQ job is terminal (finished/failed/unknown) or the enqueue is older than the stale
    cap. Mirrors classify._maybe_self_heal / parse_run._maybe_self_heal_parse_state."""
    job_id = marker.get("job_id")
    status = None
    if job_id:
        try:
            status = get_job_status(job_id)
        except Exception:
            status = None
    if status in ("finished", "failed") or status is None:
        _clear_marker(dest_boq)
        return "cleared"
    enqueued_at = marker.get("enqueued_at")
    if enqueued_at:
        try:
            age = frappe.utils.time_diff_in_seconds(frappe.utils.now(), enqueued_at)
        except Exception:
            age = 0
        if age > _STALE_CARRY_SECONDS:
            _clear_marker(dest_boq)
            return "cleared_stale"
    return "running"


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

    # Source rates: the priced cells (the copy SOURCE), read CROSS-VERSION (ADR-0014 A10 /
    # Amendment B W6). `is_current` is scoped per committed version, so a source sheet priced at
    # v1 and then re-committed to v2 has its rates ORPHANED on v1 -- a version-pinned read
    # returned zero and the carry silently landed nothing. `current_sheet_pricing_any_version`
    # takes each cell's newest current row instead. STRUCTURE below stays version-pinned: the
    # asymmetry is deliberate (pricing keeps being edited after the structure freezes).
    src_pricing = pricing.current_sheet_pricing_any_version(
        ctx.source_boq, ctx.source_sheet_name
    )
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


# ── Endpoint: start the long carry job ─────────────────────────────────────────────
@frappe.whitelist(methods=["POST"])
def start_cross_boq_carry(source_boq=None, source_version=None, dest_boq=None,
                          decisions_by_sheet=None) -> dict:
    """Enqueue the whole-BOQ rate carry (a long job on the parse_run/classify pattern). Returns
    immediately with the raw job_id. `decisions_by_sheet` = {sheet_name: [{dest_excel_row, area,
    rate_kind, overwrite}, ...]} -- presence in a sheet's list = "carry this cell"; `overwrite`
    matters ONLY for a conflict. The worker re-derives every outcome server-side (a client outcome
    / target column / rate is never trusted). BOQ-scoped Redis marker; commit BEFORE the enqueue's
    marker write mirrors classify.start_classify.
    URL: /api/method/nirmaan_stack.api.boq.wizard.cross_boq_carry.start_cross_boq_carry
    """
    resolved_source = _require_revision(dest_boq)
    _assert_source_boq_matches(dest_boq, source_boq, resolved_source)
    decisions_by_sheet = _coerce_decisions(decisions_by_sheet)

    # Double-fire guard + self-heal.
    marker = _get_marker(dest_boq)
    if marker and _maybe_self_heal(dest_boq, marker) == "running":
        frappe.throw(
            "A rate carry is already in progress for this BoQ. "
            "Wait for it to finish before starting another.",
            title="Carry in progress",
        )

    raw_job_id = frappe.generate_hash(length=32)
    user = frappe.session.user
    frappe.enqueue(
        "nirmaan_stack.api.boq.wizard.cross_boq_carry._carry_rates_worker",
        queue="long",
        timeout=600,
        job_id=raw_job_id,
        user=user,
        dest_boq=dest_boq,
        decisions_by_sheet=decisions_by_sheet,
    )
    # Clear any stale terminal payload, set the marker, commit -- all AFTER a successful enqueue.
    frappe.cache().delete_value(_status_key(dest_boq))
    _set_marker(dest_boq, raw_job_id, user)
    frappe.db.commit()
    return {"status": "queued", "job_id": raw_job_id}


def _carry_rates_worker(dest_boq=None, decisions_by_sheet=None, user=None) -> None:
    """Background worker: loop the selected sheets with PER-SHEET failure isolation (one commit per
    sheet, rollback-on-failure), then record + publish the terminal {carried, failed} payload. A
    single sheet's held lock / incomplete formulas / unexpected error fails ONLY that sheet."""
    decisions_by_sheet = decisions_by_sheet or {}
    carried = 0
    conflicts_overwritten = 0
    conflicts_kept = 0
    skipped = _zero_apply_skips()
    failed = []

    try:
        for dest_row in _dest_committed_sheets(dest_boq):
            sheet_name = dest_row.sheet_name
            decisions = decisions_by_sheet.get(sheet_name)
            if not decisions:
                continue  # sheet not selected for this carry
            ctx = _resolve_sheet_carry(dest_boq, dest_row)
            if ctx is None:
                failed.append({"sheet_name": sheet_name, "reason": "no_source"})
                continue
            try:
                result, reason = _apply_sheet_carry(ctx, decisions, user)
                if reason:
                    failed.append({"sheet_name": sheet_name, "reason": reason})
                    continue
                carried += result["copied"] + result["conflicts_overwritten"]
                conflicts_overwritten += result["conflicts_overwritten"]
                conflicts_kept += result["conflicts_kept"]
                for k, v in result["skipped"].items():
                    skipped[k] += v
            except Exception:
                frappe.db.rollback()
                frappe.log_error(
                    title="BoQ cross-BOQ rate carry: sheet failed",
                    message=f"sheet {sheet_name!r} of {dest_boq!r}\n\n{frappe.get_traceback()}",
                )
                failed.append({"sheet_name": sheet_name, "reason": "error"})

        payload = {
            "status": "success",
            "boq_name": dest_boq,
            "carried": carried,
            "conflicts_overwritten": conflicts_overwritten,
            "conflicts_kept": conflicts_kept,
            "skipped": skipped,
            "failed": failed,
        }
    except Exception:
        frappe.db.rollback()
        frappe.log_error(title="BoQ cross-BOQ rate carry worker failed",
                         message=frappe.get_traceback())
        payload = {
            "status": "error",
            "boq_name": dest_boq,
            "error_code": "carry_failed",
            "carried": carried,
            "failed": failed,
        }
    _publish_carry_event(dest_boq, user, payload)


def _apply_sheet_carry(ctx: _SheetCarry, decisions, user):
    """Apply ONE sheet's carry decisions. Returns (summary, None) on success (committed) or
    (None, reason) for a known-gate block ('locked_deliberate' | 'formulas_incomplete' | 'locked').
    An UNEXPECTED error propagates to the worker's per-sheet catch (which rolls back). Mirrors
    `pricing.apply_copy_forward`'s inner logic, cross-BOQ and per-sheet-isolated.

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

    frappe.db.commit()  # ONE commit for THIS sheet (per-sheet isolation)
    return summary, None


def _publish_carry_event(dest_boq, user, payload):
    """Choke-point: record the terminal payload (Redis fallback), clear the marker, THEN publish.
    Redis writes live outside the DB transaction, so they survive a worker rollback. Mirrors
    classify._publish_classify_event."""
    frappe.cache().set_value(_status_key(dest_boq), payload, expires_in_sec=_STATUS_TTL_SEC)
    _clear_marker(dest_boq)
    publish_kwargs = {"user": user} if user else {}
    frappe.publish_realtime("boq:carry_rates_done", payload, **publish_kwargs)


# ── Endpoint: polling fallback (on-mount recovery / reconnect self-heal for S10) ────
@frappe.whitelist()
def get_cross_boq_carry_status(dest_boq=None) -> dict:
    """Polling fallback for a carry run, keyed by dest_boq. Same payload shape as the
    boq:carry_rates_done socket event so one frontend handler serves both.
    States: {"state":"done", **payload} | {"state":"running"} | {"state":"idle"}.
    URL: /api/method/nirmaan_stack.api.boq.wizard.cross_boq_carry.get_cross_boq_carry_status
    """
    if not dest_boq:
        frappe.throw("dest_boq is required.", title="Missing field: dest_boq")
    term = frappe.cache().get_value(_status_key(dest_boq))
    if term:
        return {"state": "done", **term}
    marker = _get_marker(dest_boq)
    if marker and _maybe_self_heal(dest_boq, marker) == "running":
        return {"state": "running"}
    return {"state": "idle"}


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


def _coerce_decisions(decisions_by_sheet):
    """decisions_by_sheet may arrive as a JSON string over HTTP -> a dict of sheet_name -> list."""
    if isinstance(decisions_by_sheet, str):
        try:
            decisions_by_sheet = json.loads(decisions_by_sheet or "{}")
        except (ValueError, TypeError):
            frappe.throw("decisions_by_sheet must be a JSON object.", title="Invalid decisions")
    decisions_by_sheet = decisions_by_sheet or {}
    if not isinstance(decisions_by_sheet, dict):
        frappe.throw("decisions_by_sheet must be an object keyed by sheet_name.",
                     title="Invalid decisions")
    return decisions_by_sheet
