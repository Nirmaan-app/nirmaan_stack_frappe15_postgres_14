# Copyright (c) 2024, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.utils import flt
from frappe.model.document import Document
from frappe.model.naming import getseries

from nirmaan_stack.services import settlement
from nirmaan_stack.services.cheque_payments import is_cheque
from nirmaan_stack.services.cheques.payment_mode import validate_cheque_mode, validate_mode_change

# A cheque's amount is fixed on paper, so it may not move while the payment is still being
# approved -- no L1 amount edit, no CEO part-approval. Past approval it is left alone: the TDS
# netting writes the amount with `db_set` (no validate), and the bank import owns what happens at
# reconciliation.
CHEQUE_AMOUNT_LOCKED_WHILE = (settlement.STATUS_REQUESTED, settlement.STATUS_CEO_PENDING)


class ProjectPayments(Document):
	def autoname(self):
		project = self.project.split("-")[-1]
		prefix = f"PAY-{project}-"
		self.name = f"{prefix}{getseries(prefix, 3)}"

	def validate(self):
		validate_mode_change(self)
		validate_cheque_mode(self)
		self._validate_cheque()

	def _validate_cheque(self):
		"""A cheque carries its number and date, and keeps its amount.

		The mode itself changes only through a Cheque (`services/cheques/payment_mode.validate_mode_change`).

		⚠️ ONE CHEQUE MAY COVER SEVERAL PAYMENTS (owner, 2026-09-19, reversing the same day's
		"one number, one live payment" ruling), so the number is deliberately NOT unique. The
		payments on one cheque also share its reference at reconciliation -- see
		`reference_guard.cheque_siblings_of`.
		"""
		if not is_cheque(self):
			# An online payment has no cheque. A number left on it would still block the
			# duplicate check below for a real cheque carrying the same number.
			self.cheque_no = None
			self.cheque_date = None
			return

		self.cheque_no = (self.cheque_no or "").strip()
		if not self.cheque_no or not self.cheque_date:
			frappe.throw(_("Cheque No and Cheque Date are required for a cheque payment."))

		if flt(self.amount) <= 0:
			frappe.throw(_("A cheque payment must be for an amount greater than zero."))

		before = self.get_doc_before_save()
		if (
			before
			and (before.status or "").strip() in CHEQUE_AMOUNT_LOCKED_WHILE
			and flt(before.amount) != flt(self.amount)
		):
			frappe.throw(
				_(
					"A cheque payment's amount can't be changed: the cheque is written for {0}. "
					"Reject it and request a new one instead."
				).format(frappe.format_value(before.amount, "Currency")),
				title=_("Cheque Amount Is Fixed"),
			)

	def before_insert(self):
		"""
		Called before save. Good place for validations and calculations
		that affect the document itself before it's written.
		"""
		# Skip all validation when created programmatically by PO Revision flow
		if self.flags.from_adjustment:
			print(f"DEBUG_HOOK: project_payments.before_insert skipped for {self.document_name} due to from_adjustment flag")
			return

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

	def update_parent_amount_paid(self):
		"""Recount this payment's order. Kept only for the append-only patch
		`patches/v3_0/backfill_sr_payment_tds_deductions`, which calls it by name; the lifecycle recount
		lives in `integrations/controllers/project_payments.recount_orders`."""
		from nirmaan_stack.integrations.controllers.project_payments import recount_orders

		recount_orders(self, [(self.document_type, self.document_name)])
