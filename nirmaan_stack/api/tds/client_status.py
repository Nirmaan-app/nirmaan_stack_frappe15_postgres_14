# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The client's answer on an Admin-approved Project TDS row: its **Client Status** (ADR-0025
Amendment B). This is the one write path for it.

A row carries a Client Status beside `tds_status`, never instead of it: `tds_status` stays
`Approved`. `set_client_status` marks rows *Approved by Client* or *Rejected by Client*, or clears the
answer, stamping who and when on every mark or switch.

The frontend reads these strings from `frontend/src/utils/tdsRequestRules.ts` (`CLIENT_STATUS`,
`CLIENT_STATUS_ACTION`); its parity test pins the stored values in `submit.py` and the actions below.
"""

import frappe
from frappe import _

from nirmaan_stack.api.tds.approve import parse_names
from nirmaan_stack.api.tds.status_label import history_status_label
from nirmaan_stack.api.tds.submit import (
	CLIENT_STATUS_APPROVED,
	CLIENT_STATUS_REJECTED,
	ROW_DOCTYPE,
	STATUS_APPROVED,
)
from nirmaan_stack.services.role_profiles import (
	ADMIN_PROFILE,
	PMO_EXECUTIVE_PROFILE,
	has_role_profile,
	is_nirmaan_admin,
)

# The `action` argument of `set_client_status`.
ACTION_MARK_APPROVED = "mark_approved"
ACTION_MARK_REJECTED = "mark_rejected"
ACTION_CLEAR = "clear"

# Who may mark (set or switch). Only an Admin may clear.
MARK_PROFILES = (ADMIN_PROFILE, PMO_EXECUTIVE_PROFILE)

_MARKS = {ACTION_MARK_APPROVED: CLIENT_STATUS_APPROVED, ACTION_MARK_REJECTED: CLIENT_STATUS_REJECTED}
_ROW_SAVEPOINT = "tds_client_status_row"


def _require_rights(action):
	user = frappe.session.user
	if user == "Guest":
		frappe.throw(_("Authentication required."), frappe.PermissionError)
	if action == ACTION_CLEAR:
		if not is_nirmaan_admin(user):
			frappe.throw(_("Only Admin can clear a Client Status."), frappe.PermissionError)
	elif not has_role_profile(user, MARK_PROFILES):
		frappe.throw(_("Only Admin or PMO Executive can mark a Client Status."), frappe.PermissionError)


def _apply(row, action, reason):
	"""Write `action` onto one row read under its lock. Raises ValidationError when the row can't take it."""
	if row.tds_status != STATUS_APPROVED:
		frappe.throw(
			_("Only an Admin-approved row can have a Client Status; this row is {0}.").format(
				history_status_label(row.tds_status)
			)
		)
	if action == ACTION_CLEAR:
		if not row.client_status:
			frappe.throw(_("This row has no Client Status to clear."))
		row.client_status = ""
		row.client_status_by = None
		row.client_status_on = None
		row.client_rejection_reason = ""
		return
	row.client_status = _MARKS[action]
	row.client_status_by = frappe.session.user
	row.client_status_on = frappe.utils.now_datetime()
	row.client_rejection_reason = (reason or "").strip() if action == ACTION_MARK_REJECTED else ""


@frappe.whitelist(methods=["POST"])
def set_client_status(doc_names, action, reason=None):
	"""Mark Project TDS rows *Approved by Client* / *Rejected by Client*, or clear their Client Status.

	`doc_names`: JSON list (or list) of `Project TDS Item List` names.
	`action`: `mark_approved`, `mark_rejected` (Admin or PMO Executive) or `clear` (Admin only).
	`reason`: the client's reason, kept on `mark_rejected` only; `mark_approved` and `clear` blank it.

	Every row must be Admin-approved (`tds_status = Approved`). Each row runs under its own savepoint;
	a refused row is reported and the rest still save. Commits once.

	Returns `{"status": "success", "updated": <int>, "errors": [{"name", "error"}, ...]}`.
	"""
	if action not in (*_MARKS, ACTION_CLEAR):
		frappe.throw(_("Unknown Client Status action: {0}").format(action))
	_require_rights(action)

	names = parse_names(doc_names)
	if not names:
		frappe.throw(_("No TDS rows selected."))

	updated = 0
	errors = []
	for name in names:
		frappe.db.savepoint(_ROW_SAVEPOINT)
		try:
			row = frappe.get_doc(ROW_DOCTYPE, name, for_update=True)
			_apply(row, action, reason)
			row.save(ignore_permissions=True)
			updated += 1
		except Exception as e:
			frappe.db.rollback(save_point=_ROW_SAVEPOINT)
			frappe.clear_last_message()
			errors.append({"name": name, "error": str(e)})

	frappe.db.commit()
	return {"status": "success", "updated": updated, "errors": errors}
