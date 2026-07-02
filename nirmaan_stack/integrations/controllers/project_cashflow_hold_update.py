import json

import frappe
from frappe import _
from frappe.utils import flt

from nirmaan_stack.nirmaan_stack.doctype.projects.projects import CEO_HOLD_SYSTEM_USER
from ..Notifications.pr_notifications import PrNotification

EXCLUDED_STATUSES = ("CEO Hold", "Completed")
FALLBACK_REVERT_STATUS = "WIP"


def evaluate_project_ceo_hold(project_id: str) -> bool:
	"""
	Evaluate a single project: if its cashflow gap exceeds cashflow_gap_limit,
	place it on CEO Hold. Hold-only — never auto-releases.

	Uses frappe.db.set_value(..., update_modified=False) to skip the validate()
	and on_update hooks (so Administrator can write CEO Hold without tripping
	the manual-only check, and so we don't recursively re-trigger ourselves
	from Projects.on_update).

	Returns True if a hold was applied, False otherwise.
	"""
	row = frappe.db.get_value(
		"Projects",
		project_id,
		["status", "cashflow_gap_limit"],
		as_dict=True,
	)
	if not row:
		return False
	if row.status in EXCLUDED_STATUSES:
		return False
	if flt(row.cashflow_gap_limit) <= 0:
		return False

	gap = _compute_cashflow_gap(project_id)
	if gap <= flt(row.cashflow_gap_limit):
		return False

	frappe.db.set_value(
		"Projects",
		project_id,
		{
			"status": "CEO Hold",
			"ceo_hold_by": CEO_HOLD_SYSTEM_USER,
		},
		update_modified=False,
	)
	frappe.logger().info(
		"[cashflow-hold] %s: gap=%.2f > limit=%.2f → CEO Hold"
		% (project_id, gap, flt(row.cashflow_gap_limit))
	)
	return True


def _is_user_owned(owner) -> bool:
	"""A Version is 'user-owned' if its owner is a real user email (contains '@').
	Skips Administrator, the cron's System (Cashflow Cron) marker, and any
	other non-mail actor."""
	return bool(owner) and "@" in owner


def _find_previous_status(project_id: str) -> str:
	"""
	Walk the Version history for this project and return the new_value of the
	most recent user-driven status change (not 'CEO Hold'). Falls back to
	FALLBACK_REVERT_STATUS when no user-driven status change is on record.

	Cron writes use frappe.db.set_value(update_modified=False) which bypasses
	Version creation, so the Version table naturally contains only saves made
	by real users — but we still filter on owner for defense in depth (in case
	a script ever runs a real save() on a project).
	"""
	rows = frappe.db.sql(
		"""
		SELECT data, owner FROM "tabVersion"
		WHERE ref_doctype = 'Projects' AND docname = %s
		ORDER BY creation DESC
		LIMIT 50
		""",
		(project_id,),
	)
	for data_str, owner in rows:
		if not _is_user_owned(owner):
			continue
		try:
			d = json.loads(data_str or "{}")
		except (TypeError, ValueError):
			continue
		for change in d.get("changed") or []:
			if change and len(change) >= 3 and change[0] == "status":
				new_val = change[2]
				if new_val and new_val != "CEO Hold":
					return new_val
	return FALLBACK_REVERT_STATUS


def evaluate_project_ceo_release(project_id: str) -> bool:
	"""
	If a project is on cron-set CEO Hold, restore the most recent user-set
	status from Version history when EITHER:
	  - the limit has been cleared to 0 (user opted out of auto-management), OR
	  - the cashflow gap has dropped at or below cashflow_gap_limit.
	Hands off entirely on human-set holds.

	Returns True if a release was applied, False otherwise.
	"""
	row = frappe.db.get_value(
		"Projects",
		project_id,
		["status", "ceo_hold_by", "cashflow_gap_limit"],
		as_dict=True,
	)
	if not row or row.status != "CEO Hold":
		return False
	if row.ceo_hold_by != CEO_HOLD_SYSTEM_USER:
		# Human-set hold: never auto-release. But if the cashflow gap has
		# recovered to within the limit (an auto-hold would release here), give
		# the holder a heads-up that it's now eligible for a manual release.
		# The hold itself is left untouched.
		manual_limit = flt(row.cashflow_gap_limit)
		if manual_limit > 0 and _compute_cashflow_gap(project_id) <= manual_limit:
			_notify_manual_hold_releasable(project_id, row.ceo_hold_by)
		return False

	limit = flt(row.cashflow_gap_limit)
	if limit <= 0:
		revert_to = _find_previous_status(project_id)
		frappe.db.set_value(
			"Projects",
			project_id,
			{"status": revert_to, "ceo_hold_by": None},
			update_modified=False,
		)
		frappe.logger().info(
			"[cashflow-hold] %s: limit cleared → released to %s" % (project_id, revert_to)
		)
		return True

	gap = _compute_cashflow_gap(project_id)
	if gap > limit:
		return False

	revert_to = _find_previous_status(project_id)
	frappe.db.set_value(
		"Projects",
		project_id,
		{
			"status": revert_to,
			"ceo_hold_by": None,
		},
		update_modified=False,
	)
	frappe.logger().info(
		"[cashflow-hold] %s: gap=%.2f ≤ limit=%.2f → released to %s"
		% (project_id, gap, limit, revert_to)
	)
	return True


def _notify_manual_hold_releasable(project_id: str, holder_user: str) -> None:
	"""Heads-up to the human who manually placed a CEO Hold that the project's
	cashflow gap has recovered to within its limit — i.e. an auto-hold would
	release here, but we never auto-release human-set holds, so the holder must
	release it by hand if appropriate. The hold itself is left untouched.

	Deduped on an UNSEEN notification of this kind for this holder+project, so a
	burst of payment / inflow / PO events while the project sits
	releasable-but-held doesn't spam the holder.
	"""
	if not holder_user:
		return

	# Never notify during migrations / backfills / imports — the bulk evaluator
	# calls the release path directly (bypassing trigger_check's guard), and we
	# don't want a backfill to dump stale "ready to release" notes on the holder.
	if frappe.flags.in_patch or frappe.flags.in_migrate or frappe.flags.in_install or frappe.flags.in_import:
		return

	if frappe.db.exists(
		"Nirmaan Notifications",
		{
			"recipient": holder_user,
			"project": project_id,
			"event_id": "project:ceo_hold_releasable",
			"seen": "false",
		},
	):
		return

	user = frappe.db.get_value(
		"Nirmaan Users",
		{"name": holder_user},
		["fcm_token", "name", "full_name", "role_profile", "push_notification"],
		as_dict=True,
	)
	if not user:
		return

	project_name = frappe.db.get_value("Projects", project_id, "project_name") or project_id
	title = _("Project Ready to Release from CEO Hold")
	description = _(
		"{0}'s cashflow is now within its limit. It is on a manual CEO Hold placed by you — "
		"please release it manually if appropriate."
	).format(project_name)

	# FCM push only if the holder opted in.
	if user.get("push_notification") == "true":
		PrNotification(
			user, title, description,
			f"{frappe.utils.get_url()}/frontend/projects/{project_id}",
		)

	# In-app Nirmaan Notification.
	note = frappe.new_doc("Nirmaan Notifications")
	note.update({
		"recipient": user.get("name"),
		"recipient_role": user.get("role_profile"),
		"sender": frappe.session.user if frappe.session.user != "Administrator" else None,
		"title": title,
		"description": description,
		"document": "Projects",
		"docname": project_id,
		"project": project_id,
		"seen": "false",
		"type": "info",
		"event_id": "project:ceo_hold_releasable",
		"action_url": f"projects/{project_id}",
	})
	note.insert(ignore_permissions=True)
	frappe.db.commit()  # commit before realtime publish (avoids race)

	frappe.publish_realtime(
		event="project:ceo_hold_releasable",
		message={
			"title": title,
			"description": description,
			"project": project_id,
			"sender": frappe.session.user,
			"docname": project_id,
			"notificationId": note.name,
		},
		user=user.get("name"),
	)


def update_projects_cashflow_hold():
	"""
	Bulk evaluator — used by the weekly safety-net cron and by the
	backfill_cashflow_gap_limited patch. Realtime evaluation is driven
	by doc_events on the source doctypes; this remains as a catch-up
	for direct SQL writes, partial rollbacks, or missed events.

	Evaluates BOTH directions (hold + release) for every non-completed
	project. evaluate_project_ceo_hold early-exits on already-held projects;
	evaluate_project_ceo_release early-exits on non-held projects — so the
	two passes are mutually exclusive per project.
	"""
	projects = frappe.db.sql(
		"""
		SELECT name FROM "tabProjects"
		WHERE status != 'Completed'
		  AND (
		    cashflow_gap_limit > 0
		    OR (status = 'CEO Hold' AND ceo_hold_by = %s)
		  )
		""",
		(CEO_HOLD_SYSTEM_USER,),
		pluck="name",
	)

	for project_id in projects:
		if not evaluate_project_ceo_hold(project_id):
			evaluate_project_ceo_release(project_id)

	frappe.db.commit()


# --- Realtime evaluation: doc_event entry points ---


def trigger_check(project_id):
	"""Evaluate one project for CEO Hold. Deduped per request, skipped during bulk loads."""
	if not project_id:
		return
	if frappe.flags.in_import or frappe.flags.in_patch or frappe.flags.in_migrate or frappe.flags.in_install:
		return

	# Dedup within a single request: Frappe fires both `after_insert` and
	# `on_update` on a fresh insert, so the same Payment / Expense / Inflow
	# save would otherwise drive two gap recomputations. The first call
	# claims the flag; subsequent calls in the same request bail in O(1).
	flag_key = f"ceo_hold_checked:{project_id}"
	if frappe.flags.get(flag_key):
		return
	frappe.flags[flag_key] = True

	try:
		# Bidirectional: try the hold path first (covers gap rising over limit);
		# if nothing flipped, try the release path (covers gap dropping back
		# under limit or limit being raised). At most one of them mutates state
		# per call because their early-exits are mutually exclusive on status.
		if not evaluate_project_ceo_hold(project_id):
			evaluate_project_ceo_release(project_id)
	except Exception:
		# Never let a hold/release failure block the user's save.
		frappe.log_error(frappe.get_traceback(), f"CEO Hold evaluation failed for {project_id}")


def on_project_payment(doc, method=None):
	"""
	Cashflow gap counts only Paid payments (see _compute_cashflow_gap).
	Skip the evaluation for any status that doesn't touch the gap
	(Requested / CEO Pending / Approved / Rejected).

	Fires only when:
	  * a row enters Paid (status flipped to 'Paid')
	  * a row leaves  Paid (status flipped away from 'Paid')
	  * a Paid row is trashed
	"""
	
	if not doc.has_value_changed("status"):
		return

	prev_status = (doc.get_doc_before_save() or {}).get("status") if not doc.is_new() else None
	if doc.status == "Paid" or prev_status == "Paid":
		trigger_check(doc.project)


def on_project_expense(doc, method=None):
	"""
	Cashflow gap counts only Paid expenses (see _compute_cashflow_gap), so — like
	on_project_payment — only re-evaluate the CEO Hold when a row enters or leaves
	Paid. Adding / editing a Requested or Approved expense does NOT touch the gap
	and is skipped.

	Fires only when:
	  * a row enters Paid (status flipped to 'Paid', incl. created directly as Paid)
	  * a row leaves  Paid (status flipped away from 'Paid')
	  * a Paid row is deleted (wired to after_delete — NOT on_trash — so the gap
	    query runs after the DB row is gone and reflects the deletion)
	Project Expenses uses 'projects' (plural) as the link field.
	"""
	if not doc.has_value_changed("status"):
		return

	prev_status = (doc.get_doc_before_save() or {}).get("status") if not doc.is_new() else None
	if doc.status == "Paid" or prev_status == "Paid":
		trigger_check(doc.projects)


def on_project_inflow(doc, method=None):
	trigger_check(doc.project)


def on_procurement_order(doc, method=None):
	# PO contributes to the gap only via po_amount_delivered + amount_paid.
	# has_value_changed returns True when there is no prior save state
	# (insert / trash), so this single check covers all three events:
	# always fire on insert + trash, fire on update only when these fields
	# actually moved.
	if doc.has_value_changed("po_amount_delivered") or doc.has_value_changed("amount_paid"):
		trigger_check(doc.project)


def _compute_cashflow_gap(project_id: str) -> float:
	"""
	Mirror of the frontend formula in projects.tsx (lines 462-477):
	    gap = (paid_payments + all_expenses + liabilities) - all_inflows
	    liabilities = Σ po_amount_delivered − Σ min(amount_paid, po_amount_delivered)
	"""
	paid_payments = frappe.get_all(
		"Project Payments",
		filters=[["project", "=", project_id], ["status", "=", "Paid"]],
		fields=["amount"],
	)
	expenses = frappe.get_all(
		"Project Expenses",
		# Only Paid expenses count as outflow (mirrors the Paid-only Project Payments
		# filter above); Requested/Approved-but-unpaid expenses don't affect the gap.
		filters=[["projects", "=", project_id], ["status", "=", "Paid"]],  # 'projects' (plural) is correct
		fields=["amount"],
	)
	outflow = sum(flt(p.amount) for p in paid_payments) + sum(flt(e.amount) for e in expenses)

	inflows = frappe.get_all(
		"Project Inflows",
		filters=[["project", "=", project_id]],
		fields=["amount"],
	)
	inflow = sum(flt(i.amount) for i in inflows)

	pos = frappe.get_all(
		"Procurement Orders",
		filters=[["project", "=", project_id]],
		fields=["po_amount_delivered", "amount_paid"],
	)
	payable = sum(flt(po.po_amount_delivered) for po in pos)
	paid_against_delivered = sum(
		min(flt(po.amount_paid), flt(po.po_amount_delivered)) for po in pos
	)
	liabilities = payable - paid_against_delivered

	return outflow + liabilities - inflow
