# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class ExpenseRequest(Document):
	def validate(self):
		self._validate_project_against_type()
		self._validate_rejection_has_a_reason()

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
