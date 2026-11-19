# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The "already running?" marker of a background operation (spec #1654, #1660).

Classify, rate suggest, rate match and hub parse each keep a marker that says one operation is queued or running for
its sheet (hub parse: its BoQ, in DB columns, so only the first and last rules below concern it):

* The marker is claimed, set only when absent, BEFORE the operation is queued, so two start requests that both read
  "no marker" cannot both queue (`claim`; hub parse claims its BoQ row the same way). A start whose queue call fails
  ends its background operation failed; its marker then names an RQ job that was never queued, which the next start
  heals after ENQUEUE_GRACE_SEC (below).
* Two readers that both judge one marker stale must not both clear it: the second would clear the first's new
  claim. `heal` deletes a stale marker only while it still holds the value that was read (compare-and-delete).
* The claim's key expires after CLAIM_TTL_SEC, a day: rq keeps a queued job until a worker takes it, so the marker
  must outlast any queue wait (#1660 review). Staleness is judged by `job_state`, not by the expiry, which only
  removes markers nothing reads again. Once running, a flow's progress writes set its own, shorter TTL.
* Staleness counts from when the operation started running, not from when it was queued (`job_state`). rq stamps the
  job's `started_at` when a worker takes it, so an operation waiting behind others is never judged stale, however
  long it waits. A marker whose RQ job rq does not know (lost, or its queue call never came) is cleared once it is older
  than ENQUEUE_GRACE_SEC: the claim and the queue call are consecutive steps of one request, so a younger marker may be
  one whose RQ job is about to be queued.
"""

import datetime
import pickle

from redis.exceptions import WatchError

import frappe

ENQUEUE_GRACE_SEC = 30
CLAIM_TTL_SEC = 24 * 3600
_ENDED = frozenset({"finished", "failed", "stopped", "canceled"})


def claim(key, value) -> bool:
    """Set the cache value `key` only when it is absent (Redis SET NX), as frappe.cache().set_value stores it, for
    CLAIM_TTL_SEC. True when this call set it."""
    cache = frappe.cache()
    made = cache.make_key(key)
    frappe.local.cache.pop(made, None)
    return bool(cache.set(made, pickle.dumps(value), nx=True, ex=CLAIM_TTL_SEC))


def heal(key, marker, stale_seconds) -> str:
    """`job_state` of the `marker` read from cache `key`; unless it is 'running', delete the marker, but only if `key`
    still holds `marker`: another start may have healed it and claimed `key` since it was read."""
    state = job_state(marker.get("job_id"), marker.get("enqueued_at"), stale_seconds)
    if state != "running":
        _delete_if_unchanged(key, marker)
    return state


def release(key, job_id):
    """Delete the marker at `key` when its operation ends, but only while it still names `job_id`: a duplicate that
    ends late must not free the sheet for a run it does not own (spec #1654, story 6)."""
    frappe.local.cache.pop(frappe.cache().make_key(key), None)  # read Redis, not this process's copy
    marker = frappe.cache().get_value(key)
    if marker and marker.get("job_id") == job_id:
        _delete_if_unchanged(key, marker)


def release_own(key):
    """`release` the marker at `key` for the background operation this worker runs (`frappe.local.background_op_id`;
    nothing outside one). The `finally` of each flow's work."""
    op_id = getattr(frappe.local, "background_op_id", None)
    if op_id:
        release(key, op_id)


def _delete_if_unchanged(key, marker):
    cache = frappe.cache()
    made = cache.make_key(key)
    frappe.local.cache.pop(made, None)
    with cache.pipeline() as pipe:
        try:
            pipe.watch(made)
            raw = pipe.get(made)
            if raw is None or pickle.loads(raw) != marker:
                return
            pipe.multi()
            pipe.delete(made)
            pipe.execute()
        except WatchError:  # written between the read and the delete: no longer the marker that was judged
            pass


def job_state(job_id, marked_at, stale_seconds) -> str:
    """'running' | 'cleared' | 'cleared_stale' for a marker naming raw rq `job_id`, set at `marked_at`.

    cleared        rq has ended the RQ job, or does not know it and the marker is past ENQUEUE_GRACE_SEC
    cleared_stale  the RQ job has been running for more than `stale_seconds` since it started
    running        otherwise: waiting in the queue, running inside the window, or about to be queued
    """
    from frappe.utils import background_jobs

    job = status = None
    if job_id:
        try:
            job = background_jobs.get_job(job_id)
            status = job and job.get_status()
        except Exception:  # noqa: BLE001 -- an unreadable queue reads as an RQ job rq does not know
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
