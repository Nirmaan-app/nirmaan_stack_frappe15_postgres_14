# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document

from nirmaan_stack.services.reimbursements.rules import REJECTED, rejection_problem


class Reimbursement(Document):
	def validate(self):
		self.save_claimant()
		self.check_shape()

	def save_claimant(self):
		"""On the first save, keep who raised the claim on the claim itself: their name and role profile as they
		are now, so the claim still names them, and the approval rule still knows whether they are in HR, if the
		user is later renamed, moved to another role or deleted (owner, 2026-10-22)."""
		if not self.is_new():
			return
		person = frappe.db.get_value("Nirmaan Users", self.owner, ["full_name", "role_profile"], as_dict=True)
		if person:
			self.claimant_name = person.full_name
			self.claimant_role = person.role_profile

	def check_shape(self):
		"""The shape every save keeps, whichever path writes it: a title, an amount above ₹0, and a reason
		on a rejected claim. Who may raise, edit or decide is the endpoints' (`api/reimbursements`)."""
		self.title = (self.title or "").strip()
		if not self.title:
			frappe.throw(_("Enter a title."))
		if (self.amount or 0) <= 0:
			frappe.throw(_("Enter an amount above ₹0."))
		if self.status == REJECTED:
			problem = rejection_problem(self.rejection_reason)
			if problem:
				frappe.throw(_(problem))
