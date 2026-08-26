# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Read expense requests and the request catalog.

URLs:
  /api/method/nirmaan_stack.api.expense_requests.read.get_my_expense_requests
  /api/method/nirmaan_stack.api.expense_requests.read.get_request_catalog
"""

import frappe

from nirmaan_stack.api.expense_requests.access import ADMIN_PROFILE, caller_role_profile
from nirmaan_stack.api.expense_requests.convert import target_doctype, target_status
from nirmaan_stack.api.expense_requests.flatten import flatten_pairs
from nirmaan_stack.api.expense_requests.update import can_edit
from nirmaan_stack.services.expense_request_routing import (
	category_for_type,
	requestable_types,
	resolved_categories,
	reviewer_role_for_type,
)

FIELDS = [
	"name", "type", "projects", "amount", "comment",
	# `vendor` is read for the EDIT dialog, which seeds itself from this row. Omitting it does
	# not merely hide the vendor -- the dialog would seed blank and the save would CLEAR a
	# vendor the requester had picked, silently.
	"vendor",
	"source_data", "status", "reviewed_by", "reviewed_on", "review_comment",
	"owner", "creation", "modified",
]


@frappe.whitelist()
def get_my_expense_requests(status: str | None = None, limit: int = 200):
	"""Every request the caller may see, enriched with the derived review fields.

	⚠️ THERE IS NO ROW SCOPING. The `permission_query_conditions` hook was removed, so this
	returns every request the caller's ROLE may read -- and eight roles hold read DocPerm, so
	a PM sees other PMs' requests. `can_review` below still narrows who may ACT on a row; it
	does not narrow who may SEE one.

	`frappe.get_list` is still correct over `frappe.get_all` -- the latter is `get_list` with
	`ignore_permissions=True`, which would ignore the DocPerm too.
	"""
	user = frappe.session.user
	profile = caller_role_profile(user)

	filters = {}
	if status:
		filters["status"] = status

	rows = frappe.get_list(
		"Expense Request",
		filters=filters,
		fields=FIELDS,
		order_by="modified desc",
		limit_page_length=limit,
	)

	# One read of the formats for the whole page, rather than one per row.
	formats = {
		f["name"]: f["source_format"]
		for f in frappe.get_all("Expense Type", fields=["name", "source_format"],
		                        filters={"source_format": ["is", "set"]})
	}

	# Category and reviewer are DERIVED, never stored — a routing change re-resolves history
	# consistently instead of leaving rows stamped with a retired branch.
	for r in rows:
		r["request_category"] = category_for_type(r["type"])
		r["reviewer_role"] = reviewer_role_for_type(r["type"])
		# Server-owned, exactly like `can_review`: the table must never re-derive a
		# permission, and the two answers are deliberately DISJOINT -- a reviewer who could
		# also edit could rewrite an amount and then approve it.
		r["can_edit"] = can_edit(r, user)
		r["can_review"] = profile == ADMIN_PROFILE or (
			profile == r["reviewer_role"] and r["owner"] != user
		)
		# The answers, labelled, for the approval screen. Built by the SAME walk that writes
		# the ledger description, so what a reviewer approves and what lands on the expense
		# can never describe the request differently.
		# EVERY request, formatted or not -- `source_data` is the only home for the detail
		# now, so this block is the only thing that shows what was asked for.
		r["detail"] = [
			{"label": label, "value": value}
			for label, value in flatten_pairs(r.get("source_data"), formats.get(r["type"]))
		]
		# Which ledger this becomes, AND what status it will land at -- both resolved
		# server-side so the dialog states the outcome rather than re-deriving the rule.
		# The status is amount-dependent since 2026-08-20, and the threshold lives on the
		# ledger doctypes; a TypeScript copy of it would be free to disagree with `validate`.
		r["target_doctype"] = target_doctype(frappe._dict(r))
		r["target_status"] = target_status(frappe._dict(r))

	return {"role_profile": profile, "requests": rows}


@frappe.whitelist()
def get_request_catalog():
	"""The requestable types with their flags and format, for the create dialog.

	Categories come from the `Expense Category` master, so adding one or re-pointing its
	reviewer is an edit in the app rather than a deploy.

	Served from the backend rather than mirrored in TypeScript so the allow-list has ONE
	definition. A client copy would be free to drift from the one `create` enforces, and the
	drift would present as a type the picker offers and the server then refuses.

	`has_format` drives whether the dialog renders a template step; `project` /
	`non_project` drive the conditional Project field (mirroring the doctype's
	`type_allows_project` fetch).
	"""
	types = requestable_types()
	rows = frappe.get_all(
		"Expense Type",
		filters={"name": ["in", list(types)]},
		fields=["name", "project", "non_project", "source_format"],
	) if types else []
	by_name = {r["name"]: r for r in rows}

	categories = []
	for name, reviewer_role, cat_types in resolved_categories():
		entries = []
		for t in cat_types:
			f = by_name.get(t)
			if not f:
				# The catalog names a type that does not exist. Skip rather than offering
				# something `create` would refuse.
				continue
			entries.append(
				{
					"expense_type": t,
					"project": bool(f["project"]),
					"non_project": bool(f["non_project"]),
					# project-only => required; non-project-only => hidden; both => optional
					"project_required": bool(f["project"]) and not bool(f["non_project"]),
					"project_allowed": bool(f["project"]),
					"has_format": bool((f.get("source_format") or "").strip()),
				}
			)
		categories.append({"category": name, "reviewer_role": reviewer_role, "types": entries})

	return {"categories": categories}


@frappe.whitelist()
def get_expense_format(expense_type: str):
	"""The raw `source_format` for one type, or None. Read by the create dialog on pick."""
	fmt = frappe.db.get_value("Expense Type", expense_type, "source_format")
	return {"expense_type": expense_type, "source_format": (fmt or None)}
