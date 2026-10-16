# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Editing a Cheque from the report: the rules by status, by where it was made and by who made it
(#1418, spec #1407).

Drives `save_cheque` with `name` (the edit path) the way the Edit Cheque dialog does: it loads the
Cheque through the detail endpoint, changes what the user changed, and sends the whole Cheque back.
It reads back what a user sees: the Cheque, its lines, each payment's mode, Cheque and status, or the
refusal and that nothing changed.

⚠️ RUNS AGAINST THE ENV DATABASE (the endpoints commit). Projects, vendors, Work Orders and payments
come from `TaxedWorkOrderFixture`; every Cheque carries a TESTCHQ number and is purged by `ChequeFixture`.
"""

import json
from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import add_days, flt, nowdate

from nirmaan_stack.api.cheques.cheque_detail import get_cheque
from nirmaan_stack.api.cheques.cheque_fixture import ChequeFixture
from nirmaan_stack.api.cheques.cheque_status import change_cheque_status
from nirmaan_stack.api.cheques.save_cheque import save_cheque
from nirmaan_stack.api.payments.taxed_work_order_fixture import TaxedWorkOrderFixture
from nirmaan_stack.services.cheque_payments import commit_move_to_reconciliation
from nirmaan_stack.services.cheques.rules import parse_header
from nirmaan_stack.services.cheques.writer import create_payment_cheque

U = "Administrator"
PAYMENT = "Project Payments"
SR = "Service Requests"
NPE = "Non Project Expenses"
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
        self.other_vendor = self.fx.vendor(2.0)
        self.project = self.fx.project()
        self.sr = self.fx.service_request(self.project, self.vendor)
        frappe.db.commit()  # a refusal below rolls back; the planted rows must outlive it
        # The admin note reaches every real admin, and a push reaches real phones: keep both off.
        for target in ("_notify_admins_auto_approved", "PrNotification"):
            quiet = patch(f"{CONTROLLER}.{target}")
            quiet.start()
            self.addCleanup(quiet.stop)

    def tearDown(self):
        frappe.set_user(U)

    # -- planting -------------------------------------------------------------------------------
    def _plant(self, status, *, amount=20000):
        """An Online payment already sitting at `status` (raw insert: no approval hook runs)."""
        return self.cheques.plant_payment(
            self.fx, status, project=self.project, vendor=self.vendor, document=(SR, self.sr), amount=amount
        )

    def _npe(self, amount=4000):
        """A bare Non Project Expense (raw insert: no expense hook runs)."""
        name = f"TEST-CHQE-{frappe.generate_hash(length=10)}"
        frappe.db.sql(
            """INSERT INTO "tabNon Project Expenses" (name, creation, modified, modified_by, owner,
                   docstatus, idx, amount, status, description)
               VALUES (%s, NOW(), NOW(), %s, %s, 0, 0, %s, 'Approved', 'cheque edit test')""",
            (name, U, U, flt(amount)),
        )
        self.addCleanup(
            ChequeFixture.purge_rows, [("Version", {"ref_doctype": NPE, "docname": name}), (NPE, {"name": name})]
        )
        frappe.db.commit()
        return name

    def _wo_line(self, payment=None, *, amount=None):
        line = {"line_type": PO_WO_LINE, "project": self.project, "record_doctype": SR, "record_name": self.sr}
        if payment:
            line["payment_name"] = payment
        if amount is not None:
            line["amount"] = amount
        return line

    @staticmethod
    def _npe_line(expense):
        return {"line_type": NPE_LINE, "payment_name": expense}

    def _add(self, lines=(), **overrides):
        """A Cheque made on the report page (Add Cheque)."""
        values = {
            "bank": "ICICI Bank",
            "cheque_no": self.cheques.number(),
            "cheque_date": nowdate(),
            "amount": 50000,
            "vendor": self.vendor,
            "description": "Advance on the WO",
            "attachment": PHOTO,
            "lines": json.dumps(list(lines)),
        }
        values.update(overrides)
        out = save_cheque(**{k: v for k, v in values.items() if v is not None})
        return self.cheques.track(out["cheque"])

    def _from_po_page(self, payment, amount=20000):
        """A Cheque made from the PO / Work Order page: the one-line Cheque Request Payment makes for its
        payment, then the move an approved payment takes once that is on disk."""
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
        return self._loaded(name)

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

    # -- a report-made Issued Cheque ------------------------------------------------------------
    def test_a_report_made_issued_cheque_can_change_every_field_and_its_lines(self):
        pay = self._plant("Requested")
        expense = self._npe(3000)
        name = self._add([self._wo_line(amount=10000), self._npe_line(expense)])
        number, date = self.cheques.number(), add_days(nowdate(), 5)

        out = self._edit(
            name,
            bank="Others",
            bank_name="HDFC Bank",
            cheque_no=number,
            cheque_date=date,
            amount=23000,
            vendor=None,
            payee_name="Tata Power",
            description="Power and a deposit",
            attachment=NEW_PHOTO,
            lines=[self._npe_line(expense)],
        )
        self.assertEqual(out["cheque"], name)
        cheque = self._cheque(name)
        self.assertEqual(
            (cheque.bank, cheque.bank_name, cheque.cheque_no, str(cheque.cheque_date), flt(cheque.amount)),
            ("Others", "HDFC Bank", number, date, 23000.0),
        )
        self.assertEqual((cheque.vendor, cheque.payee_name), (None, "Tata Power"))
        self.assertEqual((cheque.description, cheque.attachment), ("Power and a deposit", NEW_PHOTO))
        self.assertEqual([(l.line_type, l.payment_name) for l in cheque.lines], [(NPE_LINE, expense)])
        self.assertEqual((cheque.status, cheque.made_from), ("Issued", "Report"))
        self.assertEqual(self._payment(pay).mode_of_payment, "Online")  # never on it

    def test_a_new_number_and_date_are_copied_onto_its_payments(self):
        pay = self._plant("Requested")
        name = self._add([self._wo_line(pay)])
        number, date = self.cheques.number(), add_days(nowdate(), 3)
        self._edit(name, cheque_no=number, cheque_date=date)
        state = self._payment(pay)
        self.assertEqual((state.cheque, state.cheque_no, str(state.cheque_date)), (name, number, date))

    # -- adding a payment on edit converts it ---------------------------------------------------
    def test_a_payment_added_on_edit_converts_and_moves_per_its_status(self):
        approved = self._plant("Approved")
        requested = self._plant("Requested")
        name = self._add([self._wo_line(amount=5000)])

        self._edit(name, lines=[self._wo_line(approved), self._wo_line(requested)])
        for pay, status in ((approved, RECON), (requested, "Requested")):
            state = self._payment(pay)
            self.assertEqual((state.mode_of_payment, state.cheque, state.status), ("Cheque", name, status))

    def test_a_line_with_no_payment_gets_its_payment_later(self):
        pay = self._plant("Approved")
        name = self._add([self._wo_line(amount=20000)])
        self._edit(name, lines=[self._wo_line(pay, amount=20000)])
        self.assertEqual([l.payment_name for l in self._cheque(name).lines], [pay])
        self.assertEqual(self._payment(pay).status, RECON)

    # -- removing lines -------------------------------------------------------------------------
    def test_lines_with_no_payment_and_expense_lines_can_be_removed(self):
        expense = self._npe()
        name = self._add([self._wo_line(amount=5000), self._npe_line(expense)])
        self._edit(name, lines=[])
        self.assertEqual(self._cheque(name).lines, [])

    def test_a_payment_taken_off_an_issued_cheque_switches_back_to_online(self):
        # Owner ruling (story 82): at any status, Paid included, the status stays as it is.
        payments = {status: self._plant(status) for status in ("Requested", RECON, "Paid")}
        name = self._add([self._wo_line(pay) for pay in payments.values()])

        self._edit(name, lines=[])
        self.assertEqual(self._cheque(name).lines, [])
        for status, pay in payments.items():
            state = self._payment(pay)
            self.assertEqual(
                (state.mode_of_payment, state.cheque, state.cheque_no, state.status), ("Online", None, None, status)
            )
        notes = [row.note for row in self._cheque(name).status_history]
        for pay in payments.values():
            self.assertIn(f"Payment {pay} was taken off the cheque, so it switched back to Online.", notes)
        self.assertEqual(self._cheque(name).status, "Issued")

    def test_swapping_a_line_s_payment_takes_the_old_one_off(self):
        pay = self._plant("Requested")
        other = self._plant("Requested")
        name = self._add([self._wo_line(pay)])

        self._edit(name, lines=[self._wo_line(other)])
        self.assertEqual((self._payment(pay).mode_of_payment, self._payment(pay).cheque), ("Online", None))
        self.assertEqual((self._payment(other).mode_of_payment, self._payment(other).cheque), ("Cheque", name))

    def test_a_payment_still_on_its_issued_cheque_cannot_go_online_by_itself(self):
        pay = self._plant("Requested")
        self._add([self._wo_line(pay)])
        doc = frappe.get_doc(PAYMENT, pay)
        doc.update({"mode_of_payment": "Online", "cheque": None})
        with self.assertRaisesRegex(frappe.ValidationError, "only once its Cheque is Cancelled"):
            doc.save(ignore_permissions=True)
        frappe.db.rollback()

    def test_a_cheque_left_with_no_lines_still_needs_a_description(self):
        pay = self._plant("Requested")
        name = self._add([self._wo_line(pay)], description=None)
        self._refused("Ad-hoc cheque: write a description", name, lines=[])
        self.assertEqual((self._payment(pay).mode_of_payment, self._payment(pay).cheque), ("Cheque", name))

    # -- a PO-page Issued Cheque ----------------------------------------------------------------
    def test_a_po_page_cheque_can_change_its_lines(self):
        first = self._plant("Requested")
        second = self._plant("Approved")
        name = self._from_po_page(first)
        _, lines = self._loaded(name)

        self._edit(name, lines=lines + [self._wo_line(second)], description="Two WO payments")
        self.assertEqual([l.payment_name for l in self._cheque(name).lines], [first, second])
        self.assertEqual(self._payment(second).status, RECON)

    def test_a_po_page_cheque_s_payment_can_come_off(self):
        pay = self._plant("Approved")
        name = self._from_po_page(pay)
        self._edit(name, lines=[], description="Kept as an advance")
        self.assertEqual((self._payment(pay).mode_of_payment, self._payment(pay).cheque), ("Online", None))
        self.assertEqual(self._payment(pay).status, RECON)  # where the cheque move took it

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
        self._edit(name, lines=[], description="Kept as an advance")  # its one payment comes off

        number, date = self.cheques.number(), add_days(nowdate(), 3)
        self._edit(name, cheque_no=number, cheque_date=date, amount=15000)
        cheque = self._cheque(name)
        self.assertEqual((cheque.cheque_no, str(cheque.cheque_date), flt(cheque.amount)), (number, date, 15000))
        self.assertEqual(cheque.made_from, "PO/WO Page")

    # -- Cleared or Cancelled -------------------------------------------------------------------
    def test_a_cleared_or_cancelled_cheque_can_change_only_its_photo(self):
        pay = self._plant("Requested")
        expense = self._npe()
        for to_status, note in (("Cleared", None), ("Cancelled", "torn up")):
            name = self._add([self._wo_line(pay)] if to_status == "Cleared" else [self._npe_line(expense)])
            change_cheque_status(name, to_status, note=note)
            reason = f"is {to_status}: only its photo can change"
            self._refused(reason, name, description="changed")
            self._refused(reason, name, cheque_no=self.cheques.number())
            self._refused(reason, name, lines=[])

            self._edit(name, attachment=NEW_PHOTO)
            self.assertEqual((self._cheque(name).attachment, self._cheque(name).status), (NEW_PHOTO, to_status))

    def test_an_old_type_cheque_can_change_only_its_photo(self):
        """Spec #1477 (#1487): an Old-type cheque is only cleared or cancelled by hand; its photo may be replaced."""
        name = self._add([self._npe_line(self._npe())], vendor=None, payee_name="Ravi Kumar")
        frappe.db.set_value("Cheques", name, "old_type", 1)  # what the cheque-types patch flags
        frappe.db.commit()

        reason = "is an Old-type cheque: only its photo can change"
        self._refused(reason, name, description="changed")
        self._refused(reason, name, cheque_no=self.cheques.number())
        self._refused(reason, name, payee_name="Ravi K")
        self._refused(reason, name, lines=[])

        self._edit(name, attachment=NEW_PHOTO)
        self.assertEqual(self._cheque(name).attachment, NEW_PHOTO)

    def test_a_backfilled_cheque_with_no_photo_gets_its_photo(self):
        name = self._add([self._npe_line(self._npe())])
        frappe.db.set_value("Cheques", name, {"attachment": None, "made_from": "PO/WO Page", "status": "Cleared"})
        frappe.db.commit()  # what the backfill leaves: no photo, made from the PO/WO page

        self._edit(name, attachment=NEW_PHOTO)
        self.assertEqual(self._cheque(name).attachment, NEW_PHOTO)

    def test_the_photo_can_be_replaced_not_removed(self):
        name = self._add()
        self._refused("photo can be replaced, not removed", name, attachment=None)

    # -- who ------------------------------------------------------------------------------------
    def test_procurement_edits_only_its_own_issued_cheques(self):
        buyer = self._user(PROCUREMENT)
        own = self._as(buyer, self._add)
        self._as(buyer, self._edit, own, description="Fixed my typo")
        self.assertEqual(self._cheque(own).description, "Fixed my typo")

        someone_elses = self._add()
        with self.assertRaisesRegex(frappe.PermissionError, "only the Issued cheques you created"):
            self._as(buyer, self._edit, someone_elses, description="not mine")
        frappe.db.rollback()

        change_cheque_status(own, "Cleared")
        with self.assertRaisesRegex(frappe.PermissionError, "only the Issued cheques you created"):
            self._as(buyer, self._edit, own, attachment=NEW_PHOTO)
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
