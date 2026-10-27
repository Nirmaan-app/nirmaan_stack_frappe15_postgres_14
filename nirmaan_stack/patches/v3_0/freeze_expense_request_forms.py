# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Freeze the form every existing Expense Request was filled against (spec #1494, #1503).

Until #1503 nothing wrote `Expense Request Template Snapshot`, so a request read against its type's
LIVE form. #1503's fixture trims those forms: fields come off, every upload slot goes, and 25 forms
are switched off. This stamps each request filled against a form with a snapshot of that form as
the database holds it now (`source_data.snapshotHash`), so the request keeps its labels, its
sentence and the bill in its slot (`convert.applicable_format` prefers the snapshot).

⚠️ ORDER: a `[post_model_sync]` patch, which `bench migrate` runs BEFORE it syncs the fixtures, so
the forms read here are the ones the requests were raised against, not the trimmed ones.

Idempotent: a request that already carries a snapshot is left as it is.

⚠️ RAW WRITE: `frappe.db.set_value` fires no `doc_events`. Skipping them is correct: the only
Expense Request hook is the `validate` that copies a vendor's Payee, and this adds one envelope key
to the answers, which no derived field reads.
"""

import frappe

from nirmaan_stack.api.expense_requests.convert import applicable_format
from nirmaan_stack.api.expense_requests.flatten import filled_against_a_form
from nirmaan_stack.api.expense_requests.form_snapshot import snapshot_of, with_snapshot


def execute():
	forms = {
		t.name: t for t in frappe.get_all(
			"Expense Type", fields=["name", "source_format", "source_format_enabled"])
	}
	rows = frappe.get_all(
		"Expense Request",
		filters={"source_data": ["like", '%"templateId"%']},
		fields=["name", "type", "source_data"],
	)
	for r in rows:
		if snapshot_of(r.source_data) or not filled_against_a_form(r.source_data):
			continue
		live = forms.get(r.type) or frappe._dict()
		fmt = applicable_format(live.source_format, live.source_format_enabled, r.source_data)
		if not fmt:
			continue
		frappe.db.set_value("Expense Request", r.name, "source_data",
		                    with_snapshot(r.source_data, fmt), update_modified=False)
