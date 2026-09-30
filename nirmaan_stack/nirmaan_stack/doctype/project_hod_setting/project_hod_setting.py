# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""One row per project: how its handover documents are headed.

Named after the project (`autoname: field:project`), so there is one by construction and reading it is
a get_value on the project id. The rules live in `services/hod/header_logos.py`; the writer is
`api/hod/header_roles.set_header_roles`.
"""

from frappe.model.document import Document


class ProjectHODSetting(Document):
	pass
