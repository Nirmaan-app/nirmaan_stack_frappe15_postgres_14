# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

from frappe.model.document import Document


class DeliveryNotes(Document):
	def autoname(self):
		# PO name format: PO/<series>/<project>/<fin_year>
		# DN name format: DN/<series>/<project>/<fin_year>/<note_no>
		po_name = self.procurement_order or ""
		dn_prefix = po_name.replace("PO/", "DN/", 1) if po_name.startswith("PO/") else po_name
		self.name = f"{dn_prefix}/{self.note_no}"
