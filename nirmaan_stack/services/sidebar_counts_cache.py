"""Keeps the sidebar badge counts (`api/sidebar_count_parts`) in Redis, so a burst of badge refreshes after one save
counts each changed part once per counting scope, instead of every part once per open screen.

How a kept part stays correct:
* Each counted record type has a version number in Redis. A change to one moves it on, after the transaction
  commits: the doc_events "*" hooks `on_change` (fires on every save and every `db_set`) and `after_delete`.
* A part is kept under its counting scope, the versions of the record types it reads (`PART_DOCTYPES`) and, for
  credits, today's date. After a change the version has moved on, so the next request counts that part again;
  the other parts are read back.
* Versions are read BEFORE a part is counted, so a change committed while it is being counted can never be kept
  under the new version.
* Every kept part expires after `KEEP_SECONDS`. That is the safety net for a write that fires no document event
  (`frappe.db.set_value`, raw SQL; about 15 app call sites on 2026-11-16, e.g. cancelling or merging a PO): such
  a write can leave a badge at most that old. It is short on purpose: the badge refreshes that one change sets
  off arrive within a few seconds of each other, and that is the burst the kept parts are for.
* If Redis cannot be reached, every part is counted fresh.
"""

import hashlib

import frappe
from redis.exceptions import RedisError

from nirmaan_stack.api.sidebar_count_parts import PART_DOCTYPES, PARTS, CountScope

#: How long a kept part may be read back, at most (seconds).
KEEP_SECONDS = 10

#: Every record type a part reads; a change to one moves its version on.
VERSIONED_DOCTYPES = frozenset(dt for doctypes in PART_DOCTYPES.values() for dt in doctypes)

#: Parts whose numbers depend on the date (credits: the Due tab counts terms due by today).
PARTS_READING_TODAY = frozenset({"credits"})

#: Start of every Redis key this module writes (the site prefix is added by `make_key`).
KEY_PREFIX = "sidebar_counts"


def bump_on_change(doc, method=None):
    """doc_events "*" hook: once the transaction commits, move on the version of a counted record type."""
    if doc.doctype in VERSIONED_DOCTYPES:
        frappe.db.after_commit.add(lambda doctype=doc.doctype: bump_version(doctype))


def bump_version(doctype: str) -> None:
    """Move the version of `doctype` on, so every kept part that reads it is counted again."""
    cache = frappe.cache()
    try:
        cache.incr(cache.make_key(f"{KEY_PREFIX}:version:{doctype}"))
    except RedisError:
        pass  # nothing is read back without Redis either


def scope_key(scope: CountScope) -> str:
    """The same text for the same scope, whatever order its projects came in."""
    if scope.full_access:
        return "full"
    if not scope.projects:
        return "none"
    joined = "\n".join(sorted(scope.projects))
    return "p-" + hashlib.sha1(joined.encode()).hexdigest()


def _read_versions() -> dict | None:
    """The current version of every counted record type (0 if never moved), or None without Redis."""
    cache = frappe.cache()
    doctypes = sorted(VERSIONED_DOCTYPES)
    try:
        raw = cache.mget([cache.make_key(f"{KEY_PREFIX}:version:{dt}") for dt in doctypes])
    except RedisError:
        return None
    return {dt: int(v) if v is not None else 0 for dt, v in zip(doctypes, raw)}


def part_key(part: str, scope: CountScope, today: str, versions: dict) -> str:
    """Where `part` is kept for this scope, these versions and (for date-dependent parts) this date."""
    stamp = ".".join(str(versions[dt]) for dt in PART_DOCTYPES[part])
    key = f"{KEY_PREFIX}:part:{part}:{scope_key(scope)}:{stamp}"
    return f"{key}:{today}" if part in PARTS_READING_TODAY else key


def counts_for(scope: CountScope, today: str) -> dict:
    """Every badge part for `scope`, in reply order: read back where kept, counted (and kept) where not."""
    versions = _read_versions()
    if versions is None:
        return {part: count(scope, today) for part, count in PARTS.items()}

    cache = frappe.cache()
    counts = {}
    for part, count in PARTS.items():
        key = part_key(part, scope, today, versions)
        value = cache.get_value(key, expires=True)
        if value is None:
            value = count(scope, today)
            cache.set_value(key, value, expires_in_sec=KEEP_SECONDS)
        counts[part] = value
    return counts
