# Copyright (c) 2024, Abhishek and contributors
# For license information, please see license.txt

# import frappe
from frappe.model.document import Document
from frappe.model.naming import getseries
from datetime import datetime


class ProcurementOrders(Document):
	def autoname(self):
		project = self.project.split("-")[-1]
		curr_month = datetime.now().month
		curr_year = datetime.now().year
		fin_yr = str(curr_year)[2:]+"-"+str(curr_year+1)[2:] if curr_month>3 else str(curr_year-1)[2:]+"-"+str(curr_year)[2:] 
		prefix = project
		self.name = f"PO/{getseries(prefix, 3)}/{project}/{fin_yr}"
