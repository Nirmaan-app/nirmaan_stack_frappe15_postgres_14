#!/usr/bin/env python3
"""Backfill the four known retirement entries into BoQ Rate Master Retirement.

WHY A BACKFILL IS NEEDED AT ALL
-------------------------------
The four things below were retired by earlier imports, and the loader recorded NOTHING about it --
the entire effect was `active = 0`, which is indistinguishable from an ordinary supersede. The
declaration lived only in the asset's `retired_kinds` / `retired_category_ids`. From this slice on
the loader records new retirements as it applies them, but the historical four have to be seeded.

⚠️ retired_at / retired_by / reason ARE LEFT EMPTY, DELIBERATELY.
The loader never recorded when, by whom, or why. The only available signal is the `creation`
timestamp of the last batch in which each was still active, which is approximate. A field asserting
a precision it does not have is worse than an empty one, so nothing is back-inferred.

IDEMPOTENT: it delegates to `retirement.record_retirements`, which skips an entry that already
exists -- and could not duplicate one anyway, since the doctype's autoname makes the tuple the
primary key. Run it twice and nothing moves.

A one-off maintenance script, NOT a patch: it seeds data, it does not migrate structure.

USAGE (inside the container, from the bench directory)
    env/bin/python apps/nirmaan_stack/scripts/backfill_rate_master_retirement.py          # dry run
    env/bin/python apps/nirmaan_stack/scripts/backfill_rate_master_retirement.py --apply
"""
from __future__ import annotations

import argparse
import os
import sys

os.chdir("/workspace/development/frappe-bench/sites")
import frappe  # noqa: E402

DISCIPLINE = "Electrical"
RETIRED_KINDS = ["ups_per_kva", "ups_reference"]
RETIRED_CATEGORY_IDS = ["ups", "switches_point"]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="write; otherwise dry run")
    args = ap.parse_args()

    frappe.init(site="localhost")
    frappe.connect()
    frappe.set_user("Administrator")

    from nirmaan_stack.services.boq_rate_master import retirement

    print("discipline           :", DISCIPLINE)
    print("retired_kinds        :", RETIRED_KINDS)
    print("retired_category_ids :", RETIRED_CATEGORY_IDS)
    print("rows before          :", frappe.db.count(retirement.RETIREMENT_DOCTYPE))

    if not args.apply:
        print("\nDRY RUN -- nothing written. Re-run with --apply.")
        frappe.destroy()
        return 0

    result = retirement.record_retirements(DISCIPLINE, RETIRED_KINDS, RETIRED_CATEGORY_IDS)
    frappe.db.commit()
    print("\ncreated  :", result["created"])
    print("existing :", result["existing"])
    print("rows after:", frappe.db.count(retirement.RETIREMENT_DOCTYPE))

    print("\nread-back through get_retirement_lists(%r):" % DISCIPLINE)
    lists = retirement.get_retirement_lists(DISCIPLINE)
    print("   ", lists)
    ok = (sorted(lists["retired_kinds"]) == sorted(RETIRED_KINDS)
          and sorted(lists["retired_category_ids"]) == sorted(RETIRED_CATEGORY_IDS))
    print("matches the declared lists:", ok)

    print("\nprovenance fields must be EMPTY (never back-inferred):")
    for r in frappe.get_all(retirement.RETIREMENT_DOCTYPE, filters={"discipline": DISCIPLINE},
                            fields=["name", "scope_type", "scope_value",
                                    "retired_at", "retired_by", "reason"],
                            order_by="scope_type asc, scope_value asc"):
        print("   %-40s at=%r by=%r reason=%r"
              % (r["name"], r["retired_at"], r["retired_by"], r["reason"]))
    frappe.destroy()
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
