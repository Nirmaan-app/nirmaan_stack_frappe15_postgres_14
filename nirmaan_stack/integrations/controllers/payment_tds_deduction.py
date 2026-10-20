# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Keep a TDS challan's `reconciled_amount`, and the Work Order's figures, true when a deduction is
deleted through the doc layer.

⚠️ "TDS" HERE IS **TAX DEDUCTED AT SOURCE**, not the Technical Data Sheet family.

A challan's `reconciled_amount` is the SUM of the deductions pointing at it. `pay_tds` re-derives it
when tax is paid; this hook re-derives it when a deduction goes away, so a deleted deduction stops
being counted as spent. Without it a challan keeps showing money used against a row that no longer
exists, and its remaining balance reads short forever.

A deduction on a PAID payment is also part of its Work Order's Amount Paid, `total_tds` and Amount Due
(ADR-0034 Amendment A), and of its project's outflow (#1510), so `after_delete` recounts the Work Order
and re-checks the project's CEO Hold (`after_delete`).

⚠️ THIS HOOK IS HALF THE COVERAGE, NOT ALL OF IT. It fires only on a DOC-LAYER delete (Desk, the
REST API, `frappe.delete_doc`). The cascade that matters most — deleting a Project Payment — removes
the row with a RAW `frappe.db.delete`, which fires no hooks at all, so
`controllers/project_payments.on_trash` recomputes explicitly. Both paths call the same service
function; neither is redundant, because neither covers the other's route.
"""

import frappe

from nirmaan_stack.integrations.controllers.project_cashflow_hold_update import recheck_after_recount
from nirmaan_stack.services.amount_paid import write_amount_paid
from nirmaan_stack.services.payment_tds import PAID, PAYMENT_DOCTYPE, recompute_challan_reconciled


def on_trash(doc, method=None):
	"""Re-derive the challan's total AFTER this row is gone.

	`on_trash` runs BEFORE the row leaves the table, so recomputing here would still count the
	deduction being deleted. The work is therefore deferred to after the commit, which is also what
	keeps a failure here from blocking the delete the user asked for.
	"""
	challan = doc.get("tds_challan")
	if not challan:
		return

	# ⚠️ MUST NOT RAISE INTO THE DELETE. Correcting a bookkeeping total is a side-effect of the
	# delete, never a reason to refuse it -- the same treatment the payments controller gives its
	# own notification fan-out.
	def _recompute():
		try:
			recompute_challan_reconciled(challan)
		except Exception:
			frappe.log_error(
				title="TDS challan recompute failed after deduction delete",
				message=f"challan={challan} deduction={doc.name}\n{frappe.get_traceback()}",
			)

	frappe.db.after_commit.add(_recompute)


def after_delete(doc, method=None):
	"""Recount the order of this deduction's payment through the one writer, now the row is gone, when
	the payment is Paid: only a Paid payment's tax counts in its Work Order's Amount Paid, `total_tds` and
	Amount Due, and in its project's outflow. Then re-check that project's CEO Hold, after the recount
	(`recheck_after_recount`). Any other status moves nothing.

	This runs on a forced delete of the deduction (`frappe.delete_doc(..., force=True)`): a plain delete
	from Desk or REST is refused, because the payment's `Project Payments.payment_tds` links to it.

	`after_delete`, never `on_trash`: the writer reads the deduction rows, and this one must be gone. The
	payment's own delete removes its deduction by raw SQL, so this never runs for it; that path recounts
	in `controllers/project_payments.on_trash`. Logged, not raised, like the payment's own recount, so a
	delete never fails on a bookkeeping total (the Amount Paid Mismatch report shows the order instead).
	"""
	payment = frappe.db.get_value(
		PAYMENT_DOCTYPE,
		doc.get("project_payment"),
		["status", "document_type", "document_name", "project"],
		as_dict=True,
	)
	if not payment or payment.status != PAID:
		return
	try:
		write_amount_paid(payment.document_type, payment.document_name)
	except Exception:
		frappe.log_error(
			title="Amount Paid recount failed after deduction delete",
			message=f"deduction={doc.name} payment={doc.get('project_payment')}\n{frappe.get_traceback()}",
		)
		return
	recheck_after_recount(payment.project)
