"""Background operations (ADR 0047): one status record per operation, read by the screen that started it.

A screen follows a background operation by reading its **status record**, never by trusting a live message:

    start(kind, method, op_id=..., timeout=..., **kwargs)   write the queued record, queue the wrapper
    api/background_ops.get_status(op_id)                    the owner reads the record
    api/background_ops.collect_result(op_id)                the owner collects the finished file

The record lives in the cache Redis for 24 hours, as JSON:

    {op_id, owner, kind, state, enqueued_at, started_at, ended_at, timeout, rq_job_id, progress, result, error}
    state: queued -> running -> finished | failed | lost

Every change of a record is a compare-and-set (`_transition`), so a worker and a poll racing on one record never
undo each other:

    queued  -> running             only the worker's `run`, only from queued: one delivery runs the work
    running -> running (progress)  only while running: a progress write never revives a lost operation
    queued | running -> lost       a poll's verdict (a stale heartbeat or a missing job); a guess
    queued | running | lost -> finished | failed   the worker's (or the start's) outcome, which is the truth
    finished | failed              final: nothing replaces them

Only its owner (the user who started it) reads it. The browser makes the id of an operation a screen starts.
"""

import contextlib
import datetime
import json
import logging
import os
import re
import resource
import time

from rq.exceptions import NoSuchJobError
from rq.job import Job, JobStatus
from rq.timeouts import JobTimeoutException

import frappe
from frappe.utils import strip_html
from frappe.utils.background_jobs import create_job_id, get_redis_conn

#: How long a record (and its finished file) waits to be read.
KEEP_SECONDS = 24 * 60 * 60

QUEUED, RUNNING, FINISHED, FAILED, LOST = "queued", "running", "finished", "failed", "lost"

#: The socket message that tells a screen to read an operation's record now.
READ_NOW_EVENT = "background_op:read_now"
READ_NOW_EVERY_SECONDS = 2

#: Where finished files wait for their owner: private, and never under `private/files`, which Frappe serves.
_FILE_DIR = ("private", "background_ops")

#: RQ heartbeats a busy worker every 30 s with a 60 s grace (rq/worker.py `get_heartbeat_ttl`).
HEARTBEAT_STALE_SECONDS = 90

_WORKER_GONE = "The server stopped while running this operation. Please try again."
_NO_RECORD = "The server has no record of this operation. It may have expired; please start it again."

#: What the browser's `crypto.randomUUID()` makes: a lowercase UUID.
_OP_ID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")


def start(kind, method, *, op_id, timeout, queue="long", one_per_user=None, **kwargs):
    """Write the operation's queued record, then queue `method(**kwargs)` under the wrapper `run`.

    `kind` names the flow in the log line. `method` is the work, a dotted path; it runs as the owner, and what it
    returns (JSON) becomes the record's `result`. `timeout` is its time limit in seconds, counted from when it
    starts running.

    The operation is queued once the caller's transaction commits (CODING_STANDARDS.md § Queuing a background job):
    the work must find the caller's writes. A whitelisted POST commits at the end of the request; a caller that
    rolls back instead queues nothing, and the record reads as failed.

    The same user starting the same id again gets the existing record back and nothing is queued again; an id
    another user already used is refused. Returns the record as its owner reads it.

    `one_per_user`: the owner may have only ONE operation of this `kind` queued or running at a time, so one user
    cannot hold every worker. The value is the sentence that names THIS operation to its owner while it is ("Your
    handover binder for <project> is still being prepared. ..."); a second start of the kind is refused with the
    running one's sentence (`_take_slot`) before anything is set to queue, and the refused operation's record ends
    failed with that sentence as its error.
    """
    _check_op_id(op_id)
    owner = frappe.session.user
    record = {
        "op_id": op_id,
        "owner": owner,
        "kind": kind,
        "state": QUEUED,
        "enqueued_at": time.time(),
        "started_at": None,
        "ended_at": None,
        "timeout": timeout,
        "rq_job_id": create_job_id(op_id),
        "progress": None,
        "result": None,
        "error": None,
        "busy_message": one_per_user,
    }
    # Set only if absent: of two starts with one id, exactly one writes the record and queues.
    if not frappe.cache().set(_key(op_id), json.dumps(record), ex=KEEP_SECONDS, nx=True):
        existing = started_before(op_id)
        if not existing:  # the record expired between the two calls: the id is not the caller's to reuse
            frappe.throw("This operation id is already in use.", frappe.PermissionError)
        return existing

    # Before the queueing is registered: a refused start never queues, even for a caller that catches the
    # refusal and commits. Its record ends failed in the running one's words, for a screen that reloads it.
    if one_per_user:
        running = _take_slot(kind, owner, op_id)
        if running:
            busy = running.get("busy_message") or one_per_user
            _end(op_id, FAILED, error=busy)
            frappe.throw(busy, title="Already in progress")

    def enqueue():
        try:
            frappe.enqueue(
                "nirmaan_stack.services.background_ops.run",
                queue=queue,
                timeout=timeout,
                job_id=op_id,  # frappe.enqueue's own parameter: the RQ job id is `rq_job_id`
                op_id=op_id,
                work=method,
                work_kwargs=kwargs,
            )
        except Exception:
            frappe.log_error(title=f"Background operation {kind} could not be queued")
            _end(op_id, FAILED, error="The server could not queue this operation. Please try again.")

    frappe.db.after_commit.add(enqueue)
    frappe.db.after_rollback.add(
        lambda: _end(op_id, FAILED, error="The request that started this operation failed, so it was not queued.")
    )
    return public(record)


def _slot_key(kind, owner):
    return frappe.cache().make_key(f"background_op_slot:{kind}:{owner}")


def _take_slot(kind, owner, op_id):
    """Make `op_id` the owner's one operation of `kind`. Returns None when it took the slot -- free, already held by
    `op_id`, or held by an operation that has ended (finished, failed, lost or expired), so however an operation
    ends its owner is free again, with no lock for a dead worker to leave behind -- else the record of the operation
    still queued or running. A compare-and-set on the slot: of two starts racing, one takes it.
    """
    key = _slot_key(kind, owner)
    outcome = {}

    def attempt(pipe):
        outcome.clear()
        raw = pipe.get(key)
        holder = raw.decode() if isinstance(raw, bytes) else raw
        if holder and holder != op_id:
            record = _read(holder)
            if record and status(holder)["state"] in (QUEUED, RUNNING):
                outcome["running"] = record
                return
        pipe.multi()
        pipe.set(key, op_id, ex=KEEP_SECONDS)

    frappe.cache().transaction(attempt, key)
    return outcome.get("running")


def started_before(op_id):
    """The caller's earlier start of this id, as `start` returns it, or None when the id is unused.

    The same refusals as `start`, made without starting anything: a malformed id, and an id another user used. For
    an endpoint that must do work no rollback undoes (`services/stored_files.store_file`) before it calls `start`:
    it checks the id first, and returns the earlier start on a repeat instead of doing that work again.
    """
    _check_op_id(op_id)
    record = _read(op_id)
    if record and record["owner"] != frappe.session.user:
        frappe.throw("This operation id is already in use.", frappe.PermissionError)
    return public(record) if record else None


def run(op_id, work, work_kwargs):
    """The wrapper a worker runs: running, the work as its owner, the work's commit, then finished or failed.

    "Finished" is written only after the work's own commit, so a screen that reads it finds the work's writes saved.
    A refusal the user can act on (`frappe.throw`) fails the operation in its own words; anything else is logged
    and fails it with a plain message. The exception is not raised on: the record, not RQ, says how it ended.
    """
    _, record = _transition(op_id, (QUEUED,), lambda _: {"state": RUNNING, "started_at": time.time()})
    if not record:
        return  # another delivery of this job got it, or a poll already called it lost
    frappe.set_user(record["owner"])
    _read_now(record)
    frappe.local.background_op_id = op_id
    frappe.local.background_op_file = None
    try:
        result = frappe.get_attr(work)(**work_kwargs)
        frappe.db.commit()
        if frappe.local.background_op_file:
            result = {**(result or {}), "file": frappe.local.background_op_file}
    except Exception as e:
        frappe.db.rollback()
        _end(op_id, FAILED, error=_error_text(e, record["kind"]), peak_memory_mb=_peak_memory_mb())
        return
    finally:
        frappe.local.background_op_id = None
    _end(op_id, FINISHED, result=result, peak_memory_mb=_peak_memory_mb())


def queued_work(job_kwargs):
    """(dotted work method, its kwargs) of a job on a Frappe queue, from the job's own kwargs: an operation's work is
    inside this module's wrapper `run`, any other job is its method itself. For a reader that looks for a flow's live
    jobs on the queues (tasks/suggest_run_healer, tasks/match_run_healer; #1667)."""
    method = job_kwargs.get("method")
    if not isinstance(method, str):
        method = f"{getattr(method, '__module__', '')}.{getattr(method, '__name__', '')}"
    inner = job_kwargs.get("kwargs") or {}
    if method == f"{__name__}.run":
        return inner.get("work"), inner.get("work_kwargs") or {}
    return method, inner


def _peak_memory_mb():
    """The peak memory of the process that ran the work: the worker's work horse (Linux reports KB)."""
    return round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024)


def set_progress(percent, message=None, detail=None):
    """Record the work's progress, from inside the work. Every change is in the record at once; the owner is told
    to read it now at most every READ_NOW_EVERY_SECONDS while it changes (the screen polls in between).

    `detail` is the flow's own JSON (counts, the item in hand) for a screen that shows more than a bar."""
    op_id = getattr(frappe.local, "background_op_id", None)
    if not op_id:
        return
    progress = {"percent": int(percent), "message": message}
    if detail is not None:
        progress["detail"] = detail
    _, record = _transition(op_id, (RUNNING,), lambda r: None if r["progress"] == progress else {"progress": progress})
    if not record:
        return
    if time.time() - getattr(frappe.local, "background_op_read_now_at", 0) >= READ_NOW_EVERY_SECONDS:
        _read_now(record)


def set_row_progress(done, total, **detail):
    """`set_progress` for work that counts rows: the percent of `total` done, "<done> of <total> rows", and
    detail {done, total, **detail} for the screen's bar."""
    done, total = int(done), int(total or 0)
    percent = round(done * 100 / total) if total else 0
    set_progress(percent, f"{done} of {total} rows", detail={"done": done, "total": total, **detail})


def _read_now(record):
    """Tell the owner's screens to read this operation's record now. The message carries only the id: a screen
    never takes a result from it, so a lost message costs only a poll's delay."""
    frappe.publish_realtime(READ_NOW_EVENT, {"op_id": record["op_id"]}, user=record["owner"], after_commit=False)
    frappe.local.background_op_read_now_at = time.time()


def write_result_file(content, filename):
    """Keep the operation's finished file for its owner, from inside the work (one file per operation).

    A plain file in a private site folder that no web server serves, as snag PDFs are kept, handed over only by
    `api/background_ops.collect_result` to the owner. Never a File (`services/stored_files.store_file`): its
    storage hook uploads the bytes to the bucket and removes the local copy. `filename` is what the owner's
    browser saves it as. Files older than KEEP_SECONDS are swept here first.
    """
    op_id = frappe.local.background_op_id
    if not op_id:
        frappe.throw("write_result_file runs only inside a background operation's work.")
    _sweep_old_files()
    path = result_file_path(op_id)
    with open(path, "wb") as f:
        f.write(content)
    frappe.local.background_op_file = {"filename": filename, "size_bytes": len(content)}


def result_file_path(op_id):
    """Where the operation's finished file is kept."""
    _check_op_id(op_id)
    folder = frappe.get_site_path(*_FILE_DIR)
    os.makedirs(folder, exist_ok=True)
    return os.path.join(folder, f"{op_id}.bin")


def collect(op_id):
    """The owner's finished file as `(content, filename)`. Refused for anyone else, and before it finishes.

    The file stays until the sweep, so a reload or a second tab of the owner can collect it again.
    """
    record = read_own(op_id)
    if not record or record["state"] != FINISHED or not (record["result"] or {}).get("file"):
        frappe.throw("This operation has no finished file to collect.", frappe.ValidationError)
    path = result_file_path(op_id)
    if not os.path.exists(path):
        frappe.throw("This file has expired. Please start the operation again.", frappe.ValidationError)
    with open(path, "rb") as f:
        return f.read(), record["result"]["file"]["filename"]


def _sweep_old_files():
    folder = frappe.get_site_path(*_FILE_DIR)
    if not os.path.isdir(folder):
        return
    cutoff = time.time() - KEEP_SECONDS
    for entry in os.scandir(folder):
        with contextlib.suppress(OSError):
            if entry.is_file() and entry.stat().st_mtime < cutoff:
                os.remove(entry.path)


def _error_text(e, kind):
    if isinstance(e, JobTimeoutException):
        return "This operation took longer than its time limit and was stopped."
    if isinstance(e, (frappe.ValidationError, frappe.PermissionError)):
        return strip_html(str(e)) or "The operation was refused."
    frappe.log_error(title=f"Background operation {kind} failed")
    return "The operation failed. The error has been logged."


def _end(op_id, state, *, error=None, result=None, peak_memory_mb=None):
    """End the operation `finished` or `failed`: the worker's outcome (or the start's, when it never queued).

    It replaces a `lost` verdict: lost is a poll's guess from a late heartbeat or a missing job, and the worker
    that writes here was alive after all, so its outcome is the truth and its file can be collected. Nothing
    replaces finished or failed.
    """
    before, record = _transition(
        op_id,
        (QUEUED, RUNNING, LOST),
        lambda _: {"state": state, "ended_at": time.time(), "error": error, "result": result},
    )
    if record:
        _read_now(record)
        _log(record, peak_memory_mb, replaces_lost=before["state"] == LOST)


def _end_lost(op_id, last_seen):
    """A poll's verdict that the operation's worker is gone. `last_seen` is the worker's last heartbeat (epoch), or
    None; it is the record's `ended_at`, since the work stopped then, not when the loss was noticed."""
    _, record = _transition(
        op_id, (QUEUED, RUNNING), lambda _: {"state": LOST, "ended_at": last_seen, "error": _WORKER_GONE}
    )
    if record:
        _read_now(record)
        _log(record, None)


def _log(record, peak_memory_mb, replaces_lost=False):
    """One line per ended operation in `logs/background_ops.log`: what sets the number of `long` workers.

    `frappe.logger` drops INFO unless the level says otherwise (WARNING in dev, ERROR in production), so the level
    is set on this logger every time. A lost operation's run time is unknown (`run_s` null): the time until the
    loss was noticed is not run time.

    A worker that ends an operation a poll had called lost writes a second line, marked `replaces_lost`. The lost
    line is kept, not rewritten: a log is append-only, and it records what the owner's screen was shown then.
    A reader counting outcomes takes the last line of each `op_id`.
    """
    started, ended = record["started_at"], record["ended_at"]
    line = {
        "op_id": record["op_id"],
        "kind": record["kind"],
        "outcome": record["state"],
        "queue_wait_s": round(started - record["enqueued_at"], 2) if started else None,
        "run_s": round(ended - started, 2) if started and ended and record["state"] != LOST else None,
        "peak_memory_mb": peak_memory_mb,
    }
    if replaces_lost:
        line["replaces_lost"] = True
    logger = frappe.logger("background_ops", allow_site=False)
    logger.setLevel(logging.INFO)
    logger.info(json.dumps(line))


def _worker_gone(record):
    """Has the operation's worker stopped without ending it? Returns (gone, last sign of life as epoch or None).

    RQ's job status is not the record's truth (it forgets a job 10 minutes after it ends), but while an operation
    has not ended, its job says whether a worker still holds it. A running job's worker heartbeats every 30 s; a
    heartbeat older than HEARTBEAT_STALE_SECONDS means the worker died. A queued operation's job can vanish too
    (a flushed queue); it is lost once the job has been missing that long.
    """
    try:
        job = Job.fetch(record["rq_job_id"], connection=get_redis_conn())
    except NoSuchJobError:
        job = None
    now = time.time()
    if job is None:
        if record["state"] == RUNNING:
            return True, None
        return now - record["enqueued_at"] > HEARTBEAT_STALE_SECONDS, None
    if job.get_status(refresh=False) in (JobStatus.FAILED, JobStatus.STOPPED, JobStatus.CANCELED):
        return True, None
    if record["state"] == RUNNING and job.last_heartbeat:
        beat = job.last_heartbeat.replace(tzinfo=datetime.timezone.utc).timestamp()
        return now - beat > HEARTBEAT_STALE_SECONDS, beat
    return False, None


def status(op_id):
    """What the owner reads: the record, plus the server's clock as `now`.

    A missing record reads as lost: it expired, was evicted or was never written, and nothing will write it again.
    """
    record = read_own(op_id)
    if not record:
        return {"op_id": op_id, "state": LOST, "error": _NO_RECORD, "now": time.time()}
    if record["state"] in (QUEUED, RUNNING):
        gone, last_seen = _worker_gone(record)
        if gone:
            _end_lost(op_id, last_seen)
            record = _read(op_id)
    return {**public(record), "now": time.time()}


def read_own(op_id):
    """The caller's own record, or None when there is none. Another user's record is refused."""
    _check_op_id(op_id)
    record = _read(op_id)
    if record and record["owner"] != frappe.session.user:
        frappe.throw("This operation belongs to another user.", frappe.PermissionError)
    return record


def public(record):
    """The record as its owner reads it: without the owner, the queue's own job id and the one-per-user sentence."""
    return {key: value for key, value in record.items() if key not in ("owner", "rq_job_id", "busy_message")}


def _check_op_id(op_id):
    if not isinstance(op_id, str) or not _OP_ID.fullmatch(op_id):
        frappe.throw("An operation id is a lowercase UUID.", frappe.ValidationError)


def _key(op_id):
    return frappe.cache().make_key(f"background_op:{op_id}")


def _read(op_id):
    raw = frappe.cache().get(_key(op_id))
    return json.loads(raw) if raw else None


def _transition(op_id, from_states, change):
    """Compare-and-set one record: when its state is one of `from_states`, merge in `change(record)`'s fields.

    WATCH/MULTI on the cache connection: if another process writes the record between this read and this write,
    the write is dropped and the whole step runs again on what that process wrote. `change` returns the fields to
    set, or None to leave the record as it is. Returns `(before, after)`, or `(before, None)` when nothing was
    written (no record, a state not in `from_states`, or `change` gave None).
    """
    key = _key(op_id)
    outcome = {}

    def attempt(pipe):
        outcome.clear()
        raw = pipe.get(key)
        record = json.loads(raw) if raw else None
        outcome["before"] = record
        fields = change(record) if record and record["state"] in from_states else None
        if fields is None:
            return
        after = {**record, **fields}
        pipe.multi()
        pipe.set(key, json.dumps(after, default=str), ex=KEEP_SECONDS)
        outcome["after"] = after

    frappe.cache().transaction(attempt, key)
    return outcome.get("before"), outcome.get("after")
