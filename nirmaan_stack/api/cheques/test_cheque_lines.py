# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""A vendor cheque's PO/WO lines, the payment picker and Online -> Cheque conversion (#1410, spec #1407).

Drives the report's endpoints against the database the way the Add Cheque dialog does
(`save_cheque` with `lines`, `pickers.get_vendor_records`, `pickers.get_eligible_payments`) and reads
back what a user sees: the Cheque and its lines, each payment's link, mode, cheque number, date and
status, or the refusal. Approvals after a conversion go through their real routes (the single L1
approve's two calls, the CEO endpoint, bulk approve, the hold release).

⚠️ RUNS AGAINST THE ENV DATABASE (the endpoints commit). Projects, vendors, Work Orders and payments
come from `TaxedWorkOrderFixture`; POs are planted and purged here; every Cheque carries a TESTCHQ
number and is purged by `ChequeFixture`.
"""

import json
from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import flt, nowdate

from nirmaan_stack.api.cheques.cheque_fixture import ChequeFixture
from nirmaan_stack.api.cheques.pickers import get_eligible_payments, get_vendor_records
from nirmaan_stack.api.cheques.save_cheque import save_cheque
from nirmaan_stack.api.payments import bulk_actions
from nirmaan_stack.api.payments.payment_hold import set_payment_hold
from nirmaan_stack.api.payments.project_payments import (
    ceo_approve_payment,
    move_cheque_payment_to_reconciliation,
)
from nirmaan_stack.api.payments.taxed_work_order_fixture import TaxedWorkOrderFixture
from nirmaan_stack.constants.authorized_users import CEO_AUTHORIZED_USER

U = "Administrator"
PAYMENT = "Project Payments"
SR = "Service Requests"
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
        self.sr = self.fx.service_request(self.project, self.vendor)
        self.po = self._po(self.other_project, self.vendor)
        frappe.db.commit()  # a refusal below rolls back; the planted rows must outlive it
        quiet = patch(f"{CONTROLLER}._notify_admins_auto_approved")
        quiet.start()
        self.addCleanup(quiet.stop)

    def tearDown(self):
        frappe.set_user(U)

    # -- planting -------------------------------------------------------------------------------
    def _po(self, project, vendor, status="Delivered"):
        """A bare PO. `Delivered`, so `procurement_orders.on_update` takes none of its status branches."""
        name = self.fx._name("PO")
        frappe.db.sql(
            """INSERT INTO "tabProcurement Orders" (name, creation, modified, modified_by, owner,
                   docstatus, idx, project, vendor, total_amount, amount_paid, status)
               VALUES (%s, NOW(), NOW(), %s, %s, 0, 0, %s, %s, 10000000, 0, %s)""",
            (name, U, U, project, vendor, status),
        )
        self.addCleanup(
            ChequeFixture.purge_rows, [("Version", {"ref_doctype": PO, "docname": name}), (PO, {"name": name})]
        )
        return name

    def _plant(self, status, *, amount=20000, parent=None, mode="Online", on_hold=False):
        """A payment already sitting at `status` (raw insert: no approval hook runs)."""
        parent_dt, parent_name = parent or (SR, self.sr)
        return self.cheques.plant_payment(
            self.fx, status, project=frappe.db.get_value(parent_dt, parent_name, "project"), vendor=self.vendor,
            document=(parent_dt, parent_name), amount=amount,
            cheque_no=self.cheques.number() if mode == "Cheque" else None, on_hold=on_hold,
        )

    # -- driving --------------------------------------------------------------------------------
    @staticmethod
    def _line(payment=None, *, record=None, project=None, amount=None):
        record_dt, record_name = record
        line = {"line_type": LINE, "project": project, "record_doctype": record_dt, "record_name": record_name}
        if payment:
            line["payment_name"] = payment
        if amount is not None:
            line["amount"] = amount
        return line

    def _wo_line(self, payment=None, **kw):
        return self._line(payment, record=(SR, self.sr), project=self.project, **kw)

    def _po_line(self, payment=None, **kw):
        return self._line(payment, record=(PO, self.po), project=self.other_project, **kw)

    def _save(self, lines, **overrides):
        values = {
            "bank": "ICICI Bank",
            "cheque_no": self.cheques.number(),
            "cheque_date": nowdate(),
            "amount": 50000,
            "vendor": self.vendor,
            "attachment": PHOTO,
            "lines": json.dumps(lines),
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
            PAYMENT, name, ["status", "mode_of_payment", "cheque", "cheque_no", "cheque_date", "on_hold"], as_dict=True
        )

    def _status(self, name):
        return frappe.db.get_value(PAYMENT, name, "status")

    def _cancel(self, cheque):
        """Plant a Cancelled Cheque. The status change itself is #1412's; this is only its outcome."""
        # Raw on purpose: it skips the Cheque's `validate` and writes no history row, because this suite
        # tests what a Cancelled Cheque's lines may do, not the status change (`test_cheque_status` does).
        # No derived figure reads a Cheque's status, so nothing needs recomputing.
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
    def test_a_cheque_saves_with_po_and_wo_lines_across_projects(self):
        wo_pay = self._plant("Requested", amount=30000)
        po_pay = self._plant("Requested", amount=15000, parent=(PO, self.po))
        name = self._save([self._wo_line(wo_pay), self._po_line(po_pay), self._wo_line(amount=5000)])

        lines = frappe.get_all(
            "Cheque Line",
            filters={"parent": name, "parenttype": "Cheques"},
            fields=["line_type", "project", "record_doctype", "record_name", "payment_doctype", "payment_name", "amount"],
            order_by="idx asc",
        )
        self.assertEqual(
            [(l.project, l.record_name, l.payment_doctype, l.payment_name, flt(l.amount)) for l in lines],
            [
                (self.project, self.sr, PAYMENT, wo_pay, 30000.0),  # the amount comes from the payment
                (self.other_project, self.po, PAYMENT, po_pay, 15000.0),
                (self.project, self.sr, None, None, 5000.0),  # no payment yet: the typed amount
            ],
        )

    def test_a_line_with_no_payment_needs_an_amount(self):
        self._refused("Line 1: enter the amount", [self._wo_line()])

    def test_each_po_wo_must_be_the_cheques_vendors_and_in_its_lines_project(self):
        stranger = self.fx.vendor()
        stranger_po = self._po(self.project, stranger)
        frappe.db.commit()
        self._refused(
            f"Line 1: {stranger_po} is not a PO or Work Order of this cheque's Vendor",
            [self._line(record=(PO, stranger_po), project=self.project, amount=100)],
        )
        self._refused(
            f"Line 1: {self.sr} is not in project {self.other_project}",
            [self._line(record=(SR, self.sr), project=self.other_project, amount=100)],
        )

    def test_each_payment_must_belong_to_its_lines_po_wo(self):
        po_pay = self._plant("Requested", parent=(PO, self.po))
        self._refused(f"Line 1: payment {po_pay} is not a payment of {self.sr}", [self._wo_line(po_pay)])

    def test_a_rejected_payment_cannot_be_linked(self):
        rejected = self._plant("Rejected")
        self._refused(f"Line 1: payment {rejected} is Rejected", [self._wo_line(rejected)])
        self.assertEqual(self._payment(rejected).mode_of_payment, "Online")

    def test_a_payment_sits_on_at_most_one_live_cheque(self):
        pay = self._plant("Requested")
        first = self._save([self._wo_line(pay)])
        number = frappe.db.get_value("Cheques", first, "cheque_no")
        self._refused(f"Line 1: payment {pay} is already on cheque {number} \\(Issued\\)", [self._wo_line(pay)])
        self._refused("is on two lines", [self._wo_line(pay), self._wo_line(pay)], cheque_no=self.cheques.number())

    def test_a_payment_only_on_a_cancelled_cheque_can_be_linked_again(self):
        pay = self._plant("Requested")
        first = self._save([self._wo_line(pay)])
        self._cancel(first)

        second = self._save([self._wo_line(pay)])
        state = self._payment(pay)
        self.assertEqual(state.cheque, second)
        self.assertEqual(state.cheque_no, frappe.db.get_value("Cheques", second, "cheque_no"))

    # -- conversion -----------------------------------------------------------------------------
    def test_a_linked_online_payment_becomes_a_cheque_payment(self):
        pay = self._plant("Requested")
        date = "2026-11-02"
        name = self._save([self._wo_line(pay)], cheque_date=date)

        state = self._payment(pay)
        self.assertEqual(state.mode_of_payment, "Cheque")
        self.assertEqual(state.cheque, name)
        self.assertEqual(state.cheque_no, frappe.db.get_value("Cheques", name, "cheque_no"))
        self.assertEqual(str(state.cheque_date), date)
        self.assertEqual(state.status, "Requested")

    def test_requested_waits_then_moves_on_the_single_l1_approve(self):
        pay = self._plant("Requested")
        self._save([self._wo_line(pay)])
        self.assertEqual(self._status(pay), "Requested")

        # The browser's single L1 approve: `updateDoc`, then the move endpoint.
        doc = frappe.get_doc(PAYMENT, pay)
        doc.update({"status": "Approved", "amount": 20000, "approval_date": nowdate()})
        doc.save()
        frappe.db.commit()
        self.assertEqual(move_cheque_payment_to_reconciliation(pay), {"moved": True})
        self.assertEqual(self._status(pay), RECON)

    def test_requested_moves_on_bulk_approve(self):
        pay = self._plant("Requested")
        self._save([self._wo_line(pay)])
        with patch.object(bulk_actions, "_emit_approve_summary"):
            res = bulk_actions.bulk_lead_approve_payments([pay], "approve")["data"]
        self.assertEqual(res["succeeded"], [pay])
        self.assertEqual(self._status(pay), RECON)

    def test_ceo_pending_moves_on_ceo_approval(self):
        pay = self._plant("CEO Pending", amount=60000)
        self._save([self._wo_line(pay)], amount=60000)
        self.assertEqual(self._status(pay), "CEO Pending")

        self._as_ceo(ceo_approve_payment, pay)
        self.assertEqual(self._status(pay), RECON)

    def test_approved_not_on_hold_moves_at_once(self):
        wo_pay = self._plant("Approved")
        po_pay = self._plant("Approved", parent=(PO, self.po))
        self._save([self._wo_line(wo_pay), self._po_line(po_pay)])
        self.assertEqual(self._status(wo_pay), RECON)
        self.assertEqual(self._status(po_pay), RECON)

    def test_approved_on_hold_stays_until_the_hold_is_released(self):
        pay = self._plant("Approved", on_hold=True)
        self._save([self._wo_line(pay)])
        self.assertEqual((self._payment(pay).status, self._payment(pay).mode_of_payment), ("Approved", "Cheque"))

        set_payment_hold(pay, False)
        self.assertEqual(self._status(pay), RECON)

    def test_reconciliation_pending_and_paid_stay(self):
        recon = self._plant(RECON)
        paid = self._plant("Paid")
        self._save([self._wo_line(recon), self._wo_line(paid)])
        self.assertEqual((self._status(recon), self._status(paid)), (RECON, "Paid"))
        self.assertEqual(self._payment(paid).mode_of_payment, "Cheque")

    def test_a_cheque_payment_goes_back_to_online_once_its_cheque_is_cancelled(self):
        pay = self._plant("Requested")
        cheque = self._save([self._wo_line(pay)])
        self._cancel(cheque)

        doc = frappe.get_doc(PAYMENT, pay)
        doc.mode_of_payment = "Online"
        doc.save()
        self.assertEqual((self._payment(pay).mode_of_payment, self._payment(pay).status), ("Online", "Requested"))

    # -- the pickers ----------------------------------------------------------------------------
    def test_the_payment_picker_hides_live_cheque_and_rejected_payments_and_counts_them(self):
        free = self._plant("Requested", amount=11000)
        on_live = self._plant("Requested", amount=12000)
        on_cancelled = self._plant("Approved", amount=13000, on_hold=True)
        rejected = self._plant("Rejected", amount=14000)
        live = self._save([self._wo_line(on_live)])
        dead = self._save([self._wo_line(on_cancelled)])
        self._cancel(dead)

        out = get_eligible_payments(SR, self.sr)
        self.assertEqual(sorted(p["name"] for p in out["payments"]), sorted([free, on_cancelled]))
        offered = {p["name"]: p for p in out["payments"]}
        self.assertEqual(
            (offered[free]["amount"], offered[free]["status"], offered[free]["mode_of_payment"], offered[free]["on_hold"]),
            (11000.0, "Requested", "Online", 0),
        )
        self.assertEqual(
            out["hidden"],
            {
                "on_cheque": [{
                    "payment": on_live,
                    "cheque": live,
                    "cheque_no": frappe.db.get_value("Cheques", live, "cheque_no"),
                    "status": "Issued",
                }],
                "rejected": 1,
            },
        )
        self.assertNotIn(rejected, offered)

    def test_the_record_picker_lists_the_vendors_pos_and_work_orders_by_project(self):
        merged = self._po(self.project, self.vendor, status="Merged")
        frappe.db.commit()
        records = get_vendor_records(self.vendor)
        self.assertEqual(
            sorted((r["doctype"], r["name"], r["project"]) for r in records),
            sorted([(SR, self.sr, self.project), (PO, self.po, self.other_project)]),
        )
        self.assertNotIn(merged, [r["name"] for r in records])

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
                get_eligible_payments(SR, self.sr)
        finally:
            frappe.set_user(U)
