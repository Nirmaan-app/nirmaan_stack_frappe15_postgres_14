"""Lifecycle hooks for `Project HOD Document` (one handover document of one system on one project).

In a hook, not in the API, so a Desk edit, a bulk edit or a Data Import is held to the same rules as the
Handover Documents screen:

1. one row per project x system x document (a friendly message; the unique index added by the doctype's
   `on_doctype_update` is what stops a race);
2. a new row needs an ACTIVE HOD System;
3. a switched-off row (`disabled`) cannot be worked on: its remarks and form data stay as they were
   until it is switched back on. Switching it on or off is always allowed;
4. `status` is the document's progress, Not Started / WIP / Done (owner 2026-10-06, replacing the
   YES / NO / NA answer of 2026-09-24 -- the checklist's YES / NO is now the on/off switch). The controller
   GUARDS it: **Done is refused on a FROM NIRMAAN document with no records ticked and no file uploaded**
   (`checklist.can_be_done`), so a Desk edit and the Handover Documents screen are held to the same rule.
   A form or a library text needs no save -- it prints from its own layout (owner 2026-09-28). WIP and
   Not Started are always allowed.
"""

import json

import frappe
from frappe import _

from nirmaan_stack.services.hod import checklist, index

_LOCKED_WHEN_OFF = ("remarks", "form_data")


def _normalised(fieldname, value):
	if fieldname == "form_data":
		if isinstance(value, str):
			try:
				value = json.loads(value) if value.strip() else {}
			except ValueError:
				return value
		return json.dumps(value or {}, sort_keys=True)
	return value or None


def validate(doc, method=None):
	if not index.is_valid(doc.document):
		frappe.throw(_("Unknown handover document: {0}").format(doc.document))
	# Anything that is not one of the three statuses -- a blank, or a row still carrying a retired
	# YES / NO / NA -- is healed here, before Frappe's own Select check runs.
	status = checklist.normalise_status(doc.status)
	doc.status = status
	if status == checklist.STATUS_DONE and not checklist.can_be_done(doc.document, doc.form_data):
		frappe.throw(
			_("{0} has no records ticked and no file uploaded yet, so it cannot be marked Done. Open it, "
			  "tick what it hands over and Mark as Done -- or upload the document from the ⋯ menu.").format(
				index.get(doc.document)["title"]
			)
		)

	if doc.is_new():
		if not frappe.db.get_value("HOD System", doc.hod_system, "is_active"):
			frappe.throw(_("HOD System {0} is not active.").format(doc.hod_system))
		if frappe.db.exists(
			"Project HOD Document",
			{"project": doc.project, "hod_system": doc.hod_system, "document": doc.document},
		):
			frappe.throw(
				_("{0} already has {1} for {2}.").format(doc.project, index.get(doc.document)["title"], doc.hod_system)
			)
		return

	before = doc.get_doc_before_save()
	if before is None or not (before.disabled and doc.disabled):
		return
	changed = [f for f in _LOCKED_WHEN_OFF if _normalised(f, before.get(f)) != _normalised(f, doc.get(f))]
	if changed:
		frappe.throw(
			_("{0} is switched off for this project. Switch it on before changing it.").format(
				index.get(doc.document)["title"]
			)
		)
