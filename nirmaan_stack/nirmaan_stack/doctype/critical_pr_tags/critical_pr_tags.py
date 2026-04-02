import frappe
from frappe.model.document import Document
from frappe.model.naming import getseries


class CriticalPRTags(Document):
	def autoname(self):
		# Extract project suffix (last part of name, max 5 chars)
		project_id = self.project.split("-")[-1][-5:]
		self.name = f"{project_id}-{self.header}"
