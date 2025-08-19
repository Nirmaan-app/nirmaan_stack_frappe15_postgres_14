# Copyright (c) 2024, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.utils import flt
from frappe.model.document import Document
from frappe.model.naming import getseries


class ProjectPayments(Document):
	def autoname(self):
		project = self.project.split("-")[-1]
		prefix = f"PAY-{project}-"
		self.name = f"{prefix}{getseries(prefix, 3)}"

	def validate(self):
		"""
		Called before save. Good place for validations and calculations
		that affect the document itself before it's written.
		"""
		doc = frappe.get_doc(self.document_type, self.document_name)

		payments = frappe.get_all("Project Payments",
			filters={
				"document_type": self.document_type,
				"document_name": self.document_name,
				"status": "Paid"
			},
			fields=["amount"]
		)
		
		total_paid = sum(flt(p.amount) for p in payments)

		if flt(self.amount) + total_paid > flt(doc.total_amount) + 10.0:
			frappe.throw(
				_("Total payment amount cannot exceed the total amount of the document."),
				title=_("Payment Amount Exceeds Total")
			)

	
	def on_update(self):
		"""
        Triggered after a document is saved.
        We check if the status has just changed to 'Paid'.
        """
		old_doc = self.get_doc_before_save()
		if not old_doc:
			if self.status == "Paid":
				self.update_parent_amount_paid()
				return
			else:
				return

        # Trigger recalculation only when status changes TO 'Paid'
		if old_doc.status != "Paid" and self.status == "Paid":
			self.update_parent_amount_paid()

        # Also trigger if a 'Paid' payment is changed to something else (e.g., 'Rejected')
		if old_doc.status == "Paid" and self.status != "Paid":
			self.update_parent_amount_paid()
			

	def on_trash(self):
		"""
        Triggered when a document is 'Cancelled' (deleted).
        We only need to recalculate if the deleted payment was 'Paid'.
        """
		if self.status == "Paid":
			self.update_parent_amount_paid()

	def update_parent_amount_paid(self):
		"""
        Calculates and updates the 'amount_paid' on the parent document using
        the recommended ORM method (frappe.get_all).
        """
		if not self.document_type or not self.document_name:
			return

        # --- 1. Fetch all relevant payment amounts in a single query ---
        # frappe.get_all is the ORM equivalent of a SELECT statement.
        # It's efficient because it fetches only the 'amount' field for all
        # matching documents in one database trip.
		paid_payments = frappe.get_all(
            "Project Payments",
            filters={
                "document_type": self.document_type,
                "document_name": self.document_name,
                "status": "Paid"
            },
            fields=["amount"]  # Specify only the field we need
        )
		print(f"DEBUGGPS: Fetched {len(paid_payments)} paid payments for {self.document_type} {self.document_name}")

        # --- 2. Calculate the total in Python ---
        # paid_payments is a list of dictionaries, e.g., [{'amount': 100}, {'amount': 250}]
        # We use a list comprehension and sum() to calculate the total.
        # flt() ensures each value is a float before summing.
		total_paid = sum(flt(p.amount) for p in paid_payments)
		print(f"DEBUGGPS: Total amount paid for {self.document_type} {self.document_name}: {total_paid}")

        # --- 3. Update the parent document ---
		try:
			frappe.db.set_value(self.document_type, self.document_name, "amount_paid", total_paid)
			print(f"DEBUGGPS: Updated amount_paid for {self.document_type} {self.document_name} to {total_paid}")
			frappe.db.commit()
		except Exception as e:
			frappe.log_error(
                message=f"Failed to update amount_paid for {self.document_type} {self.document_name}. Error: {str(e)}",
                title="Project Payment Sync Error"
            )