# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class ExpenseRequest(Document):
	def validate(self):
		self._validate_project_against_type()
		self._validate_rejection_has_a_reason()
		self._block_duplicate_pm_request()

	def _block_duplicate_pm_request(self):
		"""A Project Manager may not ask twice for the same person's stay.

		Runs on CREATE, and on an EDIT of a pending request only when the type or the STAY
		(person / dates / Hotel-or-not) changed -- so an approval save, or a PM correcting the
		comment or amount of a request that already overlaps, is never refused. An edited
		request is never compared with itself. PM only, by ROLE PROFILE of the person saving
		(the Admin profile also carries the PM role). The rule, and the dialog's copy of this
		answer, live in `api/expense_requests/duplicates.py`.
		"""
		from nirmaan_stack.api.expense_requests.access import PM_PROFILE, caller_role_profile
		from nirmaan_stack.api.expense_requests import duplicates

		if not self.is_new():
			before = self.get_doc_before_save()
			if self.status != "Pending Approval" or (
				before and before.type == self.type
				and duplicates.stay_key(before.source_data) == duplicates.stay_key(self.source_data)
			):
				return

		if caller_role_profile() != PM_PROFILE:
			return

		bad_period = duplicates.period_error(self.source_data)
		if bad_period:
			frappe.throw(bad_period, title="Invalid rent period")

		hits = duplicates.find_overlapping(
			self.type, self.source_data, exclude=None if self.is_new() else self.name
		)
		if hits:
			dup = hits[0]
			start, end = sorted(dup["period"])
			frappe.throw(
				f"{dup['name']} ({dup['status']}, {dup['projects'] or 'no project'}) already covers "
				f"{dup['person']} from {start.strftime('%d-%b-%Y')} to {end.strftime('%d-%b-%Y')}. "
				"Change the dates, choose Hotel for a short visit, or contact HR or your Project Lead.",
				title="Duplicate Expense Request",
			)

	def _validate_project_against_type(self):
		"""`projects` must agree with the Expense Type's own project / non_project flags.

		There is no `expense_kind` field: the PRESENCE of `projects` is what decides which
		ledger Approve writes to. That makes this check the thing standing between a
		request and a row landing in the wrong book, so it reads the flags from the
		DATABASE rather than trusting the fetched `type_allows_project` mirror -- the
		mirror exists only so `depends_on` can hide the field on the form.

		Three states, matching the master:
		  project only      -> a project is REQUIRED
		  non-project only  -> a project is FORBIDDEN
		  both              -> OPTIONAL; whichever the requester chose is the answer
		                       (`Petty Cash` is the only such type today)
		"""
		if not self.type:
			return

		flags = frappe.db.get_value(
			"Expense Type", self.type, ["project", "non_project"], as_dict=True
		)
		if not flags:
			frappe.throw(f"'{self.type}' is not an expense type.", title="Unknown expense type")

		allows_project = bool(flags.project)
		allows_non_project = bool(flags.non_project)

		if not allows_project and not allows_non_project:
			frappe.throw(
				f"'{self.type}' is flagged for neither project nor non-project use, "
				"so no expense can be created from it.",
				title="Unusable expense type",
			)

		if self.projects and not allows_project:
			frappe.throw(
				f"'{self.type}' is a non-project expense type, so it cannot name a project.",
				title="Project not allowed",
			)

		if not self.projects and not allows_non_project:
			frappe.throw(
				f"'{self.type}' is a project expense type, so a project is required.",
				title="Project required",
			)

	def _validate_rejection_has_a_reason(self):
		"""A rejection has to say why.

		The comment is the only thing the requester gets back, so a blank one makes the
		decision unappealable. Enforced here as well as at the endpoint, because this is
		not the only path a row can take to `Rejected`.
		"""
		if self.status == "Rejected" and not (self.review_comment or "").strip():
			frappe.throw("A rejected expense request must carry a review comment.")
