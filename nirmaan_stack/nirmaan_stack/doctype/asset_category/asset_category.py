# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

from frappe.model.document import Document

from nirmaan_stack.services.asset_audit_access import check_may_switch_category_audit


class AssetCategory(Document):
	def validate(self):
		# Switching the monthly audit (owner, 2026-10-14): Admin only, also when a category is created with it
		# on. Here so Desk and the REST API can't skip it; server code saving with ignore_permissions has
		# checked already.
		if self.flags.ignore_permissions:
			return
		switched = self.audit_required if self.is_new() else self.has_value_changed("audit_required")
		if switched:
			check_may_switch_category_audit()
