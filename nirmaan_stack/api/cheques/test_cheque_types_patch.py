# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The one-time patch that brings existing Cheques into the spec #1477 shape (#1478).

Drives the patch's entry function (`migrate_cheques`) on planted Cheques only, the way `execute` runs it
over every Cheque, and reads back what a user then sees: each Cheque's type, status, Old-type flag, issue
and clearance dates and history, and what the patch reports.

Each planted Cheque is made through the cheques service, then put back into its pre-#1478 state with raw
writes (no type, a status the old rules allowed): that is the old data the patch meets.

⚠️ RUNS AGAINST THE ENV DATABASE (the Cheque insert saves payments). Projects, vendors, Work Orders and
payments come from `TaxedWorkOrderFixture`; every planted cheque number starts with TESTCHQ, so
`ChequeFixture` purges the Cheques.
"""

from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.cheques.cheque_fixture import ChequeFixture
from nirmaan_stack.api.payments.taxed_work_order_fixture import TaxedWorkOrderFixture
from nirmaan_stack.patches.v3_0.cheque_types_pending_and_dates import migrate_cheques, summary
from nirmaan_stack.services.cheques.rules import ChequeHeader, ChequeLineInput
from nirmaan_stack.services.cheques.writer import create_cheque

U = "Administrator"
PAYMENT = "Project Payments"
SR = "Service Requests"
PHOTO = "https://storage.example.invalid/private/files/cheque-test.jpg"
CONTROLLER = "nirmaan_stack.integrations.controllers.project_payments"


class TestChequeTypesPatch(FrappeTestCase):
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
    def _payment(self, status, *, approval_date=None, ceo_approval_date=None, payment_date=None):
        """A payment at `status`, with the dates the approval and settle routes would have written. A Work
        Order cheque payment from before spec #1477, so already in Cheque mode (an Online one is refused)."""
        name = self.cheques.plant_payment(
            self.fx, status, project=self.project, vendor=self.vendor, document=(SR, self.sr),
            cheque_no=self.cheques.number(),
        )
        frappe.db.set_value(
            PAYMENT, name,
            {"approval_date": approval_date, "ceo_approval_date": ceo_approval_date, "payment_date": payment_date},
            update_modified=False,
        )
        frappe.db.commit()
        return name

    def _cheque(self, status, *payments, payee_name=None, description=None):
        """A Cheque as the ledger holds one before #1478: no cheque type, at `status`, one line per payment."""
        lines = [
            ChequeLineInput(line_type="PO/WO Payment", project=self.project, record_doctype=SR, record_name=self.sr,
                            payment_doctype=PAYMENT, payment_name=p, amount=20000)
            for p in payments
        ]
        doc = create_cheque(
            ChequeHeader(bank="ICICI Bank", bank_name=None, cheque_no=self.cheques.number(),
                         cheque_date="2026-09-01", amount=20000 * max(len(payments), 1),
                         vendor=None if payee_name else self.vendor, payee_name=payee_name,
                         description=description, attachment=PHOTO),
            user=U, made_from="Report", lines=lines,
        )
        self.cheques.track(doc.name)
        # Raw on purpose: this plants old data, a state today's writer can no longer make.
        frappe.db.set_value("Cheques", doc.name, {"status": status, "cheque_type": None}, update_modified=False)
        frappe.db.commit()
        self.planted.append(doc.name)
        return doc.name

    def _migrate(self):
        result = migrate_cheques(cheques=self.planted)
        frappe.db.commit()
        return result

    def _read(self, name):
        doc = frappe.get_doc("Cheques", name)
        return {
            "type": doc.cheque_type,
            "status": doc.status,
            "old_type": doc.old_type,
            "issue_date": str(doc.issue_date) if doc.issue_date else None,
            "clearance_date": str(doc.clearance_date) if doc.clearance_date else None,
        }

    def _history(self, name):
        return [(h.from_status, h.to_status, h.note) for h in frappe.get_doc("Cheques", name).status_history]

    # -- every Cheque is a Payment cheque, its status worked out from its payments -----------------
    def test_an_issued_cheque_whose_payment_waits_for_approval_becomes_pending(self):
        name = self._cheque("Issued", self._payment("Requested"))

        result = self._migrate()

        self.assertEqual(self._read(name), {"type": "Payment", "status": "Pending", "old_type": 0,
                                            "issue_date": None, "clearance_date": None})
        self.assertEqual(self._history(name)[-1][:2], ("Issued", "Pending"))
        self.assertEqual([(c["cheque"], c["from_status"], c["status"]) for c in result["changed"]],
                         [(name, "Issued", "Pending")])

    def test_an_issued_cheque_of_approved_payments_stays_issued_dated_by_the_last_approval(self):
        name = self._cheque(
            "Issued",
            self._payment("Approved", approval_date="2026-09-03"),
            self._payment("Reconciliation Pending", approval_date="2026-09-02", ceo_approval_date="2026-09-05"),
        )
        self._migrate()
        self.assertEqual(self._read(name), {"type": "Payment", "status": "Issued", "old_type": 0,
                                            "issue_date": "2026-09-05", "clearance_date": None})
        self.assertEqual(len(self._history(name)), 1)  # the status did not move

    def test_a_cheque_whose_payments_are_all_paid_is_cleared_on_their_last_payment_date(self):
        name = self._cheque(
            "Issued",
            self._payment("Paid", approval_date="2026-09-02", payment_date="2026-09-10"),
            self._payment("Paid", approval_date="2026-09-03", payment_date="2026-09-12"),
        )
        self._migrate()
        self.assertEqual(self._read(name), {"type": "Payment", "status": "Cleared", "old_type": 0,
                                            "issue_date": "2026-09-03", "clearance_date": "2026-09-12"})
        self.assertEqual(self._history(name)[-1][:2], ("Issued", "Cleared"))

    def test_a_cleared_cheque_whose_payments_are_not_paid_goes_back_to_issued_with_a_note(self):
        unpaid = self._payment("Reconciliation Pending", approval_date="2026-09-02")
        name = self._cheque("Cleared", unpaid)

        self._migrate()

        self.assertEqual(self._read(name)["status"], "Issued")
        from_status, to_status, note = self._history(name)[-1]
        self.assertEqual((from_status, to_status), ("Cleared", "Issued"))
        self.assertIn("not all Paid", note)
        self.assertIn(unpaid, note)

    def test_a_cancelled_cheque_of_rejected_payments_stays_cancelled(self):
        # As the #1419 backfill left one: a Rejected payment cannot be put on a cheque today, so it is
        # planted Approved and Rejected afterwards (raw: no drop-off hook runs).
        rejected = self._payment("Approved")
        name = self._cheque("Cancelled", rejected)
        frappe.db.set_value(PAYMENT, rejected, "status", "Rejected", update_modified=False)
        frappe.db.commit()

        self._migrate()
        self.assertEqual(self._read(name)["status"], "Cancelled")
        self.assertEqual(self._read(name)["type"], "Payment")
        self.assertEqual(len(self._history(name)), 1)

    def test_a_cancelled_cheque_whose_payment_is_still_live_stays_cancelled_and_is_listed(self):
        # Under spec #1407 Cancel touched no payment: reviving the cheque would bring back torn-up paper.
        live = self._payment("Reconciliation Pending", approval_date="2026-09-02")
        name = self._cheque("Cancelled", live)

        result = self._migrate()

        self.assertEqual(self._read(name)["status"], "Cancelled")
        self.assertEqual([k["cheque"] for k in result["not_worked_out"]], [name])
        self.assertIn(live, result["not_worked_out"][0]["reason"])

    # -- Old-type cheques keep their status --------------------------------------------------------
    def test_a_cheque_with_no_lines_is_old_type_and_keeps_its_status(self):
        name = self._cheque("Cleared", description="Office rent")

        result = self._migrate()

        self.assertEqual(self._read(name), {"type": "Payment", "status": "Cleared", "old_type": 1,
                                            "issue_date": None, "clearance_date": None})
        self.assertEqual(len(self._history(name)), 1)
        self.assertEqual([(o["cheque"], o["reason"]) for o in result["old_type"]], [(name, "has no lines")])

    def test_a_typed_payee_cheque_is_old_type(self):
        name = self._cheque("Issued", payee_name="Kavitha Properties", description="Rent deposit")
        self._migrate()
        self.assertEqual((self._read(name)["old_type"], self._read(name)["status"]), (1, "Issued"))

    # -- a payment that has left the cheque does not decide it -------------------------------------
    def test_a_cheque_whose_payment_has_left_it_keeps_its_status_and_is_listed(self):
        gone = self._payment("Approved", approval_date="2026-09-02")
        name = self._cheque("Issued", gone)
        frappe.db.set_value(PAYMENT, gone, {"cheque": None, "mode_of_payment": "Online"}, update_modified=False)
        frappe.db.commit()

        result = self._migrate()

        self.assertEqual(self._read(name)["status"], "Issued")
        self.assertEqual(self._read(name)["type"], "Payment")
        self.assertEqual([k["cheque"] for k in result["not_worked_out"]], [name])

    # -- once only, and it says what it did ---------------------------------------------------------
    def _snapshot(self):
        return sorted(
            (c.name, str(c.modified), c.status, c.cheque_type, c.old_type, len(self._history(c.name)))
            for c in frappe.get_all("Cheques", filters={"name": ["in", self.planted]},
                                    fields=["name", "modified", "status", "cheque_type", "old_type"])
        )

    def test_a_second_run_changes_nothing(self):
        self._cheque("Issued", self._payment("Requested"))
        self._cheque("Cleared", self._payment("Approved", approval_date="2026-09-02"))
        self._cheque("Cleared", description="Office rent")
        self._migrate()
        before = self._snapshot()

        second = self._migrate()

        self.assertEqual((second["changed"], second["old_type"], second["failed"]), ([], [], []))
        self.assertEqual(self._snapshot(), before)

    def test_the_summary_names_every_cheque_it_changed_flagged_or_left(self):
        moved = self._cheque("Issued", self._payment("Requested"))
        old = self._cheque("Issued", description="Office rent")
        left = self._cheque("Cancelled", self._payment("Approved"))

        text = "\n".join(summary(self._migrate()))

        for name in (moved, old, left):
            self.assertIn(name, text)
        self.assertIn("Issued -> Pending", text)
        self.assertIn("has no lines", text)
