# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""`patches/v3_0/office_rent_form_says_gst.py`, through its `execute()` (spec #1613, story 4).

An existing site keeps the Office Rent form it had: the seed only inserts types a site lacks. The patch
brings the version-3 form (the amount includes 18% GST) to a site whose live form is still the version-2
one the seed shipped, and leaves every other form alone.

Each test puts the site's Office Rent form into the state under test, runs `execute()`, and reads the
form back. `execute()` does not commit (the patch runner does), and every test rolls back, so the env's
Office Rent form is as it was.

Run:
  devenv.sh test --module nirmaan_stack.api.expense_requests.test_office_rent_form_gst_patch
"""

import json

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.expense_requests.form_snapshot import governing_form, stamp_live_form
from nirmaan_stack.patches.v3_0 import office_rent_form_says_gst as patch
from nirmaan_stack.services.expense_type_seed import seed_rows

OFFICE_RENT = "Office Rent"
V2_SENTENCE = ("Office rent for {rent_month} – {office_location}. Landlord: {landlord_name} "
               "(PAN {landlord_pan}). (10% TDS will be deducted)")
V3_SENTENCE = ("Office rent for {rent_month} – {office_location}. Landlord: {landlord_name} "
               "(PAN {landlord_pan}). (Amount incl. 18% GST; 10% TDS on the rent will be deducted)")


def _seed_form() -> str:
	return next(r for r in seed_rows() if r["name"] == OFFICE_RENT)["source_format"]


def _form(version: int, sentence: str) -> str:
	"""The seed's Office Rent form with its version and sentence set."""
	fmt = json.loads(_seed_form())
	fmt["templateVersion"] = version
	fmt["description_template"] = sentence
	return json.dumps(fmt, indent=2, ensure_ascii=False)


def _live() -> str | None:
	return frappe.db.get_value("Expense Type", OFFICE_RENT, "source_format")


def _set_live(source_format: str):
	frappe.db.set_value("Expense Type", OFFICE_RENT, "source_format", source_format)


class TestOfficeRentFormGstPatch(FrappeTestCase):
	def setUp(self):
		frappe.set_user("Administrator")
		if not frappe.db.exists("Expense Type", OFFICE_RENT):
			self.skipTest("this site has no Office Rent type")

	def tearDown(self):
		frappe.db.rollback()

	def test_the_patch_knows_the_version_2_form_the_seed_shipped(self):
		# The seed's form with version 2 and the old sentence: the only form the patch may replace.
		self.assertEqual(json.loads(_form(2, V2_SENTENCE)), patch.V2_FORM)

	def test_a_version_2_form_becomes_the_seeds_version_3_form(self):
		_set_live(_form(2, V2_SENTENCE))

		patch.execute()

		self.assertEqual(_live(), _seed_form())
		fmt = json.loads(_live())
		self.assertEqual(fmt["templateVersion"], 3)
		self.assertEqual(fmt["description_template"], V3_SENTENCE)

	def test_a_version_2_form_stored_with_other_whitespace_is_still_the_version_2_form(self):
		_set_live(json.dumps(json.loads(_form(2, V2_SENTENCE))))

		patch.execute()

		self.assertEqual(_live(), _seed_form())

	def test_a_second_run_changes_nothing(self):
		_set_live(_form(2, V2_SENTENCE))
		patch.execute()
		modified = frappe.db.get_value("Expense Type", OFFICE_RENT, "modified")

		patch.execute()

		self.assertEqual(_live(), _seed_form())
		self.assertEqual(frappe.db.get_value("Expense Type", OFFICE_RENT, "modified"), modified)

	def test_a_site_already_at_version_3_is_left_alone(self):
		already = json.dumps(json.loads(_seed_form()))   # the same form, stored compactly
		_set_live(already)

		patch.execute()

		self.assertEqual(_live(), already)

	def test_a_form_an_admin_edited_is_left_alone(self):
		edited_sentence = _form(2, "Rent for {rent_month} at {office_location}, paid to {landlord_name}.")
		more_questions = json.loads(_form(2, V2_SENTENCE))
		more_questions["sections"][0]["fields"].append({"key": "floor", "label": "Floor", "type": "text"})
		for edited in (edited_sentence, json.dumps(more_questions), ""):
			with self.subTest(edited=edited[:60]):
				_set_live(edited)

				patch.execute()

				self.assertEqual(_live() or "", edited)

	def test_a_site_without_office_rent_is_left_alone(self):
		frappe.db.delete("Expense Type", {"name": OFFICE_RENT})

		patch.execute()

		self.assertFalse(frappe.db.exists("Expense Type", OFFICE_RENT))

	def test_a_request_raised_on_the_version_2_form_keeps_its_sentence(self):
		_set_live(_form(2, V2_SENTENCE))
		source_data = stamp_live_form(OFFICE_RENT, json.dumps({
			"templateId": "office-rent", "templateVersion": 2,
			"responses": {"detail": {"rent_month": "2026-10", "office_location": "Test Office",
			                         "landlord_name": "Test Landlord", "landlord_pan": "ABCPK1234D"}}}))

		patch.execute()

		governing = json.loads(governing_form({"type": OFFICE_RENT, "source_data": source_data}))
		self.assertEqual(governing["templateVersion"], 2)
		self.assertEqual(governing["description_template"], V2_SENTENCE)
