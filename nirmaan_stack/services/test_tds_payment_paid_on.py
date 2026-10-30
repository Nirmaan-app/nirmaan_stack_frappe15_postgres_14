# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""`Payment TDS Deduction.payment_date` -- "Payment Paid On" (owner 2026-10-29).

⚠️ "TDS" HERE IS TAX DEDUCTED AT SOURCE, not a Technical Data Sheet.

The rules under test (GLOSSARY "Payment Paid On (on a TDS record)"):
  * filled only while the payment / Office Rent expense is Paid -- not at Approved, not at
    Reconciliation Pending, even when the payment already carries a date there;
  * follows a corrected payment date, even once the tax is in a challan;
  * cleared when the payment leaves Paid;
  * the one-time patch fills Paid rows only, never overwrites a date, and touches no other row.

Work Order payments go through `TaxedWorkOrderFixture` (real CEO approval, real fulfil endpoint; it
commits and purges only its own `TEST-TWO-*` rows). Office Rent goes through `OfficeRentCase` (real
endpoints inside one rolled-back transaction).

Run:
  bench --site localhost run-tests --module nirmaan_stack.services.test_tds_payment_paid_on
"""

import json

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.expense_requests.test_office_rent_tds import ACCOUNTANT, OfficeRentCase
from nirmaan_stack.api.outflow_import.link_lines import link_rows_to_expense
from nirmaan_stack.api.outflow_import.unreconcile import unreconcile_row
from nirmaan_stack.api.payments.project_payments import update_payment_request
from nirmaan_stack.api.payments.taxed_work_order_fixture import TaxedWorkOrderFixture
from nirmaan_stack.patches.v3_0.backfill_payment_tds_payment_date import execute as backfill
from nirmaan_stack.services import payment_tds

TDS = "Payment TDS Deduction"
PAYMENT = "Project Payments"
NPE = "Non Project Expenses"


def _fulfil(taxed, payment, pay_date):
	"""Mark as Done, then the real fulfil endpoint: Reconciliation Pending -> Paid.

	⚠️ NEVER FULFIL STRAIGHT FROM Approved HERE. `project_payments.on_update`'s Approved -> Paid branch
	notifies every admin on the LIVE site and commits per recipient; Reconciliation Pending -> Paid
	sends nothing."""
	taxed.mark_as_done(payment)
	update_payment_request(json.dumps({
		"action": "fulfil", "name": payment, "utr": f"UTR{frappe.generate_hash(length=10)}",
		"pay_date": pay_date,
	}))
	frappe.db.commit()


def _paid_on(deduction):
	value = frappe.db.get_value(TDS, deduction, "payment_date")
	return str(value) if value else None


class TestWorkOrderPaymentPaidOn(FrappeTestCase):
	def setUp(self):
		frappe.set_user("Administrator")
		self.taxed = TaxedWorkOrderFixture.attach(self)

	def _fulfil(self, payment, pay_date):
		_fulfil(self.taxed, payment, pay_date)

	def _save(self, payment, **fields):
		doc = frappe.get_doc(PAYMENT, payment)
		doc.update(fields)
		doc.save(ignore_permissions=True)
		frappe.db.commit()

	def test_approved_carries_no_date(self):
		made = self.taxed.payment()
		self.assertIsNone(_paid_on(made.deduction))

	def test_reconciliation_pending_with_a_date_on_the_payment_still_carries_none(self):
		"""Q1: Paid only. A payment marked done may already hold a date; the record must not take it."""
		made = self.taxed.payment()
		self.taxed.mark_as_done(made.name)
		self._save(made.name, payment_date="2026-10-02")
		self.assertIsNone(_paid_on(made.deduction))

	def test_fulfilled_to_paid_copies_the_payment_date(self):
		made = self.taxed.payment()
		self._fulfil(made.name, "2026-10-05")
		self.assertEqual(frappe.db.get_value(PAYMENT, made.name, "status"), "Paid")
		self.assertEqual(_paid_on(made.deduction), "2026-10-05")

	def test_a_corrected_date_on_a_paid_payment_follows(self):
		made = self.taxed.payment()
		self._fulfil(made.name, "2026-09-30")
		self._save(made.name, payment_date="2026-10-02")
		self.assertEqual(_paid_on(made.deduction), "2026-10-02")

	def test_a_corrected_date_follows_even_once_the_tax_is_in_a_challan(self):
		"""Q3: the record is a copy of the payment's date, challan or not."""
		made = self.taxed.payment()
		self._fulfil(made.name, "2026-09-30")
		# A fixture write standing in for Pay TDS: the deduction now names a challan.
		frappe.db.set_value(TDS, made.deduction, {"tds_challan": "TEST-TWO-CHALLAN", "status": "Paid"},
		                    update_modified=False)
		self._save(made.name, payment_date="2026-10-02")
		self.assertEqual(_paid_on(made.deduction), "2026-10-02")

	def test_leaving_paid_clears_it(self):
		"""What Unreconcile writes: back to Reconciliation Pending, date cleared."""
		made = self.taxed.payment()
		self._fulfil(made.name, "2026-10-05")
		self._save(made.name, status="Reconciliation Pending", payment_date=None, utr=None)
		self.assertIsNone(_paid_on(made.deduction))

	def test_leaving_paid_clears_it_even_if_the_payment_keeps_its_date(self):
		made = self.taxed.payment()
		self._fulfil(made.name, "2026-10-05")
		self._save(made.name, status="Reconciliation Pending")
		self.assertIsNone(_paid_on(made.deduction))

	def test_a_blank_payment_tds_mirror_still_finds_the_record(self):
		made = self.taxed.payment()
		frappe.db.set_value(PAYMENT, made.name, "payment_tds", None, update_modified=False)
		frappe.db.commit()
		self._fulfil(made.name, "2026-10-07")
		self.assertEqual(_paid_on(made.deduction), "2026-10-07")

	def test_a_save_that_moves_neither_status_nor_date_leaves_the_record_alone(self):
		made = self.taxed.payment()
		self._fulfil(made.name, "2026-10-05")
		frappe.db.set_value(TDS, made.deduction, "payment_date", "2001-01-01", update_modified=False)
		frappe.db.commit()
		self._save(made.name, utr=f"UTR{frappe.generate_hash(length=10)}")
		self.assertEqual(_paid_on(made.deduction), "2001-01-01")

	def test_the_sync_does_not_move_the_record_modified(self):
		made = self.taxed.payment()
		before = frappe.db.get_value(TDS, made.deduction, "modified")
		self._fulfil(made.name, "2026-10-05")
		self.assertEqual(frappe.db.get_value(TDS, made.deduction, "modified"), before)

	def test_a_deduction_written_on_a_payment_already_paid_carries_the_date_at_once(self):
		made = self.taxed.payment()
		self._fulfil(made.name, "2026-10-08")
		# Take the record away, then write it again on the now-Paid payment (#1509's path).
		frappe.db.delete(TDS, {"name": made.deduction})
		frappe.db.set_value(PAYMENT, made.name, {"payment_tds": None, "amount": made.gross}, update_modified=False)
		frappe.db.commit()
		doc = frappe.get_doc(PAYMENT, made.name)
		name = payment_tds.write_deduction(doc, tds_amount=made.tds, tds_percentage=2)
		frappe.db.commit()
		self.assertEqual(_paid_on(name), "2026-10-08")


class TestBackfillPatch(FrappeTestCase):
	def setUp(self):
		frappe.set_user("Administrator")
		self.taxed = TaxedWorkOrderFixture.attach(self)

	def _others_with_a_date(self, mine):
		# Raw SQL: Frappe's `["is", "set"]` renders `<> ''`, which PostgreSQL refuses on a date column.
		return frappe.db.sql(
			f'select count(*) from "tab{TDS}" where payment_date is not null and name not in %(mine)s',
			{"mine": tuple(mine)},
		)[0][0]

	def test_fills_paid_only_never_overwrites_and_touches_nothing_else(self):
		paid = self.taxed.payment()
		approved = self.taxed.payment(project=paid.project, vendor=paid.vendor)
		kept = self.taxed.payment(project=paid.project, vendor=paid.vendor)
		_fulfil(self.taxed, paid.name, "2026-10-03")
		_fulfil(self.taxed, kept.name, "2026-10-04")
		mine = [paid.deduction, approved.deduction, kept.deduction]
		# As a row looked before the field existed; `kept` holds a date the patch must not touch.
		frappe.db.set_value(TDS, paid.deduction, "payment_date", None, update_modified=False)
		frappe.db.set_value(TDS, kept.deduction, "payment_date", "2001-01-01", update_modified=False)
		frappe.db.commit()
		others = self._others_with_a_date(mine)

		backfill()
		backfill()  # a re-run changes nothing
		frappe.db.commit()

		self.assertEqual(_paid_on(paid.deduction), "2026-10-03")
		self.assertIsNone(_paid_on(approved.deduction))
		self.assertEqual(_paid_on(kept.deduction), "2001-01-01")
		self.assertEqual(self._others_with_a_date(mine), others)


class TestOfficeRentPaidOn(OfficeRentCase):
	def _paid_rent(self):
		_request, name = self._raise(100000)
		self._approve_by_admin_then_ceo(name)
		[record] = self._records(name)
		self.assertIsNone(_paid_on(record.name), "Approved: no date")
		self.assertEqual(self._decide(ACCOUNTANT, name, "mark_done")["statuses"], {name: "Reconciliation Pending"})
		self.assertIsNone(_paid_on(record.name), "Reconciliation Pending: no date")
		line = self._bank_line(90000)
		link_rows_to_expense(rows=json.dumps([line]), target_doctype=NPE, target_name=name)
		return name, record.name, line

	def test_a_bank_line_settling_it_copies_the_expense_date(self):
		name, record, _line = self._paid_rent()
		expense = frappe.db.get_value(NPE, name, ["status", "payment_date"], as_dict=True)
		self.assertEqual(expense.status, "Paid")
		self.assertTrue(expense.payment_date)
		self.assertEqual(_paid_on(record), str(expense.payment_date))

	def test_unreconciling_clears_it(self):
		name, record, line = self._paid_rent()
		unreconcile_row(row=line, legs="all", reason="test: wrong line")
		self.assertEqual(frappe.db.get_value(NPE, name, "status"), "Reconciliation Pending")
		self.assertIsNone(_paid_on(record))

	def test_the_patch_fills_a_paid_rent_record(self):
		name, record, _line = self._paid_rent()
		frappe.db.set_value(TDS, record, "payment_date", None, update_modified=False)
		backfill()
		self.assertEqual(_paid_on(record), str(frappe.db.get_value(NPE, name, "payment_date")))
