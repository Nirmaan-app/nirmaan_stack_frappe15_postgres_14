"""Admin edits of a waiting Project TDS row (TDS Approval → Pending Review → pencil).

`edit_tds_request` (#1379) edits a New Make or Project Custom row. The edit can switch the row
between the two Request Types:
  - to Project Custom: needs a name, a Work Package and a Category under it. The row gets the
    project's `PCUS-` id for that name (or the next one) and is stored `Pending`;
  - to New Make: needs an existing TDS Item. The `PCUS-` id goes and the row is stored `New`.

`edit_tds_pick` (#1383) edits a From Repository row (the "Edit TDS Item" box). It stays a pick: it
takes the Repository Entry of the TDS Item + make it is edited to, and that entry's datasheet,
exactly as a send stores a pick.

`resolve_rejected_tds` resolves a Rejected row (GLOSSARY "Resolve"): an Admin or PMO Executive
switches it to another Repository make of its TDS Item, or edits a Project Custom row as
`edit_tds_request` edits a request (but it stays Project Custom), and it waits again as Pending.

All three plan and check the row with the same code as a send (`submit.py`), under the same project
lock: the same duplicate checks, replacement check, Category check and datasheet claim. The edit
and the delete of the Rejected row it replaces happen in one transaction: both, or neither. The
row's request id stays.
"""

import frappe
from frappe import _

from nirmaan_stack.api.tds.approve import WAITING_STATUSES
from nirmaan_stack.api.tds.status_label import history_status_label
from nirmaan_stack.api.tds.submit import (
	ROW_DOCTYPE,
	STATUS_NEW_MAKE,
	STATUS_PENDING,
	STATUS_REJECTED,
	_SAVEPOINT,
	_assign_project_custom_ids,
	_check_replacements,
	_item_make_key,
	_parse_rows,
	_plan_row,
	_project_send_lock,
	_refuse_duplicates,
	_stored_key,
	attach_upload,
	delete_row_datasheet,
	is_project_custom_id,
)
from nirmaan_stack.services.role_profiles import (
	ADMIN_PROFILE,
	PMO_EXECUTIVE_PROFILE,
	has_role_profile,
	is_nirmaan_admin,
)

# A From Repository row still waiting: the waiting statuses but New, which only a New Make carries.
WAITING_PICK_STATUSES = tuple(s for s in WAITING_STATUSES if s != STATUS_NEW_MAKE)
# Who may resolve a Rejected row. Mirrors `canManageTDS` in `TdsHistoryTable.tsx`.
RESOLVE_PROFILES = (ADMIN_PROFILE, PMO_EXECUTIVE_PROFILE)


@frappe.whitelist(methods=["POST"])
def edit_tds_request(doc_name, row):
	"""Save an Admin's edit of one waiting New Make or Project Custom row.

	`doc_name`: the `Project TDS Item List` row.
	`row`: JSON object (or dict), the cart-row shape `submit_tds_request` reads:
	    {
	        "is_project_custom": false,         # the Type the row becomes
	        "tds_item_id": "TDS-ITEM-00012",    # New Make only
	        "tds_item_name": "", "work_package": "", "category": "",  # Project Custom only
	        "make": "MakeA",
	        "tds_boq_line_item": "",
	        "description": "",
	        "tds_attachment": "<file_url>",     # the row's current sheet, or the editor's unattached upload
	        "previous_doc_name": "<row>",       # a Rejected row this one replaces
	    }

	Refuses (nothing saved) when the caller is not Admin, the row is not a waiting New Make or
	Project Custom row, or on anything a send refuses for that row.

	Returns: {"name": <row>, "tds_item_id": ..., "tds_status": ...}
	"""
	_require_admin()
	cart_row = _parse_edit(row)
	cart_row["is_new_request"] = True
	return _save_edit(
		doc_name,
		_is_waiting_request,
		_("Only a waiting New Make or Project Custom request can be edited here."),
		lambda user, doc: _plan_row(cart_row, user, set(), kept_attachment=doc.tds_attachment),
	)


@frappe.whitelist(methods=["POST"])
def edit_tds_pick(doc_name, row):
	"""Save an Admin's "Edit TDS Item" of one waiting From Repository row.

	`doc_name`: the `Project TDS Item List` row.
	`row`: JSON object (or dict):
	    {
	        "tds_item_id": "TDS-ITEM-00012",
	        "make": "MakeA",                    # needs a Repository Entry for that TDS Item
	        "tds_boq_line_item": "",
	        "description": "",
	        "previous_doc_name": "<row>",       # a Rejected row this one replaces
	    }

	The row takes that entry's datasheet and stays Pending. Refuses (nothing saved, the replaced row
	kept) when the caller is not Admin, the row is not a waiting From Repository row, or on anything
	a send refuses for a pick: no entry for the item + make, the same item + make already live on the
	project (Pending, New or Approved), or a replace target that is not its Rejected row.

	Returns: {"name": <row>, "tds_item_id": ..., "tds_status": ...}
	"""
	_require_admin()
	cart_row = _parse_edit(row)
	cart_row.update(is_new_request=False, is_project_custom=False)

	def plan_pick(user, _doc):
		plan = _plan_row(cart_row, user, set())
		# A send stores no description on a pick; this box has always let the Admin write one.
		plan["tds_description"] = cart_row["description"]
		return plan

	return _save_edit(
		doc_name,
		_is_waiting_pick,
		_("Only a waiting From Repository row can be edited here."),
		plan_pick,
	)


@frappe.whitelist(methods=["POST"])
def resolve_rejected_tds(doc_name, make, tds_attachment=None, custom=None):
	"""Resolve one Rejected row and send it back for approval as Pending.

	`doc_name`: the `Project TDS Item List` row, Rejected.
	`make`: for a TDS Repository item, a make with a Repository Entry for the row's TDS Item, other
	than the row's own. For a Project Custom row, a Makelist make, or its own to keep the make.
	`tds_attachment`: Project Custom only, optional: file_url of the caller's unattached upload, a
	new datasheet. Without it the row keeps its current one.
	`custom`: Project Custom only, optional: JSON object (or dict) of the row's other fields as
	edited; a field left out keeps the row's value:
	    {
	        "tds_item_name": "Facade Light",
	        "work_package": "Electrical Work",
	        "category": "Lighting",              # under `work_package`
	        "tds_boq_line_item": "BOQ 7.1",
	        "description": "IP66, 3000K",
	    }

	A Repository item's row becomes a Pending pick carrying that entry's datasheet (a rejected New
	Make's own upload is deleted); it keeps its BOQ Ref and description. A Project Custom row stays
	Project Custom with the edited fields: a rename takes the `PCUS-` id of that name on the project,
	or the next one, and a new datasheet replaces the old upload, which is deleted. Either way the
	row keeps its request id and rejection reason, which the screen shows only while a row is
	Rejected.

	Refuses (nothing saved) when the caller is not Admin or PMO Executive; the row is not Rejected;
	a Repository row's make is its own or has no entry, or a datasheet or `custom` is sent for it; a
	Project Custom row changes nothing, misses its name, Work Package or Category, has a Category not
	under its Work Package, or changes its make to one not in the Makelist; or the item + make is
	already on the project at any status, Rejected included. A legacy row (`ITEM-`, `CUS-`) matches
	no TDS Item and is refused.

	Returns: {"name": <row>, "tds_item_id": ..., "tds_status": "Pending"}
	"""
	if not has_role_profile(frappe.session.user, RESOLVE_PROFILES):
		frappe.throw(_("Only Admin or PMO can resolve a rejected TDS request."), frappe.PermissionError)
	make = (make or "").strip()
	new_sheet = tds_attachment or ""
	fields = (frappe.parse_json(custom) if isinstance(custom, str) else custom) or None

	def plan_resolve(user, doc):
		if is_project_custom_id(doc.tds_item_id):
			plan = _plan_custom_resolve(doc, make, new_sheet, fields or {}, user)
		else:
			if fields:
				frappe.throw(_("Only a Project Custom item's details can be edited here."))
			plan = _plan_pick_resolve(doc, make, new_sheet, user)
		_refuse_rejected_duplicate(doc, plan)
		return plan

	return _save_edit(doc_name, _is_resolvable, _not_resolvable, plan_resolve)


def _plan_pick_resolve(doc, make, new_sheet, user):
	"""Another Repository make of the row's TDS Item; the row takes that entry's datasheet."""
	if new_sheet:
		frappe.throw(_("A TDS Repository item takes its make's datasheet from the Repository."))
	if make == doc.tds_make:
		frappe.throw(_("Pick a make other than {0}.").format(doc.tds_make))
	(cart_row,) = _parse_rows(
		[{"tds_item_id": doc.tds_item_id, "make": make, "tds_boq_line_item": doc.tds_boq_line_item}]
	)
	plan = _plan_row(cart_row, user, set())
	# Only the make changes; a send stores no description on a pick.
	plan["tds_description"] = doc.tds_description or ""
	return plan


# A Project Custom row's fields Resolve may edit besides the make: `custom` key -> stored field.
CUSTOM_RESOLVE_FIELDS = {
	"tds_item_name": "tds_item_name",
	"work_package": "tds_work_package",
	"category": "tds_category",
	"tds_boq_line_item": "tds_boq_line_item",
	"description": "tds_description",
}


def _plan_custom_resolve(doc, make, new_sheet, fields, user):
	"""The row edited as a Project Custom request (`_plan_project_custom`): every field from `fields`,
	falling back to the row's own, and the new datasheet or the row's current one."""
	if new_sheet == doc.tds_attachment:
		new_sheet = ""
	edited = {key: fields.get(key, doc.get(field)) or "" for key, field in CUSTOM_RESOLVE_FIELDS.items()}
	changed = make != (doc.tds_make or "") or any(
		str(edited[key]).strip() != (doc.get(field) or "").strip() for key, field in CUSTOM_RESOLVE_FIELDS.items()
	)
	if not (changed or new_sheet):
		frappe.throw(_("Change something or upload a new datasheet."))
	# The picker offers the Makelist, as Request New does; a row's own make may predate it.
	if make != doc.tds_make and not frappe.db.exists("Makelist", make):
		frappe.throw(_("{0} is not in the make list. Pick a make from the list.").format(make or "That make"))
	(cart_row,) = _parse_rows(
		[{**edited, "is_project_custom": True, "make": make, "tds_attachment": new_sheet or doc.tds_attachment}]
	)
	return _plan_row(cart_row, user, set(), kept_attachment=doc.tds_attachment)


def _refuse_rejected_duplicate(doc, plan):
	"""Refuse an item + make that is Rejected on another row of the project. `_refuse_duplicates`
	covers every other status; it skips Rejected rows because a resubmit replaces them. Matched as
	there: the TDS Item, or a Project Custom row's folded name."""
	key = _item_make_key(plan["tds_item_id"], plan["custom_name_key"], plan["tds_make"])
	rejected = frappe.get_all(
		ROW_DOCTYPE,
		filters={"tdsi_project_id": doc.tdsi_project_id, "tds_status": STATUS_REJECTED, "name": ["!=", doc.name]},
		fields=["tds_item_id", "tds_item_name", "tds_make", "tds_request_id"],
		limit_page_length=0,
	)
	for other in rejected:
		if _stored_key(other) == key:
			frappe.throw(
				_("{0} ({1}) is already on this project in request {2}.").format(
					plan["tds_item_name"], plan["tds_make"], other.tds_request_id or "—"
				)
			)


def _require_admin():
	if not is_nirmaan_admin(frappe.session.user):
		frappe.throw(_("Only Admin can edit a TDS request."), frappe.PermissionError)


def _parse_edit(row):
	parsed = frappe.parse_json(row) if isinstance(row, str) else row
	(cart_row,) = _parse_rows([parsed])
	return cart_row


def _save_edit(doc_name, is_editable, not_editable, plan_edit):
	"""Check and save one edit under the project's send lock: every write, or none. The caller has
	already checked the user's role.

	`is_editable(doc)`: whether the stored row may be edited on this path; `not_editable` otherwise,
	a message or a function of the row that returns one.
	`plan_edit(user, doc)`: the fields the row will be stored with (`submit._plan_row`)."""
	user = frappe.session.user
	project = frappe.db.get_value(ROW_DOCTYPE, doc_name, "tdsi_project_id")
	if project is None:
		frappe.throw(_("TDS row {0} not found.").format(doc_name))

	with _project_send_lock(project):
		frappe.db.savepoint(_SAVEPOINT)
		try:
			# Read and row-lock it only now, inside the fresh transaction the lock starts. Approve and
			# reject don't take the project lock: a row they settled before this point reads settled
			# here and is refused, and one they try to save after it waits on this row lock, then
			# fails its own modified-timestamp check instead of overwriting the edit.
			doc = frappe.get_doc(ROW_DOCTYPE, doc_name, for_update=True)
			if not is_editable(doc):
				frappe.throw(not_editable(doc) if callable(not_editable) else not_editable)
			old_attachment = doc.tds_attachment

			plan = plan_edit(user, doc)
			_refuse_duplicates(project, [plan], exclude=doc_name)
			_assign_project_custom_ids(project, [plan])
			_check_replacements(project, [plan])

			doc.update(
				{
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
			# Project Custom: the chosen Category. Otherwise left to the before_save hook, which
			# re-derives it from the TDS Item when the id changes.
			if plan["tds_category"] is not None:
				doc.tds_category = plan["tds_category"]
			doc.save()
			if plan["upload"]:
				attach_upload(plan["upload"], doc_name)
			if plan["replaces"]:
				frappe.delete_doc(ROW_DOCTYPE, plan["replaces"])
			# Last: a new sheet leaves the row's old upload pointed at by nothing. A sheet the row
			# borrows from a Repository Entry is not the row's File and is left alone.
			if plan["tds_attachment"] != old_attachment:
				delete_row_datasheet(doc_name, old_attachment)
		except Exception:
			frappe.db.rollback(save_point=_SAVEPOINT)
			raise

		frappe.db.commit()

	return {"name": doc_name, "tds_item_id": doc.tds_item_id, "tds_status": doc.tds_status}


def _is_waiting_request(row):
	"""A New Make (`New`), or a Project Custom row still `Pending`."""
	return row.tds_status == STATUS_NEW_MAKE or (
		row.tds_status == STATUS_PENDING and is_project_custom_id(row.tds_item_id)
	)


def _is_waiting_pick(row):
	"""A From Repository row still waiting: Pending (or a legacy blank status), with no `PCUS-` id."""
	return (row.tds_status or "") in WAITING_PICK_STATUSES and not is_project_custom_id(row.tds_item_id)


def _is_resolvable(row):
	return row.tds_status == STATUS_REJECTED


def _not_resolvable(row):
	return _("Only a Rejected row can be resolved; this one is {0}.").format(history_status_label(row.tds_status))
