# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class WorkMilestoneDependency(Document):
	def validate(self):
		if self.dependency_type == "Full Dependence":
			self.dependency_percentage = 100
		else:
			if self.dependency_percentage is None or self.dependency_percentage < 1 or self.dependency_percentage > 99:
				frappe.throw("For Partial Dependence, Dependency % must be between 1 and 99")
