"""
BoQ Wizard -- the Claude review run log, its health check, and the automatic run after a parse (S2).

One "BoQ AI Run Log" record per Claude review run, manual or automatic:

* WRITES (create_run / begin_run / heartbeat / finish_run / fail_run / mark_superseded) -- called by
  the endpoint and the worker in ai_assist.py. The record holds the run's timings and tokens itself:
  the boq_ai logger writes ERROR and above only, so an info line would never be written.
* HEALTH CHECK (heal_stale_runs) -- a Running run with no heartbeat for HEARTBEAT_STALE_SEC, or
  started more than RUN_STALE_SEC ago, and a Queued run whose job has left the queue, is marked
  Failed "worker stopped or timed out" and its sheet's ai_in_progress flag is cleared. An in-progress
  flag (Claude or Gemini) with no run record and no live job is cleared by the same pass. Called by
  the 5-minute scheduler entry (heal_stale_runs_task) and ON READ: the status endpoint, a run start,
  a parse start.
* AUTO-RUN (on_parse_start / enqueue_after_parse) -- the two calls parse_run.py makes: one Claude job
  per sheet that ended "Parsed", enqueued only after the parse transaction has committed.

The record never holds the API key: every failure message goes through boq_ai_assist.scrub_keys and
is capped. Nothing here calls the AI or loads the examples library.
"""
from __future__ import annotations

from typing import Any

import frappe
from frappe.utils import get_datetime, now_datetime, time_diff_in_seconds

from nirmaan_stack.api.boq.wizard.ai_settings import (
    get_boq_ai_api_key,
    get_boq_ai_settings,
)
from nirmaan_stack.services import boq_ai_assist

_RUN_LOG = "BoQ AI Run Log"
_SHEET_DRAFT = "BoQ Sheet Draft"
_CLAUDE_WORKER = "nirmaan_stack.api.boq.wizard.ai_assist._run_ai_pass_worker"
_GEMINI_WORKER = "nirmaan_stack.api.boq.wizard.gemini_assist._run_gemini_pass_worker"
_LIVE_STATUSES = ("Queued", "Running")
_LIVE_JOB_STATES = frozenset({"queued", "started", "deferred", "scheduled"})

CLAUDE_JOB_TIMEOUT_SEC = 1200       # the Claude job's limit (Gemini's and the parse job's stay 600)
HEARTBEAT_STALE_SEC = 360           # the 300 s per-request limit + margin
RUN_STALE_SEC = 1320                # the 1200 s job limit + margin, counted from the run's START
QUEUED_GRACE_SEC = 60               # a just-created Queued record may not have reached the queue yet
FAILURE_MESSAGE_MAX = 1000

TRIGGER_AUTO = "auto-after-parse"
TRIGGER_REPARSE = "re-parse"
TRIGGER_MANUAL = "manual"

CATEGORY_STALE = "worker stopped or timed out"
CATEGORY_UNAVAILABLE = boq_ai_assist.CATEGORY_UNAVAILABLE
CATEGORY_INTERNAL = boq_ai_assist.CATEGORY_INTERNAL


class RunSuperseded(Exception):
    """The sheet was re-parsed after this run was queued: its answers must not be written."""


# ---------------------------------------------------------------------------
# Writes
# ---------------------------------------------------------------------------

def scrub(text: Any, secrets=()) -> str:
    """A failure message safe to store: no key (the given secrets and anything key-shaped), capped."""
    return boq_ai_assist.scrub_keys(text, secrets)[:FAILURE_MESSAGE_MAX]


def create_run(boq_name: str, sheet_name: str, trigger: str, *, status: str = "Queued",
               job_id: str | None = None, last_parsed_at: Any = None, **fields: Any) -> str:
    """Insert one run record and return its name. No commit."""
    doc = frappe.get_doc({
        "doctype": _RUN_LOG,
        "boq": boq_name,
        "sheet_name": sheet_name,
        "trigger": trigger,
        "status": status,
        "prompt_version": boq_ai_assist.PROMPT_VERSION,
        "job_id": job_id,
        "sheet_last_parsed_at": last_parsed_at,
        "queued_at": now_datetime(),
        **fields,
    })
    doc.insert(ignore_permissions=True)
    return doc.name


def _update(run_name: str | None, **fields: Any) -> None:
    if not run_name or not fields:
        return
    # Raw write on purpose: the run log has no doc_events and no derived field to recompute.
    frappe.db.set_value(_RUN_LOG, run_name, fields, update_modified=False)


def heartbeat(run_name: str | None, **fields: Any) -> None:
    """Stamp last_heartbeat (plus any progress fields) and COMMIT, so the health check sees it
    while the job is still running. Never raises: a heartbeat must not break the pass."""
    if not run_name:
        return
    try:
        _update(run_name, last_heartbeat=now_datetime(), **fields)
        frappe.db.commit()
    except Exception:
        frappe.log_error(title="BoQ AI run log: heartbeat failed", message=frappe.get_traceback())


def progress_recorder(run_name: str | None):
    """The callback the service calls before every attempt and after every chunk."""
    def record(event: str, **data: Any) -> None:
        heartbeat(run_name, **{
            k: data[k] for k in ("chunks_total", "chunks_done", "input_tokens", "output_tokens")
            if k in data
        })
    return record


def library_fields(info: dict | None) -> dict:
    """The run-log fields for what build_guidance reported about the examples library."""
    info = info or {}
    return {
        k: info[k]
        for k in ("library_status", "library_seconds", "lookup_seconds", "library_memory_peak_mib")
        if info.get(k) is not None
    }


def same_parse(expected: Any, current: Any) -> bool:
    """True when the sheet's last_parsed_at is still the one the run was queued for."""
    if expected is None:
        return True
    if current is None:
        return False
    return get_datetime(expected) == get_datetime(current)


def _sheet_last_parsed_at(boq_name: str, sheet_name: str) -> Any:
    return frappe.db.get_value(
        _SHEET_DRAFT, {"parent": boq_name, "parenttype": "BOQs", "sheet_name": sheet_name},
        "last_parsed_at",
    )


def expected_parse_time(run_name: str | None) -> Any:
    if not run_name:
        return None
    return frappe.db.get_value(_RUN_LOG, run_name, "sheet_last_parsed_at")


def begin_run(run_name: str | None, boq_name: str, sheet_name: str) -> bool:
    """Queued -> Running, with the first heartbeat. Returns False when the run must NOT proceed:
    it is no longer Queued (the health check already failed it), or its sheet has been re-parsed
    since it was queued (it is then marked Superseded, before any AI call)."""
    if not run_name:
        return True
    info = frappe.db.get_value(_RUN_LOG, run_name, ["status", "sheet_last_parsed_at"], as_dict=True)
    if not info:
        return True     # no record to keep in step with: never block the pass on the log
    if info.status != "Queued":
        return False
    if not same_parse(info.sheet_last_parsed_at, _sheet_last_parsed_at(boq_name, sheet_name)):
        mark_superseded(run_name, boq_name, sheet_name)
        return False
    now = now_datetime()
    _update(run_name, status="Running", started_at=now, last_heartbeat=now)
    frappe.db.commit()
    return True


def still_running(run_name: str | None) -> bool:
    """False when the health check failed this run while its worker was still busy -- the late
    answers are then discarded."""
    if not run_name:
        return True
    status = frappe.db.get_value(_RUN_LOG, run_name, "status")
    return status is None or status == "Running"


def finish_run(run_name: str | None, status: str, **fields: Any) -> None:
    """Terminal state + finished_at. No commit (the caller's commit carries it)."""
    now = now_datetime()
    _update(run_name, status=status, finished_at=now, last_heartbeat=now, **fields)


def fail_run(run_name: str | None, category: str, message: Any, *, error_log: str | None = None,
             secrets=()) -> None:
    finish_run(
        run_name, "Failed", failure_category=category, failure_message=scrub(message, secrets),
        **({"error_log": error_log} if error_log else {}),
    )


def other_live_run(boq_name: str, sheet_name: str, run_name: str | None) -> bool:
    filters: dict = {"boq": boq_name, "sheet_name": sheet_name, "status": ["in", _LIVE_STATUSES]}
    if run_name:
        filters["name"] = ["!=", run_name]
    return bool(frappe.db.exists(_RUN_LOG, filters))


def mark_superseded(run_name: str | None, boq_name: str, sheet_name: str) -> None:
    """Record "superseded" and commit. The sheet's in-progress flag is left alone while a newer run
    for the same sheet is queued or running -- that run owns the flag now."""
    finish_run(
        run_name, "Superseded",
        failure_message="superseded: the sheet was re-parsed after this run was queued; "
                        "its answers were discarded",
    )
    if not other_live_run(boq_name, sheet_name, run_name):
        _set_flag(boq_name, sheet_name, "ai_in_progress", 0)
    frappe.db.commit()


def _set_flag(boq_name: str, sheet_name: str, fieldname: str, value: int) -> None:
    name = frappe.db.get_value(
        _SHEET_DRAFT, {"parent": boq_name, "parenttype": "BOQs", "sheet_name": sheet_name}, "name"
    )
    if name:
        # Raw write on purpose: a child-row marker with no hook and nothing derived from it.
        frappe.db.set_value(_SHEET_DRAFT, name, fieldname, value)


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------

def _job_is_live(job_id: str | None) -> bool:
    if not job_id:
        return False
    from frappe.utils.background_jobs import get_job_status

    status = get_job_status(job_id)
    return getattr(status, "value", status) in _LIVE_JOB_STATES


def _live_sheet_jobs() -> set | None:
    """{(worker method, boq, sheet)} for every queued or started job of this site on the long
    queue. None when the queue could not be read -- the caller then clears nothing."""
    try:
        from frappe.utils.background_jobs import get_queue
        from rq.job import Job

        queue = get_queue("long")
        ids = list(queue.job_ids) + list(queue.started_job_registry.get_job_ids())
        live: set = set()
        for job in Job.fetch_many(ids, connection=queue.connection):
            if job is None:
                continue
            wrapped = job.kwargs or {}
            if wrapped.get("site") != frappe.local.site:
                continue
            method = wrapped.get("method")
            if not isinstance(method, str):
                method = f"{getattr(method, '__module__', '')}.{getattr(method, '__name__', '')}"
            inner = wrapped.get("kwargs") or {}
            live.add((method, inner.get("boq_name"), inner.get("sheet_name")))
        return live
    except Exception:
        frappe.log_error(title="BoQ AI health check: queue read failed", message=frappe.get_traceback())
        return None


def _is_stale(run: dict, now) -> str | None:
    """The reason this live run is stale, or None when it is healthy."""
    if run.status == "Running":
        beat = run.last_heartbeat or run.started_at
        if beat and time_diff_in_seconds(now, beat) > HEARTBEAT_STALE_SEC:
            return f"no heartbeat for more than {HEARTBEAT_STALE_SEC} s (last: {beat})"
        if run.started_at and time_diff_in_seconds(now, run.started_at) > RUN_STALE_SEC:
            return f"started more than {RUN_STALE_SEC} s ago ({run.started_at})"
        return None
    # Queued: time in the queue alone never fails a run -- only a job that is no longer there.
    if run.queued_at and time_diff_in_seconds(now, run.queued_at) <= QUEUED_GRACE_SEC:
        return None
    if _job_is_live(run.job_id):
        return None
    return "its job is no longer in the queue"


def _fail_stale(run: dict, reason: str) -> None:
    from nirmaan_stack.api.boq.wizard import ai_assist

    fail_run(run.name, CATEGORY_STALE, f"{CATEGORY_STALE}: {reason}")
    if other_live_run(run.boq, run.sheet_name, run.name):
        frappe.db.commit()
        return
    # The worker's own choke-point: clears ai_in_progress, commits, records the poll payload and
    # publishes boq:ai_pass_done, so an open Review screen drops its "AI pass running" chip.
    ai_assist._publish_ai_event(
        run.boq, run.sheet_name, "error", user=run.owner, error_code="stale"
    )


def _clear_orphan_flags(boq_name: str | None, sheet_name: str | None) -> tuple[int, int]:
    """Clear an in-progress flag that no live run record and no live job accounts for. Returns
    (claude flags cleared, gemini flags cleared). A flag whose job may be alive is never cleared."""
    conditions = ["parenttype = 'BOQs'", "(ai_in_progress = 1 OR gemini_in_progress = 1)"]
    values: list = []
    if boq_name:
        conditions.append("parent = %s")
        values.append(boq_name)
    if sheet_name:
        conditions.append("sheet_name = %s")
        values.append(sheet_name)
    flagged = frappe.db.sql(
        'SELECT name, parent, sheet_name, ai_in_progress, gemini_in_progress '
        f'FROM "tabBoQ Sheet Draft" WHERE {" AND ".join(conditions)}',
        values, as_dict=True,
    )
    if not flagged:
        return 0, 0
    recorded = {
        (r.boq, r.sheet_name)
        for r in frappe.get_all(
            _RUN_LOG, filters={"status": ["in", _LIVE_STATUSES]}, fields=["boq", "sheet_name"]
        )
    }
    # The queue is read only when a flag is not already explained by a live run record.
    if not any(
        d.gemini_in_progress or (d.ai_in_progress and (d.parent, d.sheet_name) not in recorded)
        for d in flagged
    ):
        return 0, 0
    live_jobs = _live_sheet_jobs()
    if live_jobs is None:
        return 0, 0
    ai_cleared = gemini_cleared = 0
    for d in flagged:
        key = (d.parent, d.sheet_name)
        if d.ai_in_progress and key not in recorded and (_CLAUDE_WORKER, *key) not in live_jobs:
            frappe.db.set_value(_SHEET_DRAFT, d.name, "ai_in_progress", 0)
            ai_cleared += 1
        if d.gemini_in_progress and (_GEMINI_WORKER, *key) not in live_jobs:
            frappe.db.set_value(_SHEET_DRAFT, d.name, "gemini_in_progress", 0)
            gemini_cleared += 1
    if ai_cleared or gemini_cleared:
        frappe.db.commit()
    return ai_cleared, gemini_cleared


def heal_stale_runs(boq_name: str | None = None, sheet_name: str | None = None) -> dict:
    """The health check, for one sheet, one BoQ, or (no arguments) every live run. Light: one
    indexed query over the Queued / Running runs and one over the flagged sheet drafts."""
    filters: dict = {"status": ["in", _LIVE_STATUSES]}
    if boq_name:
        filters["boq"] = boq_name
    if sheet_name:
        filters["sheet_name"] = sheet_name
    runs = frappe.get_all(
        _RUN_LOG, filters=filters,
        fields=["name", "boq", "sheet_name", "status", "job_id", "queued_at", "started_at",
                "last_heartbeat", "owner"],
    )
    now = now_datetime()
    failed = 0
    for run in runs:
        reason = _is_stale(run, now)
        if reason:
            _fail_stale(run, reason)
            failed += 1
    ai_cleared, gemini_cleared = _clear_orphan_flags(boq_name, sheet_name)
    return {"failed_runs": failed, "ai_flags_cleared": ai_cleared,
            "gemini_flags_cleared": gemini_cleared}


def heal_on_read(boq_name: str | None = None, sheet_name: str | None = None) -> None:
    """heal_stale_runs for a READ path: a health-check problem must never fail the read."""
    try:
        heal_stale_runs(boq_name, sheet_name)
    except Exception:
        frappe.db.rollback()
        frappe.log_error(title="BoQ AI health check failed", message=frappe.get_traceback())


def heal_stale_runs_task() -> None:
    """The timed check (hooks.py, every 5 minutes)."""
    heal_stale_runs()


# ---------------------------------------------------------------------------
# The automatic run after a parse (parse_run.py's two calls)
# ---------------------------------------------------------------------------

def on_parse_start(boq_name: str) -> frozenset:
    """Called when a parse starts: heal this BoQ's stale runs, and return the sheets that had been
    parsed before -- so the run queued after this parse is logged as "re-parse" for them. Never
    raises into the parse."""
    try:
        heal_stale_runs(boq_name)
        return frozenset(frappe.get_all(
            _SHEET_DRAFT,
            filters={"parent": boq_name, "parenttype": "BOQs", "has_prior_parse": 1},
            pluck="sheet_name",
        ))
    except Exception:
        frappe.db.rollback()
        frappe.log_error(
            title=f"BoQ AI auto-run: parse-start step failed for {boq_name}",
            message=frappe.get_traceback(),
        )
        return frozenset()


def _auto_run_allowed() -> bool:
    # A test run shares the site's queue and its real AI settings: a parse inside a test must never
    # put a real, paid Claude job on that queue. Tests of the auto-run patch this.
    return not frappe.flags.in_test


def enqueue_after_parse(boq_name: str, parsed_sheets, user: str | None = None,
                        prior_parsed=frozenset()) -> list:
    """Called AFTER the parse transaction has committed: queue one Claude review job for every
    sheet that ended "Parsed". Returns the run names. Never raises into the parse."""
    try:
        return _enqueue_after_parse(boq_name, list(parsed_sheets or []), user, prior_parsed)
    except Exception:
        frappe.db.rollback()
        frappe.log_error(
            title=f"BoQ AI auto-run: enqueue after parse failed for {boq_name}",
            message=frappe.get_traceback(),
        )
        frappe.db.commit()
        return []


def _enqueue_after_parse(boq_name: str, parsed_sheets: list, user: str | None,
                         prior_parsed) -> list:
    from nirmaan_stack.api.boq.wizard import ai_assist

    if not parsed_sheets or not _auto_run_allowed():
        return []
    # A template-origin BoQ has no source workbook and is never parsed; refused here as well so
    # the rule does not depend on that.
    if frappe.db.get_value("BOQs", boq_name, "origin") == "template":
        return []
    general_specs = set(frappe.get_all(
        "BoQ General Specs Sheet", filters={"parent": boq_name, "parenttype": "BOQs"},
        pluck="source_sheet_name",
    ))
    drafts = {
        d.sheet_name: d
        for d in frappe.get_all(
            _SHEET_DRAFT,
            filters={"parent": boq_name, "parenttype": "BOQs", "sheet_name": ["in", parsed_sheets]},
            fields=["sheet_name", "wizard_status", "last_parsed_at"],
        )
    }
    # Only a sheet whose status the parse left at "Parsed": a failed, Hidden, Skip or
    # general-specs sheet never is.
    eligible = [
        drafts[s] for s in parsed_sheets
        if s in drafts and drafts[s].wizard_status == "Parsed" and s not in general_specs
    ]
    if not eligible:
        return []

    unavailable = None
    if not get_boq_ai_settings().get("enabled"):
        unavailable = "the AI review is disabled in BOQ Upload Review AI Settings"
    elif not get_boq_ai_api_key():
        unavailable = "no API key is configured in BOQ Upload Review AI Settings"

    user = user or frappe.session.user
    runs: list = []
    for d in eligible:
        trigger = TRIGGER_REPARSE if d.sheet_name in prior_parsed else TRIGGER_AUTO
        if unavailable:
            runs.append(create_run(
                boq_name, d.sheet_name, trigger, status="Failed",
                last_parsed_at=d.last_parsed_at, finished_at=now_datetime(),
                failure_category=CATEGORY_UNAVAILABLE, failure_message=unavailable,
            ))
            continue
        job_id = frappe.generate_hash(length=32)
        run_name = create_run(
            boq_name, d.sheet_name, trigger, job_id=job_id, last_parsed_at=d.last_parsed_at
        )
        frappe.db.commit()      # the worker reads this record: it must exist before the job can start
        try:
            frappe.enqueue(
                _CLAUDE_WORKER,
                queue="long",
                timeout=CLAUDE_JOB_TIMEOUT_SEC,
                job_id=job_id,
                user=user,
                boq_name=boq_name,
                sheet_name=d.sheet_name,
                run_name=run_name,
            )
        except Exception as exc:
            fail_run(run_name, CATEGORY_INTERNAL, f"enqueue failed: {type(exc).__name__}: {exc}")
            frappe.db.commit()
            runs.append(run_name)
            continue
        ai_assist._set_ai_in_progress(boq_name, d.sheet_name, 1)
        frappe.db.commit()
        # The previous run's outcome must not answer the page's first poll for THIS run.
        try:
            frappe.cache().delete_value(ai_assist._ai_status_key(boq_name, d.sheet_name))
        except Exception:
            pass
        runs.append(run_name)
    frappe.db.commit()
    return runs
