# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Request Payment in Cheque mode makes a one-line Cheque (#1414, spec #1407).

Drives the two live request endpoints the way the dialogs do -- the PO page's payment-term request
(`create_project_payment`) and the Work Order page's request (`create_payment_request_for_service`)
-- and reads back what a user sees: the payment (its Cheque link, number, date, status, TDS) and the
Cheque (made from the PO/WO page, one line for that payment; Pending until the payment is approved,
then Issued with its issue date, #1479), or the refusal and that nothing was created.

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
from nirmaan_stack.api.cheques.find_cheque import find_cheque
from nirmaan_stack.api.payments.project_payments import (
    ceo_approve_payment,
    create_payment_request_for_service,
    create_project_payment,
)
from nirmaan_stack.api.payments.taxed_work_order_fixture import TaxedWorkOrderFixture
from nirmaan_stack.constants.authorized_users import CEO_AUTHORIZED_USER
from nirmaan_stack.services import payment_tds
from nirmaan_stack.services.cheques.writer import DuplicateChequeError

U = "Administrator"
PAYMENT = "Project Payments"
SR = "Service Requests"
PO = "Procurement Orders"
TERMS = "PO Payment Terms"
RECON = "Reconciliation Pending"
PHOTO = "https://storage.example.invalid/private/files/cheque-request-test.jpg"
CONTROLLER = "nirmaan_stack.integrations.controllers.project_payments"


class TestChequeRequest(FrappeTestCase):
    def setUp(self):
        frappe.set_user(U)
        self.fx = TaxedWorkOrderFixture.attach(self)
        self.cheques = ChequeFixture.attach(self)
        self.project = self.fx.project()
        self.vendor = self.fx.vendor(2.0)
        self.sr = self.fx.service_request(self.project, self.vendor)
        self.po = self._po()
        frappe.db.commit()  # a refusal below rolls back; the planted rows must outlive it
        # The admin note reaches every real admin, and a push reaches real phones: keep both off.
        # The in-app notifications (and their commits, which the withdraw test relies on) still run.
        for target in ("_notify_admins_auto_approved", "PrNotification"):
            quiet = patch(f"{CONTROLLER}.{target}")
            quiet.start()
            self.addCleanup(quiet.stop)

    def tearDown(self):
        frappe.set_user(U)

    # -- planting -------------------------------------------------------------------------------
    def _po(self):
        """A bare PO worth 1 crore. `Delivered`, so `procurement_orders.on_update` takes none of its
        status branches."""
        name = self.fx._name("PO")
        frappe.db.sql(
            """INSERT INTO "tabProcurement Orders" (name, creation, modified, modified_by, owner,
                   docstatus, idx, project, vendor, total_amount, amount, tax_amount, amount_paid, status)
               VALUES (%s, NOW(), NOW(), %s, %s, 0, 0, %s, %s, 10000000, 10000000, 0, 0, 'Delivered')""",
            (name, U, U, self.project, self.vendor),
        )
        # Runs before the fixture's own purge (cleanups are LIFO).
        self.addCleanup(ChequeFixture.purge_rows, [
            (TERMS, {"parent": name}),
            ("Version", {"ref_doctype": PO, "docname": name}),
            (PO, {"name": name}),
        ])
        return name

    def _term(self, amount):
        """A payment term of the PO, at Created, that nothing has requested yet."""
        name = frappe.generate_hash(length=10)
        frappe.db.sql(
            """INSERT INTO "tabPO Payment Terms" (name, creation, modified, modified_by, owner, docstatus,
                   idx, vendor, project, payment_type, label, percentage, amount, term_status,
                   parent, parentfield, parenttype)
               VALUES (%s, NOW(), NOW(), %s, %s, 0, 1, %s, %s, 'Delivery against Payment', 'Test term',
                       10, %s, 'Created', %s, 'payment_terms', %s)""",
            (name, U, U, self.vendor, self.project, flt(amount), self.po, PO),
        )
        frappe.db.commit()
        return name

    def _cheque_fields(self, amount, **overrides):
        """What the dialog sends in Cheque mode: the cheque as read off its photo."""
        fields = {
            "mode_of_payment": "Cheque",
            "bank": "ICICI Bank",
            "cheque_no": self.cheques.number(),
            "cheque_date": nowdate(),
            "cheque_amount": amount,
            "cheque_attachment": PHOTO,
        }
        fields.update(overrides)
        return fields

    # -- driving --------------------------------------------------------------------------------
    def _request_wo(self, amount, **fields):
        out = json.loads(create_payment_request_for_service(json.dumps({
            "doctype": SR, "docname": self.sr, "amount": amount, **fields,
        })))
        if out.get("cheque"):
            self.cheques.track(out["cheque"])
        return out

    def _request_po(self, term, amount, **fields):
        out = create_project_payment(
            doctype=PO, docname=self.po, vendor=self.vendor, amount=amount, project=self.project,
            ptname=term, **fields,
        )
        if out.get("cheque"):
            self.cheques.track(out["cheque"])
        return out

    # -- reading --------------------------------------------------------------------------------
    def _payment(self, name):
        return frappe.db.get_value(
            PAYMENT, name, ["status", "amount", "mode_of_payment", "cheque", "cheque_no", "cheque_date"], as_dict=True
        )

    def _tds(self, name):
        return [flt(d) for d in frappe.get_all(payment_tds.TDS_DOCTYPE, filters={"project_payment": name}, pluck="tds_amount")]

    def _cheque(self, name):
        return frappe.get_doc("Cheques", name)

    def _payments_of(self, doctype, docname):
        return frappe.get_all(PAYMENT, filters={"document_type": doctype, "document_name": docname}, pluck="name")

    def _issued(self, cheque):
        """`(status, issue date, history moves)` of a Cheque, as the Tracker shows them."""
        doc = self._cheque(cheque)
        issue_date = str(doc.issue_date) if doc.issue_date else None
        return doc.status, issue_date, [(h.from_status, h.to_status) for h in doc.status_history]

    def _assert_one_line_cheque(self, cheque, payment, *, record, amount, status):
        doc = self._cheque(cheque)
        self.assertEqual(doc.status, status)
        self.assertEqual(doc.made_from, "PO/WO Page")
        self.assertEqual(doc.vendor, self.vendor)
        self.assertFalse(doc.payee_name)
        self.assertEqual(doc.attachment, PHOTO)
        self.assertEqual(flt(doc.amount), amount)
        self.assertEqual(
            [(l.line_type, l.project, l.record_doctype, l.record_name, l.payment_doctype, l.payment_name, flt(l.amount))
             for l in doc.lines],
            [("PO/WO Payment", self.project, record[0], record[1], PAYMENT, payment, amount)],
        )
        pay = self._payment(payment)
        self.assertEqual((pay.mode_of_payment, pay.cheque, pay.cheque_no, str(pay.cheque_date)),
                         ("Cheque", cheque, doc.cheque_no, str(doc.cheque_date)))

    # -- the Work Order page --------------------------------------------------------------------
    def test_a_wo_cheque_request_is_refused_and_nothing_is_created(self):
        """Spec #1477 (#1487): a Work Order payment is paid Online, whatever the dialog sends."""
        fields = self._cheque_fields(9800)
        with self.assertRaisesRegex(
            frappe.ValidationError, "A Work Order payment is paid Online: only a PO payment can be paid by cheque."
        ):
            self._request_wo(10000, **fields)
        frappe.db.rollback()
        self.assertEqual(self._payments_of(SR, self.sr), [])
        self.assertEqual(frappe.get_all("Cheques", filters={"cheque_no": fields["cheque_no"]}, pluck="name"), [])

    def test_an_online_wo_payment_cannot_become_a_cheque_payment(self):
        """Spec #1477 (#1487): putting a Work Order payment on a cheque later is refused like asking for one."""
        name = self.cheques.plant_payment(
            self.fx, "Requested", project=self.project, vendor=self.vendor, document=(SR, self.sr), amount=10000,
        )
        cheque = self.cheques.plant_cheque(bank="ICICI Bank", cheque_no=self.cheques.number(), cheque_date=nowdate(),
                                           amount=10000, vendor=self.vendor, description="Advance", attachment=PHOTO)
        pay = frappe.get_doc(PAYMENT, name)
        pay.update({"mode_of_payment": "Cheque", "cheque": cheque, "cheque_no": "1", "cheque_date": nowdate()})
        # As the cheques service puts it on (`writer.link_payments`): a user's own save is refused before
        # this rule is reached (review round 5, AA1).
        from nirmaan_stack.services.cheques.writer import PUTTING_ON_CHEQUE
        pay.flags[PUTTING_ON_CHEQUE] = True
        with self.assertRaisesRegex(
            frappe.ValidationError, "A Work Order payment is paid Online: only a PO payment can be paid by cheque."
        ):
            pay.save(ignore_permissions=True)
        frappe.db.rollback()
        self.assertEqual(self._payment(name).mode_of_payment, "Online")

    def test_a_wo_cheque_payment_already_in_flight_finishes_as_it_is(self):
        """One requested before the rule keeps saving and moving: CEO approval takes it on."""
        name = self.cheques.plant_payment(
            self.fx, "CEO Pending", project=self.project, vendor=self.vendor, document=(SR, self.sr),
            amount=60000, cheque_no=self.cheques.number(),
        )
        self.cheques.put_on_old_type_cheque(name)  # in flight on a cheque from before the rule
        frappe.set_user(CEO_AUTHORIZED_USER)
        try:
            ceo_approve_payment(name)
            frappe.db.commit()
        finally:
            frappe.set_user(U)
        pay = self._payment(name)
        self.assertEqual((pay.status, pay.mode_of_payment, flt(pay.amount)), (RECON, "Cheque", 58800.0))
        self.assertEqual(self._tds(name), [1200.0])

    # -- the Cheque starts Pending and is Issued on approval (#1479, spec #1477) ----------------
    def test_a_cheque_waiting_for_approval_is_pending_with_no_issue_date(self):
        term = self._term(60000)
        out = self._request_po(term, 60000, **self._cheque_fields(60000))
        [payment] = self._payments_of(PO, self.po)
        self.assertEqual(frappe.db.get_value(PAYMENT, payment, "status"), "CEO Pending")
        self.assertEqual(self._issued(out["cheque"]), ("Approval Pending", None, [(None, "Approval Pending")]))

    def test_a_payment_born_approved_makes_an_issued_cheque_dated_its_approval(self):
        term = self._term(20000)
        out = self._request_po(term, 20000, **self._cheque_fields(20000))
        [payment] = self._payments_of(PO, self.po)
        approved_on = str(frappe.db.get_value(PAYMENT, payment, "approval_date"))
        self.assertEqual(approved_on, nowdate())
        self.assertEqual(self._issued(out["cheque"]), ("Issued", approved_on, [(None, "Approval Pending"), ("Approval Pending", "Issued")]))

    def test_a_born_approved_payment_whose_move_fails_leaves_its_cheque_pending(self):
        term = self._term(20000)
        with patch(
            "nirmaan_stack.services.cheque_payments.move_to_reconciliation", side_effect=RuntimeError("boom")
        ):
            out = self._request_po(term, 20000, **self._cheque_fields(20000))
        [payment] = self._payments_of(PO, self.po)
        self.assertEqual(frappe.db.get_value(PAYMENT, payment, "status"), "Approved")
        self.assertEqual(self._issued(out["cheque"]), ("Approval Pending", None, [(None, "Approval Pending")]))

    def test_an_online_wo_request_makes_no_cheque(self):
        out = self._request_wo(10000)
        self.assertIsNone(out["cheque"])
        pay = self._payment(out["name"])
        self.assertEqual((pay.status, pay.mode_of_payment, pay.cheque), ("Approved", "Online", None))

    # -- the PO page (a payment term) -----------------------------------------------------------
    def test_a_po_cheque_request_makes_the_payment_and_a_one_line_cheque(self):
        term = self._term(20000)
        out = self._request_po(term, 20000, **self._cheque_fields(20000))
        [payment] = self._payments_of(PO, self.po)
        # A PO withholds no tax: raised by an L1 holder, born Approved, then straight on.
        pay = self._payment(payment)
        self.assertEqual((pay.status, flt(pay.amount)), (RECON, 20000.0))
        self.assertEqual(
            tuple(frappe.db.get_value(TERMS, term, ["term_status", "project_payment"])), (RECON, payment)
        )
        self._assert_one_line_cheque(out["cheque"], payment, record=(PO, self.po), amount=20000.0, status="Issued")
        self.assertEqual(self._cheque(out["cheque"]).bank, "ICICI Bank")

    def test_the_cheque_amount_picks_the_approval_a_request_starts_at(self):
        """C3 (#1480): a Rs 20,000 payment on a cheque written for Rs 60,000 is tiered on the cheque. Raised
        by an L1 holder it would be born Approved on its own amount; on the cheque's it waits for the CEO."""
        term = self._term(20000)
        out = self._request_po(term, 20000, **self._cheque_fields(60000))
        [payment] = self._payments_of(PO, self.po)
        self.assertEqual(self._payment(payment).status, "CEO Pending")
        self.assertEqual(self._issued(out["cheque"])[0], "Approval Pending")

    # -- refusals: nothing is created -----------------------------------------------------------
    def test_cheque_mode_without_a_photo_is_refused(self):
        with self.assertRaisesRegex(frappe.ValidationError, "Upload the photo of the cheque"):
            self._request_wo(10000, **self._cheque_fields(9800, cheque_attachment=None))
        frappe.db.rollback()
        self.assertEqual(self._payments_of(SR, self.sr), [])

        term = self._term(20000)
        with self.assertRaisesRegex(frappe.ValidationError, "Upload the photo of the cheque"):
            self._request_po(term, 20000, **self._cheque_fields(20000, cheque_attachment=""))
        frappe.db.rollback()
        self.assertEqual(self._payments_of(PO, self.po), [])
        self.assertEqual(frappe.db.get_value(TERMS, term, "term_status"), "Created")

    def _record_cheque(self, number, *, bank="ICICI Bank", bank_name=None):
        """An Ad-hoc cheque already recorded (before #1482, the report took one)."""
        return self.cheques.plant_cheque(
            bank=bank, bank_name=bank_name, cheque_no=number, cheque_date=nowdate(), amount=5000,
            vendor=self.vendor, description="Advance", attachment=PHOTO,
        )

    def test_a_recorded_bank_and_number_refuses_the_wo_request(self):
        number = self.cheques.number()
        recorded = self._record_cheque(number)
        with self.assertRaises(DuplicateChequeError) as refused:
            self._request_wo(10000, **self._cheque_fields(9800, cheque_no=number))
        frappe.db.rollback()
        self.assertIn(
            f"Cheque {number} (ICICI Bank) already exists. A payment made here gets its own new cheque. "
            f"To put this payment on {number}, request it as Online, then add it to the cheque in "
            "the Cheque Tracker.",
            str(refused.exception),
        )
        self.assertEqual(self._payments_of(SR, self.sr), [])
        self.assertEqual(frappe.get_all("Cheques", filters={"cheque_no": number}, pluck="name"), [recorded])

    def test_a_po_cheque_request_on_another_bank_is_refused_and_nothing_is_made(self):
        """A Payment cheque is drawn on ICICI Bank, the only bank whose statement clears it (#1516)."""
        term = self._term(20000)
        number = self.cheques.number()
        with self.assertRaisesRegex(frappe.ValidationError, "A Payment cheque is drawn on ICICI Bank"):
            self._request_po(
                term, 20000, **self._cheque_fields(20000, cheque_no=number, bank="Others", bank_name="HDFC Bank")
            )
        frappe.db.rollback()
        self.assertEqual(self._payments_of(PO, self.po), [])
        self.assertEqual(
            tuple(frappe.db.get_value(TERMS, term, ["term_status", "project_payment"])), ("Created", None)
        )
        self.assertEqual(frappe.get_all("Cheques", filters={"cheque_no": number}, pluck="name"), [])

    def test_the_same_number_on_another_bank_is_not_a_duplicate(self):
        number = self.cheques.number()
        ChequeFixture.move_to_other_bank(self._record_cheque(self.cheques.number()), "HDFC Bank", cheque_no=number)
        out = self._request_po(self._term(20000), 20000, **self._cheque_fields(20000, cheque_no=number))
        self.assertTrue(out["cheque"])

    def test_a_cheque_recorded_in_between_takes_the_payment_back(self):
        # Another user records the number after the pre-check passed: the Cheque's own validate
        # refuses it, and the payment -- already committed by its after_insert (the CEO's
        # notification) -- is withdrawn.
        number = self.cheques.number()
        self._record_cheque(number)
        # Only the pre-check's lookup is blinded; the Cheques `validate` controller still sees it.
        term = self._term(60000)
        # Deleting a PO payment recounts the Vendor's credit and saves the Vendor, whose hook needs the
        # category JSON every real Vendor carries; the fixture's bare Vendor has none.
        frappe.db.set_value("Vendors", self.vendor, "vendor_category", '{"categories": []}', update_modified=False)
        frappe.db.commit()
        with patch("nirmaan_stack.services.cheques.writer.existing_cheque", return_value=None):
            with self.assertRaises(frappe.ValidationError):
                self._request_po(term, 60000, **self._cheque_fields(60000, cheque_no=number))
        frappe.db.rollback()
        self.assertEqual(self._payments_of(PO, self.po), [])

    # -- the dialog's lookup --------------------------------------------------------------------
    def test_the_dialog_finds_a_recorded_cheque_with_the_submit_refusal(self):
        number = self.cheques.number()
        cheque = self._record_cheque(number)
        found = find_cheque(bank="ICICI Bank", cheque_no=f" {number} ")
        self.assertEqual(
            {k: found[k] for k in ("cheque", "cheque_no", "bank_label", "status")},
            {"cheque": cheque, "cheque_no": number, "bank_label": "ICICI Bank", "status": "Issued"},
        )
        self.assertTrue(found["message"].startswith(f"Cheque {number} (ICICI Bank) already exists."))
        self.assertIsNone(find_cheque(bank="ICICI Bank", cheque_no=self.cheques.number()))
