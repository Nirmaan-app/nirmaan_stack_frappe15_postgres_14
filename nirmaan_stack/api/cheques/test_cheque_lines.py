# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""A Payment cheque's PO lines and the payments it takes: the rules every write holds (#1410, spec #1407;
#1482, spec #1477; spec #1514).

The Cheque Tracker makes no cheque since spec #1514, so a new Payment cheque comes only from a PO's
Request Payment, with one line. Cheques recorded before may pay several POs and hold a line with no
payment yet. Every save of a Cheque still runs the `validate` controller's line rules (`lines.py`), so
this suite plants Pending cheques through the Cheque document (`ChequeFixture.plant_cheque`) and reads
back what a user sees: the Cheque, its status, issue date and lines, each payment's link, mode, cheque
number, date and status, or the refusal. Approvals after the save go through their real routes (the L1
approve of a cheque's payments, the CEO endpoint).

⚠️ RUNS AGAINST THE ENV DATABASE (the endpoints commit). Projects, vendors and payments come from
`TaxedWorkOrderFixture`, POs from `ChequeFixture.plant_po`; every Cheque carries a TESTCHQ number and is
purged by `ChequeFixture`.
"""

from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import add_days, flt, nowdate

from nirmaan_stack.api.cheques.cheque_fixture import ChequeFixture
from nirmaan_stack.api.payments.cheque_approval import approve_cheque_payments
from nirmaan_stack.api.payments.project_payments import ceo_approve_payment
from nirmaan_stack.api.payments.taxed_work_order_fixture import TaxedWorkOrderFixture
from nirmaan_stack.constants.authorized_users import CEO_AUTHORIZED_USER
from nirmaan_stack.services.cheques.rules import ISSUED, PENDING

U = "Administrator"
PAYMENT = "Project Payments"
PO = "Procurement Orders"
LINE = "PO/WO Payment"
RECON = "Reconciliation Pending"
PHOTO = "https://storage.example.invalid/private/files/cheque-test.jpg"
CONTROLLER = "nirmaan_stack.integrations.controllers.project_payments"


class TestChequeLines(FrappeTestCase):
    def setUp(self):
        frappe.set_user(U)
        self.fx = TaxedWorkOrderFixture.attach(self)
        self.cheques = ChequeFixture.attach(self)
        self.vendor = self.fx.vendor(2.0)
        self.project = self.fx.project()
        self.other_project = self.fx.project()
        self.po = self._po(self.project)
        self.other_po = self._po(self.other_project)
        frappe.db.commit()  # a refusal below rolls back; the planted rows must outlive it
        for target in ("_notify_admins_auto_approved", "PrNotification"):
            quiet = patch(f"{CONTROLLER}.{target}")
            quiet.start()
            self.addCleanup(quiet.stop)

    def tearDown(self):
        frappe.set_user(U)

    # -- planting -------------------------------------------------------------------------------
    def _po(self, project, vendor=None, status="Delivered"):
        return ChequeFixture.plant_po(self, self.fx, project=project, vendor=vendor or self.vendor, status=status)

    def _plant(self, status, *, amount=20000, po=None, approved_on=None):
        """An Online payment of a PO (`self.po` unless given) already at `status` (raw insert: no hook runs)."""
        po = po or self.po
        name = self.cheques.plant_payment(
            self.fx, status, project=frappe.db.get_value(PO, po, "project"), vendor=self.vendor,
            document=(PO, po), amount=amount,
        )
        if approved_on:
            frappe.db.set_value(PAYMENT, name, "approval_date", approved_on, update_modified=False)
            frappe.db.commit()
        return name

    # -- driving --------------------------------------------------------------------------------
    def _line(self, payment=None, *, po=None, project=None, amount=None):
        po = po or self.po
        line = {"line_type": LINE, "project": project or frappe.db.get_value(PO, po, "project"),
                "record_doctype": PO, "record_name": po}
        if payment:
            line["payment_name"] = payment
        if amount is not None:
            line["amount"] = amount
        return line

    def _save(self, lines, **overrides):
        values = {
            "bank": "ICICI Bank",
            "cheque_no": self.cheques.number(),
            "cheque_date": nowdate(),
            "amount": 50000,
            "vendor": self.vendor,
            "attachment": PHOTO,
        }
        values.update(overrides)
        return self.cheques.plant_cheque(status=PENDING, lines=lines, **{k: v for k, v in values.items() if v is not None})

    def _refused(self, phrase, lines, **overrides):
        with self.assertRaisesRegex(frappe.ValidationError, phrase):
            self._save(lines, **overrides)
        frappe.db.rollback()

    def _payment(self, name):
        return frappe.db.get_value(
            PAYMENT, name, ["status", "mode_of_payment", "cheque", "cheque_no", "cheque_date"], as_dict=True
        )

    def _status(self, name):
        return frappe.db.get_value(PAYMENT, name, "status")

    def _cheque(self, name):
        """`(status, issue_date)` of the Cheque."""
        status, issued = frappe.db.get_value("Cheques", name, ["status", "issue_date"])
        return status, str(issued) if issued else None

    def _cancel(self, cheque):
        """Plant a Cancelled Cheque. The status change itself is another suite's; this is only its outcome."""
        # Raw on purpose: it skips the Cheque's `validate` and writes no history row, because this suite
        # tests what a Cancelled Cheque's lines may do, not the status change. No derived figure reads a
        # Cheque's status, so nothing needs recomputing.
        frappe.db.set_value("Cheques", cheque, "status", "Cancelled")
        frappe.db.commit()

    def _as_ceo(self, fn, *args, **kwargs):
        frappe.set_user(CEO_AUTHORIZED_USER)
        try:
            result = fn(*args, **kwargs)
            frappe.db.commit()
            return result
        finally:
            frappe.set_user(U)

    # -- saving lines ---------------------------------------------------------------------------
    def test_a_cheque_keeps_po_lines_across_pos_and_projects(self):
        first = self._plant("Requested", amount=30000)
        second = self._plant("Requested", amount=15000, po=self.other_po)
        name = self._save([self._line(first), self._line(second, po=self.other_po), self._line(amount=5000)])

        lines = frappe.get_all(
            "Cheque Line",
            filters={"parent": name, "parenttype": "Cheques"},
            fields=["line_type", "project", "record_doctype", "record_name", "payment_doctype", "payment_name", "amount"],
            order_by="idx asc",
        )
        self.assertEqual(
            [(l.project, l.record_name, l.payment_doctype, l.payment_name, flt(l.amount)) for l in lines],
            [
                (self.project, self.po, PAYMENT, first, 30000.0),  # the amount comes from the payment
                (self.other_project, self.other_po, PAYMENT, second, 15000.0),
                (self.project, self.po, None, None, 5000.0),  # no payment yet: the typed amount
            ],
        )
        self.assertEqual(self._cheque(name), (PENDING, None))

    def test_each_po_must_be_the_cheques_vendors_and_in_its_lines_project(self):
        stranger_po = self._po(self.project, self.fx.vendor())
        self._refused(
            f"Line 1: {stranger_po} is not a PO or Work Order of this cheque's Vendor",
            [self._line(po=stranger_po, amount=100)],
        )
        self._refused(
            f"Line 1: {self.po} is not in project {self.other_project}",
            [self._line(project=self.other_project, amount=100)],
        )

    def test_each_payment_must_belong_to_its_lines_po(self):
        other = self._plant("Requested", po=self.other_po)
        self._refused(f"Line 1: payment {other} is not a payment of {self.po}", [self._line(other)])

    def test_a_rejected_payment_is_refused(self):
        pay = self._plant("Rejected")
        self._refused(f"Line 1: payment {pay} is Rejected", [self._line(pay)])
        self.assertEqual(self._payment(pay).mode_of_payment, "Online")

    def test_a_payment_sits_on_at_most_one_live_cheque(self):
        pay = self._plant("Requested")
        first = self._save([self._line(pay)])
        number = frappe.db.get_value("Cheques", first, "cheque_no")
        self._refused(f"Line 1: payment {pay} is already on cheque {number} \\({PENDING}\\)", [self._line(pay)])
        self._refused("is on two lines", [self._line(pay), self._line(pay)], cheque_no=self.cheques.number())

    def test_a_payment_only_on_a_cancelled_cheque_can_be_linked_again(self):
        pay = self._plant("Requested")
        first = self._save([self._line(pay)])
        self._cancel(first)

        second = self._save([self._line(pay)])
        state = self._payment(pay)
        self.assertEqual(state.cheque, second)
        self.assertEqual(state.cheque_no, frappe.db.get_value("Cheques", second, "cheque_no"))

    # -- what the save does to the payments -------------------------------------------------------
    def test_a_linked_online_payment_becomes_a_cheque_payment_at_its_step(self):
        pay = self._plant("CEO Pending", amount=60000)
        date = "2026-11-02"
        name = self._save([self._line(pay)], cheque_date=date, amount=60000)

        state = self._payment(pay)
        self.assertEqual(state.mode_of_payment, "Cheque")
        self.assertEqual(state.cheque, name)
        self.assertEqual(state.cheque_no, frappe.db.get_value("Cheques", name, "cheque_no"))
        self.assertEqual(str(state.cheque_date), date)
        self.assertEqual(state.status, "CEO Pending")
        self.assertEqual(self._cheque(name), (PENDING, None))

    def test_approved_payments_issue_the_cheque_at_once_on_their_approval_date(self):
        first = self._plant("Approved", approved_on=add_days(nowdate(), -3))
        second = self._plant("Approved", po=self.other_po, approved_on=add_days(nowdate(), -2))
        name = self._save([self._line(first), self._line(second, po=self.other_po)], amount=40000)

        self.assertEqual((self._status(first), self._status(second)), (RECON, RECON))
        self.assertEqual(self._cheque(name), (ISSUED, add_days(nowdate(), -2)))  # the last approval's day
        history = [(h.from_status, h.to_status) for h in frappe.get_doc("Cheques", name).status_history]
        self.assertEqual(history, [(None, PENDING), (PENDING, ISSUED)])

    def test_requested_waits_then_the_l1_approve_issues_the_cheque(self):
        pay = self._plant("Requested")
        name = self._save([self._line(pay)], amount=20000)
        self.assertEqual((self._status(pay), self._cheque(name)), ("Requested", (PENDING, None)))

        approve_cheque_payments(pay)  # the L1 approve of a cheque payment (#1480)
        self.assertEqual(self._status(pay), RECON)
        self.assertEqual(self._cheque(name), (ISSUED, nowdate()))

    def test_ceo_pending_moves_on_ceo_approval(self):
        pay = self._plant("CEO Pending", amount=60000)
        name = self._save([self._line(pay)], amount=60000)

        self._as_ceo(ceo_approve_payment, pay)
        self.assertEqual(self._status(pay), RECON)
        self.assertEqual(self._cheque(name)[0], ISSUED)
