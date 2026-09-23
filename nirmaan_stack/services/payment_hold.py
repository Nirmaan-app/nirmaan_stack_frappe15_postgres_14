# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Hold an Approved PO / WO payment from being paid (owner, 2026-09-22).

A hold is the `Project Payments.on_hold` flag, never a status. The payment stays `Approved`,
so every figure keyed on status -- payable / pending totals, the request cap, the queue badges,
TDS -- is unchanged; the flag only stops the payment LEAVING Approved until it is released.

Who: Admin, Accountant and Accountant Lead (`PAYMENT_SETTLE_PROFILES`) hold AND release, and
any of them may release a hold another one placed. Mirrored client-side by
`QUEUE_EDIT_PROFILES` in `frontend/src/pages/ProjectPayments/config/queueRowActions.ts`.

⚠️ `validate_hold` IS THE ENFORCEMENT BOUNDARY, not the endpoint. It runs on every save, so it
covers Mark as Paid (a plain REST status write), `update_payment_request` fulfil, the cheque
auto-move and Desk alike. It has to check the role itself too: many roles hold write permission
on this doctype, so without it a hold could be released through Desk or the REST API.
"""

import frappe
from frappe import _

from nirmaan_stack.services import settlement
from nirmaan_stack.services.role_profiles import PAYMENT_SETTLE_PROFILES, has_role_profile


def can_hold_payments(user: str) -> bool:
	"""True when `user` may put a payment on hold or release it. Administrator always passes."""
	return has_role_profile(user, PAYMENT_SETTLE_PROFILES)


def validate_hold(doc) -> None:
	"""The Project Payments `validate` rule for the hold flag. Raises on a refused save."""
	before = None if doc.is_new() else doc.get_doc_before_save()
	was_held = bool(before and before.get("on_hold"))
	held = bool(doc.get("on_hold"))

	if held != was_held and not can_hold_payments(frappe.session.user):
		frappe.throw(
			_("Only an Admin, Accountant or Accountant Lead can hold or release a payment."),
			frappe.PermissionError,
		)

	if not held:
		return

	status = (doc.get("status") or "").strip()
	if status == settlement.STATUS_APPROVED:
		return

	if was_held:
		frappe.throw(
			_("{0} is on hold. Release the hold before moving it to {1}.").format(doc.name, status),
			title=_("Payment on hold"),
		)
	frappe.throw(
		_("Only an Approved payment can be put on hold. {0} is {1}.").format(doc.name, status),
		title=_("Cannot hold"),
	)
