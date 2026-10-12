# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Add the Asset History `parent` index to sites that already have the table.

The index is declared in Asset History's `on_doctype_update()`, which Frappe runs only when it syncs
the doctype -- and a plain migrate doesn't re-sync a doctype whose JSON is unchanged. This patch calls
that hook rather than repeating the index, so the doctype stays the one place its shape is written.

Idempotent: `add_index` uses CREATE INDEX IF NOT EXISTS under an explicit name, so a re-run, or a
site that already got the index at sync, is a no-op. Creates an index only; no rows change.
"""

import frappe

from nirmaan_stack.nirmaan_stack.doctype.asset_history.asset_history import (
    on_doctype_update as _asset_history_indexes,
)


def execute():
    if not frappe.db.table_exists("Asset History"):
        # The table is created at the next schema sync, which runs the hook itself.
        return
    _asset_history_indexes()
