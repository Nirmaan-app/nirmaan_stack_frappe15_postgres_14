# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt
"""THE POOL AUTO-BUILD AFTER A DEPLOY (DEV2-B9; owner 2026-11-10 "Auto-build after deploy"; on what the 2.11.56 deploy
lost: "It was the pool file").

WHY. Production's deploy routine removes the sites volume and restores the database and files from backup; the pool
file (private/boq_rate_match/match_pool_v<FORMAT>.pkl) is not restored. Under POOL ONLY AT 06:00 (DEV2-B8) a user's run
never builds, so until the next 06:00 every match row said "Earlier BoQs are being prepared" (Abhishek rebuilt it by
hand on 2026-11-07).

    autobuild_pool() -> {"queued": bool, "why": str | None}

THE CHECK, every 5 minutes: when there is NO USABLE pool file (missing, unreadable, or another format - exactly what
match_run.job_pool refuses) AND no build is running (the build lock, the same FileLock rebuild_pool holds) AND the
rebuild job is neither queued nor running AND its last failure is older than this try's wait (RETRY_WAITS_SEC), it
enqueues ONE `pool.rebuild_pool` on `long`, with the 06:00 job's timeout and FIXED job id
(rate_match.daily_pool_rebuild's), deduplicated - so the 06:00 job and this check can never queue two builds - and
logs one line.

RETRIES (PR #1681 review F1; Nitesh 2026-11-10 "the pool should exist in production"). A build that fails leaves no
file, so the check keeps retrying until a file is usable, but waits longer after each failure: 10 min, 30 min, 1 h,
2 h, then every 6 h. A one-off failure (a timeout behind other jobs, a DB blip) is retried within minutes; a failure
that repeats (a data error) costs at most 4 tries a day after the first 4, instead of one every 5 minutes, each of
which holds production's one worker for up to the 3600 s timeout and writes an Error Log. The failure time is RQ's
own record of the fixed job id (a failed job stays 7 days; RQ stamps ended_at on every failure path), so a failed
06:00 build also counts; the try count is a cache key, cleared as soon as a usable file is seen.

It never fires while a usable pool exists, stale or not: a stale pool waits for 06:00 (B8, unchanged). A user's run
still never builds or queues (match_run.job_pool, unchanged). Nothing is written to the database; no doctype, setting
or migrate.

WHO RUNS IT (owner answer 3 to B9-Q2, "H"): the existing 5-minute match healer
(tasks/match_run_healer.heal_stale_match_runs) calls it after its own work on each scheduled run; a failure on either
side never stops the other. A NEW hooks.py cron line would run only after a `bench migrate` (Frappe makes a Scheduled
Job Type row from hooks.py only in sync_jobs, at migrate or install); the healer is already a registered job.

COST. An existing file is proved readable once per file: the full load runs only when the file's (size, mtime) differs
from the last one proved (remembered in the cache for two days); every other check is a stat and a lock probe.
"""
import os

import frappe
from filelock import FileLock, Timeout

REBUILD_METHOD = "nirmaan_stack.services.boq_rate_match.pool.rebuild_pool"
REBUILD_JOB_ID = "boq_match_pool_daily_rebuild"     # rate_match.daily_pool_rebuild's fixed id (pinned equal by test)
REBUILD_QUEUE = "long"
RETRY_WAITS_SEC = (10 * 60, 30 * 60, 3600, 2 * 3600, 6 * 3600)   # wait after failed try 1, 2, 3, 4, 5 and later
_TRIES_KEY = "boq_match_pool_autobuild_tries"
_TRIES_TTL_SEC = 7 * 86400
_MEMO_KEY = "boq_match_pool_file_proved"
_MEMO_TTL_SEC = 2 * 86400


def _memo_get():
    return frappe.cache().get_value(_MEMO_KEY)


def _memo_set(value):
    frappe.cache().set_value(_MEMO_KEY, value, expires_in_sec=_MEMO_TTL_SEC)


def why_unusable(path):
    """None when `path` holds a usable pool file (stale or not), else the reason - match_run.job_pool's test."""
    from nirmaan_stack.services.boq_rate_match import pool as P

    try:
        st = os.stat(path)
    except OSError:
        return "no pool file"
    sig = f"{path}|{st.st_size}|{st.st_mtime_ns}"
    if _memo_get() == sig:
        return None
    try:
        fmt = getattr(P.load_pool(path), "format", None)
    except Exception as exc:  # noqa: BLE001 -- an unreadable file is rebuilt, never used
        return f"the pool file cannot be read ({type(exc).__name__})"
    if fmt != P.POOL_FORMAT:
        return f"the pool file is in another format ({fmt})"
    _memo_set(sig)
    return None


def autobuild_pool():
    """The 5-minute check (above). -> {"queued", "why"}."""
    from frappe.utils.background_jobs import get_job
    from rq.job import JobStatus
    from rq.utils import utcnow

    from nirmaan_stack.api.boq.rate_match import POOL_REBUILD_TIMEOUT_SEC
    from nirmaan_stack.services.boq_rate_match import pool as P

    path = P.pool_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)       # a deploy removes the folder too; the lock file lives in it
    try:
        with FileLock(path + ".lock", timeout=0):
            why = why_unusable(path)
    except Timeout:
        return {"queued": False, "why": "a pool build is running"}
    cache = frappe.cache()
    tries = int(cache.get_value(_TRIES_KEY, expires=True) or 0)
    if why is None:
        if tries:
            cache.delete_value(_TRIES_KEY)
        return {"queued": False, "why": None}
    job = get_job(REBUILD_JOB_ID)
    status = job.get_status() if job else None
    if status in (JobStatus.QUEUED, JobStatus.STARTED):
        return {"queued": False, "why": f"{why}; the rebuild is already queued"}
    if status == JobStatus.FAILED:
        ago = (utcnow() - (job.ended_at or job.enqueued_at)).total_seconds()
        wait = RETRY_WAITS_SEC[min(max(tries, 1), len(RETRY_WAITS_SEC)) - 1]
        if ago < wait:
            return {"queued": False, "why": f"{why}; the last build failed {int(ago // 60)} min ago, "
                                             f"next try {int(wait // 60)} min after it"}
    frappe.enqueue(REBUILD_METHOD, queue=REBUILD_QUEUE, timeout=POOL_REBUILD_TIMEOUT_SEC, job_id=REBUILD_JOB_ID,
                   deduplicate=True)
    cache.set_value(_TRIES_KEY, tries + 1, expires_in_sec=_TRIES_TTL_SEC)
    frappe.logger("boq_rate_match").info("match pool auto-build: %s -> pool.rebuild_pool queued (job %s)", why, REBUILD_JOB_ID)
    return {"queued": True, "why": why}
