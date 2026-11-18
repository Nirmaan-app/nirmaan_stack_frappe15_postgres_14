# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The per-series lock for operations that take a counted name users see (ADR 0048, #1659).

Every connection runs at REPEATABLE READ, and a counted name is taken from one `tabSeries` row under
`SELECT ... FOR UPDATE`: a transaction whose snapshot is older than another's commit on that row fails with
`SerializationFailure`, however late it asks for its number. BoQ numbers (`BOQ-.YY.-.#####`) keep their counter
because users see them, so the operations that create BoQs hold `series_lock` instead, for the length of the
operation.

The lock is a session-level advisory lock, taken between two commits: the commit before it ends whatever the
caller had open (its old snapshot, and its writes: from a worker or the browser that is nothing), and the commit
after it makes the next statement start a fresh snapshot, which holds everything the previous holder committed. A
lock taken inside the transaction does not work: the snapshot is already taken (ADR 0048, 0 of 10). The holder
commits before it unlocks, so the next holder sees its rows; a failure rolls back first, so the unlock runs on a
usable transaction. A worker that dies drops its connection, and Postgres drops its session locks with it.

With N workers, up to N-1 operations that create BoQs wait here, each holding a worker. A web request waits at most
its `wait_s` (an upload holds the lock for its whole run), then is refused. Each wait that is granted is recorded in
`recent_waits()` (the last 500, in the cache): the N-worker check reports the longest.
"""

import json
import time
from contextlib import contextmanager

import frappe

WAITS_KEY = "series_lock_waits"
_KEEP_WAITS = 500


def boq_series() -> str:
    """The BoQ number's series, as its doctype names it (`BOQ-.YY.-.#####`)."""
    return frappe.get_meta("BOQs").autoname


class SeriesBusy(Exception):
    """The series lock was not granted within the caller's `wait_s`."""


@contextmanager
def series_lock(series: str, wait_s: int | None = None):
    """Hold `series`'s lock for the `with` block, inside a transaction that started after it was granted. Commits on
    a clean exit and rolls back on an exception, both before unlocking.

    `wait_s`: wait at most this long for the lock, then raise SeriesBusy (a web request: an upload holds the lock
    for its whole run, longer than a request may wait). None waits without limit (a worker).

    ⚠️ Commits the caller's open transaction first."""
    key = f"naming_series:{series}"
    held = False
    frappe.db.commit()
    try:
        _lock(key, wait_s)
        held = True
        frappe.db.commit()
        yield
        frappe.db.commit()
    except BaseException:
        frappe.db.rollback()
        raise
    finally:
        if held:
            try:  # a dead connection has dropped the lock already; never hide the original exception
                frappe.db.sql("SELECT pg_advisory_unlock(hashtext(%s))", (key,))
            except Exception:  # noqa: BLE001 -- logged to file: the DB may be what failed
                frappe.logger("series_lock").exception(f"unlock of {key} failed")


def _lock(key: str, wait_s: int | None) -> None:
    if frappe.db.sql("SELECT pg_try_advisory_lock(hashtext(%s))", (key,))[0][0]:
        return
    started = time.monotonic()
    if wait_s is not None:
        # lock_timeout bounds this transaction's lock waits, advisory ones included; the commit after the lock
        # (or the rollback on SeriesBusy) ends it.
        frappe.db.sql(f"SET LOCAL lock_timeout = '{int(wait_s * 1000)}ms'")
    try:
        frappe.db.sql("SELECT pg_advisory_lock(hashtext(%s))", (key,))
    except frappe.QueryTimeoutError as e:
        raise SeriesBusy(key) from e
    wait = {"key": key, "wait_s": round(time.monotonic() - started, 3), "at": time.time()}
    try:  # best-effort: the lock is held now, and a cache failure must not leave it held
        frappe.cache().lpush(WAITS_KEY, json.dumps(wait))
        frappe.cache().ltrim(WAITS_KEY, 0, _KEEP_WAITS - 1)
    except Exception:
        pass


def recent_waits(series: str, since: float) -> list[float]:
    """The waits (seconds) on `series`'s lock recorded since `since` (a `time.time()`), of the last 500 waits."""
    key = f"naming_series:{series}"
    waits = (json.loads(w) for w in frappe.cache().lrange(WAITS_KEY, 0, -1))
    return [w["wait_s"] for w in waits if w["key"] == key and w["at"] >= since]
