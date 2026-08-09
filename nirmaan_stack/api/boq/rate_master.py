# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Rate-master READ endpoints (RM-1).

Two login-required, active-only read endpoints over the RM-1 doctypes:
  - get_rate_master_items(discipline, kind=None) -> active items for the discipline (+kind).
  - get_rate_category_config(discipline, category_id) -> the active per-category config.

RM-1 ships NO write endpoint -- the import runs service-side (services/boq_rate_master/loader.py)
and the editors are RM-4. (Deliberately avoids `from frappe import _` to sidestep translator
shadowing; user-facing strings are passed plain.)
"""

import json
import re

import frappe

ITEM_DOCTYPE = "BoQ Rate Master Item"
CONFIG_DOCTYPE = "BoQ Rate Category Config"


def _require_login():
    """Reject unauthenticated (Guest) callers. The HTTP layer already blocks Guest for a
    non-allow_guest whitelist method; this makes the guard explicit + unit-testable."""
    if frappe.session.user in (None, "", "Guest"):
        frappe.throw("Login required.", frappe.PermissionError)


def _parse_json(value, default):
    if value in (None, ""):
        return default
    if isinstance(value, (dict, list)):
        return value
    return json.loads(value)


@frappe.whitelist()
def get_rate_master_items(discipline=None, kind=None):
    """Active rate-master items for a discipline, optionally narrowed to a kind. Attributes +
    rates are returned as parsed objects."""
    _require_login()
    if not discipline:
        frappe.throw("discipline is required.")

    filters = {"discipline": discipline, "active": 1}
    if kind:
        filters["kind"] = kind

    rows = frappe.get_all(
        ITEM_DOCTYPE,
        filters=filters,
        fields=[
            "name",
            "discipline",
            "kind",
            "brand",
            "unit",
            "attributes",
            "rates",
            "source_sheet",
            "source_row",
            "import_batch",
        ],
        order_by="kind asc, source_row asc",
    )
    for r in rows:
        r["attributes"] = _parse_json(r.get("attributes"), {})
        r["rates"] = _parse_json(r.get("rates"), {})

    return {
        "discipline": discipline,
        "kind": kind,
        "count": len(rows),
        "items": rows,
    }


@frappe.whitelist()
def get_rate_category_config(discipline=None, category_id=None):
    """The active per-category config for (discipline, category_id). config is parsed. Returns
    config=None when no active config exists."""
    _require_login()
    if not discipline or not category_id:
        frappe.throw("discipline and category_id are required.")

    rows = frappe.get_all(
        CONFIG_DOCTYPE,
        filters={"discipline": discipline, "category_id": category_id, "active": 1},
        fields=["name", "discipline", "category_id", "config", "source_workbook", "import_batch"],
        order_by="modified desc",
        limit=1,
    )
    if not rows:
        return {"discipline": discipline, "category_id": category_id, "config": None}

    row = rows[0]
    row["config"] = _parse_json(row.get("config"), None)
    return row


# ══════════════════════════════════════════════════════════════════════════════════════
# RM-3: the suggest-run skeleton (CLONED from api/boq/wizard/classify.py) + run read +
# telemetry write. The extraction itself lives in services/boq_rate_master/extraction.py;
# this file is the thin orchestration (enqueue -> worker -> Redis marker/terminal -> realtime),
# the active-run read, and the fire-and-forget Use-telemetry insert.
# ══════════════════════════════════════════════════════════════════════════════════════

from frappe.utils.background_jobs import get_job_status  # noqa: E402

from nirmaan_stack.services.boq_rate_master import extraction  # noqa: E402
from nirmaan_stack.services.boq_rate_master import loader  # noqa: E402  (RM-4a: reuse _canonicalize_attributes)
from nirmaan_stack.api.boq.wizard import pricing  # noqa: E402  (D8 gate reuse; import UP api->api)

RUN_DOCTYPE = "BoQ Rate Suggestion Run"
EVENT_DOCTYPE = "BoQ Rate Suggestion Event"
_BOQ_SHEET = "BoQ Sheet"

_S_STATUS_PREFIX = "boq_suggest_status"
_S_MARKER_PREFIX = "boq_suggest_marker"
_S_STATUS_TTL_SEC = 3600
_S_MARKER_TTL_SEC = 3600
_STALE_SUGGEST_SECONDS = 1200  # mirrors classify._STALE_CLASSIFY_SECONDS


# ── Redis key + marker helpers (per (boq, sheet_name)) ──────────────────────────────
def _s_status_key(boq, sheet_name):
    return f"{_S_STATUS_PREFIX}::{boq}::{sheet_name}"


def _s_marker_key(boq, sheet_name):
    return f"{_S_MARKER_PREFIX}::{boq}::{sheet_name}"


def _s_set_marker(boq, sheet_name, job_id, user):
    frappe.cache().set_value(
        _s_marker_key(boq, sheet_name),
        {"job_id": job_id, "enqueued_at": frappe.utils.now(), "user": user},
        expires_in_sec=_S_MARKER_TTL_SEC,
    )


def _s_get_marker(boq, sheet_name):
    return frappe.cache().get_value(_s_marker_key(boq, sheet_name))


def _s_clear_marker(boq, sheet_name):
    frappe.cache().delete_value(_s_marker_key(boq, sheet_name))


def _s_update_marker_progress(boq, sheet_name, done, total):
    marker = _s_get_marker(boq, sheet_name)
    if not marker:
        return
    marker["done"] = done
    marker["total"] = total
    frappe.cache().set_value(_s_marker_key(boq, sheet_name), marker, expires_in_sec=_S_MARKER_TTL_SEC)


def _s_maybe_self_heal(boq, sheet_name, marker):
    """'running' | 'cleared' | 'cleared_stale' -- mirrors classify._maybe_self_heal."""
    job_id = marker.get("job_id")
    status = None
    if job_id:
        try:
            status = get_job_status(job_id)
        except Exception:
            status = None
    if status in ("finished", "failed") or status is None:
        _s_clear_marker(boq, sheet_name)
        return "cleared"
    enqueued_at = marker.get("enqueued_at")
    if enqueued_at:
        try:
            age = frappe.utils.time_diff_in_seconds(frappe.utils.now(), enqueued_at)
        except Exception:
            age = 0
        if age > _STALE_SUGGEST_SECONDS:
            _s_clear_marker(boq, sheet_name)
            return "cleared_stale"
    return "running"


def _resolve_committed_version(boq, sheet_name):
    """Current committed sheet's commit_version, or None when not committed. sheet_name VERBATIM #152."""
    rows = frappe.get_all(
        _BOQ_SHEET,
        filters={"boq": boq, "sheet_name": sheet_name, "is_current": 1},
        fields=["commit_version"],
    )
    return rows[0]["commit_version"] if rows else None


def _guard_suggest_gate(boq, sheet_name, committed_version):
    """The D8 chain, re-checked SERVER-SIDE at the endpoint (the client mirror is UX only):
    committed + not locked + formulas complete + category gate open. Throws on any failure so a
    direct API call cannot bypass the same gate rate writes obey."""
    if pricing._get_sheet_is_locked(boq, sheet_name, committed_version):
        frappe.throw("Sheet is locked / read-only.", title="Locked")
    if not pricing._sheet_formulas_complete(boq, sheet_name, committed_version):
        frappe.throw("Declare amount formulas first.", title="Formulas incomplete")
    if not pricing._categories_gate_ok(boq, sheet_name, committed_version):
        frappe.throw("Every eligible row needs a category first.", title="Category gate")


# ══════════════════════════════════════════════════════════════════════════════════════
# SELECTED-ROW RUNS (only_rows) -- scope the PROCESSING, never the population.
#
# ⚠️ THE INVERSION, recorded so it is never re-derived the short way. The natural
# implementation -- narrowing assemble_population to the ticked rows -- is the DESTRUCTIVE
# one: population_rows then equals the ticked set, `complete` evaluates True, `active` flips
# to 1, the prior run is deactivated, and the new active run contains ONLY those rows. Every
# unselected row silently loses its extraction, its badge and its "Use this value". The other
# naive shape (filter the processed rows but leave the population whole) ends status=partial /
# active=0, is never adopted by the editor, and offers a "Resume" that would re-extract the
# whole sheet -- exactly what this feature exists to prevent.
#
# The correct shape, and the only one implemented here:
#   * assemble_population is UNTOUCHED -- population_rows is ALWAYS the whole sheet, so it
#     stays the completeness yardstick (extraction.run_extraction:1041 relies on this).
#   * run_extraction gains an `only_rows` PROCESSING filter (positive polarity).
#   * the run doc is a NEW document SEEDED with the prior active run's untouched rows, carried
#     across byte-identically, so `complete` is reached honestly and the supersede is safe.
# ══════════════════════════════════════════════════════════════════════════════════════


def normalize_only_rows(raw):
    """`only_rows` -> a sorted list of unique ints, or None when ABSENT/EMPTY.

    POSITIVE POLARITY, deliberately: a tick box says "DO THESE". `skip_rows` (the SR-1 resume
    lever) says "don't do these" and is derived server-side from a done-marker; inverting a tick
    set on the client would force the client to reproduce the server's population definition,
    which is precisely the fifth-definition drift this slice avoids.

    An ABSENT or EMPTY value returns None, which every downstream branch reads as "whole sheet",
    so the unscoped path stays byte-identical to pre-slice behaviour. Accepts a JSON string (the
    shape frappe-react-sdk posts), a list, or a single scalar. A non-integer member is a hard
    error -- silently dropping one would run fewer rows than the confirmation named. Pure.
    """
    if raw is None or raw == "":
        return None
    # Only a STRING is JSON. _parse_json would hand a bare int straight to json.loads and raise a
    # TypeError instead of the named "not a row number" error this function promises.
    value = _parse_json(raw, None) if isinstance(raw, str) else raw
    if value is None or value == "" or (isinstance(value, (list, tuple, set)) and not value):
        return None
    if not isinstance(value, (list, tuple, set)):
        value = [value]
    out = set()
    for item in value:
        try:
            out.add(int(item))
        except (TypeError, ValueError):
            frappe.throw(
                f"Selected row '{item}' is not a row number.", title="Bad selection"
            )
    return sorted(out) or None


def _population_rows(boq, sheet_name):
    """The excel_row set the suggest run ACCEPTS -- assemble_population's own output, read (never
    re-derived). This is the ONE server definition the tick boxes follow; the editor's badge set
    (rate-editable) is deliberately WIDER and must never be used for selection."""
    _cv, rows = extraction.assemble_population(boq, sheet_name)
    return {int(r["excel_row"]) for r in rows}


def _carry_source_run(boq, sheet_name, committed_version):
    """The run a SCOPED pass carries its untouched rows forward from: the sheet's single active
    run, pinned to the CURRENT committed version and genuinely COMPLETE. Returns the row dict or
    None.

    Version-pinned for the same reason the resume is: a run made against an earlier committed
    version describes rows that may since have changed, so carrying it forward would launder stale
    values into a document that claims to describe the current sheet."""
    rows = frappe.get_all(
        RUN_DOCTYPE,
        filters={"boq": boq, "sheet_name": sheet_name, "active": 1},
        fields=["name", "run_id", "status", "committed_version", "results", "attempted_rows"],
        order_by="creation desc",
        limit=1,
    )
    if not rows:
        return None
    run = rows[0]
    if run.get("committed_version") != committed_version:
        return None
    if (run.get("status") or "complete") != "complete":
        return None
    return run


def _guard_only_rows(boq, sheet_name, cv, only, resume_run_id):
    """Everything a SELECTED-ROW run must satisfy before a single token is spent. Throws with a
    named, actionable message on each failure; returns nothing.

    REJECT, not ignore (owner choice, recorded): a row the client sends that is not in the real
    population means the client's eligible set is STALE -- someone re-classified, or the category
    gate moved -- and the confirmation the user just accepted named a count that is no longer
    true. Running the survivors would honour a number nobody agreed to. Refusing is loud,
    cheap and recoverable (reload, re-tick); silently dropping is the failure mode this whole
    slice exists to remove."""
    if resume_run_id:
        frappe.throw(
            "A resume continues a halted run's own pending rows, so it cannot also take a row "
            "selection. Resume the partial run, or start a fresh selected-row run.",
            title="Resume and selection are exclusive",
        )

    # AI must be ON. A scoped pass with AI off returns BLANK attributes for every selected row
    # (extraction fails closed) AND would stamp ai_status="disabled" onto a document whose carried
    # rows were extracted with AI on -- mislabelling the whole document. Refuse before that.
    from nirmaan_stack.api.boq.wizard.ai_settings import (
        get_boq_ai_api_key,
        get_boq_ai_settings,
    )

    if not get_boq_ai_settings().get("enabled") or not get_boq_ai_api_key():
        frappe.throw(
            "AI extraction is off, so a selected-row run would blank the rows you picked. "
            "Turn AI on in Settings first.",
            title="AI is off",
        )

    if not _carry_source_run(boq, sheet_name, cv):
        frappe.throw(
            "There is no completed suggestion run for this sheet to carry the untouched rows "
            "forward from. Run the whole sheet once first, then re-run individual rows.",
            title="Nothing to carry forward",
        )

    population = _population_rows(boq, sheet_name)
    unknown = sorted(set(only) - population)
    if unknown:
        shown = ", ".join(str(x) for x in unknown[:10])
        more = f" (and {len(unknown) - 10} more)" if len(unknown) > 10 else ""
        frappe.throw(
            f"These rows are not part of this sheet's suggestion population: {shown}{more}. "
            "The sheet may have been re-classified since you picked them -- reload and try again.",
            title="Rows not eligible",
        )


# ── Run skeleton ────────────────────────────────────────────────────────────────────
@frappe.whitelist(methods=["POST"])
def start_suggest(boq=None, sheet_name=None, resume_run_id=None, only_rows=None):
    """Enqueue a background rate-suggestion (attribute extraction) run for one committed sheet.
    Returns immediately. Re-checks the D8 gate server-side. URL:
    /api/method/nirmaan_stack.api.boq.rate_master.start_suggest

    SR-1 resume: pass `resume_run_id` to CONTINUE an existing partial run instead of starting a new
    one. The resume fills only the rows that run has not attempted and completes the SAME run doc
    (same run_id) -- it never spawns a second run. The D8 gate and the committed-version keying are
    re-checked here exactly as for a fresh run, so a partial whose sheet has since been re-committed
    is refused rather than resumed against rows that may have changed.

    SELECTED-ROW runs: pass `only_rows` (a list of excel row numbers, or its JSON string) to
    re-extract JUST those rows. Every other row is carried forward BYTE-IDENTICALLY from the
    sheet's current active run into a NEW document -- see _open_run_doc. ABSENT or EMPTY
    `only_rows` behaves exactly as before this slice: a whole-sheet run, no carry-forward, no
    extra query. `only_rows` is validated against assemble_population here and REJECTED (never
    silently narrowed) if it names a row the run does not accept.
    """
    _require_login()
    if not boq:
        frappe.throw("boq is required.", title="Missing field: boq")
    if not frappe.db.exists("BOQs", boq):
        frappe.throw(f"BOQs '{boq}' not found.", title="Not found")
    if not sheet_name:
        frappe.throw("sheet_name is required.", title="Missing field: sheet_name")

    cv = _resolve_committed_version(boq, sheet_name)
    if cv is None:
        frappe.throw(f"No current committed sheet '{sheet_name}' for this BoQ.", title="Sheet not committed")
    _guard_suggest_gate(boq, sheet_name, cv)

    # Normalise FIRST: an empty selection is indistinguishable from none, and both mean
    # "whole sheet" -- so the guards below never run on the unscoped path (G6).
    only = normalize_only_rows(only_rows)
    if only is not None:
        _guard_only_rows(boq, sheet_name, cv, only, resume_run_id)

    if resume_run_id:
        _validate_resume_target(boq, sheet_name, cv, resume_run_id)

    marker = _s_get_marker(boq, sheet_name)
    if marker and _s_maybe_self_heal(boq, sheet_name, marker) == "running":
        frappe.throw(
            "A suggestion run is already in progress for this sheet. Wait for it to finish.",
            title="Suggest in progress",
        )

    raw_job_id = frappe.generate_hash(length=32)
    user = frappe.session.user
    frappe.enqueue(
        "nirmaan_stack.api.boq.rate_master._suggest_worker",
        queue="long",
        timeout=600,
        job_id=raw_job_id,
        user=user,
        boq=boq,
        sheet_name=sheet_name,
        resume_run_id=resume_run_id,
        only_rows=only,
    )
    frappe.cache().delete_value(_s_status_key(boq, sheet_name))
    _s_set_marker(boq, sheet_name, raw_job_id, user)
    frappe.db.commit()
    return {
        "status": "queued",
        "job_id": raw_job_id,
        "resumed_run_id": resume_run_id or None,
        # Echo the ACCEPTED selection so the caller can prove the server agreed with its ticks.
        "only_rows": only,
        "scoped_row_count": len(only) if only is not None else None,
    }


def _validate_resume_target(boq, sheet_name, cv, resume_run_id):
    """A resume target must exist, belong to THIS sheet, still be partial, and be pinned to the
    sheet's CURRENT committed version. Anything else throws -- a resume must never write into a
    completed run, another sheet's run, or a version whose rows may have changed underneath it."""
    rows = frappe.get_all(
        RUN_DOCTYPE,
        filters={"boq": boq, "sheet_name": sheet_name, "run_id": resume_run_id},
        fields=["name", "status", "committed_version"],
        limit=1,
    )
    if not rows:
        frappe.throw(
            f"No suggestion run '{resume_run_id}' found for this sheet.", title="Run not found"
        )
    run = rows[0]
    if (run.get("status") or "") != "partial":
        frappe.throw(
            f"That suggestion run is '{run.get('status') or 'unknown'}', not a partial run, so there is nothing to resume.",
            title="Not resumable",
        )
    if run.get("committed_version") != cv:
        frappe.throw(
            "That partial run was made against an earlier committed version of this sheet. "
            "Start a fresh suggestion run instead.",
            title="Version moved on",
        )


# ── SR-1 run-doc lifecycle (the run doc IS the partial store) ───────────────────────
# Writes here use frappe.db.set_value(update_modified=False) rather than doc.save. That is safe
# and intentional for THIS doctype: BoQ Rate Suggestion Run is track_changes:0, so there is no
# Version audit to bypass (unlike the rate-master editing endpoints, where set_value is FORBIDDEN
# precisely because it would skip the audit). set_value also keeps a per-batch checkpoint cheap.
def _open_run_doc(boq, sheet_name, cv, job_id, user, resume_run_id, only_rows=None):
    """Resolve the run doc a pass will write into: either the partial being RESUMED (same doc, same
    run_id -- never a second doc) or a freshly created one at status=running / active=0.

    Returns (run_name, run_id, prior_results, prior_attempted).

    ⚠️ CARRY-FORWARD (owner-ruled): a SELECTED-ROW pass (`only_rows`) seeds the NEW document with
    the sheet's current active run's rows, so the rows it does not touch survive into the document
    that supersedes it. NOTHING IS EDITED IN PLACE. The owner's reasoning, recorded so it is not
    re-litigated: a merged run's `run_at` and `ai_status` stop describing the rows and start
    describing the last touch, and the previous values are destroyed -- while this arc has
    repeatedly depended on comparing a row's before against its after. The rest of the module
    already works this way (committed sheets, category assignments, config revisions all supersede
    rather than mutate).

    ⚠️ BYTE-IDENTITY, not "still present". The carried rows are handed on as the EXACT objects
    parsed out of the prior document and are never re-derived -- `_corroborate` / `_row_result`
    run only for rows the pass actually extracts. Because the `results` column is postgres `json`
    (NOT `jsonb`, so submitted text is stored verbatim), every writer uses `json.dumps` with
    default separators, Python preserves parsed key order, and every write re-emits the array
    `sorted(...)` by excel_row, an untouched row's serialised text -- values, `confidence`,
    `corroborated` and critically `defaulted` -- comes out character-for-character identical.

    ⚠️ Carry-forward is scoped to `only_rows` DELIBERATELY. A whole-sheet run has no untouched
    rows to carry, and seeding one would change today's partial semantics (a halted whole-sheet
    run would silently inherit the old run's rows instead of reporting them pending). Absent
    `only_rows` this function is byte-identical to pre-slice behaviour."""
    if resume_run_id:
        rows = frappe.get_all(
            RUN_DOCTYPE,
            filters={"boq": boq, "sheet_name": sheet_name, "run_id": resume_run_id},
            fields=["name", "results", "attempted_rows"],
            limit=1,
        )
        if rows:
            run = rows[0]
            frappe.db.set_value(
                RUN_DOCTYPE, run["name"],
                {"status": "running", "halt_reason": None},
                update_modified=False,
            )
            frappe.db.commit()
            return (
                run["name"], resume_run_id,
                _parse_json(run.get("results"), []),
                _parse_json(run.get("attempted_rows"), []),
            )
        # The target vanished between the endpoint's validation and here -- fall through and start
        # a fresh run rather than losing the request entirely.

    # CARRY-FORWARD seed (selected-row runs only). Seeded AT INSERT so the document is never a
    # lie about what it holds: if this pass dies before its first checkpoint, the doc already
    # carries the rows it inherited (and stays active=0, so the prior run keeps serving the editor).
    carried_results, carried_attempted = [], []
    if only_rows:
        source = _carry_source_run(boq, sheet_name, cv)
        if source:
            carried_results = _parse_json(source.get("results"), [])
            carried_attempted = _parse_json(source.get("attempted_rows"), [])

    run_id = resume_run_id or job_id or frappe.generate_hash(length=32)
    doc = frappe.new_doc(RUN_DOCTYPE)
    doc.boq = boq
    doc.sheet_name = sheet_name  # VERBATIM (#152)
    doc.committed_version = cv
    doc.run_id = run_id
    doc.status = "running"
    doc.ai_status = ""
    doc.results = serialize_run_results(carried_results) if carried_results else "[]"
    doc.attempted_rows = json.dumps(sorted(int(x) for x in carried_attempted)) if carried_attempted else "[]"
    doc.run_by = user
    doc.active = 0  # never supersede a prior COMPLETE run until this one completes
    doc.insert(ignore_permissions=True)
    frappe.db.commit()
    return doc.name, run_id, carried_results, carried_attempted


def serialize_run_results(rows):
    """THE single serialisation of a run's `results` array. Every writer goes through it.

    ⚠️ THIS FUNCTION IS THE BYTE-IDENTITY GUARANTEE, so its three properties are load-bearing and
    none may be "tidied":
      1. `json.dumps` with DEFAULT separators -- adding indent= or sort_keys= would re-emit every
         untouched row with the same VALUES but different TEXT, passing a "still present" check
         and failing byte-identity silently.
      2. sorted by excel_row -- so a carried row lands in the same position it occupied before, and
         a merge can never reorder the array.
      3. the row dicts are passed through UNTOUCHED -- never rebuilt, never re-derived. Python
         preserves the key order json.loads produced, so a parsed-then-redumped row emits its keys
         in the original order, floats round-trip through shortest-repr exactly, and the optional
         `defaulted` flag rides along inside the attribute cell it belongs to.
    The `results` column is postgres `json` (NOT `jsonb`), so the submitted text is stored verbatim
    and these three properties survive the round trip to disk. Pure -- unit-tested."""
    return json.dumps(sorted(rows, key=lambda r: int(r["excel_row"])))


def _write_run_progress(run_name, acc_results, acc_attempted):
    """One checkpoint: the rows so far + the done-marker, committed immediately."""
    frappe.db.set_value(
        RUN_DOCTYPE, run_name,
        {
            "results": serialize_run_results(acc_results.values()),
            "attempted_rows": json.dumps(sorted(acc_attempted)),
        },
        update_modified=False,
    )
    frappe.db.commit()


def _finalise_run(run_name, cv, ai_status, merged, acc_attempted, complete, halt_reason,
                  boq, sheet_name):
    """Terminal state for a pass. COMPLETE flips active=1 and supersedes the prior active run --
    that is the ONLY moment a run becomes the live one. A PARTIAL stays active=0, so the previously
    completed run remains what the editor reads.

    WHAT THE RUN-LEVEL FIELDS MEAN ON A SELECTED-ROW (partial-scope) RUN -- stated because a
    carry-forward document holds rows from more than one pass, and a field that quietly changed
    subject would be the silent regression this slice exists to prevent:

      * `run_at`   -- when THIS DOCUMENT's pass finished. It describes the document, NOT every row
                      in it: carried rows were extracted earlier, by the document this one
                      superseded. That prior document is retained (active=0) with its own run_at
                      intact, so the older timestamp is never destroyed -- which is exactly why the
                      owner ruled for a new document over an in-place merge.
      * `ai_status`-- the status of THIS pass's AI calls. It is honest for the rows this pass
                      extracted and says nothing about carried rows. A scoped run can only reach
                      here with AI ON (_guard_only_rows refuses otherwise), so it cannot stamp
                      "disabled" over a document whose carried rows were extracted with AI on.
      * `attempted_rows` -- the rows this DOCUMENT has results for (carried + newly extracted),
                      never "the rows this pass touched". That is the meaning both consumers
                      already require: the completeness test below, and the resume's skip set."""
    values = {
        "committed_version": cv,
        "ai_status": ai_status,
        "results": serialize_run_results(merged),
        "attempted_rows": json.dumps(sorted(acc_attempted)),
        "status": "complete" if complete else "partial",
        "halt_reason": None if complete else halt_reason,
    }
    if complete:
        values["active"] = 1
        values["run_at"] = frappe.utils.now()
        for prior in frappe.get_all(
            RUN_DOCTYPE,
            filters={"boq": boq, "sheet_name": sheet_name, "active": 1},
            pluck="name",
        ):
            if prior != run_name:
                frappe.db.set_value(RUN_DOCTYPE, prior, "active", 0, update_modified=False)
    frappe.db.set_value(RUN_DOCTYPE, run_name, values, update_modified=False)


def pass_attempted_count(env):
    """How many rows THIS PASS attempted -- read from the envelope, never from the run document.

    ⚠️ THE DISTINCTION THIS EXISTS FOR. The payload's `attempted_count` is DOCUMENT-level
    (`len(acc_attempted)`): on a SCOPED run it is seeded with the carried run's rows, so it counts
    every row the document has results for. That is the right number for the completeness test and
    for the resume's skip set, and the WRONG number for "how much did this pass actually do" --
    on a halted scoped run `population - attempted` is 0, which reads as "nothing missed" when
    rows were in fact left unfinished.

    `env["attempted_rows"]` is this pass's own set (run_extraction builds it from the batches that
    returned), which is what makes the halted-scoped three-way split derivable:
        re-extracted    = this count
        carried forward = document rows - this count
        not reached     = the scope - this count

    "Attempted" is deliberate, and matches what `attempted_count` already means on the whole-sheet
    halt path: a row whose batch RETURNED counts even if the model answered null for it -- we asked.
    Only a row whose batch never completed stays pending.

    NOTE the fail-closed paths (AI disabled / no key) report every row as attempted, because they
    return a blank row for each. That is unchanged behaviour and cannot reach a SCOPED run at all --
    `_guard_only_rows` refuses one while AI is off. Pure -- unit-tested."""
    return len(env.get("attempted_rows") or [])


def _mark_run_failed(run_name, halt_reason):
    """An unexpected failure. The run KEEPS its checkpointed rows (active stays 0)."""
    frappe.db.set_value(
        RUN_DOCTYPE, run_name,
        {"status": "failed", "halt_reason": halt_reason},
        update_modified=False,
    )


def _suggest_worker(boq=None, sheet_name=None, user=None, resume_run_id=None, only_rows=None):
    """Background worker: run extraction, WRITE the Suggestion Run doc (prior active -> active=0) at
    terminal SUCCESS, commit BEFORE publish, record + publish the terminal payload. On failure,
    records a terminal error payload and clears the marker (never left stuck)."""
    job_id = None
    marker = _s_get_marker(boq, sheet_name)
    if marker:
        job_id = marker.get("job_id")

    def _progress(done, total):
        _s_update_marker_progress(boq, sheet_name, done, total)
        frappe.publish_realtime(
            "boq:suggest_sheet_progress",
            {"boq": boq, "sheet_name": sheet_name, "done": done, "total": total},
            **({"user": user} if user else {}),
        )

    run_name = None
    run_id = None
    try:
        cv = _resolve_committed_version(boq, sheet_name)
        # SR-1: the RUN DOC IS THE PARTIAL STORE. Resolve (resume) or create it UP FRONT at
        # status=running / active=0, so every checkpoint has somewhere durable to land. active=0
        # is load-bearing: a running or partial run must NEVER supersede a prior COMPLETE run --
        # get_active_suggestion_run keeps returning the good one until this one truly completes.
        run_name, run_id, prior_results, prior_attempted = _open_run_doc(
            boq, sheet_name, cv, job_id, user, resume_run_id, only_rows=only_rows
        )

        acc_results = {int(r["excel_row"]): r for r in prior_results}
        acc_attempted = set(prior_attempted)

        # SELECTED-ROW scoping. `scope` is the positive set this pass must process.
        #
        # ⚠️ The skip set must EXCLUDE the scope, or nothing runs. On a scoped pass acc_attempted
        # is seeded with the CARRIED run's attempted rows -- which already contains the selected
        # rows, because the carry source is a COMPLETE run. Passing it straight through as
        # skip_rows (the pre-slice behaviour) would skip precisely the rows the user ticked.
        # Subtracting the scope is what makes "re-run these" mean re-run rather than no-op.
        #
        # A RESUME of a halted scoped run passes no scope and needs no special case: its
        # acc_attempted holds the carried rows plus whatever the halted pass finished, so
        # population - attempted resolves to exactly the selected rows still pending.
        scope = {int(x) for x in only_rows} if only_rows else None
        pending_skip = (acc_attempted - scope) if scope is not None else acc_attempted

        def _checkpoint(row_results, attempted_now):
            """Persist one completed batch. This is the whole point of SR-1: the work survives a
            later halt, a crash, or the RQ job timeout."""
            for row in row_results:
                acc_results[int(row["excel_row"])] = row
            acc_attempted.update(int(x) for x in attempted_now)
            _write_run_progress(run_name, acc_results, acc_attempted)

        env = extraction.run_extraction(
            boq, sheet_name,
            progress_cb=_progress,
            checkpoint_cb=_checkpoint,
            skip_rows=sorted(pending_skip),
            only_rows=sorted(scope) if scope is not None else None,
        )
        cv = env["committed_version"]
        ai_status = env["ai_status"]

        # Fold in whatever the envelope reports (covers the fail-closed paths, which do not
        # checkpoint because they never enter the batch loop).
        for row in env["results"]:
            acc_results[int(row["excel_row"])] = row
        acc_attempted.update(int(x) for x in env.get("attempted_rows") or [])

        # `complete` DEFAULTS TO TRUE for an envelope that predates SR-1's additive keys, so any
        # caller (or test double) still producing the old shape keeps the old terminal-success
        # behaviour rather than being silently downgraded to a partial. run_extraction itself
        # always sets it explicitly.
        population = {int(x) for x in env.get("population_rows") or []}
        complete = bool(env.get("complete", True)) and not (population - acc_attempted)
        merged = [acc_results[k] for k in sorted(acc_results)]

        _finalise_run(
            run_name, cv, ai_status, merged, acc_attempted,
            complete=complete, halt_reason=env.get("halt_reason"), boq=boq, sheet_name=sheet_name,
        )
        if not complete:
            # A graceful halt must still leave an OPERATOR trail. The pricer sees halt_reason; this
            # records the provider's own error text, which would otherwise be lost precisely because
            # the halt is handled instead of raised.
            frappe.log_error(
                title="BoQ suggest run halted (partial saved)",
                message=(
                    f"boq={boq} sheet={sheet_name} run_id={run_id}\n"
                    f"terminal={env.get('halt_terminal')}\n"
                    f"reason={env.get('halt_reason')}\n"
                    f"detail={env.get('halt_detail')}\n"
                    f"attempted={len(acc_attempted)} of population={len(population)}"
                ),
            )

        frappe.db.commit()  # commit BEFORE publish (CLAUDE.md rule)
        payload = {
            "status": "success" if complete else "partial",
            "boq": boq,
            "sheet_name": sheet_name,
            "committed_version": cv,
            "run_id": run_id,
            "ai_status": ai_status,
            "run_status": "complete" if complete else "partial",
            "results": merged,
            "attempted_count": len(acc_attempted),
            "population_count": len(population) or len(acc_attempted),
            "halt_reason": env.get("halt_reason"),
            # How many rows THIS pass was scoped to (None on a whole-sheet run), so the editor can
            # report "4 rows re-extracted" rather than implying the whole sheet was re-rolled.
            "scoped_row_count": len(scope) if scope is not None else None,
            # How many rows THIS pass attempted. ADDITIVE and PURELY INFORMATIONAL -- nothing on the
            # server reads it; it exists so a HALTED SCOPED run can report all three counts instead
            # of degrading to "the split is unknown". See pass_attempted_count for why the
            # document-level `attempted_count` cannot answer that question.
            "pass_attempted_count": pass_attempted_count(env),
        }
    except Exception:
        # NOTE: deliberately NO frappe.db.rollback() here. Every checkpoint was committed as it was
        # taken, and rolling back would throw away exactly the work SR-1 exists to preserve. The run
        # is marked failed but keeps its rows, so it stays resumable.
        frappe.log_error(title="BoQ suggest worker failed", message=frappe.get_traceback())
        halt_reason = "The suggestion run stopped unexpectedly. Anything already extracted was kept."
        if run_name:
            _mark_run_failed(run_name, halt_reason)
            frappe.db.commit()
        payload = {
            "status": "error",
            "boq": boq,
            "sheet_name": sheet_name,
            "error_code": "suggest_failed",
            "run_id": run_id,
            "run_status": "failed",
            "halt_reason": halt_reason,
        }
    frappe.cache().set_value(_s_status_key(boq, sheet_name), payload, expires_in_sec=_S_STATUS_TTL_SEC)
    _s_clear_marker(boq, sheet_name)
    frappe.publish_realtime(
        "boq:suggest_sheet_done", payload, **({"user": user} if user else {})
    )


@frappe.whitelist()
def get_suggest_status(boq=None, sheet_name=None):
    """Polling fallback for a suggest run, keyed by (boq, sheet_name). Same payload shape as the
    boq:suggest_sheet_done socket event. States: done | running(+done/total) | idle."""
    _require_login()
    if not boq:
        frappe.throw("boq is required.", title="Missing field: boq")
    if not sheet_name:
        frappe.throw("sheet_name is required.", title="Missing field: sheet_name")

    term = frappe.cache().get_value(_s_status_key(boq, sheet_name))
    if term:
        return {"state": "done", **term}
    marker = _s_get_marker(boq, sheet_name)
    if marker and _s_maybe_self_heal(boq, sheet_name, marker) == "running":
        out = {"state": "running"}
        if isinstance(marker.get("done"), int) and isinstance(marker.get("total"), int):
            out["done"] = marker["done"]
            out["total"] = marker["total"]
        return out
    return {"state": "idle"}


@frappe.whitelist()
def get_active_suggestion_run(boq=None, sheet_name=None):
    """The active BoQ Rate Suggestion Run for (boq, sheet_name), or run=None. Read-only, login
    required. Returns {run: {run_id, committed_version, ai_status, results, run_at} | None}. Version
    keying (does committed_version match the CURRENT sheet) is the CALLER's decision (the frontend
    compares against get_priced_rows' committed version); this returns the active run as-is."""
    _require_login()
    if not boq:
        frappe.throw("boq is required.", title="Missing field: boq")
    if not sheet_name:
        frappe.throw("sheet_name is required.", title="Missing field: sheet_name")

    rows = frappe.get_all(
        RUN_DOCTYPE,
        filters={"boq": boq, "sheet_name": sheet_name, "active": 1},
        fields=["run_id", "committed_version", "ai_status", "results", "run_at", "status"],
        order_by="creation desc",
        limit=1,
    )
    out = {"run": None, "partial_run": None}
    if rows:
        r = rows[0]
        r["results"] = _parse_json(r.get("results"), [])
        # Pre-SR-1 rows migrate to "complete"; treat any blank as complete so an old run can never
        # retroactively lock "Use this value".
        r["status"] = (r.get("status") or "complete")
        out["run"] = r

    # SR-1: the newest RESUMABLE partial, surfaced ALONGSIDE (never instead of) the active run --
    # a partial is active=0 by design, so without this the editor could not offer a resume.
    partials = frappe.get_all(
        RUN_DOCTYPE,
        filters={"boq": boq, "sheet_name": sheet_name, "status": "partial"},
        fields=["run_id", "committed_version", "status", "attempted_rows", "halt_reason", "results"],
        order_by="creation desc",
        limit=1,
    )
    if partials:
        p = partials[0]
        p["attempted_count"] = len(_parse_json(p.get("attempted_rows"), []))
        p["results"] = _parse_json(p.get("results"), [])
        p.pop("attempted_rows", None)
        out["partial_run"] = p

    # SELECTED-ROW runs: the excel rows this sheet's suggest run ACCEPTS, so the editor can offer a
    # tick box on exactly those and nowhere else.
    #
    # ⚠️ IT COMES FROM THE SERVER BECAUSE FOUR DEFINITIONS OF "ELIGIBLE" EXIST and they disagree by
    # real numbers: the priceable master set (node_type in {Line Item, Preamble}), priceability's
    # priceable LINE (qty in a rate-column area), the rate-editable set the badges render on (Line
    # Item always + qty-bearing Preamble), and THIS one -- rate-editable AND a non-blank resolved
    # category AND that category having an eligible rate config. On the reference sheet those are
    # 164 / 139 / 94. A client-side copy would be a fifth definition, free to drift from the run's
    # actual acceptance the first time eligibility changes -- and the drift would present as ticks
    # the run silently ignores. Additive key; a client that ignores it is unaffected.
    out["eligible_rows"] = sorted(_population_rows(boq, sheet_name))
    return out


@frappe.whitelist(methods=["POST"])
def record_rate_suggestion_event(
    boq=None, sheet_name=None, excel_row=None, col=None, kind=None, helper_id=None,
    category_id=None, run_id=None, extracted_attributes=None, extracted_confidences=None,
    corrected_attributes=None, computed_value=None, used_value=None,
):
    """Insert one immutable BoQ Rate Suggestion Event (the Use telemetry). Login required, fields
    validated. Fire-and-forget: the frontend logs a failure and NEVER blocks the save. Returns
    {ok, name}."""
    _require_login()
    if not boq:
        frappe.throw("boq is required.", title="Missing field: boq")
    if not sheet_name:
        frappe.throw("sheet_name is required.", title="Missing field: sheet_name")
    if excel_row is None or excel_row == "":
        frappe.throw("excel_row is required.", title="Missing field: excel_row")

    def _as_text(v):
        if v is None:
            return None
        return v if isinstance(v, str) else json.dumps(v)

    doc = frappe.new_doc(EVENT_DOCTYPE)
    doc.boq = boq
    doc.sheet_name = sheet_name  # VERBATIM (#152)
    doc.excel_row = int(excel_row)
    doc.col = col
    doc.kind = kind
    doc.helper_id = helper_id
    doc.category_id = category_id
    doc.run_id = run_id
    doc.extracted_attributes = _as_text(extracted_attributes)
    doc.extracted_confidences = _as_text(extracted_confidences)
    doc.corrected_attributes = _as_text(corrected_attributes)
    if computed_value not in (None, ""):
        doc.computed_value = float(computed_value)
    if used_value not in (None, ""):
        doc.used_value = float(used_value)
    doc.event_user = frappe.session.user
    doc.used_at = frappe.utils.now()
    doc.insert(ignore_permissions=True)
    frappe.db.commit()
    return {"ok": True, "name": doc.name}


@frappe.whitelist()
def get_suggestion_events(boq=None, sheet_name=None, run_id=None):
    """Used-state restore: the Use events for (boq, sheet_name), optionally pinned to a run_id.
    Read-only, login required. Returns {events:[{excel_row, col, kind, run_id}]} -- the (row, col)
    pairs the client marks 'used'."""
    _require_login()
    if not boq:
        frappe.throw("boq is required.", title="Missing field: boq")
    if not sheet_name:
        frappe.throw("sheet_name is required.", title="Missing field: sheet_name")
    filters = {"boq": boq, "sheet_name": sheet_name}
    if run_id:
        filters["run_id"] = run_id
    events = frappe.get_all(
        EVENT_DOCTYPE, filters=filters, fields=["excel_row", "col", "kind", "run_id"],
        order_by="creation asc",
    )
    return {"events": events}


# ── RM-4a: rate-master EDITING (admin-only; owner option (a) -- Estimates is READ-ONLY) ──────────
# Four POST-whitelisted write endpoints. Every one gates on the IMPORTED pricing._is_nirmaan_admin
# (never a third copy), with the admin gate BEFORE any target resolution or write (PermissionError on
# failure). PARAM VALUES ONLY: editing pipeline STRUCTURE, conditions, or attribute definitions is
# RM-4b -- a mis-addressed / non-existent path is a validation error, NOT a create. The AUDITED write
# recipe is doc.save (get_doc -> mutate the parsed dict -> json.dumps -> doc.save -> commit): both
# doctypes carry track_changes:1 and DICT-valued JSON only (config / attributes / rates -- no
# BoQ-Sheet-style list-valued field), so doc.save is safe AND records a Version diff. set_value is
# FORBIDDEN for these edits -- it bypasses the doc lifecycle, so it would skip the Version audit.
_MANUAL_BATCH_PREFIX = "manual-"
_MANUAL_SOURCE_SHEET = "Manual entry"


def _require_rate_admin():
    """Admin gate for the RM-4a editors -- BEFORE any resolution/write. Reuses the wizard's
    pricing._is_nirmaan_admin (Administrator OR Nirmaan Admin Profile); never a re-minted copy."""
    user = frappe.session.user
    if not pricing._is_nirmaan_admin(user):
        frappe.throw(
            "Only an admin may edit the rate master.",
            frappe.PermissionError,
            title="Not permitted",
        )
    return user


def _finite_number(value, label):
    """Parse value to a finite float (int/float/numeric-string). Rejects None/bool/NaN/Inf and
    non-numeric strings -- numeric-only param/rate values (RM-4a edits values, never types)."""
    if isinstance(value, bool) or value is None:
        frappe.throw(f"{label} must be a number.", title="Invalid value")
    try:
        num = float(value)
    except (TypeError, ValueError):
        frappe.throw(f"{label} must be a number (got {value!r}).", title="Invalid value")
    if num != num or num in (float("inf"), float("-inf")):
        frappe.throw(f"{label} must be a finite number.", title="Invalid value")
    return num


def _active_config_attr_ids(discipline):
    """Union of attribute-definition ids across the ACTIVE category config(s) for a discipline, or
    None when no active config exists (attribute-key validation is skipped 'where determinable')."""
    rows = frappe.get_all(
        CONFIG_DOCTYPE, filters={"discipline": discipline, "active": 1}, fields=["config"]
    )
    if not rows:
        return None
    ids = set()
    for r in rows:
        cfg = _parse_json(r["config"], {})
        for d in cfg.get("attribute_definitions", []) or []:
            if isinstance(d, dict) and d.get("id"):
                ids.add(d["id"])
    return ids


@frappe.whitelist(methods=["POST"])
def update_rate_config_param(
    name=None, pipeline_id=None, step_index=None, param_key=None, new_value=None,
    condition_index=None,
):
    """ADMIN-ONLY: set ONE existing numeric parameter on a stored pipeline step (or a step's
    condition branch). PARAM VALUES ONLY -- the addressed path MUST already exist; creating/removing
    params or steps is RM-4b (validation error, no write). Audited (doc.save -> Version diff).
    Path: config.pipelines[pipeline_id].steps[step_index].params[param_key], or
          ...steps[step_index].conditions[condition_index].params[param_key].
    Returns {ok, config}. URL: .../rate_master.update_rate_config_param"""
    _require_rate_admin()  # BEFORE resolution/write
    if not name:
        frappe.throw("name is required.", title="Missing field: name")
    if not pipeline_id:
        frappe.throw("pipeline_id is required.", title="Missing field: pipeline_id")
    if step_index is None or step_index == "":
        frappe.throw("step_index is required.", title="Missing field: step_index")
    if not param_key:
        frappe.throw("param_key is required.", title="Missing field: param_key")
    num = _finite_number(new_value, "new_value")
    try:
        step_index = int(step_index)
    except (TypeError, ValueError):
        frappe.throw("step_index must be an integer.", title="Invalid value")
    has_cond = condition_index is not None and condition_index != ""
    if has_cond:
        try:
            condition_index = int(condition_index)
        except (TypeError, ValueError):
            frappe.throw("condition_index must be an integer.", title="Invalid value")

    doc = frappe.get_doc(CONFIG_DOCTYPE, name)  # 404s cleanly if missing
    cfg = _parse_json(doc.config, {})
    pipelines = cfg.get("pipelines") or {}
    if pipeline_id not in pipelines:
        frappe.throw(f"Pipeline '{pipeline_id}' not found in this config.", title="Path not found")
    steps = pipelines[pipeline_id].get("steps") or []
    if not (0 <= step_index < len(steps)):
        frappe.throw(f"step_index {step_index} out of range.", title="Path not found")
    step = steps[step_index]
    if has_cond:
        conditions = step.get("conditions") or []
        if not (0 <= condition_index < len(conditions)):
            frappe.throw(
                f"condition_index {condition_index} out of range.", title="Path not found"
            )
        params = conditions[condition_index].get("params")
    else:
        params = step.get("params")
    if not isinstance(params, dict) or param_key not in params:
        # The param must ALREADY exist -- creating a param is structure editing (RM-4b).
        frappe.throw(
            f"Parameter '{param_key}' does not exist at this path -- adding parameters is not "
            "supported here.",
            title="Path not found",
        )
    params[param_key] = num
    doc.config = json.dumps(cfg)
    doc.save(ignore_permissions=True, ignore_version=False)  # AUDITED (track_changes -> Version diff)
    frappe.db.commit()
    return {"ok": True, "config": cfg}


@frappe.whitelist(methods=["POST"])
def update_rate_master_item(name=None, rates_patch=None, attributes_patch=None):
    """ADMIN-ONLY: merge a rates_patch and/or attributes_patch onto an item's existing JSON dicts.
    Rate values numeric-or-null; attribute keys validated against the discipline's active config
    attribute-definitions where determinable, and material/insulation canonicalised to UPPERCASE.
    Audited (doc.save). Returns {ok, item}. URL: .../rate_master.update_rate_master_item"""
    _require_rate_admin()  # BEFORE resolution/write
    if not name:
        frappe.throw("name is required.", title="Missing field: name")
    rates_patch = _parse_json(rates_patch, None)
    attributes_patch = _parse_json(attributes_patch, None)
    if not rates_patch and not attributes_patch:
        frappe.throw(
            "Provide a rates_patch and/or attributes_patch.", title="Nothing to update"
        )
    if rates_patch is not None and not isinstance(rates_patch, dict):
        frappe.throw("rates_patch must be an object.", title="Invalid value")
    if attributes_patch is not None and not isinstance(attributes_patch, dict):
        frappe.throw("attributes_patch must be an object.", title="Invalid value")

    doc = frappe.get_doc(ITEM_DOCTYPE, name)  # 404s cleanly if missing
    rates = _parse_json(doc.rates, {}) or {}
    attributes = _parse_json(doc.attributes, {}) or {}

    if rates_patch:
        for k, v in rates_patch.items():
            if v is None:
                rates[k] = None  # numeric-OR-NULL
            else:
                rates[k] = _finite_number(v, f"rates.{k}")
    if attributes_patch:
        known = _active_config_attr_ids(doc.discipline)
        merged = dict(attributes)
        for k, v in attributes_patch.items():
            if known is not None and k not in known:
                frappe.throw(
                    f"Unknown attribute '{k}' for discipline '{doc.discipline}'.",
                    title="Invalid attribute",
                )
            merged[k] = v
        attributes = loader._canonicalize_attributes(merged)  # material/insulation -> UPPERCASE

    doc.rates = json.dumps(rates)
    doc.attributes = json.dumps(attributes)
    doc.save(ignore_permissions=True, ignore_version=False)  # AUDITED
    frappe.db.commit()
    return {
        "ok": True,
        "item": {
            "name": doc.name,
            "discipline": doc.discipline,
            "kind": doc.kind,
            "brand": doc.brand,
            "unit": doc.unit,
            "attributes": _parse_json(doc.attributes, {}),
            "rates": _parse_json(doc.rates, {}),
            "active": doc.active,
        },
    }


@frappe.whitelist(methods=["POST"])
def create_rate_master_item(
    discipline=None, kind=None, brand=None, unit=None, attributes=None, rates=None
):
    """ADMIN-ONLY: insert a new ACTIVE item row with MANUAL provenance (import_batch='manual-'+hash,
    source_sheet='Manual entry', source_row=0). Attribute keys validated against the discipline's
    active config where determinable; material/insulation canonicalised to UPPERCASE; rate values
    numeric-or-null. Audited on insert. Returns {ok, item}.
    URL: .../rate_master.create_rate_master_item"""
    _require_rate_admin()  # BEFORE resolution/write
    if not discipline:
        frappe.throw("discipline is required.", title="Missing field: discipline")
    if not kind:
        frappe.throw("kind is required.", title="Missing field: kind")
    attributes = _parse_json(attributes, {}) or {}
    rates = _parse_json(rates, {}) or {}
    if not isinstance(attributes, dict):
        frappe.throw("attributes must be an object.", title="Invalid value")
    if not isinstance(rates, dict):
        frappe.throw("rates must be an object.", title="Invalid value")
    known = _active_config_attr_ids(discipline)
    if known is not None:
        for k in attributes:
            if k not in known:
                frappe.throw(
                    f"Unknown attribute '{k}' for discipline '{discipline}'.",
                    title="Invalid attribute",
                )
    clean_rates = {}
    for k, v in rates.items():
        clean_rates[k] = None if v is None else _finite_number(v, f"rates.{k}")
    attrs = loader._canonicalize_attributes(attributes)  # material/insulation -> UPPERCASE

    doc = frappe.get_doc(
        {
            "doctype": ITEM_DOCTYPE,
            "discipline": discipline,
            "kind": kind.strip(),
            "brand": brand,
            "unit": unit,
            "attributes": json.dumps(attrs),
            "rates": json.dumps(clean_rates),
            "source_sheet": _MANUAL_SOURCE_SHEET,
            "source_row": 0,
            "import_batch": _MANUAL_BATCH_PREFIX + frappe.generate_hash(length=12),
            "active": 1,
        }
    )
    doc.insert(ignore_permissions=True)
    frappe.db.commit()
    return {
        "ok": True,
        "item": {
            "name": doc.name,
            "discipline": doc.discipline,
            "kind": doc.kind,
            "brand": doc.brand,
            "unit": doc.unit,
            "attributes": _parse_json(doc.attributes, {}),
            "rates": _parse_json(doc.rates, {}),
            "source_sheet": doc.source_sheet,
            "source_row": doc.source_row,
            "import_batch": doc.import_batch,
            "active": doc.active,
        },
    }


@frappe.whitelist(methods=["POST"])
def deactivate_rate_master_item(name=None):
    """ADMIN-ONLY: set active=0 on an item (freeze-and-supersede -- the row is RETAINED, NEVER
    deleted). Idempotent. Audited (doc.save). Returns {ok, active:0}.
    URL: .../rate_master.deactivate_rate_master_item"""
    _require_rate_admin()  # BEFORE resolution/write
    if not name:
        frappe.throw("name is required.", title="Missing field: name")
    doc = frappe.get_doc(ITEM_DOCTYPE, name)  # 404s cleanly if missing
    if doc.active:
        doc.active = 0
        doc.save(ignore_permissions=True, ignore_version=False)  # AUDITED
        frappe.db.commit()
    return {"ok": True, "active": 0}


# ── RM-4b: rate-master STRUCTURE EDITING (admin-only) ─────────────────────────────────────────────
# ONE whole-config replace endpoint: update_rate_config(name, config). This LIFTS the RM-4a
# "PARAM VALUES ONLY" boundary -- creating/deleting params, steps, conditions, and attribute
# definitions is now in scope. The submitted config is STRUCTURALLY VALIDATED server-side BEFORE any
# write (admin gate first): known step types only (the interpreter vocabulary); params dicts of finite
# numbers; conditions + component_band bands well-formed; attribute_definitions well-formed; a
# REFERENCE GUARD rejects removing a definition any pipeline references; no unknown top-level keys.
# The interpreter's EXECUTION semantics are OUT OF SCOPE and untouched -- validation accepts exactly the
# shapes the pure interpreter (ratePipelineInterpreter.ts) executes: a condition `when` is
# {attribute: scalar} EXACT-match (the only stored + executable shape -- range/in predicate OBJECTS are
# rejected, since the interpreter would silently never match them), and component_band bands are
# comparator strings ('<35' / '>=35'). Valid -> the audited doc.save recipe (Version diff). Invalid ->
# a named validation error, NO write. GOLDENS live in the config as a "goldens" array (attrs + expected
# finals per pipeline); the frontend preview gate computes them against a draft before save.
_KNOWN_STEP_TYPES = {
    "match_master_row", "apply_effective_multiplier", "scale", "roundup",
    "component", "component_ref", "component_band", "sum_components", "install_as_ratio",
    # EA-4a: the assembly engine's conduit-sizing step (component_ref is EXTENDED in place, so it stays
    # the same step type -- only circuit_fit is a new type).
    "circuit_fit",
    # EA-4c: the DB build-up install -- the sheet's exact IFERROR three-way (shell absent -> supply ratio;
    # shell in the install table -> table rate x mult; else fallback to the supply ratio). PASS-THROUGH:
    # no deep structural validation (the pure interpreter's Option-C degrades a malformed shape to the
    # honest `unsupported`); its @attr (db_shell_item) is already reference-guarded via the component_ref
    # supply steps that bind it.
    "lookup_or_ratio",
    # SLICE 2: computes a module count from a PARAMETERISED weighted sum over stated quantities and
    # resolves it against ladders derived FROM THE CATALOG (exact size, else the next higher one).
    # FULLY validated below -- every attribute id it names is reference-guarded, because an unguarded
    # typo would silently no-compute every row of the category rather than failing at save.
    "module_fit",
    # CIRCUIT LENGTH part 1: computes an ATTRIBUTE value (formula + source attrs + target attr all from
    # CONFIG) into the SELECTION, which is where circuit_fit's length_attr and a component's
    # {from_attr} quantity read -- ctx, where every other step writes, is invisible to both. FULLY
    # validated below, and BOTH its source attrs AND its result_attr are reference-guarded: a typo in
    # the target would silently never find a stated value to defer to, which is the quietest possible
    # way to get a wrong price.
    "derive_attribute",
}
_KNOWN_CONFIG_KEYS = {
    "discipline", "category_id", "category_display", "pairing_rule",
    "attribute_definitions", "pipelines", "bcs_surfacing", "normalization_rule", "goldens",
    "item_kinds",  # EA-1c: the category's master-item kinds (Data-tab scoping); pass-through, not validated
    # EA-2 pass-through keys (stored VERBATIM, NOT structurally validated -- exactly like item_kinds).
    # An item-identity config carries identity_attribute_id + matching_mode + notes, and the helper
    # reads pipeline_labels; the RM-4b editor resubmits the WHOLE config, so these must be accepted or
    # editing/authoring an EA-2 config would be rejected as an unknown key.
    "identity_attribute_id", "matching_mode", "notes", "pipeline_labels",
    # EA-DIFF: synonyms = {attr_id: {variant: canonical}} (e.g. conduit_type GI->MS). Pass-through;
    # consumed by the extraction injection + coercion, never structurally validated here.
    "synonyms",
    # EA-4a: extraction_defaults = {attr_id: default | {default, text_overrides}}. Pass-through; consumed
    # by the extraction prompt injection (defaults + the raceway text-override), never validated here.
    "extraction_defaults",
    # EA-4a-r: extraction_none_guidance = optional per-config wording for the "None" (positive-absence)
    # prompt line. Pass-through; consumed by the extraction injection, never structurally validated here.
    "extraction_none_guidance",
    # EA-4d: composite_slots ({shell, repeatable {prefix,count,...}, fixed[]}) + decomposition_rules
    # ({curve, amp, partial_pricing}) drive the composite-decomposition extraction mode. Pass-through;
    # consumed by extraction.build_slot_spec + the decomposition prompt injection, never structurally
    # validated here (so a composite config round-trips through the RM-4b whole-config editor).
    "composite_slots", "decomposition_rules",
    # EA-4 ext-a: rules = [{id, label, applies_to, guidance}] -- owner-authored estimator guidance
    # injected into the extraction prompt for EVERY category (never gated on matching_mode) and
    # rendered read-only on the Derivation tab. Pass-through, exactly like item_kinds: stored
    # VERBATIM and never structurally validated here.
    #
    # THIS ENTRY IS LOAD-BEARING, not decorative. _validate_config REJECTS any unknown top-level
    # key, and RM-4b resubmits the WHOLE config -- so without "rules" here, adding the key would
    # make every subsequent whole-config save of that category fail. The loader does NOT validate
    # (this function has exactly one caller, update_rate_config), so an unregistered key imports
    # cleanly and only breaks later, at the editor. Same trap the EA-2 pass-through keys document.
    "rules",
}
_BAND_WHEN_RE = re.compile(r"^(<=|>=|<|>)\s*-?\d+(\.\d+)?$")


def _is_finite_number(v):
    """True only for a real finite int/float (rejects bool, None, NaN, +/-Inf, strings)."""
    if isinstance(v, bool) or v is None or not isinstance(v, (int, float)):
        return False
    return v == v and v not in (float("inf"), float("-inf"))


def _vthrow(msg):
    frappe.throw(msg, title="Invalid config")


_FROM_ATTR_SUFFIX = "_from_attr"


def _validate_params(params, where):
    """EA-4 ext-a: two narrowly-scoped relaxations, both making this validator agree with what the
    interpreter is EXPLICITLY built to execute (ratePipelineInterpreter.ts `s.params ?? {}`) and with
    what the shipped asset already contains. Discovered because cabletray_raceway / popup_boxes could
    not be saved through RM-4b AT ALL.

    (1) params is OPTIONAL. A conditional `component` carries its params PER CONDITION, so it has no
        top-level block at all -- that is the whole point of the shape, not an omission.
    (2) a `*_from_attr` param binds an ATTRIBUTE ID, so it is necessarily a string (EA-1's
        value-from-attribute shape, e.g. popup_boxes `module_count_from_attr: "module_count"`).
        The exemption is scoped to that SUFFIX ONLY -- any other param carrying a string is still an
        error, so a genuine typo is still caught.
    """
    if params is None:
        return
    if not isinstance(params, dict):
        _vthrow(f"{where}: params must be an object.")
    for k, v in params.items():
        if isinstance(k, str) and k.endswith(_FROM_ATTR_SUFFIX):
            if not isinstance(v, str) or not v.strip():
                _vthrow(
                    f"{where}: parameter '{k}' must be a non-empty attribute id (a string)."
                )
            continue
        if not _is_finite_number(v):
            _vthrow(f"{where}: parameter '{k}' must be a finite number.")


def _validate_config(cfg):
    """Full structural validation of a whole category config. Returns the map of attribute id ->
    referencing-locations (for the reference guard). Raises a named frappe.ValidationError on the first
    problem; the caller writes NOTHING on a raise."""
    if not isinstance(cfg, dict):
        _vthrow("config must be an object.")
    unknown = set(cfg.keys()) - _KNOWN_CONFIG_KEYS
    if unknown:
        _vthrow(f"Unknown top-level config key(s): {', '.join(sorted(unknown))}.")

    # attribute_definitions ------------------------------------------------------------------
    defs = cfg.get("attribute_definitions")
    if not isinstance(defs, list):
        _vthrow("attribute_definitions must be a list.")
    def_ids = set()
    for i, d in enumerate(defs):
        if not isinstance(d, dict):
            _vthrow(f"attribute_definitions[{i}] must be an object.")
        did = d.get("id")
        if not isinstance(did, str) or not did.strip():
            _vthrow(f"attribute_definitions[{i}] needs a non-empty string id.")
        if did in def_ids:
            _vthrow(f"Duplicate attribute definition id '{did}'.")
        def_ids.add(did)
        if not isinstance(d.get("label"), str) or not d.get("label"):
            _vthrow(f"attribute definition '{did}' needs a label.")
        # CP2: `number_choice` is the THIRD type -- a DROPDOWN that produces a NUMBER. It exists
        # because item matching is strict identity, so a dropdown over a numeric catalog column
        # (cable cores, thickness) must not emit the string "3" against a stored 3.
        if d.get("type") not in ("choice", "number", "number_choice"):
            _vthrow(
                f"attribute definition '{did}' type must be 'choice', 'number' or 'number_choice'."
            )
        # EA-4a: a choice may declare `values_from` (allowed values resolved from the live master at
        # extraction time) INSTEAD of a static `values` list -- point_wiring's switch/socket/plate selects.
        # CP2: a number_choice is a dropdown too, so it carries the SAME requirement -- a picker with
        # neither a values list nor a values_from source would render empty and price nothing.
        if (
            d.get("type") in ("choice", "number_choice")
            and not d.get("values_from")
            and (not isinstance(d.get("values"), list) or not d.get("values"))
        ):
            _vthrow(
                f"{d.get('type')} attribute '{did}' needs a non-empty values list (or values_from)."
            )
        # EA-4a-r: allow_none (bool) marks a POSITIVELY-ABSENT-capable component; disables_when_none is the
        # list of dependent attr ids greyed/cleared when it is set to "None" (pass-through, shape-checked).
        if "allow_none" in d and not isinstance(d.get("allow_none"), bool):
            _vthrow(f"attribute '{did}' allow_none must be true/false.")
        dwn = d.get("disables_when_none")
        if dwn is not None and (not isinstance(dwn, list) or not all(isinstance(x, str) and x for x in dwn)):
            _vthrow(f"attribute '{did}' disables_when_none must be a list of attribute ids.")

    # pipelines ------------------------------------------------------------------------------
    # EA-2: an EMPTY pipelines dict is ACCEPTED -- a DATA-ONLY config (definitions + items, no
    # derivation yet), the owner's in-system authoring path (e.g. lighting_mgmt_system). A NON-empty
    # pipelines object is still validated fully, pipeline by pipeline, below.
    pipelines = cfg.get("pipelines")
    if not isinstance(pipelines, dict):
        _vthrow("pipelines must be an object.")
    referenced = {}  # attr id -> [locations] (for the reference guard's named error)

    def _ref(attr, loc):
        referenced.setdefault(attr, []).append(loc)

    for pid, p in pipelines.items():
        if not isinstance(p, dict):
            _vthrow(f"pipeline '{pid}' must be an object.")
        if not isinstance(p.get("output"), list) or not all(isinstance(o, str) for o in p["output"]):
            _vthrow(f"pipeline '{pid}': output must be a list of strings.")
        steps = p.get("steps")
        if not isinstance(steps, list) or not steps:
            _vthrow(f"pipeline '{pid}': steps must be a non-empty list.")
        for si, s in enumerate(steps):
            where = f"pipeline '{pid}' step {si}"
            if not isinstance(s, dict):
                _vthrow(f"{where}: must be an object.")
            st = s.get("step")
            if st not in _KNOWN_STEP_TYPES:
                _vthrow(f"{where}: unknown step type '{st}'.")
            if st == "match_master_row":
                params = s.get("params")
                if not isinstance(params, dict) or not isinstance(params.get("kind"), str) or not params.get("kind"):
                    _vthrow(f"{where}: match_master_row needs params.kind (a string).")
            elif st == "apply_effective_multiplier":
                for key in ("target", "result", "formula"):
                    if not isinstance(s.get(key), str) or not s.get(key):
                        _vthrow(f"{where}: apply_effective_multiplier needs a string '{key}'.")
                conds = s.get("conditions")
                if not isinstance(conds, list) or not conds:
                    _vthrow(f"{where}: needs a non-empty conditions list.")
                for ci, c in enumerate(conds):
                    if not isinstance(c, dict):
                        _vthrow(f"{where} condition {ci}: must be an object.")
                    when = c.get("when")
                    if not isinstance(when, dict) or not when:
                        _vthrow(f"{where} condition {ci}: 'when' must be a non-empty object of attribute = value.")
                    for wk, wv in when.items():
                        if isinstance(wv, (dict, list)):
                            _vthrow(
                                f"{where} condition {ci}: predicate '{wk}' must be an exact value "
                                "(attribute = value); range/in predicates are not executable."
                            )
                        _ref(wk, f"{where} condition {ci}")
                    _validate_params(c.get("params"), f"{where} condition {ci}")
            elif st == "scale":
                for key in ("target", "result", "formula"):
                    if not isinstance(s.get(key), str) or not s.get(key):
                        _vthrow(f"{where}: scale needs a string '{key}'.")
                _validate_params(s.get("params"), where)
            elif st == "roundup":
                if not isinstance(s.get("target"), str) or not s.get("target"):
                    _vthrow(f"{where}: roundup needs a string 'target'.")
                params = s.get("params")
                if not isinstance(params, dict) or not _is_finite_number(params.get("digits")):
                    _vthrow(f"{where}: roundup needs params.digits (a finite number).")
            elif st == "component":
                # EA-4 ext-a: `target` is OPTIONAL -- a conditional component whose formula is
                # param-only reads no price off the matched row (e.g. the tray's ceiling_accessories,
                # formula "accessories_per_mtr"). The interpreter already treats it as optional
                # (`if (s.target !== undefined)`); this validator was stricter than its own executor.
                # Present-but-blank is still an error, so a real typo is still caught.
                for key in ("name", "formula"):
                    if not isinstance(s.get(key), str) or not s.get(key):
                        _vthrow(f"{where}: component needs a string '{key}'.")
                if "target" in s and (not isinstance(s.get("target"), str) or not s.get("target")):
                    _vthrow(f"{where}: component 'target', when present, must be a non-empty string.")
                _validate_params(s.get("params"), where)
            elif st == "component_ref":
                # EA-2c legacy: base from a referenced row (ref.kind + optional ref.attributes) priced by
                # `formula`. EA-4a assembly: ref attrs INLINE (values literal | "@attr" | "@fitted_size"),
                # priced by rate_stages x qty (no formula). name + target always required; formula required
                # ONLY for the legacy shape.
                is_assembly = s.get("rate_stages") is not None or s.get("qty") is not None
                required = ("name", "target") if is_assembly else ("name", "target", "formula")
                for key in required:
                    if not isinstance(s.get(key), str) or not s.get(key):
                        _vthrow(f"{where}: component_ref needs a string '{key}'.")
                if is_assembly:
                    rs = s.get("rate_stages")
                    if rs is not None:
                        if not isinstance(rs, list):
                            _vthrow(f"{where}: component_ref rate_stages must be a list.")
                        for ri, stage in enumerate(rs):
                            if not isinstance(stage, dict) or not _is_finite_number(stage.get("mult")):
                                _vthrow(f"{where}: rate_stages[{ri}] needs a finite 'mult'.")
                            if stage.get("round") is not None and stage.get("round") not in ("up0", "up-1"):
                                _vthrow(f"{where}: rate_stages[{ri}].round must be 'up0' or 'up-1'.")
                            # point_wiring RUNS: an OPTIONAL attribute-bound factor folded in before this
                            # stage's rounding. REFERENCE-GUARDED so a typo'd id cannot pass silently
                            # (absent means 1 at runtime, so an unguarded typo would read as "no runs").
                            mfa = stage.get("mult_from_attr")
                            if mfa is not None:
                                if not isinstance(mfa, str) or not mfa:
                                    _vthrow(f"{where}: rate_stages[{ri}].mult_from_attr must be an attribute id.")
                                _ref(mfa, f"{where} (rate_stages[{ri}].mult_from_attr)")
                    q = s.get("qty")
                    if q is not None and not (
                        _is_finite_number(q)
                        or (isinstance(q, dict) and ("from_attr" in q or "from_fit" in q or "if_attr" in q))
                    ):
                        _vthrow(f"{where}: component_ref qty must be a number or a from_attr/from_fit/if_attr object.")
                    # EA-4a-r: none_skips (bool) -> a ref @attr resolving to "None" makes this an explicit zero.
                    if "none_skips" in s and not isinstance(s.get("none_skips"), bool):
                        _vthrow(f"{where}: component_ref none_skips must be true/false.")
                ref = s.get("ref")
                if not isinstance(ref, dict) or not isinstance(ref.get("kind"), str) or not ref.get("kind"):
                    _vthrow(f"{where}: component_ref needs ref.kind (a string).")
                ref_attrs = ref.get("attributes")
                if ref_attrs is not None:
                    if not isinstance(ref_attrs, dict):
                        _vthrow(f"{where}: component_ref ref.attributes must be an object of attribute = value.")
                    for ak, av in ref_attrs.items():
                        if isinstance(av, (dict, list)):
                            _vthrow(f"{where}: component_ref ref.attributes['{ak}'] must be an exact value.")
                if s.get("params") is not None:
                    _validate_params(s.get("params"), where)
                conds = s.get("conditions")
                if conds is not None:
                    if not isinstance(conds, list):
                        _vthrow(f"{where}: component_ref conditions must be a list.")
                    for ci, c in enumerate(conds):
                        if not isinstance(c, dict):
                            _vthrow(f"{where} condition {ci}: must be an object.")
                        when = c.get("when")
                        if not isinstance(when, dict) or not when:
                            _vthrow(f"{where} condition {ci}: 'when' must be a non-empty object of attribute = value.")
                        for wk, wv in when.items():
                            if isinstance(wv, (dict, list)):
                                _vthrow(
                                    f"{where} condition {ci}: predicate '{wk}' must be an exact value "
                                    "(attribute = value); range/in predicates are not executable."
                                )
                            _ref(wk, f"{where} condition {ci}")
                        _validate_params(c.get("params"), f"{where} condition {ci}")
            elif st == "component_band":
                for key in ("name", "band_on", "formula"):
                    if not isinstance(s.get(key), str) or not s.get(key):
                        _vthrow(f"{where}: component_band needs a string '{key}'.")
                _ref(s["band_on"], f"{where} (band_on)")
                bands = s.get("bands")
                if not isinstance(bands, list) or not bands:
                    _vthrow(f"{where}: component_band needs a non-empty bands list.")
                for bi, b in enumerate(bands):
                    if not isinstance(b, dict):
                        _vthrow(f"{where} band {bi}: must be an object.")
                    if not isinstance(b.get("when"), str) or not _BAND_WHEN_RE.match(b["when"].strip()):
                        _vthrow(f"{where} band {bi}: 'when' must be a comparator like '<35' or '>=35'.")
                    if not isinstance(b.get("target"), str) or not b.get("target"):
                        _vthrow(f"{where} band {bi}: needs a string 'target'.")
                _validate_params(s.get("params"), where)
            elif st == "sum_components":
                if not isinstance(s.get("result"), str) or not s.get("result"):
                    _vthrow(f"{where}: sum_components needs a string 'result'.")
            elif st == "install_as_ratio":
                if not isinstance(s.get("result"), str) or not s.get("result"):
                    _vthrow(f"{where}: install_as_ratio needs a string 'result'.")
                params = s.get("params")
                if not isinstance(params, dict) or not _is_finite_number(params.get("ratio")):
                    _vthrow(f"{where}: install_as_ratio needs params.ratio (a finite number).")
            elif st == "circuit_fit":
                # EA-4a: sizes the conduit + counts circuits. params.wire_specs reference attribute ids
                # (each a [core_attr, thickness_attr] pair) -> the reference guard covers them; length_attr
                # + conduit_type_attr likewise. sizes/usable are finite-number tables (structure, not attrs).
                p = s.get("params")
                if not isinstance(p, dict):
                    _vthrow(f"{where}: circuit_fit needs a params object.")
                if not isinstance(p.get("sizes"), list) or not all(_is_finite_number(x) for x in p.get("sizes") or []):
                    _vthrow(f"{where}: circuit_fit params.sizes must be a list of finite numbers.")
                if not isinstance(p.get("usable"), dict):
                    _vthrow(f"{where}: circuit_fit params.usable must be an object of conduit_type -> fractions.")
                for ct, fracs in p["usable"].items():
                    if not isinstance(fracs, list) or not all(_is_finite_number(x) for x in fracs):
                        _vthrow(f"{where}: circuit_fit usable['{ct}'] must be a list of finite numbers.")
                specs = p.get("wire_specs")
                if not isinstance(specs, list) or not specs:
                    _vthrow(f"{where}: circuit_fit needs a non-empty wire_specs list.")
                for wi, pair in enumerate(specs):
                    # point_wiring RUNS: an OPTIONAL third element names a parallel-runs attribute
                    # (conduit sizing becomes cores x runs). 2 stays valid -- every pre-existing config
                    # uses it and absence means 1 at runtime.
                    if (
                        not isinstance(pair, list)
                        or len(pair) not in (2, 3)
                        or not all(isinstance(x, str) and x for x in pair)
                    ):
                        _vthrow(
                            f"{where}: circuit_fit wire_specs[{wi}] must be a "
                            f"[core_attr, thickness_attr] pair, optionally with a third runs_attr."
                        )
                    for el in pair:
                        _ref(el, f"{where} (wire_specs)")
                for key in ("length_attr", "conduit_type_attr"):
                    if not isinstance(p.get(key), str) or not p.get(key):
                        _vthrow(f"{where}: circuit_fit needs a string '{key}'.")
                    _ref(p[key], f"{where} ({key})")
                if not isinstance(s.get("binds"), list) or not all(isinstance(b, str) and b for b in s.get("binds") or []):
                    _vthrow(f"{where}: circuit_fit needs a 'binds' list of strings.")
                # EA-4a-r: optional_wire_when_none names the thickness attr of an OPTIONAL wire (omitted from
                # the dia when it is "None"). Reference-guard it like the other attr keys.
                own = p.get("optional_wire_when_none")
                if own is not None:
                    if not isinstance(own, str) or not own:
                        _vthrow(f"{where}: circuit_fit optional_wire_when_none must be an attribute id.")
                    _ref(own, f"{where} (optional_wire_when_none)")
            elif st == "module_fit":
                # SLICE 2. params.terms is the PARAMETERISED weighted sum (one term per quantity slot;
                # weights AND attribute ids are config, so the same step serves switches_sockets' TWO
                # socket slots and point_wiring's one). params.ladders each name a CATALOG family --
                # there is deliberately no size list to validate, because the ladder is derived from
                # the master rows, never from params. Every attribute id is _ref-guarded.
                p = s.get("params")
                if not isinstance(p, dict):
                    _vthrow(f"{where}: module_fit needs a params object.")
                terms = p.get("terms")
                if not isinstance(terms, list) or not terms:
                    _vthrow(f"{where}: module_fit needs a non-empty params.terms list.")
                for ti, t in enumerate(terms):
                    if not isinstance(t, dict):
                        _vthrow(f"{where}: module_fit terms[{ti}] must be an object.")
                    tattr = t.get("attr")
                    if not isinstance(tattr, str) or not tattr:
                        _vthrow(f"{where}: module_fit terms[{ti}] needs an 'attr' (an attribute id).")
                    _ref(tattr, f"{where} (terms[{ti}].attr)")
                    if not _is_finite_number(t.get("weight")):
                        _vthrow(f"{where}: module_fit terms[{ti}] needs a finite 'weight'.")
                    nw = t.get("none_when")
                    if nw is not None:
                        if not isinstance(nw, str) or not nw:
                            _vthrow(f"{where}: module_fit terms[{ti}].none_when must be an attribute id.")
                        _ref(nw, f"{where} (terms[{ti}].none_when)")
                ladders = p.get("ladders")
                if not isinstance(ladders, list) or not ladders:
                    _vthrow(f"{where}: module_fit needs a non-empty params.ladders list.")
                binds = set()
                for li, lad in enumerate(ladders):
                    if not isinstance(lad, dict):
                        _vthrow(f"{where}: module_fit ladders[{li}] must be an object.")
                    for key in ("kind", "bind"):
                        if not isinstance(lad.get(key), str) or not lad.get(key):
                            _vthrow(f"{where}: module_fit ladders[{li}] needs a string '{key}'.")
                    if lad["bind"] in binds:
                        _vthrow(f"{where}: module_fit ladders[{li}] repeats the bind '{lad['bind']}'.")
                    binds.add(lad["bind"])
                    lw = lad.get("where")
                    if lw is not None:
                        if not isinstance(lw, dict):
                            _vthrow(f"{where}: module_fit ladders[{li}].where must be an object of attribute = value.")
                        for wk, wv in lw.items():
                            if isinstance(wv, (dict, list)):
                                _vthrow(f"{where}: module_fit ladders[{li}].where['{wk}'] must be an exact value.")
                    for key in ("label_attr", "bind_modules"):
                        if lad.get(key) is not None and (not isinstance(lad.get(key), str) or not lad.get(key)):
                            _vthrow(f"{where}: module_fit ladders[{li}].{key}, when present, must be a non-empty string.")
                    # SLICE 2 part 2: floor_from names an ATTRIBUTE (the stated value this ladder
                    # fills the silence around), so it is REFERENCE-GUARDED like every other
                    # attribute id -- a typo would silently read as "nothing stated" and let the
                    # computed size override a stated plate, which is the one thing the rule forbids.
                    ff = lad.get("floor_from")
                    if ff is not None:
                        if not isinstance(ff, str) or not ff:
                            _vthrow(f"{where}: module_fit ladders[{li}].floor_from must be an attribute id.")
                        _ref(ff, f"{where} (ladders[{li}].floor_from)")
                    on_none = lad.get("on_none")
                    if on_none is not None and on_none not in ("computed", "none"):
                        _vthrow(
                            f"{where}: module_fit ladders[{li}].on_none must be 'computed' or 'none'."
                        )
                blanks = p.get("blanks")
                if blanks is not None:
                    if not isinstance(blanks, dict):
                        _vthrow(f"{where}: module_fit blanks must be an object.")
                    for key in ("bind", "from_ladder"):
                        if not isinstance(blanks.get(key), str) or not blanks.get(key):
                            _vthrow(f"{where}: module_fit blanks needs a string '{key}'.")
                    if blanks["from_ladder"] not in binds:
                        # A blank count keyed to a ladder that does not exist would compute nothing --
                        # catch it here rather than as a silent runtime no-compute.
                        _vthrow(
                            f"{where}: module_fit blanks.from_ladder '{blanks['from_ladder']}' "
                            f"names no ladder (declared: {', '.join(sorted(binds))})."
                        )
                    sa = blanks.get("stated_attr")
                    if sa is not None:
                        if not isinstance(sa, str) or not sa:
                            _vthrow(f"{where}: module_fit blanks.stated_attr must be an attribute id.")
                        _ref(sa, f"{where} (blanks.stated_attr)")
            elif st == "derive_attribute":
                # CIRCUIT LENGTH part 1. params.terms binds formula identifiers to ATTRIBUTE ids and
                # params.constants holds the rule's fixed numbers -- so the formula, its inputs AND its
                # target are all config, never hardcoded (the module_fit terms precedent). EVERY
                # attribute id here is _ref-guarded, result_attr included: an unguarded typo in the
                # target would silently stop the step ever finding a stated value to defer to.
                p = s.get("params")
                if not isinstance(p, dict):
                    _vthrow(f"{where}: derive_attribute needs a params object.")
                ra = p.get("result_attr")
                if not isinstance(ra, str) or not ra:
                    _vthrow(f"{where}: derive_attribute needs a string 'result_attr' (an attribute id).")
                _ref(ra, f"{where} (result_attr)")
                if not isinstance(p.get("formula"), str) or not p.get("formula"):
                    _vthrow(f"{where}: derive_attribute needs a non-empty string 'formula'.")
                terms = p.get("terms")
                if not isinstance(terms, list) or not terms:
                    _vthrow(f"{where}: derive_attribute needs a non-empty params.terms list.")
                idents = set()
                for ti, t in enumerate(terms):
                    if not isinstance(t, dict):
                        _vthrow(f"{where}: derive_attribute terms[{ti}] must be an object.")
                    for key in ("ident", "attr"):
                        if not isinstance(t.get(key), str) or not t.get(key):
                            _vthrow(f"{where}: derive_attribute terms[{ti}] needs a string '{key}'.")
                    if t["ident"] in idents:
                        # Two terms binding the SAME identifier means one silently wins -- so the
                        # formula would read an input the author did not choose.
                        _vthrow(f"{where}: derive_attribute terms[{ti}] repeats the ident '{t['ident']}'.")
                    idents.add(t["ident"])
                    _ref(t["attr"], f"{where} (terms[{ti}].attr)")
                consts = p.get("constants")
                if consts is not None:
                    if not isinstance(consts, dict):
                        _vthrow(f"{where}: derive_attribute constants must be an object.")
                    for ck, cv in consts.items():
                        if ck in idents:
                            # A constant sharing a term's identifier makes the formula ambiguous.
                            _vthrow(
                                f"{where}: derive_attribute constant '{ck}' collides with a term ident."
                            )
                        if not _is_finite_number(cv):
                            _vthrow(f"{where}: derive_attribute constant '{ck}' must be a finite number.")
                unit = p.get("unit")
                if unit is not None and (not isinstance(unit, str) or not unit):
                    _vthrow(f"{where}: derive_attribute unit, when present, must be a non-empty string.")

    # REFERENCE GUARD: every attr a pipeline references must be defined (names where each is used) ----
    missing = {a: locs for a, locs in referenced.items() if a not in def_ids}
    if missing:
        parts = [f"'{a}' (referenced by {', '.join(locs)})" for a, locs in sorted(missing.items())]
        _vthrow(
            "These attributes are referenced by a pipeline but not defined: "
            + "; ".join(parts)
            + ". Add the definition, or remove the references first."
        )

    # goldens (optional) ---------------------------------------------------------------------
    goldens = cfg.get("goldens")
    if goldens is not None:
        if not isinstance(goldens, list):
            _vthrow("goldens must be a list.")
        for gi, g in enumerate(goldens):
            if not isinstance(g, dict):
                _vthrow(f"goldens[{gi}] must be an object.")
            if not isinstance(g.get("attrs"), dict) or not g.get("attrs"):
                _vthrow(f"goldens[{gi}] needs a non-empty attrs object.")
            expect = g.get("expect")
            if not isinstance(expect, dict) or not expect:
                _vthrow(f"goldens[{gi}] needs a non-empty expect object.")
            for epid, emap in expect.items():
                if epid not in pipelines:
                    _vthrow(f"goldens[{gi}] expects unknown pipeline '{epid}'.")
                if not isinstance(emap, dict) or not emap:
                    _vthrow(f"goldens[{gi}] expect['{epid}'] must be a non-empty object.")
                for ek, ev in emap.items():
                    if not _is_finite_number(ev):
                        _vthrow(f"goldens[{gi}] expect['{epid}']['{ek}'] must be a finite number.")

    return referenced


@frappe.whitelist(methods=["POST"])
def update_rate_config(name=None, config=None):
    """ADMIN-ONLY (RM-4b): replace a category config's WHOLE config JSON after full server-side
    structural validation. Lifts the RM-4a param-values-only boundary -- add/remove params, steps,
    conditions, and attribute definitions. The submitted config.discipline/category_id must match the
    stored doc's (no identity repoint). Audited (doc.save -> Version diff). Returns {ok, config}.
    URL: .../rate_master.update_rate_config"""
    _require_rate_admin()  # BEFORE resolution/write
    if not name:
        frappe.throw("name is required.", title="Missing field: name")
    cfg = _parse_json(config, None)
    if not isinstance(cfg, dict):
        frappe.throw("config must be an object.", title="Invalid value")

    doc = frappe.get_doc(CONFIG_DOCTYPE, name)  # 404s cleanly if missing
    # identity guard: the submitted config must not repoint discipline/category_id
    if cfg.get("discipline") != doc.discipline:
        frappe.throw(
            f"config.discipline '{cfg.get('discipline')}' does not match this config's discipline "
            f"'{doc.discipline}'.",
            title="Invalid config",
        )
    if cfg.get("category_id") != doc.category_id:
        frappe.throw(
            f"config.category_id '{cfg.get('category_id')}' does not match this config's category_id "
            f"'{doc.category_id}'.",
            title="Invalid config",
        )

    _validate_config(cfg)  # raises a named ValidationError on any problem -- NO write on raise

    doc.config = json.dumps(cfg)
    doc.save(ignore_permissions=True, ignore_version=False)  # AUDITED (track_changes -> Version diff)
    frappe.db.commit()
    return {"ok": True, "config": cfg}
