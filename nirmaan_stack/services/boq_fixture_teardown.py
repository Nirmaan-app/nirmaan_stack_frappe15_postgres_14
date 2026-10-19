"""Test-only helpers for fixture BoQs (CU-B AC2 (c)): a name that can never be a recycled series name, and
teardown deletes that leave no child row behind.

WHY. Sixteen test modules raw-deleted a fixture's parents (BOQs, BoQ Sheet, BOQ Nodes, the committed grid)
and left their children, which is where most of dev's orphan rows came from (CU-0 sheet AC2c). And the BOQs
series rolls a deleted number back (`delete_doc` -> `revert_series_if_last`), so a new BoQ could take a deleted
one's name and INHERIT whatever was left pointing at it -- CU-A's full run gave a fixture BOQ-26-00834 and it
met another test's orphan pricing lock. Fixture BoQs therefore take `fixture_boq_name()` (never the series),
and teardowns delete through `purge_boq` / `purge_docs`.

Both deletes are DROP-IN replacements for the raw `frappe.db.delete` they replace: same transaction, no commit,
no rollback -- the caller's existing commit stays where it was. Raw on purpose (fixture rows, no hooks owed).
Every child table is read from live meta, so a new child or BoQ-linked doctype is covered without an edit.
Never call either on a real BoQ.
"""
from __future__ import annotations

import frappe

FIXTURE_PREFIX = "BOQ-TEST-"


def fixture_boq_name(tag: str = "") -> str:
    """A fixture BoQ name outside the BOQ-.YY.- series: pass it as `insert(set_name=...)`. It keeps the
    `BOQ-` prefix on purpose -- the category harness reads only `BOQ-*__*` corpus files -- and `TEST` where
    the series has its two-digit year, so it can never equal a series name."""
    tag = "".join(c if c.isalnum() else "-" for c in (tag or "FIXTURE")).upper()
    return f"{FIXTURE_PREFIX}{tag}-{frappe.generate_hash(length=8)}"


def _children(doctype: str) -> list[str]:
    return [f.options for f in frappe.get_meta(doctype).get_table_fields()]


def _delete_names(doctype: str, names: list[str]) -> None:
    if not names:
        return
    for child in _children(doctype):
        if _children(child):
            rows = frappe.get_all(child, filters={"parent": ["in", names], "parenttype": doctype}, pluck="name")
            _delete_names(child, rows)
        frappe.db.delete(child, {"parent": ("in", names), "parenttype": doctype})
    frappe.db.delete(doctype, {"name": ("in", names)})


def purge_docs(doctype: str, filters) -> None:
    """`frappe.db.delete(doctype, filters)` for a PARENT doctype, plus every child-table row under the rows it
    deletes (recursively)."""
    _delete_names(doctype, frappe.get_all(doctype, filters=filters, pluck="name"))


def _linked_doctypes() -> list[str]:
    from frappe.model.rename_doc import get_link_fields

    out = set()
    for lf in get_link_fields("BOQs"):
        dt = lf["parent"]
        if lf["fieldname"] == "boq" and not lf.get("issingle") and frappe.db.table_exists(dt) \
                and not frappe.get_meta(dt).istable:
            out.add(dt)
    return sorted(out)


class PurgeRefused(Exception):
    """purge_boq was asked to delete a BoQ, or rows, that this test run did not create."""


# The restore cutoff (CU-0): every BoQ created before it is production data. And the moment this module was
# first imported -- in a test run, before any fixture exists -- so "created by this run" is decidable.
RESTORE_CUTOFF = frappe.utils.get_datetime("2026-10-09 13:47:46")
PROCESS_START = frappe.utils.now_datetime()


def purge_boq(boq: str | None) -> None:
    """Delete a FIXTURE BoQ and everything that hangs off it: every document whose `boq` names it (with its
    child rows), then the BoQ with its drafts, their work packages and its general-specs rows.

    ⚠️ REFUSES (PurgeRefused, nothing deleted) a BoQ created before this test process started or before the
    restore cutoff -- only a BoQ this run made may go. And it deletes only linked rows created since the
    process started: a series name can be RECYCLED, and rows an earlier BoQ of the same name left behind are
    not this run's to delete (CU-B: a teardown once took six orphan locks that way)."""
    if not boq:
        return
    created = frappe.db.get_value("BOQs", boq, "creation")
    if created is not None:
        created = frappe.utils.get_datetime(created)
        if created < RESTORE_CUTOFF or created < PROCESS_START:
            raise PurgeRefused(f"{boq} was created {created}, before this test run ({PROCESS_START}): not purged")
    for doctype in _linked_doctypes():
        purge_docs(doctype, {"boq": boq, "creation": [">=", PROCESS_START]})
    # The BoQ's attached Files, exactly as `delete_doc("BOQs")` removes them (its `remove_all`): through the
    # document layer, so the stored copy goes too. Left behind, a recycled BoQ name picks them up.
    for name in frappe.get_all("File", filters={"attached_to_doctype": "BOQs", "attached_to_name": boq}, pluck="name"):
        frappe.delete_doc("File", name, force=True, ignore_permissions=True)
    purge_docs("BOQs", {"name": boq})
