# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Put an Approved PO / WO payment on hold, or release it (owner, 2026-09-22).

URL: /api/method/nirmaan_stack.api.payments.payment_hold.set_payment_hold

Called from the "Payment need to paid" tab. The rules -- who, and that a held payment cannot
leave Approved -- live in `services/payment_hold.py` and run in the doctype's `validate`, so
they hold for every other write path too. This endpoint only gives the tab clear messages and
an idempotent toggle. The save goes through the document, so the doctype's `track_changes`
records who held or released it, and when.
"""

import frappe
from frappe import _
from frappe.utils import sbool

from nirmaan_stack.services import settlement
from nirmaan_stack.services.payment_hold import can_hold_payments

PAYMENT = "Project Payments"


@frappe.whitelist(methods=["POST"])
def set_payment_hold(name: str, hold) -> dict:
	held = sbool(hold)
	if held not in (True, False):
		frappe.throw(_("hold must be true or false."))
	held = bool(held)

	if not can_hold_payments(frappe.session.user):
		frappe.throw(
			_("Only an Admin, Accountant or Accountant Lead can hold or release a payment."),
			frappe.PermissionError,
		)

	# Row lock first: a Mark as Paid racing this call waits, then re-reads what it left.
	current = frappe.db.get_value(PAYMENT, name, ["status", "on_hold"], as_dict=True, for_update=True)
	if current is None:
		frappe.throw(_("Payment {0} was not found.").format(name), frappe.DoesNotExistError)
	if bool(current.on_hold) == held:
		return {"name": name, "on_hold": int(held)}
	if held and (current.status or "").strip() != settlement.STATUS_APPROVED:
		frappe.throw(
			_("Only an Approved payment can be put on hold. {0} is {1}.").format(name, current.status),
			title=_("Cannot hold"),
		)

	doc = frappe.get_doc(PAYMENT, name)
	doc.on_hold = int(held)
	doc.save(ignore_permissions=True)
	frappe.db.commit()

	return {"name": doc.name, "on_hold": doc.on_hold}
