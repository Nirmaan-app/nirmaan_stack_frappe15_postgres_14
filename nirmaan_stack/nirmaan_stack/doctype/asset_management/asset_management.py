# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

import json

import frappe
from frappe.model.document import Document
from frappe.utils import today

from nirmaan_stack.services.asset_assign_access import check_may_assign
from nirmaan_stack.services.asset_audit import AUDIT_FULFILLED, AUDIT_PHOTO_EXTENSIONS, clean_answers
from nirmaan_stack.services.asset_audit_open import is_serialization_failure
from nirmaan_stack.services.asset_department import department_move, reason_refusal
from nirmaan_stack.services.departments import DEPARTMENT_DOCTYPE


class AssetManagement(Document):
	def validate(self):
		if self.is_new():
			# Who may assign this kind of asset (procurement: Project assets only). Here rather than in the
			# endpoint so a REST or Desk insert can't skip it; server code inserting with
			# ignore_permissions is trusted, as everywhere in Frappe.
			if not self.flags.ignore_permissions:
				check_may_assign(self.asset, "assign")
			self.check_not_already_assigned()
			self.decide_department_move()
		else:
			self.keep_asset_and_person()
		self.mark_received()
		self.check_fulfilled_audit()

	def check_fulfilled_audit(self):
		"""An audit is Fulfilled only with the answers to its question (owner, 2026-10-15) -- a "No" with its
		description -- and an image only if it is a photo. No photo is required (owner, 2026-10-21).

		The Submit audit dialog sends them through `api/assets/audits.submit_audit`, which checks them and writes
		with `set_value` (no validate). This is the same rule on the record, for every other save -- the REST API,
		Desk -- so an audit can't be marked done by setting `audit_status` alone. A save that leaves the audit as
		it was (a return, a declaration) isn't checked: audits sent before the questions existed have no answers,
		and a red answer sent before 2026-10-21 may have no description.
		"""
		if self.audit_status != AUDIT_FULFILLED:
			return
		before = None if self.is_new() else self.get_doc_before_save()
		if (
			before
			and before.audit_status == self.audit_status
			and (before.audit_proof or None) == (self.audit_proof or None)
			and _answers_of(before.audit_answers) == _answers_of(self.audit_answers)
		):
			return
		if self.audit_proof and not _is_photo_file(self.audit_proof):
			frappe.throw("An audit's image must be a photo (JPG, PNG, WEBP or HEIC). Send it from Submit audit.")
		_, refusal = clean_answers(_answers_of(self.audit_answers))
		if refusal:
			# The specific reason too (code review #7): "Describe the problem under ..." says more than "answers".
			frappe.throw(
				f"An audit can be marked Fulfilled only with the answers to its question. {refusal} "
				"Or send it from Submit audit."
			)

	def mark_received(self):
		"""A declaration arriving -- signed in the app or a signed scan uploaded -- means the person has the
		asset (owner, 2026-10-13): tick Received, dated that day. Nobody types these two fields.

		Only when the declaration arrives in this save: an assignment signed before the field existed
		must not get the date of some later, unrelated save.
		"""
		if self.get("asset_declaration_attachment") and self.has_value_changed("asset_declaration_attachment") and not self.received:
			self.received = 1
			self.received_on = today()

	def keep_asset_and_person(self):
		"""An assignment is for one asset and one person for its whole life.

		The rules (one holder, the department move and its reason) and the "Assigned" history row run
		only when an assignment is created, so changing the person or the asset on an existing one in
		Desk or the API would hand the asset over with none of them -- and the new person would inherit
		the old one's signed declaration. Giving the asset to someone else is Unassign, then Assign.
		"""
		before = self.get_doc_before_save()
		if not before:
			return
		if before.asset != self.asset or before.asset_assigned_to != self.asset_assigned_to:
			frappe.throw(
				f"An assignment's asset and person can't be changed. To give {before.asset} to someone "
				"else, unassign it first, then assign it."
			)

	def check_not_already_assigned(self):
		"""One holder per asset: the asset's current holder decides, not any assignment row. A Lost/Damaged asset
		has none and can't get one until Admin or HR marks it Found/Repaired (owner, 2026-10-31).

		The holder is read with a row lock, so two people assigning the same asset at once can't both win.
		On PostgreSQL (REPEATABLE READ) the second one's lock fails with a serialization error once the
		first commits, so it gets a plain "reload" message here rather than a database error. An old
		leftover row for someone else (ASSET-LAP-029 had one) must not block a free asset, so the rows
		aren't asked.
		"""
		try:
			holder, lost_damaged = frappe.db.get_value(
				"Asset Master", self.asset, ["current_assignee", "lost_damaged"], for_update=True
			) or (None, 0)
		except Exception as exc:
			if is_serialization_failure(exc):
				frappe.throw(f"{self.asset} was just assigned or changed by someone else. Reload the page and try again.")
			raise
		if lost_damaged:
			frappe.throw(
				f"{self.asset} is marked Lost/Damaged. Admin or HR must mark it Found/Repaired before it can be assigned."
			)
		if holder:
			holder_name = frappe.db.get_value("Nirmaan Users", holder, "full_name") or holder
			frappe.throw(f"{self.asset} is already assigned to {holder_name}. Unassign it first.")

	def decide_department_move(self):
		"""Assigning to someone in another department moves the asset there, with a reason.

		The reason is not stored on the assignment (owner, 2026-10-12): it arrives on
		`flags.department_change_reason` from `api/assets/assign.assign_asset` and is kept only in the
		asset's history. The decision goes on `flags.department_move` (+ `flags.department_reason`)
		for the after_insert hook, which moves the asset and writes the history row. A reason sent
		when nothing moves is dropped.
		"""
		asset_department = frappe.db.get_value("Asset Master", self.asset, "department")
		person_department = frappe.db.get_value("Nirmaan Users", self.asset_assigned_to, "department")
		move = department_move(asset_department, person_department)
		# Departments are never switched off in practice (owner, 2026-10-15). If the person's one is, the asset
		# would land in a department nobody can pick: refuse, and let the admin fix the department.
		if move and not frappe.db.get_value(DEPARTMENT_DOCTYPE, move[1], "is_active"):
			frappe.throw(f"The {move[1]} department is inactive. Report it to the admin.")

		reason = self.flags.department_change_reason
		refusal = reason_refusal(move, reason)
		if refusal:
			frappe.throw(refusal)

		self.flags.department_move = move
		self.flags.department_reason = (reason or "").strip() if move and move[0] else None


def _answers_of(value):
	"""The answers list of an `audit_answers` value: `{"answers": [...]}` as the database returns it, or as a JSON
	string from a client. None for anything else (a bare list, broken JSON, empty)."""
	if isinstance(value, str):
		try:
			value = json.loads(value)
		except ValueError:
			return None
	return value.get("answers") if isinstance(value, dict) else None


def _is_photo_file(file_url) -> bool:
	"""An uploaded file with this URL whose name is a photo's (`AUDIT_PHOTO_EXTENSIONS`)."""
	if not file_url:
		return False
	names = frappe.get_all("File", filters={"file_url": file_url}, pluck="file_name")
	return any((name or "").lower().endswith(AUDIT_PHOTO_EXTENSIONS) for name in names)
