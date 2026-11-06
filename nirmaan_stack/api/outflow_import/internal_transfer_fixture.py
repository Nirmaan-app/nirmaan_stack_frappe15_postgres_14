# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Test support: purge the Internal Transfer records of a test's own import (spec #1619).

A suite that stages an ICICI, Cashbook or card statement now makes Internal Transfer records beside its lines. Its
purge deletes the lines with raw SQL, which fires no hook, so it calls this first or the records would outlive
their lines. Imported by those suites' tearDowns; nothing outside tests calls it.
"""

import frappe


def purge_internal_transfers(batch: str) -> None:
    """Delete every Internal Transfer record whose line belongs to `batch`."""
    frappe.db.sql(
        """DELETE FROM "tabInternal Transfer"
           WHERE import_row IN (SELECT name FROM "tabOutflow Import Row" WHERE import_batch = %s)""",
        (batch,),
    )
