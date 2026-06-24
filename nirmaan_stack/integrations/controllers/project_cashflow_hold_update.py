import frappe
from frappe import _
from frappe.utils import flt

from nirmaan_stack.nirmaan_stack.doctype.projects.projects import CEO_HOLD_SYSTEM_USER
from nirmaan_stack.services.ceo_hold import core
from ..Notifications.pr_notifications import PrNotification


def sync_cashflow_reason(project_id: str) -> None:
	"""
	Single entry point for the cashflow-gap hold SOURCE.

	Adds / refreshes / removes THIS project's `cashflow` CEO Hold Reason row to match the
	current gap-vs-limit state, then defers the status mirror to
	`core.recompute_ceo_hold` (the single serialized owner). It never writes
	status / ceo_hold_by directly and never commits — the host save transaction (realtime
	path) or `update_projects_cashflow_hold` (bulk path) owns the commit.

	The `cashflow` reason exists iff the project is active (not Completed), has a positive
	`cashflow_gap_limit`, and its computed gap exceeds that limit. (Replaces the former
	evaluate_project_ceo_hold / evaluate_project_ceo_release pair, which wrote status
	directly — see docs/adr/0004-multi-source-ceo-hold.md.)
	"""
	row = frappe.db.get_value(
		"Projects",
		project_id,
		["status", "ceo_hold_by", "cashflow_gap_limit"],
		as_dict=True,
	)
	if not row:
		return

	limit = flt(row.cashflow_gap_limit)
	over_limit = False
	if row.status != "Completed" and limit > 0:
		gap = _compute_cashflow_gap(project_id)
		over_limit = gap > limit
		if over_limit:
			core.set_reason(
				project_id, core.SOURCE_CASHFLOW, core.cashflow_reason_text(gap, limit)
			)
		else:
			core.clear_reason(project_id, core.SOURCE_CASHFLOW)
	else:
		core.clear_reason(project_id, core.SOURCE_CASHFLOW)

	core.recompute_ceo_hold(project_id)

	# Manual-hold-releasable nudge (unchanged behaviour): a human-set hold never
	# auto-releases; if its gap has now recovered to within the limit, ping the holder so
	# they can release it by hand. A real mail-id in ceo_hold_by == a manual hold.
	if (
		limit > 0
		and not over_limit
		and row.status == "CEO Hold"
		and row.ceo_hold_by
		and "@" in row.ceo_hold_by
	):
		_notify_manual_hold_releasable(project_id, row.ceo_hold_by)


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

	Funnels every selected project through `sync_cashflow_reason`, which manages that
	project's `cashflow` hold reason and defers the status mirror to
	`core.recompute_ceo_hold`. Selects active projects with a positive limit OR any
	project currently held by the cashflow system marker (so a recovered hold is released).
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
		sync_cashflow_reason(project_id)

	frappe.db.commit()


# --- Realtime evaluation: doc_event entry points ---


def trigger_check(project_id):
	"""Re-evaluate one project's cashflow hold reason. Deduped per request, skipped during bulk loads."""
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
		sync_cashflow_reason(project_id)
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
