# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class TDSItems(Document):
	def validate(self):
		self.validate_unique_group()
		self.validate_no_duplicate_members()

	def validate_unique_group(self):
		"""Enforce unique (work_package, tds_item_name).

		A TDS Item is uniquely identified by its Work Package + human label.
		Membership is many-to-many across TDS Items, so the same Items SKU may
		belong to several groups — only the (work_package, tds_item_name) pair
		is constrained to be unique.
		"""
		duplicate = frappe.db.exists("TDS Items", {
			"work_package": self.work_package,
			"tds_item_name": self.tds_item_name,
			"name": ["!=", self.name]
		})

		if duplicate:
			frappe.throw(
				"Duplicate TDS Item: a TDS Item named "
				f"'{self.tds_item_name}' already exists for Work Package "
				f"'{self.work_package}'."
			)

	def validate_no_duplicate_members(self):
		"""Reject the same Items SKU listed twice within THIS TDS Item.

		This is an intra-document check only. The same Items SKU is allowed to
		belong to multiple TDS Items (membership is many-to-many), so no
		cross-parent uniqueness check is performed.
		"""
		seen = set()
		for member in (self.members or []):
			if not member.item:
				continue
			if member.item in seen:
				frappe.throw(
					f"Duplicate member: item '{member.item}' is listed more "
					"than once in this TDS Item."
				)
			seen.add(member.item)
