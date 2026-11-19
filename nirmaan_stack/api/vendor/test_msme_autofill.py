# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and Contributors
# See license.txt
"""Vendor MSME details (owner, 2026-11-19): the Udyam rules, `Vendors` save, and the certificate read.

Runs against the site's data inside ONE transaction whose commits are stubbed, rolled back in
`tearDown`. The model is never called: `extract` is replaced by canned entities.

Run ONLY this module:
    bench --site <test site> run-tests --skip-before-tests --skip-test-records \
        --module nirmaan_stack.api.vendor.test_msme_autofill
"""

import json
import unittest
from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.vendor import msme_autofill
from nirmaan_stack.cloud_file_fixture import cloud_url
from nirmaan_stack.services.vendor_msme import is_valid_udyam, names_match, normalize_udyam

GOOD_ID = "UDYAM-UP-28-0012345"
CERT_URL = cloud_url("udyam-certificate.pdf", "Vendors")


class TestVendorMsmeRules(unittest.TestCase):
	"""The pure rules -- no database. Mirrored by frontend/src/pages/vendors/utils/msme.test.ts."""

	def test_normalize_and_validate(self):
		for raw, normalized, valid in (
			(GOOD_ID, GOOD_ID, True),
			("udyam-up-28-0012345", GOOD_ID, True),
			(" UDYAM - UP - 28 - 0012345 ", GOOD_ID, True),
			("UDYAM–UP–28–0012345", GOOD_ID, True),
			("UDYAM-UP-28-012345", "UDYAM-UP-28-012345", False),
			("UAM-UP-28-0012345", "UAM-UP-28-0012345", False),
			(None, "", False),
		):
			self.assertEqual(normalize_udyam(raw), normalized, raw)
			self.assertEqual(is_valid_udyam(normalize_udyam(raw)), valid, raw)

	def test_names_match_is_lenient(self):
		self.assertTrue(names_match("S. V. Metals & Extrusions Pvt. Ltd.", "SV METALS AND EXTRUSIONS PRIVATE LIMITED"))
		self.assertTrue(names_match("Goel Steels", "M/S GOEL STEELS"))
		self.assertFalse(names_match("Goel Steels", "Sharma Electricals"))
		self.assertIsNone(names_match("Goel Steels", ""))
		self.assertIsNone(names_match("", "Goel Steels"))


class _VendorCase(FrappeTestCase):
	def setUp(self):
		self._real_commit = frappe.db.commit
		frappe.db.commit = lambda *a, **k: None
		frappe.set_user("Administrator")
		names = frappe.get_all("Vendors", filters={"msme_id": ("is", "not set")}, pluck="name", limit=2)
		if len(names) < 2:
			raise unittest.SkipTest("needs two vendors")
		self.vendor, self.other_vendor = names

	def tearDown(self):
		frappe.set_user("Administrator")
		frappe.db.commit = self._real_commit
		frappe.db.rollback()

	def _save(self, **values):
		doc = frappe.get_doc("Vendors", self.vendor)
		doc.update(values)
		doc.save(ignore_permissions=True)
		return frappe.get_doc("Vendors", self.vendor)


class TestVendorSave(_VendorCase):
	def test_msme_id_is_normalised_on_save(self):
		self.assertEqual(self._save(msme_id="udyam - up-28 - 0012345", msme_attachment=CERT_URL).msme_id, GOOD_ID)

	def test_a_malformed_msme_id_is_refused(self):
		with self.assertRaises(frappe.ValidationError):
			self._save(msme_id="UDYAM-UP-28-123", msme_attachment=CERT_URL)

	def test_msme_details_are_optional_and_clearable(self):
		self._save(msme_id=GOOD_ID, msme_attachment=CERT_URL)
		cleared = self._save(msme_id="", msme_attachment="")
		self.assertIsNone(cleared.msme_id)
		self.assertFalse(cleared.msme_attachment)

	def test_an_msme_id_needs_its_certificate(self):
		# Owner, 2026-11-19: ID and certificate come together, both or neither.
		with self.assertRaisesRegex(frappe.ValidationError, "Upload the MSME certificate"):
			self._save(msme_id=GOOD_ID)

	def test_a_certificate_needs_its_msme_id(self):
		with self.assertRaisesRegex(frappe.ValidationError, "Enter the MSME ID"):
			self._save(msme_attachment=CERT_URL)

	def test_removing_only_the_certificate_is_refused(self):
		self._save(msme_id=GOOD_ID, msme_attachment=CERT_URL)
		with self.assertRaisesRegex(frappe.ValidationError, "Upload the MSME certificate"):
			self._save(msme_attachment="")

	def test_an_untouched_msme_id_is_not_rechecked(self):
		# The nightly job saves every vendor; a stored value it did not change must never stop it --
		# not a malformed ID, and not an ID stored without its certificate.
		frappe.db.set_value("Vendors", self.vendor, "msme_id", "LEGACY-123", update_modified=False)
		self.assertEqual(self._save(vendor_nickname="msme test").msme_id, "LEGACY-123")

	def test_read_data_is_stored_as_json_text_and_goes_with_the_certificate(self):
		read = {"enterprise_type": "Micro", "enterprise_name": "M/S GOEL STEELS"}
		saved = self._save(msme_id=GOOD_ID, msme_attachment=CERT_URL, autofill_all_entities_json=read)
		# Long Text, like the invoices' field of the same name: the object is kept as its JSON text.
		self.assertEqual(json.loads(saved.autofill_all_entities_json), read)
		cleared = self._save(msme_id="", msme_attachment="")
		self.assertFalse(cleared.autofill_all_entities_json)

	def _file(self, owner):
		name = frappe.generate_hash(length=10)
		# Frappe stamps `owner` from the session user at insert and drops a passed one, so insert AS the owner.
		frappe.set_user(owner)
		try:
			frappe.get_doc({"doctype": "File", "name": name, "file_name": "udyam.pdf", "file_url": CERT_URL,
			                "is_private": 1}).db_insert()
		finally:
			frappe.set_user("Administrator")
		self.assertEqual(frappe.db.get_value("File", name, "owner"), owner)
		return name

	def test_an_unattached_certificate_is_attached_to_the_vendor(self):
		mine = self._file("Administrator")
		self._save(msme_id=GOOD_ID, msme_attachment=CERT_URL)
		self.assertEqual(
			frappe.db.get_value("File", mine, ["attached_to_doctype", "attached_to_name", "attached_to_field"]),
			("Vendors", self.vendor, "msme_attachment"),
		)

	def test_someone_elses_unattached_file_is_not_claimed(self):
		theirs = self._file("someone.else@example.com")
		self._save(msme_id=GOOD_ID, msme_attachment=CERT_URL)
		self.assertIsNone(frappe.db.get_value("File", theirs, "attached_to_name"))


class _FakeFile:
	file_name = "udyam-certificate.pdf"
	name = "FAKE-FILE"


class TestMsmeAutofill(_VendorCase):
	def _read(self, entities, *, vendor_name="Goel Steels", vendor_id=None, settings=None):
		ents = [
			{"type": k, "mention_text": v, "normalized_text": v, "confidence": 1.0}
			for k, v in entities.items()
		]
		with patch.object(msme_autofill, "get_file_doc_by_url", return_value=_FakeFile()), \
			patch.object(msme_autofill, "fetch_file_content", return_value=b"%PDF"), \
			patch.object(msme_autofill, "get_extraction_settings",
			             return_value=settings or {"enabled": 1, "gemini_model": "test-model"}), \
			patch.object(msme_autofill, "extract", return_value=("", ents, [])) as extract:
			out = msme_autofill.extract_msme_fields(CERT_URL, vendor_name=vendor_name, vendor_id=vendor_id)
		return out, extract

	CERT = {
		"is_udyam_certificate": "yes",
		"udyam_registration_number": "udyam-up-28-0012345",
		"enterprise_name": "M/S GOEL STEELS",
		"enterprise_type": "micro",
		"major_activity": "Manufacturing",
		"date_of_udyam_registration": "15-03-2023",
		"date_of_incorporation": "01-04-2015",
	}

	def test_reads_the_certificate_into_msme_id_and_read_data(self):
		out, extract = self._read(self.CERT)
		self.assertEqual(extract.call_args.kwargs["doc_kind"], "msme_certificate")
		self.assertEqual(out["msme_id"], GOOD_ID)
		j = out["autofill_all_entities_json"]
		self.assertEqual(
			(j["udyam_registration_number"], j["enterprise_type"], j["date_of_udyam_registration"], j["date_of_incorporation"]),
			(GOOD_ID, "Micro", "2023-03-15", "2015-04-01"),
		)
		self.assertEqual((j["file_url"], j["model"]), (CERT_URL, "test-model"))
		v = out["validation"]
		self.assertEqual((v["is_udyam_certificate"], v["id_valid"], v["name_match"], v["duplicates"]), (True, True, True, []))

	def test_stores_everything_read_off_the_certificate(self):
		# Owner, 2026-11-19: the whole certificate goes into autofill_all_entities_json.
		full = {
			**self.CERT,
			"social_category": "General",
			"address_flat_door_block": "29,1ST FLOOR",
			"address_premises_building": "PADMASHREE",
			"address_village_town": "GOTTIGERE",
			"address_block": "BG ROAD",
			"address_road_street_lane": "1ST MAIN KAMAKSHI LAYOUT,",
			"address_city": "BANGALORE",
			"address_district": "BENGALURU (URBAN)",
			"address_state": "KARNATAKA",
			"address_pincode": "560083",
			"mobile": "9000000001",
			"email": "test@example.com",
			"date_of_commencement": "",
			"district_industries_centre": "BANGALORE (URBAN) ( KARNATAKA )",
			"msme_di": "BANGALORE ( KARNATAKA )",
			"units": json.dumps([{"unit_name": " GOEL STEELS UNIT 1 ", "unit_address": None}, {"unit_name": ""}]),
			"nic_codes": json.dumps([{"nic_2_digit": "32 - Other manufacturing", "nic_4_digit": "3290",
			                          "nic_5_digit": "32909", "activity": "Manufacturing"}]),
			"classification_history": json.dumps([{"classification_year": "2024-25", "enterprise_type": "Small",
			                                       "classification_date": "01-04-2024"}]),
		}
		j = self._read(full)[0]["autofill_all_entities_json"]
		self.assertEqual(j["social_category"], "General")
		self.assertEqual(j["official_address"]["pincode"], "560083")
		self.assertEqual(j["official_address"]["district"], "BENGALURU (URBAN)")
		self.assertEqual((j["mobile"], j["email"]), ("9000000001", "test@example.com"))
		self.assertIsNone(j["date_of_commencement"], "blank on the certificate stays null")
		self.assertEqual(j["units"], [{"unit_name": "GOEL STEELS UNIT 1", "unit_address": None}], "empty rows dropped")
		self.assertEqual(j["nic_codes"][0]["nic_5_digit"], "32909")
		self.assertEqual(j["classification_history"][0]["classification_date"], "2024-04-01")
		self.assertEqual((j["district_industries_centre"], j["msme_di"]),
		                 ("BANGALORE (URBAN) ( KARNATAKA )", "BANGALORE ( KARNATAKA )"))

	def test_missing_or_unreadable_tables_are_empty_lists(self):
		j = self._read({**self.CERT, "nic_codes": "not json"})[0]["autofill_all_entities_json"]
		self.assertEqual((j["units"], j["nic_codes"], j["classification_history"]), ([], [], []))
		self.assertEqual(set(j["official_address"].values()), {None})

	def test_reads_the_same_fields_the_extractor_asks_for(self):
		# msme_autofill._SCALARS repeats gemini._MSME_FIELDS; they must not drift apart.
		from nirmaan_stack.services.extraction import gemini

		self.assertEqual(tuple(msme_autofill._SCALARS), gemini._MSME_FIELDS)

	def test_a_malformed_number_does_not_fill_the_form(self):
		out, _ = self._read({**self.CERT, "udyam_registration_number": "UDYAM-UP-28-12"})
		self.assertEqual(out["msme_id"], "")
		self.assertFalse(out["validation"]["id_valid"])
		self.assertEqual(out["validation"]["id_read"], "UDYAM-UP-28-12")

	def test_nothing_read_fills_nothing(self):
		out, _ = self._read({})
		self.assertEqual(out["msme_id"], "")
		self.assertIsNone(out["autofill_all_entities_json"]["enterprise_name"])

	def test_warnings(self):
		out, _ = self._read({**self.CERT, "is_udyam_certificate": "no"}, vendor_name="Sharma Electricals")
		self.assertFalse(out["validation"]["is_udyam_certificate"])
		self.assertFalse(out["validation"]["name_match"])
		self.assertEqual(out["validation"]["certificate_name"], "M/S GOEL STEELS")

	def test_an_unknown_enterprise_type_is_left_blank(self):
		out, _ = self._read({**self.CERT, "enterprise_type": "Large"})
		self.assertIsNone(out["autofill_all_entities_json"]["enterprise_type"])

	def test_another_vendor_with_the_same_id_is_a_warning(self):
		frappe.db.set_value("Vendors", self.other_vendor, "msme_id", GOOD_ID, update_modified=False)
		out, _ = self._read(self.CERT, vendor_id=self.vendor)
		self.assertEqual([d["name"] for d in out["validation"]["duplicates"]], [self.other_vendor])
		# ...but the vendor's own ID is never a duplicate of itself.
		self.assertEqual(msme_autofill.msme_duplicates(GOOD_ID, self.other_vendor), [])

	def test_refuses_when_document_ai_is_off(self):
		with self.assertRaises(frappe.ValidationError):
			self._read(self.CERT, settings={"enabled": 0})

	def test_refuses_an_unsupported_file(self):
		class Doc(_FakeFile):
			file_name = "udyam.docx"
		with patch.object(msme_autofill, "get_file_doc_by_url", return_value=Doc()), \
			self.assertRaises(frappe.ValidationError):
			msme_autofill.extract_msme_fields(CERT_URL)

	def test_only_people_who_may_edit_vendors_can_read(self):
		def can_edit(user):
			return frappe.has_permission("Vendors", "create", user=user) or frappe.has_permission("Vendors", "write", user=user)
		outsider = next(
			(u for u in frappe.get_all("User", filters={"enabled": 1, "user_type": "System User"}, pluck="name")
			 if u not in ("Administrator", "Guest") and not can_edit(u)),
			None,
		)
		if not outsider:
			raise unittest.SkipTest("every user on this site may edit vendors")
		frappe.set_user(outsider)
		try:
			with self.assertRaises(frappe.PermissionError):
				self._read(self.CERT)
			with self.assertRaises(frappe.PermissionError):
				msme_autofill.msme_duplicates(GOOD_ID)
		finally:
			frappe.set_user("Administrator")
