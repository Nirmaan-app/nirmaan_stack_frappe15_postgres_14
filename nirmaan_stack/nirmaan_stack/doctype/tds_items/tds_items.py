# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class TDSItems(Document):
	def validate(self):
		self.normalize_name()
		self.validate_unique_group()

	def normalize_name(self):
		"""Strip surrounding whitespace off the human label.

		Case is deliberately PRESERVED — unlike the rate master's canonical
		UPPERCASE values, this is a display label a human chose, and rewriting
		it would silently change what every project's frozen `tds_item_name`
		snapshot no longer matches. Only the invisible difference (padding) is
		removed, so " Y Strainer" and "Y Strainer" stop being two groups.
		"""
		if self.tds_item_name:
			self.tds_item_name = self.tds_item_name.strip()

	def validate_unique_group(self):
		"""Enforce unique (work_package, tds_item_name), CASE-INSENSITIVELY.

		A TDS Item is uniquely identified by its Work Package + human label.
		Membership is N:1 owned by the Item (`Items.linked_tds_item`, ADR-0004),
		so a SKU belongs to exactly one group — only the
		(work_package, tds_item_name) pair is constrained here.

		WHY RAW SQL: the previous implementation used `frappe.db.exists` with an
		`=` match, and PostgreSQL `=` on varchar is CASE-SENSITIVE. That let
		'Y Strainer', 'Y strainer' and 'y strainer' coexist as three separate
		groups under one Work Package — which they did (one such pair was found
		and removed on 2026-08-04). `frappe.db.exists` cannot express
		`lower(trim(...))`, so the comparison has to be raw SQL. Table
		identifiers are double-quoted per the app's PostgreSQL convention.

		Compares on `lower(trim(...))` on BOTH sides so it also catches a
		legacy row that was stored with padding before `normalize_name` existed.
		"""
		if not (self.tds_item_name and self.work_package):
			return  # mandatory-field errors are Frappe's to raise, not ours

		duplicate = frappe.db.sql(
			"""
			SELECT name, tds_item_name FROM "tabTDS Items"
			WHERE work_package = %(wp)s
			  AND lower(trim(tds_item_name)) = lower(trim(%(label)s))
			  AND name != %(self_name)s
			LIMIT 1
			""",
			{
				"wp": self.work_package,
				"label": self.tds_item_name,
				# A brand-new doc has no name yet; "" never matches a real id.
				"self_name": self.name or "",
			},
			as_dict=True,
		)

		if duplicate:
			existing = duplicate[0]
			# Name the existing row: with case-insensitive matching the clash is
			# often invisible ('Y Strainer' vs 'Y strainer'), so an error that
			# only echoes what the user typed reads like a false positive.
			frappe.throw(
				"Duplicate TDS Item: "
				f"'{existing.tds_item_name}' ({existing.name}) already exists for "
				f"Work Package '{self.work_package}'. Names are compared ignoring "
				"case and surrounding spaces."
			)

	# `validate_no_duplicate_members` was REMOVED on 2026-08-04.
	#
	# It rejected the same Items SKU appearing twice in `members`, which was a
	# real risk only while `members` was the WRITABLE many-to-many store. It is
	# now two things at once, and both make the check wrong to keep:
	#
	#   * membership is N:1 (`Items.linked_tds_item`), so an item points at
	#     exactly one group — a duplicate is impossible by construction; and
	#   * `members` is a read-only MIRROR rebuilt by
	#     `api/tds/members.rebuild_group_members`, which derives its rows from a
	#     `get_all` over distinct items, so it cannot emit one twice.
	#
	# Leaving it would have read as a live guard over real membership, which is
	# exactly the misreading that let the retired child table keep being written.
