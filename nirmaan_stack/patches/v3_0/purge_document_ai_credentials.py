# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Purge the retired Document AI fields from the settings singleton.

Document AI was fully replaced by Gemini. The old fields were removed from the
``Document AI Settings`` doctype JSON, but a Single doctype keeps its values as
rows in ``tabSingles`` — they linger until explicitly deleted. Most importantly
this includes ``service_account_json_input``, the **plaintext GCP service-account
private key**, which must not survive the migration.

Scoped + idempotent: deletes only the named retired fields for this one doctype.
"""

import frappe

_RETIRED_FIELDS = (
    "service_account_json_input", 
    "has_service_account_json",
    "project_id",
    "location",
    "processor_id",
    "invoice_processor_id",
    "expense_processor_id",
    "invoice_target_doctypes",
    "expense_target_doctypes",
    "timeout_seconds",
)


def execute():
    if not frappe.db.table_exists("Singles"):
        return

    frappe.db.delete(
        "Singles",
        {"doctype": "Document AI Settings", "field": ("in", _RETIRED_FIELDS)},
    )
    frappe.db.commit()
