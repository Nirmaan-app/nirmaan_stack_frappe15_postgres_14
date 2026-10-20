# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Editing a Payment cheque from the Cheque Tracker: the rules by status, by where it was made and by who
made it (#1418, spec #1407; #1482, spec #1477).

Drives `save_cheque` with `name` (the edit path) the way the Edit Cheque dialog does: it loads the
Cheque through the detail endpoint, changes what the user changed, and sends the whole Cheque back.
It reads back what a user sees: the Cheque, its lines, each payment's mode, Cheque and status, or the
refusal and that nothing changed.

A Payment cheque's lines change only while it is Pending; Issued, Cleared and Cancelled cheques change
only their photo. Procurement edits only the Pending cheques it created.

⚠️ RUNS AGAINST THE ENV DATABASE (the endpoints commit). Projects, vendors and payments come from
`TaxedWorkOrderFixture`, POs from `ChequeFixture.plant_po`; every Cheque carries a TESTCHQ number and is
purged by `ChequeFixture`.
"""

import json
from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import add_days, flt, nowdate

from nirmaan_stack.api.cheques.cheque_detail import get_cheque
from nirmaan_stack.api.cheques.cheque_fixture import ChequeFixture
from nirmaan_stack.api.cheques.save_cheque import save_cheque
from nirmaan_stack.api.payments.taxed_work_order_fixture import TaxedWorkOrderFixture
from nirmaan_stack.services.cheque_payments import commit_move_to_reconciliation
from nirmaan_stack.services.cheques.rules import parse_header
from nirmaan_stack.services.cheques.writer import create_payment_cheque

U = "Administrator"
PAYMENT = "Project Payments"
PO = "Procurement Orders"
SR = "Service Requests"
PO_WO_LINE = "PO/WO Payment"
NPE_LINE = "Non-project Expense"
RECON = "Reconciliation Pending"
PHOTO = "https://storage.example.invalid/private/files/cheque-edit-test.jpg"
NEW_PHOTO = "https://storage.example.invalid/private/files/cheque-edit-test-2.jpg"
CONTROLLER = "nirmaan_stack.integrations.controllers.project_payments"
PROCUREMENT = (
    "Nirmaan Procurement Executive Profile",
    "Nirmaan Procurement Lead Profile",
    "Nirmaan Material Procurement Executive Profile",
    "Nirmaan Service Procurement Executive Profile",
)
ACCOUNTANT = ("Nirmaan Accountant Profile",)
HEADER = ("bank", "bank_name", "cheque_no", "cheque_date", "amount", "vendor", "payee_name", "description", "attachment")
LINE = ("line_type", "project", "record_doctype", "record_name", "payment_name", "amount")


class TestChequeEdit(FrappeTestCase):
    def setUp(self):
        frappe.set_user(U)
        self.fx = TaxedWorkOrderFixture.attach(self)
        self.cheques = ChequeFixture.attach(self)
        self.vendor = self.fx.vendor(2.0)
        self.project = self.fx.project()
        self.po = ChequeFixture.plant_po(self, self.fx, project=self.project, vendor=self.vendor)
        frappe.db.commit()  # a refusal below rolls back; the planted rows must outlive it
        # The admin note reaches every real admin, and a push reaches real phones: keep both off.
        for target in ("_notify_admins_auto_approved", "PrNotification"):
            quiet = patch(f"{CONTROLLER}.{target}")
            quiet.start()
            self.addCleanup(quiet.stop)

    def tearDown(self):
        frappe.set_user(U)

    # -- planting -------------------------------------------------------------------------------
    def _plant(self, status, *, amount=20000, parent=None):
        """An Online payment of the PO already sitting at `status` (raw insert: no approval hook runs)."""
        return self.cheques.plant_payment(
            self.fx, status, project=self.project, vendor=self.vendor, document=parent or (PO, self.po), amount=amount
        )

    def _line(self, payment=None, *, amount=None, record=None):
        record_doctype, record_name = record or (PO, self.po)
        line = {"line_type": PO_WO_LINE, "project": self.project, "record_doctype": record_doctype,
                "record_name": record_name}
        if payment:
            line["payment_name"] = payment
        if amount is not None:
            line["amount"] = amount
        return line

    def _add(self, lines=None, **overrides):
        """A Payment cheque made in the Tracker (Add Cheque); one line with no payment yet unless given."""
        values = {
            "bank": "ICICI Bank",
            "cheque_no": self.cheques.number(),
            "cheque_date": nowdate(),
            "amount": 50000,
            "vendor": self.vendor,
            "description": "Advance on the PO",
            "attachment": PHOTO,
            "lines": json.dumps(list(lines) if lines is not None else [self._line(amount=50000)]),
        }
        values.update(overrides)
        out = save_cheque(**{k: v for k, v in values.items() if v is not None})
        return self.cheques.track(out["cheque"])

    def _from_po_page(self, payment, amount=20000):
        """A Cheque made from the PO page: the one-line Cheque Request Payment makes for its payment, then
        the move an approved payment takes once that is on disk."""
        header = parse_header({
            "bank": "ICICI Bank",
            "cheque_no": self.cheques.number(),
            "cheque_date": nowdate(),
            "amount": amount,
            "vendor": self.vendor,
            "attachment": PHOTO,
        })
        name = self.cheques.track(create_payment_cheque(header, payment, user=U).name)
        frappe.db.commit()
        commit_move_to_reconciliation(payment)
        return name

    # -- the edit dialog ------------------------------------------------------------------------
    @staticmethod
    def _loaded(name):
        """What the Edit dialog loads: the Cheque as the detail endpoint sends it."""
        cheque = get_cheque(name)
        header = {field: cheque.get(field) for field in HEADER}
        header["cheque_date"] = str(header["cheque_date"])
        lines = [{field: line.get(field) for field in LINE if line.get(field) is not None} for line in cheque["lines"]]
        return header, lines

    def _edit(self, name, *, lines=None, **changes):
        """Load the Cheque, change what the user changed, and save it all back."""
        header, loaded = self._loaded(name)
        header.update(changes)
        args = {k: v for k, v in header.items() if v is not None}
        args["lines"] = json.dumps(loaded if lines is None else lines)
        return save_cheque(name=name, **args)

    def _refused(self, phrase, name, *, exc=frappe.ValidationError, **kwargs):
        before = self._snapshot(name)
        with self.assertRaisesRegex(exc, phrase):
            self._edit(name, **kwargs)
        frappe.db.rollback()
        self.assertEqual(self._snapshot(name), before, "a refused edit changed nothing")

    def _snapshot(self, name):
        return self._loaded(name), self._cheque(name).status

    def _cheque(self, name):
        return frappe.get_doc("Cheques", name)

    def _payment(self, name):
        return frappe.db.get_value(
            PAYMENT, name, ["status", "mode_of_payment", "cheque", "cheque_no", "cheque_date"], as_dict=True
        )

    def _user(self, profiles, *, other_than=None):
        for user in frappe.get_all(
            "Nirmaan Users", filters={"role_profile": ["in", list(profiles)]}, pluck="name", limit=20
        ):
            if user and user not in (U, other_than) and frappe.db.exists("User", user):
                return user
        self.skipTest(f"no user with {profiles} on this site")

    def _as(self, user, fn, *args, **kwargs):
        previous = frappe.session.user
        frappe.set_user(user)
        try:
            return fn(*args, **kwargs)
        finally:
            frappe.set_user(previous)

    # -- a Tracker-made Pending cheque ----------------------------------------------------------
    def test_a_pending_cheque_can_change_every_field_and_its_lines(self):
        pay = self._plant("Requested")
        name = self._add([self._line(amount=10000)])
        number, date = self.cheques.number(), add_days(nowdate(), 5)

        out = self._edit(
            name,
            cheque_no=number,
            cheque_date=date,
            amount=23000,
            description="Two PO payments",
            attachment=NEW_PHOTO,
            lines=[self._line(pay), self._line(amount=3000)],
        )
        self.assertEqual((out["cheque"], out["status"]), (name, "Pending"))
        cheque = self._cheque(name)
        self.assertEqual(
            (cheque.bank, cheque.bank_name, cheque.cheque_no, str(cheque.cheque_date), flt(cheque.amount)),
            ("ICICI Bank", None, number, date, 23000.0),
        )
        self.assertEqual((cheque.description, cheque.attachment), ("Two PO payments", NEW_PHOTO))
        self.assertEqual([(l.payment_name, flt(l.amount)) for l in cheque.lines], [(pay, 20000.0), (None, 3000.0)])
        self.assertEqual((cheque.status, cheque.made_from), ("Pending", "Report"))
        self.assertEqual((self._payment(pay).mode_of_payment, self._payment(pay).cheque), ("Cheque", name))

    def test_a_payment_cheque_cannot_be_moved_to_another_bank(self):
        # Only ICICI Bank's statement clears a cheque (#1516).
        name = self._add()
        self._refused("A Payment cheque is drawn on ICICI Bank", name, bank="Others", bank_name="HDFC Bank")

    def test_a_new_number_and_date_are_copied_onto_its_payments(self):
        pay = self._plant("Requested")
        name = self._add([self._line(pay)])
        number, date = self.cheques.number(), add_days(nowdate(), 3)
        self._edit(name, cheque_no=number, cheque_date=date)
        state = self._payment(pay)
        self.assertEqual((state.cheque, state.cheque_no, str(state.cheque_date)), (name, number, date))

    def test_a_typed_payee_or_a_cheque_with_no_lines_is_refused(self):
        pay = self._plant("Requested")
        name = self._add([self._line(pay)])
        self._refused("made out to a Vendor", name, vendor=None, payee_name="Tata Power")
        self._refused("Add at least one PO payment", name, lines=[])
        self.assertEqual((self._payment(pay).mode_of_payment, self._payment(pay).cheque), ("Cheque", name))

    def test_a_work_order_or_expense_line_added_on_edit_is_refused(self):
        sr = self.fx.service_request(self.project, self.vendor)
        frappe.db.commit()
        name = self._add()
        _, lines = self._loaded(name)
        self._refused("Line 2: a Payment cheque pays PO payments only", name,
                      lines=lines + [self._line(amount=100, record=(SR, sr))])
        self._refused("Line 2: a Payment cheque pays PO payments only", name,
                      lines=lines + [{"line_type": NPE_LINE, "payment_name": "NPE-ANY", "amount": 100}])

    # -- adding a payment on edit -----------------------------------------------------------------
    def test_a_payment_added_on_edit_converts_at_its_step(self):
        first = self._plant("Requested")
        second = self._plant("Requested")
        name = self._add([self._line(first)])

        self._edit(name, lines=[self._line(first), self._line(second)])
        for pay in (first, second):
            state = self._payment(pay)
            self.assertEqual((state.mode_of_payment, state.cheque, state.status), ("Cheque", name, "Requested"))
        self.assertEqual(self._cheque(name).status, "Pending")

    def test_a_payment_at_another_step_than_the_cheques_is_refused(self):
        requested = self._plant("Requested")
        approved = self._plant("Approved")
        name = self._add([self._line(requested)])
        self._refused(f"same step: {requested} is Requested, {approved} is Approved", name,
                      lines=[self._line(requested), self._line(approved)])
        self.assertEqual(self._payment(approved).mode_of_payment, "Online")

    def test_an_approved_payment_picked_for_the_last_open_line_issues_the_cheque(self):
        pay = self._plant("Approved")
        name = self._add([self._line(amount=20000)], amount=20000)
        self.assertEqual(self._cheque(name).status, "Pending")

        out = self._edit(name, lines=[self._line(pay, amount=20000)])
        self.assertEqual([l.payment_name for l in self._cheque(name).lines], [pay])
        self.assertEqual(self._payment(pay).status, RECON)
        self.assertEqual((out["status"], self._cheque(name).status), ("Issued", "Issued"))

    # -- removing lines -------------------------------------------------------------------------
    def test_a_payment_taken_off_a_pending_cheque_goes_back_to_online_at_its_step(self):
        payments = [self._plant("CEO Pending", amount=60000), self._plant("CEO Pending", amount=60000)]
        name = self._add([self._line(pay) for pay in payments], amount=120000)

        self._edit(name, lines=[self._line(payments[1])])
        state = self._payment(payments[0])
        self.assertEqual(
            (state.mode_of_payment, state.cheque, state.cheque_no, state.status), ("Online", None, None, "CEO Pending")
        )
        notes = [row.note for row in self._cheque(name).status_history]
        self.assertIn(f"Payment {payments[0]} was taken off the cheque, so it switched back to Online.", notes)
        self.assertEqual(self._cheque(name).status, "Pending")

    def test_swapping_a_line_s_payment_takes_the_old_one_off(self):
        pay = self._plant("Requested")
        other = self._plant("Requested")
        name = self._add([self._line(pay)])

        self._edit(name, lines=[self._line(other)])
        self.assertEqual((self._payment(pay).mode_of_payment, self._payment(pay).cheque), ("Online", None))
        self.assertEqual((self._payment(other).mode_of_payment, self._payment(other).cheque), ("Cheque", name))

    def test_a_payment_still_on_its_pending_cheque_cannot_go_online_by_itself(self):
        pay = self._plant("Requested")
        self._add([self._line(pay)])
        doc = frappe.get_doc(PAYMENT, pay)
        doc.update({"mode_of_payment": "Online", "cheque": None})
        with self.assertRaisesRegex(frappe.ValidationError, "only once its Cheque is Cancelled"):
            doc.save(ignore_permissions=True)
        frappe.db.rollback()

    # -- a PO-page Pending cheque ---------------------------------------------------------------
    def test_a_po_page_cheque_can_change_its_lines(self):
        first = self._plant("Requested")
        second = self._plant("Requested")
        name = self._from_po_page(first)
        _, lines = self._loaded(name)

        self._edit(name, lines=lines + [self._line(second)], description="Two PO payments")
        self.assertEqual([l.payment_name for l in self._cheque(name).lines], [first, second])
        self.assertEqual(self._payment(second).cheque, name)

    def test_a_po_page_cheque_keeps_its_number_date_and_amount(self):
        pay = self._plant("Requested")
        name = self._from_po_page(pay)
        reason = "made from the PO/WO page, so its .* cannot change here: change (it|them) on the payment"
        self._refused(reason, name, cheque_no=self.cheques.number())
        self._refused(reason, name, cheque_date=add_days(nowdate(), 1))
        self._refused(reason, name, amount=19000)

    def test_a_po_page_cheque_with_no_payment_left_can_change_its_number_date_and_amount(self):
        pay = self._plant("Requested")
        name = self._from_po_page(pay)
        self._edit(name, lines=[self._line(amount=20000)])  # its one payment comes off

        number, date = self.cheques.number(), add_days(nowdate(), 3)
        self._edit(name, cheque_no=number, cheque_date=date, amount=15000)
        cheque = self._cheque(name)
        self.assertEqual((cheque.cheque_no, str(cheque.cheque_date), flt(cheque.amount)), (number, date, 15000))
        self.assertEqual(cheque.made_from, "PO/WO Page")
        self.assertEqual((self._payment(pay).mode_of_payment, self._payment(pay).status), ("Online", "Requested"))

    # -- Issued, Cleared or Cancelled -------------------------------------------------------------
    def test_an_issued_cleared_or_cancelled_cheque_can_change_only_its_photo(self):
        for to_status in ("Issued", "Cleared", "Cancelled"):
            name = self._add([self._line(self._plant("Approved"))], amount=20000)
            self.assertEqual(self._cheque(name).status, "Issued")  # its payment was approved
            if to_status != "Issued":
                # Raw on purpose: the Clear and Cancel operations are other tickets'; this is only their outcome.
                frappe.db.set_value("Cheques", name, "status", to_status)
                frappe.db.commit()
            reason = f"is {to_status}: only its photo can change"
            self._refused(reason, name, description="changed")
            self._refused(reason, name, cheque_no=self.cheques.number())
            self._refused(reason, name, lines=[self._line(amount=100)])

            self._edit(name, attachment=NEW_PHOTO)
            self.assertEqual((self._cheque(name).attachment, self._cheque(name).status), (NEW_PHOTO, to_status))

    def test_an_old_type_cheque_can_change_only_its_photo(self):
        """Spec #1477 (#1487): an Old-type cheque is only cleared or cancelled by hand; its photo may be replaced."""
        name = self.cheques.plant_cheque(  # an Ad-hoc cheque to a typed payee, as the report made one
            status="Pending", bank="ICICI Bank", cheque_no=self.cheques.number(), cheque_date=nowdate(),
            amount=5000, payee_name="Ravi Kumar", description="Rent", attachment=PHOTO,
        )
        frappe.db.set_value("Cheques", name, "old_type", 1)  # what the cheque-types patch flags
        frappe.db.commit()

        reason = "is an Old-type cheque: only its photo can change"
        self._refused(reason, name, description="changed")
        self._refused(reason, name, cheque_no=self.cheques.number())
        self._refused(reason, name, payee_name="Ravi K")
        self._refused(reason, name, lines=[self._line(amount=5000)])

        self._edit(name, attachment=NEW_PHOTO)
        self.assertEqual(self._cheque(name).attachment, NEW_PHOTO)

    def test_a_backfilled_cheque_with_no_photo_gets_its_photo(self):
        name = self.cheques.plant_cheque(
            bank="ICICI Bank", cheque_no=self.cheques.number(), cheque_date=nowdate(), amount=100,
            vendor=self.vendor, attachment=PHOTO, lines=[self._line(amount=100)],
        )
        frappe.db.set_value("Cheques", name, {"attachment": None, "made_from": "PO/WO Page", "status": "Cleared"})
        frappe.db.commit()  # what the backfill leaves: no photo, made from the PO/WO page

        self._edit(name, attachment=NEW_PHOTO)
        self.assertEqual(self._cheque(name).attachment, NEW_PHOTO)

    def test_the_photo_can_be_replaced_not_removed(self):
        name = self._add()
        self._refused("photo can be replaced, not removed", name, attachment=None)

    # -- who ------------------------------------------------------------------------------------
    def test_procurement_edits_only_its_own_pending_cheques(self):
        buyer = self._user(PROCUREMENT)
        own = self._as(buyer, self._add)
        self._as(buyer, self._edit, own, description="Fixed my typo")
        self.assertEqual(self._cheque(own).description, "Fixed my typo")

        someone_elses = self._add()
        with self.assertRaisesRegex(frappe.PermissionError, "only the Pending cheques you created"):
            self._as(buyer, self._edit, someone_elses, description="not mine")
        frappe.db.rollback()

        issued = self._as(buyer, self._add, [self._line(self._plant("Approved"))], amount=20000)
        self.assertEqual(self._cheque(issued).status, "Issued")
        with self.assertRaisesRegex(frappe.PermissionError, "only the Pending cheques you created"):
            self._as(buyer, self._edit, issued, attachment=NEW_PHOTO)
        frappe.db.rollback()

    def test_accounts_edit_anyones_cheque(self):
        accountant = self._user(ACCOUNTANT)
        buyer = self._user(PROCUREMENT)
        theirs = self._as(buyer, self._add)
        self._as(accountant, self._edit, theirs, description="Checked by accounts")
        self.assertEqual(self._cheque(theirs).description, "Checked by accounts")

    def test_editing_a_cheque_that_does_not_exist_is_refused(self):
        with self.assertRaises(frappe.DoesNotExistError):
            save_cheque(
                name="CHQ-NOPE-00000", bank="ICICI Bank", cheque_no=self.cheques.number(), cheque_date=nowdate(),
                amount=100, vendor=self.vendor, description="x", attachment=PHOTO,
            )
        frappe.db.rollback()
