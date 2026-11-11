# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Test support: purge the Internal Transfer records of a test's own import (spec #1619).

A suite that stages an ICICI, Cashbook or card statement now makes Internal Transfer records beside its lines. Its
purge deletes the lines with raw SQL, which fires no hook, so it calls this first or the records would outlive
their lines. Imported by those suites' tearDowns; nothing outside tests calls it.
"""

import frappe

from nirmaan_stack.services.outflow_import.row_settlement import BATCH_DOCTYPE, MATCH_DOCTYPE, ROW_DOCTYPE


def purge_internal_transfers(batch: str) -> None:
    """Delete every Internal Transfer record whose line belongs to `batch`."""
    frappe.db.sql(
        """DELETE FROM "tabInternal Transfer"
           WHERE import_row IN (SELECT name FROM "tabOutflow Import Row" WHERE import_batch = %s)""",
        (batch,),
    )


def purge_imports(batches, *, suite: str) -> None:
    """The one tearDown purge of the Internal Transfer suites: roll back first, then purge each import of `batches` in
    its own try, committing per import (CODING_STANDARDS § Writing tests) -- its lines' Versions and Comments, its
    Internal Transfer records, its match records, its lines and the import itself. `suite` names the failure print."""
    frappe.db.rollback()
    for batch in batches:
        try:
            rows = frappe.get_all(ROW_DOCTYPE, filters={"import_batch": batch}, pluck="name")
            if rows:
                frappe.db.delete("Version", {"ref_doctype": ROW_DOCTYPE, "docname": ["in", rows]})
                frappe.db.delete("Comment", {"reference_doctype": ROW_DOCTYPE, "reference_name": ["in", rows]})
            purge_internal_transfers(batch)
            frappe.db.delete(MATCH_DOCTYPE, {"import_batch": batch})
            frappe.db.delete(ROW_DOCTYPE, {"import_batch": batch})
            frappe.db.delete(BATCH_DOCTYPE, {"name": batch})
            frappe.db.commit()
        except Exception as exc:
            frappe.db.rollback()
            print(f"{suite}: could not purge {batch}: {exc}")
