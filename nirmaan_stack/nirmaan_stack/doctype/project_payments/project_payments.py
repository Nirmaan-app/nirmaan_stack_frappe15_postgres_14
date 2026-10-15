# Copyright (c) 2024, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.utils import flt
from frappe.model.document import Document
from frappe.model.naming import getseries

from nirmaan_stack.services import settlement
from nirmaan_stack.services.cheque_payments import is_cheque
from nirmaan_stack.services.cheques.payment_mode import validate_mode_change

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

	
	def on_update(self):
		"""Recount the order(s) whose Amount Paid this save moved: the one a Paid payment leaves and the
		one it joins, when it enters or leaves Paid, or when a Paid payment's amount or order changes
		(`services/vendor_refunds.orders_moved_by` names the watched fields, #1453)."""
		# Skip all hook logic when created by PO Revision / PO Adjustment -- that flow recounts itself
		if self.flags.from_adjustment:
			return

		from nirmaan_stack.services.vendor_refunds import orders_moved_by

		for document_type, document_name in orders_moved_by(self.get_doc_before_save(), self):
			self.update_parent_amount_paid(order=(document_type, document_name))

	def on_trash(self):
		"""
        Triggered when a document is 'Cancelled' (deleted).
        We only need to recalculate if the deleted payment was 'Paid'.
        During on_trash the record still exists in DB, so exclude it from the sum.
        """
		if self.status == "Paid":
			self.update_parent_amount_paid(exclude_name=self.name)

	def update_parent_amount_paid(self, exclude_name=None, order=None):
		"""
        Recount `amount_paid` (with the TDS withheld and amount due built on it) on `order`
        (`(document_type, document_name)`; this payment's own order when not given), through the one
        writer `services/vendor_refunds.write_amount_paid`: Paid payments LESS Received Vendor Refunds.

        Args:
            exclude_name: If provided, exclude this payment record from the sum.
                Used during on_trash when the record still exists in DB.
        """
		document_type, document_name = order or (self.document_type, self.document_name)
		if not document_type or not document_name:
			return

		from nirmaan_stack.services.vendor_refunds import write_amount_paid

		try:
			write_amount_paid(document_type, document_name, exclude_payment=exclude_name)

			# ⚠️ THE COMMIT IS SKIPPED FOR THE OUTFLOW IMPORT, AND ONLY FOR IT.
			#
			# Committing INSIDE a save destroys any savepoint the caller is holding. Bulk Import
			# Outflow settles a bank statement row by row, each row inside its own savepoint so
			# that row 3 failing leaves rows 1-2 written and rows 4+ still attempted -- "Confirm 8"
			# must never leave four written and four not. This commit would end that isolation on
			# the first row.
			#
			# The recompute itself still runs, so `amount_paid` is written exactly once and lands
			# in the SAME transaction as the payment, the match record and the import row -- which
			# is stronger than the normal path, not weaker: if the settlement rolls back, so does
			# the total. The import's endpoint commits all of it together.
			#
			# Every other caller is byte-identical to before. Same shape as `from_adjustment`
			# above, which exists because PO Revision hit this exact problem.
			#
			# ⚠️ AND FOR A SPLIT OR UN-SPLIT (`services/payment_split`), for the same reason: its flags
			# mean "inside my savepoint". Un-splitting a Paid part payment changes its amount while it
			# stays Paid, which recounts since #1453; a commit here broke the un-split's savepoint.
			if not any(self.flags.get(flag) for flag in ("from_outflow_import", "split_approval", "split_child")):
				frappe.db.commit()
		except Exception as e:
			frappe.log_error(
                message=f"Failed to update amount_paid for {document_type} {document_name}. Error: {str(e)}",
                title="Project Payment Sync Error"
            )