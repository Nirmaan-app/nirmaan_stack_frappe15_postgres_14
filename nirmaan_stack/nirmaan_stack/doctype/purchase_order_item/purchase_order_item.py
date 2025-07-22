# # Copyright (c) 2025, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# # For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe.utils import flt

class PurchaseOrderItem(Document):
    def validate(self):
        self.calculate_totals()

    def on_update(self): # Or before_save
        # This might not be strictly necessary if validate already covers it,
        # but good for ensuring it's always calculated.
        # Be careful of recursive saves if on_update itself triggers a save.
        # self.calculate_totals() 
        pass # Validate usually suffices

    def calculate_totals(self):
        if self.quantity and self.quote:
            self.amount = flt(self.quantity) * flt(self.quote)
        else:
            self.amount = 0

        if self.amount and self.tax:
            self.tax_amount = self.amount * (flt(self.tax) / 100)
        else:
            self.tax_amount = 0
        
        self.total_amount = flt(self.amount) + flt(self.tax_amount)

# You might also need a hook on the parent "Procurement Orders" to update its own grand totals
# whenever its "items" child table is modified.
# Example in hooks.py for Procurement Orders:
# doc_events = {
#   "Procurement Orders": {
#       "validate": "path.to.your.function.update_po_totals",
#       "on_submit": "path.to.your.function.update_po_totals",
#       "on_cancel": "path.to.your.function.update_po_totals"
#   }
# }
# And path.to.your.function.update_po_totals would iterate self.items and sum up total_amount.