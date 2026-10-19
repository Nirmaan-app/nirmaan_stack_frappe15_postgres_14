# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Read expense requests and the request catalog.

URLs:
  /api/method/nirmaan_stack.api.expense_requests.read.get_my_expense_requests
  /api/method/nirmaan_stack.api.expense_requests.read.get_expense_request
  /api/method/nirmaan_stack.api.expense_requests.read.get_request_catalog
"""

import frappe

from nirmaan_stack.api.expense_requests.access import (
	ADMIN_PROFILE,
	PM_REQUEST_REVIEWERS,
	REJECTED,
	caller_role_profile,
	can_request_type,
	records_without_review,
	reviews_pm_request,
)
from nirmaan_stack.api.expense_requests.convert import (
	applicable_format,
	target_doctype,
	target_status,
)
from nirmaan_stack.api.expense_requests.delete import can_delete, requests_with_an_expense
from nirmaan_stack.api.expense_requests.flatten import (
	NATIVE_INVOICE_SECTION,
	flatten_pairs,
	native_invoice,
)
from nirmaan_stack.api.expense_requests.invoice import invoice_refusal, linked_expense
from nirmaan_stack.api.expense_requests.update import can_edit
from nirmaan_stack.services.expense_request_routing import (
	category_for_type,
	requestable_types,
	resolved_categories,
	reviewer_role_for_type,
)
from nirmaan_stack.services.payees.expense_rules import NOT_ASKED
from nirmaan_stack.services.payees.pay_to import PAY_TO_FIELDS, pay_to_account

FIELDS = [
	"name", "type", "projects", "amount", "comment",
	# `vendor` is read for the EDIT dialog, which seeds itself from this row. Omitting it does
	# not merely hide the vendor -- the dialog would seed blank and the save would CLEAR a
	# vendor the requester had picked, silently.
	"vendor",
	# Who gets paid: the request's own pay-to account (#1436), served as `pay_to`. The reviewer
	# reads it before deciding, and the edit dialog shows it.
	*PAY_TO_FIELDS,
	"source_data", "status", "reviewed_by", "reviewed_on", "review_comment",
	# Records without review (#1498): approved on submit, with no Reviewer. Shown on the request.
	"approved_on_submit",
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

	# Requesters' profiles, read once for the page -- only an Accountant / HR caller needs
	# them, to find the Project Manager rows they may review.
	requester_profiles = {}
	if profile in PM_REQUEST_REVIEWERS and rows:
		requester_profiles = dict(frappe.get_all(
			"Nirmaan Users",
			filters={"name": ["in", list({r["owner"] for r in rows})]},
			fields=["name", "role_profile"],
			as_list=True,
		))

	# One read of the formats for the whole page, rather than one per row.
	formats = {
		f["name"]: f
		for f in frappe.get_all("Expense Type",
		                        fields=["name", "source_format", "source_format_enabled"],
		                        filters={"source_format": ["is", "set"]})
	}
	# Which rejected rows still have an Expense, read once for the page: those are deleted only
	# through their Expense, so they carry no trash button.
	with_expense = requests_with_an_expense(r["name"] for r in rows if r["status"] == REJECTED)

	# Each type's *Who gets paid* (#1466), so the review dialog words a missing account by it.
	payee_rules = dict(frappe.get_all("Expense Type", fields=["name", "payee_rule"], as_list=True))

	# Category and reviewer are DERIVED, never stored — a routing change re-resolves history
	# consistently instead of leaving rows stamped with a retired branch.
	for r in rows:
		r["request_category"] = category_for_type(r["type"])
		r["reviewer_role"] = reviewer_role_for_type(r["type"])
		# Server-owned, exactly like `can_review`: the table must never re-derive a
		# permission. The two answers are disjoint for a routed REVIEWER -- one who could also
		# edit could rewrite an amount and then approve it -- but NOT for an Admin, who holds
		# both by owner ruling. See the amendment note in `update`.
		# Must say what `access.guard_reviewer` says, or the button appears on a row the
		# endpoint then refuses.
		r["can_edit"] = can_edit(r, user)
		r["can_delete"] = can_delete(r, user, admin=profile == ADMIN_PROFILE,
		                             has_expense=r["name"] in with_expense)
		r["can_review"] = profile == ADMIN_PROFILE or (
			r["owner"] != user
			and (profile == r["reviewer_role"]
			     or reviews_pm_request(profile, requester_profiles.get(r["owner"])))
		)
		# The answers, labelled, for the approval screen. Built by the SAME walk that writes
		# the ledger description, so what a reviewer approves and what lands on the expense
		# can never describe the request differently.
		# EVERY request, formatted or not -- `source_data` is the only home for the detail
		# now, so this block is the only thing that shows what was asked for.
		fmt = formats.get(r["type"]) or {}
		r["detail"] = [
			{"label": label, "value": value}
			for label, value in flatten_pairs(
				r.get("source_data"),
				applicable_format(fmt.get("source_format"), fmt.get("source_format_enabled"),
				                  r.get("source_data")),
			)
		]
		# Which ledger this becomes, AND what status it will land at -- both resolved
		# server-side so the dialog states the outcome rather than re-deriving the rule.
		# The status is amount-dependent since 2026-08-20, and the threshold lives on the
		# ledger doctypes; a TypeScript copy of it would be free to disagree with `validate`.
		r["pay_to"] = pay_to_account(r)
		r["payee_rule"] = payee_rules.get(r["type"]) or NOT_ASKED
		r["target_doctype"] = target_doctype(frappe._dict(r))
		r["target_status"] = target_status(frappe._dict(r), user)

	return {"role_profile": profile, "requests": rows}


@frappe.whitelist()
def get_expense_request(name: str):
	"""One request, for its page (`/expense/requests/<name>`, #1502).

	Built for the page to grow: #1502 reads the invoice and whether one may be added; the live
	status of the Expense ("Where it stands", #1500) belongs here too. `expense` is the Expense
	created from it, as `{doctype, name, status}`, or None before approval.
	"""
	doc = frappe.get_doc("Expense Request", name)
	doc.check_permission("read")
	row = {f: doc.get(f) for f in FIELDS}

	fmt = frappe.db.get_value("Expense Type", doc.type,
	                          ["source_format", "source_format_enabled"], as_dict=True) or {}
	row["detail"] = [
		{"label": label, "value": value}
		for label, value in flatten_pairs(
			doc.source_data,
			applicable_format(fmt.get("source_format"), fmt.get("source_format_enabled"),
			                  doc.source_data),
			skip_sections=(NATIVE_INVOICE_SECTION,),
		)
	]
	row["projects_name"] = (
		frappe.db.get_value("Projects", doc.projects, "project_name") if doc.projects else None
	)
	row["owner_name"] = frappe.db.get_value("User", doc.owner, "full_name") or doc.owner
	row["pay_to"] = pay_to_account(row)

	expense = linked_expense(name)
	row["expense"] = dict(expense) if expense else None
	row["invoice"] = native_invoice(doc.source_data)
	row["can_add_invoice"] = invoice_refusal(row, expense) is None
	row["can_edit"] = can_edit(row)
	return row


@frappe.whitelist()
def get_request_catalog(include_type: str | None = None):
	"""The requestable types with their flags and format, for the create dialog.

	Only the types the caller's role may SEE (`Expense Type.allowed_roles`; an Admin sees
	all). `include_type` adds ONE more regardless -- the EDIT dialog passes the request's own
	type, which `update` lets its owner keep even after the type's roles were narrowed.
	Flags are not sensitive, and the create/update guards remain the boundary.

	`has_format` is true only when the type's form is switched ON and actually written.

	Categories come from the `Expense Category` master, so adding one or re-pointing its
	reviewer is an edit in the app rather than a deploy.

	Served from the backend rather than mirrored in TypeScript so the allow-list has ONE
	definition. A client copy would be free to drift from the one `create` enforces, and the
	drift would present as a type the picker offers and the server then refuses.

	`has_format` drives whether the dialog renders a template step; `project` /
	`non_project` drive the conditional Project field (mirroring the doctype's
	`type_allows_project` fetch).

	`records_without_review`: the caller's request is approved on submit (#1498), so the dialog's
	button reads "Record expense" and says who approves next, rather than "Send for review".
	"""
	types = [
		t for t in requestable_types()
		if can_request_type(t) or t == include_type
	]
	rows = frappe.get_all(
		"Expense Type",
		filters={"name": ["in", types]},
		fields=["name", "project", "non_project", "source_format", "source_format_enabled",
		        "payee_rule"],
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
					"has_format": bool(
						f.get("source_format_enabled") and (f.get("source_format") or "").strip()
					),
					# Who gets paid: Required / Optional / Not asked (ADR-0033). The dialog
					# shows the payee section unless Not asked; the server applies the rule.
					"payee_rule": f.get("payee_rule") or NOT_ASKED,
				}
			)
		categories.append({"category": name, "reviewer_role": reviewer_role, "types": entries})

	return {"categories": categories, "records_without_review": records_without_review()}


@frappe.whitelist()
def get_expense_format(expense_type: str):
	"""The `source_format` for one type, or None. Read by the create dialog on pick.

	None when the type's form is switched OFF, even if one is written -- the dialog then asks
	the standard fields, so this is the one place that decision reaches the screen.
	"""
	row = frappe.db.get_value(
		"Expense Type", expense_type, ["source_format", "source_format_enabled"], as_dict=True
	)
	fmt = row.source_format if row and row.source_format_enabled else None
	return {"expense_type": expense_type, "source_format": (fmt or None)}
