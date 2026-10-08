import frappe
from frappe import _

from nirmaan_stack.api.tds.submit import (
	STATUS_NEW_MAKE,
	STATUS_PENDING,
	delete_row_datasheet,
	is_project_custom_id,
)
from nirmaan_stack.services.role_profiles import ADMIN_PROFILE, is_nirmaan_admin


# ─────────────────────────────────────────────────────────────────────────────
# Why this module exists (Phase 2 — group-driven approval/promotion, ADR-0025):
#
# A project consumes TDS by picking a **TDS Item (group) + Make**, by filing a
# New Make request that PROPOSES a (group, make, datasheet), or by filing a
# Project Custom Item request. Every project selection needs project-level
# approval. The OLD approval path (frontend `TDSApprovalDetail.handleApprove`)
# wrote now-REMOVED `TDS Repository` columns. This module replaces that with an
# Admin-only BACKEND promotion keyed on the restructured `(tds_item, make)` shape.
#
# Row kinds on `Project TDS Item List` (Request Type, `frontend/src/utils/tdsRequestRules.ts`):
#   - Project Custom (a `PCUS-` id) → marked Approved, nothing else.
#                  It never enters the TDS Repository (ADR-0025 Amendment A); the
#                  datasheet stays on the row.
#   - New Make ("New") → a REQUEST (proposed datasheet) for an existing TDS Item.
#                  We create the `(tds_item, make)` Repository Entry born
#                  Verified with the request's attachment and mark the row
#                  Approved. A "New" row with no existing TDS Item is refused: a
#                  project can no longer create a shared TDS Item (#1377). If the
#                  entry was added after the request was sent, the Admin must
#                  choose which datasheet is correct (#1378); without a choice the
#                  row is refused, so the uploaded PDF is never dropped silently.
#   - From Repository ("Pending") → a PICKED existing entry. We verify the
#                  matching `(tds_item, make)` `TDS Repository` entry and mark the
#                  row Approved.
#
# Dedup / uniqueness key throughout = `(tds_item, make)`, matching the entry's
# `validate` (`tds_repository.py`). The create-race (another approval adds the
# entry between our read and our insert) refuses that one row with
# `needs_datasheet_choice`, the same reply as an entry that already existed, so the
# screen asks the Admin which datasheet to keep. Only a waiting row (Pending, New
# or a legacy blank) is approved; a Rejected one is refused, so it can't skip the
# resubmit.
#
# Admin-only is enforced SERVER-SIDE first (don't trust the client gate) — same
# check as `api/design_tracker/bulk_update_task_status.py`:
# `"Nirmaan Admin Profile" in frappe.get_roles(user)` OR the Administrator
# superuser. All TDS approval is Admin-only (ADR-0025 P2-5; Project Lead lost the
# pre-freeze approve right).
#
# `TDS Items Child Table` is an `istable` child with NO DocPerm — if any member
# read is needed it goes through `frappe.get_all` (perm-ignoring), per the
# codebase child-table pattern (see `api/tds/members.py`). PostgreSQL backend:
# this module uses only the ORM (no raw SQL); if any is added later, double-quote
# table names ("tabTDS Repository") and the reserved word "user".
# ─────────────────────────────────────────────────────────────────────────────

PROJECT_ROW_DOCTYPE = "Project TDS Item List"
ENTRY_DOCTYPE = "TDS Repository"
GROUP_DOCTYPE = "TDS Items"

ADMIN_ROLE = ADMIN_PROFILE  # back-compat alias; prefer ADMIN_PROFILE

# A New Make whose entry already exists: which datasheet is correct (#1378).
# Pinned to the frontend's `DATASHEET_CHOICE` by a parity test.
CHOICE_REPOSITORY = "repository"  # keep the entry's sheet; the project row borrows it
CHOICE_REQUEST = "request"  # the uploaded sheet becomes the entry's sheet
DATASHEET_CHOICES = (CHOICE_REPOSITORY, CHOICE_REQUEST)

ROW_SAVEPOINT = "tds_approve_row"

# Stored statuses of a row still waiting for approval. A blank status is a legacy row, which every
# screen shows as Pending. Anything else (Rejected) is refused: approving it would skip the resubmit.
WAITING_STATUSES = ("", STATUS_PENDING, STATUS_NEW_MAKE)


class DatasheetChoiceNeeded(Exception):
	"""A New Make whose `(tds_item, make)` entry already exists, approved without a datasheet choice.

	The approve reply marks the row `needs_datasheet_choice` and carries the entry's current sheet, so
	the screen opens the chooser from the server's answer rather than from its own, possibly stale,
	copy of the TDS Repository."""

	def __init__(self, message, repository_sheet):
		super().__init__(message)
		self.repository_sheet = repository_sheet


# Admin is identified by the user's ROLE PROFILE, never by `frappe.get_roles()` —
# see the warning above the resolvers in `services/role_profiles.py`. This module
# had its own correct copy of that rule; it now delegates to the shared one so
# there is a single definition to keep right.
_is_admin = is_nirmaan_admin


def _require_admin():
	"""Admin-only gate. Raises PermissionError for anyone who is neither the
	Administrator superuser nor a Nirmaan admin (by role profile)."""
	user = frappe.session.user
	if user == "Guest":
		frappe.throw(_("Authentication required."), frappe.PermissionError)
	if not _is_admin(user):
		frappe.throw(
			_("Only Admin can approve or reject TDS submittals."),
			frappe.PermissionError,
		)


def _parse_names(doc_names):
	"""Coerce the `doc_names` arg (JSON string or list) into a clean list of
	Project TDS Item List row names."""
	names = frappe.parse_json(doc_names) if isinstance(doc_names, str) else doc_names
	if not names:
		return []
	if isinstance(names, str):
		names = [names]
	# Drop falsy/blank entries, de-dupe while preserving order.
	seen = set()
	cleaned = []
	for n in names:
		if n and n not in seen:
			seen.add(n)
			cleaned.append(n)
	return cleaned


def _find_entry(tds_item, make):
	"""Return the TDS Repository entry name for `(tds_item, make)` or None.

	Make is matched on the snapshot value (which may legitimately be an empty
	string); the `(tds_item, make)` pair is the entry's uniqueness key.
	"""
	if not tds_item:
		return None
	return frappe.db.exists(ENTRY_DOCTYPE, {"tds_item": tds_item, "make": make or ""})


def _reparent_datasheet_to_entry(tds_attachment, entry_name):
	"""Give the new Repository entry OWNERSHIP of the datasheet it now points at.

	THE PROBLEM THIS CLOSES
	  Approval copies the project row's `tds_attachment` URL onto the new
	  `TDS Repository` entry — but only the URL. The underlying `File` doc keeps
	  `attached_to_name = <Project TDS Item List row>`, so the master entry USES
	  a file the project row OWNS.

	  Frappe cascade-deletes attachments (`delete_doc` -> `remove_all`), so
	  deleting that project row later destroys the file the master entry depends
	  on, leaving a **Verified** entry whose datasheet link is dead.

	  Deleting a project row is routine, not hypothetical: Admin cleanup from TDS
	  History, PMO deleting a Pending/Rejected row, and `submit_tds_request` removing
	  the previous Rejected row on EVERY resubmit.

	  Re-parenting puts the master in the same shape the picked-entry path
	  already has — the file is uploaded to the Repository entry and project rows
	  borrow the URL. One master datasheet, many projects referencing it.

	NARROW BY DESIGN
	  Only a File currently owned by a `Project TDS Item List` row is moved. A
	  file already owned by a Repository entry (the picked path) is left
	  untouched — re-pointing that would be wrong.

	NOTHING IS COPIED OR DELETED
	  Two DB fields change on the File doc. The stored bytes, the `file_url` and
	  every document referencing it are untouched, so no attachment can be lost
	  by this. `frappe.db.set_value` also bypasses the File doc lifecycle, so no
	  File hook (incl. the GCS attachment app's) re-runs.

	Never raises — a failed ownership fix must not break an approval batch.
	"""
	if not tds_attachment or not entry_name:
		return
	try:
		files = frappe.get_all(
			"File",
			filters={
				"file_url": tds_attachment,
				"attached_to_doctype": PROJECT_ROW_DOCTYPE,
			},
			pluck="name",
			limit_page_length=0,
		)
		for file_name in files:
			frappe.db.set_value(
				"File",
				file_name,
				{
					"attached_to_doctype": ENTRY_DOCTYPE,
					"attached_to_name": entry_name,
				},
				update_modified=False,
			)
	except Exception:
		frappe.log_error(
			title="TDS approve: datasheet re-parent failed",
			message=f"entry={entry_name} url={tds_attachment}\n{frappe.get_traceback()}",
		)


def _create_entry(tds_item, make, tds_attachment=None, description=None):
	"""Create the `(tds_item, make)` Repository Entry, born "Verified", owning the datasheet.

	Returns the entry name. Lost create-race (the entry's `validate` throws on a duplicate
	`(tds_item, make)`): raise `DatasheetChoiceNeeded`, so this row is refused and the Admin
	chooses the datasheet instead of the uploaded PDF being dropped.
	"""
	entry = frappe.new_doc(ENTRY_DOCTYPE)
	entry.tds_item = tds_item
	entry.make = make or ""
	entry.status = "Verified"
	if tds_attachment:
		entry.tds_attachment = tds_attachment
	if description:
		entry.description = description
	# Frappe wraps each `insert` in its own savepoint, so a duplicate rejected by
	# the entry's `validate` (a `frappe.throw` → ValidationError) rolls back ONLY
	# the failed insert, not the prior rows committed-in-progress in this batch.
	# We therefore do NOT call `frappe.db.rollback()` here — that would discard
	# every already-approved row in the same call.
	try:
		entry.insert(ignore_permissions=True)
	except (frappe.DuplicateEntryError, frappe.UniqueValidationError, frappe.ValidationError):
		existing = _find_entry(tds_item, make)
		if not existing:
			raise
		raise DatasheetChoiceNeeded(
			_("A TDS Repository entry for ({0}, {1}) was added just now. Choose which datasheet to keep.").format(
				tds_item, make or "—"
			),
			frappe.db.get_value(ENTRY_DOCTYPE, existing, "tds_attachment"),
		)
	# This entry now points at the project row's datasheet, so it must OWN it —
	# otherwise deleting that row would delete the file underneath it.
	_reparent_datasheet_to_entry(tds_attachment, entry.name)
	return entry.name


def _approve_new_make(row, choice, summary):
	"""Approve a New Make row: create its Repository Entry, or settle the existing one by `choice`.

	Returns a refusal message (nothing written), or None once the row is Approved. Raises
	`DatasheetChoiceNeeded` when the entry exists and the Admin gave no choice. An entry that
	exists was added after the request was sent, so the Admin's datasheet choice decides:
	- `repository`: the entry keeps its sheet and is verified; the project row points at that sheet,
	  and the row's own upload, now pointed at by nothing, is deleted.
	- `request`: the row's uploaded sheet becomes the entry's, the entry owns it and is verified. The
	  entry's previous file is NOT deleted: rows approved earlier still point at it, and signed
	  reports must keep opening the sheet they were approved with.
	"""
	tds_item = row.tds_item_id
	make = row.tds_make or ""
	label = row.tds_item_name or row.name
	if not (tds_item and frappe.db.exists(GROUP_DOCTYPE, tds_item)):
		return _(
			"{0} has no TDS Item in the repository. A project can no longer"
			" create one: edit it into a New Make or a Project Custom item."
		).format(label)

	entry_name = _find_entry(tds_item, make)
	discarded_upload = None
	if not entry_name:
		_create_entry(tds_item, make, tds_attachment=row.tds_attachment, description=row.tds_description)
		summary["created_entries"] += 1
	else:
		entry = frappe.get_doc(ENTRY_DOCTYPE, entry_name)
		if choice not in DATASHEET_CHOICES:
			raise DatasheetChoiceNeeded(
				_("{0} ({1}) already has a datasheet in the TDS Repository. Choose which datasheet to keep.").format(
					label, make or "—"
				),
				entry.tds_attachment,
			)
		kept_sheet = row.tds_attachment if choice == CHOICE_REQUEST else entry.tds_attachment
		if not kept_sheet:
			return _("{0} ({1}): the chosen datasheet is missing. Choose the other one.").format(
				label, make or "—"
			)
		if entry.status != "Verified":
			summary["verified_existing"] += 1
		entry.status = "Verified"
		entry.tds_attachment = kept_sheet
		# `save` deletes no File: Frappe removes an old attachment only for web forms.
		entry.save(ignore_permissions=True)
		if choice == CHOICE_REQUEST:
			_reparent_datasheet_to_entry(kept_sheet, entry_name)
			summary["replaced_datasheets"] += 1
		elif row.tds_attachment != kept_sheet:
			discarded_upload = row.tds_attachment
		row.tds_attachment = kept_sheet

	# Snapshot the TDS Item's current name onto the row, as before.
	row.tds_item_name = frappe.db.get_value(GROUP_DOCTYPE, tds_item, "tds_item_name") or row.tds_item_name
	row.tds_status = "Approved"
	row.save(ignore_permissions=True)
	# Last, once the row points at the entry's sheet: the storage delete can't be rolled back.
	delete_row_datasheet(row.name, discarded_upload)
	summary["approved"] += 1
	return None


def _parse_choices(datasheet_choices):
	"""Coerce `datasheet_choices` (JSON string or dict, `{row name: choice}`) into a dict."""
	choices = frappe.parse_json(datasheet_choices) if isinstance(datasheet_choices, str) else datasheet_choices
	return choices if isinstance(choices, dict) else {}


@frappe.whitelist(methods=["POST"])
def approve_tds_items(doc_names, datasheet_choices=None):
	"""Approve one or more Project TDS Item List rows (Admin-only).

	`doc_names`: a JSON-encoded list (or Python list) of `Project TDS Item List`
	row names.
	`datasheet_choices`: a JSON-encoded dict (or dict) `{row name: "repository" | "request"}`,
	needed only for a New Make row whose `(tds_item, make)` entry already exists.

	Per row:
	  - **Project Custom (`PCUS-` id):** set `tds_status="Approved"`. No catalogue
	    read or write; the datasheet stays on the row.
	  - **New Make (New):** the row's `tds_item_id` must be an existing `TDS Items`
	    doc, else the row is refused. No `(tds_item, tds_make)` entry yet: create it
	    born `status="Verified"` carrying the row's `tds_attachment` (+ description
	    if present). Entry exists: apply the row's datasheet choice, or refuse the
	    row when it has none (`_approve_new_make`). Then set `tds_status="Approved"`.
	  - **Pending (picked existing entry):** locate the `(tds_item_id, tds_make)`
	    `TDS Repository` entry; set its `status="Verified"` (only if not already);
	    set the row `tds_status="Approved"`.

	Dedup / uniqueness key = `(tds_item, make)`. A lost create-race refuses the
	row. Each row is all or nothing (a savepoint per row); commits once at the end.

	Returns:
	    {
	        "status": "success",
	        "summary": {
	            "verified_existing": <int>,   # existing entries promoted to Verified
	            "created_entries":   <int>,   # new (tds_item, make) entries created
	            "replaced_datasheets": <int>, # entries given the request's datasheet
	            "approved":          <int>,   # rows set to Approved
	        },
	        "errors": [ {"name": <row>, "error": <msg>}, ... ],
	    }
	An error for a New Make whose entry exists and that had no choice also carries
	`"needs_datasheet_choice": true` and `"repository_sheet": <the entry's current sheet URL>`.
	"""
	_require_admin()

	names = _parse_names(doc_names)
	if not names:
		frappe.throw(_("No TDS submittals selected."))
	choices = _parse_choices(datasheet_choices)

	summary = {
		"verified_existing": 0,
		"created_entries": 0,
		"replaced_datasheets": 0,
		"approved": 0,
	}
	errors = []

	for name in names:
		# Each row is all or nothing: a failure part-way (say, the entry took the request's sheet
		# but the row's save failed) rolls back to here, and the other rows still commit.
		frappe.db.savepoint(ROW_SAVEPOINT)
		try:
			row = frappe.get_doc(PROJECT_ROW_DOCTYPE, name)

			status = (row.tds_status or "").strip()
			make = row.tds_make or ""

			if status == "Approved":
				# Idempotent: already approved, nothing to do.
				continue

			if status not in WAITING_STATUSES:
				errors.append(
					{
						"name": name,
						"error": _("{0} is {1}. Only a row waiting for approval can be approved.").format(
							row.tds_item_name or name, status
						),
					}
				)
				continue

			if is_project_custom_id(row.tds_item_id):
				# ── Project Custom: project-only, never enters the repository ──
				row.tds_status = "Approved"
				row.save(ignore_permissions=True)
				summary["approved"] += 1

			elif status == STATUS_NEW_MAKE:
				# ── New Make: the TDS Item must already exist ──────────────────
				refusal = _approve_new_make(row, choices.get(name), summary)
				if refusal:
					errors.append({"name": name, "error": refusal})

			else:
				# ── Pending (or NULL/empty/legacy): picked existing entry ──────
				tds_item = row.tds_item_id
				entry = _find_entry(tds_item, make)
				if not entry:
					errors.append(
						{
							"name": name,
							"error": _(
								"No TDS Repository entry found for ({0}, {1})."
							).format(tds_item or "—", make or "—"),
						}
					)
					continue

				if frappe.db.get_value(ENTRY_DOCTYPE, entry, "status") != "Verified":
					frappe.db.set_value(ENTRY_DOCTYPE, entry, "status", "Verified")
					summary["verified_existing"] += 1

				row.tds_status = "Approved"
				row.save(ignore_permissions=True)
				summary["approved"] += 1

		except DatasheetChoiceNeeded as e:
			frappe.db.rollback(save_point=ROW_SAVEPOINT)
			errors.append(
				{
					"name": name,
					"error": str(e),
					"needs_datasheet_choice": True,
					"repository_sheet": e.repository_sheet,
				}
			)
		except Exception as e:
			frappe.db.rollback(save_point=ROW_SAVEPOINT)
			frappe.log_error(
				title="TDS approve_tds_items row failure",
				message=f"row={name}: {frappe.get_traceback()}",
			)
			errors.append({"name": name, "error": str(e)})

	frappe.db.commit()

	return {"status": "success", "summary": summary, "errors": errors}


@frappe.whitelist()
def reject_tds_items(doc_names, reason=None):
	"""Reject one or more Project TDS Item List rows (Admin-only).

	Sets `tds_status="Rejected"` and `tds_rejection_reason=reason` on each row.
	No master writes. Commits once at the end.

	`doc_names`: JSON-encoded list (or Python list) of row names.
	`reason`: rejection reason text (stored on every rejected row).

	Returns:
	    {"status": "success", "rejected": <int>,
	     "errors": [ {"name": <row>, "error": <msg>}, ... ]}
	"""
	_require_admin()

	names = _parse_names(doc_names)
	if not names:
		frappe.throw(_("No TDS submittals selected."))

	rejected = 0
	errors = []

	for name in names:
		try:
			row = frappe.get_doc(PROJECT_ROW_DOCTYPE, name)
			row.tds_status = "Rejected"
			row.tds_rejection_reason = reason or ""
			row.save(ignore_permissions=True)
			rejected += 1
		except Exception as e:
			frappe.log_error(
				title="TDS reject_tds_items row failure",
				message=f"row={name}: {frappe.get_traceback()}",
			)
			errors.append({"name": name, "error": str(e)})

	frappe.db.commit()

	return {"status": "success", "rejected": rejected, "errors": errors}
