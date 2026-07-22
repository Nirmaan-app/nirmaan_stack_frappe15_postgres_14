# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt
#
# Tests for the Pricing Module backend API (PM-1).
#
# COVERAGE SUMMARY (each test -> the behavior it protects):
#   test_negative_user_denied_list_and_get
#       An authenticated user with NO ACCESS-SET role/profile is rejected
#       (PermissionError) on BOTH list_workbooks and get_workbook -> the gate
#       actually blocks non-estimation, non-admin users.
#   test_guest_denied
#       The Guest (unauthenticated) session is rejected -> the gate closes to
#       the public.
#   test_positive_create_and_get_roundtrip
#       An ACCESS-SET (estimation-role) user can create a workbook and read the
#       identical JSON back at version 1 -> the happy path + JSON round-trip.
#   test_checkout_free_lock
#       Checking out a workbook with no active lock grants it and get_workbook
#       reports lock_is_mine=True, lock_expired=False -> lock acquisition.
#   test_checkout_blocked_when_held_by_other
#       When another access-holding user holds a fresh lock, a second user's
#       checkout is rejected and the holder is named -> lock exclusivity.
#   test_checkout_succeeds_after_expiry
#       A lock older than 30 minutes is auto-expired: a different user can take
#       it over -> the 30-min auto-expiry.
#   test_save_without_lock_rejected
#       Saving without holding a lock is rejected -> saves are lock-guarded.
#   test_save_with_lock_bumps_version_and_writes_version_row
#       A locked save increments current_version, persists the new JSON, and
#       writes a Pricing Workbook Version row -> versioning on save.
#   test_version_pruning_keeps_max_20
#       After many saves only the newest 20 version snapshots survive -> the
#       prune-beyond-20 retention rule.
#   test_access_log_written_on_open_and_save
#       create / open / save each write a Pricing Access Log row with the right
#       action -> the audit trail.
#   test_invalid_json_rejected
#       Non-JSON payloads are rejected on both create and save -> the
#       "must parse as JSON" validation.
#   test_release_clears_lock
#       Releasing a lock the caller holds clears it -> lock release.

import json

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import add_to_date, now_datetime

from nirmaan_stack.api.pricing import workbook as wb

POS_USER = "pricing_pos_pm1@example.com"
NEG_USER = "pricing_neg_pm1@example.com"
POS_ROLE = "Nirmaan Estimates Executive"  # IN the ACCESS SET (estimation)
NEG_ROLE = "Nirmaan Project Manager"      # NOT in the ACCESS SET


class TestPricingWorkbook(FrappeTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls._ensure_user(POS_USER, [POS_ROLE])
		cls._ensure_user(NEG_USER, [NEG_ROLE])
		frappe.db.commit()

	@classmethod
	def _ensure_user(cls, email, roles):
		if frappe.db.exists("User", email):
			user = frappe.get_doc("User", email)
		else:
			user = frappe.get_doc(
				{
					"doctype": "User",
					"email": email,
					"first_name": email.split("@")[0],
					"send_welcome_email": 0,
					"enabled": 1,
				}
			)
			user.insert(ignore_permissions=True)
		existing = {r.role for r in user.roles}
		for role in roles:
			if role not in existing:
				user.append("roles", {"role": role})
		user.save(ignore_permissions=True)

	# Names of workbooks THIS suite created -- the ONLY rows _purge_all may delete.
	_created_names: set = set()

	@classmethod
	def _purge_all(cls):
		# SCOPED to workbooks this suite created -- NEVER a blanket delete. This
		# suite runs against the live site DB (`--site localhost`) and commits, so
		# a filterless `frappe.db.delete(dt)` would DESTROY real production
		# workbooks (it did, once). Raw db.delete (not delete_doc) also side-steps
		# the list-valued-JSON load wall for imported array-shaped workbooks.
		for nm in list(cls._created_names):
			frappe.db.delete(wb.VERSION_DT, {"workbook": nm})
			frappe.db.delete(wb.LOG_DT, {"workbook": nm})
			frappe.db.delete(wb.WORKBOOK_DT, {"name": nm})
		cls._created_names.clear()

	def setUp(self):
		frappe.set_user("Administrator")
		self._purge_all()
		frappe.db.commit()

	def tearDown(self):
		frappe.set_user("Administrator")

	@classmethod
	def tearDownClass(cls):
		frappe.set_user("Administrator")
		cls._purge_all()
		for email in (POS_USER, NEG_USER):
			if frappe.db.exists("User", email):
				frappe.delete_doc("User", email, force=True, ignore_permissions=True)
		frappe.db.commit()
		super().tearDownClass()

	# -- helpers -----------------------------------------------------------
	def _create_as(self, user, title, payload):
		frappe.set_user(user)
		res = wb.create_workbook(title, json.dumps(payload))
		# Track for the SCOPED purge so we never blanket-delete real workbooks.
		type(self)._created_names.add(res["name"])
		return res

	# -- access gate -------------------------------------------------------
	def test_negative_user_denied_list_and_get(self):
		res = self._create_as("Administrator", "WB neg", {"a": 1})
		name = res["name"]

		frappe.set_user(NEG_USER)
		with self.assertRaises(frappe.PermissionError):
			wb.list_workbooks()
		with self.assertRaises(frappe.PermissionError):
			wb.get_workbook(name)

	def test_guest_denied(self):
		frappe.set_user("Guest")
		with self.assertRaises(frappe.PermissionError):
			wb.list_workbooks()

	# -- create / read -----------------------------------------------------
	def test_positive_create_and_get_roundtrip(self):
		payload = {"sheets": [{"name": "S1", "cells": {"A1": 1}}]}
		res = self._create_as(POS_USER, "WB pos", payload)
		name = res["name"]
		self.assertEqual(res["current_version"], 1)

		got = wb.get_workbook(name)
		self.assertEqual(got["title"], "WB pos")
		self.assertEqual(json.loads(got["workbook_json"]), payload)
		self.assertEqual(got["current_version"], 1)

	# -- checkout / lock ---------------------------------------------------
	def test_checkout_free_lock(self):
		name = self._create_as(POS_USER, "WB co", {})["name"]
		result = wb.checkout(name)
		self.assertEqual(result["checked_out_by"], POS_USER)

		got = wb.get_workbook(name)
		self.assertTrue(got["lock_is_mine"])
		self.assertFalse(got["lock_expired"])

	def test_checkout_blocked_when_held_by_other(self):
		# Administrator (an access holder) takes the lock first.
		name = self._create_as("Administrator", "WB held", {})["name"]
		frappe.set_user("Administrator")
		wb.checkout(name)

		# A different access-holding user cannot take the fresh lock.
		frappe.set_user(POS_USER)
		with self.assertRaises(frappe.ValidationError) as ctx:
			wb.checkout(name)
		self.assertIn("Administrator", str(ctx.exception))

	def test_checkout_succeeds_after_expiry(self):
		name = self._create_as("Administrator", "WB exp", {})["name"]
		frappe.set_user("Administrator")
		wb.checkout(name)

		# Backdate the lock to 31 minutes old -> expired.
		stale = add_to_date(now_datetime(), minutes=-31)
		frappe.db.set_value(wb.WORKBOOK_DT, name, "checked_out_at", stale, update_modified=False)
		frappe.db.commit()

		frappe.set_user(POS_USER)
		result = wb.checkout(name)
		self.assertEqual(result["checked_out_by"], POS_USER)

	# -- save / versioning -------------------------------------------------
	def test_save_without_lock_rejected(self):
		name = self._create_as(POS_USER, "WB nolock", {})["name"]
		# No checkout performed.
		with self.assertRaises(frappe.ValidationError):
			wb.save_workbook(name, json.dumps({"x": 1}))

	def test_save_with_lock_bumps_version_and_writes_version_row(self):
		name = self._create_as(POS_USER, "WB save", {"v": 0})["name"]
		wb.checkout(name)
		result = wb.save_workbook(name, json.dumps({"v": 1}))
		self.assertEqual(result["current_version"], 2)

		doc = frappe.get_doc(wb.WORKBOOK_DT, name)
		self.assertEqual(doc.current_version, 2)
		self.assertEqual(json.loads(wb._as_json_string(doc.workbook_json)), {"v": 1})

		versions = sorted(
			v.version
			for v in frappe.get_all(wb.VERSION_DT, filters={"workbook": name}, fields=["version"])
		)
		# create wrote version 1, the save wrote version 2.
		self.assertEqual(versions, [1, 2])

	def test_version_pruning_keeps_max_20(self):
		name = self._create_as(POS_USER, "WB prune", {"n": 0})["name"]  # version 1
		wb.checkout(name)
		for i in range(1, 25):  # 24 saves -> versions 2..25
			wb.save_workbook(name, json.dumps({"n": i}))

		count = frappe.db.count(wb.VERSION_DT, {"workbook": name})
		self.assertEqual(count, wb.MAX_VERSIONS)

		versions = [
			v.version
			for v in frappe.get_all(
				wb.VERSION_DT, filters={"workbook": name}, fields=["version"], order_by="version asc"
			)
		]
		# Newest 20 of versions 1..25 == 6..25.
		self.assertEqual(min(versions), 6)
		self.assertEqual(max(versions), 25)

	# -- access log --------------------------------------------------------
	def test_access_log_written_on_open_and_save(self):
		name = self._create_as(POS_USER, "WB log", {})["name"]  # logs "create"
		wb.get_workbook(name)  # logs "open"
		wb.checkout(name)  # logs "checkout"
		wb.save_workbook(name, json.dumps({"a": 1}))  # logs "save"

		actions = frappe.get_all(wb.LOG_DT, filters={"workbook": name}, pluck="action")
		self.assertIn("create", actions)
		self.assertIn("open", actions)
		self.assertIn("save", actions)

	# -- validation --------------------------------------------------------
	def test_invalid_json_rejected(self):
		frappe.set_user(POS_USER)
		with self.assertRaises(frappe.ValidationError):
			wb.create_workbook("WB bad", "{not valid json")

		name = self._create_as(POS_USER, "WB bad2", {})["name"]
		wb.checkout(name)
		with self.assertRaises(frappe.ValidationError):
			wb.save_workbook(name, "{still bad")

	# -- release -----------------------------------------------------------
	def test_release_clears_lock(self):
		name = self._create_as(POS_USER, "WB rel", {})["name"]
		wb.checkout(name)
		wb.release(name)

		doc = frappe.get_doc(wb.WORKBOOK_DT, name)
		self.assertFalse(doc.checked_out_by)

	# -- regression: list-valued workbook_json -----------------------------
	def test_checkout_release_when_workbook_json_is_a_list(self):
		# A real imported workbook stores a JSON ARRAY (LuckyExcel `sheets`),
		# which Frappe hydrates back as a Python list. checkout/release must NOT
		# do a full doc.save() on such a doc -- that trips Frappe's
		# "Value ... cannot be a list" guard (417 in production). The earlier
		# tests only used dict payloads, so this wall went unnoticed until live.
		list_payload = [{"name": "Sheet1", "celldata": []}]
		name = self._create_as(POS_USER, "WB list", list_payload)["name"]

		# Sanity: the stored JSON hydrates as a list.
		doc = frappe.get_doc(wb.WORKBOOK_DT, name)
		self.assertIsInstance(json.loads(wb._as_json_string(doc.workbook_json)), list)

		# Both lock ops must succeed (previously raised ValidationError).
		result = wb.checkout(name)
		self.assertEqual(result["checked_out_by"], POS_USER)
		wb.release(name)
		self.assertFalse(frappe.db.get_value(wb.WORKBOOK_DT, name, "checked_out_by"))
