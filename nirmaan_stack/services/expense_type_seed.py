# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The Expense Types a NEW site starts with (owner, 2026-11-02).

`Expense Type` is no longer a fixture: the site's database is the only truth, and Admin edits types in the
app (Expense Packages). A fixture was re-imported on every migrate and undid those edits.

A brand-new site (CI's, a fresh install) still needs the types the code and the tests name, so
`after_sync` (in `hooks.py`, run once by `bench install-app`, after the Role Profile fixtures it links to)
inserts each type of `expense_types_seed.json` that the site lacks. It never changes a type that exists,
and migrate never runs it.

`expense_types_seed.json` is the last fixture (2026-11-02) with the two misspellings corrected
(`v3_0.merge_misspelled_expense_types`). It is a starting point, not a mirror of production.
"""

import json
import os

import frappe

SEED = os.path.join(os.path.dirname(__file__), "expense_types_seed.json")


def seed_rows() -> list[dict]:
	with open(SEED, encoding="utf-8") as handle:
		return json.load(handle)


def seed_expense_types(rows: list[dict] | None = None) -> list[str]:
	"""Insert each seed type the site lacks; returns the names inserted."""
	added = []
	for row in seed_rows() if rows is None else rows:
		if frappe.db.exists("Expense Type", row["name"]):
			continue
		frappe.get_doc({"doctype": "Expense Type", **row}).insert(ignore_permissions=True)
		added.append(row["name"])
	return added
