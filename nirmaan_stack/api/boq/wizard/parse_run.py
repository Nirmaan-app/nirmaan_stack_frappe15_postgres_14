"""
BoQ wizard -- parse-run functions (Slice 1: pure helpers; Slice 2: worker + endpoint).

Public API:
  assemble_mapping_config(boq_name) -> (MappingConfig, not_eligible: list[str])
  flatten_resolved_row(resolved_row, sheet_name, row_index) -> dict
  flatten_parsed_boq(parsed_boq, boq_name) -> list[dict]
  run_parse(boq_name, sheet_names=None) -> {status, job_id}  [whitelisted endpoint]
"""
from __future__ import annotations

import json
import logging
import os
import shutil
import tempfile
import urllib.parse
from typing import Any

import frappe

from nirmaan_stack.services.boq_parser.config import (
    GlobalSettings,
    MappingConfig,
    MasterBoqMetadata,
    SheetConfig,
)
from nirmaan_stack.services.boq_parser.hierarchy import ResolvedRow
from nirmaan_stack.services.boq_parser.orchestrator import ParsedBoq, parse_boq

logger = logging.getLogger(__name__)

# JSON fields on BoQ Review Row whose values are Python lists.
# Frappe's get_valid_dict() rejects Python lists for JSON fieldtype with "cannot be a list".
# These MUST be pre-serialized via json.dumps() before doc.insert().
# The four dict-type JSON fields (qty_by_area, amount_by_area, rate_by_area, append_notes_raw)
# are passed as Python dicts and auto-serialized by Frappe -- do NOT dumps those.
_LIST_JSON_FIELDS: frozenset[str] = frozenset({
    "attached_notes",
    "validation_warnings",
    "classifier_warnings",
    "preamble_candidate_signals",
})

# ---------------------------------------------------------------------------
# Per-sheet parse-lifecycle state (#164 A3-backend)
# ---------------------------------------------------------------------------

# An enqueued/started job older than this is treated as a dead worker remnant and
# self-healed (20 min). Mirrors the frontend hub's recovery expectation.
_STALE_PARSE_SECONDS = 1200

# wizard_status values admissible as a parse target under Rule 3. Mirrors
# assemble_mapping_config (the {"Config Done","Parsed"} base; "Finalized"
# joins ONLY under force_reparse). Used for enqueue-time superset marking.
_RULE3_BASE_STATUSES: frozenset[str] = frozenset({"Config Done", "Parsed"})


def _rule3_admissible_statuses(force_reparse: bool) -> frozenset[str]:
    """The wizard_status set a sheet may carry to be a parse target this run."""
    if force_reparse:
        return _RULE3_BASE_STATUSES | {"Finalized"}
    return _RULE3_BASE_STATUSES


def _set_sheet_parse_markers(boq_name: str, sheet_names, value: int) -> None:
    """Set parse_in_progress=value on each named BoQ Sheet Draft row. No commit.

    sheet_name matched VERBATIM (#152). Missing rows are silently skipped.
    """
    for sn in sheet_names:
        child_name = frappe.db.get_value(
            "BoQ Sheet Draft",
            {"parent": boq_name, "parenttype": "BOQs", "sheet_name": sn},
            "name",
        )
        if child_name:
            frappe.db.set_value("BoQ Sheet Draft", child_name, "parse_in_progress", value)


def _clear_all_sheet_parse_markers(boq_name: str) -> None:
    """Blanket-clear parse_in_progress=0 on EVERY sheet draft of this BoQ. No commit.

    A blanket clear (filter on parent/parenttype, all rows) rather than a passed
    list, so it is correct on every worker exit path -- including the top-level
    exception path where the in-loop status writes were rolled back.
    """
    frappe.db.set_value(
        "BoQ Sheet Draft",
        {"parent": boq_name, "parenttype": "BOQs"},
        "parse_in_progress",
        0,
    )


def assemble_mapping_config(
    boq_name: str, force_reparse: bool = False
) -> tuple[MappingConfig, list[str]]:
    """
    Build a MappingConfig from the saved BOQs + BoQ Sheet Draft records.

    Returns (MappingConfig, not_eligible) where not_eligible is a list of
    sheet_names that were excluded because they are Pending, have unsupported
    statuses, or are Config Done but missing a sheet_config blob.

    Inclusion rules applied in order:
      1. wizard_status in {Hidden, Skip}          -> SheetConfig(skip=True)
      2. sheet_name == BOQs.general_specs_sheet   -> treat_as="master_preamble"
      3. wizard_status in {Config Done, Parsed}   -> deserialize blob, include as data
         (+ "Finalized" ONLY when force_reparse=True -- see below)
      4. anything else (Pending, Parse failed, blank, ...) -> not_eligible

    "Parsed" is treated the same as "Config Done" because the sheet config is still
    valid and a re-run should re-parse configured sheets.

    Force Re-parse (force_reparse): when True, a "Finalized" sheet (one a
    human hand-edited on the review screen and marked checked) is ALSO admitted as
    a data parse target, on the SAME terms as Rule 3 (valid sheet_config blob still
    required; the empty-blob and invalid-blob sub-gates still apply). When False
    (the default, and the normal parse path), "Finalized" stays in
    not_eligible exactly as before -- the flag-gated branch is the ONLY way it
    becomes eligible. A successful re-parse drops it back to "Parsed" via the
    worker's unconditional status-set line (Option A); re-parsing DELETES the prior
    BoQ Review Rows, discarding the human edits/remarks by design.

    GlobalSettings always uses defaults -- no per-BoQ override exists or is wanted.
    """
    if not boq_name or not frappe.db.exists("BOQs", boq_name):
        raise frappe.ValidationError(f"BoQ '{boq_name}' not found")

    boq_doc = frappe.get_doc("BOQs", boq_name)

    master_boq = MasterBoqMetadata(
        boq_name=boq_doc.boq_name or "",
        version=int(boq_doc.version or 1),
        tax_treatment=boq_doc.tax_treatment or "Pre-tax",
        notes=boq_doc.notes or "",
    )
    project = boq_doc.project or ""

    # Build set of general-specs sheet names from child table (Slice 2c).
    # Checked FIRST in the routing loop -- outranks wizard_status so a Skip-designated
    # sheet that is also a general-specs sheet correctly routes to master_preamble.
    general_specs_sheet_names: set[str] = {
        row.source_sheet_name
        for row in (boq_doc.general_specs_sheets or [])
        if row.source_sheet_name
    }

    # GlobalSettings: always use defaults -- no per-BoQ override exists or is wanted.
    global_settings = GlobalSettings()

    sheet_configs: list[SheetConfig] = []
    not_eligible: list[str] = []

    for draft in boq_doc.sheet_drafts:
        sheet_name = draft.sheet_name
        status = draft.wizard_status or ""

        # Rule 1: general-specs set membership -- checked FIRST, outranks wizard_status.
        # The "General specs" effective status is DERIVED from the general_specs_sheets child
        # table per M2.16; wizard_status on the draft row is never set to "General specs".
        # A sheet can legally be designated while its stored wizard_status is still "Skip"
        # (common real-data case: Skip sheet later designated via hub), so the set-membership
        # check must precede the Skip/Hidden branch.
        if sheet_name in general_specs_sheet_names:
            sheet_configs.append(SheetConfig(
                sheet_name=sheet_name,
                treat_as="master_preamble",
            ))
            continue

        # Rule 2: skip / hidden sheets that are NOT the general-specs pointer.
        if status in {"Hidden", "Skip"}:
            sheet_configs.append(SheetConfig(sheet_name=sheet_name, skip=True))
            continue

        # Rule 3: Config Done or Parsed (next lifecycle state after Config Done).
        # Force Re-parse: when force_reparse is set, ALSO admit "Finalized"
        # into this SAME branch -- the blob sub-gates below then apply identically
        # (no parallel branch, no duplicated validation). Without the flag this is
        # byte-for-byte the prior behaviour and "Finalized" falls to Rule 4.
        if status in {"Config Done", "Parsed"} or (
            force_reparse and status == "Finalized"
        ):
            blob = draft.sheet_config
            if not blob:
                logger.warning(
                    "BoQ %s sheet %r: wizard_status=%r but sheet_config is empty; excluding",
                    boq_name, sheet_name, status,
                )
                not_eligible.append(sheet_name)
                continue
            try:
                raw = json.loads(blob) if isinstance(blob, str) else blob
                # FIX: production wizard blobs omit 'sheet_name' (the 6-key shape saved by
                # set_sheet_config has area_dimensions/column_role_map/header_row/header_row_count/
                # skip_top_rows_after_header/top_header_rows_override -- verified live on
                # BOQ-26-00150 and BOQ-26-00145). SheetConfig.sheet_name has no default; without
                # this injection model_validate raises and the sheet falls into not_eligible.
                raw["sheet_name"] = sheet_name
                sc = SheetConfig.model_validate(raw)
            except Exception as exc:
                logger.warning(
                    "BoQ %s sheet %r: invalid sheet_config (%s); excluding",
                    boq_name, sheet_name, exc,
                )
                not_eligible.append(sheet_name)
                continue
            sheet_configs.append(sc)
            continue

        # Rule 4: everything else (Pending, Parse failed, blank, ...) -> not_eligible.
        not_eligible.append(sheet_name)

    if not sheet_configs:
        raise frappe.ValidationError(
            f"BoQ '{boq_name}' has no eligible sheets for parsing. "
            "Mark at least one sheet as Config Done."
        )

    config = MappingConfig(
        project=project,
        master_boq=master_boq,
        global_settings=global_settings,
        sheets=sheet_configs,
    )
    return config, not_eligible


def flatten_resolved_row(
    resolved_row: ResolvedRow,
    sheet_name: str,
    row_index: int,
) -> dict[str, Any]:
    """
    Map a parser ResolvedRow to a flat dict of BoQ Review Row field values.

    JSON fields (attached_notes, qty_by_area, amount_by_area, rate_by_area,
    validation_warnings, classifier_warnings, preamble_candidate_signals,
    append_notes_raw) are returned as Python objects (lists and dicts).

    Frappe insert behaviour for JSON fieldtype:
      - dict values: auto-serialized by Frappe (pass as-is)
      - list values: REJECTED by Frappe with "cannot be a list" unless the caller
        pre-serializes them via json.dumps() before doc.insert(). The list fields
        are: attached_notes, validation_warnings, classifier_warnings,
        preamble_candidate_signals.

    The 'boq' field is NOT included here; flatten_parsed_boq injects it.

    The 'boq' field is NOT included here; flatten_parsed_boq injects it.
    """
    cr = resolved_row.classified_row

    return {
        "sheet_name": sheet_name,
        "source_row_number": cr.raw_row.row_number,
        "row_index": row_index,
        "classification": cr.classification.value,
        # -1 = "no parent" sentinel; Frappe coerces Int None->0, and 0 is a valid row
        # index, so None must be stored as -1 to stay unambiguous.
        # resolve_effective (review_screen.py) translates -1 back to None on read.
        "parent_index": resolved_row.parent_index if resolved_row.parent_index is not None else -1,
        # -1 = "no human override" sentinel (agreement #54). A freshly-parsed row has no
        # human edit, so human_parent must be written explicitly as -1. Without this,
        # Frappe coerces the unset Int field to 0 on insert. 0 is a valid row index and
        # resolve_effective treats human_parent >= 0 as a real override, falsely parenting
        # every row to row 0 and collapsing the entire tree.
        "human_parent": -1,
        "level": resolved_row.level,
        "path": resolved_row.path or "",
        "attached_to_index": resolved_row.attached_to_index,
        # list[str] -- stored as JSON array
        "attached_notes": resolved_row.attached_notes,
        "promoted_from_line_item": cr.promoted_from_line_item,
        "preamble_level_override": cr.preamble_level_override,
        "sl_no_value": cr.sl_no_value,
        "description": cr.description,
        "unit": cr.unit,
        "make_model": cr.make_model,
        "is_rate_only": cr.is_rate_only,
        "qty_total": resolved_row.qty_total,
        "amount_total": resolved_row.amount_total,
        "rate_supply": cr.rate_supply,
        "rate_install": cr.rate_install,
        "rate_combined": cr.rate_combined,
        "amount_supply": cr.amount_supply,
        "amount_install": cr.amount_install,
        # dict[str, float] -- stored as JSON object (resolved post-pass, NOT _raw copy)
        "qty_by_area": resolved_row.qty_by_area,
        "amount_by_area": resolved_row.amount_by_area,
        # dict[str, dict[str, float|None]] -- stored as JSON object
        "rate_by_area": resolved_row.rate_by_area,
        "needs_classification_review": resolved_row.needs_classification_review,
        "review_reason": resolved_row.review_reason,
        # list[str] -- sum-validation warnings on ResolvedRow (distinct from classifier warnings)
        "validation_warnings": resolved_row.validation_warnings,
        # list[str] -- classifier-level warnings on ClassifiedRow
        "classifier_warnings": cr.warnings,
        "preamble_candidate_score": cr.preamble_candidate_score,
        # list[str] -- stored as JSON array
        "preamble_candidate_signals": cr.preamble_candidate_signals,
        "row_notes": cr.row_notes,
        # dict[str, str] -- stored as JSON object
        "append_notes_raw": cr.append_notes_raw,
        "is_synthetic": resolved_row.is_synthetic,
    }


def flatten_parsed_boq(parsed_boq: ParsedBoq, boq_name: str) -> list[dict[str, Any]]:
    """
    Flatten all sheets in a ParsedBoq to a list of BoQ Review Row field dicts.

    master_preamble sheets produce no rows (their text lives on ParsedBoq.master_preamble).
    row_index is the 0-based position within each sheet's resolved_rows list.
    Each dict includes 'boq': boq_name.
    """
    rows: list[dict[str, Any]] = []
    for parsed_sheet in parsed_boq.sheets:
        for row_index, resolved_row in enumerate(parsed_sheet.resolved_rows):
            d = flatten_resolved_row(resolved_row, parsed_sheet.sheet_name, row_index)
            d["boq"] = boq_name
            rows.append(d)
    return rows


# ---------------------------------------------------------------------------
# Slice 2 -- background worker + endpoint
# ---------------------------------------------------------------------------

@frappe.whitelist(methods=["POST"])
def run_parse(boq_name: str = None, sheet_names=None, force_reparse=False):
    """
    Enqueue a background parse worker.  Returns immediately.

    sheet_names=None  -> parse all eligible Config Done/Parsed sheets.
    sheet_names=[...] -> parse only the named subset (per-sheet re-parse).

    force_reparse=False (default) -> normal parse path; "Finalized"
        sheets stay ineligible exactly as before.
    force_reparse=True -> Force Re-parse; "Finalized" sheets become
        eligible data parse targets (see assemble_mapping_config). The frontend
        sets this only for a deliberate, warned re-parse of an already-checked
        sheet (a later slice wires the button).

    URL: /api/method/nirmaan_stack.api.boq.wizard.parse_run.run_parse
    """
    if not boq_name:
        frappe.throw("boq_name is required.", title="Missing field: boq_name")
    if not frappe.db.exists("BOQs", boq_name):
        frappe.throw(f"BOQs '{boq_name}' not found.", title="Not found")

    # sheet_names may arrive as a JSON-string from the HTTP POST body
    if isinstance(sheet_names, str):
        try:
            sheet_names = json.loads(sheet_names)
        except json.JSONDecodeError:
            sheet_names = [sheet_names]

    # force_reparse may arrive as a string ("true"/"1") from the HTTP POST body;
    # coerce to a real bool so the default-False normal path can never be tripped
    # by a truthy non-empty string. Mirrors the sheet_names string-handling above.
    if isinstance(force_reparse, str):
        force_reparse = force_reparse.strip().lower() in ("1", "true", "yes")
    else:
        force_reparse = bool(force_reparse)

    # Double-fire guard + self-heal (#164). If a parse appears in flight, decide
    # whether it is genuinely live (reject) or a stuck remnant of a dead worker
    # (self-heal, then fall through and start fresh).
    if int(frappe.db.get_value("BOQs", boq_name, "parse_in_progress") or 0) == 1:
        state = _maybe_self_heal_parse_state(boq_name)
        if state == "running":
            frappe.throw(
                "A parse is already running for this BoQ. "
                "Wait for it to finish before starting another.",
                title="Parse in progress",
            )
        # "cleared" / "cleared_stale" -> the stale state was wiped; proceed.

    # Raw (un-namespaced) job id. frappe.enqueue namespaces it internally to
    # "{site}::{id}"; get_job_status re-namespaces on read, so we MUST store the
    # RAW id -- storing job.id (already namespaced) would double-namespace and
    # always read None (Recon #2 Q4).
    raw_job_id = frappe.generate_hash(length=32)

    job = frappe.enqueue(
        "nirmaan_stack.api.boq.wizard.parse_run._run_parse_worker",
        queue="long",
        timeout=600,
        job_id=raw_job_id,
        user=frappe.session.user,
        boq_name=boq_name,
        sheet_names=sheet_names,
        force_reparse=force_reparse,
    )

    # Superset marking (#164): flag every sheet that COULD parse this run. If a
    # subset was named, those; otherwise every sheet whose wizard_status is
    # Rule-3-admissible (mirrors assemble_mapping_config). The worker reconciles
    # down to the truly-eligible set once assemble_mapping_config resolves.
    if sheet_names is not None:
        target_sheets = list(sheet_names)
    else:
        admissible = _rule3_admissible_statuses(force_reparse)
        target_sheets = [
            d.sheet_name
            for d in frappe.db.get_all(
                "BoQ Sheet Draft",
                filters={"parent": boq_name, "parenttype": "BOQs"},
                fields=["sheet_name", "wizard_status"],
            )
            if (d.wizard_status or "") in admissible
        ]

    # SET only after a successful enqueue so a failed enqueue doesn't leave state
    # stuck. The BoQ-level flag + job id + enqueue timestamp + the per-sheet
    # superset markers all land in one commit.
    frappe.db.set_value("BOQs", boq_name, {
        "parse_in_progress": 1,
        "parse_job_id": raw_job_id,
        "parse_enqueued_at": frappe.utils.now(),
    })
    _set_sheet_parse_markers(boq_name, target_sheets, 1)
    frappe.db.commit()
    return {"status": "queued", "job_id": job.id if job else None}


def _maybe_self_heal_parse_state(boq_name: str) -> str:
    """
    Decide whether a BoQ with parse_in_progress=1 is genuinely live or a stuck
    remnant of a dead worker, and self-heal the stuck case.

    Assumes the caller has already confirmed BOQs.parse_in_progress == 1.

    Returns:
      "running"       -- the RQ job is live (queued/started) and within the
                         staleness window; ALL state is left untouched.
      "cleared"       -- the job finished / failed / vanished from Redis; the
                         BoQ flag, job id, enqueue timestamp, and every per-sheet
                         marker are cleared and committed.
      "cleared_stale" -- the job still reads live (or its id is gone) but
                         parse_enqueued_at is older than _STALE_PARSE_SECONDS, so
                         it is treated as a dead worker and cleared as above.

    Self-heal ALWAYS blanks parse_job_id + parse_enqueued_at (so a subsequent
    check reads "idle", not a re-evaluated stale id).
    """
    from frappe.utils.background_jobs import get_job_status

    info = frappe.db.get_value(
        "BOQs", boq_name, ["parse_job_id", "parse_enqueued_at"], as_dict=True
    )
    raw_job_id = (info.parse_job_id or "") if info else ""
    enqueued_at = info.parse_enqueued_at if info else None

    def _is_stale() -> bool:
        if not enqueued_at:
            return False
        return (
            frappe.utils.time_diff_in_seconds(frappe.utils.now(), enqueued_at)
            > _STALE_PARSE_SECONDS
        )

    def _clear() -> None:
        frappe.db.set_value("BOQs", boq_name, {
            "parse_in_progress": 0,
            "parse_job_id": None,
            "parse_enqueued_at": None,
        })
        _clear_all_sheet_parse_markers(boq_name)
        frappe.db.commit()

    # Legacy stuck state: flag set but no job id was ever stored.
    if not raw_job_id:
        stale = _is_stale()
        _clear()
        return "cleared_stale" if stale else "cleared"

    status = get_job_status(raw_job_id)
    # rq JobStatus is a str-enum; normalize to its plain string value defensively.
    status_val = getattr(status, "value", status)

    if status_val is None or status_val in ("finished", "failed"):
        _clear()
        return "cleared"

    # queued / started (or any other not-yet-terminal state) -> live unless stale.
    if _is_stale():
        _clear()
        return "cleared_stale"
    return "running"


@frappe.whitelist()
def check_parse_status(boq_name: str = None) -> dict:
    """
    Report the parse-lifecycle state of a BoQ, self-healing a stuck flag (#164).

    @frappe.whitelist() bare -- GET-capable. Ships UNWIRED: no caller yet (the
    hub-mount call lands in a later frontend slice).

    Returns {"state": "idle" | "running" | "cleared" | "cleared_stale"}:
      idle          -- parse_in_progress is not set; nothing to do.
      running       -- a live parse is in flight (see _maybe_self_heal_parse_state).
      cleared / cleared_stale -- a stuck flag was self-healed.

    URL: /api/method/nirmaan_stack.api.boq.wizard.parse_run.check_parse_status
    """
    if not boq_name:
        frappe.throw("boq_name is required.", title="Missing field: boq_name")
    if not frappe.db.exists("BOQs", boq_name):
        frappe.throw(f"BOQs '{boq_name}' not found.", title="Not found")

    if int(frappe.db.get_value("BOQs", boq_name, "parse_in_progress") or 0) != 1:
        return {"state": "idle"}
    return {"state": _maybe_self_heal_parse_state(boq_name)}


def _run_parse_worker(
    boq_name: str, sheet_names=None, user: str = None, force_reparse: bool = False
) -> None:
    """
    Background worker: fetch workbook -> assemble config -> parse -> insert BoQ Review Rows.

    force_reparse is threaded straight into assemble_mapping_config (the ONLY place
    it changes eligibility); default False keeps the normal parse path unchanged.

    Status lifecycle (per BoQ Sheet Draft.wizard_status):
      Config Done --[success]--> Parsed
      Config Done --[parse_boq failure]--> Parse failed  (global; all eligible sheets)
      Config Done --[insert failure]--> Parse failed  (per-sheet; other sheets continue)
      Parsed      --[re-parse success]--> Parsed  (rows replaced, status stays Parsed)
      Finalized   --[force re-parse success]--> Parsed  (rows replaced; Option A)

    General-specs sheet (treat_as=master_preamble): never set to Parsed; produces no rows.
    Master-preamble text: extracted by parse_boq and written to BOQs.master_preamble when
    non-empty. Falsy result does NOT blank an existing value.

    Event published (user-targeted): 'boq:parse_run_done'
      success: {status, boq_name, parsed_sheets, not_parsed_sheets, failed_sheets}
      error:   {status, boq_name, error_code}
    """
    if user:
        frappe.set_user(user)

    tempfile_path = None
    parsed_sheets: list[str] = []
    failed_sheets: list[str] = []
    not_eligible: list[str] = []

    try:
        # Step 1: Fetch the workbook file (S3 or local)
        source_file_url = frappe.db.get_value("BOQs", boq_name, "source_file_url")
        if not source_file_url:
            _publish_parse_event(boq_name, "error", user=user, error_code="missing_file")
            return

        try:
            tempfile_path = _fetch_boq_file_to_tempfile(source_file_url)
        except Exception:
            frappe.log_error(title="BoQ parse: file fetch failed", message=frappe.get_traceback())
            _publish_parse_event(boq_name, "error", user=user, error_code="fetch_failed")
            return

        # Step 2: Assemble mapping config (applies FIX: sheet_name injection in Rule 3)
        # force_reparse admits "Finalized" sheets here and nowhere else.
        try:
            config, not_eligible = assemble_mapping_config(boq_name, force_reparse=force_reparse)
        except frappe.ValidationError as exc:
            logger.error("BoQ %s: assemble_mapping_config failed: %s", boq_name, exc)
            _publish_parse_event(boq_name, "error", user=user, error_code="no_eligible_sheets")
            return

        # Step 3: If sheet_names subset given, narrow config (skip/master_preamble pass through)
        if sheet_names is not None:
            sheet_names_set = set(sheet_names)
            config = MappingConfig(
                project=config.project,
                master_boq=config.master_boq,
                global_settings=config.global_settings,
                sheets=[
                    sc for sc in config.sheets
                    if sc.skip or sc.treat_as == "master_preamble" or sc.sheet_name in sheet_names_set
                ],
            )

        # Collect the data-sheet names that will actually be parsed (for failure labeling)
        eligible_data_sheets = [
            sc.sheet_name for sc in config.sheets
            if not sc.skip and sc.treat_as != "master_preamble"
        ]

        # Reconcile per-sheet parse markers (#164): the enqueue-time superset
        # marking may have flagged sheets that turn out ineligible (general-specs,
        # skip, bad-blob, not-admissible, or outside a named subset). Clear all
        # then re-mark the truly-eligible set, and commit so the UI reflects the
        # resolved set DURING the parse.
        _clear_all_sheet_parse_markers(boq_name)
        _set_sheet_parse_markers(boq_name, eligible_data_sheets, 1)
        frappe.db.commit()

        # Step 4: Run parser (handles skip + master_preamble internally)
        try:
            parsed = parse_boq(tempfile_path, config)
        except Exception:
            frappe.log_error(
                title=f"BoQ parse: parse_boq failed for {boq_name}",
                message=frappe.get_traceback(),
            )
            for sn in eligible_data_sheets:
                _set_draft_status(boq_name, sn, "Parse failed")
            frappe.db.commit()
            _publish_parse_event(boq_name, "error", user=user, error_code="parse_failed")
            return

        # Step 5: Persist results per-sheet.
        # Read-site 2: query child table for general-specs sheet names to gate the
        # "mark Parsed" step -- general-specs sheets must never receive "Parsed" status.
        general_specs_sheet_names_worker: set[str] = {
            row.source_sheet_name
            for row in frappe.db.get_all(
                "BoQ General Specs Sheet",
                filters={"parent": boq_name, "parenttype": "BOQs"},
                fields=["source_sheet_name"],
            )
            if row.source_sheet_name
        }

        for parsed_sheet in parsed.sheets:
            sheet_name = parsed_sheet.sheet_name
            try:
                # Re-parse safety: delete existing rows before inserting.
                # On failure the compensating delete in the except block cleans up partials.
                frappe.db.delete("BoQ Review Row", {"boq": boq_name, "sheet_name": sheet_name})

                for row_index, resolved_row in enumerate(parsed_sheet.resolved_rows):
                    row_dict = flatten_resolved_row(resolved_row, sheet_name, row_index)
                    row_dict["boq"] = boq_name
                    for field in _LIST_JSON_FIELDS:
                        if isinstance(row_dict.get(field), list):
                            row_dict[field] = json.dumps(row_dict[field])
                    doc = frappe.new_doc("BoQ Review Row")
                    doc.update(row_dict)
                    doc.insert(ignore_permissions=True)

                # Mark Parsed -- but NOT general-specs sheets (they are not data sheets).
                # Stamp parse-history fields alongside status in the same DB write so the
                # frontend can distinguish "never parsed" from "Config Done after config change".
                if sheet_name not in general_specs_sheet_names_worker:
                    _set_draft_status(boq_name, sheet_name, "Parsed", extra_fields={
                        "has_prior_parse": 1,
                        "last_parsed_at": frappe.utils.now(),
                    })

                parsed_sheets.append(sheet_name)

            except Exception:
                frappe.log_error(
                    title=f"BoQ parse: sheet '{sheet_name}' insert failed",
                    message=frappe.get_traceback(),
                )
                try:
                    frappe.db.delete("BoQ Review Row", {"boq": boq_name, "sheet_name": sheet_name})
                except Exception:
                    frappe.log_error(
                        title=f"BoQ parse: cleanup after '{sheet_name}' failure failed",
                        message=frappe.get_traceback(),
                    )
                _set_draft_status(boq_name, sheet_name, "Parse failed")
                failed_sheets.append(sheet_name)

        # Step 6: Persist preamble text per general-specs sheet.
        # Replace semantics: delete-then-insert per sheet so re-parse updates the child row
        # rather than duplicating it. Falsy text is skipped per row (mirrors old falsy-skip).
        for gs_sheet_name, preamble_text in parsed.master_preambles.items():
            if not preamble_text:
                continue
            frappe.db.delete(
                "BoQ General Specs Sheet",
                {"parent": boq_name, "parenttype": "BOQs", "source_sheet_name": gs_sheet_name},
            )
            child = frappe.new_doc("BoQ General Specs Sheet")
            child.parent = boq_name
            child.parenttype = "BOQs"
            child.parentfield = "general_specs_sheets"
            child.source_sheet_name = gs_sheet_name
            child.preamble_text = preamble_text
            child.insert(ignore_permissions=True)
            logger.info(
                "BoQ %s: sheet %r preamble extracted (%d chars); stored",
                boq_name, gs_sheet_name, len(preamble_text),
            )

        # Step 7: Stamp parsed_at on any successful (possibly partial) completion
        if parsed_sheets:
            frappe.db.set_value("BOQs", boq_name, "parsed_at", frappe.utils.now())

        # Commit BEFORE publish (CLAUDE.md rule: commit-before-publish avoids race conditions)
        frappe.db.commit()

        # Step 8: Publish result targeted to the enqueueing user
        _publish_parse_event(
            boq_name,
            "success",
            user=user,
            parsed_sheets=parsed_sheets,
            not_parsed_sheets=not_eligible,
            failed_sheets=failed_sheets,
        )

    except Exception:
        frappe.log_error(
            title=f"BoQ parse worker: unhandled error for {boq_name}",
            message=frappe.get_traceback(),
        )
        try:
            frappe.db.rollback()
        except Exception:
            pass
        _publish_parse_event(boq_name, "error", user=user, error_code="internal")
        raise

    finally:
        if tempfile_path:
            try:
                os.unlink(tempfile_path)
            except OSError:
                pass


def _fetch_boq_file_to_tempfile(source_file_url: str) -> str:
    """
    Fetch the BoQ workbook to a NamedTemporaryFile preserving the real file extension.
    Caller must os.unlink the returned path in a finally block.

    Routing:
      - If 'frappe_s3_attachment' is not in the URL: treat as local/dev path (tests, dev env).
        /private/... and /files/... are resolved via frappe.get_site_path(); bare absolute
        paths (e.g. test fixture paths) are used as-is.  File is copied to a tempfile so the
        caller can safely unlink it without destroying the source.
      - Otherwise: download from S3 via S3Operations.read_file_from_s3.
        Real extension is derived from the 'file_name' query param (set by frappe_s3_attachment).
        Unlike sheet_preview._fetch_boq_file_to_tempfile (which hardcodes '.xlsx'), this
        version correctly handles '.xlsm' workbooks.
    """
    if "frappe_s3_attachment" not in source_file_url:
        # Local path (dev / test)
        if source_file_url.startswith("/private/") or source_file_url.startswith("/files/"):
            local_path = frappe.get_site_path(source_file_url.lstrip("/"))
        else:
            local_path = source_file_url
        _, ext = os.path.splitext(local_path)
        suffix = ext.lower() if ext.lower() in {".xlsx", ".xlsm"} else ".xlsx"
        tmp = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
        try:
            shutil.copy2(local_path, tmp.name)
        except Exception as exc:
            try:
                os.unlink(tmp.name)
            except OSError:
                pass
            frappe.throw(f"Failed to read local BoQ file: {exc}", title="File access failed")
        return tmp.name

    # S3 path
    from frappe_s3_attachment.controller import S3Operations  # noqa: PLC0415

    parsed_url = urllib.parse.urlparse(source_file_url)
    params = urllib.parse.parse_qs(parsed_url.query)

    # Derive real extension from file_name query param (frappe_s3_attachment sets this)
    ext = ".xlsx"
    file_name_list = params.get("file_name")
    if file_name_list:
        raw_name = urllib.parse.unquote(file_name_list[0])
        _, candidate_ext = os.path.splitext(raw_name)
        if candidate_ext.lower() in {".xlsx", ".xlsm"}:
            ext = candidate_ext.lower()

    # Derive S3 key: prefer 'key' query param; fall back to File.content_hash
    key_list = params.get("key")
    if key_list:
        key = key_list[0]
    else:
        key = frappe.db.get_value("File", {"file_url": source_file_url}, "content_hash")
        if not key:
            frappe.throw(
                f"Cannot derive S3 key from source_file_url: {source_file_url!r}",
                title="S3 key not found",
            )

    try:
        s3 = S3Operations()
        response = s3.read_file_from_s3(key)
        file_bytes = response["Body"].read()
    except Exception as exc:
        frappe.throw(
            f"Failed to fetch BoQ file from S3 (key={key!r}): {exc}",
            title="S3 fetch failed",
        )

    tmp = tempfile.NamedTemporaryFile(suffix=ext, delete=False)
    try:
        tmp.write(file_bytes)
    finally:
        tmp.close()
    return tmp.name


def _set_draft_status(
    boq_name: str,
    sheet_name: str,
    status: str,
    extra_fields: dict | None = None,
) -> None:
    """Set wizard_status (and optionally extra fields) on the matching BoQ Sheet Draft child row.
    Silently ignores missing rows.  extra_fields is merged in the same db write as wizard_status.
    """
    child_name = frappe.db.get_value(
        "BoQ Sheet Draft",
        {"parent": boq_name, "parenttype": "BOQs", "sheet_name": sheet_name},
        "name",
    )
    if not child_name:
        return
    if extra_fields:
        frappe.db.set_value("BoQ Sheet Draft", child_name, {"wizard_status": status, **extra_fields})
    else:
        frappe.db.set_value("BoQ Sheet Draft", child_name, "wizard_status", status)


def _publish_parse_event(
    boq_name: str,
    status: str,
    user: str | None = None,
    **kwargs: Any,
) -> None:
    """Publish boq:parse_run_done targeted to the enqueueing user (if known)."""
    # CLEAR all transient parse-lifecycle state with its own independent commit.
    # Every completion path funnels through here, so one choke-point clears uniformly.
    # Critically, the "internal" error path calls frappe.db.rollback() BEFORE calling
    # this function; that rollback is already done, so the set_value + commit below
    # starts a brand-new transaction that is NOT subject to any prior rollback.
    # The per-sheet clear is a BLANKET clear (#164) -- correct on every exit path,
    # including the top-level-exception path whose rollback discarded loop state.
    frappe.db.set_value("BOQs", boq_name, {
        "parse_in_progress": 0,
        "parse_job_id": None,
        "parse_enqueued_at": None,
    })
    _clear_all_sheet_parse_markers(boq_name)
    frappe.db.commit()
    payload = {"status": status, "boq_name": boq_name, **kwargs}
    publish_kwargs: dict[str, Any] = {}
    if user:
        publish_kwargs["user"] = user
    frappe.publish_realtime("boq:parse_run_done", payload, **publish_kwargs)
