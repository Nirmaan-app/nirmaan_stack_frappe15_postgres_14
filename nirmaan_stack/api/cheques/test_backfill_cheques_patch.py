# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The one-time backfill: a Cheque for every old cheque payment (#1419, spec #1407).

Drives the patch's entry function (`backfill_cheques`) on planted payments only, the way `execute`
runs it over the whole ledger, and reads back what a user then sees: the Cheques, their lines and
history, and each payment's Cheque link.

⚠️ RUNS AGAINST THE ENV DATABASE (the Cheque insert saves payments). Projects, vendors, Work Orders and
payments come from `TaxedWorkOrderFixture`; every planted cheque number starts with TESTCHQ, so
`ChequeFixture` purges the Cheques the backfill makes.
"""

from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import add_days, flt, nowdate

from nirmaan_stack.api.cheques.cheque_fixture import ChequeFixture
from nirmaan_stack.api.cheques.cheque_status import clear_cheque
from nirmaan_stack.api.payments.taxed_work_order_fixture import TaxedWorkOrderFixture
from nirmaan_stack.patches.v3_0.backfill_cheques_from_cheque_payments import backfill_cheques
from nirmaan_stack.services.cheques.rules import MADE_FROM_PO_WO_PAGE, ChequeHeader
from nirmaan_stack.services.cheques.writer import create_cheque

U = "Administrator"
#: A second requester, present on every site.
OTHER = "Guest"
PAYMENT = "Project Payments"
SR = "Service Requests"
CONTROLLER = "nirmaan_stack.integrations.controllers.project_payments"


class TestBackfillCheques(FrappeTestCase):
    def setUp(self):
        frappe.set_user(U)
        self.fx = TaxedWorkOrderFixture.attach(self)
        self.cheques = ChequeFixture.attach(self)
        self.vendor = self.fx.vendor(2.0)
        self.project = self.fx.project()
        self.sr = self.fx.service_request(self.project, self.vendor)
        frappe.db.commit()
        quiet = patch(f"{CONTROLLER}._notify_admins_auto_approved")
        quiet.start()
        self.addCleanup(quiet.stop)
        self.planted = []

    def tearDown(self):
        frappe.db.rollback()
        frappe.set_user(U)

    # -- planting -------------------------------------------------------------------------------
    def _plant(self, status, cheque_no, *, amount=20000, owner=U, days_ago=0, cheque_date=None, sr=None, mode="Cheque"):
        """An old cheque payment, as the ledger holds one today: mode Cheque, a number and date typed
        on it, no Cheque link. `days_ago` sets when it was requested."""
        name = self.cheques.plant_payment(
            self.fx, status, project=self.project, vendor=self.vendor, document=(SR, sr or self.sr), amount=amount,
            cheque_no=cheque_no if mode == "Cheque" else None, cheque_date=cheque_date, owner=owner,
            days_ago=days_ago,
        )
        self.planted.append(name)
        return name

    def _backfill(self):
        result = backfill_cheques(payments=self.planted)
        frappe.db.commit()
        for made in result["made"]:
            self.cheques.track(made["cheque"])
        return result

    def _cheque_of(self, payment):
        return frappe.db.get_value(PAYMENT, payment, "cheque")

    def _cheque(self, name):
        return frappe.get_doc("Cheques", name)

    # -- one Cheque per number ------------------------------------------------------------------
    def test_payments_sharing_a_number_become_one_cheque_with_a_line_each(self):
        number = self.cheques.number()
        first = self._plant("Paid", number, amount=20000, owner=OTHER, days_ago=5)
        second = self._plant("Requested", f" {number} ", amount=30000, days_ago=1)

        self._backfill()

        name = self._cheque_of(first)
        self.assertTrue(name)
        self.assertEqual(self._cheque_of(second), name)
        cheque = self._cheque(name)
        self.assertEqual(cheque.cheque_no, number)
        self.assertEqual(cheque.bank, "ICICI Bank")
        self.assertEqual(cheque.vendor, self.vendor)
        self.assertEqual(str(cheque.cheque_date), add_days(nowdate(), -5))
        self.assertEqual(flt(cheque.amount), 50000)
        self.assertEqual(cheque.made_from, MADE_FROM_PO_WO_PAGE)
        self.assertFalse(cheque.attachment)
        self.assertEqual(cheque.owner, OTHER)  # the earliest payment's requester
        self.assertEqual(cheque.status, "Issued")
        self.assertEqual(
            [(l.payment_name, flt(l.amount), l.project, l.record_name) for l in cheque.lines],
            [(first, 20000, self.project, self.sr), (second, 30000, self.project, self.sr)],
        )
        self.assertEqual([(h.from_status, h.to_status) for h in cheque.status_history], [(None, "Issued")])
        for payment in (first, second):
            self.assertEqual(frappe.db.get_value(PAYMENT, payment, ["mode_of_payment", "cheque_no"]), ("Cheque", number))

    # -- status ---------------------------------------------------------------------------------
    def test_a_cheque_whose_payments_are_all_paid_is_cleared(self):
        number = self.cheques.number()
        payments = [self._plant("Paid", number, days_ago=2), self._plant("Paid", number, days_ago=1)]
        self._backfill()
        cheque = self._cheque(self._cheque_of(payments[0]))
        self.assertEqual(cheque.status, "Cleared")
        self.assertEqual([h.to_status for h in cheque.status_history], ["Cleared"])
        self.assertEqual([l.payment_name for l in cheque.lines], payments)

    def test_a_cheque_whose_payments_are_all_rejected_is_cancelled_with_a_line_each(self):
        number = self.cheques.number()
        payments = [self._plant("Rejected", number, days_ago=2), self._plant("Rejected", number, days_ago=1)]
        self._backfill()
        cheque = self._cheque(self._cheque_of(payments[0]))
        self.assertEqual(cheque.status, "Cancelled")
        self.assertEqual([l.payment_name for l in cheque.lines], payments)
        self.assertEqual(flt(cheque.amount), 40000)
        self.assertEqual(self._cheque_of(payments[1]), cheque.name)

    def test_rejected_payments_are_left_off_a_mixed_cheque_but_still_linked(self):
        number = self.cheques.number()
        rejected = self._plant("Rejected", number, amount=5000, days_ago=3)
        paid = self._plant("Paid", number, amount=20000, days_ago=2)
        approved = self._plant("Approved", number, amount=30000, days_ago=1)
        self._backfill()
        cheque = self._cheque(self._cheque_of(paid))
        self.assertEqual(cheque.status, "Issued")
        self.assertEqual([l.payment_name for l in cheque.lines], [paid, approved])
        self.assertEqual(flt(cheque.amount), 50000)
        self.assertEqual(self._cheque_of(rejected), cheque.name)
        self.assertIn(rejected, cheque.status_history[0].note)
        # nothing moves: the Approved cheque payment is not sent on to Reconciliation Pending here
        self.assertEqual(frappe.db.get_value(PAYMENT, approved, "status"), "Approved")

    def test_paid_and_rejected_payments_make_a_cleared_cheque(self):
        number = self.cheques.number()
        rejected = self._plant("Rejected", number, days_ago=2)
        paid = self._plant("Paid", number, days_ago=1)
        self._backfill()
        cheque = self._cheque(self._cheque_of(paid))
        self.assertEqual(cheque.status, "Cleared")
        self.assertEqual([l.payment_name for l in cheque.lines], [paid])
        self.assertEqual(self._cheque_of(rejected), cheque.name)

    def test_a_cancelled_cheque_of_rejected_payments_cannot_be_cleared_by_hand(self):
        rejected = self._plant("Rejected", self.cheques.number())
        self._backfill()
        name = self._cheque_of(rejected)
        with self.assertRaisesRegex(frappe.ValidationError, "it is Cancelled: its payments are Rejected"):
            clear_cheque(name, nowdate())
        frappe.db.rollback()
        self.assertEqual(self._cheque(name).status, "Cancelled")

    # -- once only, and nothing else ------------------------------------------------------------
    def _snapshot(self):
        cheques = frappe.get_all("Cheques", filters={"cheque_no": ["like", "TESTCHQ%"]}, fields=["name", "modified"])
        payments = frappe.get_all(PAYMENT, filters={"name": ["in", self.planted]}, fields=["name", "modified", "cheque"])
        return sorted(map(tuple, (c.values() for c in cheques))), sorted(map(tuple, (p.values() for p in payments)))

    def test_a_second_run_makes_nothing_and_changes_nothing(self):
        self._plant("Paid", self.cheques.number(), days_ago=1)
        number = self.cheques.number()
        self._plant("Rejected", number, days_ago=1)
        self._plant("Approved", number)
        first = self._backfill()
        self.assertEqual(len(first["made"]), 2)
        before = self._snapshot()

        second = self._backfill()

        self.assertEqual(second, {"made": [], "skipped": []})
        self.assertEqual(self._snapshot(), before)

    def test_an_online_payment_gets_no_cheque(self):
        online = self._plant("Paid", None, mode="Online")
        self.assertEqual(self._backfill(), {"made": [], "skipped": []})
        self.assertIsNone(self._cheque_of(online))

    def test_a_number_already_on_a_cheque_is_skipped_and_the_rest_still_made(self):
        taken = self.cheques.number()
        self.cheques.track(create_cheque(
            ChequeHeader(bank="ICICI Bank", bank_name=None, cheque_no=taken, cheque_date=nowdate(), amount=100,
                         vendor=self.vendor, payee_name=None, description="rent",
                         attachment="https://storage.example.invalid/private/files/cheque-test.jpg"),
            user=U, made_from="Report",
        ).name)
        frappe.db.commit()
        refused = self._plant("Approved", taken, days_ago=1)
        fine = self._plant("Approved", self.cheques.number())

        result = self._backfill()

        self.assertEqual([s["payments"] for s in result["skipped"]], [[refused]])
        self.assertIn("already recorded", result["skipped"][0]["reason"])
        self.assertIsNone(self._cheque_of(refused))
        self.assertTrue(self._cheque_of(fine))
