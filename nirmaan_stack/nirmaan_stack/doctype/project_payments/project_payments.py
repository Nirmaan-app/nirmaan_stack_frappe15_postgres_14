# Copyright (c) 2024, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.utils import flt
from frappe.model.document import Document
from frappe.model.naming import getseries

from nirmaan_stack.services import settlement
from nirmaan_stack.services.cheque_payments import is_cheque

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
		self._validate_cheque()

	def _validate_cheque(self):
		"""A cheque carries its number and date, and keeps its amount.

		`mode_of_payment` itself is `set_only_once` in the doctype, so Frappe refuses any change
		to it after creation (owner, 2026-09-19).

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
		"""
        Triggered after a document is saved.
        We check if the status has just changed to 'Paid'.
        """
		# Skip all hook logic when created by PO Revision — revision_logic.py handles amount_paid itself
		if self.flags.from_adjustment:
			print(f"DEBUG_HOOK: project_payments.on_update skipped for {self.document_name} due to from_adjustment flag")
			
			return

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
        During on_trash the record still exists in DB, so exclude it from the sum.
        """
		if self.status == "Paid":
			self.update_parent_amount_paid(exclude_name=self.name)

	def update_parent_amount_paid(self, exclude_name=None):
		"""
        Calculates and updates the 'amount_paid' on the parent document using
        the recommended ORM method (frappe.get_all).

        Args:
            exclude_name: If provided, exclude this payment record from the sum.
                Used during on_trash when the record still exists in DB.
        """
		if not self.document_type or not self.document_name:
			return

        # --- 1-2. The parent's Paid payments LESS its Vendor Refunds ---
        # The rule has one home (`services/vendor_refunds.amount_paid_of`), shared with the refund hook
        # and the PO Adjustment recompute, so settling a payment never writes a refund back out.
		from nirmaan_stack.services.vendor_refunds import amount_paid_of

		total_paid = amount_paid_of(self.document_type, self.document_name, exclude_payment=exclude_name)

        # --- 3. Update the parent document ---
		try:
			frappe.db.set_value(self.document_type, self.document_name, "amount_paid", total_paid)

			# `total_tds` rides THIS recompute rather than having its own trigger, and the
			# co-location is the design: both totals are sums over the SAME population (this
			# parent's Paid payments), so computing them in one pass is what makes it impossible
			# for a Service Request to report tax withheld on money it has not paid. It no-ops
			# for any parent outside `payment_tds.DEDUCTIBLE_PARENTS` — a Procurement Order has
			# no `total_tds` field to write to.
			from nirmaan_stack.services import payment_tds

			payment_tds.sync_total_tds(
				self.document_type, self.document_name, exclude_payment=exclude_name
			)

			# `amount_due` on the parent is derived from `amount_paid`, so it moves with it.
			# PO: amount_invoiced - amount_paid | SR: total_amount - amount_paid -- deliberately
			# different formulas; the helper owns that split.
			from nirmaan_stack.api.invoices._item_billing_sync import (
				recompute_document_amount_due,
			)
			recompute_document_amount_due(self.document_type, self.document_name)
			# print(f"DEBUGGPS: Updated amount_paid for {self.document_type} {self.document_name} to {total_paid}")

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
			if not self.flags.get("from_outflow_import"):
				frappe.db.commit()
		except Exception as e:
			frappe.log_error(
                message=f"Failed to update amount_paid for {self.document_type} {self.document_name}. Error: {str(e)}",
                title="Project Payment Sync Error"
            )