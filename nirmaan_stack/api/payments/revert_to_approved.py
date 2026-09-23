# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Send a Reconciliation Pending payment back to Approved (owner, 2026-09-21).

URL: /api/method/nirmaan_stack.api.payments.revert_to_approved.revert_payment_to_approved

"Mark as Paid" moves Approved -> Reconciliation Pending by writing the STATUS ALONE -- the UTR,
date and proof are captured later, at Mark Reconciled (`AccountantTabs.handleMarkPaid`, and
`services/cheque_payments.move_to_reconciliation` for a cheque). So the way back writes the status
alone too: there is nothing else to undo. From Approved the payment can be marked paid again or
deleted, both of which the "Payment need to paid" tab already offers.

What the move does NOT do, checked against the hooks:
  * no second TDS deduction -- `payment_tds.is_approval_from_an_earlier_step` counts only
    Requested / CEO Pending / Rejected -> Approved as an approval;
  * no notification -- no `on_update` branch keys on Reconciliation Pending -> Approved;
  * no stored figure moves -- `amount_paid`, vendor credit and the CEO Hold gap count Paid alone.
The PO payment term follows the status through the ordinary `on_update` sync.

⚠️ REFUSED WHILE A BANK LINE IS MATCHED TO IT. A live `Outflow Row Match` would be left pointing at
a payment the statement says went out; the match is undone in Bulk Import first.
"""

import frappe
from frappe import _

from nirmaan_stack.services import settlement
from nirmaan_stack.services.outflow_import.allocation import MATCH_SETTLED
from nirmaan_stack.services.role_profiles import PAYMENT_SETTLE_PROFILES

PAYMENT = "Project Payments"


def _authorize():
	user = frappe.session.user
	if user == "Administrator":
		return
	if frappe.db.get_value("Nirmaan Users", user, "role_profile") in PAYMENT_SETTLE_PROFILES:
		return
	frappe.throw(
		_("Only an Admin, Accountant or Accountant Lead can revert a payment."),
		frappe.PermissionError,
	)


@frappe.whitelist(methods=["POST"])
def revert_payment_to_approved(name: str) -> dict:
	_authorize()

	# Row lock first: a Mark Reconciled racing this call waits, then re-reads the status it left.
	status = frappe.db.get_value(PAYMENT, name, "status", for_update=True)
	if status is None:
		frappe.throw(_("Payment {0} was not found.").format(name), frappe.DoesNotExistError)
	if (status or "").strip() != settlement.STATUS_RECONCILIATION_PENDING:
		frappe.throw(
			_("Only a Reconciliation Pending payment can be reverted. {0} is {1}.").format(name, status),
			title=_("Cannot revert"),
		)
	if frappe.db.exists(
		"Outflow Row Match",
		{"target_doctype": PAYMENT, "target_name": name, "match_kind": MATCH_SETTLED},
	):
		frappe.throw(
			_(
				"{0} is matched to a bank statement line. Undo that match in Bulk Import Outflow "
				"before reverting it."
			).format(name),
			title=_("Matched to a bank line"),
		)

	doc = frappe.get_doc(PAYMENT, name)
	doc.status = settlement.STATUS_APPROVED
	doc.save(ignore_permissions=True)
	frappe.db.commit()

	return {"name": doc.name, "status": doc.status}
