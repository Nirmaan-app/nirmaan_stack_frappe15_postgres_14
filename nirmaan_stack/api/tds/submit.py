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

Row kinds (stored `tds_status`):
  - a pick of an existing Repository Entry (From Repository) → "Pending";
  - a New Make request (a make an existing TDS Item lacks) → "New";
  - a Project Custom Item request → "Pending", with a project-only `PCUS-` id (#1377). It never
    enters the TDS Repository.
The two request kinds are Admin / PMO only, as the dialog already gates them.

A datasheet is uploaded by the browser BEFORE the send, unattached, and its `file_url` is passed
in. The storage app commits inside `File.after_insert`, so an upload can never sit inside this
transaction (`CODING_STANDARDS.md` § Reading uploaded file bytes). A failed send therefore leaves
an unattached upload, never a half-saved request; the cart keeps that upload's URL and sends it
again on retry, so retries add no further uploads.
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

# Stored `tds_status` of a waiting row. The frontend derives Request Type and the History status
# from these (`frontend/src/utils/tdsRequestRules.ts`, pinned by its parity test).
STATUS_PENDING = "Pending"
STATUS_NEW_MAKE = "New"  # approval adds a Repository Entry
# Stored `tds_status` of an Admin-approved row; only such a row can carry a Client Status.
STATUS_APPROVED = "Approved"
# Project-only id prefix of a Project Custom Item (minted by `_assign_project_custom_ids`). Read by
# the same frontend rules.
PROJECT_CUSTOM_ID_PREFIX = "PCUS-"

# Mirrors `canRequestNew` in `TdsCreateForm.tsx`, which only decides whether "Request New" shows.
REQUEST_NEW_PROFILES = (ADMIN_PROFILE, PMO_EXECUTIVE_PROFILE)

_SAVEPOINT = "tds_submit_request"


@frappe.whitelist(methods=["POST"])
def submit_tds_request(project, rows):
	"""Save a cart of Project TDS rows for approval: every row, or none.

	`project`: the `Projects` name.
	`rows`: JSON list (or list) of cart rows:
	    {
	        "tds_item_id": "TDS-ITEM-00012",  # "" for a Project Custom request
	        "make": "MakeA",
	        "is_new_request": false,           # true ⇒ a Request New row (New Make or Project Custom)
	        "is_project_custom": false,        # true ⇒ a Project Custom request
	        "tds_boq_line_item": "",
	        "description": "",                 # requests only
	        "tds_item_name": "", "work_package": "", "category": "",  # Project Custom only
	        "tds_attachment": "<file_url>",    # requests only: the sender's unattached upload
	        "previous_doc_name": "<row>",      # a Rejected row this one replaces
	    }

	A Project Custom row gets the project's `PCUS-` id for its name (trimmed, ignoring case), or
	the next one in the project's series.

	Refuses (nothing saved) on: an unknown TDS Item, a pick with no Repository Entry, a request
	without its uploaded datasheet, a New Make with no TDS Item, a Project Custom row without a
	name, Work Package or Category, or whose Category is not under that Work Package, the same
	TDS Item + make (Project Custom: name + make) twice in the batch or already live (not
	Rejected) on the project, a replace target that is not a Rejected row of this project for the
	same item + make, or a Request New row from anyone but Admin / PMO.

	Returns: {"request_id": "RQ-<project suffix>-NN", "names": [<new row names>]}
	"""
	user = frappe.session.user
	cart = _parse_rows(rows)

	if not frappe.db.exists("Projects", project):
		frappe.throw(_("Project {0} not found.").format(project))

	if any(r["is_new_request"] or r["is_project_custom"] for r in cart) and not has_role_profile(
		user, REQUEST_NEW_PROFILES
	):
		frappe.throw(
			_("Only Admin or PMO can request a new TDS item or make."), frappe.PermissionError
		)

	with _project_send_lock(project):
		frappe.db.savepoint(_SAVEPOINT)
		try:
			claimed_files = set()
			planned = [_plan_row(r, user, claimed_files) for r in cart]
			_refuse_duplicates(project, planned)
			_assign_project_custom_ids(project, planned)
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
			"is_project_custom": bool(r.get("is_project_custom")),
			"category": (r.get("category") or "").strip(),
			"tds_boq_line_item": r.get("tds_boq_line_item") or "",
			"description": r.get("description") or "",
			"tds_item_name": (r.get("tds_item_name") or "").strip(),
			"work_package": (r.get("work_package") or "").strip(),
			"tds_attachment": r.get("tds_attachment") or "",
			"previous_doc_name": r.get("previous_doc_name") or "",
		}
		for r in parsed
	]


def _plan_row(r, user, claimed_files, kept_attachment=None):
	"""The fields one cart row will be stored with, or a refusal.

	`kept_attachment`: an edited row's current datasheet URL, which it may keep instead of
	claiming a new upload (`edit_request.py`)."""
	if not r["make"]:
		frappe.throw(_("Every item needs a make."))

	if r["is_project_custom"]:
		return _plan_project_custom(r, user, claimed_files, kept_attachment)

	item_id = r["tds_item_id"]
	if not item_id:
		# A project can no longer create a shared TDS Item (#1377): it asks for a Project Custom.
		frappe.throw(_("Pick a TDS Item before sending."))
	group = frappe.db.get_value(GROUP_DOCTYPE, item_id, ["tds_item_name", "work_package"], as_dict=True)
	if not group:
		frappe.throw(_("TDS Item {0} not found.").format(item_id))
	item_name = group.tds_item_name

	plan = {
		"tds_item_id": item_id,
		"tds_item_name": item_name,
		"tds_make": r["make"],
		"tds_work_package": group.work_package,
		"tds_category": None,  # the before_save hook derives it from the TDS Item
		"custom_name_key": None,
		"tds_boq_line_item": r["tds_boq_line_item"],
		"replaces": r["previous_doc_name"],
	}

	if r["is_new_request"]:
		plan.update(
			tds_status=STATUS_NEW_MAKE,
			tds_description=r["description"],
			tds_attachment=r["tds_attachment"],
			upload=_claim_upload(r["tds_attachment"], user, item_name, r["make"], claimed_files, kept_attachment),
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
		plan.update(tds_status=STATUS_PENDING, tds_description="", tds_attachment=entry.tds_attachment, upload=None)

	return plan


def _plan_project_custom(r, user, claimed_files, kept_attachment=None):
	"""A Project Custom Item row. Its `PCUS-` id is assigned once the whole batch is planned."""
	name, work_package, category = r["tds_item_name"], r["work_package"], r["category"]
	if not (name and work_package and category):
		frappe.throw(_("A Project Custom item needs a name, a Work Package and a Category."))
	if frappe.db.get_value("Category", category, "work_package") != work_package:
		frappe.throw(_("Category {0} is not under Work Package {1}.").format(category, work_package))
	return {
		"tds_item_id": "",
		"tds_item_name": name,
		"tds_make": r["make"],
		"tds_work_package": work_package,
		"tds_category": category,
		"custom_name_key": _name_key(name),
		"tds_boq_line_item": r["tds_boq_line_item"],
		"replaces": r["previous_doc_name"],
		"tds_status": STATUS_PENDING,
		"tds_description": r["description"],
		"tds_attachment": r["tds_attachment"],
		"upload": _claim_upload(r["tds_attachment"], user, name, r["make"], claimed_files, kept_attachment),
	}


def is_project_custom_id(item_id):
	"""A Project Custom Item's row, at any status: its id carries the project-only prefix."""
	return (item_id or "").startswith(PROJECT_CUSTOM_ID_PREFIX)


def _name_key(name):
	"""Project Custom identity: the name, trimmed and ignoring case."""
	return (name or "").strip().lower()


def _claim_upload(file_url, user, item_name, make, claimed_files, kept_attachment=None):
	"""The sender's own, still-unattached `File` for this request's datasheet, or None when the
	row keeps `kept_attachment`, the datasheet it already has.

	Owner + unattached is what stops a send from re-parenting a file that belongs to someone else
	or to another document. Two rows may carry the same `file_url` (one PDF uploaded twice), so
	each claims a distinct File doc.
	"""
	missing = _("Attach the datasheet for {0} ({1}) again, then send.").format(item_name, make)
	if not file_url:
		frappe.throw(missing)
	if file_url == kept_attachment:
		return None
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


def _refuse_duplicates(project, planned, exclude=None):
	"""One live row per item + make on a project: in this batch, or already Pending, New, Approved
	or legacy-null there. Rejected rows don't count; they are what a resubmit replaces.

	The item is the TDS Item id, or for a Project Custom row its name (trimmed, ignoring case).
	A *Rejected by Client* row is live too (its `tds_status` stays Approved); its refusal says so and
	names the two ways out, so a direct API call gets the same explanation as the form's popup.

	`exclude`: the row being edited, which is no duplicate of itself."""
	# Imported here: `client_status` imports this module.
	from nirmaan_stack.api.tds.client_status import CLIENT_STATUS_REJECTED

	seen = set()
	for p in planned:
		key = _item_make_key(p["tds_item_id"], p["custom_name_key"], p["tds_make"])
		if key in seen:
			frappe.throw(
				_("{0} ({1}) is in this request twice.").format(p["tds_item_name"], p["tds_make"])
			)
		seen.add(key)

	# The project's whole list (a few hundred rows at most), matched here: a Project Custom key is a
	# folded name, and `tds_status != 'Rejected'` in SQL would drop legacy NULLs.
	existing = frappe.get_all(
		ROW_DOCTYPE,
		filters={"tdsi_project_id": project},
		fields=["name", "tds_item_id", "tds_item_name", "tds_make", "tds_status", "tds_request_id", "client_status"],
		limit_page_length=0,
	)
	for row in existing:
		if row.name == exclude or row.tds_status == "Rejected" or _stored_key(row) not in seen:
			continue
		if row.client_status == CLIENT_STATUS_REJECTED:
			frappe.throw(
				_(
					"{0} ({1}) is Rejected by Client on this project in request {2}, so it can't be added again."
					" Pick another make, or switch that row to Approved by Client in the Rejected by Client tab."
				).format(row.tds_item_name, row.tds_make, row.tds_request_id or "—")
			)
		frappe.throw(
			_("{0} ({1}) is already on this project in request {2}.").format(
				row.tds_item_name, row.tds_make, row.tds_request_id or "—"
			)
		)


def _item_make_key(item_id, custom_name_key, make):
	if custom_name_key:
		return ("custom", custom_name_key, make)
	return ("item", item_id, make)


def _stored_key(row):
	custom = is_project_custom_id(row.tds_item_id)
	return _item_make_key(row.tds_item_id or "", _name_key(row.tds_item_name) if custom else None, row.tds_make)


def _assign_project_custom_ids(project, planned):
	"""Give each Project Custom row its project-only `PCUS-` id.

	Rows with the same name (trimmed, ignoring case) on the same project share one id, whatever
	their status, legacy rows included. A new name takes one past the highest `PCUS-` number on
	this project, so it can never take an id a legacy row already holds. Call only under the
	`_project_send_lock`, which serialises two sends on the same project.
	"""
	custom = [p for p in planned if p["custom_name_key"]]
	if not custom:
		return
	stored = frappe.get_all(
		ROW_DOCTYPE,
		filters={"tdsi_project_id": project, "tds_item_id": ["like", f"{PROJECT_CUSTOM_ID_PREFIX}%"]},
		fields=["tds_item_id", "tds_item_name"],
		order_by="tds_item_id asc",
	)
	ids_by_name = {}
	highest = 0
	for row in stored:
		ids_by_name.setdefault(_name_key(row.tds_item_name), row.tds_item_id)
		match = re.match(r"\d+", row.tds_item_id[len(PROJECT_CUSTOM_ID_PREFIX):])
		if match:
			highest = max(highest, int(match.group()))

	for p in custom:
		if p["custom_name_key"] not in ids_by_name:
			highest += 1
			ids_by_name[p["custom_name_key"]] = f"{PROJECT_CUSTOM_ID_PREFIX}{highest:06d}"
		p["tds_item_id"] = ids_by_name[p["custom_name_key"]]


def _check_replacements(project, planned):
	"""A row may replace only a Rejected row of this project for the same item + make: the same
	TDS Item, or for a Project Custom row the same name (trimmed, ignoring case), whatever `PCUS-`
	id the rejected row holds."""
	targets = set()
	for p in planned:
		name = p["replaces"]
		if not name:
			continue
		target = frappe.db.get_value(
			ROW_DOCTYPE,
			name,
			["tdsi_project_id", "tds_item_id", "tds_item_name", "tds_make", "tds_status"],
			as_dict=True,
		)
		if (
			not target
			or name in targets
			or target.tds_status != "Rejected"
			or target.tdsi_project_id != project
			or _stored_key(target) != _item_make_key(p["tds_item_id"], p["custom_name_key"], p["tds_make"])
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
			# Project Custom: the chosen Category. Otherwise None, and the before_save hook derives
			# it from the TDS Item; it leaves a `PCUS-` row's value alone, as that is no TDS Item.
			"tds_category": plan["tds_category"],
			"tds_description": plan["tds_description"],
			"tds_status": plan["tds_status"],
			"tds_boq_line_item": plan["tds_boq_line_item"],
			"tds_attachment": plan["tds_attachment"],
		}
	)
	# The sender's own DocPerms decide, exactly as the browser's create did.
	doc.insert()
	if plan["upload"]:
		attach_upload(plan["upload"], doc.name)
	return doc.name


def delete_row_datasheet(row_name, file_url):
	"""Delete the datasheet upload `row_name` owns at `file_url`, once the row no longer points at it.

	Only File docs attached to this row are touched: a pick borrows its Repository Entry's sheet, and
	that File belongs to the entry. Deleting a File removes its bytes from storage, which no rollback
	undoes, so call this last, after every other write of the transaction has succeeded.

	The storage app keys the stored bytes by `content_hash` (`frappe_gcp_attachment` `delete_from_cloud`),
	so the same PDF uploaded twice is one stored object behind two File docs. When another File shares
	the hash, only this File's record goes, with a raw delete that skips the storage hook on purpose:
	trashing it through the document layer would delete the bytes the other File still serves."""
	if not file_url:
		return
	for f in frappe.get_all(
		"File",
		filters={"attached_to_doctype": ROW_DOCTYPE, "attached_to_name": row_name, "file_url": file_url},
		fields=["name", "content_hash"],
	):
		shared = f.content_hash and frappe.db.exists(
			"File", {"content_hash": f.content_hash, "name": ["!=", f.name]}
		)
		if shared:
			frappe.db.delete("File", f.name)
		else:
			frappe.delete_doc("File", f.name, ignore_permissions=True)


def attach_upload(file_name, row_name):
	"""Attach a claimed upload (`_claim_upload`) to the row as its datasheet.

	`set_value` skips the File lifecycle on purpose: only the link moves. No bytes are copied, and
	the storage app's hooks fire on insert and trash, neither of which this is."""
	frappe.db.set_value(
		"File",
		file_name,
		{
			"attached_to_doctype": ROW_DOCTYPE,
			"attached_to_name": row_name,
			"attached_to_field": "tds_attachment",
		},
		update_modified=False,
	)
