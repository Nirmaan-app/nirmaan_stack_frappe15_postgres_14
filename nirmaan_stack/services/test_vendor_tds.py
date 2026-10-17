# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt
"""Pure rule for a vendor's TDS rate from its PAN. No DB.

The save path (`Vendors.validate`) is pinned by `doctype/vendors/test_vendors.py`.
"""

import json
import os
import unittest

from nirmaan_stack.services.vendor_tds import (
	is_individual_huf_pan,
	is_readable_rate,
	rate_to_store,
)

#: Shared with the frontend twin's suite (`frontend/src/pages/vendors/utils/vendorTaxIds.test.ts`).
with open(os.path.join(os.path.dirname(__file__), "vendor_tds_cases.json")) as _f:
	CASES = json.load(_f)["cases"]


class TestSharedCases(unittest.TestCase):
	def test_individual_huf(self):
		for case in CASES:
			with self.subTest(case["name"]):
				self.assertEqual(is_individual_huf_pan(case["pan"]), case["individual_huf"])

	def test_stored_rate(self):
		for case in CASES:
			with self.subTest(case["name"]):
				self.assertEqual(float(rate_to_store(case["pan"], case["rate"])), case["stored"])


class TestEdges(unittest.TestCase):
	def test_a_pan_sent_as_a_number_does_not_crash(self):
		self.assertFalse(is_individual_huf_pan(12345))
		self.assertEqual(rate_to_store(12345, 3), 3)

	def test_readable_rates(self):
		for rate in (0, 1, 2.5, "3", " 4.0 ", "0.5", ".5", "-1"):
			self.assertTrue(is_readable_rate(rate), repr(rate))
		for rate in (None, "", "  ", "2%", "abc", "0x2", "1e2", True, False, float("nan"), float("inf")):
			self.assertFalse(is_readable_rate(rate), repr(rate))
