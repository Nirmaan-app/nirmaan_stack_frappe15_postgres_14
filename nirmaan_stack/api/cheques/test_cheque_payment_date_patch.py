# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The one-time patch that makes a Cleared cheque's Cheque/Payment Date its clearance date (#1520, spec #1514).

Drives the patch's entry function (`copy_clearance_dates`) on planted Cheques, the way `execute` runs it over
every Cheque, and reads back each Cheque's Cheque/Payment Date and what the patch reports.

Each planted Cheque is made through the cheques service with its paper date, then given its pre-#1520
clearance date with a raw write: the `clearance_date` field is gone from the doctype, but Frappe's migrate
never drops a removed field's column, so the old values are still in it. That is the old data the patch meets.

⚠️ RUNS AGAINST THE ENV DATABASE. Every planted cheque number starts with TESTCHQ, so `ChequeFixture` purges
the Cheques.
"""

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.cheques.cheque_fixture import ChequeFixture
from nirmaan_stack.patches.v3_0.cheque_date_from_clearance_date import copy_clearance_dates, summary

U = "Administrator"
PHOTO = "https://storage.example.invalid/private/files/cheque-test.jpg"
PAPER = "2026-09-01"
CLEARED_ON = "2026-09-12"


class TestChequePaymentDatePatch(FrappeTestCase):
    def setUp(self):
        frappe.set_user(U)
        if not frappe.db.has_column("Cheques", "clearance_date"):
            self.skipTest("this database never had Cheques.clearance_date: there is nothing to copy")
        self.cheques = ChequeFixture.attach(self)
        self.planted = []

    def tearDown(self):
        frappe.db.rollback()

    # -- planting -------------------------------------------------------------------------------
    def _cheque(self, status, clearance_date=None, *, cheque_type="Payment"):
        """A Cheque as the ledger holds one before #1520: dated `PAPER`, at `status`, with `clearance_date`."""
        name = self.cheques.plant_cheque(
            status="Issued", bank="ICICI Bank", cheque_no=self.cheques.number(), cheque_date=PAPER,
            amount=5000, payee_name="Ravi Kumar", description="Rent", attachment=PHOTO,
        )
        # Raw on purpose: this plants old data, in a column the doctype no longer has.
        frappe.db.sql(
            'UPDATE "tabCheques" SET status = %s, cheque_type = %s, clearance_date = %s WHERE name = %s',
            (status, cheque_type, clearance_date, name),
        )
        frappe.db.commit()
        self.planted.append(name)
        return name

    def _copy(self):
        result = copy_clearance_dates(cheques=self.planted)
        frappe.db.commit()
        return result

    def _date(self, name):
        return str(frappe.db.get_value("Cheques", name, "cheque_date"))

    # -- the copy ---------------------------------------------------------------------------------
    def test_a_cleared_cheque_takes_its_clearance_date(self):
        name = self._cheque("Cleared", CLEARED_ON)
        modified = frappe.db.get_value("Cheques", name, "modified")

        result = self._copy()

        self.assertEqual(self._date(name), CLEARED_ON)
        self.assertEqual([(c["cheque"], c["from_date"], c["to_date"]) for c in result["changed"]],
                         [(name, PAPER, CLEARED_ON)])
        self.assertEqual(frappe.db.get_value("Cheques", name, "modified"), modified)

    def test_an_issued_cheque_keeps_its_paper_date(self):
        # Even with a stray clearance date: only a Cleared cheque was paid by the bank.
        name = self._cheque("Issued", CLEARED_ON)
        result = self._copy()
        self.assertEqual((self._date(name), result["changed"]), (PAPER, []))

    def test_a_deposit_cheque_and_a_pending_one_keep_their_paper_date(self):
        deposit = self._cheque("Issued", cheque_type="Security Deposit")
        pending = self._cheque("Approval Pending")
        self._copy()
        self.assertEqual([self._date(deposit), self._date(pending)], [PAPER, PAPER])

    def test_a_cleared_cheque_with_no_clearance_date_keeps_its_date_and_is_listed(self):
        name = self._cheque("Cleared")
        result = self._copy()
        self.assertEqual(self._date(name), PAPER)
        self.assertEqual([c["cheque"] for c in result["no_clearance_date"]], [name])

    # -- once only, and it says what it did -------------------------------------------------------
    def test_a_second_run_changes_nothing(self):
        cleared = self._cheque("Cleared", CLEARED_ON)
        self._cheque("Issued")
        self._copy()

        second = self._copy()

        self.assertEqual(second["changed"], [])
        self.assertEqual(self._date(cleared), CLEARED_ON)

    def test_the_summary_names_every_cheque_it_changed(self):
        cleared = self._cheque("Cleared", CLEARED_ON)
        undated = self._cheque("Cleared")
        number = frappe.db.get_value("Cheques", cleared, "cheque_no")

        text = "\n".join(summary(self._copy()))

        self.assertIn("1 Cleared Cheque(s) given their clearance date", text)
        self.assertIn(f"{cleared} ({number}): {PAPER} -> {CLEARED_ON}", text)
        self.assertIn(f"{undated}", text)
