"""Background operations (ADR 0047): one status record per operation, read by the screen that started it.

A screen follows a background operation by reading its **status record**, never by trusting a live message:

    start(kind, method, op_id=..., timeout=..., **kwargs)   write the queued record, queue the wrapper
    api/background_ops.get_status(op_id)                    the owner reads the record
    api/background_ops.collect_result(op_id)                the owner collects the finished file

The record lives in the cache Redis for 24 hours, as JSON:

    {op_id, owner, kind, state, enqueued_at, started_at, ended_at, timeout, rq_job_id, progress, result, error}
    state: queued -> running -> finished | failed | lost

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

import frappe
from frappe.utils import strip_html
from frappe.utils.background_jobs import create_job_id, get_redis_conn
from rq.exceptions import NoSuchJobError
from rq.job import Job, JobStatus
from rq.timeouts import JobTimeoutException

#: How long a record (and its finished file) waits to be read.
KEEP_SECONDS = 24 * 60 * 60

QUEUED, RUNNING, FINISHED, FAILED, LOST = "queued", "running", "finished", "failed", "lost"
TERMINAL = (FINISHED, FAILED, LOST)

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


def start(kind, method, *, op_id, timeout, queue="long", **kwargs):
    """Write the operation's queued record, then queue `method(**kwargs)` under the wrapper `run`.

    `kind` names the flow in the log line. `method` is the work, a dotted path; it runs as the owner, and what it
    returns (JSON) becomes the record's `result`. `timeout` is its time limit in seconds, counted from when it
    starts running.

    The operation is queued once the caller's transaction commits (CODING_STANDARDS.md § Queuing a background job):
    the work must find the caller's writes. A whitelisted POST commits at the end of the request; a caller that
    rolls back instead queues nothing, and the record reads as failed.

    The same user starting the same id again gets the existing record back and nothing is queued again; an id
    another user already used is refused. Returns the record as its owner reads it.
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
    }
    # Set only if absent: of two starts with one id, exactly one writes the record and queues.
    if not frappe.cache().set(_key(op_id), json.dumps(record), ex=KEEP_SECONDS, nx=True):
        existing = _read(op_id)
        if not existing or existing["owner"] != owner:
            frappe.throw("This operation id is already in use.", frappe.PermissionError)
        return public(existing)

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


def run(op_id, work, work_kwargs):
    """The wrapper a worker runs: running, the work as its owner, the work's commit, then finished or failed.

    "Finished" is written only after the work's own commit, so a screen that reads it finds the work's writes saved.
    A refusal the user can act on (`frappe.throw`) fails the operation in its own words; anything else is logged
    and fails it with a plain message. The exception is not raised on: the record, not RQ, says how it ended.
    """
    record = _read(op_id)
    if not record or record["state"] != QUEUED:
        return
    frappe.set_user(record["owner"])
    record.update(state=RUNNING, started_at=time.time())
    _write(record)
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


def _peak_memory_mb():
    """The peak memory of the process that ran the work: the worker's work horse (Linux reports KB)."""
    return round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024)


def set_progress(percent, message=None, detail=None):
    """Record the work's progress, from inside the work. Every change is in the record at once; the owner is told
    to read it now at most every READ_NOW_EVERY_SECONDS while it changes (the screen polls in between).

    `detail` is the flow's own JSON (counts, the item in hand) for a screen that shows more than a bar."""
    op_id = getattr(frappe.local, "background_op_id", None)
    record = _read(op_id) if op_id else None
    if not record:
        return
    progress = {"percent": int(percent), "message": message}
    if detail is not None:
        progress["detail"] = detail
    if record["progress"] == progress:
        return
    record["progress"] = progress
    _write(record)
    if time.time() - getattr(frappe.local, "background_op_read_now_at", 0) >= READ_NOW_EVERY_SECONDS:
        _read_now(record)


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


def _end(op_id, state, *, error=None, result=None, ended_at=None, peak_memory_mb=None):
    """Move a record that has not ended yet to `state`, write its log line, and tell its owner to read it.

    `ended_at` defaults to now; a lost operation passes its worker's last sign of life instead, or None.
    """
    record = _read(op_id)
    if not record or record["state"] in TERMINAL:
        return
    record.update(state=state, ended_at=time.time() if state != LOST else ended_at, error=error, result=result)
    _write(record)
    _read_now(record)
    _log(record, peak_memory_mb)


def _log(record, peak_memory_mb):
    """One line per ended operation in `logs/background_ops.log`: what sets the number of `long` workers.

    `frappe.logger` drops INFO unless the level says otherwise (WARNING in dev, ERROR in production), so the level
    is set on this logger every time. A lost operation's run time is unknown (`run_s` null): the time until the
    loss was noticed is not run time.
    """
    started, ended = record["started_at"], record["ended_at"]
    logger = frappe.logger("background_ops", allow_site=False)
    logger.setLevel(logging.INFO)
    logger.info(json.dumps({
        "op_id": record["op_id"],
        "kind": record["kind"],
        "outcome": record["state"],
        "queue_wait_s": round(started - record["enqueued_at"], 2) if started else None,
        "run_s": round(ended - started, 2) if started and ended and record["state"] != LOST else None,
        "peak_memory_mb": peak_memory_mb,
    }))


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
            _end(op_id, LOST, error=_WORKER_GONE, ended_at=last_seen)
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
    """The record as its owner reads it: without the owner and the queue's own job id."""
    return {key: value for key, value in record.items() if key not in ("owner", "rq_job_id")}


def _check_op_id(op_id):
    if not isinstance(op_id, str) or not _OP_ID.fullmatch(op_id):
        frappe.throw("An operation id is a lowercase UUID.", frappe.ValidationError)


def _key(op_id):
    return frappe.cache().make_key(f"background_op:{op_id}")


def _read(op_id):
    raw = frappe.cache().get(_key(op_id))
    return json.loads(raw) if raw else None


def _write(record):
    frappe.cache().set(_key(record["op_id"]), json.dumps(record, default=str), ex=KEEP_SECONDS)
