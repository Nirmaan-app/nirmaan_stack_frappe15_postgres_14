# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The form a request was filled against, frozen (ADR-0016 decision 1).

A type's form changes under requests already raised against it: #1503 took fields off, removed
every upload slot and switched 25 forms off. A request in flight must still read against ITS form:
its answers under the labels it was asked with, its sentence, and the bill in the slot it was
uploaded to (`flatten.first_mapped_attachment`). So on every create and edit the form is stored
once in `Expense Request Template Snapshot` (named by its hash) and the request carries that name
as `source_data.snapshotHash`. `convert.applicable_format` prefers it to the live form.

Requests raised before snapshots existed were stamped with their type's form of the day by the
patch `v3_0.freeze_expense_request_forms`, which ran before the trimmed fixture landed.
"""

import json

import frappe

from nirmaan_stack.api.expense_requests.flatten import _as_dict, filled_against_a_form
from nirmaan_stack.services.template_snapshots import get_or_create_snapshot

SNAPSHOT_DOCTYPE = "Expense Request Template Snapshot"
SNAPSHOT_KEY = "snapshotHash"


def snapshot_of(source_data) -> str | None:
	"""The name of the snapshot `source_data` carries, or None."""
	value = (_as_dict(source_data) or {}).get(SNAPSHOT_KEY)
	return value if isinstance(value, str) and value else None


def with_snapshot(source_data, source_format) -> str | None:
	"""`source_data` as JSON, stamped with the snapshot of `source_format`.

	A request not filled against a form, or a type with no form, carries no snapshot. Any snapshot
	the caller sent is replaced: which form a request was filled against is the server's to say.
	"""
	data = _as_dict(source_data)
	if data is None:
		return source_data
	data = {k: v for k, v in data.items() if k != SNAPSHOT_KEY}
	fmt = _as_dict(source_format)
	if fmt and filled_against_a_form(data):
		data[SNAPSHOT_KEY] = get_or_create_snapshot(SNAPSHOT_DOCTYPE, fmt)
	return json.dumps(data)


def stamp_live_form(expense_type: str, source_data) -> str | None:
	"""`with_snapshot` for the type's form as it is now, for the create and edit calls.

	Only a form switched ON is frozen: answers filled against a form that is off are refused by
	`create.guard_request_form` before this runs.
	"""
	row = frappe.db.get_value(
		"Expense Type", expense_type, ["source_format", "source_format_enabled"], as_dict=True)
	live = row.source_format if row and row.source_format_enabled else None
	return with_snapshot(source_data, live)


def frozen_forms(source_datas) -> dict:
	"""`{snapshot name: format JSON}` for every snapshot the given `source_data`s carry, read once."""
	names = {n for n in (snapshot_of(s) for s in source_datas) if n}
	if not names:
		return {}
	return dict(frappe.get_all(SNAPSHOT_DOCTYPE, filters={"name": ["in", list(names)]},
	                           fields=["name", "payload"], as_list=True))


def frozen_form(source_data) -> str | None:
	"""The format JSON of the snapshot `source_data` carries, or None."""
	name = snapshot_of(source_data)
	return frappe.db.get_value(SNAPSHOT_DOCTYPE, name, "payload") if name else None
