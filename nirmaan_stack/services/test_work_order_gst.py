# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt
"""Pure rules for a Work Order's own GST and the GST an invoice approval opens up (ADR-0030).
No DB. The endpoint suite (`api/invoices/test_gst_release`) drives the same rules end to end.
"""

import unittest

from nirmaan_stack.services.work_order_gst import (
	gst_is_on,
	gst_opened_by_approval,
	work_order_gst,
)


class TestGstIsOn(unittest.TestCase):
	def test_the_stored_spellings_of_on(self):
		for flag in ("true", "True", " TRUE ", "1", "yes"):
			self.assertTrue(gst_is_on(flag), flag)

	def test_everything_else_is_off(self):
		for flag in ("false", "", None, "0", "no"):
			self.assertFalse(gst_is_on(flag), flag)


class TestWorkOrderGst(unittest.TestCase):
	def test_gst_on_is_the_18_percent_inside_the_total(self):
		# base 100000 -> total incl. GST 118000 -> GST 18000
		self.assertAlmostEqual(work_order_gst(118000, "true"), 18000)

	def test_rounded_to_paise(self):
		self.assertEqual(work_order_gst(1000, "true"), 152.54)

	def test_gst_off_has_no_gst(self):
		self.assertEqual(work_order_gst(118000, "false"), 0)

	def test_blank_total_has_no_gst(self):
		self.assertEqual(work_order_gst(None, "true"), 0)


class TestGstOpenedByApproval(unittest.TestCase):
	def test_all_of_the_invoice_gst_when_well_under_the_work_order_gst(self):
		self.assertAlmostEqual(gst_opened_by_approval(2000, 5000, 18000), 5000)

	def test_capped_at_the_work_order_gst(self):
		# 15000 already invoiced; this bill's 5000 would take it to 20000 > 18000
		self.assertAlmostEqual(gst_opened_by_approval(15000, 5000, 18000), 3000)

	def test_nothing_once_the_work_order_gst_is_fully_invoiced(self):
		self.assertAlmostEqual(gst_opened_by_approval(18000, 5000, 18000), 0)
		self.assertAlmostEqual(gst_opened_by_approval(25000, 5000, 18000), 0)

	def test_a_credit_note_takes_gst_back(self):
		self.assertAlmostEqual(gst_opened_by_approval(10000, -1000, 18000), -1000)

	def test_a_gst_off_work_order_opens_nothing(self):
		self.assertAlmostEqual(gst_opened_by_approval(0, 5000, 0), 0)

	def test_blank_figures_read_as_zero(self):
		self.assertAlmostEqual(gst_opened_by_approval(None, None, 18000), 0)
