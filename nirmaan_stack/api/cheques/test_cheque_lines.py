# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""A Payment cheque's PO lines, the payment picker and the payments it takes (#1410, spec #1407; #1482,
spec #1477).

Drives the Cheque Tracker's endpoints against the database the way the Add Cheque dialog does
(`save_cheque` with `lines`, `pickers.get_vendor_records`, `pickers.get_eligible_payments`) and reads
back what a user sees: the Cheque, its status, issue date and lines, each payment's link, mode, cheque
number, date and status, or the refusal. Approvals after the save go through their real routes (the
L1 approve of a cheque's payments, the CEO endpoint).

A Payment cheque pays PO payments only, picked at Requested, CEO Pending or Approved, all at one step.
It saves Pending; picked Approved payments move on to Reconciliation Pending at once, which issues it.

⚠️ RUNS AGAINST THE ENV DATABASE (the endpoints commit). Projects, vendors, Work Orders and payments
come from `TaxedWorkOrderFixture`, POs from `ChequeFixture.plant_po`; every Cheque carries a TESTCHQ
number and is purged by `ChequeFixture`.
"""

from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import add_days, flt, nowdate

from nirmaan_stack.api.cheques.cheque_fixture import ChequeFixture
from nirmaan_stack.api.cheques.pickers import get_eligible_payments, get_vendor_records
from nirmaan_stack.api.cheques.save_cheque import save_cheque
from nirmaan_stack.api.payments.cheque_approval import approve_cheque_payments
from nirmaan_stack.api.payments.project_payments import ceo_approve_payment
from nirmaan_stack.api.payments.taxed_work_order_fixture import TaxedWorkOrderFixture
from nirmaan_stack.constants.authorized_users import CEO_AUTHORIZED_USER

U = "Administrator"
PAYMENT = "Project Payments"
SR = "Service Requests"
PO = "Procurement Orders"
NPE = "Non Project Expenses"
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
        self.sr = self.fx.service_request(self.project, self.vendor)
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

    def _plant(self, status, *, amount=20000, po=None, on_hold=False, approved_on=None, parent=None):
        """An Online payment of a PO (`self.po` unless given) already at `status` (raw insert: no hook runs)."""
        parent_dt, parent_name = parent or (PO, po or self.po)
        name = self.cheques.plant_payment(
            self.fx, status, project=frappe.db.get_value(parent_dt, parent_name, "project"), vendor=self.vendor,
            document=(parent_dt, parent_name), amount=amount, on_hold=on_hold,
        )
        if approved_on:
            frappe.db.set_value(PAYMENT, name, "approval_date", approved_on, update_modified=False)
            frappe.db.commit()
        return name

    # -- driving --------------------------------------------------------------------------------
    def _line(self, payment=None, *, po=None, project=None, amount=None, record_doctype=PO):
        po = po or self.po
        line = {"line_type": LINE, "project": project or frappe.db.get_value(record_doctype, po, "project"),
                "record_doctype": record_doctype, "record_name": po}
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
            "lines": lines,
        }
        values.update(overrides)
        result = save_cheque(**{k: v for k, v in values.items() if v is not None})
        return self.cheques.track(result["cheque"])

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
        """Plant a Cancelled Cheque. The status change itself is another ticket's; this is only its outcome."""
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
    def test_a_cheque_saves_with_po_lines_across_pos_and_projects(self):
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
        self.assertEqual(self._cheque(name), ("Pending", None))

    def test_a_work_order_line_is_refused(self):
        wo_pay = self._plant("Requested", parent=(SR, self.sr))
        self._refused("Line 2: a Payment cheque pays PO payments only",
                      [self._line(amount=100), self._line(wo_pay, po=self.sr, record_doctype=SR)])
        self.assertEqual(self._payment(wo_pay).mode_of_payment, "Online")

    def test_an_expense_line_is_refused(self):
        self._refused("Line 1: a Payment cheque pays PO payments only",
                      [{"line_type": "Non-project Expense", "payment_name": "NPE-ANY", "amount": 100}])

    def test_a_line_with_no_payment_needs_an_amount(self):
        self._refused("Line 1: enter the amount", [self._line()])

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

    # -- which payments, and at one step ----------------------------------------------------------
    def test_a_rejected_reconciliation_pending_or_paid_payment_is_refused(self):
        for status in ("Rejected", RECON, "Paid"):
            pay = self._plant(status)
            self._refused(f"Line 1: payment {pay} is {status}", [self._line(pay)])
            self.assertEqual(self._payment(pay).mode_of_payment, "Online")

    def test_a_held_payment_is_refused(self):
        pay = self._plant("Approved", on_hold=True)
        self._refused(f"Line 1: payment {pay} is on hold", [self._line(pay)])

    def test_payments_at_two_steps_are_refused(self):
        requested = self._plant("Requested")
        approved = self._plant("Approved")
        self._refused(f"same step: {requested} is Requested, {approved} is Approved",
                      [self._line(requested), self._line(approved)])

    def test_a_payment_sits_on_at_most_one_live_cheque(self):
        pay = self._plant("Requested")
        first = self._save([self._line(pay)])
        number = frappe.db.get_value("Cheques", first, "cheque_no")
        self._refused(f"Line 1: payment {pay} is already on cheque {number} \\(Pending\\)", [self._line(pay)])
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
        self.assertEqual(self._cheque(name), ("Pending", None))

    def test_approved_payments_issue_the_cheque_at_once_on_their_approval_date(self):
        first = self._plant("Approved", approved_on=add_days(nowdate(), -3))
        second = self._plant("Approved", po=self.other_po, approved_on=add_days(nowdate(), -2))
        result = save_cheque(
            bank="ICICI Bank", cheque_no=self.cheques.number(), cheque_date=nowdate(), amount=40000,
            vendor=self.vendor, attachment=PHOTO, lines=[self._line(first), self._line(second, po=self.other_po)],
        )
        name = self.cheques.track(result["cheque"])

        self.assertEqual((self._status(first), self._status(second)), (RECON, RECON))
        self.assertEqual(self._cheque(name), ("Issued", add_days(nowdate(), -2)))  # the last approval's day
        self.assertEqual(result["status"], "Issued")
        history = [(h.from_status, h.to_status) for h in frappe.get_doc("Cheques", name).status_history]
        self.assertEqual(history, [(None, "Pending"), ("Pending", "Issued")])

    def test_approved_payments_beside_a_line_with_no_payment_yet_are_refused(self):
        # Saved, the Approved payment would move on alone and the cheque would stay Pending for good.
        approved = self._plant("Approved")
        self._refused("Line 2 has no payment yet, but the cheque's payments are Approved",
                      [self._line(approved), self._line(po=self.other_po, amount=30000)])
        self.assertEqual(self._status(approved), "Approved")

    def test_approved_payments_that_do_not_add_up_to_the_cheque_are_refused(self):
        approved = self._plant("Approved")
        self._refused("add up to ₹20,000, but the cheque is for ₹50,000", [self._line(approved)])
        self.assertEqual(self._payment(approved).mode_of_payment, "Online")

    def test_requested_waits_then_the_l1_approve_issues_the_cheque(self):
        pay = self._plant("Requested")
        name = self._save([self._line(pay)], amount=20000)
        self.assertEqual((self._status(pay), self._cheque(name)), ("Requested", ("Pending", None)))

        approve_cheque_payments(pay)  # the L1 approve of a cheque payment (#1480)
        self.assertEqual(self._status(pay), RECON)
        self.assertEqual(self._cheque(name), ("Issued", nowdate()))

    def test_ceo_pending_moves_on_ceo_approval(self):
        pay = self._plant("CEO Pending", amount=60000)
        name = self._save([self._line(pay)], amount=60000)

        self._as_ceo(ceo_approve_payment, pay)
        self.assertEqual(self._status(pay), RECON)
        self.assertEqual(self._cheque(name)[0], "Issued")

    # -- the pickers ----------------------------------------------------------------------------
    def test_the_payment_picker_offers_the_pickable_steps_and_counts_what_it_hid(self):
        requested = self._plant("Requested", amount=11000)
        ceo = self._plant("CEO Pending", amount=60000)
        approved = self._plant("Approved", amount=12000)
        held = self._plant("Approved", amount=13000, on_hold=True)
        on_live = self._plant("Requested", amount=14000)
        on_cancelled = self._plant("Requested", amount=15000)
        self._plant("Rejected")
        self._plant(RECON)
        self._plant("Paid")
        self._plant("Paid")
        live = self._save([self._line(on_live)])
        self._cancel(self._save([self._line(on_cancelled)]))

        out = get_eligible_payments(PO, self.po)

        self.assertEqual(
            sorted((p["name"], p["status"], p["amount"], p["mode_of_payment"]) for p in out["payments"]),
            sorted([(requested, "Requested", 11000.0, "Online"), (ceo, "CEO Pending", 60000.0, "Online"),
                    (approved, "Approved", 12000.0, "Online"), (on_cancelled, "Requested", 15000.0, "Cheque")]),
        )
        self.assertIsNone(out["step"])
        self.assertEqual(out["hidden"], {
            "on_cheque": [{"payment": on_live, "cheque": live,
                           "cheque_no": frappe.db.get_value("Cheques", live, "cheque_no"), "status": "Pending"}],
            "rejected": 1,
            "other_step": 0,
            "on_hold": 1,
            "moved_on": {RECON: 1, "Paid": 2},
        })
        self.assertNotIn(held, [p["name"] for p in out["payments"]])

    def test_the_payment_picker_offers_only_the_other_lines_step(self):
        picked = self._plant("Requested", po=self.other_po)
        requested = self._plant("Requested")
        self._plant("CEO Pending", amount=60000)
        self._plant("Approved")

        out = get_eligible_payments(PO, self.po, other_payments=f'["{picked}"]')

        self.assertEqual([p["name"] for p in out["payments"]], [requested])
        self.assertEqual((out["step"], out["hidden"]["other_step"]), ("Requested", 2))

    def test_the_payment_picker_keeps_the_edited_cheques_own_payments_but_not_the_other_lines(self):
        pay = self._plant("Requested")
        other = self._plant("Requested")
        cheque = self._save([self._line(pay)])

        offered = [p["name"] for p in get_eligible_payments(PO, self.po, cheque=cheque)["payments"]]
        self.assertEqual(sorted(offered), sorted([pay, other]))
        offered = [p["name"] for p in get_eligible_payments(PO, self.po, cheque=cheque, other_payments=[pay])["payments"]]
        self.assertEqual(offered, [other])

    def test_the_payment_picker_takes_pos_only(self):
        with self.assertRaisesRegex(frappe.ValidationError, "Pick a PO"):
            get_eligible_payments(SR, self.sr)

    def test_the_record_picker_lists_the_vendors_open_pos_by_project(self):
        merged = self._po(self.project, status="Merged")
        records = get_vendor_records(self.vendor)
        self.assertEqual(
            sorted((r["doctype"], r["name"], r["project"]) for r in records),
            sorted([(PO, self.po, self.project), (PO, self.other_po, self.other_project)]),
        )
        self.assertNotIn(merged, [r["name"] for r in records])
        self.assertNotIn(self.sr, [r["name"] for r in records])  # Work Orders are paid Online

    # -- who ------------------------------------------------------------------------------------
    def test_a_project_manager_cannot_use_the_pickers(self):
        pm = frappe.db.get_value("Nirmaan Users", {"role_profile": "Nirmaan Project Manager Profile"}, "name")
        if not pm:
            self.skipTest("no Project Manager on this site")
        frappe.set_user(pm)
        try:
            with self.assertRaises(frappe.PermissionError):
                get_vendor_records(self.vendor)
            with self.assertRaises(frappe.PermissionError):
                get_eligible_payments(PO, self.po)
        finally:
            frappe.set_user(U)
