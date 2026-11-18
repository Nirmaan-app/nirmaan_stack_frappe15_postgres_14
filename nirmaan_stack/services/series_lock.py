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

With N workers, up to N-1 operations that create BoQs wait here, each holding a worker. Each wait is recorded in
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


@contextmanager
def series_lock(*series: str):
    """Hold the lock of every series in `series` for the `with` block, inside a transaction that started after
    they were granted. Commits on a clean exit and rolls back on an exception, both before unlocking.

    ⚠️ Commits the caller's open transaction first. Several series are always locked in one order, so two
    holders of overlapping sets cannot deadlock."""
    held = []
    frappe.db.commit()
    try:
        for key in [f"naming_series:{s}" for s in sorted(set(series))]:
            _lock(key)
            held.append(key)
        frappe.db.commit()
        yield
        frappe.db.commit()
    except BaseException:
        frappe.db.rollback()
        raise
    finally:
        for key in reversed(held):
            frappe.db.sql("SELECT pg_advisory_unlock(hashtext(%s))", (key,))


def _lock(key: str) -> None:
    if frappe.db.sql("SELECT pg_try_advisory_lock(hashtext(%s))", (key,))[0][0]:
        return
    started = time.monotonic()
    frappe.db.sql("SELECT pg_advisory_lock(hashtext(%s))", (key,))
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
