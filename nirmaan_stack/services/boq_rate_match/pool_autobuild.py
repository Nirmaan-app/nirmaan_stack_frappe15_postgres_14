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
which holds one of production's N `long` workers for up to the 3600 s timeout and writes an Error Log. The failure
time is RQ's own record of the fixed job id (a failed job stays 7 days; RQ stamps ended_at on every failure path), so
a failed 06:00 build also counts; the try count is a cache key, cleared as soon as a usable file is seen.

It never fires while a usable pool exists, stale or not: a stale pool waits for 06:00 (B8, unchanged). A user's run
still never builds or queues (match_run.job_pool, unchanged). Nothing is written to the database; no doctype, setting
or migrate.

WHO RUNS IT (owner answer 3 to B9-Q2, "H"): the existing 5-minute match healer
(tasks/match_run_healer.heal_stale_match_runs) calls it after its own work on each scheduled run; a failure on either
side never stops the other. A NEW hooks.py cron line would run only after a `bench migrate` (Frappe makes a Scheduled
Job Type row from hooks.py only in sync_jobs, at migrate or install); the healer is already a registered job.

COST. An existing file is proved readable once per file: the full load runs only when the file's (size, mtime) differs
from the last one proved (remembered in the cache for two days); every other check is a stat and a lock probe.

THE MIGRATE GATE (#1741; owner 2026-11-25 "go"). On the 2026-11-24 deploy the scheduler ran while `bench restore` was
still loading (the dump's tabSingles carries enable_scheduler=1); this check saw "no pool file" and queued a build,
whose read locks on `tabBoQ Row Category` held the restore's ADD PRIMARY KEY for 16 minutes. So no pool build is
queued or run until a migrate has finished on THIS database:

    site_ready() -> None, or why not

The MIGRATE MARK, `migrated.json` beside the pool file, holds the Postgres oid of the database the last migrate finished
on. A restore drops and recreates the database, so its oid always changes and an old mark stops matching (a flag
inside the database would arrive from the backup already set). A missing, unreadable or foreign mark, or an oid that
cannot be read, is a refusal; so is the "migrating" mark `before_migrate()` writes at the start of every migrate, so a
migrate on a database that already holds a matching mark closes the gate too, and a failed one leaves it closed.
`after_migrate()` (the last `hooks.after_migrate` entry) writes the oid mark once post_schema_updates commits, then
queues the first build through the check above: never on a dev site
(`nirmaan_env == "dev"`), and only when the `long` queue's Redis answers. With Redis down, frappe.enqueue inside a
migrate runs the job INLINE (frappe/utils/background_jobs.py, in_migrate), so it is not called then, and the call is
made with in_migrate cleared so a Redis that drops after the ping raises instead. The 06:00 job
(rate_match.daily_pool_rebuild) and the job body (pool.rebuild_pool) refuse the same way; the manual `bench execute`
path passes force=True.
"""
import contextlib
import json
import logging
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
MARK_NAME = "migrated.json"


def logger():
    """The `boq_rate_match` logger at INFO: Frappe's default off the dev server is ERROR (frappe/utils/logger.py), which
    drops every build and gate line."""
    lg = frappe.logger("boq_rate_match")
    lg.setLevel(logging.INFO)
    return lg


# ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
# THE MIGRATE GATE
# ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
def mark_path():
    from nirmaan_stack.services.boq_rate_match import pool as P
    return os.path.join(os.path.dirname(P.pool_path()), MARK_NAME)


def _live_oid():
    return int(frappe.db.sql("select oid from pg_database where datname = current_database()")[0][0])


def site_ready():
    """None only when the migrate mark holds the live database's oid; else why not. Any read error is a refusal."""
    try:
        with open(mark_path(), encoding="utf-8") as f:
            mark = json.load(f)
    except FileNotFoundError:
        return "no migrate has finished on this database (no migrate mark)"
    except Exception as exc:  # noqa: BLE001 -- a refusal, never a build
        return f"the migrate mark cannot be read ({type(exc).__name__})"
    mark = mark if isinstance(mark, dict) else {}
    if mark.get("migrating"):
        return "a migrate is running on this database"
    try:
        oid = _live_oid()
    except Exception as exc:  # noqa: BLE001 -- a refusal, never a build
        return f"the database oid cannot be read ({type(exc).__name__})"
    marked = mark.get("oid")
    if marked != oid:
        return f"the migrate mark is for another database (mark oid {marked}, live oid {oid}): no migrate since the restore"
    return None


def write_mark():
    """The mark for the live database, written to a temp name and renamed."""
    _write_mark_json({"oid": _live_oid()})


def _write_mark_json(mark):
    mark = {**mark, "at": str(frappe.utils.now_datetime())}
    path = mark_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = f"{path}.{os.getpid()}.tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(mark, f)
    os.replace(tmp, path)


def before_migrate():
    """hooks.before_migrate: close the gate for the length of the migrate. A migrate on a database that already holds a
    matching mark (no restore) would otherwise leave builds free to start against a half-applied schema;
    `_after_migrate_committed` opens it again. A migrate that fails leaves it closed until one succeeds. Never raises."""
    try:
        _write_mark_json({"migrating": True})
    except Exception:  # noqa: BLE001 -- the migrate must not fail on the gate
        logger().exception("match pool gate: the migrating mark could not be written")


def _long_queue_answers():
    try:
        from frappe.utils.background_jobs import get_queue
        return bool(get_queue(REBUILD_QUEUE).connection.ping())
    except Exception:  # noqa: BLE001 -- down or unreachable: never enqueue
        return False


@contextlib.contextmanager
def _outside_migrate():
    """frappe.enqueue runs the job inline when Redis fails inside a migrate; outside one it raises."""
    flags = frappe.local.flags
    old = flags.in_migrate
    flags.in_migrate = False
    try:
        yield
    finally:
        flags.in_migrate = old


def after_migrate():
    """hooks.after_migrate (last entry): the real work waits for post_schema_updates' commit. Never raises."""
    try:
        frappe.db.after_commit.add(_after_migrate_committed)
    except Exception:  # noqa: BLE001
        logger().exception("match pool gate: could not register the after-migrate step")


def _after_migrate_committed():
    """Write the migrate mark; then, on a non-dev site with the long queue's Redis up, run the auto-build check (which
    queues one build when there is no usable pool file). Never raises."""
    try:
        write_mark()
    except Exception:  # noqa: BLE001
        logger().exception("match pool gate: the migrate mark could not be written; no build is queued")
        return
    try:
        if frappe.conf.get("nirmaan_env") == "dev":
            why = "a dev site: no build after migrate"
        elif not _long_queue_answers():
            why = f"the {REBUILD_QUEUE} queue's Redis does not answer: no build after migrate (the 5-minute check queues it)"
        else:
            with _outside_migrate():
                out = autobuild_pool()
            why = f"auto-build check: {out}"
        logger().info("match pool gate: migrate mark written; %s", why)
        print(f"match pool gate: migrate mark written; {why}")
    except Exception:  # noqa: BLE001
        logger().exception("match pool gate: the after-migrate auto-build check failed")


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

    not_ready = site_ready()
    if not_ready is not None:
        logger().info("match pool auto-build: not queued: %s", not_ready)
        return {"queued": False, "why": not_ready}
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
    logger().info("match pool auto-build: %s -> pool.rebuild_pool queued (job %s)", why, REBUILD_JOB_ID)
    return {"queued": True, "why": why}
