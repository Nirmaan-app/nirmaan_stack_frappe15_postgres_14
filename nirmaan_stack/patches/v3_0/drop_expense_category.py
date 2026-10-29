# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Drop the Expense Category doctype and `Expense Type.expense_category` (owner, 2026-10-27).

Categories were added 2026-08-18 to route each Expense Request to a per-category reviewer
(`Expense Category.reviewer_role`). No category ever had a reviewer, the field was removed
2026-09-16, and since then every request goes to `Nirmaan Admin Profile` whatever its category:
the category only grouped types, and the app hid it. Nothing reads it now.

This patch is **destructive**: which category each type was in (Travel, Hotel & Accommodation,
Uncategorized) is lost. Nothing used it.

Runs after the model sync, so `Expense Type` no longer carries the Link when the target goes.
The doctype folder, the `Expense Category` fixture and its `hooks.py` entry are removed in the
same change. Idempotent: every step short-circuits on `frappe.db.exists` / `IF EXISTS`.
"""

import frappe

DOCTYPE = "Expense Category"


def execute():
	# 1. The DocType record and its child rows (DocField, DocPerm, ...). `force`: it is a
	#    standard DocType, which Frappe refuses to delete outside developer mode otherwise.
	if frappe.db.exists("DocType", DOCTYPE):
		frappe.delete_doc("DocType", DOCTYPE, force=True, ignore_permissions=True)

	# 2. The table (`delete_doc` leaves it) and the column the model sync leaves on Expense Type.
	frappe.db.sql(f'DROP TABLE IF EXISTS "tab{DOCTYPE}"')
	frappe.db.sql('ALTER TABLE "tabExpense Type" DROP COLUMN IF EXISTS expense_category')

	# 3. Rows elsewhere that still name the doctype.
	for doctype, field in (
		("Custom DocPerm", "parent"),
		("Property Setter", "doc_type"),
		("Custom Field", "dt"),
		("User Permission", "allow"),
	):
		frappe.db.delete(doctype, {field: DOCTYPE})

	frappe.db.commit()
