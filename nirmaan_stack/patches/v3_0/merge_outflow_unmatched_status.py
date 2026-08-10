# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Retire the `Unmatched` row status, merging it into `Mismatched` (owner ruling 2026-08-10).

WHY THE MERGE
    The two statuses had different CAUSES -- "the match ran and found nothing settleable" versus
    "a record already recorded as Paid disagrees on amount" -- but they are the same JOB to the
    person holding the statement: a transfer that did not line up, needing a human to create or
    link something. Splitting them made a reviewer classify the reason before they could act on
    either. The cause is not lost: it lives in `outcome_note`, which already said plainly which
    case a row was, and which this patch does not touch.

WHY A DATA PATCH AND NOT JUST THE SELECT CHANGE
    `row_status` is a Select, and its options lost `Unmatched` in the same commit. Frappe does not
    rewrite stored values when a Select narrows -- the rows keep the retired string. Left alone
    they would be invisible to every tab (the scopes are built from the live vocabulary), sort into
    their own facet value, and render as an untoned chip the frontend mirror has never heard of.
    On the owner's dev database that is a real population, not a hypothetical: the 1,043-row August
    statement alone left 145 of them.

RAW SQL, NOT `set_value` PER ROW
    This is a mechanical vocabulary rename over potentially thousands of rows, not a business
    event. There is nothing to audit -- the status is DERIVED (`services/outflow_import/status.py`
    is the only deriver), so a re-run of the match would reproduce exactly this value from the same
    inputs. Looping `frappe.db.set_value` would write a Version row per transfer recording a change
    nobody made, and take minutes doing it.

IDEMPOTENT
    The `WHERE` clause matches only the retired string, so a second run updates nothing. Safe on a
    fresh site (no rows), safe on a site already migrated, safe to re-run by hand.

The corresponding patches.txt wiring
(`nirmaan_stack.patches.v3_0.merge_outflow_unmatched_status` under [post_model_sync]) is added
separately by the maintainer -- it is intentionally not part of this patch, matching
`add_outflow_master_index`.
"""

import frappe

# The retired value, spelled out here rather than imported: the constant is GONE from `status.py`,
# and that is the point of the patch. A patch that imported the name it exists to erase would break
# the day the merge it performs is complete.
_RETIRED_STATUS = "Unmatched"
_MERGED_INTO = "Mismatched"


def execute():
    if not frappe.db.table_exists("Outflow Import Row"):
        # A site that has never synced the doctype has no rows to migrate, and will create the
        # table with the narrowed Select at its next schema sync.
        return

    frappe.db.sql(
        """
        UPDATE "tabOutflow Import Row"
        SET row_status = %s
        WHERE row_status = %s
        """,
        (_MERGED_INTO, _RETIRED_STATUS),
    )
    frappe.db.commit()
