# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

from frappe.model.document import Document

from nirmaan_stack.services.asset_department import normalize_department
from nirmaan_stack.services.departments import require_department_editor


class NirmaanDepartment(Document):
	def before_insert(self):
		"""Tidy the typed name before the record is named after it ("Site  Projects" -> "Site Projects").

		The record's name comes from `department_name` (autoname by field) right after this and before
		validate, so tidying only in validate left the stray spaces in the name every Link stores.
		"""
		self.department_name = normalize_department(self.department_name)

	def validate(self):
		"""Only Admin and HR add or edit departments; the name is tidied (spaces trimmed)."""
		require_department_editor()
		self.department_name = normalize_department(self.department_name)
