# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Remove the ZONE layer from the Commission Report model + reset existing tasks.

Background
----------
Commission reports used to carry a per-report ZONE layer:
  * a ``Commission Report Zone`` child table on ``Project Commission Report``
    (one row per zone, e.g. "Default 24"), and
  * per-zone TASK COPIES in ``Commission Report Task Child Table`` -- a
    multi-zone project seeded the same task once per zone, distinguished by
    ``task_zone``.

Zones now live INSIDE each task (the ``zone_wise_enable`` / ``zones[]``
source_format model), so the standalone zone layer is removed. The task child
table keeps ONE row per task (no per-zone copies) and drops its zone-era fields.

What this patch does
--------------------
Registered under ``[post_model_sync]`` -- it runs AFTER ``bench migrate`` syncs
the doctype schema, so the four removed fields are already out of the doctype
DEFINITION while their physical DB columns still linger for this patch to drop.

  1. DEDUP -- collapse the per-zone duplicate task rows: keep ONE row per
     (report, commission_category, task_name); delete the rest. Single-zone
     reports have no duplicates, so nothing is deleted there.
  2. RESET -- every surviving task row is wiped back to a clean skeleton: keep
     ``task_name`` / ``deadline`` / ``commission_category`` / ``task_phase`` /
     ``report_type``; clear everything else; ``task_status`` -> "Pending".
  3. DROP COLUMNS -- the four zone-era fields removed from the doctype
     (``task_zone``, ``assigned_designers``, ``task_sub_status``, ``task_type``).
  4. REMOVE the ``Commission Report Zone`` child rows + DocType + table +
     dangling metadata references.

``modified`` is NOT bumped (load-bearing): every task-row write is raw SQL on the
CHILD table, so neither the child row's ``modified`` nor the parent
``Project Commission Report.modified`` is touched.

This patch is DESTRUCTIVE: all filled report data (responses, snapshots, approval
proofs) is intentionally discarded (per product decision -- existing reports are
reset, not preserved).

Companion schema changes (separate, REQUIRED for permanence): the doctype JSON
edits -- remove the zones Table field from ``Project Commission Report``, remove
the four fields above from ``Commission Report Task Child Table``, and delete the
``Commission Report Zone`` doctype folder. Without them a later ``bench migrate``
would re-create the dropped columns/doctype from the still-present JSON. This
patch is self-sufficient + defensive so it also cleans up a half-migrated env.

Idempotent -- safe to re-run (every step short-circuits via IF EXISTS /
``frappe.db.exists`` / the dedup naturally no-ops once duplicates are gone).
"""

import frappe

TASK_DT = "Commission Report Task Child Table"
TASK_TBL = "tabCommission Report Task Child Table"
ZONE_DT = "Commission Report Zone"
ZONE_TBL = "tabCommission Report Zone"
PARENT_DT = "Project Commission Report"

# Zone-era fields removed from Commission Report Task Child Table.
DROP_COLUMNS = ("task_zone", "assigned_designers", "task_sub_status", "task_type")


def execute():
    if frappe.db.table_exists(TASK_DT):
        # 1. DEDUP per-zone duplicate task rows: keep one row per
        #    (parent report, commission_category, task_name); delete the rest.
        #    A multi-zone report seeded the same task once per zone; single-zone
        #    reports have no duplicates, so this deletes nothing there. Raw
        #    DELETE on the child table -> the parent report's `modified` is NOT
        #    bumped. The kept row is arbitrary (smallest name) -- every row is
        #    reset below, so which copy survives does not matter.
        frappe.db.sql(
            f'''
            DELETE FROM "{TASK_TBL}" AS a
            USING "{TASK_TBL}" AS b
            WHERE a.parenttype = %(pt)s
              AND a.parent = b.parent
              AND a.parenttype = b.parenttype
              AND COALESCE(a.commission_category, '') = COALESCE(b.commission_category, '')
              AND COALESCE(a.task_name, '') = COALESCE(b.task_name, '')
              AND a.name > b.name
            ''',
            {"pt": PARENT_DT},
        )

        # 2. RESET each surviving task row to a clean skeleton. Raw UPDATE on the
        #    child table -> neither the child's nor the parent's `modified` is
        #    bumped. KEEP task_name / deadline / commission_category / task_phase
        #    / report_type; clear everything else; task_status -> "Pending".
        frappe.db.sql(
            f'''
            UPDATE "{TASK_TBL}" SET
                response_data = '',
                response_snapshot_id = NULL,
                last_submitted = NULL,
                task_status = 'Pending',
                file_link = '',
                approval_proof = '',
                response_filled_at = NULL,
                response_filled_by = NULL,
                comments = ''
            WHERE parenttype = %(pt)s
            ''',
            {"pt": PARENT_DT},
        )

        # 3. DROP the four zone-era columns. The physical columns linger after
        #    the schema sync (Frappe never auto-drops columns); IF EXISTS + the
        #    column-exists guard keep this idempotent.
        for col in DROP_COLUMNS:
            if _column_exists(TASK_TBL, col):
                frappe.db.sql(f'ALTER TABLE "{TASK_TBL}" DROP COLUMN IF EXISTS "{col}"')

    # 4. Remove the Commission Report Zone layer entirely: child rows, the
    #    DocType record + its physical table, and any dangling metadata that
    #    referenced it. (When the doctype folder is also removed, `bench migrate`
    #    deletes the DocType for us; doing it here too makes the patch
    #    self-sufficient + idempotent for a half-migrated environment.)
    if frappe.db.table_exists(ZONE_DT):
        frappe.db.sql(f'DELETE FROM "{ZONE_TBL}"')

    if frappe.db.exists("DocType", ZONE_DT):
        frappe.delete_doc("DocType", ZONE_DT, force=True, ignore_permissions=True)

    frappe.db.sql(f'DROP TABLE IF EXISTS "{ZONE_TBL}"')

    # 5. Drop dangling User Permissions / Property Setters / Custom Fields /
    #    DocPerms that referenced the removed zone doctype (benign but noisy in
    #    migrate output otherwise).
    for table, columns in (
        ("tabUser Permission", ("allow",)),
        ("tabProperty Setter", ("doc_type",)),
        ("tabCustom Field", ("dt",)),
        ("tabDocPerm", ("parent",)),
    ):
        for column in columns:
            if not _column_exists(table, column):
                continue
            frappe.db.sql(
                f'DELETE FROM "{table}" WHERE "{column}" = %(dt)s',
                {"dt": ZONE_DT},
            )

    frappe.db.commit()


def _column_exists(table_name: str, column_name: str) -> bool:
    """True if ``column_name`` exists on ``table_name`` (PostgreSQL)."""
    rows = frappe.db.sql(
        """
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = %(table)s
          AND column_name = %(column)s
        LIMIT 1
        """,
        {"table": table_name, "column": column_name},
    )
    return bool(rows)
