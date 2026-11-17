"""Keeps pages of the data tables (`api/data_table/search.py`) in Redis, so the table refreshes that one save sets off
search Postgres once per question and permission group, instead of once per open screen.

How a kept page stays correct:
* Every record type has a version number in Redis. Once a transaction in a request or background job commits,
  the version of every record type it wrote moves on, however it wrote it: a save, `frappe.db.set_value`, raw
  SQL, a delete (`watch_writes`, hooked to before_request and before_job). A child table moves its parents too.
* Outside a request or job (bench console, bench execute, migrate patches) a saved or deleted record moves its own
  record type on after the commit (`bump_on_save`, a doc_events "*" hook), and every migrate ends by moving every
  record type on (`bump_all_versions`, after_migrate).
* "Has this transaction written?" is asked of Postgres (`has_written`), never answered from Frappe's write counter
  alone: that counter restarts at 0 on a rollback to a savepoint, though the writes before the savepoint stay.
* A page is kept together with the versions of every record type it reads (`read_set`). A page kept at older
  versions is never served: the next request builds it again and overwrites it in place.
* Users share a page only when Frappe adds the same permission condition to their list queries
  (`permission_group`), never by login: same condition, same rows.
* On a miss the request starts a fresh read of the database before it builds. A request's first transaction runs
  at REPEATABLE READ (psycopg2 opens it on the new connection; Frappe's later transactions run at the server
  default, READ COMMITTED), so the request's view was fixed by its first query, before the versions were read.
* A kept page expires after KEEP_SECONDS: the safety net for a write that moves no version (raw SQL typed in the
  bench console).
* Built and not kept: Redis down, the cache switched off (`nc_table_cache: 0` in site config), a request that has
  already written, or a call the caller marks not cacheable (exports, pages over MAX_ROWS rows).

Version keys never expire. If Redis evicts one under its memory cap it starts again from 0, which is safe only
because no page is kept longer than KEEP_SECONDS; raising KEEP_SECONDS needs that looked at again.
"""

from __future__ import annotations

import hashlib
import json
import pickle
import time
from collections.abc import Callable, Iterable

import frappe
from frappe.model.db_query import DatabaseQuery
from frappe.utils import cint, today
from frappe.utils.caching import site_cache
from redis.exceptions import RedisError

#: How long a kept page may be served, at most (seconds).
KEEP_SECONDS = 10

#: Larger pages are never kept (a 10,000-row PO page is about 8.6 MB). The caller applies it (`cacheable`).
MAX_ROWS = 100

#: A page larger than this once stored is not kept (rows with big JSON fields).
MAX_BYTES = 1_000_000

#: How long one request may hold the build lock of a page.
LOCK_SECONDS = 3

#: How long a request waits for another request's build of the same page before it builds the page itself. A
#: waiting request holds a web worker, so this stays short; a build normally takes 40-275 ms.
WAIT_SECONDS = 0.5
WAIT_STEP_SECONDS = 0.025

#: How long the daily hit/miss counters are kept.
STATS_KEEP_SECONDS = 8 * 24 * 60 * 60

#: Start of every Redis key this module writes (the site prefix is added by `make_key`).
VERSION_PREFIX = "nc:ver"
PAGE_PREFIX = "nc:dt:page"
STATS_PREFIX = "nc:dt:stats"


def is_enabled() -> bool:
    """The off switch: `"nc_table_cache": 0` in site config sends every table request to Postgres."""
    return bool(cint(frappe.conf.get("nc_table_cache", 1)))


# ---- versions --------------------------------------------------------------------------------------------------


def bump_version(doctype: str) -> None:
    """Move the version of `doctype` on, so no page kept before this change is served again."""
    bump_versions([doctype])


def bump_versions(doctypes: Iterable[str]) -> None:
    cache = frappe.cache()
    try:
        pipe = cache.pipeline()
        for doctype in sorted(set(doctypes)):
            pipe.incr(cache.make_key(f"{VERSION_PREFIX}:{doctype}"))
        pipe.execute()
    except RedisError:
        pass  # nothing is served from Redis without Redis either


def read_stamp(doctypes: Iterable[str]) -> str | None:
    """The current versions of `doctypes` as one text ("A=3|B=0"), or None without Redis."""
    names = sorted(set(doctypes))
    cache = frappe.cache()
    try:
        raw = cache.mget([cache.make_key(f"{VERSION_PREFIX}:{dt}") for dt in names])
    except RedisError:
        return None
    return "|".join(f"{dt}={int(v or 0)}" for dt, v in zip(names, raw))


#: Whether this transaction has written anything. Postgres gives a transaction an ID at its first write and keeps it
#: through a rollback to a savepoint; Frappe's write counter restarts at 0 there. About 0.07 ms.
WROTE_SQL = "select pg_current_xact_id_if_assigned() is not null"


def has_written() -> bool:
    """Whether this transaction has written anything, a write followed by a rollback to a savepoint included."""
    return bool(frappe.db.transaction_writes) or bool(frappe.db.sql(WROTE_SQL)[0][0])


# ---- versions moved on outside a request or job ----------------------------------------------------------------
#
# The bench console, bench execute and migrate patches run with no before_request or before_job, so nothing
# watches them. A record saved or deleted there still moves its own record type on once the transaction commits:
# those are the writes that send a live refresh (`list_update`) to the open screens. Writes there with
# `set_value` or raw SQL send none; the after_migrate bump covers them for patches, KEEP_SECONDS for the console.

#: `frappe.local` attribute: record types saved or deleted in this unwatched transaction, moved on at its commit.
_SAVED = "nc_table_cache_saved"


def bump_on_save(doc, method=None) -> None:
    """doc_events "*" (on_change, after_delete): outside a watched request or job, move `doc`'s record type on once
    the transaction commits. Inside one, the watcher already finds the write, with every other write."""
    if getattr(frappe.local, _WATCHING, False) or not getattr(frappe.local, "db", None):
        return
    saved = getattr(frappe.local, _SAVED, None)
    if saved is None:
        saved = set()
        setattr(frappe.local, _SAVED, saved)
        frappe.db.after_commit.add(_bump_saved)
        frappe.db.after_rollback.add(_forget_saved)
    saved.add(doc.doctype)


def _bump_saved() -> None:
    saved = getattr(frappe.local, _SAVED, None) or set()
    setattr(frappe.local, _SAVED, None)
    if saved:
        bump_versions(saved)


def _forget_saved() -> None:
    setattr(frappe.local, _SAVED, None)


def bump_all_versions(*args, **kwargs) -> None:
    """after_migrate hook: move every record type on, so no page kept before the patches is served again (patches
    that write with `set_value` or raw SQL move nothing themselves)."""
    bump_versions(frappe.get_all("DocType", pluck="name"))


# ---- versions moved on by what each transaction wrote ----------------------------------------------------------
#
# Postgres counts, per transaction, the rows each table had inserted, updated or deleted
# (`pg_stat_xact_user_tables`), however they were written: a document save, `frappe.db.set_value`, raw SQL,
# `frappe.db.delete`. So just before each commit the watcher asks which tables were written, and once the commit
# has gone through it moves on the version of each one's record type, and of the parents of a child table.
#
# Frappe runs a callback once and forgets it, and a rollback drops the commit callbacks, so the watcher arms
# itself again after every commit and every rollback. Each arming gets a new number (`_ARMING`, which only ever
# grows); a callback from an older arming does nothing, so callbacks never pile up. No callback adds itself to the
# queue that is running it (CallbackManager.run would run it again, without end): the commit path re-arms from
# after_commit, the rollback path goes before_rollback -> after_rollback -> arm.
#
# A write followed in the same transaction by a rollback to a savepoint is seen: `has_written` asks Postgres, and
# Postgres keeps counting the rows written before the savepoint. Writes outside a request or job are moved on by
# `bump_on_save` and `bump_all_versions` above.

#: Tables this transaction wrote, from Postgres's own per-transaction counters.
WRITTEN_TABLES_SQL = (
    "select relname from pg_stat_xact_user_tables where n_tup_ins + n_tup_upd + n_tup_del > 0"
)

#: `frappe.local` attributes: whether this request or job is watched, and the number of the current arming.
_WATCHING = "nc_table_cache_watching"
_ARMING = "nc_table_cache_arming"


def watch_writes(*args, **kwargs) -> None:
    """before_request / before_job hook: from now on in this request or job, every commit moves on the version of
    each record type it wrote."""
    if getattr(frappe.local, _WATCHING, False) or not getattr(frappe.local, "db", None):
        return
    setattr(frappe.local, _WATCHING, True)
    _arm()


def stop_watching() -> None:
    """Every callback already queued does nothing from now on."""
    setattr(frappe.local, _WATCHING, False)
    setattr(frappe.local, _ARMING, getattr(frappe.local, _ARMING, 0) + 1)


def _arm() -> None:
    arming = getattr(frappe.local, _ARMING, 0) + 1
    setattr(frappe.local, _ARMING, arming)
    frappe.db.before_commit.add(lambda: _before_commit(arming))
    frappe.db.before_rollback.add(lambda: _before_rollback(arming))


def _current(arming: int) -> bool:
    return getattr(frappe.local, _WATCHING, False) and getattr(frappe.local, _ARMING, 0) == arming


def _before_commit(arming: int) -> None:
    if not _current(arming):
        return
    doctypes = written_doctypes()
    # If the COMMIT itself fails, the rollback that follows must still re-arm (commit() cleared before_rollback).
    frappe.db.before_rollback.add(lambda: _before_rollback(arming))
    frappe.db.after_commit.add(lambda: _after_commit(arming, doctypes))


def _after_commit(arming: int, doctypes: set[str]) -> None:
    try:
        if doctypes:
            bump_versions(doctypes)  # committed: moved on even if a newer arming exists
    finally:
        if _current(arming):
            _arm()


def _before_rollback(arming: int) -> None:
    if _current(arming):
        frappe.db.after_rollback.add(lambda: _after_rollback(arming))


def _after_rollback(arming: int) -> None:
    if _current(arming):
        _arm()


def written_doctypes() -> set[str]:
    """The record types this transaction wrote, plus the parents of any child table it wrote. Never raises: it
    runs inside the commit of every watched save, so on any error it gives up (the kept pages then expire within
    KEEP_SECONDS) and the transaction is left exactly as it was."""
    try:
        frappe.db.savepoint("nc_table_cache")
        tables = [row[0] for row in frappe.db.sql(WRITTEN_TABLES_SQL)] if has_written() else []
        parents = _child_table_parents() if tables else {}
        frappe.db.release_savepoint("nc_table_cache")
    except Exception:
        try:
            frappe.db.rollback(save_point="nc_table_cache")
        except Exception:
            pass
        return set()
    doctypes = {table[3:] for table in tables if table.startswith("tab")}
    for doctype in list(doctypes):
        doctypes.update(parents.get(doctype, ()))
    return doctypes


@site_cache(ttl=600)
def _child_table_parents() -> dict[str, tuple[str, ...]]:
    """child doctype -> the doctypes holding it in a Table field. Kept per process and site for 10 minutes."""
    rows = frappe.db.sql(
        """
        select options, parent from `tabDocField`
        where fieldtype in ('Table', 'Table MultiSelect') and coalesce(options, '') != ''
        union
        select options, dt from `tabCustom Field`
        where fieldtype in ('Table', 'Table MultiSelect') and coalesce(options, '') != ''
        """
    )
    parents: dict[str, set[str]] = {}
    for child, parent in rows:
        parents.setdefault(child, set()).add(parent)
    return {child: tuple(sorted(found)) for child, found in parents.items()}


# ---- who may share a page --------------------------------------------------------------------------------------


def permission_group(doctype: str) -> str:
    """The same text for users who get the same rows of `doctype`: a fingerprint of the permission condition Frappe
    adds to this user's list queries, plus the user's roles when the record type has field-level permissions (then
    the columns a user may read differ by role too)."""
    condition = DatabaseQuery(doctype).build_match_conditions(as_condition=True) or ""
    if any(df.permlevel for df in frappe.get_meta(doctype).fields):
        condition += "\nroles:" + ",".join(sorted(frappe.get_roles()))
    return hashlib.sha1(condition.encode()).hexdigest()


def read_set(doctype: str, fields: Iterable[str], virtual_fields: list[str] | None = None) -> set[str]:
    """Every record type a page of `doctype` with these columns reads: a change to any of them makes it old."""
    from nirmaan_stack.api.data_table.constants import LINK_FIELD_MAP
    from nirmaan_stack.services.expense_bills import BILL_DOCTYPE

    reads = {doctype}
    for field in fields:
        name = field.split(" ")[0].split(".")[0].strip("`")
        if name in LINK_FIELD_MAP:
            reads.add(LINK_FIELD_MAP[name]["doctype"])  # the shown name (vendor_name, project_name, ...)
        if name == "owner":
            reads.add("Nirmaan Users")  # owner_name (search._add_owner_names)
    if virtual_fields:
        reads.add(BILL_DOCTYPE)  # the Bill column of the expense lists (data_table/virtual_fields.py)
    return reads


# ---- the read path ---------------------------------------------------------------------------------------------


def cached_page(
    doctype: str,
    question: dict,
    reads: Iterable[str],
    build: Callable[[], dict],
    *,
    cacheable: bool = True,
    stamp: str | None = None,
) -> dict:
    """The reply to `question` for this user: served from Redis when kept at the current versions of `reads`,
    otherwise built by `build()` and kept for the user's permission group.

    `question` holds everything in the request that changes the reply except the user (`permission_group` stands
    for the user). The caller passes cacheable=False for exports and pages over MAX_ROWS rows, and `stamp` when it
    called `start_fresh` itself (because it reads the database to work out its question)."""
    if not cacheable or not is_enabled():
        return build()

    cache = frappe.cache()
    started_fresh = stamp is not None
    if not started_fresh:
        if has_written():
            return build()  # never rolled back: that would throw this request's writes away
        stamp = read_stamp(reads)
    if stamp is None:
        return build()
    key = page_key(doctype, question)

    kept = _kept(cache, key, stamp)
    if kept is not None:
        _count(cache, "hit")
        return kept

    holds_lock = _take_lock(cache, key)
    if not holds_lock:
        kept = _wait_for(cache, key, stamp)
        if kept is not None:
            _count(cache, "hit")
            return kept

    try:
        if not started_fresh:
            # A fresh read: this request's view of the database was fixed by its first query, before the
            # versions above were read, so a change committed in between would be missing from the page. The
            # request has written nothing (checked above), so the rollback discards nothing.
            frappe.db.rollback()
        reply = build()
        _keep(cache, key, stamp, reply)
        _count(cache, "miss")
        return reply
    finally:
        if holds_lock:
            _release_lock(cache, key)


def start_fresh(reads: Iterable[str]) -> str | None:
    """For a caller that reads the database to work out its question (search.py: facet filters become a list of
    names): read the versions of `reads`, then start a fresh read, so everything read after this call is at least as
    new as those versions. Pass the result to `cached_page(stamp=...)`. None, and nothing done, when the cache is
    off, the request has written, or Redis cannot be reached."""
    if not is_enabled() or has_written():
        return None
    stamp = read_stamp(reads)
    if stamp is None:
        return None
    frappe.db.rollback()  # nothing written in this request (checked above): the rollback discards nothing
    return stamp


def page_key(doctype: str, question: dict) -> str:
    """Where the page answering `question` is kept for this user's permission group, today."""
    text = json.dumps(
        {"question": question, "group": permission_group(doctype), "date": today()},
        sort_keys=True,
        default=str,
    )
    return frappe.cache().make_key(f"{PAGE_PREFIX}:{doctype}:{hashlib.sha1(text.encode()).hexdigest()}")


def _kept(cache, key: str, stamp: str) -> dict | None:
    """The kept page at `key` when it was kept at `stamp`, else None."""
    try:
        raw = cache.get(key)
    except RedisError:
        return None
    if raw is None:
        return None
    value = pickle.loads(raw)
    return value["reply"] if value.get("stamp") == stamp else None


def _keep(cache, key: str, stamp: str, reply: dict) -> None:
    payload = pickle.dumps({"stamp": stamp, "reply": reply})
    if len(payload) > MAX_BYTES:
        return
    try:
        cache.set(key, payload, ex=KEEP_SECONDS)  # the same key: a newer page overwrites the old one
    except RedisError:
        pass


def _take_lock(cache, key: str) -> bool:
    try:
        return bool(cache.set(f"{key}:lock", 1, nx=True, ex=LOCK_SECONDS))
    except RedisError:
        return False


def _release_lock(cache, key: str) -> None:
    try:
        cache.delete(f"{key}:lock")
    except RedisError:
        pass


def _wait_for(cache, key: str, stamp: str) -> dict | None:
    """The page another request is building, once kept; None if it is not kept within WAIT_SECONDS."""
    deadline = time.monotonic() + WAIT_SECONDS
    while time.monotonic() < deadline:
        time.sleep(WAIT_STEP_SECONDS)
        kept = _kept(cache, key, stamp)
        if kept is not None:
            return kept
    return None


def _count(cache, kind: str) -> None:
    """Daily hit/miss counters, so the hit rate can be read on production."""
    name = cache.make_key(f"{STATS_PREFIX}:{today()}:{kind}")
    try:
        cache.incr(name)
        cache.expire(name, STATS_KEEP_SECONDS)
    except RedisError:
        pass
