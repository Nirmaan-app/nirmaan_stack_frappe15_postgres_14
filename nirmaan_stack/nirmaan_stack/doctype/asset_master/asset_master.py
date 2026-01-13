# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe.model.naming import make_autoname


class AssetMaster(Document):
	def autoname(self):
		"""
		Generate name in format: ASSET-<first 3 letters of category>-###
		Examples:
		- Laptop → ASSET-LAP-001
		- Mobile Phone → ASSET-MOB-001
		- Desktop Computer → ASSET-DES-001
		"""
		if not self.asset_category:
			frappe.throw("Asset Category is required for naming")

		# Get first 3 letters of category in uppercase
		category_prefix = self.asset_category[:3].upper()

		# Generate name with pattern: ASSET-XXX-.###
		self.name = make_autoname(f"ASSET-{category_prefix}-.###")
