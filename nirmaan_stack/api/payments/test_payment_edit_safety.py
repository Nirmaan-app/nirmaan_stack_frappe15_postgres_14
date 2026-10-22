# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt
"""Payment edit safety (#1536, spec #1528 stories 42-44).

  * A Desk amount edit is held to the Work Order payment limit, as a new request is (ADR-0030).
  * Fulfilling a payment marks it Paid and recounts its Work Order without saving the Work Order, so a
    Work Order that fails its own validation cannot hold the payment up.
  * Bulk approve names the payments whose tax failed, and Retry TDS (Admin) records it.

Each test acts as a real user of a role profile (`PaymentStepCase._user`) and does what that role does: a
plain `doc.save()` as Desk does, or the endpoint the screen calls.

⚠️ RUNS AGAINST THE SITE DATABASE. Planted by `TaxedWorkOrderFixture` (`TEST-TWO-*`), whose purge sweeps
every payment under its projects.
"""

import json
from unittest.mock import patch

import frappe
from frappe.utils import flt, getdate

from nirmaan_stack.api.payments.bulk_actions import bulk_lead_approve_payments, retry_bulk_deductions
from nirmaan_stack.api.payments.project_payments import update_payment_request
from nirmaan_stack.api.payments.test_payment_steps import WITHIN_L1, PaymentStepCase
from nirmaan_stack.services import payment_tds
from nirmaan_stack.services.role_profiles import ACCOUNTANT_PROFILE, ADMIN_PROFILE

PAYMENT = "Project Payments"
SR = "Service Requests"
CONTROLLER = "nirmaan_stack.integrations.controllers.project_payments"


class EditSafetyCase(PaymentStepCase):
    def setUp(self):
        super().setUp()
        # The payment saves below reach notification fan-outs to every real admin -- keep them off.
        for target in ("_notify_admins_auto_approved", "get_admin_users", "get_allowed_accountants"):
            quiet = patch(f"{CONTROLLER}.{target}", return_value=[])
            quiet.start()
            self.addCleanup(quiet.stop)

    def _plant_on(self, sr, amount, status):
        name = self._plant(amount, status)
        # Re-pointed by raw write at planting; the order's stored figures are not what these tests read.
        frappe.db.set_value(PAYMENT, name, "document_name", sr, update_modified=False)
        frappe.db.commit()
        return name

    def _amount(self, payment):
        return flt(frappe.db.get_value(PAYMENT, payment, "amount"))

    def _edit_amount_as(self, user, payment, amount):
        """The Desk form's save of a new amount."""
        def edit():
            doc = frappe.get_doc(PAYMENT, payment)
            doc.amount = amount
            doc.save()

        self._as(user, edit)


class TestADeskAmountEdit(EditSafetyCase):
    """A Desk edit that lifts a payment above its order's limit is refused (story 43)."""

    def setUp(self):
        super().setUp()
        # Base 1,00,000 + GST 18,000; no GST invoiced, so base payments are capped at 1,00,000. Fully
        # invoiced, so the invoice check passes unless a test plants a Work Order that is not.
        self.wo = self.fx.service_request(self.project, self.vendor, total=118000, gst=True, amount_invoiced=118000)
        # A raise of an approved payment needs the tier its new amount needs (review round 3, V2), so the
        # limit is met by the Admin who may make it; an Accountant's raise is refused before it.
        self.accountant = self._user(ADMIN_PROFILE)

    def _small_wo(self):
        """Base 40,000 + GST: a raise to its limit stays within the L1 limit, which an Accountant may
        make; a raise past ₹50,000 needs the CEO (`payment_steps.raise_step_needed`)."""
        return self.fx.service_request(self.project, self.vendor, total=47200, gst=True, amount_invoiced=47200)

    def test_a_raise_above_base_left_is_refused(self):
        pay = self._plant_on(self._small_wo(), 20000, "Approved")
        with self.assertRaisesRegex(
            frappe.ValidationError, r"Maximum amount you can raise this payment to is ₹ ?40,000.00 \(Base left\)"
        ):
            self._edit_amount_as(self.accountant, pay, 40011)
        self.assertEqual(self._amount(pay), 20000.0)

    def test_a_raise_within_the_tolerance_is_saved(self):
        pay = self._plant_on(self._small_wo(), 20000, "Approved")
        self._edit_amount_as(self.accountant, pay, 40010)
        self.assertEqual(self._amount(pay), 40010.0)

    def test_the_other_payments_on_the_order_count(self):
        self._plant_on(self.wo, 60000, "Paid")
        pay = self._plant_on(self.wo, 30000, "Approved")
        with self.assertRaisesRegex(frappe.ValidationError, r"₹ ?40,000.00 \(Base left\)"):
            self._edit_amount_as(self.accountant, pay, 41000)
        self.assertEqual(self._amount(pay), 30000.0)

    def test_lowering_a_payment_on_an_overpaid_order_is_saved(self):
        """Lowering never takes more of the limit, so an order already paid past it can still be corrected."""
        pay = self._plant_on(self.wo, 130000, "Approved")
        self._edit_amount_as(self.accountant, pay, 120000)
        self.assertEqual(self._amount(pay), 120000.0)

    def test_a_raise_waits_for_invoices_as_a_new_request_does(self):
        """The invoice check (#1488) holds an edit too: raised money elsewhere on the order is already
        more than ₹100 above Total Amount Invoiced, so new money waits for an invoice."""
        wo = self.fx.service_request(self.project, self.vendor, total=118000, gst=True)
        self._plant_on(wo, 20000, "Requested")
        pay = self._plant_on(wo, 10000, "Approved")
        # An Accountant (an Admin skips the invoice check), raising within the auto band, which needs no step.
        with self.assertRaisesRegex(frappe.ValidationError, "in approved invoices"):
            self._edit_amount_as(self._user(ACCOUNTANT_PROFILE), pay, 14000)
        self.assertEqual(self._amount(pay), 10000.0)


class TestFulfilling(EditSafetyCase):
    """Marking a payment Paid recounts its Work Order but does not save it (story 44)."""

    def test_a_work_order_that_fails_its_own_validation_does_not_hold_the_payment_up(self):
        # A Work Order whose vendor link is broken: saving it fails Frappe's link check.
        broken = self.fx.service_request(self.project, f"{self.fx._name('VEN')}-GONE", total=100000)
        accountant = self._user(ACCOUNTANT_PROFILE)
        pay = self._plant_on(broken, WITHIN_L1, "Reconciliation Pending")

        self._as(accountant, update_payment_request, json.dumps({
            "action": "fulfil", "name": pay, "utr": f"UTR-{frappe.generate_hash(length=8)}",
            "pay_date": "2026-10-20",
        }))

        self.assertEqual(self._status(pay), "Paid")
        wo = frappe.db.get_value(SR, broken, ["amount_paid", "latest_payment_date"], as_dict=True)
        self.assertEqual(flt(wo.amount_paid), float(WITHIN_L1))
        self.assertEqual(getdate(wo.latest_payment_date), getdate("2026-10-20"))


class TestRetryTds(EditSafetyCase):
    """Bulk approve names the payments whose tax failed; Retry TDS (Admin) records it (story 42)."""

    def _approve_with_a_failed_deduction(self, admin, victim, others=()):
        real = payment_tds.record_deduction

        def exploding(doc, **kw):
            if doc.name == victim:
                frappe.db.sql('SELECT * FROM "tabNo Such Table Retry Tds"')
            return real(doc, **kw)

        with patch.object(payment_tds, "record_deduction", exploding):
            return self._as(admin, bulk_lead_approve_payments, [victim, *others], "approve")["data"]

    def test_the_failed_payment_is_named_and_retry_records_its_tax(self):
        admin = self._user(ADMIN_PROFILE)
        victim, other = self._plant(WITHIN_L1, "Requested"), self._plant(WITHIN_L1, "Requested")

        result = self._approve_with_a_failed_deduction(admin, victim, [other])

        self.assertEqual(result["tds_failed"], [victim])
        self.assertEqual(self._amount(victim), float(WITHIN_L1))  # still gross

        retried = self._as(admin, retry_bulk_deductions, [victim])

        self.assertEqual((retried["tds_recorded"], retried["tds_failed"]), (1, []))
        self.assertTrue(payment_tds.existing_deduction(victim))
        self.assertEqual(self._amount(victim), WITHIN_L1 * 0.98)
        self.assertEqual(self._amount(other), WITHIN_L1 * 0.98)

    def test_a_retry_that_fails_again_names_the_payment_again(self):
        admin = self._user(ADMIN_PROFILE)
        victim = self._plant(WITHIN_L1, "Approved")
        with patch.object(payment_tds, "record_deduction", side_effect=frappe.ValidationError("still broken")):
            retried = self._as(admin, retry_bulk_deductions, [victim])
        self.assertEqual(retried["tds_failed"], [victim])
        self.assertEqual(self._amount(victim), float(WITHIN_L1))

    def test_a_payment_no_longer_approved_is_not_retried(self):
        admin = self._user(ADMIN_PROFILE)
        paid = self._plant(WITHIN_L1, "Paid")
        retried = self._as(admin, retry_bulk_deductions, [paid])
        self.assertEqual((retried["tds_recorded"], retried["tds_failed"], retried["not_approved"]), (0, [], [paid]))
        self.assertIsNone(payment_tds.existing_deduction(paid))

    def test_an_accountant_cannot_retry(self):
        victim = self._plant(WITHIN_L1, "Approved")
        with self.assertRaisesRegex(frappe.PermissionError, "Only an Admin can retry"):
            self._as(self._user(ACCOUNTANT_PROFILE), retry_bulk_deductions, [victim])
        self.assertIsNone(payment_tds.existing_deduction(victim))


class TestTheLegacyTdsBox(EditSafetyCase):
    """`Project Payments.tds` decides whether a PO payment's tax counts on top (story 53): no user save,
    Desk or REST, sets or changes it, Admin included. The netting patch clears it under `in_patch`."""

    def test_a_user_cannot_fill_or_clear_it(self):
        po = self._po()
        pay = self._plant(WITHIN_L1, "Paid")
        # Planted by raw write, as the 2026-09 backfill left a gross PO payment; no recount: the order's
        # figures are not read here, only the refusal.
        frappe.db.set_value(PAYMENT, pay, {"document_type": "Procurement Orders", "document_name": po, "tds": "600"},
                            update_modified=False)
        frappe.db.commit()
        admin = self._user(ADMIN_PROFILE)
        for value in ("", "900"):
            with self.subTest(value=value):
                def save():
                    doc = frappe.get_doc(PAYMENT, pay)
                    doc.tds = value
                    doc.save()
                with self.assertRaisesRegex(frappe.ValidationError, "legacy TDS box"):
                    self._as(admin, save)
        self.assertEqual(frappe.db.get_value(PAYMENT, pay, "tds"), "600")

    def test_the_same_figure_sent_back_as_text_is_no_change(self):
        pay = self._plant(WITHIN_L1, "Approved")
        frappe.db.set_value(PAYMENT, pay, "tds", "600", update_modified=False)   # the stored box; nothing reads it here
        frappe.db.commit()
        self._save_as_admin_with_tds(pay, "600.0")
        self.assertEqual(frappe.db.get_value(PAYMENT, pay, "tds"), "600.0")

    def _save_as_admin_with_tds(self, pay, value):
        def save():
            doc = frappe.get_doc(PAYMENT, pay)
            doc.tds = value
            doc.save()
        self._as(self._user(ADMIN_PROFILE), save)

    def test_a_save_that_leaves_it_alone_passes(self):
        pay = self._plant(WITHIN_L1, "Approved")
        def save():
            doc = frappe.get_doc(PAYMENT, pay)
            doc.utr = "UTR-LEFT-ALONE"
            doc.save()
        self._as(self._user(ACCOUNTANT_PROFILE), save)
        self.assertEqual(frappe.db.get_value(PAYMENT, pay, "utr"), "UTR-LEFT-ALONE")


class TestNoBackDoorPastTheSteps(EditSafetyCase):
    """Review round 3 (stories 5, 6, 18, 19): a payment's status is one of the six, a raise needs the tier
    its new amount needs, settled money is not rejected by hand, a rejected payment comes back only as an
    approval that fits the order again, and an approved payment stays on its order."""

    def _save_as(self, user, payment, **changes):
        def save():
            doc = frappe.get_doc(PAYMENT, payment)
            doc.update(changes)
            doc.save()
        self._as(user, save)

    def _po_payment(self, amount, status, po=None):
        pay = self._plant(amount, status)
        # Planted by raw write (its creation is not under test). A test that reads the PO's figures (its
        # available balance) sets them itself.
        frappe.db.set_value(PAYMENT, pay, {"document_type": "Procurement Orders", "document_name": po or self._po()},
                            update_modified=False)
        frappe.db.commit()
        return pay

    # V1 ------------------------------------------------------------------------------------------
    def test_a_status_outside_the_six_is_refused(self):
        admin = self._user(ADMIN_PROFILE)
        pay = self._plant(50000, "Approved")
        with self.assertRaisesRegex(frappe.ValidationError, "is not a payment status"):
            self._save_as(admin, pay, status="Hold")
        self.assertEqual(self._status(pay), "Approved")
        with self.assertRaisesRegex(frappe.ValidationError, "is not a payment status"):
            self._as(admin, lambda: frappe.get_doc({"doctype": PAYMENT, "document_type": "Service Requests",
                "document_name": self.sr, "project": self.project, "vendor": self.vendor, "amount": 1000,
                "status": "Hold"}).insert())

    # V2 ------------------------------------------------------------------------------------------
    def test_a_raise_out_of_the_auto_band_needs_an_admin(self):
        pay = self._po_payment(14999, "Approved")
        accountant = self._user(ACCOUNTANT_PROFILE)
        with self.assertRaisesRegex(frappe.ValidationError, "Only an Admin can raise"):
            self._edit_amount_as(accountant, pay, 30000)
        self.assertEqual(self._amount(pay), 14999)
        self._edit_amount_as(accountant, pay, 14000)   # lowering: anyone who may write
        self._edit_amount_as(self._user(ADMIN_PROFILE), pay, 30000)
        self.assertEqual(self._amount(pay), 30000)

    # V3 ------------------------------------------------------------------------------------------
    def test_settled_money_is_not_rejected_by_hand(self):
        admin = self._user(ADMIN_PROFILE)
        for status in ("Paid", "Reconciliation Pending"):
            with self.subTest(status=status):
                pay = self._plant(WITHIN_L1, status)
                with self.assertRaisesRegex(frappe.ValidationError, "can't be rejected"):
                    self._save_as(admin, pay, status="Rejected")
                self.assertEqual(self._status(pay), status)

    def test_a_rejected_work_order_payment_comes_back_only_if_it_fits_the_work_order_again(self):
        admin = self._user(ADMIN_PROFILE)
        wo = self.fx.service_request(self.project, self.vendor, total=100000, amount_invoiced=100000)
        self._plant_on(wo, 90000, "Paid")
        pay = self._plant_on(wo, 20000, "Rejected")
        with self.assertRaisesRegex(frappe.ValidationError, "Base left"):
            self._save_as(admin, pay, status="Approved")
        self.assertEqual(self._status(pay), "Rejected")
        # A Rejected payment still holds its place in the limit (`work_order_payment_limit.is_counted`), so
        # the one that fits is tried once the other is gone.
        frappe.db.delete(PAYMENT, {"name": pay})
        frappe.db.commit()
        fits = self._plant_on(wo, 5000, "Rejected")
        self._save_as(admin, fits, status="Approved")
        self.assertEqual(self._status(fits), "Approved")

    def test_a_rejected_payment_does_not_come_back_to_another_vendor(self):
        admin = self._user(ADMIN_PROFILE)
        wo = self.fx.service_request(self.project, self.vendor, total=100000, amount_invoiced=100000)
        pay = self._plant_on(wo, 5000, "Rejected")
        frappe.db.set_value("Service Requests", wo, "vendor", self.fx.vendor(2.0), update_modified=False)   # the vendor swap an amendment made; no figure hangs off it
        frappe.db.commit()
        with self.assertRaisesRegex(frappe.ValidationError, "raised for"):
            self._save_as(admin, pay, status="Approved")
        self.assertEqual(self._status(pay), "Rejected")

    def test_a_rejected_po_payment_comes_back_only_within_the_po_balance(self):
        admin = self._user(ADMIN_PROFILE)
        po = self._po()
        # The PO's value incl. GST: 50,000. Planted by raw write; its own figures are what is under test.
        frappe.db.set_value("Procurement Orders", po, {"amount": 50000, "tax_amount": 0}, update_modified=False)
        frappe.db.commit()
        self._po_payment(45000, "Paid", po)
        pay = self._po_payment(10000, "Rejected", po)
        with self.assertRaisesRegex(frappe.ValidationError, "available balance"):
            self._save_as(admin, pay, status="Approved")
        fits = self._po_payment(5000, "Rejected", po)
        frappe.db.delete(PAYMENT, {"name": pay})
        frappe.db.commit()
        self._save_as(admin, fits, status="Approved")
        self.assertEqual(self._status(fits), "Approved")

    # V4 ------------------------------------------------------------------------------------------
    def test_an_approved_payment_stays_on_its_order(self):
        accountant = self._user(ACCOUNTANT_PROFILE)
        other = self.fx.service_request(self.project, self.vendor)
        for status in ("Approved", "Paid"):
            with self.subTest(status=status):
                pay = self._plant(WITHIN_L1, status)
                with self.assertRaisesRegex(frappe.ValidationError, "stays on its order"):
                    self._save_as(accountant, pay, document_name=other)
                self.assertEqual(frappe.db.get_value(PAYMENT, pay, "document_name"), self.sr)


class TestTheEndStateHolds(EditSafetyCase):
    """Review round 4 (stories 5, 18, 19, 22, 38): the rules hold for the state a payment ends in, however
    many saves reach it."""

    def _save_as(self, user, payment, **changes):
        def save():
            doc = frappe.get_doc(PAYMENT, payment)
            doc.update(changes)
            doc.save()
        self._as(user, save)

    def _wo(self, total=100000):
        return self.fx.service_request(self.project, self.vendor, total=total, amount_invoiced=total)

    # X1 ------------------------------------------------------------------------------------------
    def test_a_payment_past_requested_keeps_its_vendor(self):
        other = self.fx.vendor(2.0)
        accountant, admin = self._user(ACCOUNTANT_PROFILE), self._user(ADMIN_PROFILE)
        paid = self._plant(WITHIN_L1, "Paid")
        with self.assertRaisesRegex(frappe.ValidationError, "keeps the vendor"):
            self._save_as(accountant, paid, vendor=other)
        wo = self._wo()
        rejected = self._plant_on(wo, 5000, "Rejected")
        # The amendment's vendor swap, by raw write: no figure hangs off the vendor link.
        frappe.db.set_value("Service Requests", wo, "vendor", other, update_modified=False)
        frappe.db.commit()
        with self.assertRaisesRegex(frappe.ValidationError, "keeps the vendor"):
            self._save_as(admin, rejected, status="Paid", vendor=other)
        self.assertEqual(frappe.db.get_value(PAYMENT, rejected, ["status", "vendor"]), ("Rejected", self.vendor))

    # X2 ------------------------------------------------------------------------------------------
    def test_every_approval_checks_the_order_again(self):
        admin = self._user(ADMIN_PROFILE)
        wo = self._wo()
        self._plant_on(wo, 95000, "Paid")
        waiting = self._plant_on(wo, 20000, "Requested")
        with self.assertRaisesRegex(frappe.ValidationError, "Base left"):
            self._save_as(admin, waiting, status="Approved")
        self.assertEqual(self._status(waiting), "Requested")

    def test_an_approval_does_not_land_on_another_vendor(self):
        admin = self._user(ADMIN_PROFILE)
        wo = self._wo()
        waiting = self._plant_on(wo, 5000, "Requested")
        frappe.db.set_value("Service Requests", wo, "vendor", self.fx.vendor(2.0), update_modified=False)   # the swap; nothing derived
        frappe.db.commit()
        with self.assertRaisesRegex(frappe.ValidationError, "raised for"):
            self._save_as(admin, waiting, status="Approved")

    def test_settled_money_does_not_go_backwards_by_hand(self):
        admin = self._user(ADMIN_PROFILE)
        for was, now in (("Paid", "Approved"), ("Paid", "Requested"), ("Paid", "Reconciliation Pending"),
                         ("Reconciliation Pending", "Approved"), ("Reconciliation Pending", "Requested")):
            with self.subTest(was=was, now=now):
                pay = self._plant(WITHIN_L1, was)
                with self.assertRaisesRegex(frappe.ValidationError, "goes back only"):
                    self._save_as(admin, pay, status=now)
                self.assertEqual(self._status(pay), was)

    def test_the_revert_endpoint_still_reverts(self):
        from nirmaan_stack.api.payments.revert_to_approved import revert_payment_to_approved
        pay = self._plant(WITHIN_L1, "Reconciliation Pending")
        self._as(self._user(ACCOUNTANT_PROFILE), revert_payment_to_approved, pay)
        self.assertEqual(self._status(pay), "Approved")

    def test_a_payment_does_not_move_onto_a_work_order_under_amendment_or_of_another_vendor(self):
        accountant = self._user(ACCOUNTANT_PROFILE)
        waiting = self._plant(5000, "Requested")
        amended = self.fx.service_request(self.project, self.vendor)
        frappe.db.set_value("Service Requests", amended, "status", "Amendment", update_modified=False)   # its state only
        others = self.fx.service_request(self.project, self.fx.vendor(2.0))
        frappe.db.commit()
        for target, refusal in ((amended, "under amendment"), (others, "raised for")):
            with self.subTest(target=target):
                with self.assertRaisesRegex(frappe.ValidationError, refusal):
                    self._save_as(accountant, waiting, document_name=target)
                self.assertEqual(frappe.db.get_value(PAYMENT, waiting, "document_name"), self.sr)

    def test_no_payment_comes_back_on_a_work_order_under_amendment(self):
        admin = self._user(ADMIN_PROFILE)
        wo = self._wo()
        pay = self._plant_on(wo, 5000, "Rejected")
        frappe.db.set_value("Service Requests", wo, "status", "Amendment", update_modified=False)   # its state only
        frappe.db.commit()
        with self.assertRaisesRegex(frappe.ValidationError, "under amendment"):
            self._save_as(admin, pay, status="Approved")

    def test_a_requested_payment_keeps_the_vendor_it_was_raised_for(self):
        """X1, all the way: a Rejected payment brought back to Requested (L1) whose vendor were then changed
        would reach an approval whose vendor check reads that changed vendor. The vendor is set once."""
        wo = self._wo()
        pay = self._plant_on(wo, 5000, "Requested")
        with self.assertRaisesRegex(frappe.ValidationError, "keeps the vendor"):
            self._save_as(self._user(ADMIN_PROFILE), pay, vendor=self.fx.vendor(2.0))
        self.assertEqual(frappe.db.get_value(PAYMENT, pay, "vendor"), self.vendor)

    def test_no_rejected_payment_is_asked_for_again_on_a_work_order_under_amendment(self):
        """X2(e), story 22: Rejected -> Requested (or CEO Pending) is a payment request again."""
        admin = self._user(ADMIN_PROFILE)
        wo = self._wo()
        pay = self._plant_on(wo, 5000, "Rejected")
        frappe.db.set_value("Service Requests", wo, "status", "Amendment", update_modified=False)   # its state only
        frappe.db.commit()
        for status in ("Requested", "CEO Pending"):
            with self.subTest(status=status):
                with self.assertRaisesRegex(frappe.ValidationError, "under amendment"):
                    self._save_as(admin, pay, status=status)
                self.assertEqual(self._status(pay), "Rejected")

    # X5 ------------------------------------------------------------------------------------------
    def test_a_padded_status_is_refused(self):
        pay = self._plant(WITHIN_L1, "Approved")
        with self.assertRaisesRegex(frappe.ValidationError, "is not a payment status"):
            self._save_as(self._user(ACCOUNTANT_PROFILE), pay, status="Paid ")
        self.assertEqual(self._status(pay), "Approved")

    def test_a_stored_unknown_status_moves_on_only_with_the_tier_its_amount_needs(self):
        pay = self._plant(60000, "Hold")   # a status saved before the rule, by raw write
        with self.assertRaisesRegex(frappe.ValidationError, "Only the CEO can move a payment from Hold"):
            self._save_as(self._user(ADMIN_PROFILE), pay, status="Paid")
        self.assertEqual(self._status(pay), "Hold")

    def test_a_stored_padded_status_is_unknown_too(self):
        """A padded "Paid " saved before the rule is no status of the six: its move on needs the tier its
        amount needs, not the L1 correction a "Paid" would."""
        pay = self._plant(60000, "Paid ")
        with self.assertRaisesRegex(frappe.ValidationError, "Only the CEO can move a payment from Paid"):
            self._save_as(self._user(ADMIN_PROFILE), pay, status="Approved")
        self.assertEqual(self._status(pay), "Paid ")

    # X6 ------------------------------------------------------------------------------------------
    def test_turning_a_payment_into_a_cheque_does_not_unlock_rejecting_settled_money(self):
        """The cheque exemption reads the mode before the save: a save that also puts an Online payment on
        a Cheque is no cheque payment yet."""
        pay = self._plant(WITHIN_L1, "Reconciliation Pending")
        cheque = f"TEST-RND4-CHQ-{frappe.generate_hash(length=6)}"
        # A Cheque row to link to, by raw write; its own figures are not what this test reads.
        frappe.db.sql(
            """INSERT INTO "tabCheques" (name, creation, modified, modified_by, owner, docstatus, idx, status)
               VALUES (%s, NOW(), NOW(), 'Administrator', 'Administrator', 0, 0, 'Issued')""",
            (cheque,),
        )
        frappe.db.commit()
        self.addCleanup(self._drop_cheque, cheque)
        with self.assertRaisesRegex(frappe.ValidationError, "can't be rejected"):
            self._save_as(self._user(ADMIN_PROFILE), pay, status="Rejected", mode_of_payment="Cheque",
                          cheque=cheque, cheque_no="004522", cheque_date="2026-10-22")
        self.assertEqual(self._status(pay), "Reconciliation Pending")

    @staticmethod
    def _drop_cheque(name):
        frappe.db.rollback()
        frappe.db.delete("Cheques", {"name": name})
        frappe.db.commit()
