# Copyright (c) 2024, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

import frappe
from frappe.utils import flt
from frappe.model.document import Document
from frappe.model.naming import getseries
import json


class ServiceRequests(Document):
	def autoname(self):
		project_id = self.project.split("-")[-1]
		#city = f"{self.project_city}".replace(" ", "_")
		prefix = "SR-"
		self.name = f"{prefix}{project_id}-{getseries(prefix, 6)}"

	def on_update(self):
		old_doc = self.get_doc_before_save()
		# print("SR : "+self.name+" , OLD Status: "+old_doc.status+" , New Status: "+self.status)
		if not old_doc:
			return
		if old_doc.gst != self.gst or (old_doc.status in ["Amendment", "Vendor Selected"] and self.status == "Approved"):
			# print("Service Request Approved, calculating total amount...")
			self.calculate_total_amount()
   
    # It's a good practice to move the calculation logic into its own method.
	def calculate_total_amount(self):
		"""
        Calculates the total amount from the service_order_list, applies GST if applicable,
        and updates the total_amount field directly in the database.
        """
		sub_total = 0.0
		# print(f"DEBUGGPS: Service Request {self.name} - Calculating total amount...")

        # --- 1. Safely parse the JSON data ---
		# print(f"DEBUGGPS0: Service Request {self.name} - service_order_list: {self.service_order_list}")
		# if self.service_order_list is not None:
		try:
            # The field stores a JSON string, so we must parse it into a Python object.
			order_data = json.loads(self.service_order_list) if isinstance(self.service_order_list, str) else (self.service_order_list or {})
			# print(f"DEBUGGPS1: Service Request {self.name} - Parsed service_order_list: {order_data}")
            
            # The actual items are inside the "list" key based on your example.
			service_items = order_data.get("list", [])
            
            # --- 2. Calculate the sub_total ---
			for item in service_items:
                # Use frappe.utils.flt to safely convert values to float, defaulting to 0 if invalid/missing.
				# print(f"DEBUGGPS2: Processing item: {item}")
				quantity = flt(item.get("quantity"))
				rate = flt(item.get("rate"))
				sub_total += quantity * rate
		except (json.JSONDecodeError, TypeError):
            # If JSON is malformed or not a string, log an error and stop.
			frappe.log_error(f"Could not parse service_order_list for Service Request {self.name}", "JSON Parsing Error")
			return

        # --- 3. Apply GST ---
		total_amount = sub_total
		# print(f"DEBUGGPS3: Subtotal before GST: {sub_total}")
        # Check if GST is enabled. Frappe often uses '1'/'0' or truthy strings for checkboxes/data fields.
        # A simple check for truthiness is robust enough.
		if self.gst and self.gst.lower() in ["true", "1", "yes"]:
			# print(f"DEBUGGPS4: GST is enabled for Service Request {self.name}")
			gst_amount = sub_total * 0.18
			total_amount += gst_amount

        # --- 4. Update the document ---
        # It's best practice to use frappe.db.set_value to update fields within hooks
        # like on_update or on_submit. This prevents recursive triggers of the same hooks.
		frappe.db.set_value("Service Requests", self.name, "total_amount", total_amount)
		# print(f"DEBUGGPS5: Total amount for Service Request {self.name} calculated as: {total_amount}")