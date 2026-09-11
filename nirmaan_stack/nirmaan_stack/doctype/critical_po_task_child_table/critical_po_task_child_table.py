# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Critical PO Task Child Table -- one Critical PO Task a Procurement Order is linked to.

Lives under `Procurement Orders.critical_po_tasks`. The PO owns the link. Rows carry the task's name (`task_name`); every
write goes through `api/critical_po_tasks/po_links.update_po_task_links`.
"""

import frappe
from frappe.model.document import Document


class CriticalPOTaskChildTable(Document):
	pass


def on_doctype_update():
	"""Index the task column: every task -> POs lookup filters on it.

	Explicit name, because PostgreSQL index names are unique per schema and a generated
	one could silently collide with another table's (see `outflow_import_row`).
	"""
	frappe.db.add_index("Critical PO Task Child Table", ["critical_po_task"], "critical_po_task_child_table_task_idx")
