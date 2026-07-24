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
#
# PW-2a ADDITIONS (the read/write gate split):
#   test_estimates_user_can_read_but_not_write
#       An estimation user (read-only after the split) succeeds on list/get and is
#       rejected on ALL FOUR write endpoints -> the split actually splits.
#   test_admin_profile_user_can_write
#       A non-Administrator user holding the "Nirmaan Admin Profile" ROLE can
#       perform every write -> the write gate honours the role/profile branch and
#       is not just an Administrator special case.
#   test_write_gate_precedes_lock_check
#       A read-only user saving WITHOUT a lock gets the PermissionError (gate),
#       not the ValidationError (lock) -> pins the ordering, which
#       test_save_without_lock_rejected would otherwise silently conflate.
#
# PW-2a ACTOR MODEL: writes are performed by ADMIN_USER / ADMIN_USER2 (both carry
# the "Nirmaan Admin Profile" role); POS_USER stays the ESTIMATION actor and is
# used for read assertions and the negative write assertions. The two
# lock-exclusivity tests need TWO write-capable actors, hence ADMIN_USER2.

import gzip
import json

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import add_to_date, now_datetime

from nirmaan_stack.api.pricing import workbook as wb

POS_USER = "pricing_pos_pm1@example.com"
NEG_USER = "pricing_neg_pm1@example.com"
POS_ROLE = "Nirmaan Estimates Executive"  # IN the ACCESS SET, NOT in the WRITE SET
NEG_ROLE = "Nirmaan Project Manager"      # NOT in the ACCESS SET

# PW-2a: write-capable actors. "Nirmaan Admin Profile" exists as a ROLE as well as a
# role_profile_name (DB-verified), so granting it as a role puts these users in
# PRICING_WRITE_SET without touching role profiles.
ADMIN_USER = "pricing_admin_pm1@example.com"
ADMIN_USER2 = "pricing_admin2_pm1@example.com"
ADMIN_ROLE = "Nirmaan Admin Profile"


class TestPricingWorkbook(FrappeTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls._ensure_user(POS_USER, [POS_ROLE])
		cls._ensure_user(NEG_USER, [NEG_ROLE])
		cls._ensure_user(ADMIN_USER, [ADMIN_ROLE])
		cls._ensure_user(ADMIN_USER2, [ADMIN_ROLE])
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
		for email in (POS_USER, NEG_USER, ADMIN_USER, ADMIN_USER2):
			if frappe.db.exists("User", email):
				frappe.delete_doc("User", email, force=True, ignore_permissions=True)
		frappe.db.commit()
		super().tearDownClass()

	# -- helpers -----------------------------------------------------------
	def _create_as(self, user, title, payload):
		"""Create a workbook AS `user`. THE only sanctioned creation path in this
		suite -- it registers the row for the scoped purge (PM-4 rule); a raw
		wb._create_workbook() call would leak a row into the live site DB.

		Since PW-2a `user` must be write-capable (ADMIN_USER / ADMIN_USER2 /
		Administrator); POS_USER creations now raise PermissionError by design.
		"""
		frappe.set_user(user)
		res = wb._create_workbook(title, json.dumps(payload))
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
		# Create as a write-capable admin (PW-2a) ...
		res = self._create_as(ADMIN_USER, "WB pos", payload)
		name = res["name"]
		self.assertEqual(res["current_version"], 1)

		# ... and READ it back as the estimation user: reads stay open to them.
		frappe.set_user(POS_USER)
		got = wb.get_workbook(name)
		self.assertEqual(got["title"], "WB pos")
		self.assertEqual(json.loads(got["workbook_json"]), payload)
		self.assertEqual(got["current_version"], 1)

	# -- checkout / lock ---------------------------------------------------
	def test_checkout_free_lock(self):
		name = self._create_as(ADMIN_USER, "WB co", {})["name"]
		result = wb.checkout(name)
		self.assertEqual(result["checked_out_by"], ADMIN_USER)

		got = wb.get_workbook(name)
		self.assertTrue(got["lock_is_mine"])
		self.assertFalse(got["lock_expired"])

	def test_checkout_blocked_when_held_by_other(self):
		# Lock exclusivity needs TWO write-capable actors (PW-2a): an estimation
		# user would now be refused by the gate before the lock check is reached,
		# which would prove nothing about exclusivity.
		name = self._create_as(ADMIN_USER, "WB held", {})["name"]
		frappe.set_user(ADMIN_USER)
		wb.checkout(name)

		# A different write-capable user cannot take the fresh lock.
		frappe.set_user(ADMIN_USER2)
		with self.assertRaises(frappe.ValidationError) as ctx:
			wb.checkout(name)
		self.assertIn(ADMIN_USER, str(ctx.exception))

	def test_checkout_succeeds_after_expiry(self):
		name = self._create_as(ADMIN_USER, "WB exp", {})["name"]
		frappe.set_user(ADMIN_USER)
		wb.checkout(name)

		# Backdate the lock to 31 minutes old -> expired.
		stale = add_to_date(now_datetime(), minutes=-31)
		frappe.db.set_value(wb.WORKBOOK_DT, name, "checked_out_at", stale, update_modified=False)
		frappe.db.commit()

		frappe.set_user(ADMIN_USER2)
		result = wb.checkout(name)
		self.assertEqual(result["checked_out_by"], ADMIN_USER2)

	# -- save / versioning -------------------------------------------------
	def test_save_without_lock_rejected(self):
		# Runs as a WRITE-CAPABLE user on purpose, so the rejection can only be the
		# LOCK rule. (The gate-precedes-lock ordering is pinned separately by
		# test_write_gate_precedes_lock_check.)
		name = self._create_as(ADMIN_USER, "WB nolock", {})["name"]
		# No checkout performed.
		with self.assertRaises(frappe.ValidationError):
			wb._save_workbook(name, json.dumps({"x": 1}))

	def test_save_with_lock_bumps_version_and_writes_version_row(self):
		name = self._create_as(ADMIN_USER, "WB save", {"v": 0})["name"]
		wb.checkout(name)
		result = wb._save_workbook(name, json.dumps({"v": 1}))
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
		name = self._create_as(ADMIN_USER, "WB prune", {"n": 0})["name"]  # version 1
		wb.checkout(name)
		for i in range(1, 25):  # 24 saves -> versions 2..25
			wb._save_workbook(name, json.dumps({"n": i}))

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

	def test_version_pruning_survives_list_payloads(self):
		"""Pruning must work when the version snapshots store a JSON ARRAY.

		A real imported workbook stores `workbook_json` as a LIST (LuckyExcel sheets).
		The prune previously used `frappe.delete_doc`, which loads the version doc and
		trips the list-valued-JSON load wall ("Value ... cannot be a list") on the FIRST
		delete -- i.e. the 21st save. The earlier prune test used DICT payloads, so it
		never exercised this path. This asserts the raw-`db.delete` prune survives it.
		"""
		list_payload = lambda i: json.dumps([{"name": "Sheet1", "celldata": [{"r": 0, "c": 0, "v": {"v": i}}]}])
		name = self._create_as(ADMIN_USER, "WB prune list", json.loads(list_payload(0)))["name"]  # v1
		wb.checkout(name)
		# 24 saves -> versions 2..25. Every save past the 20th prunes a LIST-shaped
		# version doc, which is exactly what used to raise.
		for i in range(1, 25):
			wb._save_workbook(name, list_payload(i))

		self.assertEqual(frappe.db.count(wb.VERSION_DT, {"workbook": name}), wb.MAX_VERSIONS)
		versions = sorted(
			v.version
			for v in frappe.get_all(wb.VERSION_DT, filters={"workbook": name}, fields=["version"])
		)
		# Newest 20 of versions 1..25 == 6..25.
		self.assertEqual(min(versions), 6)
		self.assertEqual(max(versions), 25)
		# Sanity: the surviving snapshots really are list-shaped.
		newest = frappe.get_all(
			wb.VERSION_DT, filters={"workbook": name}, fields=["name"], order_by="version desc", limit=1
		)[0]
		stored = frappe.db.get_value(wb.VERSION_DT, newest.name, "workbook_json")
		self.assertIsInstance(json.loads(wb._as_json_string(stored)), list)

	# -- access log --------------------------------------------------------
	def test_access_log_written_on_open_and_save(self):
		name = self._create_as(ADMIN_USER, "WB log", {})["name"]  # logs "create"
		# The OPEN is logged for the estimation user -- after PW-2a that is the
		# read-only actor, so this also proves reads still audit for them.
		frappe.set_user(POS_USER)
		wb.get_workbook(name)  # logs "open"
		frappe.set_user(ADMIN_USER)
		wb.checkout(name)  # logs "checkout"
		wb._save_workbook(name, json.dumps({"a": 1}))  # logs "save"

		actions = frappe.get_all(wb.LOG_DT, filters={"workbook": name}, pluck="action")
		self.assertIn("create", actions)
		self.assertIn("open", actions)
		self.assertIn("save", actions)

	# -- validation --------------------------------------------------------
	def test_invalid_json_rejected(self):
		frappe.set_user(ADMIN_USER)
		with self.assertRaises(frappe.ValidationError):
			wb._create_workbook("WB bad", "{not valid json")

		name = self._create_as(ADMIN_USER, "WB bad2", {})["name"]
		wb.checkout(name)
		with self.assertRaises(frappe.ValidationError):
			wb._save_workbook(name, "{still bad")

	# -- release -----------------------------------------------------------
	def test_release_clears_lock(self):
		name = self._create_as(ADMIN_USER, "WB rel", {})["name"]
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
		name = self._create_as(ADMIN_USER, "WB list", list_payload)["name"]

		# Sanity: the stored JSON hydrates as a list.
		doc = frappe.get_doc(wb.WORKBOOK_DT, name)
		self.assertIsInstance(json.loads(wb._as_json_string(doc.workbook_json)), list)

		# Both lock ops must succeed (previously raised ValidationError).
		result = wb.checkout(name)
		self.assertEqual(result["checked_out_by"], ADMIN_USER)
		wb.release(name)
		self.assertFalse(frappe.db.get_value(wb.WORKBOOK_DT, name, "checked_out_by"))

	# ------------------------------------------------------------------
	# PW-2a: the READ / WRITE gate split
	# ------------------------------------------------------------------
	def test_estimates_user_can_read_but_not_write(self):
		"""Estimation users keep full READ access and lose every WRITE path."""
		name = self._create_as(ADMIN_USER, "WB split", {"a": 1})["name"]

		frappe.set_user(POS_USER)

		# READS still work -- this is the half of the split that must NOT regress.
		listed = wb.list_workbooks()
		self.assertTrue(any(r["name"] == name for r in listed))
		got = wb.get_workbook(name)
		self.assertEqual(got["title"], "WB split")

		# ALL FOUR writes are refused.
		with self.assertRaises(frappe.PermissionError):
			wb.checkout(name)
		with self.assertRaises(frappe.PermissionError):
			wb.release(name)
		with self.assertRaises(frappe.PermissionError):
			wb._save_workbook(name, json.dumps({"a": 2}))
		with self.assertRaises(frappe.PermissionError):
			wb._create_workbook("WB split denied", json.dumps({}))

		# Nothing was mutated by the refused calls.
		frappe.set_user(ADMIN_USER)
		doc = frappe.get_doc(wb.WORKBOOK_DT, name)
		self.assertEqual(doc.current_version, 1)
		self.assertFalse(doc.checked_out_by)
		self.assertFalse(frappe.db.exists(wb.WORKBOOK_DT, {"title": "WB split denied"}))

	def test_admin_profile_user_can_write(self):
		"""The write gate honours the ROLE branch, not just the Administrator user.

		ADMIN_USER is an ordinary user carrying the "Nirmaan Admin Profile" role, so
		this proves PRICING_WRITE_SET is really consulted -- a gate that only let
		Administrator through would pass every other test in this file.
		"""
		self.assertNotEqual(ADMIN_USER, "Administrator")
		name = self._create_as(ADMIN_USER, "WB adminrole", {"v": 0})["name"]

		frappe.set_user(ADMIN_USER)
		self.assertEqual(wb.checkout(name)["checked_out_by"], ADMIN_USER)
		self.assertEqual(wb._save_workbook(name, json.dumps({"v": 1}))["current_version"], 2)
		wb.release(name)
		self.assertFalse(frappe.db.get_value(wb.WORKBOOK_DT, name, "checked_out_by"))

	def test_write_gate_precedes_lock_check(self):
		"""A read-only user saving without a lock hits the GATE, not the lock rule.

		Ordering matters: if the lock check ran first, an estimation user would get
		"check it out first" -- an invitation to do something they are not allowed to
		do -- and test_save_without_lock_rejected would pass for the wrong reason.
		"""
		name = self._create_as(ADMIN_USER, "WB order", {})["name"]

		frappe.set_user(POS_USER)
		with self.assertRaises(frappe.PermissionError):
			wb._save_workbook(name, json.dumps({"x": 1}))

		# And the same user is refused even WITH a live lock held by someone else --
		# the gate never falls through to the lock branch.
		frappe.set_user(ADMIN_USER)
		wb.checkout(name)
		frappe.set_user(POS_USER)
		with self.assertRaises(frappe.PermissionError):
			wb._save_workbook(name, json.dumps({"x": 2}))

	# ------------------------------------------------------------------
	# FR-5 transport: gzip payload handling
	# ------------------------------------------------------------------
	def test_gzip_payload_roundtrip(self):
		"""A gzipped payload decompresses back to the identical JSON text."""
		# Workbook-shaped and repetitive, like the real payload -- gzip ADDS ~20 bytes
		# of header to a tiny input, so a realistic size is needed to assert compression.
		cells = [{"r": r, "c": 0, "v": {"v": r, "m": str(r), "ct": {"fa": "General", "t": "n"}}}
			for r in range(500)]
		payload = json.dumps([{"name": "Sheet1", "celldata": cells}])
		blob = gzip.compress(payload.encode("utf-8"))
		self.assertLess(len(blob), len(payload.encode("utf-8")))  # it really compressed
		self.assertEqual(wb._gunzip_payload(blob), payload)
		# and the decompressed text is still valid workbook JSON
		self.assertIsInstance(json.loads(wb._gunzip_payload(blob)), list)

	def test_corrupt_gzip_rejected(self):
		"""A non-gzip / truncated archive raises a clear ValidationError, not a traceback."""
		with self.assertRaises(frappe.ValidationError) as ctx:
			wb._gunzip_payload(b"this is definitely not gzip")
		self.assertIn("gzip", str(ctx.exception).lower())

		good = gzip.compress(json.dumps({"a": 1}).encode("utf-8"))
		with self.assertRaises(frappe.ValidationError):
			wb._gunzip_payload(good[: len(good) // 2])  # truncated mid-stream

		with self.assertRaises(frappe.ValidationError):
			wb._gunzip_payload(b"")  # nothing uploaded

	def test_decompressed_size_guard_fires(self):
		"""A payload expanding beyond MAX_DECOMPRESSED_BYTES is refused."""
		original = wb.MAX_DECOMPRESSED_BYTES
		try:
			wb.MAX_DECOMPRESSED_BYTES = 1024  # shrink the ceiling instead of building 200 MB
			blob = gzip.compress(b"x" * 4096)  # 4 KB decompressed, well over the 1 KB ceiling
			with self.assertRaises(frappe.ValidationError) as ctx:
				wb._gunzip_payload(blob)
			self.assertIn("too large", str(ctx.exception).lower())
			# just under the ceiling still passes
			self.assertEqual(len(wb._gunzip_payload(gzip.compress(b"y" * 512))), 512)
		finally:
			wb.MAX_DECOMPRESSED_BYTES = original
