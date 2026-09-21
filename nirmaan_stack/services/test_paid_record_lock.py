# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt
"""The Paid-payment lock (`services/paid_record_lock.py`): the pure rule, then real saves.

The save tests run against the LIVE site (there is no test database), so every fixture is a raw
`db_insert` inside a transaction whose commits are stubbed and which is rolled back in `tearDown`.
"""

import unittest
from datetime import date

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.services.paid_record_lock import (
	LOCKED_WHEN_PAID,
	changed_locked_fields,
	paid_lock_refusal,
)

PAYMENT = "Project Payments"
PE = "Project Expenses"
NPE = "Non Project Expenses"


class TestPaidLockRule(unittest.TestCase):
	def _pair(self, before_status="Paid", after_status="Paid", **changes):
		before = {
			"status": before_status,
			"amount": 1000.0,
			"payment_date": date(2026, 9, 1),
			"utr": "UTR-1",
			"cheque_no": None,
			"cheque_date": None,
			"payment_attachment": "/private/files/proof.pdf",
			"payment_ref": "REF-1",
		}
		after = {**before, "status": after_status, **changes}
		return before, after

	def test_every_locked_payment_field_is_caught(self):
		values = {
			"amount": 2000,
			"utr": "UTR-2",
			"payment_date": "2026-09-02",
			"cheque_no": "000123",
			"cheque_date": "2026-09-02",
			"payment_attachment": "/private/files/other.pdf",
		}
		for field in LOCKED_WHEN_PAID[PAYMENT]:
			with self.subTest(field=field):
				self.assertEqual(changed_locked_fields(PAYMENT, *self._pair(**{field: values[field]})), [field])

	def test_the_expense_ledgers_carry_no_server_lock(self):
		"""Owner, 2026-09-21: Paid expenses are still corrected by hand in Desk. The app's edit
		dialogs lock Amount / Payment Date / Payment Ref; the server must not."""
		self.assertNotIn(PE, LOCKED_WHEN_PAID)
		self.assertNotIn(NPE, LOCKED_WHEN_PAID)
		for doctype in (PE, NPE):
			with self.subTest(doctype=doctype):
				before, after = self._pair(amount=5, payment_date="2026-09-09", payment_ref="X")
				self.assertEqual(changed_locked_fields(doctype, before, after), [])

	def test_only_a_save_that_stays_paid_is_judged(self):
		for before_status, after_status in (
			("Approved", "Approved"),
			("Reconciliation Pending", "Paid"),  # arriving: Mark Reconciled writes these fields
			("Paid", "Approved"),  # leaving: unreconcile
			("Requested", "Requested"),
		):
			with self.subTest(before=before_status, after=after_status):
				before, after = self._pair(before_status, after_status, amount=5, utr="X")
				self.assertEqual(changed_locked_fields(PAYMENT, before, after), [])

	def test_equivalent_representations_are_not_a_change(self):
		"""The REST API hands strings back; the stored row holds typed values. Neither is an edit."""
		before, after = self._pair(amount="1000", payment_date="2026-09-01", utr="  UTR-1 ")
		self.assertEqual(changed_locked_fields(PAYMENT, before, after), [])
		before, after = self._pair(cheque_no="")  # None and "" are the same blank
		self.assertEqual(changed_locked_fields(PAYMENT, before, after), [])

	def test_no_before_state_passes(self):
		_, after = self._pair(amount=9)
		self.assertEqual(changed_locked_fields(PAYMENT, None, after), [])

	def test_the_refusal_names_the_fields(self):
		before, after = self._pair(amount=2, utr="R")
		self.assertEqual(
			paid_lock_refusal(PAYMENT, before, after),
			"This payment is Paid, so Amount, UTR can no longer be changed.",
		)
		self.assertIsNone(paid_lock_refusal(PAYMENT, *self._pair()))


def _raw(doctype, **fields):
	doc = frappe.new_doc(doctype)
	doc.update(fields)
	doc.name = frappe.generate_hash(length=12)
	doc.db_insert()
	return doc.name


class TestPaidLockOnSave(FrappeTestCase):
	"""The rule reaches every write path through `Project Payments.validate`."""

	def setUp(self):
		# Hooks commit; stubbing keeps every fixture inside the transaction rolled back below.
		self._real_commit = frappe.db.commit
		frappe.db.commit = lambda *a, **k: None
		self.po = _raw("Procurement Orders", total_amount=100000, amount_paid=0)

	def tearDown(self):
		frappe.db.commit = self._real_commit
		frappe.db.rollback()

	def _paid_payment(self):
		return _raw(
			PAYMENT,
			document_type="Procurement Orders",
			document_name=self.po,
			amount=1000,
			status="Paid",
			utr="UTR-1",
			payment_date="2026-09-01",
			payment_attachment="/private/files/proof.pdf",
			mode_of_payment="Online",
		)

	def test_a_paid_payment_refuses_every_locked_field(self):
		for field, value in (
			("amount", 2000),
			("utr", "UTR-2"),
			("payment_date", "2026-09-05"),
			("payment_attachment", "/private/files/new.pdf"),
		):
			with self.subTest(field=field):
				doc = frappe.get_doc(PAYMENT, self._paid_payment())
				doc.set(field, value)
				with self.assertRaises(frappe.ValidationError):
					doc.save(ignore_permissions=True)

	def test_the_bank_import_may_still_write_them(self):
		doc = frappe.get_doc(PAYMENT, self._paid_payment())
		doc.utr = "BANK-NARRATION"
		doc.flags.from_outflow_import = True
		doc.save(ignore_permissions=True)
		self.assertEqual(frappe.db.get_value(PAYMENT, doc.name, "utr"), "BANK-NARRATION")

	def test_a_paid_expense_is_still_editable_on_the_server(self):
		"""The Desk path the owner relies on (2026-09-21)."""
		for doctype in (PE, NPE):
			with self.subTest(doctype=doctype):
				name = _raw(
					doctype,
					status="Paid",
					amount=1000,
					description="Fixture",
					payment_date="2026-09-01",
					payment_ref="REF-1",
				)
				doc = frappe.get_doc(doctype, name)
				doc.amount = 1200
				doc.payment_ref = "REF-2"
				doc.save(ignore_permissions=True)
				self.assertEqual(float(frappe.db.get_value(doctype, name, "amount")), 1200)
