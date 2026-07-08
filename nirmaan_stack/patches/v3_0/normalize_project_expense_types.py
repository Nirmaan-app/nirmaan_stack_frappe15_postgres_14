# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

import frappe

# Non-project-flagged expense types that were mistakenly used on Project Expenses.
# They are consolidated into a single standardized project expense type.
SOURCE_EXPENSE_NAMES = [
	"Printing & Stationery",
	"Staff Welfare Expenses",
	"Hotel Expenses",
	"Postage & Courier",
	"Pooja Expenses",
	"Travel Expenses (Flight)",
]
TARGET_EXPENSE_NAME = "Other Project Related Charges"


def execute():
	# Raw UPDATE -> only `type` changes; everything else (incl. modified) is preserved.
	# Idempotent: once run, no row carries a source type, so a re-run matches nothing.
	frappe.db.sql(
		"""
		UPDATE "tabProject Expenses"
		SET type = %(target)s
		WHERE type IN %(sources)s
		""",
		{"target": TARGET_EXPENSE_NAME, "sources": tuple(SOURCE_EXPENSE_NAMES)},
	)
	frappe.db.commit()

	frappe.logger("patches").info(
		f"normalize_project_expense_types: repointed Project Expenses "
		f"{SOURCE_EXPENSE_NAMES} -> '{TARGET_EXPENSE_NAME}'."
	)
