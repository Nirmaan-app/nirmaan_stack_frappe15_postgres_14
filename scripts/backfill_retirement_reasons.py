#!/usr/bin/env python3
"""Backfill `reason` on the two retirement rows F-16 and F-17 minted blank.

WHY A BACKFILL, AND WHY THE NEW CHANNEL CANNOT DO IT
----------------------------------------------------
F-19 gives the asset a `retirement_reasons` map, so every FUTURE retirement records why it happened.
It cannot fix the two rows already in the table: `retirement.record_retirements` SKIPS an entry that
already exists and never updates it. That skip is what makes a re-load safe -- turning it into an
upsert to fill two historical fields would trade a load-safety guarantee for a cosmetic one -- so a
replay reports these rows as `existing` and changes nothing. Hence a one-off script, exactly as
`backfill_rate_master_retirement.py` seeded the original four.

⚠️ THIS IS COPYING RECORDED FACT, NOT INVENTING HISTORY
-------------------------------------------------------
The sibling script refuses to fill provenance, and that refusal still stands where it bites. Its
rationale is BACK-INFERENCE: "the only available signal is the `creation` timestamp of the last
batch in which each was still active, which is approximate. A field asserting a precision it does
not have is worse than an empty one."

Nothing here is inferred. Both reasons were authored at the time of the decision and are recorded
verbatim in the commit bodies -- 77f54f4f (F-16) and 6e0af13a (F-17) -- and in the docs. The old
ruling forbids manufacturing a fact the table never observed; it does not forbid transcribing one
that was written down.

⚠️ `retired_at` / `retired_by` ARE NOT TOUCHED, deliberately. `retired_at` would timestamp the LOAD
rather than the decision, and `retired_by` would name an actor the table never observed -- both are
exactly the back-inference the original refusal is about. Only `reason` is documented fact.

SAFETY
------
  * DRY RUN BY DEFAULT. Nothing is written without --apply.
  * IDEMPOTENT: a row already carrying the SAME reason is skipped silently. Run it twice, nothing
    moves the second time.
  * REFUSES per row rather than guessing: a missing row, or a row already carrying a DIFFERENT
    reason, is reported and left alone. A row someone has since annotated by hand is not ours to
    overwrite.
  * The doctype is `track_changes: 1`, so every write lands in the Version log with an author.

A one-off maintenance script, NOT a patch: it seeds data, it does not migrate structure.

USAGE (inside the container, from the bench directory)
    env/bin/python apps/nirmaan_stack/scripts/backfill_retirement_reasons.py          # dry run
    env/bin/python apps/nirmaan_stack/scripts/backfill_retirement_reasons.py --apply
"""
from __future__ import annotations

import argparse
import os
import sys

os.chdir("/workspace/development/frappe-bench/sites")
import frappe  # noqa: E402

RETIREMENT_DOCTYPE = "BoQ Rate Master Retirement"

# name -> reason. The names are the doctype's own autoname format,
# `{discipline}::{scope_type}::{scope_value}`, so they ARE the primary keys.
REASONS = {
    "Electrical::kind::tray_install_rate":
        "Superseded by F-16: tray install moved on-row (2026-08-13).",
    "Electrical::kind::db_install_rate":
        "Superseded by F-17: db install as ratio 0.20 (2026-08-13).",
}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="write; otherwise dry run")
    args = ap.parse_args()

    frappe.init(site="localhost")
    frappe.connect()
    try:
        planned, skipped, refused = [], [], []

        for name, reason in REASONS.items():
            if not frappe.db.exists(RETIREMENT_DOCTYPE, name):
                refused.append((name, "row does not exist"))
                continue
            current = (frappe.db.get_value(RETIREMENT_DOCTYPE, name, "reason") or "").strip()
            if current == reason:
                skipped.append((name, "already carries this reason"))
            elif current:
                refused.append((name, "already carries a DIFFERENT reason: %r" % current))
            else:
                planned.append((name, reason))

        print("BACKFILL RETIREMENT REASONS -- %s" % ("APPLY" if args.apply else "DRY RUN"))
        print()
        for name, reason in planned:
            print("  WOULD SET  %s" % name)
            print("             -> %s" % reason)
        for name, why in skipped:
            print("  SKIP       %s  (%s)" % (name, why))
        for name, why in refused:
            print("  REFUSED    %s  (%s)" % (name, why))
        print()
        print("  %d to set, %d already done, %d refused" % (len(planned), len(skipped), len(refused)))

        if refused:
            # A refusal is not a crash -- the other rows are still reported -- but it must not be
            # mistaken for success by a caller reading the exit code.
            print("\n  ⚠️ Refusals above were NOT written. Resolve them by hand or leave them.")

        if not args.apply:
            print("\n  DRY RUN -- nothing was written. Re-run with --apply to write.")
            return 1 if refused else 0

        for name, reason in planned:
            # `reason` is a plain optional field on a track_changes doctype; set_value with the
            # default update_modified keeps the Version log honest about when it happened.
            frappe.db.set_value(RETIREMENT_DOCTYPE, name, "reason", reason)
        frappe.db.commit()
        print("\n  WROTE %d row(s)." % len(planned))

        print("\n  READ BACK:")
        for name in REASONS:
            row = frappe.db.get_value(
                RETIREMENT_DOCTYPE, name,
                ["retired_at", "retired_by", "reason"], as_dict=True) or {}
            print("    %-42s at=%r by=%r" % (name, row.get("retired_at"), row.get("retired_by")))
            print("      reason=%r" % (row.get("reason"),))
        return 1 if refused else 0
    finally:
        frappe.destroy()


if __name__ == "__main__":
    sys.exit(main())
