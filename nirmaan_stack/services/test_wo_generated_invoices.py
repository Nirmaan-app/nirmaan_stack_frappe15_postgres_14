# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""The rules of a generated invoice that need no database (#1546; GLOSSARY *Generated invoice*,
*RA number*). The actions themselves are tested as a role in
`api/service_requests/test_generated_invoices.py`.

Run:  DEVENV unit nirmaan_stack.services.test_wo_generated_invoices
"""

import unittest
from datetime import date

from nirmaan_stack.services import wo_generated_invoices as gi


class TestNextRaNumber(unittest.TestCase):
	def test_a_work_order_with_nothing_starts_at_one(self):
		self.assertEqual(gi.next_ra_number([], []), 1)

	def test_follows_the_highest_number_already_given_voided_ones_included(self):
		self.assertEqual(gi.next_ra_number([1, 3, 2], []), 4)

	def test_an_older_work_order_starts_after_the_highest_ra_on_its_invoice_numbers(self):
		old = ["INV-25-26-00107-01080-RA-4", "RA-2", "ra 7", "Bill RA6", None, ""]
		self.assertEqual(gi.next_ra_number([], old), 8)

	def test_takes_whichever_is_higher(self):
		self.assertEqual(gi.next_ra_number([9], ["INV-25-26-00107-01080-RA-4"]), 10)
		self.assertEqual(gi.next_ra_number([2], ["RA-5"]), 6)

	def test_text_that_only_looks_like_an_ra_counts_for_nothing(self):
		for text in ("INV-25-26-00107-01080-FINAL", "IRA-9", "TRANSRA 9", "1234", "RA-"):
			self.assertEqual(gi.next_ra_number([], [text]), 1, text)


class TestInvoiceNumber(unittest.TestCase):
	def test_an_ra_bill_is_numbered_from_its_date_project_and_work_order(self):
		self.assertEqual(
			gi.invoice_number(date(2026, 10, 21), "PROJ-00107", "SR-00107-001080", gi.RA, 3),
			"INV-26-27-00107-01080-RA-3",
		)

	def test_a_final_bill_ends_in_final_and_its_year_turns_in_april(self):
		self.assertEqual(
			gi.invoice_number(date(2027, 3, 31), "PROJ-00107", "SR-00107-001080", gi.FINAL, 5),
			"INV-26-27-00107-01080-FINAL",
		)
		self.assertEqual(
			gi.invoice_number(date(2027, 4, 1), "PROJ-00107", "SR-00107-001080", gi.RA, 6),
			"INV-27-28-00107-01080-RA-6",
		)


class TestBillableLeft(unittest.TestCase):
	def test_is_the_smaller_of_amount_and_paid_less_what_is_billed(self):
		self.assertEqual(gi.billable_left(100_000, 60_000, 25_000), 35_000)
		self.assertEqual(gi.billable_left(100_000, 120_000, 25_000), 75_000)

	def test_never_goes_below_nothing(self):
		self.assertEqual(gi.billable_left(100_000, 20_000, 25_000), 0)


class TestChangeProblem(unittest.TestCase):
	BEFORE = {
		"work_order": "SR-1", "project": "P", "vendor": "V", "ra_number": 1, "invoice_type": "RA",
		"amount": 1000, "invoice_date": "2026-10-21", "invoice_no": "INV-1", "status": "Generated",
		"void_reason": None, "vendor_invoice": None, "signed_attachment": None,
	}

	def _after(self, **changes):
		return {**self.BEFORE, **changes}

	def test_no_figure_of_a_generated_invoice_ever_changes(self):
		for field, value in (("amount", 2000), ("invoice_no", "INV-2"), ("ra_number", 2),
							 ("invoice_date", "2026-10-22"), ("invoice_type", "FINAL"), ("work_order", "SR-2")):
			self.assertIsNotNone(gi.change_problem(self.BEFORE, self._after(**{field: value})), field)

	def test_the_same_figures_sent_back_change_nothing(self):
		self.assertIsNone(gi.change_problem(self.BEFORE, self._after(amount="1000.00", ra_number="1")))

	def test_a_void_writes_its_reason_and_nothing_else(self):
		self.assertIsNone(gi.change_problem(self.BEFORE, self._after(status="Voided", void_reason="Wrong amount")))
		self.assertIsNotNone(gi.change_problem(self.BEFORE, self._after(status="Voided")))
		self.assertIsNotNone(gi.change_problem(self.BEFORE, self._after(void_reason="Typo")))

	def test_moves_follow_the_life_of_the_invoice(self):
		self.assertIsNone(gi.change_problem(
			self.BEFORE, self._after(status="Signed", vendor_invoice="VI-1", signed_attachment="ATT-1")))
		signed = self._after(status="Signed", vendor_invoice="VI-1", signed_attachment="ATT-1")
		self.assertIsNone(gi.change_problem(signed, {**signed, "status": "Approved"}))
		self.assertIsNone(gi.change_problem(signed, {**signed, "status": "Voided", "void_reason": "Rejected"}))
		approved = {**signed, "status": "Approved"}
		# An Approved Work Order invoice may still be rejected (#1531); that voids its generated one (#1547).
		self.assertIsNone(gi.change_problem(approved, {**approved, "status": "Voided", "void_reason": "Rejected"}))
		for before, status in ((self.BEFORE, "Approved"), (signed, "Generated"), (approved, "Voided"),
							   (approved, "Signed"), (self._after(status="Voided", void_reason="x"), "Generated")):
			self.assertIsNotNone(gi.change_problem(before, {**before, "status": status}), status)


if __name__ == "__main__":
	unittest.main()
