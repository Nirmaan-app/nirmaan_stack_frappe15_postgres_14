# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Recover the settlement provenance of every outflow settlement made before slice Q1.

WHY THIS PATCH EXISTS
    `expenses._record_settlement` hardcoded `match_basis = "Manual"` on EVERY settlement. It was
    not simply lazy: `Outflow Row Match.match_basis` was a Select whose options were
    `Bank reference / Vendor+amount+date / Manual`, and NONE of the first two is a tier the matcher
    produces -- so "Manual" was the only value that would validate. The record meaning MONEY WAS
    WRITTEN therefore claimed a person had found every settlement in the system.

    Measured on the live ledger before this patch: 849 settlements, ALL stamped `Manual`, of which
    **843 had in fact been found by the machine and merely confirmed by a person**. The remaining 6
    were genuinely hand-found. Not one had ever been overridden.

WHY THE HISTORY IS RECOVERABLE AT ALL
    A match run only ever touches OPEN rows (`WHERE row_status IN %(open)s`), and `Settled` is
    terminal. So a settled row keeps `suggested_name`, `suggestion_rule`, `match_basis` and
    `auto_matched` exactly as the match run left them, indefinitely. Comparing the settled target
    against the surviving suggestion reconstructs the verdict exactly -- which is how the 843/6/0
    split above was measured in the first place.

    ⚠️ THAT IS WHY THIS IS A BACKFILL AND NOT A WRITE-OFF. Had the match run cleared suggestions on
    settled rows, the provenance of 849 settlements would simply be gone and this patch could not
    exist. Do not "tidy" the match run into clearing terminal rows.

WHAT IT WRITES
    For each `Outflow Row Match` (and its import row):
      * `settlement_origin` -- accepted / overridden / no-suggestion, from the SHARED pure
        `status.settlement_origin`. ⚠️ IMPORTED, NEVER RE-IMPLEMENTED: a second copy of that
        three-way test is exactly how the history and the future come to disagree about one row.
      * `match_basis`      -- the tier from the import row, or `Manual` where there was none.

IDEMPOTENT, AND IT NEVER OVERWRITES A LIVE VALUE
    Only rows whose `settlement_origin` is NULL/blank are touched, so a re-run is a no-op and a
    settlement written by the post-Q1 code path is never rewritten by this. `match_basis` is
    corrected only on rows this patch is already claiming (i.e. still unstamped) -- so a value the
    new code wrote is left alone even though the old code would have written "Manual" there too.

    Writes go through `frappe.db.set_value(..., update_modified=False)` rather than `doc.save`:
    these are historical records, and re-stamping `modified` on 849 of them would make an audit
    read as though every settlement had been edited today.
"""

import frappe

from nirmaan_stack.services.outflow_import.status import settlement_origin

ROW_DOCTYPE = "Outflow Import Row"
MATCH_DOCTYPE = "Outflow Row Match"


def execute():
    if not frappe.db.has_column(MATCH_DOCTYPE, "settlement_origin"):
        # The doctype JSON ships in the same commit, so a migrate that has not yet synced it means
        # the schema step has not run. Bail rather than half-apply.
        frappe.logger("outflow_import").warning(
            "backfill_outflow_settlement_origin: settlement_origin column absent, skipping"
        )
        return

    rows = frappe.db.sql(
        f"""
        SELECT m.name          AS match_name,
               m.target_name   AS settled_name,
               r.name          AS row_name,
               r.suggested_name,
               r.match_basis
        FROM "tab{MATCH_DOCTYPE}" m
        JOIN "tab{ROW_DOCTYPE}" r ON r.name = m.import_row
        WHERE COALESCE(m.settlement_origin, '') = ''
        """,
        as_dict=True,
    )
    if not rows:
        return

    tally = {}
    for r in rows:
        origin = settlement_origin(r.get("suggested_name"), r.get("settled_name"))
        tier = (r.get("match_basis") or "").strip() or "Manual"
        tally[origin] = tally.get(origin, 0) + 1

        frappe.db.set_value(
            MATCH_DOCTYPE,
            r["match_name"],
            {"settlement_origin": origin, "match_basis": tier},
            update_modified=False,
        )
        # The row's copy is denormalised for the review screen's filter and counts. Stamped here
        # too, and only where it is blank, so the two tiers can never disagree about one row.
        frappe.db.set_value(
            ROW_DOCTYPE,
            r["row_name"],
            {"settlement_origin": origin},
            update_modified=False,
        )

    frappe.db.commit()
    # Logged rather than printed: a migrate on a deployed site is not watched, and this number is
    # the only evidence of what the patch concluded about 849 historical settlements.
    frappe.logger("outflow_import").info(
        f"backfill_outflow_settlement_origin: stamped {len(rows)} settlements {tally}"
    )
