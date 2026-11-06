"""Heal dead BoQ Rate Match Runs (DEV2-B4 S2). Every 5 minutes, from hooks.py, beside suggest_run_healer.

A match run whose worker was hard-killed (rq kills at the job timeout + 60 s, a container restart) never reaches its
`except` block, so the run stays `queued` or `running` for good. Exactly suggest_run_healer's pattern: a run is marked
`halted`, reason "stale - worker gone", only when ALL hold:
  * status is `queued` or `running` (no other status is ever touched);
  * no match job for it is queued, started or deferred on any queue -- by its job id, or any live match job on the
    same (boq, sheet_name);
  * `modified` is older than the match run's stale threshold (api/boq/rate_match._STALE_MATCH_SECONDS: the job
    timeout + rq's 60 s kill grace + 240 s -- its clocks have passed). Progress writes use update_modified=False, so
    `modified` is the last status change; the job check is what protects a live run.
It never changes `active`, never deletes, keeps whatever the run stored, never touches a Suggest run, and does
nothing when the queues cannot be read.
"""
from __future__ import annotations

import logging

import frappe
from frappe.utils import add_to_date, now_datetime

MATCH_DOCTYPE = "BoQ Rate Match Run"
MATCH_WORKER = "nirmaan_stack.api.boq.rate_match._match_worker"
REASON = "stale - worker gone"
LIVE = ("queued", "running")
_QUEUES = ("default", "short", "long")


def stale_after_sec():
    from nirmaan_stack.api.boq.rate_match import _STALE_MATCH_SECONDS
    return _STALE_MATCH_SECONDS


def _live_match_jobs() -> tuple[set, set] | None:
    """(rq job ids, {(boq, sheet_name)}) of every match job of this site that is queued, started or deferred on any
    queue. None when the queues could not be read -- the caller then heals nothing."""
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
                if method != MATCH_WORKER:
                    continue
                inner = wrapped.get("kwargs") or {}
                ids.add(job.id)
                keys.add((inner.get("boq"), inner.get("sheet_name")))
        return ids, keys
    except Exception:
        frappe.log_error(title="Match run healer: queue read failed", message=frappe.get_traceback())
        return None


def heal_stale_match_runs(boqs: list[str] | None = None) -> list[str]:
    """Mark every dead queued / running match run `halted`. Returns the names it healed. `boqs` narrows the sweep to
    those BoQs (how a test stays inside its own fixtures); the scheduler passes none."""
    from frappe.utils.background_jobs import create_job_id

    cutoff = add_to_date(now_datetime(), seconds=-stale_after_sec())
    filters = {"status": ["in", list(LIVE)], "modified": ["<", cutoff]}
    if boqs is not None:
        filters["boq"] = ["in", list(boqs) or [""]]
    runs = frappe.get_all(MATCH_DOCTYPE, filters=filters, fields=["name", "boq", "sheet_name", "job_id"],
                          order_by="name asc")
    if not runs:
        return []
    live = _live_match_jobs()
    if live is None:
        return []
    live_ids, live_keys = live
    healed = []
    for run in runs:
        if (run.job_id and create_job_id(run.job_id) in live_ids) or (run.boq, run.sheet_name) in live_keys:
            continue
        # Re-read inside the row lock and refuse any from-status but a live one: the worker may have finished it
        # between the query above and here (CODING_STANDARDS § Status transitions).
        row = frappe.db.sql(
            f'select status, halt_reason from "tab{MATCH_DOCTYPE}" where name = %s for update', (run.name,)
        )
        if not row or row[0][0] not in LIVE:
            frappe.db.rollback()
            continue
        reason = f"{row[0][1]}\n{REASON}" if row[0][1] else REASON
        # set_value skips doc_events; this doctype has none, and update_modified=False keeps `modified` meaning
        # "the last status change the worker made".
        frappe.db.set_value(MATCH_DOCTYPE, run.name, {"status": "halted", "halt_reason": reason},
                            update_modified=False)
        frappe.db.commit()
        healed.append(run.name)
    if healed:
        logger = frappe.logger("nirmaan_match_healer", allow_site=True)
        logger.setLevel(logging.INFO)
        logger.info(f"healed {len(healed)}: {healed}")
    return healed
