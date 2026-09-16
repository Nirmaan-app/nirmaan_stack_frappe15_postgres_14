# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Mark the expense legs whose settle CREATED their expense, from before the flag existed (#1278).

WHY THIS PATCH EXISTS
    `Outflow Row Match.created_by_import` decides what Unreconcile does to an expense: a created one is
    deleted, an existing one goes back to Approved (parent #1270). Every Create path writes it from
    #1278 on. Legs written before carry 0, so without this an import-created expense would be put back
    to Approved -- an Approved record for money nobody sanctioned.

WHAT IT DECIDES, AND WHERE
    The rule is `services/outflow_import/unreconcile.leg_created_the_record`, IMPORTED rather than
    re-written: the expense was written within a minute BEFORE its leg, by the leg's own user, is not
    older than the statement upload, and no Version up to the match shows a status that was ever not
    Paid. Every doubt stays 0 -- "not created", the safe revert path.

    Measured on the local database (2026-09-15, 237 expense legs): 222 created legs, every one 0-5 s
    after its expense, same user, no Version; 15 hand Links, every one minutes to days older, with a
    Version. No leg fell between. The patch prints its counts so production can be checked the same way.

    Inflow legs are NOT written: the decision module treats an inflow leg as created whatever its flag.

IDEMPOTENT
    Only expense legs still at 0 are read, and only a 0 -> 1 is written, so a second run marks nothing.

RAW UPDATE, NOT `doc.save` -- AND WHY SKIPPING THE LIFECYCLE IS CORRECT HERE (root CLAUDE.md rule 1)
    `Outflow Row Match` has no `doc_events`, and its controller FREEZES every field after insert, so a
    save would refuse this write outright. `created_by_import` feeds no derived value; it is read only by
    the Unreconcile decision. `modified` is left alone, and no Version row is written.

The `patches.txt` wiring sits under [post_model_sync], after the doctype sync that adds the column.
"""

import frappe

from nirmaan_stack.services.outflow_import.ledgers import EXPENSE_DOCTYPES
from nirmaan_stack.services.outflow_import.unreconcile import leg_created_the_record

MATCH_DOCTYPE = "Outflow Row Match"


def execute():
    if not frappe.db.has_column(MATCH_DOCTYPE, "created_by_import"):
        print("backfill_outflow_match_created_flag: created_by_import column absent, skipping")
        return
    counts = backfill_created_flag()
    frappe.db.commit()
    message = f"backfill_outflow_match_created_flag: {counts}"
    print(message)
    frappe.logger("outflow_import").info(message)


def backfill_created_flag(legs: list[str] | None = None) -> dict:
    """Classify and mark every unflagged expense leg -- or only `legs`, which is what the tests pass so
    they never touch a leg they did not create. Returns `{"created": n, "not created": m}`. Commits
    nothing."""
    counts = {"created": 0, "not created": 0}
    if legs is not None and not legs:
        return counts
    for doctype in EXPENSE_DOCTYPES:
        unflagged = _unflagged_legs(doctype, legs)
        created = [leg.name for leg in unflagged if _was_created(doctype, leg)]
        read = len(unflagged)
        if created:
            # Raw UPDATE on purpose; see the module docstring for why no lifecycle is skipped that matters.
            frappe.db.sql(
                f"""UPDATE "tab{MATCH_DOCTYPE}" SET created_by_import = 1
                    WHERE name IN %(names)s AND COALESCE(created_by_import, 0) = 0""",
                {"names": tuple(created)},
            )
        counts["created"] += len(created)
        counts["not created"] += read - len(created)
    return counts


def _unflagged_legs(doctype: str, legs: list[str] | None) -> list:
    scope = "AND m.name IN %(legs)s" if legs is not None else ""
    return frappe.db.sql(
        f"""
        SELECT m.name, m.target_name, m.matched_at, m.matched_by,
               e.creation AS expense_creation, e.owner AS expense_owner,
               b.creation AS batch_creation,
               EXTRACT(EPOCH FROM (m.matched_at - e.creation)) AS seconds
        FROM "tab{MATCH_DOCTYPE}" m
        JOIN "tab{doctype}" e ON e.name = m.target_name
        LEFT JOIN "tabOutflow Import Batch" b ON b.name = m.import_batch
        WHERE m.target_doctype = %(doctype)s
          AND COALESCE(m.created_by_import, 0) = 0
          {scope}
        ORDER BY m.name
        """,
        {"doctype": doctype, "legs": tuple(legs or ())},
        as_dict=True,
    )


def _was_created(doctype: str, leg) -> bool:
    return leg_created_the_record(
        seconds_from_creation_to_match=None if leg.seconds is None else float(leg.seconds),
        same_user=(leg.expense_owner or "") == (leg.matched_by or "") and bool(leg.matched_by),
        created_before_import=bool(leg.batch_creation)
        and leg.expense_creation < leg.batch_creation,
        status_changes_before_match=_status_changes_before(doctype, leg.target_name, leg.matched_at),
    )


def _status_changes_before(doctype: str, name: str, until) -> list[tuple]:
    """Every `(old, new)` change of `status` in the record's Version rows created up to `until`."""
    changes = []
    for data in frappe.get_all(
        "Version",
        filters={"ref_doctype": doctype, "docname": name, "creation": ["<=", until]},
        order_by="creation asc",
        pluck="data",
    ):
        parsed = frappe.parse_json(data or "{}") or {}
        for change in parsed.get("changed") or []:
            if len(change) == 3 and change[0] == "status":
                changes.append((change[1], change[2]))
    return changes
