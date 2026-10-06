# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt
"""The Work Order payment limit (ADR-0030; GLOSSARY.md, *Work Order payment limit*). Pure, no DB.

The endpoint suite (`api/payments/test_work_order_payment_limit`) drives the same rules through
`create_payment_request_for_service` and `get_payment_summary`.
"""

import unittest

from nirmaan_stack.services.work_order_payment_limit import request_refusal, work_order_limit


def _base(name, amount, status="Approved"):
	return {"name": name, "amount": amount, "status": status, "is_gst_payment": 0}


def _gst(name, amount, status="Approved"):
	return {"name": name, "amount": amount, "status": status, "is_gst_payment": 1}


def _limit(out):
	return (out["limit"]["base_left"], out["limit"]["gst_left"], out["limit"]["total_left"])


class TestWorkedExample(unittest.TestCase):
	"""The spec's table: base 1,00,000, GST on, total 1,18,000, vendor TDS 2%."""

	TOTAL = 118000

	def test_step_1_nothing_yet(self):
		out = work_order_limit(self.TOTAL, "true", 0, [])
		self.assertEqual(out["limit"]["base_value"], 100000)
		self.assertEqual(out["limit"]["work_order_gst"], 18000)
		self.assertEqual(_limit(out), (100000, 0, 118000))

	def test_step_2_a_base_payment_counts_before_tds(self):
		# 40,000 approved: 800 withheld, the stored amount is the 39,200 the vendor gets.
		out = work_order_limit(self.TOTAL, "true", 0, [_base("B1", 39200)], {"B1": 800})
		self.assertEqual(_limit(out), (60000, 0, 78000))

	def test_step_3_a_pending_invoice_opens_nothing(self):
		# GST Invoiced counts Approved invoices only, so it is still 0.
		out = work_order_limit(self.TOTAL, "true", 0, [_base("B1", 39200)], {"B1": 800})
		self.assertEqual(out["limit"]["gst_left"], 0)

	def test_step_4_an_approved_invoice_opens_its_gst(self):
		out = work_order_limit(self.TOTAL, "true", 9000, [_base("B1", 39200)], {"B1": 800})
		self.assertEqual(_limit(out), (60000, 9000, 78000))

	def test_step_5_a_gst_payment_uses_up_gst_left_only(self):
		payments = [_base("B1", 39200), _gst("G1", 9000)]
		out = work_order_limit(self.TOTAL, "true", 9000, payments, {"B1": 800})
		self.assertEqual(_limit(out), (60000, 0, 69000))

	def test_step_6_a_second_invoice_opens_more(self):
		payments = [_base("B1", 39200), _gst("G1", 9000)]
		out = work_order_limit(self.TOTAL, "true", 18000, payments, {"B1": 800})
		self.assertEqual(_limit(out), (60000, 9000, 69000))


class TestLimitRules(unittest.TestCase):
	def test_over_stated_invoice_gst_is_capped_at_the_work_orders_own_gst(self):
		"""The TDS guard: base value must never go out as a GST payment."""
		out = work_order_limit(118000, "true", 25000, [])
		self.assertEqual(out["limit"]["gst_released"], 18000)
		self.assertEqual(out["limit"]["gst_left"], 18000)

	def test_gst_left_is_floored_at_zero(self):
		# An approved invoice was rejected after its GST was paid: nothing is undone, GST left reads 0.
		out = work_order_limit(118000, "true", 5000, [_gst("G1", 9000)])
		self.assertEqual(out["limit"]["gst_left"], 0)

	def test_an_old_work_order_paid_past_its_base_value(self):
		out = work_order_limit(118000, "true", 0, [_base("B1", 110000, "Paid")])
		self.assertEqual(_limit(out), (0, 0, 8000))

	def test_a_gst_off_work_order_has_no_gst_part(self):
		out = work_order_limit(100000, "false", 5000, [_base("B1", 30000)])
		self.assertFalse(out["limit"]["gst_on"])
		self.assertEqual(out["limit"]["base_value"], 100000)
		self.assertEqual(out["limit"]["work_order_gst"], 0)
		self.assertEqual(_limit(out), (70000, 0, 70000))

	def test_a_company_borne_work_order_does_not_add_the_tax_back(self):
		out = work_order_limit(118000, "true", 0, [_base("B1", 40000)], {"B1": 800}, company_borne=True)
		self.assertEqual(out["limit"]["base_left"], 60000)

	def test_a_rejected_payment_still_holds_its_share(self):
		payments = [_base("B1", 10000, "Rejected"), _gst("G1", 2000, "Rejected")]
		out = work_order_limit(118000, "true", 9000, payments)
		self.assertEqual(_limit(out), (90000, 7000, 106000))

	def test_every_counted_status_counts_and_an_unknown_one_does_not(self):
		payments = [
			_base("A", 1000, "Paid"),
			_base("B", 1000, "Reconciliation Pending"),
			_base("C", 1000, "Approved"),
			_base("D", 1000, "CEO Pending"),
			_base("E", 1000, "Requested"),
			_base("F", 1000, "Rejected"),
			_base("X", 1000, "Cancelled"),
		]
		out = work_order_limit(118000, "true", 0, payments)
		self.assertEqual(out["limit"]["base_left"], 94000)
		self.assertEqual(out["left"], out["limit"]["total_left"])

	def test_the_payment_being_approved_is_left_out(self):
		out = work_order_limit(118000, "true", 9000, [_gst("G1", 4000)], exclude_payment="G1")
		self.assertEqual(out["limit"]["gst_left"], 9000)

	def test_the_per_status_lines_are_the_summarys(self):
		out = work_order_limit(118000, "true", 0, [_base("B1", 39200, "Paid"), _gst("G1", 100, "Requested")], {"B1": 800})
		self.assertEqual(out["value"], 118000)
		self.assertEqual(out["lines"]["paid"], 40000)
		self.assertEqual(out["lines"]["requested"], 100)


class TestPartCaps(unittest.TestCase):
	"""`caps`: what each part may take, and which limit binds. The dialogs show these as given."""

	def test_after_a_base_payment_base_may_take_what_is_left_of_it(self):
		# Story 25: after a 40,000 base payment, Full (Base) offers 60,000.
		out = work_order_limit(118000, "true", 9000, [_base("B1", 39200)], {"B1": 800})
		self.assertEqual(out["limit"]["caps"]["base"], {"cap": 60000, "binds": "part"})
		self.assertEqual(out["limit"]["caps"]["gst"], {"cap": 9000, "binds": "part"})

	def test_total_left_binds_below_a_parts_own_left(self):
		# An old Work Order paid 1,10,000 of base: GST left 18,000, but only 8,000 left in total.
		out = work_order_limit(118000, "true", 18000, [_base("B1", 110000, "Paid")])
		self.assertEqual(out["limit"]["caps"]["gst"], {"cap": 8000, "binds": "total"})
		self.assertEqual(out["limit"]["caps"]["base"], {"cap": 0, "binds": "part"})

	def test_an_over_paid_order_caps_at_zero(self):
		out = work_order_limit(118000, "true", 18000, [_base("B1", 118500, "Paid")])
		self.assertEqual(out["limit"]["caps"]["gst"], {"cap": 0, "binds": "total"})

	def test_a_gst_off_work_order_has_no_gst_to_take(self):
		out = work_order_limit(100000, "false", 5000, [_base("B1", 30000)])
		self.assertEqual(out["limit"]["caps"]["gst"], {"cap": 0, "binds": "part"})
		self.assertEqual(out["limit"]["caps"]["base"], {"cap": 70000, "binds": "part"})


class TestRequestRefusal(unittest.TestCase):
	def setUp(self):
		# Base left 60,000, GST left 9,000, total left 69,000 (the worked example's step 6).
		payments = [_base("B1", 39200), _gst("G1", 9000)]
		self.limit = work_order_limit(118000, "true", 18000, payments, {"B1": 800})["limit"]

	def test_within_the_chosen_part_is_allowed(self):
		self.assertIsNone(request_refusal(self.limit, 60000, gst_payment=False))
		self.assertIsNone(request_refusal(self.limit, 9000, gst_payment=True))

	def test_the_ten_rupee_tolerance_is_kept(self):
		self.assertIsNone(request_refusal(self.limit, 60010, gst_payment=False))
		self.assertEqual(request_refusal(self.limit, 60010.5, gst_payment=False), {"part": "base", "left": 60000})

	def test_above_base_left_is_refused(self):
		self.assertEqual(request_refusal(self.limit, 61000, gst_payment=False), {"part": "base", "left": 60000})

	def test_above_gst_left_is_refused(self):
		self.assertEqual(request_refusal(self.limit, 9500, gst_payment=True), {"part": "gst", "left": 9000})

	def test_above_total_left_is_refused_even_within_the_part(self):
		# An old Work Order paid 1,10,000 of base before GST payments existed: GST left is the full
		# 18,000, but only 8,000 remains under the total incl. GST.
		limit = work_order_limit(118000, "true", 18000, [_base("B1", 110000, "Paid")])["limit"]
		self.assertEqual((limit["gst_left"], limit["total_left"]), (18000, 8000))
		self.assertEqual(request_refusal(limit, 9000, gst_payment=True), {"part": "total", "left": 8000})
		self.assertIsNone(request_refusal(limit, 8000, gst_payment=True))

	def test_a_gst_payment_on_a_gst_off_work_order_is_refused(self):
		limit = work_order_limit(100000, "false", 0, [])["limit"]
		self.assertEqual(request_refusal(limit, 5, gst_payment=True), {"part": "no_gst", "left": 0})
		self.assertIsNone(request_refusal(limit, 100000, gst_payment=False))
