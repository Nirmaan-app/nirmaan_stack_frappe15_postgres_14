"""Project TDS "Send For Approval" (Project → TDS → New Request), run on the server (#1374).

The browser used to create each `Project TDS Item List` row itself, compute the request id from
its own cached list, delete the replaced Rejected rows first and upload datasheets last. Any step
failing left half a request behind, and two people sending at once could get the same id.

`submit_tds_request` does the whole send in one transaction:

1. Takes the project's send lock (`_project_send_lock`). That serialises two sends for the same
   project, so the request id and the duplicate check both read what the other send committed.
2. Plans every row from the catalogue (picks) or the cart (requests) and refuses on the first
   problem, before anything is written.
3. Inserts the rows, attaches each request's uploaded datasheet, then deletes the Rejected rows
   they replace, all under one savepoint.

Row kinds (stored `tds_status`), unchanged for users:
  - a pick of an existing Repository Entry → "Pending";
  - a Request New row → "New" (Admin / PMO only, as the dialog already gates it).

A datasheet is uploaded by the browser BEFORE the send, unattached, and its `file_url` is passed
in. The storage app commits inside `File.after_insert`, so an upload can never sit inside this
transaction (`CODING_STANDARDS.md` § Reading uploaded file bytes). A failed send therefore leaves
an orphan upload, never a half-saved request; the cart keeps the File and re-uploads on retry.
"""

import re
from contextlib import contextmanager

import frappe
from frappe import _

from nirmaan_stack.services.role_profiles import (
	ADMIN_PROFILE,
	PMO_EXECUTIVE_PROFILE,
	has_role_profile,
)

ROW_DOCTYPE = "Project TDS Item List"
GROUP_DOCTYPE = "TDS Items"
ENTRY_DOCTYPE = "TDS Repository"

# Mirrors `canRequestNew` in `TdsCreateForm.tsx`, which only decides whether "Request New" shows.
REQUEST_NEW_PROFILES = (ADMIN_PROFILE, PMO_EXECUTIVE_PROFILE)

_SAVEPOINT = "tds_submit_request"


@frappe.whitelist(methods=["POST"])
def submit_tds_request(project, rows):
	"""Save a cart of Project TDS rows for approval: every row, or none.

	`project`: the `Projects` name.
	`rows`: JSON list (or list) of cart rows:
	    {
	        "tds_item_id": "TDS-ITEM-00012",  # "" only for a brand-new-group request
	        "make": "MakeA",
	        "is_new_request": false,           # true ⇒ a Request New row
	        "tds_boq_line_item": "",
	        "description": "",                 # requests only
	        "tds_item_name": "", "work_package": "",  # brand-new-group requests only
	        "tds_attachment": "<file_url>",    # requests only: the sender's unattached upload
	        "previous_doc_name": "<row>",      # a Rejected row this one replaces
	    }

	Refuses (nothing saved) on: an unknown TDS Item, a pick with no Repository Entry, a request
	without its uploaded datasheet, the same TDS Item + make twice in the batch or already live
	(not Rejected) on the project, a replace target that is not a Rejected row of this project
	for the same TDS Item + make, or a Request New row from anyone but Admin / PMO.

	Returns: {"request_id": "RQ-<project suffix>-NN", "names": [<new row names>]}
	"""
	user = frappe.session.user
	cart = _parse_rows(rows)

	if not frappe.db.exists("Projects", project):
		frappe.throw(_("Project {0} not found.").format(project))

	if any(r["is_new_request"] for r in cart) and not has_role_profile(user, REQUEST_NEW_PROFILES):
		frappe.throw(
			_("Only Admin or PMO can request a new TDS item or make."), frappe.PermissionError
		)

	with _project_send_lock(project):
		frappe.db.savepoint(_SAVEPOINT)
		try:
			claimed_files = set()
			planned = [_plan_row(r, user, claimed_files) for r in cart]
			_refuse_duplicates(project, planned)
			_check_replacements(project, planned)
			request_id = _next_request_id(project)

			names = [_insert_row(project, request_id, p) for p in planned]
			# Last, so a Rejected row (and the datasheet it owns, which `delete_doc` removes
			# from storage) goes only once every replacement is saved. Storage deletes are not
			# transactional: if a LATER delete in this loop fails, the earlier rows come back
			# without their own uploaded file. Only rejected requests own one; picks borrow theirs.
			for p in planned:
				if p["replaces"]:
					frappe.delete_doc(ROW_DOCTYPE, p["replaces"])
		except Exception:
			frappe.db.rollback(save_point=_SAVEPOINT)
			raise

		frappe.db.commit()

	return {"request_id": request_id, "names": names}


@contextmanager
def _project_send_lock(project):
	"""Hold one project's send lock, inside a transaction that started AFTER the lock was granted.

	Frappe runs PostgreSQL at REPEATABLE READ (`database/postgres/database.py`), so a transaction
	reads one snapshot, taken at its first statement. A row lock alone is not enough: the waiting
	send's snapshot predates the other send's commit, so after the wait it still reads the old
	highest request id and the old rows (a test proved it handed out the same id twice).

	So the lock is a session-level advisory lock, which outlives a commit, and the commit right
	after it starts a fresh transaction whose snapshot includes everything the previous holder
	committed. The holder commits before it unlocks.

	The first commit also commits anything the caller wrote before calling in. From the browser
	that is nothing; a server-side caller must not call this inside a transaction it may still
	want to roll back.
	"""
	key = f"tds_submit_request:{project}"
	frappe.db.commit()
	frappe.db.sql("SELECT pg_advisory_lock(hashtext(%s))", (key,))
	try:
		frappe.db.commit()
		yield
	finally:
		# Every failure inside rolls back to a savepoint first, so the transaction is still usable
		# here. Closing the connection at request end would release the lock anyway.
		frappe.db.sql("SELECT pg_advisory_unlock(hashtext(%s))", (key,))


def _parse_rows(rows):
	parsed = frappe.parse_json(rows) if isinstance(rows, str) else rows
	if not parsed:
		frappe.throw(_("Add at least one item before sending for approval."))
	return [
		{
			"tds_item_id": (r.get("tds_item_id") or "").strip(),
			"make": (r.get("make") or "").strip(),
			"is_new_request": bool(r.get("is_new_request")),
			"tds_boq_line_item": r.get("tds_boq_line_item") or "",
			"description": r.get("description") or "",
			"tds_item_name": (r.get("tds_item_name") or "").strip(),
			"work_package": r.get("work_package") or "",
			"tds_attachment": r.get("tds_attachment") or "",
			"previous_doc_name": r.get("previous_doc_name") or "",
		}
		for r in parsed
	]


def _plan_row(r, user, claimed_files):
	"""The fields one cart row will be stored with, or a refusal."""
	if not r["make"]:
		frappe.throw(_("Every item needs a make."))

	item_id = r["tds_item_id"]
	if item_id:
		group = frappe.db.get_value(
			GROUP_DOCTYPE, item_id, ["tds_item_name", "work_package"], as_dict=True
		)
		if not group:
			frappe.throw(_("TDS Item {0} not found.").format(item_id))
		item_name, work_package = group.tds_item_name, group.work_package
	else:
		# Brand-new-group request: the dialog still offers it until ticket 3 (#1377) removes it.
		if not r["is_new_request"]:
			frappe.throw(_("Pick a TDS Item before sending."))
		if not (r["tds_item_name"] and r["work_package"]):
			frappe.throw(_("A new TDS item needs a name and a work package."))
		item_name, work_package = r["tds_item_name"], r["work_package"]

	plan = {
		"tds_item_id": item_id,
		"tds_item_name": item_name,
		"tds_make": r["make"],
		"tds_work_package": work_package,
		"tds_boq_line_item": r["tds_boq_line_item"],
		"replaces": r["previous_doc_name"],
	}

	if r["is_new_request"]:
		plan.update(
			tds_status="New",
			tds_description=r["description"],
			tds_attachment=r["tds_attachment"],
			upload=_claim_upload(r["tds_attachment"], user, item_name, r["make"], claimed_files),
		)
	else:
		entry = frappe.db.get_value(
			ENTRY_DOCTYPE, {"tds_item": item_id, "make": r["make"]}, ["name", "tds_attachment"], as_dict=True
		)
		if not entry:
			frappe.throw(
				_("{0} has no datasheet for make {1}. Use Request New instead.").format(
					item_name, r["make"]
				)
			)
		plan.update(tds_status="Pending", tds_description="", tds_attachment=entry.tds_attachment, upload=None)

	return plan


def _claim_upload(file_url, user, item_name, make, claimed_files):
	"""The sender's own, still-unattached `File` for this request's datasheet.

	Owner + unattached is what stops a send from re-parenting a file that belongs to someone else
	or to another document. Two rows may carry the same `file_url` (one PDF uploaded twice), so
	each claims a distinct File doc.
	"""
	missing = _("Attach the datasheet for {0} ({1}) again, then send.").format(item_name, make)
	if not file_url:
		frappe.throw(missing)
	candidates = frappe.get_all(
		"File",
		filters={
			"file_url": file_url,
			"owner": user,
			"attached_to_doctype": ["is", "not set"],
		},
		pluck="name",
		order_by="creation desc",
	)
	free = [name for name in candidates if name not in claimed_files]
	if not free:
		frappe.throw(missing)
	claimed_files.add(free[0])
	return free[0]


def _refuse_duplicates(project, planned):
	"""One live row per TDS Item + make on a project: in this batch, or already Pending, New,
	Approved or legacy-null there. Rejected rows don't count; they are what a resubmit replaces.
	A brand-new-group request has no TDS Item id yet, so it has no key."""
	seen = set()
	for p in planned:
		if not p["tds_item_id"]:
			continue
		key = (p["tds_item_id"], p["tds_make"])
		if key in seen:
			frappe.throw(
				_("{0} ({1}) is in this request twice.").format(p["tds_item_name"], p["tds_make"])
			)
		seen.add(key)

	if not seen:
		return
	# Fetched whole and filtered here: `tds_status != 'Rejected'` in SQL would drop legacy NULLs.
	existing = frappe.get_all(
		ROW_DOCTYPE,
		filters={"tdsi_project_id": project, "tds_item_id": ["in", list({k[0] for k in seen})]},
		fields=["tds_item_id", "tds_item_name", "tds_make", "tds_status", "tds_request_id"],
	)
	for row in existing:
		if row.tds_status == "Rejected" or (row.tds_item_id, row.tds_make) not in seen:
			continue
		frappe.throw(
			_("{0} ({1}) is already on this project in request {2}.").format(
				row.tds_item_name, row.tds_make, row.tds_request_id or "—"
			)
		)


def _check_replacements(project, planned):
	"""A row may replace only a Rejected row of this project for the same TDS Item + make."""
	targets = set()
	for p in planned:
		name = p["replaces"]
		if not name:
			continue
		target = frappe.db.get_value(
			ROW_DOCTYPE, name, ["tdsi_project_id", "tds_item_id", "tds_make", "tds_status"], as_dict=True
		)
		if (
			not target
			or name in targets
			or target.tds_status != "Rejected"
			or target.tdsi_project_id != project
			or not p["tds_item_id"]
			or (target.tds_item_id, target.tds_make) != (p["tds_item_id"], p["tds_make"])
		):
			frappe.throw(
				_("{0} ({1}) can't replace {2}: that is not its rejected row on this project.").format(
					p["tds_item_name"], p["tds_make"], name
				)
			)
		targets.add(name)


def _next_request_id(project):
	"""`RQ-<last 3 chars of the project>-NN`, one past the highest NN on this project.

	The format is the one the browser used. Two projects ending in the same 3 characters share a
	prefix; that is a known issue the spec (#1373) leaves out of scope. Call only under the
	`_project_send_lock`.
	"""
	prefix = f"RQ-{project[-3:]}-"
	existing = frappe.get_all(
		ROW_DOCTYPE,
		filters={"tdsi_project_id": project, "tds_request_id": ["like", f"{prefix}%"]},
		pluck="tds_request_id",
	)
	highest = 0
	for request_id in existing:
		match = re.match(r"\d+", request_id[len(prefix):])
		if match:
			highest = max(highest, int(match.group()))
	return f"{prefix}{highest + 1:02d}"


def _insert_row(project, request_id, plan):
	doc = frappe.get_doc(
		{
			"doctype": ROW_DOCTYPE,
			"tdsi_project_id": project,
			"tds_request_id": request_id,
			"tds_item_id": plan["tds_item_id"],
			"tds_item_name": plan["tds_item_name"],
			"tds_make": plan["tds_make"],
			"tds_work_package": plan["tds_work_package"],
			"tds_description": plan["tds_description"],
			"tds_status": plan["tds_status"],
			"tds_boq_line_item": plan["tds_boq_line_item"],
			"tds_attachment": plan["tds_attachment"],
		}
	)
	# The sender's own DocPerms decide, exactly as the browser's create did.
	doc.insert()
	if plan["upload"]:
		# `set_value` skips the File lifecycle on purpose: only the link moves. No bytes are
		# copied, and the storage app's hooks fire on insert and trash, neither of which this is.
		frappe.db.set_value(
			"File",
			plan["upload"],
			{
				"attached_to_doctype": ROW_DOCTYPE,
				"attached_to_name": doc.name,
				"attached_to_field": "tds_attachment",
			},
			update_modified=False,
		)
	return doc.name
