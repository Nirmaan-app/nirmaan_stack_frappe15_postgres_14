"""Lifecycle hooks for `Project HOD Document` (one handover document of one system on one project).

In a hook, not in the API, so a Desk edit, a bulk edit or a Data Import is held to the same rules as the
Handover Documents screen:

1. one row per project x system x document (a friendly message; the unique index added by the doctype's
   `on_doctype_update` is what stops a race);
2. a new row needs an ACTIVE HOD System;
3. a switched-off row (`disabled`) cannot be worked on: its remarks and form data stay as they were
   until it is switched back on. Switching it on or off is always allowed;
4. `status` is DERIVED on every save (`services/hod/checklist.derive_status`, owner 2026-09-22): Completed
   when the document is marked completed by hand, Form Filled when a fillable document's form is saved,
   else Pending. Whatever a caller sends for it is overwritten.
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
	doc.status = checklist.derive_status(doc.document, doc.form_data)

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
