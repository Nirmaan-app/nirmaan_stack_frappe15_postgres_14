"""Heal dead "running" BoQ Rate Suggestion Runs (CU-A AC4). Every 5 minutes, from hooks.py.

A suggestion run whose worker was hard-killed (rq's monitor SIGKILLs at timeout + 60 s, a laptop sleep,
a container restart) never reaches its `except` block, so the run document stays `running` for good:
CU-0 found BRSR-26-00766 on dev and sixteen restored production runs on BOQ-26-00245 (2026-09-07/08).

A run is marked `failed`, reason "stale - worker gone", only when ALL hold:
  * status is `running` (no other status is ever touched);
  * no suggest job for it is queued, started or deferred on any queue. A run is tied to its job two
    ways, and both are checked: `run_id` is the job id of the pass that CREATED the run, while a
    RESUME runs under a new job id that only the per-sheet marker knows -- so any live suggest job on
    the same (boq, sheet_name) also counts as the run's;
  * `modified` is older than STALE_AFTER_SEC. Checkpoints write with update_modified=False, so
    `modified` alone says nothing about a live run -- the job check is what protects one; the age is
    the margin past the job timeout (3600 s + 60 s kill grace).
It never changes `active`, never deletes, keeps the run's checkpointed rows (a failed run stays
resumable, exactly as _mark_run_failed leaves one), and does nothing when the queues cannot be read.
Owner rulings 2026-10-17 18:59 ("ok"): approved on dev and on production, and the on-screen change
(a dead run shows as failed with this reason) is approved.
"""
from __future__ import annotations

import logging

import frappe
from frappe.utils import add_to_date, now_datetime

RUN_DOCTYPE = "BoQ Rate Suggestion Run"
SUGGEST_WORKER = "nirmaan_stack.api.boq.rate_master._suggest_worker"
STALE_AFTER_SEC = 2 * 3600
REASON = "stale - worker gone"
_QUEUES = ("default", "short", "long")


def _live_suggest_jobs() -> tuple[set, set] | None:
    """(rq job ids, {(boq, sheet_name)}) of every suggest job of this site that is queued, started or
    deferred on any queue. None when the queues could not be read -- the caller then heals nothing."""
    try:
        from frappe.utils.background_jobs import get_queue
        from rq.job import Job

        ids, keys = set(), set()
        for name in _QUEUES:
            queue = get_queue(name)
            job_ids = (list(queue.job_ids) + list(queue.started_job_registry.get_job_ids())
                       + list(queue.deferred_job_registry.get_job_ids()))
            for job in Job.fetch_many(job_ids, connection=queue.connection):
                if job is None:
                    continue
                wrapped = job.kwargs or {}
                if wrapped.get("site") != frappe.local.site:
                    continue
                method = wrapped.get("method")
                if not isinstance(method, str):
                    method = f"{getattr(method, '__module__', '')}.{getattr(method, '__name__', '')}"
                if method != SUGGEST_WORKER:
                    continue
                inner = wrapped.get("kwargs") or {}
                ids.add(job.id)
                keys.add((inner.get("boq"), inner.get("sheet_name")))
        return ids, keys
    except Exception:
        frappe.log_error(title="Suggest run healer: queue read failed", message=frappe.get_traceback())
        return None


def heal_stale_suggestion_runs(boqs: list[str] | None = None) -> list[str]:
    """Mark every dead `running` suggestion run `failed`. Returns the names it healed. `boqs` narrows
    the sweep to those BoQs (how a test stays inside its own fixtures); the scheduler passes none."""
    from frappe.utils.background_jobs import create_job_id

    cutoff = add_to_date(now_datetime(), seconds=-STALE_AFTER_SEC)
    filters = {"status": "running", "modified": ["<", cutoff]}
    if boqs is not None:
        filters["boq"] = ["in", list(boqs) or [""]]
    runs = frappe.get_all(
        RUN_DOCTYPE,
        filters=filters,
        fields=["name", "boq", "sheet_name", "run_id"],
        order_by="name asc",
    )
    if not runs:
        return []
    live = _live_suggest_jobs()
    if live is None:
        return []
    live_ids, live_keys = live
    healed = []
    for run in runs:
        if (run.run_id and create_job_id(run.run_id) in live_ids) or (run.boq, run.sheet_name) in live_keys:
            continue
        # Re-read inside the row lock and refuse any from-status but `running`: the worker may have
        # finished it between the query above and here (CODING_STANDARDS § Status transitions).
        row = frappe.db.sql(
            f'select status, halt_reason from "tab{RUN_DOCTYPE}" where name = %s for update', (run.name,)
        )
        if not row or row[0][0] != "running":
            frappe.db.rollback()
            continue
        reason = f"{row[0][1]}\n{REASON}" if row[0][1] else REASON
        # set_value skips doc_events; this doctype has none, and update_modified=False matches the
        # worker's own _mark_run_failed (the run's `modified` keeps meaning "last real write").
        frappe.db.set_value(RUN_DOCTYPE, run.name, {"status": "failed", "halt_reason": reason},
                            update_modified=False)
        frappe.db.commit()
        healed.append(run.name)
    if healed:
        logger = frappe.logger("nirmaan_suggest_healer", allow_site=True)
        # Frappe file loggers default to ERROR off the dev server (utils/logger.py): INFO needs this
        logger.setLevel(logging.INFO)
        logger.info(f"healed {len(healed)}: {healed}")
    return healed
