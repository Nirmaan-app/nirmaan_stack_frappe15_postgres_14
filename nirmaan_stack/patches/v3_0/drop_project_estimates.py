# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Drop the Project Estimates doctype (owner 2026-10-27).

Project Estimates held a per-item quantity and rate estimate for a project. Its screens (the Project
Estimates tab, the Add Estimates page, the Project Spends tab that compared against it, the Material
Usage "Est. Qty" column) are removed in the same change. Prod held 66 rows across 3 projects, the last
written 2025-01-03.

This patch is **destructive**: the rows, the DocType record and the physical table go. It also removes
the `Version` rows the old `on_trash` hook wrote for deleted estimates, and any permission or
customisation rows naming the doctype, so nothing points at a doctype that no longer exists.

**Backup first:** every estimate row (all columns) and every `Version` row naming the doctype are written to
`sites/<site>/private/backups/project_estimates_backup_<timestamp>.json` before anything is deleted. If that
write fails the patch raises, so nothing is deleted without a backup on disk.

Raw deletes, no `doc_events`: nothing derives from Project Estimates, so no recompute is skipped.

Idempotent: every step short-circuits through `frappe.db.exists` / `table_exists` / `IF EXISTS`; once the
table is gone there is nothing left to back up.
"""

import json
import os

import frappe
from frappe.utils import now_datetime

DOCTYPE = "Project Estimates"


def execute():
    if frappe.db.table_exists(DOCTYPE):
        backup()

    if frappe.db.exists("DocType", DOCTYPE):
        frappe.delete_doc("DocType", DOCTYPE, force=True, ignore_permissions=True)

    # Defensive: `delete_doc` drops the table too, but this also cleans up after a half-migrated site
    # (e.g. one where `remove_orphan_doctypes` already removed the DocType record and left the table).
    frappe.db.sql_ddl(f'DROP TABLE IF EXISTS "tab{DOCTYPE}"')

    for doctype, field in (
        ("Version", "ref_doctype"),
        ("User Permission", "allow"),
        ("Property Setter", "doc_type"),
        ("Custom Field", "dt"),
        ("Custom DocPerm", "parent"),
        ("DocPerm", "parent"),
    ):
        if frappe.db.table_exists(doctype):
            frappe.db.delete(doctype, {field: DOCTYPE})


def backup():
    """Write every estimate row and its Version rows to a JSON file in the site's private backups folder."""
    rows = frappe.db.sql(f'SELECT * FROM "tab{DOCTYPE}" ORDER BY creation', as_dict=True)
    versions = frappe.db.sql(
        'SELECT * FROM "tabVersion" WHERE ref_doctype = %s ORDER BY creation', (DOCTYPE,), as_dict=True
    )
    folder = os.path.abspath(frappe.get_site_path("private", "backups"))
    os.makedirs(folder, exist_ok=True)
    path = os.path.join(folder, f"project_estimates_backup_{now_datetime().strftime('%Y%m%d_%H%M%S')}.json")
    with open(path, "w") as f:
        json.dump({"doctype": DOCTYPE, "rows": rows, "versions": versions}, f, indent=1, default=str)

    with open(path) as f:
        saved = json.load(f)
    if len(saved["rows"]) != len(rows) or len(saved["versions"]) != len(versions):
        frappe.throw(f"Project Estimates backup at {path} is incomplete; nothing was deleted.")
    print(f"Backed up {len(rows)} Project Estimates rows and {len(versions)} Version rows to {path}")
