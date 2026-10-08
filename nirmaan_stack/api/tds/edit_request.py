"""Admin edit of a waiting New Make or Project Custom row (TDS Approval → Pending Review → pencil), #1379.

The edit can switch the row between the two Request Types:
  - to Project Custom: needs a name, a Work Package and a Category under it. The row gets the
    project's `PCUS-` id for that name (or the next one) and is stored `Pending`;
  - to New Make: needs an existing TDS Item. The `PCUS-` id goes and the row is stored `New`.

The row is planned and checked by the same code as a send (`submit.py`), under the same project
lock: the same duplicate checks, Category check and datasheet claim. Its request id stays.

A From Repository row is not edited here; it keeps the browser's "Edit TDS Item" save.
"""

import frappe
from frappe import _

from nirmaan_stack.api.tds.submit import (
	ROW_DOCTYPE,
	STATUS_NEW_MAKE,
	STATUS_PENDING,
	_SAVEPOINT,
	_assign_project_custom_ids,
	_check_replacements,
	_parse_rows,
	_plan_row,
	_project_send_lock,
	_refuse_duplicates,
	attach_upload,
	delete_row_datasheet,
	is_project_custom_id,
)
from nirmaan_stack.services.role_profiles import is_nirmaan_admin


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
	user = frappe.session.user
	if not is_nirmaan_admin(user):
		frappe.throw(_("Only Admin can edit a TDS request."), frappe.PermissionError)

	project = frappe.db.get_value(ROW_DOCTYPE, doc_name, "tdsi_project_id")
	if project is None:
		frappe.throw(_("TDS row {0} not found.").format(doc_name))

	parsed = frappe.parse_json(row) if isinstance(row, str) else row
	(cart_row,) = _parse_rows([parsed])
	cart_row["is_new_request"] = True

	with _project_send_lock(project):
		frappe.db.savepoint(_SAVEPOINT)
		try:
			# Read and row-lock it only now, inside the fresh transaction the lock starts. Approve and
			# reject don't take the project lock: a row they settled before this point reads settled
			# here and is refused, and one they try to save after it waits on this row lock, then
			# fails its own modified-timestamp check instead of overwriting the edit.
			doc = frappe.get_doc(ROW_DOCTYPE, doc_name, for_update=True)
			if not _is_waiting_request(doc):
				frappe.throw(_("Only a waiting New Make or Project Custom request can be edited here."))
			old_attachment = doc.tds_attachment

			plan = _plan_row(cart_row, user, set(), kept_attachment=old_attachment)
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
			# Project Custom: the chosen Category. New Make: left to the before_save hook, which
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
