# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The "already running?" marker of a background operation (spec #1654, #1660).

Classify, rate suggest, rate match and hub parse each keep a marker that says one operation is queued or running for
its sheet (hub parse: its BoQ). Two rules hold for all four:

* The marker is claimed, set only when absent, BEFORE the operation is queued, so two start requests that both read
  "no marker" cannot both queue (`claim`; hub parse claims its BoQ row the same way). A start whose queue call fails
  removes its marker again.
* Staleness counts from when the operation started running, not from when it was queued (`job_state`). rq stamps the
  job's `started_at` when a worker takes it, so an operation waiting behind others is never judged stale, however
  long it waits. A marker whose job rq does not know (lost, or its queue call never came) is cleared once it is older
  than ENQUEUE_GRACE_SEC: the claim and the queue call are consecutive steps of one request, so a younger marker may be
  one whose job is about to be queued.
"""

import datetime
import pickle

import frappe

ENQUEUE_GRACE_SEC = 30
_ENDED = frozenset({"finished", "failed", "stopped", "canceled"})


def claim(key, value, expires_in_sec) -> bool:
    """Set the cache value `key` only when it is absent (Redis SET NX), as frappe.cache().set_value stores it.
    True when this call set it."""
    cache = frappe.cache()
    made = cache.make_key(key)
    frappe.local.cache.pop(made, None)
    return bool(cache.set(made, pickle.dumps(value), nx=True, ex=expires_in_sec))


def job_state(job_id, marked_at, stale_seconds) -> str:
    """'running' | 'cleared' | 'cleared_stale' for a marker naming raw rq `job_id`, set at `marked_at`.

    cleared        rq has ended the job, or does not know it and the marker is past ENQUEUE_GRACE_SEC
    cleared_stale  the job has been running for more than `stale_seconds` since it started
    running        otherwise: waiting in the queue, running inside the window, or about to be queued
    """
    from frappe.utils import background_jobs

    job = status = None
    if job_id:
        try:
            job = background_jobs.get_job(job_id)
            status = job and job.get_status()
        except Exception:  # noqa: BLE001 -- an unreadable queue reads as a job rq does not know
            job = None
    if job is None:
        return "running" if _age_seconds(marked_at) <= ENQUEUE_GRACE_SEC else "cleared"
    status = getattr(status, "value", status)
    if status in _ENDED:
        return "cleared"
    if status == "started" and job.started_at:
        if (datetime.datetime.utcnow() - job.started_at.replace(tzinfo=None)).total_seconds() > stale_seconds:
            return "cleared_stale"
    return "running"


def _age_seconds(marked_at):
    """Seconds since `marked_at` on the site clock; infinite when it is missing or unreadable."""
    if not marked_at:
        return float("inf")
    try:
        return frappe.utils.time_diff_in_seconds(frappe.utils.now(), marked_at)
    except Exception:  # noqa: BLE001
        return float("inf")
