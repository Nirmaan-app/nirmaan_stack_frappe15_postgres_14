# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt
"""Pure rules for a Vendor Invoice's base / GST / total figures (ADR-0030). No DB.

The endpoint suite (`api/delivery_notes/test_update_invoice_data`) drives the same rules
through `update_invoice_data`; this file pins the edges that suite does not walk.
"""

import unittest

from nirmaan_stack.services.invoice_amounts import (
	missing_split,
	parse_figure,
	signed,
	split_warnings,
)


class TestParseFigure(unittest.TestCase):
	def test_absent_blank_and_junk_are_none(self):
		for value in (None, "", "   ", "abc", True, float("nan"), float("inf")):
			self.assertIsNone(parse_figure(value), repr(value))

	def test_zero_and_grouped_numbers_are_figures(self):
		self.assertEqual(parse_figure(0), 0.0)
		self.assertEqual(parse_figure("0"), 0.0)
		self.assertEqual(parse_figure("1,18,000.50"), 118000.5)
		self.assertEqual(parse_figure(-180), -180.0)


class TestMissingSplit(unittest.TestCase):
	def test_names_each_missing_figure_in_form_order(self):
		self.assertEqual(missing_split(None, ""), ["Invoice Base Amount", "Invoice GST Amount"])
		self.assertEqual(missing_split("100", None), ["Invoice GST Amount"])
		self.assertEqual(missing_split(100, 0), [])


class TestSigned(unittest.TestCase):
	def test_credit_note_is_negative_whatever_sign_arrives(self):
		self.assertEqual(signed(180, True), -180.0)
		self.assertEqual(signed("-180", True), -180.0)
		self.assertIsNone(signed("", True))

	def test_invoice_keeps_the_sign_it_was_given(self):
		"""A return note (Gemini-detected, not a credit note) arrives negative and stays so."""
		self.assertEqual(signed(-180, False), -180.0)
		self.assertEqual(signed(180, False), 180.0)


class TestSplitWarnings(unittest.TestCase):
	def test_a_gap_of_exactly_5_is_silent_and_just_over_warns(self):
		self.assertEqual(split_warnings(1185, 1000, 180), [])
		self.assertEqual(len(split_warnings(1185.01, 1000, 180)), 1)
		self.assertEqual(len(split_warnings(1174.99, 1000, 180)), 1)

	def test_credit_note_figures_compare_like_an_invoice(self):
		self.assertEqual(split_warnings(-1180, -1000, -180), [])

	def test_a_split_never_entered_does_not_warn(self):
		"""Currency columns read back 0 when unset, so 0 / 0 means 'not entered'."""
		self.assertEqual(split_warnings(1180, 0, 0), [])
		self.assertEqual(split_warnings(1180, None, None), [])

	def test_gst_on_a_gst_off_work_order(self):
		self.assertEqual(len(split_warnings(1000, 1000, 0, gst_off_work_order=True)), 0)
		warned = split_warnings(1180, 1000, 180, gst_off_work_order=True)
		self.assertEqual(len(warned), 1)
		self.assertIn("GST off", warned[0])
		self.assertEqual(split_warnings(1180, 1000, 180, gst_off_work_order=False), [])

	def test_both_warnings_can_fire_together(self):
		self.assertEqual(len(split_warnings(2000, 1000, 180, gst_off_work_order=True)), 2)


if __name__ == "__main__":
	unittest.main()
