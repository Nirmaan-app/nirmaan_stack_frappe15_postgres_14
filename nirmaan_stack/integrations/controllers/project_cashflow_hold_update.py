import frappe
from frappe import _
from frappe.utils import flt

from nirmaan_stack.nirmaan_stack.doctype.projects.projects import CEO_HOLD_SYSTEM_USER
from nirmaan_stack.services.ceo_hold import core
from nirmaan_stack.services.project_money import project_money_of
from nirmaan_stack.services.vendor_refunds import paid_money
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

	SCHEDULED RECHECK: while the project is in scheduled-recheck mode this returns before
	ANY evaluation — the gap is not computed, the `cashflow` reason row is left frozen, and
	no notification fires. This is the single choke point for the whole cashflow SOURCE, so
	one guard covers every caller: the Payment / Expense / Inflow / PO doc_events (via
	`trigger_check`), the `cashflow_gap_limit` change hook, the daily gap-limit seeder, and
	the bulk `update_projects_cashflow_hold` evaluator. The recheck cron clears the schedule
	first and then calls straight back in here — reusing this same evaluation, never a copy
	of it.
	"""
	row = frappe.db.get_value(
		"Projects",
		project_id,
		["status", "ceo_hold_by", "cashflow_gap_limit", core.RECHECK_SCHEDULED_FIELD],
		as_dict=True,
	)
	if not row:
		return

	if row.get(core.RECHECK_SCHEDULED_FIELD):
		return  # scheduled-recheck mode — only tasks.ceo_hold_recheck may decide.

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

	# ⚠️ AND NEVER DURING A BULK IMPORT OUTFLOW SETTLE, BECAUSE THIS FUNCTION COMMITS (below).
	#
	# This is a CORRECTNESS guard, not a volume one. Bulk Import Outflow settles a bank statement
	# row by row, each row inside its own savepoint, so that row 3 failing leaves rows 1-2 written
	# and rows 4+ still attempted. `frappe.db.commit()` inside that savepoint makes the caller's
	# rollback a silent no-op — a half-written settlement with nothing recording which half.
	#
	# ⚠️ IT GUARDS THE NOTIFY, NOT THE RECOMPUTE, AND THE DISTINCTION IS THE WHOLE POINT.
	# `sync_cashflow_reason` above never commits (it says so, and it is true), so the gap
	# recomputation and the CEO-Hold mirror still run for an imported settlement and land in the
	# import's own transaction. Only this branch — a MANUAL hold that has become releasable, which
	# inserts a notification, commits, and publishes realtime — is skipped. The holder is not told
	# by this particular save; the next event, or the weekly evaluator, tells them.
	#
	# The flag is set by `services/outflow_import/settle.py` around its `doc.save()` calls and
	# cleared in a `finally`. It covers BOTH ledgers: this module is wired to `Project Payments`
	# on_update AND `Project Expenses` on_update, so the payment path was exposed to this same
	# commit before the expense path ever reached it.
	if frappe.flags.get("outflow_import_settling"):
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


def recheck_after_recount(project_id):
	"""Re-evaluate one project's cashflow hold AFTER its orders' Amount Paid was recounted, even when
	this request already checked it (#1453): that earlier check may have read the stale figure. For a
	flow that writes payments with the hooks skipped and recounts at the end (PO Adjustments)."""
	if project_id:
		frappe.flags.pop(f"ceo_hold_checked:{project_id}", None)
		trigger_check(project_id)


def on_project_payment(doc, method=None):
	"""
	Cashflow gap counts only Paid payments (see services/project_money), and its liabilities read the
	POs' stored Amount Paid. So it is re-evaluated only when the payment's paid money moved
	(`services/vendor_refunds.paid_money`: into or out of Paid, or a Paid payment's amount or
	order changed), on the project it leaves and the one it joins, and when a Paid row is deleted.

	⚠️ AFTER THE RECOUNT, NEVER BEFORE (#1453). Bound to on_update, which Frappe runs after the
	payment's own `on_update` has recounted its orders, and to `after_delete` (never `on_trash`), so the
	deleted payment has left both the payment sum and its order's Amount Paid. A payment written by a
	PO Adjustment (`from_adjustment`) skips the recount, so it is skipped here too: the adjustment
	recounts at the end and then calls `recheck_after_recount`.
	"""
	if doc.flags.get("from_adjustment"):
		return
	if method == "after_delete":
		if doc.status == "Paid":
			trigger_check(doc.project)
		return

	before = doc.get_doc_before_save()
	if paid_money(before) != paid_money(doc):
		for project in sorted({p for p in (doc.get("project"), before and before.get("project")) if p}):
			trigger_check(project)


def on_project_expense(doc, method=None):
	"""
	Cashflow gap counts only Paid expenses (see services/project_money), so — like
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
	# PO contributes to the gap only via its liability: po_amount_delivered and
	# amount_paid, counted only while its status is not Merged / Cancelled /
	# Inactive (services/project_money). has_value_changed returns True when there
	# is no prior save state (insert / trash), so this single check covers all three
	# events: always fire on insert + trash, fire on update only when these fields
	# actually moved.
	if any(doc.has_value_changed(field) for field in ("po_amount_delivered", "amount_paid", "status")):
		trigger_check(doc.project)


def _compute_cashflow_gap(project_id: str) -> float:
	"""The project's cashflow gap, from the one server figure `services/project_money` (#1456, ADR-0034).

	The Projects list rollup reads the same function, so the two gaps agree. Kept as the seam the
	CEO Hold tests patch and older patches import.
	"""
	return project_money_of(project_id).cashflow_gap
