# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""A Payment cheque's payments are approved together (#1480, spec #1477, ADR-0035).

Driven through the endpoints the approval screens call: the single L1 approve
(`cheque_approval.approve_cheque_payments`), the CEO approve (`project_payments.ceo_approve_payment`) and
the dialog's read (`cheque_approval.get_cheque_approval`), plus a payment saved straight to Approved the
way the browser used to. Checked through what a user sees: each payment's status, the Cheque's status,
issue date and history, the PO terms, and what an endpoint returned or refused.

⚠️ RUNS AGAINST THE ENV DATABASE (the endpoints commit). Every row is planted through
`TaxedWorkOrderFixture` / `ChequeFixture` and purged by them.
"""

from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import flt, nowdate

from nirmaan_stack.api.cheques.cheque_fixture import ChequeFixture
from nirmaan_stack.api.payments.cheque_approval import approve_cheque_payments, get_cheque_approval
from nirmaan_stack.api.payments.project_payments import ceo_approve_payment
from nirmaan_stack.api.payments.taxed_work_order_fixture import TaxedWorkOrderFixture
from nirmaan_stack.constants.authorized_users import CEO_AUTHORIZED_USER
from nirmaan_stack.services.cheques.rules import ChequeHeader, ChequeLineInput
from nirmaan_stack.services.cheques.writer import create_cheque

PAYMENT = "Project Payments"
PO = "Procurement Orders"
TERMS = "PO Payment Terms"
U = "Administrator"
RECON = "Reconciliation Pending"
PHOTO = "https://storage.example.invalid/private/files/cheque-approval-test.jpg"
CONTROLLER = "nirmaan_stack.integrations.controllers.project_payments"


class PendingChequeCase(FrappeTestCase):
    """Plants Pending Payment cheques on PO payments, and reads back what a user sees. No tests of its
    own: the approve (here) and reject (`test_cheque_reject.py`) suites build on it."""

    def setUp(self):
        frappe.set_user(U)
        self.fx = TaxedWorkOrderFixture.attach(self)
        self.cheques = ChequeFixture.attach(self)
        self.project = self.fx.project()
        self.vendor = self.fx.vendor(2.0)
        frappe.db.commit()
        # A push reaches real phones and the CEO's in-app note a real user: keep both off, and count
        # the CEO notes the cheque sends.
        quiet = patch(f"{CONTROLLER}.PrNotification")
        quiet.start()
        self.addCleanup(quiet.stop)
        ceo_note = patch(f"{CONTROLLER}._notify_ceo_payment_awaiting")
        self.ceo_note = ceo_note.start()
        self.addCleanup(ceo_note.stop)

    def tearDown(self):
        frappe.set_user(U)

    # -- planting -------------------------------------------------------------------------------
    def _po(self):
        """A bare PO. `Delivered`, so `procurement_orders.on_update` takes none of its status branches."""
        name = self.fx._name("PO")
        frappe.db.sql(
            """INSERT INTO "tabProcurement Orders" (name, creation, modified, modified_by, owner,
                   docstatus, idx, project, vendor, total_amount, amount, tax_amount, amount_paid, status)
               VALUES (%s, NOW(), NOW(), %s, %s, 0, 0, %s, %s, 10000000, 10000000, 0, 0, 'Delivered')""",
            (name, U, U, self.project, self.vendor),
        )
        frappe.db.commit()
        self.addCleanup(ChequeFixture.purge_rows, [
            (TERMS, {"parent": name}),
            ("Version", {"ref_doctype": PO, "docname": name}),
            (PO, {"name": name}),
        ])
        return name

    def _payment(self, amount, status="Requested", po=None):
        """A PO payment at `status` with its PO term at the same status, planted raw (no hook runs)."""
        po = po or self._po()
        name = ChequeFixture.plant_payment(
            self.fx, status, project=self.project, vendor=self.vendor, document=(PO, po), amount=amount
        )
        frappe.db.sql(
            """INSERT INTO "tabPO Payment Terms" (name, creation, modified, modified_by, owner, docstatus,
                   idx, vendor, project, payment_type, label, percentage, amount, term_status,
                   project_payment, parent, parentfield, parenttype)
               VALUES (%s, NOW(), NOW(), %s, %s, 0, 1, %s, %s, 'Delivery against Payment', 'Test term',
                       10, %s, %s, %s, %s, 'payment_terms', %s)""",
            (frappe.generate_hash(length=10), U, U, self.vendor, self.project, flt(amount), status, name, po, PO),
        )
        frappe.db.commit()
        return name

    def _cheque(self, *lines, amount=None):
        """A Pending Payment cheque, as Request Payment makes one, with one line per `(payment, amount)`;
        a `(None, amount, po)` line has no payment yet. `amount` defaults to the lines' total."""
        rows = []
        for line in lines:
            payment, line_amount = line[0], line[1]
            po = line[2] if len(line) > 2 else frappe.db.get_value(PAYMENT, payment, "document_name")
            rows.append(ChequeLineInput(
                line_type="PO/WO Payment", project=self.project, record_doctype=PO, record_name=po,
                payment_doctype=PAYMENT if payment else None, payment_name=payment, amount=line_amount,
            ))
        header = ChequeHeader(
            bank="ICICI Bank", bank_name=None, cheque_no=self.cheques.number(), cheque_date=nowdate(),
            amount=amount if amount is not None else sum(line[1] for line in lines), vendor=self.vendor,
            payee_name=None, description=None, attachment=PHOTO,
        )
        name = self.cheques.track(create_cheque(header, user=U, made_from="PO/WO Page", lines=rows).name)
        frappe.db.commit()
        return name

    # -- reading --------------------------------------------------------------------------------
    def _statuses(self, *payments):
        return [frappe.db.get_value(PAYMENT, p, "status") for p in payments]

    def _terms(self, *payments):
        return [frappe.db.get_value(TERMS, {"project_payment": p}, "term_status") for p in payments]

    def _cheque_state(self, cheque):
        doc = frappe.get_doc("Cheques", cheque)
        return doc.status, str(doc.issue_date) if doc.issue_date else None, [
            (h.from_status, h.to_status) for h in doc.status_history
        ]

    def _as_ceo(self, fn, *args, **kwargs):
        frappe.set_user(CEO_AUTHORIZED_USER)
        try:
            return fn(*args, **kwargs)
        finally:
            frappe.set_user(U)



class TestApproveAChequeTogether(PendingChequeCase):
    # -- approve all ------------------------------------------------------------------------------
    def test_approving_one_payment_approves_all_three_and_issues_the_cheque_once(self):
        a, b, c = self._payment(15000), self._payment(15000), self._payment(10000)
        cheque = self._cheque((a, 15000), (b, 15000), (c, 10000))

        out = approve_cheque_payments(b)

        self.assertEqual(sorted(out["payments"]), sorted([a, b, c]))
        self.assertEqual(self._statuses(a, b, c), [RECON] * 3)
        self.assertEqual(self._terms(a, b, c), [RECON] * 3)
        self.assertEqual(self._cheque_state(cheque), ("Issued", nowdate(), [(None, "Pending"), ("Pending", "Issued")]))
        for p in (a, b, c):
            self.assertEqual(str(frappe.db.get_value(PAYMENT, p, "approval_date")), nowdate())
        self.ceo_note.assert_not_called()

    def test_the_cheque_amount_sends_small_payments_to_the_ceo_together(self):
        a, b = self._payment(20000), self._payment(40000)
        cheque = self._cheque((a, 20000), (b, 40000))

        approve_cheque_payments(a)
        self.assertEqual(self._statuses(a, b), ["CEO Pending"] * 2)
        self.assertEqual(self._terms(a, b), ["CEO Pending"] * 2)
        self.assertEqual(self._cheque_state(cheque)[0], "Pending")
        self.ceo_note.assert_called_once()  # one note for the cheque, not one per payment

        res = self._as_ceo(ceo_approve_payment, b)
        self.assertIn("Reconciliation Pending", res["message"])
        self.assertEqual(self._statuses(a, b), [RECON] * 2)
        self.assertEqual(self._cheque_state(cheque), ("Issued", nowdate(), [(None, "Pending"), ("Pending", "Issued")]))
        for p in (a, b):
            self.assertEqual(str(frappe.db.get_value(PAYMENT, p, "ceo_approval_date")), nowdate())

    # -- refusals ---------------------------------------------------------------------------------
    def test_a_line_with_no_payment_yet_refuses_and_names_the_line(self):
        a = self._payment(20000)
        po = self._po()
        cheque = self._cheque((a, 20000), (None, 30000, po))
        with self.assertRaisesRegex(frappe.ValidationError, f"Line 2 of cheque .* has no payment yet \\({po}"):
            approve_cheque_payments(a)
        self.assertEqual(self._statuses(a), ["Requested"])
        self.assertEqual(self._cheque_state(cheque)[0], "Pending")

    def test_lines_that_do_not_add_up_to_the_cheque_refuse(self):
        a, b = self._payment(20000), self._payment(25000)
        self._cheque((a, 20000), (b, 25000), amount=45006)
        with self.assertRaisesRegex(frappe.ValidationError, "add up to ₹45,000, but the cheque is for ₹45,006"):
            approve_cheque_payments(a)
        self.assertEqual(self._statuses(a, b), ["Requested"] * 2)

    def test_lines_within_five_rupees_approve(self):
        a = self._payment(20000)
        self._cheque((a, 20000), amount=20005)
        approve_cheque_payments(a)
        self.assertEqual(self._statuses(a), [RECON])

    def test_payments_at_different_steps_refuse(self):
        a, b = self._payment(20000), self._payment(40000, "CEO Pending")
        self._cheque((a, 20000), (b, 40000))
        with self.assertRaisesRegex(frappe.ValidationError, f"{b} is CEO Pending"):
            approve_cheque_payments(a)
        self.assertEqual(self._statuses(a, b), ["Requested", "CEO Pending"])

    def test_only_an_l1_approver_may_approve(self):
        a = self._payment(20000)
        self._cheque((a, 20000))
        # Who holds L1 is `approval_raiser`'s answer (Admin profile, Administrator, the CEO); ask as
        # someone holding none.
        with patch("nirmaan_stack.api.payments.cheque_approval.raiser_level", return_value=None):
            with self.assertRaises(frappe.PermissionError):
                approve_cheque_payments(a)
        self.assertEqual(self._statuses(a), ["Requested"])

    # -- no path approves one alone ----------------------------------------------------------------
    def test_saving_one_cheque_payment_to_approved_directly_is_refused(self):
        a, b = self._payment(20000), self._payment(20000)
        self._cheque((a, 20000), (b, 20000))
        doc = frappe.get_doc(PAYMENT, a)
        doc.update({"status": "Approved", "amount": doc.amount, "approval_date": nowdate()})  # the browser's write
        with self.assertRaisesRegex(frappe.ValidationError, "approve all 2 together"):
            doc.save()
        frappe.db.rollback()
        self.assertEqual(self._statuses(a, b), ["Requested"] * 2)

    def test_a_one_payment_cheque_may_not_skip_the_ceo_its_amount_needs(self):
        a = self._payment(20000)
        self._cheque((a, 20000), amount=20000)
        frappe.db.set_value("Cheques", frappe.db.get_value(PAYMENT, a, "cheque"), "amount", 60000)  # raw: test setup
        doc = frappe.get_doc(PAYMENT, a)
        doc.update({"status": "Approved", "approval_date": nowdate()})
        with self.assertRaisesRegex(frappe.ValidationError, "for ₹60,000, so its payments need CEO approval"):
            doc.save()
        frappe.db.rollback()

    # -- all or nothing ----------------------------------------------------------------------------
    def test_a_failure_on_any_payment_rolls_back_all_of_them(self):
        a, b, c = self._payment(15000), self._payment(15000), self._payment(10000)
        cheque = self._cheque((a, 15000), (b, 15000), (c, 10000))
        from nirmaan_stack.services import cheque_payments

        real = cheque_payments.move_to_reconciliation
        moves = []

        def third_fails(name, **kwargs):
            moves.append(name)
            if len(moves) == 3:
                raise RuntimeError("boom")
            return real(name, **kwargs)

        with patch("nirmaan_stack.services.cheques.decide.move_to_reconciliation", side_effect=third_fails):
            with self.assertRaises(RuntimeError):
                approve_cheque_payments(a)
        self.assertEqual(len(moves), 3)
        self.assertEqual(self._statuses(a, b, c), ["Requested"] * 3)
        self.assertEqual(self._terms(a, b, c), ["Requested"] * 3)
        self.assertEqual(self._cheque_state(cheque), ("Pending", None, [(None, "Pending")]))

    # -- what the dialog reads -----------------------------------------------------------------------
    def test_the_dialog_lists_every_payment_the_total_and_the_approval_it_needs(self):
        a, b = self._payment(20000), self._payment(40000)
        cheque = self._cheque((a, 20000), (b, 40000))
        out = get_cheque_approval(a)
        self.assertEqual(out["cheque"], cheque)
        self.assertEqual(flt(out["amount"]), 60000.0)
        self.assertEqual(out["status_after_l1"], "CEO Pending")
        self.assertIsNone(out["problem"])
        self.assertEqual(
            [(l["payment"], l["record"], l["project"], flt(l["amount"]), l["status"]) for l in out["lines"]],
            [
                (a, frappe.db.get_value(PAYMENT, a, "document_name"), self.project, 20000.0, "Requested"),
                (b, frappe.db.get_value(PAYMENT, b, "document_name"), self.project, 40000.0, "Requested"),
            ],
        )

    def test_the_dialog_says_why_a_cheque_cannot_be_approved_yet(self):
        a = self._payment(20000)
        self._cheque((a, 20000), (None, 30000, self._po()))
        out = get_cheque_approval(a)
        self.assertIn("Line 2", out["problem"])
        self.assertEqual([l["payment"] for l in out["lines"]], [a, None])

    def test_an_online_payment_has_no_cheque_to_approve(self):
        a = ChequeFixture.plant_payment(
            self.fx, "Requested", project=self.project, vendor=self.vendor, document=(PO, self._po())
        )
        self.assertIsNone(get_cheque_approval(a))
