# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""One row per project: how its handover documents are headed, and each package's signed copy.

Named after the project (`autoname: field:project`), so there is one by construction and reading it is
a get_value on the project id. The rules live in `services/hod/header_logos.py`; the writers are
`api/hod/header_roles.set_header_roles` and `api/hod/package_files.set_signed_copy`.
"""

import frappe
from frappe import _
from frappe.model.document import Document


class ProjectHODSetting(Document):
	def validate(self):
		# One signed copy per package (owner 2026-10-06): a re-upload replaces the row, so a second row
		# for the same package -- typed in Desk -- would leave it unclear which file is the signed one.
		seen = set()
		for row in self.get("package_files") or []:
			if row.hod_system in seen:
				frappe.throw(_("{0} already has a signed copy row; replace its file instead.").format(row.hod_system))
			seen.add(row.hod_system)
