"""Pure tests for services/vendor_ledger.py — no DB, no site."""

import unittest

from nirmaan_stack.services.vendor_ledger import (
	BASE_AS_ON,
	LEDGER_START,
	build_ledger_statement,
	invoice_ledger_rows,
)


def _row(date, amount=0, payment=0, project="P1", type_="Invoice Recorded"):
	return {"type": type_, "date": date, "project": project, "details": "", "amount": amount, "payment": payment}


ROWS = [
	_row("2025-04-05 10:00:00", amount=1000),
	_row("2025-05-10 09:00:00", payment=400, type_="Payment Made"),
	_row("2025-06-01 00:00:00", amount=500, project="P2"),
	_row("2025-06-15 23:59:59", amount=-100, type_="Credit Note Recorded"),
	_row("2025-07-01 12:00:00", payment=300, project="P2", type_="Payment Made"),
	_row("2025-07-20 08:00:00", payment=-50, type_="Refund Received"),
]


class TestInvoiceLedgerRows(unittest.TestCase):
	def test_drops_order_creation_rows(self):
		rows = [_row("2025-04-01", type_="PO Created"), _row("2025-04-01", type_="SR Created"), *ROWS]
		self.assertEqual(invoice_ledger_rows(rows), ROWS)


class TestBuildLedgerStatement(unittest.TestCase):
	def test_no_filter_opens_at_base_and_runs_balance(self):
		st = build_ledger_statement(ROWS, opening_invoice=200, opening_payment=50)
		self.assertEqual(st["opening"], {"as_on": BASE_AS_ON, "invoice": 200, "payment": 50, "balance": 150, "is_base": True})
		self.assertEqual([r["balance"] for r in st["rows"]], [1150, 750, 1250, 1150, 850, 900])
		self.assertEqual(st["totals"], {"invoice": 1400, "payment": 650})
		self.assertEqual(st["closing"], 900)
		self.assertEqual(st["period"], {"from": LEDGER_START, "to": None})

	def test_from_date_folds_earlier_rows_into_opening(self):
		st = build_ledger_statement(ROWS, 200, 50, from_date="2025-06-01")
		self.assertEqual(st["opening"]["as_on"], "2025-05-31")
		self.assertFalse(st["opening"]["is_base"])
		self.assertEqual(st["opening"]["invoice"], 1200)
		self.assertEqual(st["opening"]["payment"], 450)
		self.assertEqual(st["opening"]["balance"], 750)
		# The row ON from_date (midnight) is shown, not carried.
		self.assertEqual(st["rows"][0]["date"], "2025-06-01 00:00:00")
		self.assertEqual(st["closing"], 900)

	def test_to_date_includes_the_whole_last_day(self):
		st = build_ledger_statement(ROWS, to_date="2025-06-15")
		self.assertEqual(st["rows"][-1]["date"], "2025-06-15 23:59:59")
		self.assertEqual(len(st["rows"]), 4)
		self.assertEqual(st["opening"]["as_on"], BASE_AS_ON)

	def test_period_closing_equals_full_balance_on_that_day(self):
		full = build_ledger_statement(ROWS, 200, 50)
		for split in ("2025-04-05", "2025-05-11", "2025-06-15", "2025-07-01", "2025-12-31"):
			before = build_ledger_statement(ROWS, 200, 50, to_date=_prev(split))
			after = build_ledger_statement(ROWS, 200, 50, from_date=split)
			self.assertAlmostEqual(after["opening"]["balance"], before["closing"], msg=split)
			self.assertAlmostEqual(after["closing"], full["closing"], msg=split)

	def test_from_before_ledger_start_keeps_base_opening(self):
		st = build_ledger_statement(ROWS, 200, 50, from_date="2024-05-01")
		self.assertTrue(st["opening"]["is_base"])
		self.assertEqual(st["opening"]["balance"], 150)
		self.assertEqual(len(st["rows"]), len(ROWS))
		self.assertEqual(st["period"]["from"], LEDGER_START)

	def test_from_on_ledger_start_is_base(self):
		st = build_ledger_statement(ROWS, 200, 50, from_date=LEDGER_START)
		self.assertTrue(st["opening"]["is_base"])
		self.assertEqual(st["opening"]["as_on"], BASE_AS_ON)

	def test_project_filter_runs_before_the_carry_forward(self):
		st = build_ledger_statement(ROWS, 200, 50, from_date="2025-07-01", projects=["P2"])
		# Only P2's June invoice is carried; P1's rows never enter.
		self.assertEqual(st["opening"]["invoice"], 700)
		self.assertEqual(st["opening"]["payment"], 50)
		self.assertEqual([r["project"] for r in st["rows"]], ["P2"])
		self.assertEqual(st["closing"], 350)
		self.assertEqual(st["projects"], ["P2"])

	def test_empty_range_closes_at_opening(self):
		st = build_ledger_statement(ROWS, 200, 50, from_date="2025-07-01", to_date="2025-06-01")
		self.assertEqual(st["rows"], [])
		self.assertEqual(st["totals"], {"invoice": 0, "payment": 0})
		self.assertEqual(st["closing"], st["opening"]["balance"])

	def test_no_rows(self):
		st = build_ledger_statement([], 0, 0)
		self.assertEqual(st["rows"], [])
		self.assertEqual(st["closing"], 0)

	def test_input_rows_are_not_mutated(self):
		rows = [dict(r) for r in ROWS]
		build_ledger_statement(rows, 0, 0)
		self.assertNotIn("balance", rows[0])


def _prev(day):
	from datetime import date, timedelta

	return (date.fromisoformat(day) - timedelta(days=1)).isoformat()
