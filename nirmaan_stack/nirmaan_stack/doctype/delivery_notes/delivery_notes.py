# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

from frappe.model.document import Document


class DeliveryNotes(Document):
	def autoname(self):
		if self.procurement_order:
			# PO DN: PO/<series>/<project>/<fin_year> → DN/<series>/<project>/<fin_year>/<note_no>
			dn_prefix = self.procurement_order.replace("PO/", "DN/", 1)
			self.name = f"{dn_prefix}/{self.note_no}"
		elif getattr(self, "parent_doctype", None) == "Internal Transfer Memo" and self.parent_docname:
			# ITM DN: ITM-DN/<itm_id>/<note_no>
			self.name = f"ITM-DN/{self.parent_docname}/{self.note_no}"
		else:
			self.name = f"DN-MISC/{self.note_no}"
