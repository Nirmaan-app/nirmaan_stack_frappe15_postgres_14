# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Swap `Outflow Row Match`'s plain unique CONSTRAINT for a PARTIAL unique INDEX (ADR-0020 D4).

WHY A PATCH AT ALL
    This is a CONTROLLER-ONLY change to a doctype already synced everywhere, and a plain
    `bench migrate` does NOT re-sync a doctype whose JSON is unchanged -- confirmed on a
    test-server deploy when the D3d BoQ indexes silently never landed. The JSON *is* changing here
    too, but the DROP has no other home.

WHY A CONSTRAINT CANNOT SIMPLY BE ALTERED
    `frappe.db.add_unique` issues `ALTER TABLE ... ADD CONSTRAINT ... UNIQUE(...)`, and a
    PostgreSQL table constraint can never be partial. `DROP INDEX` fails on a constraint-backed
    index; it has to be `ALTER TABLE ... DROP CONSTRAINT`. `pg_indexes` renders both shapes
    identically, which is why this probes `pg_constraint` rather than trusting a name.

HEAL FIRST, THEN CONSTRAIN
    Same shape as `boq_commit_current_unique_guard`. Verified on live data 2026-09-09: no
    `import_row` holds more than one match and no transfer holds a duplicate target, so the heal
    is a no-op today -- it is here because a patch that assumes clean data is a patch that fails
    on the one site where it is not.

CALLS THE HOOK, DOES NOT RE-INLINE IT
    `ensure_settled_target_unique` lives on the controller so the index shape has one owner.
"""

import frappe

from nirmaan_stack.nirmaan_stack.doctype.outflow_row_match.outflow_row_match import (
    ensure_settled_target_unique,
    on_doctype_update as _outflow_row_match_indexes,
)

TABLE = "tabOutflow Row Match"


def _drop_old_unique_constraints() -> int:
    """Drop every non-partial UNIQUE constraint on the table. Returns how many went."""
    rows = frappe.db.sql(
        """SELECT conname FROM pg_constraint
           WHERE conrelid = %s::regclass AND contype = 'u'""",
        (f'"{TABLE}"',),
    )
    for (conname,) in rows:
        frappe.db.sql(f'ALTER TABLE "{TABLE}" DROP CONSTRAINT "{conname}"')
        print(f"    dropped non-partial UNIQUE constraint {conname}")
    return len(rows)


def _drop_old_unique_indexes() -> int:
    """And any bare unique INDEX left over from an earlier hand-run. Never the new partial one."""
    rows = frappe.db.sql(
        """SELECT indexname FROM pg_indexes
           WHERE tablename = %s AND indexname = 'ofm_match_target_unique'""",
        (TABLE,),
    )
    for (indexname,) in rows:
        frappe.db.sql(f'DROP INDEX IF EXISTS "{indexname}"')
        print(f"    dropped legacy unique index {indexname}")
    return len(rows)


def _heal() -> int:
    """Demote duplicate Settled legs so the partial index can be created.

    Keeps the OLDEST leg per (transfer_id, target_doctype, target_name) -- the one that actually
    wrote the money -- and reverses the rest, stamping a reason so the row is never mistaken for
    a decision somebody made.
    """
    groups = frappe.db.sql(
        """SELECT transfer_id, target_doctype, target_name, COUNT(*) AS c
           FROM "tabOutflow Row Match"
           WHERE match_kind = 'Settled'
           GROUP BY transfer_id, target_doctype, target_name
           HAVING COUNT(*) > 1""",
        as_dict=True,
    )
    demoted = 0
    for g in groups:
        rows = frappe.db.sql(
            """SELECT name FROM "tabOutflow Row Match"
               WHERE match_kind = 'Settled' AND transfer_id = %s
                 AND target_doctype = %s AND target_name = %s
               ORDER BY matched_at ASC, name ASC""",
            (g["transfer_id"], g["target_doctype"], g["target_name"]),
            as_dict=True,
        )
        for loser in rows[1:]:
            frappe.db.set_value(
                "Outflow Row Match",
                loser["name"],
                {
                    "match_kind": "Reversed",
                    "reversed_at": frappe.utils.now_datetime(),
                    "reversed_by": "Administrator",
                    "reversal_reason": (
                        "Duplicate settlement demoted by "
                        "patches/v3_0/outflow_match_partial_unique."
                    ),
                },
                update_modified=False,
            )
            demoted += 1
        print(
            f"    ({g['transfer_id']}, {g['target_name']}) had {g['c']} settled"
            f" -> kept {rows[0]['name']}, reversed {len(rows) - 1}"
        )
    return demoted


def execute():
    print("[outflow_match_partial_unique] HEAL then CONSTRAIN")
    if not frappe.db.table_exists("Outflow Row Match"):
        print("  table absent -- a fresh sync will fire the hook. Nothing to do.")
        return

    demoted = _heal()
    if demoted:
        frappe.db.commit()
        print(f"  healed: reversed {demoted} duplicate settled leg(s).")
    else:
        print("  healed: nothing to demote (data already clean).")

    dropped = _drop_old_unique_constraints() + _drop_old_unique_indexes()
    if not dropped:
        print("  no legacy unique key found (already migrated, or a fresh site).")
    frappe.db.commit()

    # Calls the controller hook so the index shape has exactly one definition.
    _outflow_row_match_indexes()
    ensure_settled_target_unique()

    # A brand-new index has no planner statistics until ANALYZE runs; without it PostgreSQL may
    # keep sequential-scanning until autovacuum gets round to the table.
    frappe.db.sql(f'ANALYZE "{TABLE}"')
    frappe.db.commit()
    print("[outflow_match_partial_unique] done.")
