"""
Whitelisted APIs for the `Project Schedule` doctype.

Lifecycle:
- `ensure_project_schedule(project_id)` is idempotent and is called BOTH
  from the SetupProgressTrackingDialog wizard's save flow AND lazily on
  Schedule-tab mount. It creates the Project Schedule doc if missing and
  reconciles child rows against `Projects.project_work_header_entries`,
  preserving any user overrides on surviving rows.

- `update_milestone_dates` / `reset_milestone_dates` are called by the
  Schedule tab UI for per-row edits.

Date semantics:
- Every milestone row carries `start_date` / `end_date`, computed from the
  project window (project_start_date, project_end_date) against the master
  Work Milestones' week_1..week_9 anchors — same formula the schedule grid
  uses on the frontend.
- When the project window changes, the Projects.on_update hook re-runs
  reconcile, which recomputes formula dates for all rows EXCEPT those
  flagged `changed_by_user = 1` (manual overrides stay frozen).
- `update_milestone_dates` sets `changed_by_user = 1` + stamps the user
  directly. `reset_milestone_dates` recomputes formula dates and clears the
  flags.
"""

from datetime import date, datetime, timedelta

import frappe


def _truthy(val):
	"""project_work_header_entries.enabled is a Data field that has been
	written as both "1"/"0" strings and Python booleans over time. Normalize."""
	if val is True or val == 1:
		return True
	if isinstance(val, str) and val.strip().lower() in ("1", "true", "yes"):
		return True
	return False


def _enabled_headers(project_doc):
	return [
		e.project_work_header_name
		for e in (project_doc.get("project_work_header_entries") or [])
		if _truthy(e.get("enabled")) and e.get("project_work_header_name")
	]


_NUM_WEEK_SLOTS = 9


def _coerce_date(value):
	"""Project_start_date / project_end_date come back as either a date,
	a datetime, or a string ('YYYY-MM-DD HH:MM:SS' or 'YYYY-MM-DD'). Normalise
	to a python date — return None on any unparseable input."""
	if not value:
		return None
	if isinstance(value, datetime):
		return value.date()
	if isinstance(value, date):
		return value
	if isinstance(value, str):
		try:
			return datetime.strptime(value, "%Y-%m-%d %H:%M:%S").date()
		except ValueError:
			pass
		try:
			return datetime.strptime(value, "%Y-%m-%d").date()
		except ValueError:
			return None
	return None


def _compute_milestone_dates(project_start, project_end, master_row):
	"""Mirror `useProjectScheduler.ts` formula. Returns (start, end) python
	dates, or (None, None) when the master has no scheduled weeks or the
	project window is invalid."""
	start = _coerce_date(project_start)
	end = _coerce_date(project_end)
	if not start or not end:
		return None, None
	duration_days = (end - start).days + 1
	if duration_days <= 0:
		return None, None
	week_slot_days = duration_days / _NUM_WEEK_SLOTS

	weeks = [int(master_row.get(f"week_{i + 1}") or 0) for i in range(_NUM_WEEK_SLOTS)]
	first_week_idx = -1
	last_non_zero_idx = -1
	completion_week_idx = -1
	for i in range(_NUM_WEEK_SLOTS):
		if weeks[i] > 0:
			if first_week_idx == -1:
				first_week_idx = i
			last_non_zero_idx = i
		if completion_week_idx == -1 and weeks[i] >= 100:
			completion_week_idx = i
	last_week_idx = completion_week_idx if completion_week_idx != -1 else last_non_zero_idx

	if first_week_idx == -1:
		return None, None

	row_start_offset = round(first_week_idx * week_slot_days)
	row_end_offset = round((last_week_idx + 1) * week_slot_days) - 1
	# For projects shorter than 9 days, week_slot_days < 1, so rounding can
	# push offsets either outside the project window or land end below start.
	# Clamp both into the window first, then enforce end >= start so a
	# milestone collapses to a single day rather than inverting.
	last_offset = max(0, duration_days - 1)
	row_start_offset = max(0, min(row_start_offset, last_offset))
	row_end_offset = max(0, min(row_end_offset, last_offset))
	row_end_offset = max(row_end_offset, row_start_offset)

	row_start = start + timedelta(days=row_start_offset)
	row_end = start + timedelta(days=row_end_offset)
	return row_start, row_end


def _desired_milestones(enabled_headers):
	"""Return Work Milestones whose header is enabled, with the week_1..week_9
	anchors needed to compute formula dates. We key on `work_milestone_name`
	(the human-readable Data field) rather than `name` (a random hash on this
	doctype) so child rows are readable in Desk and match the Project Progress
	Report's `work_milestone_name` Data column."""
	if not enabled_headers:
		return []
	week_fields = [f"week_{i}" for i in range(1, _NUM_WEEK_SLOTS + 1)]
	return frappe.get_all(
		"Work Milestones",
		filters={"work_header": ["in", enabled_headers]},
		fields=["work_milestone_name", "work_header"] + week_fields,
		order_by="work_milestone_order asc, work_milestone_name asc",
		limit=0,
	)


def _reconcile_rows(sched_doc, project_doc):
	"""Reconcile sched_doc.milestones against the project's enabled Work
	Milestones AND populate formula dates.

	- Surviving rows (matching pair): kept; formula dates recomputed UNLESS
	  the row is flagged `changed_by_user = 1` (manual override stays frozen).
	- Rows whose pair no longer matches any desired milestone: removed.
	- Desired milestones missing from the doc: appended with formula dates.
	"""
	enabled = _enabled_headers(project_doc)
	desired = _desired_milestones(enabled)
	desired_by_pair = {(m["work_header"], m["work_milestone_name"]): m for m in desired}

	project_start = project_doc.get("project_start_date")
	project_end = project_doc.get("project_end_date")

	existing_pairs = set()
	survivors = []
	for row in sched_doc.milestones or []:
		pair = (row.work_header, row.work_milestone)
		master = desired_by_pair.get(pair)
		if not master:
			continue
		survivors.append(row)
		existing_pairs.add(pair)
		if not row.changed_by_user:
			start, end = _compute_milestone_dates(project_start, project_end, master)
			row.start_date = start
			row.end_date = end

	sched_doc.milestones = survivors

	for m in desired:
		pair = (m["work_header"], m["work_milestone_name"])
		if pair in existing_pairs:
			continue
		start, end = _compute_milestone_dates(project_start, project_end, m)
		sched_doc.append("milestones", {
			"work_header": m["work_header"],
			"work_milestone": m["work_milestone_name"],
			"start_date": start,
			"end_date": end,
			"edited_by_user": None,
			"changed_by_user": 0,
		})


def _disabled_milestone_names_from_latest_report(project_id: str) -> list:
	"""Return the set of work_milestone_name values marked `status='Disabled'`
	in the project's latest completed Project Progress Report (any zone, most
	recent date). Mirrors the source the Settings card preview uses, so the
	Schedule grid stays in sync with what the admin sees there."""
	latest = frappe.get_all(
		"Project Progress Reports",
		filters={"project": project_id, "report_status": "Completed"},
		fields=["name"],
		order_by="report_date desc, modified desc",
		limit=1,
	)
	if not latest:
		return []
	rows = frappe.get_all(
		"Project Progress Report Work Milestones",
		filters={"parent": latest[0].name, "status": "Disabled"},
		fields=["work_milestone_name"],
		limit=0,
	)
	return [r.work_milestone_name for r in rows if r.work_milestone_name]


@frappe.whitelist()
def get_project_schedule(project_id: str):
	"""Read-only fetch. Returns the existing Project Schedule for
	`project_id` (or `None` if it doesn't exist yet) along with the
	disabled-milestone names derived from the latest completed Project
	Progress Report.

	Unlike `ensure_project_schedule`, this NEVER creates or modifies the
	schedule. The Schedule tab uses this on mount; creation is owned by
	the Projects after_insert / on_update hooks (`sync_project_schedule`)
	and the Setup Progress Tracking wizard."""
	if not project_id:
		frappe.throw("project_id is required")
	schedule = None
	if frappe.db.exists("Project Schedule", project_id):
		schedule = frappe.get_doc("Project Schedule", project_id).as_dict()
	return {
		"schedule": schedule,
		"disabled_milestones": _disabled_milestone_names_from_latest_report(project_id),
	}


@frappe.whitelist()
def ensure_project_schedule(project_id: str):
	"""Create-or-reconcile the Project Schedule for `project_id`. Idempotent.

	The response carries the doc plus a `disabled_milestones` list — the names
	of milestones marked Disabled in the latest completed Project Progress
	Report. The Schedule UI uses that list to (a) lock the date-edit pencil
	and (b) drop the milestone from the DPR PDF payload."""
	if not project_id:
		frappe.throw("project_id is required")

	project_doc = frappe.get_doc("Projects", project_id)

	if frappe.db.exists("Project Schedule", project_id):
		sched = frappe.get_doc("Project Schedule", project_id)
	else:
		sched = frappe.new_doc("Project Schedule")
		sched.project = project_id
		sched.flags.is_new = True

	_reconcile_rows(sched, project_doc)

	if sched.flags.get("is_new"):
		sched.insert(ignore_permissions=False)
	else:
		sched.save(ignore_permissions=False)

	frappe.db.commit()
	result = sched.as_dict()
	result["disabled_milestones"] = _disabled_milestone_names_from_latest_report(project_id)
	return result


def _find_row(sched_doc, milestone_row_name: str):
	row = next((r for r in sched_doc.milestones if r.name == milestone_row_name), None)
	if not row:
		frappe.throw(f"Milestone row {milestone_row_name} not found on Project Schedule {sched_doc.name}")
	return row


@frappe.whitelist(methods=["POST"])
def update_milestone_dates(project_id: str, milestone_row_name: str,
                            start_date: str | None = None,
                            end_date: str | None = None):
	"""Manual date override. Stamps `changed_by_user = 1` and `edited_by_user`
	with the session user so the schedule UI shows the 'Manual updated by ...'
	tag and so future window-change recomputes leave this row alone."""
	if not project_id or not milestone_row_name:
		frappe.throw("project_id and milestone_row_name are required")

	sched = frappe.get_doc("Project Schedule", project_id)
	row = _find_row(sched, milestone_row_name)
	row.start_date = start_date or None
	row.end_date = end_date or None
	if row.start_date or row.end_date:
		row.changed_by_user = 1
		row.edited_by_user = frappe.session.user
	else:
		row.changed_by_user = 0
		row.edited_by_user = None
	sched.save(ignore_permissions=False)
	frappe.db.commit()
	return sched.as_dict()


@frappe.whitelist(methods=["POST"])
def reset_milestone_dates(project_id: str, milestone_row_name: str):
	"""Revert a row's dates back to the formula-derived values and clear the
	manual-override flags so future window-change recomputes will keep it in
	sync."""
	if not project_id or not milestone_row_name:
		frappe.throw("project_id and milestone_row_name are required")

	sched = frappe.get_doc("Project Schedule", project_id)
	row = _find_row(sched, milestone_row_name)

	project_doc = frappe.get_doc("Projects", project_id)
	master = frappe.get_all(
		"Work Milestones",
		filters={
			"work_milestone_name": row.work_milestone,
			"work_header": row.work_header,
		},
		fields=["work_milestone_name", "work_header"]
		+ [f"week_{i}" for i in range(1, _NUM_WEEK_SLOTS + 1)],
		limit=1,
	)
	if master:
		row.start_date, row.end_date = _compute_milestone_dates(
			project_doc.project_start_date, project_doc.project_end_date, master[0]
		)
	else:
		row.start_date = None
		row.end_date = None
	row.changed_by_user = 0
	row.edited_by_user = None
	sched.save(ignore_permissions=False)
	frappe.db.commit()
	return sched.as_dict()


def _projects_with_header_enabled(work_header: str) -> list:
	"""Return Project names whose `project_work_header_entries` contains
	`work_header` with a truthy `enabled` flag. Used by Work Milestones master
	hooks to find which schedules need re-syncing."""
	if not work_header:
		return []
	rows = frappe.db.sql(
		"""
		SELECT DISTINCT parent AS project_name, enabled
		FROM "tabProject Work Headers"
		WHERE project_work_header_name = %s
		  AND parenttype = 'Projects'
		""",
		(work_header,),
		as_dict=True,
	)
	return [r["project_name"] for r in rows if _truthy(r.get("enabled"))]


def sync_schedules_for_header(work_header: str):
	"""Fan-out helper: run `sync_project_schedule` on every Project that has
	`work_header` enabled. Used by Work Milestones `after_insert` (a new
	milestone needs to land in each enabled schedule) and `on_update` when
	`week_1..week_9` change (existing schedule rows need date recompute).

	Each project sync runs in a try/except so one failing project doesn't
	break the originating master save."""
	for project_name in _projects_with_header_enabled(work_header):
		try:
			project_doc = frappe.get_doc("Projects", project_name)
			sync_project_schedule(project_doc)
		except Exception:
			frappe.log_error(
				title="Project Schedule fan-out failed",
				message=(
					f"Could not sync Project Schedule for {project_name} "
					f"(header={work_header}): {frappe.get_traceback()}"
				),
			)


def sync_project_schedule(doc, method=None):
	"""Projects after_insert / on_update hook. Keeps the Project Schedule in
	sync with the project's enabled work headers + time window:

	- If a Project Schedule already exists, ALWAYS reconcile — even if every
	  header is now disabled, so disabling the last enabled header empties
	  the schedule cleanly instead of leaving stale rows.
	- If no schedule exists yet AND no headers are enabled, no-op (don't
	  create an empty schedule; it'll be lazily created by
	  `ensure_project_schedule` once the user enables a header).
	- If no schedule exists yet AND at least one header is enabled, create
	  and seed it (one row per enabled-header milestone, formula dates
	  pre-populated against the current window).

	Reconcile preserves `changed_by_user = 1` overrides on surviving rows;
	rows whose header is no longer enabled are dropped (manual override or
	not).

	The project-creation flow inserts the doc first (after_insert), then
	updates it with `project_work_header_entries` (on_update). Wiring this
	function on both events ensures the schedule is created on whichever of
	those two saves first carries the enabled-header set."""
	schedule_exists = frappe.db.exists("Project Schedule", doc.name)
	if not schedule_exists and not _enabled_headers(doc):
		return
	if schedule_exists:
		sched = frappe.get_doc("Project Schedule", doc.name)
		_reconcile_rows(sched, doc)
		sched.save(ignore_permissions=True)
	else:
		sched = frappe.new_doc("Project Schedule")
		sched.project = doc.name
		_reconcile_rows(sched, doc)
		sched.insert(ignore_permissions=True)
