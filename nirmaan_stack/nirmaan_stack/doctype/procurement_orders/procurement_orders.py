# # Copyright (c) 2024, Abhishek and contributors
# # For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe.model.naming import getseries
from datetime import datetime
from frappe.utils import flt # Import flt for float conversion


class ProcurementOrders(Document):
    def autoname(self):
        project = self.project.split("-")[-1]
        curr_month = datetime.now().month
        curr_year = datetime.now().year
        fin_yr = str(curr_year)[2:]+"-"+str(curr_year+1)[2:] if curr_month>3 else str(curr_year-1)[2:]+"-"+str(curr_year)[2:]
        prefix = project
        self.name = f"PO/{getseries(prefix, 3)}/{project}/{fin_yr}"

    # --- Method to calculate and set parent totals ---
    def calculate_totals_from_items(self):
        """
        Calculates total amount, total tax, and grand total for the PO
        from its child items and sets them on the parent document.
        """
        total_items_amount = 0.0
        total_items_tax_amount = 0.0
        grand_total_amount = 0.0

        # 'items' is the fieldname of your child table in ProcurementOrders
        # linking to "Purchase Order Item"
        for item_row in self.get("items", []): # self.get is safer
            # Ensure child item rows have their individual amounts calculated
            # This should ideally happen in PurchaseOrderItem.validate()
            # For robustness, we can re-calculate or trust the values if they are set
            
            # Assuming item_row.amount and item_row.tax_amount are already calculated
            # and are numeric (float/currency)
            total_items_amount += flt(item_row.amount)
            total_items_tax_amount += flt(item_row.tax_amount)
            grand_total_amount += flt(item_row.total_amount) # Assuming total_amount = amount + tax_amount

        self.amount = total_items_amount
        self.tax_amount = total_items_tax_amount
        self.total_amount = grand_total_amount # This is your grand total including tax

    # --- Standard Frappe Hooks called by the Framework ---
    def validate(self):
        """
        Called before save. Good place for validations and calculations
        that affect the document itself before it's written.
        """
        self.calculate_totals_from_items()
        # Add any other validations for ProcurementOrders document here

    def on_update(self):
        """
        Called after the document is saved to the database (both on insert and update).
        Might not be strictly necessary to call calculate_totals_from_items here
        if `validate` already does it and ensures correct values before save.
        However, if other processes might modify child items without triggering parent validate,
        this can be a fallback. Be cautious of recursive save loops.
        """
        # If you are SURE that `validate` always runs before any save that could
        # affect totals, you might not need it here.
        # For now, let's comment it out from on_update to avoid potential save loops
        # if an update to a child triggered the parent's on_update, which then saved again.
        # self.calculate_totals_from_items() # Re-evaluate if needed
        pass

    # You can also use before_save if you want calculations done
    # just before the final database write, after all validations.
    # def before_save(self):
    #     self.calculate_totals_from_items()

# Note: The hooks like `after_insert` and `on_update` defined in hooks.py for "Procurement Orders"
# will still run *in addition* to these class methods. The class methods `validate`, `on_update`, etc.,
# are standard Frappe ways to embed logic directly within the DocType's controller.