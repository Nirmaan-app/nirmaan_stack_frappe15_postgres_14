# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class ProjectHODDocument(Document):
	pass


def on_doctype_update():
	"""One row per project x system x document, enforced by the database.

	"+ Add system" inserts 16 rows at once; the controller also checks, but only a unique index stops
	two simultaneous clicks from both inserting.
	"""
	frappe.db.add_unique(
		"Project HOD Document", ["project", "hod_system", "document"], constraint_name="unique_project_hod_document"
	)
