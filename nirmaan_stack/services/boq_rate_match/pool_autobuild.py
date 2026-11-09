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
rebuild job is neither queued nor running, it enqueues ONE `pool.rebuild_pool` on `long`, with the 06:00 job's timeout
and FIXED job id (rate_match.daily_pool_rebuild's), deduplicated - so the 06:00 job and this check can never queue two
builds - and logs one line. It never fires while a usable pool exists, stale or not: a stale pool waits for 06:00 (B8,
unchanged). A user's run still never builds or queues (match_run.job_pool, unchanged). Nothing is written to the
database; no doctype, setting or migrate.

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
    from frappe.utils.background_jobs import is_job_enqueued

    from nirmaan_stack.api.boq.rate_match import POOL_REBUILD_TIMEOUT_SEC
    from nirmaan_stack.services.boq_rate_match import pool as P

    path = P.pool_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)       # a deploy removes the folder too; the lock file lives in it
    try:
        with FileLock(path + ".lock", timeout=0):
            why = why_unusable(path)
    except Timeout:
        return {"queued": False, "why": "a pool build is running"}
    if why is None:
        return {"queued": False, "why": None}
    if is_job_enqueued(REBUILD_JOB_ID):
        return {"queued": False, "why": f"{why}; the rebuild is already queued"}
    frappe.enqueue(REBUILD_METHOD, queue=REBUILD_QUEUE, timeout=POOL_REBUILD_TIMEOUT_SEC, job_id=REBUILD_JOB_ID,
                   deduplicate=True)
    frappe.logger("boq_rate_match").info("match pool auto-build: %s -> pool.rebuild_pool queued (job %s)", why, REBUILD_JOB_ID)
    return {"queued": True, "why": why}
