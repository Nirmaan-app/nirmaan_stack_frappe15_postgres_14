import frappe
from frappe import _


# ─────────────────────────────────────────────────────────────────────────────
# Why this module exists (Phase 2 — group-driven approval/promotion, ADR-0003):
#
# A project consumes TDS by picking a **TDS Item (group) + Make**, or by filing a
# "New" request that PROPOSES a (group, make, datasheet). Every project selection
# needs project-level approval. The OLD approval path (frontend
# `TDSApprovalDetail.handleApprove`) wrote now-REMOVED `TDS Repository` columns
# (`tds_item_id` / `tds_item_name` / `category`) and minted project-only customs
# via the retired `PCUS-` allocator. This module replaces that with a robust,
# Admin-only BACKEND promotion keyed on the restructured `(tds_item, make)` shape.
#
# Row kinds on `Project TDS Item List` (tds_status):
#   - "Pending"  → a PICKED existing entry. tds_item_id = frozen TDS Item id,
#                  tds_make = make. We verify the matching `(tds_item, make)`
#                  `TDS Repository` entry and mark the row Approved.
#   - "New"      → a REQUEST (proposed datasheet). We resolve/create the target
#                  TDS Item (existing by id, or a NEW member-less group — PCUS is
#                  retired, every approved custom is shared), create/find the
#                  `(tds_item, make)` Repository Entry born Verified with the
#                  request's attachment, and SNAPSHOT id/name back onto the row.
#
# Dedup / uniqueness key throughout = `(tds_item, make)`, matching the entry's
# `validate` (`tds_repository.py`). The create-race is handled: if `insert` raises
# a duplicate/validation error we re-read the entry by `(tds_item, make)` and link
# to it instead of failing the whole batch.
#
# Admin-only is enforced SERVER-SIDE first (don't trust the client gate) — same
# check as `api/design_tracker/bulk_update_task_status.py`:
# `"Nirmaan Admin Profile" in frappe.get_roles(user)` OR the Administrator
# superuser. All TDS approval is Admin-only (ADR-0003 P2-5; Project Lead lost the
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

ADMIN_ROLE = "Nirmaan Admin Profile"


def _is_admin(user: str) -> bool:
	"""True for the Administrator superuser or a Nirmaan admin.

	Admin is identified by the user's ROLE PROFILE (`Nirmaan Users.role_profile`
	== "Nirmaan Admin Profile"), NOT by `frappe.get_roles()`. "Nirmaan Admin
	Profile" is a Role *Profile* that bundles roles like System Manager / Nirmaan
	Project Lead — its name never appears in `get_roles()`, so a get_roles check
	would reject every real admin (only the Administrator superuser would pass).
	This mirrors the frontend `useUserData().role` (also the role profile) and the
	canonical backend pattern (e.g. `api/sidebar_counts.py`, `delivery_notes/
	_permission_utils.py`).
	"""
	if user == "Administrator":
		return True
	return frappe.db.get_value("Nirmaan Users", user, "role_profile") == ADMIN_ROLE


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


def _create_member_less_group(tds_item_name, work_package, description=None):
	"""Create and return a NEW member-less TDS Item group (the "custom = member-
	less" model; PCUS is retired — every approved custom enters the shared master).

	Admin may later enrich it with members in the master UI.
	"""
	group = frappe.new_doc(GROUP_DOCTYPE)
	group.tds_item_name = tds_item_name or "Untitled TDS Item"
	group.work_package = work_package
	if description:
		group.description = description
	# Admin-only authorization already enforced upstream by `_require_admin`.
	group.insert(ignore_permissions=True)
	return group.name


def _ensure_entry(tds_item, make, tds_attachment=None, description=None):
	"""Find-or-create the `(tds_item, make)` Repository Entry, born "Verified".

	Returns the entry name. Handles the create-race: if `insert` raises a
	duplicate / validation error (the entry's `validate` throws on a duplicate
	`(tds_item, make)`), re-read by the same key and link to the existing entry
	instead of failing.
	"""
	existing = _find_entry(tds_item, make)
	if existing:
		# Promote an existing entry to Verified if it isn't already.
		if frappe.db.get_value(ENTRY_DOCTYPE, existing, "status") != "Verified":
			frappe.db.set_value(ENTRY_DOCTYPE, existing, "status", "Verified")
		return existing

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
		return entry.name
	except (frappe.DuplicateEntryError, frappe.UniqueValidationError, frappe.ValidationError):
		# Lost the create-race (or the entry's `validate` rejected the duplicate).
		# Re-read by the uniqueness key and link to the winner.
		winner = _find_entry(tds_item, make)
		if not winner:
			# Genuinely unexpected — re-raise so the per-row error is surfaced.
			raise
		if frappe.db.get_value(ENTRY_DOCTYPE, winner, "status") != "Verified":
			frappe.db.set_value(ENTRY_DOCTYPE, winner, "status", "Verified")
		return winner


@frappe.whitelist()
def approve_tds_items(doc_names):
	"""Approve one or more Project TDS Item List rows (Admin-only).

	`doc_names`: a JSON-encoded list (or Python list) of `Project TDS Item List`
	row names.

	Per row:
	  - **Pending (picked existing entry):** locate the `(tds_item_id, tds_make)`
	    `TDS Repository` entry; set its `status="Verified"` (only if not already);
	    set the row `tds_status="Approved"`.
	  - **New (request):** resolve the target TDS Item — use `tds_item_id` if it
	    already references an existing `TDS Items` doc, else create a NEW
	    member-less group from `tds_item_name` + `tds_work_package`; create/find
	    the `(tds_item, tds_make)` entry born `status="Verified"` carrying the
	    row's `tds_attachment` (+ description if present); SNAPSHOT the resolved
	    TDS Item id/name back onto the row; set `tds_status="Approved"`.

	Dedup / uniqueness key = `(tds_item, make)`. The create-race is handled by
	re-reading the entry on a duplicate/validation error. Commits once at the end.

	Returns:
	    {
	        "status": "success",
	        "summary": {
	            "verified_existing": <int>,   # existing entries promoted to Verified
	            "created_entries":   <int>,   # new (tds_item, make) entries created
	            "created_groups":    <int>,   # new member-less TDS Items created
	            "approved":          <int>,   # rows set to Approved
	        },
	        "errors": [ {"name": <row>, "error": <msg>}, ... ],
	    }
	"""
	_require_admin()

	names = _parse_names(doc_names)
	if not names:
		frappe.throw(_("No TDS submittals selected."))

	summary = {
		"verified_existing": 0,
		"created_entries": 0,
		"created_groups": 0,
		"approved": 0,
	}
	errors = []

	for name in names:
		try:
			row = frappe.get_doc(PROJECT_ROW_DOCTYPE, name)

			status = (row.tds_status or "").strip()
			make = row.tds_make or ""

			if status == "Approved":
				# Idempotent: already approved, nothing to do.
				continue

			if status == "New":
				# ── Request: resolve/create the target TDS Item group ──────────
				tds_item = row.tds_item_id
				is_existing_group = bool(
					tds_item and frappe.db.exists(GROUP_DOCTYPE, tds_item)
				)

				if not is_existing_group:
					tds_item = _create_member_less_group(
						row.tds_item_name,
						row.tds_work_package,
						row.tds_description,
					)
					summary["created_groups"] += 1

				# Find-or-create the (tds_item, make) entry, born Verified.
				existed_before = bool(_find_entry(tds_item, make))
				_ensure_entry(
					tds_item,
					make,
					tds_attachment=row.tds_attachment,
					description=row.tds_description,
				)
				if existed_before:
					summary["verified_existing"] += 1
				else:
					summary["created_entries"] += 1

				# Snapshot the resolved id/name back onto the row.
				# (make / attachment already live on the row.)
				row.tds_item_id = tds_item
				row.tds_item_name = frappe.db.get_value(
					GROUP_DOCTYPE, tds_item, "tds_item_name"
				) or row.tds_item_name
				row.tds_status = "Approved"
				row.save(ignore_permissions=True)
				summary["approved"] += 1

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

		except Exception as e:
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
