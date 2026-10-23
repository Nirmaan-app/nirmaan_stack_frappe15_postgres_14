# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Lifecycle hooks of `Payment TDS Deduction`: the one-source rule on save, and the challan total on delete.

⚠️ "TDS" HERE IS **TAX DEDUCTED AT SOURCE**, not the Technical Data Sheet family.

`validate` refuses a row that names neither or both of a Project Payment and a Non-Project Expense
(#1523; the rule is `services/payment_tds.deduction_link_problem`). It runs on every doc-layer save:
`write_deduction`, Desk, REST, data import. A raw SQL write skips it; the app's raw writes to this
doctype (`pay_tds`, `restate_deduction_on_amount_change`) touch neither link.

`on_trash` keeps a TDS challan's `reconciled_amount` true when a deduction is deleted through the doc
layer. A challan's `reconciled_amount` is the SUM of the deductions pointing at it. `pay_tds` re-derives it
when tax is paid; this hook re-derives it when a deduction goes away, so a deleted deduction stops
being counted as spent. Without it a challan keeps showing money used against a row that no longer
exists, and its remaining balance reads short forever.

⚠️ THIS HOOK IS HALF THE COVERAGE, NOT ALL OF IT. It fires only on a DOC-LAYER delete (Desk, the
REST API, `frappe.delete_doc`). The cascade that matters most — deleting a Project Payment — removes
the row with a RAW `frappe.db.delete`, which fires no hooks at all, so
`controllers/project_payments.on_trash` recomputes explicitly. Both paths call the same service
function; neither is redundant, because neither covers the other's route.
"""

import frappe

from nirmaan_stack.services.payment_tds import deduction_link_problem, recompute_challan_reconciled


def validate(doc, method=None):
	"""Refuse a row that is not the tax of exactly one Project Payment or Non-Project Expense."""
	problem = deduction_link_problem(doc.get("project_payment"), doc.get("non_project_expense"))
	if problem:
		frappe.throw(problem)


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
