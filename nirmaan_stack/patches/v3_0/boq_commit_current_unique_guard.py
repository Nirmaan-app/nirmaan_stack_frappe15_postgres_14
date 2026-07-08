"""
BoQ commit -- heal-then-constrain the "exactly one is_current per (boq, sheet)" invariant.

The commit pipeline (commit_pipeline.py) enforces "exactly one is_current=1 row per
(boq, sheet)" for the committed BoQ Sheet + BoQ Committed Sheet Grid tiers by CONVENTION
only: _next_commit_version (:265) reads max(commit_version)+1 with NO lock, then freeze-
then-inserts (:499/:545) with NO DB constraint. Two concurrent commit_boq calls of the
same (boq, sheet) can therefore both land is_current=1, silently corrupting every
downstream pricing read (get_committed_rows / get_committed_state resolve the sheet by
is_current=1, NOT max(commit_version)). See ADR-0011 (the commit-race), plan A1a.

This patch makes the invariant DB-enforced:

  HEAL  -- per tier, per (boq, <name>): if >1 is_current=1 row exists, KEEP the one with
           the highest commit_version (tiebreak: latest committed_at, then newest name)
           and demote the rest to is_current=0. Frozen versions are NEVER deleted -- every
           prior version is intentionally retained. (Live data was clean at authoring time
           -- BoQ Sheet + Grid had 0 duplicate-current groups -- so this is a safety net
           for other environments / a race that fires before deploy.)

  CONSTRAIN -- add a PARTIAL UNIQUE INDEX (boq, <name>) WHERE is_current=1 on each tier, so
           a concurrent duplicate INSERT fails with IntegrityError (caught by commit_boq's
           per-sheet try/except -> reported in failed[]) instead of corrupting.

TIERS (verified against live schema + data):
  - BoQ Sheet                (identity name field = sheet_name)
  - BoQ Committed Sheet Grid  (identity name field = source_sheet_name)
  BOQ Nodes is DELIBERATELY EXCLUDED: a sheet legitimately has MANY nodes sharing
  (boq, sheet); node identity is per source_row_number, so (boq, sheet) is not a
  uniqueness key there (the audit's 193 "duplicate" node groups are just nodes-per-sheet).

Idempotent: the heal re-runs to a no-op; CREATE UNIQUE INDEX IF NOT EXISTS is a no-op if
the index already exists. Sheet names matched VERBATIM (#152) -- byte-exact PostgreSQL
'=' on varchar.
"""

import frappe

# (physical table, identity name field, partial-unique index name)
_TIERS = [
    ("tabBoQ Sheet", "sheet_name", "uq_boq_sheet_current"),
    ("tabBoQ Committed Sheet Grid", "source_sheet_name", "uq_boq_grid_current"),
]


def _heal(table: str, name_field: str) -> int:
    """Demote all but the winning is_current=1 row in each duplicated (boq, <name>)
    group. Winner = highest commit_version (tiebreak committed_at, then name). Returns
    the number of rows demoted."""
    groups = frappe.db.sql(
        f'''SELECT boq, {name_field} AS sn, COUNT(*) AS c
            FROM "{table}" WHERE is_current = 1
            GROUP BY boq, {name_field} HAVING COUNT(*) > 1''',
        as_dict=True,
    )
    if not groups:
        print(f"    {table}: 0 duplicate-current groups -- nothing to heal.")
        return 0

    demoted = 0
    for g in groups:
        rows = frappe.db.sql(
            f'''SELECT name FROM "{table}"
                WHERE boq = %s AND {name_field} = %s AND is_current = 1
                ORDER BY commit_version DESC, committed_at DESC, name DESC''',
            (g["boq"], g["sn"]),
            as_dict=True,
        )
        losers = [r["name"] for r in rows[1:]]  # keep rows[0] (highest version)
        if losers:
            frappe.db.sql(
                f'UPDATE "{table}" SET is_current = 0 WHERE name IN %(names)s',
                {"names": tuple(losers)},
            )
            demoted += len(losers)
            print(
                f"    {table}: ({g['boq']}, {g['sn']!r}) had {g['c']} current"
                f" -> kept {rows[0]['name']}, demoted {len(losers)}"
            )
    return demoted


def _constrain(table: str, name_field: str, index_name: str) -> None:
    frappe.db.sql(
        f'''CREATE UNIQUE INDEX IF NOT EXISTS {index_name}
            ON "{table}" (boq, {name_field}) WHERE is_current = 1'''
    )
    print(
        f"    {table}: partial unique index {index_name} ensured"
        f" on (boq, {name_field}) WHERE is_current = 1"
    )


def execute():
    print("[boq_commit_current_unique_guard] HEAL then CONSTRAIN")

    total = 0
    for table, name_field, _ in _TIERS:
        total += _heal(table, name_field)
    if total:
        frappe.db.commit()
        print(f"  healed: demoted {total} stale duplicate-current row(s).")
    else:
        print("  healed: nothing to demote (data already clean).")

    for table, name_field, index_name in _TIERS:
        _constrain(table, name_field, index_name)
    frappe.db.commit()

    print("[boq_commit_current_unique_guard] done.")
