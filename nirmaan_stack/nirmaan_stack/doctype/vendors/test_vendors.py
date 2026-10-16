# Copyright (c) 2024, Abhishek and Contributors
# See license.txt

"""`Vendors.validate`: the PAN sets the TDS rate when a vendor is created or its PAN / rate is edited,
and no other save moves it (`services/vendor_tds.py`, whose pure rule is pinned by
`services/test_vendor_tds.py`).

    bench --site localhost run-tests --module nirmaan_stack.nirmaan_stack.doctype.vendors.test_vendors

⚠️ RUNS AGAINST THE LIVE SITE DB. Each vendor is inserted and saved through the document layer
inside the test's own transaction, and `tearDown` rolls it back: nothing on this save path commits
(no categories, no payee), so no vendor, Version row or naming-series step survives the run.
"""

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import flt

VENDOR_NAME = "_Test TDS-from-PAN Vendor"
INDIVIDUAL_PAN = "ABCPE1234F"
HUF_PAN = "ABCHE1234F"
COMPANY_PAN = "ABCCE1234F"


class TestVendorTdsRateFromPan(FrappeTestCase):
	def tearDown(self):
		frappe.db.rollback()

	def _insert(self, pan, rate=None):
		"""A vendor saved the way Desk / Data Import save one: `rate=None` leaves the field default."""
		doc = frappe.get_doc({
			"doctype": "Vendors",
			"vendor_name": VENDOR_NAME,
			"vendor_type": "Material",
			"vendor_pan": pan,
			# Never None: the after_insert hook reads vendor_category["categories"].
			"vendor_category": {"categories": []},
		})
		if rate is not None:
			doc.tds_deduction_percentage = rate
		doc.insert(ignore_permissions=True)
		return doc.name

	def _edit(self, name, **values):
		doc = frappe.get_doc("Vendors", name)
		doc.update(values)
		doc.save(ignore_permissions=True)

	def _rate(self, name):
		return flt(frappe.db.get_value("Vendors", name, "tds_deduction_percentage"))

	# --- create ---

	def test_individual_left_at_the_field_default_saves_at_1(self):
		self.assertEqual(self._rate(self._insert(INDIVIDUAL_PAN)), 1)

	def test_individual_sent_at_2_by_a_stale_form_saves_at_1(self):
		self.assertEqual(self._rate(self._insert(INDIVIDUAL_PAN, 2)), 1)

	def test_huf_saves_at_1(self):
		self.assertEqual(self._rate(self._insert(HUF_PAN, 2)), 1)

	def test_lowercase_pan_is_still_read(self):
		self.assertEqual(self._rate(self._insert(" abcpe1234f ", 2)), 1)

	def test_individual_is_always_1_whatever_was_entered(self):
		for rate in (0, 0.5, 3, 5):
			with self.subTest(rate=rate):
				self.assertEqual(self._rate(self._insert(INDIVIDUAL_PAN, rate)), 1)

	def test_company_left_at_the_field_default_saves_at_2(self):
		self.assertEqual(self._rate(self._insert(COMPANY_PAN)), 2)

	def test_company_keeps_the_rate_the_user_chose(self):
		for rate in (0, 1, 3, 4):
			with self.subTest(rate=rate):
				self.assertEqual(self._rate(self._insert(COMPANY_PAN, rate)), rate)

	def test_unreadable_rate_on_a_company_gets_2_not_0(self):
		self.assertEqual(self._rate(self._insert(COMPANY_PAN, "2%")), 2)

	def test_no_or_invalid_pan_leaves_the_rate(self):
		for pan, rate in ((None, 1), ("", 3), ("ABCP1234F", 1), ("ABCPE1234", 2)):
			with self.subTest(pan=pan):
				self.assertEqual(self._rate(self._insert(pan, rate)), rate)

	# --- update ---

	def test_pan_changed_from_company_to_individual_moves_to_1(self):
		name = self._insert(COMPANY_PAN, 3)
		self._edit(name, vendor_pan=INDIVIDUAL_PAN)
		self.assertEqual(self._rate(name), 1)

	def test_pan_changed_from_individual_to_company_takes_the_forms_2(self):
		# The form puts the 2% default back when an Individual / HUF PAN is replaced.
		name = self._insert(INDIVIDUAL_PAN)
		self._edit(name, vendor_pan=COMPANY_PAN, tds_deduction_percentage=2)
		self.assertEqual(self._rate(name), 2)

	def test_editing_another_field_keeps_1(self):
		name = self._insert(INDIVIDUAL_PAN)
		self._edit(name, vendor_nickname="renamed", vendor_type="Material & Service")
		self.assertEqual(self._rate(name), 1)

	def test_a_save_that_edits_neither_pan_nor_rate_leaves_an_off_rule_rate(self):
		# What the 04:30 credit job does to every vendor (tasks/vendor_credit_update.py): a full save
		# that only touches the credit fields. It must not move a rate, even one off the rule.
		name = self._insert(INDIVIDUAL_PAN)
		frappe.db.set_value("Vendors", name, "tds_deduction_percentage", 3)
		self._edit(name, credit_used=1000, available_credit=49000, vendor_status="Active")
		self.assertEqual(self._rate(name), 3)

	def test_changing_an_individuals_rate_is_put_back_to_1(self):
		name = self._insert(INDIVIDUAL_PAN)
		for rate in (2, 3, 0):
			with self.subTest(rate=rate):
				self._edit(name, tds_deduction_percentage=rate)
				self.assertEqual(self._rate(name), 1)

	def test_changing_a_companys_rate_is_kept(self):
		name = self._insert(COMPANY_PAN)
		self._edit(name, tds_deduction_percentage=4)
		self.assertEqual(self._rate(name), 4)
		self._edit(name, tds_deduction_percentage=1)
		self.assertEqual(self._rate(name), 1)

	def test_clearing_the_rate_takes_the_pans_rate(self):
		individual = self._insert(INDIVIDUAL_PAN)
		self._edit(individual, tds_deduction_percentage=None)
		self.assertEqual(self._rate(individual), 1)
		company = self._insert(COMPANY_PAN, 3)
		self._edit(company, tds_deduction_percentage=None)
		self.assertEqual(self._rate(company), 2)

	def test_pan_cleared_leaves_the_rate(self):
		name = self._insert(INDIVIDUAL_PAN)
		self._edit(name, vendor_pan=None, tds_deduction_percentage=2)
		self.assertEqual(self._rate(name), 2)
