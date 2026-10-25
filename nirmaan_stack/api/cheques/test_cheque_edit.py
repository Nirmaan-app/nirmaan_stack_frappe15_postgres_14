# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Editing a Payment cheque from the Cheque Tracker: what may change by status, and who may (#1418, spec
#1407; #1482, spec #1477; spec #1514).

Drives `save_cheque` with `name` (the edit path) the way the Edit Cheque dialog does: it loads the
Cheque through the detail endpoint, changes what the user changed, and sends the header back without its
lines. It reads back what a user sees: the Cheque, its lines, each payment's cheque number and date, or
the refusal and that nothing changed.

An Approval Pending Payment cheque changes only its number, bank, date and photo, never what it pays: its amount,
payee, note and lines stay as made (ADR-0035 Amendment A). Issued, Cleared and Cancelled cheques change
only their photo. Procurement edits only the Approval Pending cheques it created. Payment cheques are planted the
way they are made now, by Request Payment on the PO page (`writer.create_payment_cheque`), or as an older
cheque paying several POs (`ChequeFixture.plant_cheque`).

⚠️ RUNS AGAINST THE ENV DATABASE (the endpoints commit). Projects, vendors and payments come from
`TaxedWorkOrderFixture`, POs from `ChequeFixture.plant_po`; every Cheque carries a TESTCHQ number and is
purged by `ChequeFixture`.
"""

import json
from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import add_days, nowdate

from nirmaan_stack.api.cheques.cheque_detail import get_cheque
from nirmaan_stack.api.cheques.cheque_fixture import ChequeFixture
from nirmaan_stack.api.cheques.save_cheque import save_cheque
from nirmaan_stack.api.payments.taxed_work_order_fixture import TaxedWorkOrderFixture
from nirmaan_stack.services.cheque_payments import commit_move_to_reconciliation
from nirmaan_stack.services.cheques.rules import PENDING, parse_header
from nirmaan_stack.services.cheques.writer import create_payment_cheque

U = "Administrator"
PAYMENT = "Project Payments"
PO = "Procurement Orders"
PO_WO_LINE = "PO/WO Payment"
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
LINES_FIXED = "lines cannot change: it pays what it was made for"


class TestChequeEdit(FrappeTestCase):
    def setUp(self):
        frappe.set_user(U)
        self.fx = TaxedWorkOrderFixture.attach(self)
        self.cheques = ChequeFixture.attach(self)
        self.vendor = self.fx.vendor(2.0)
        self.project = self.fx.project()
        self.po = ChequeFixture.plant_po(self, self.fx, project=self.project, vendor=self.vendor)
        self.other_po = ChequeFixture.plant_po(self, self.fx, project=self.project, vendor=self.vendor)
        frappe.db.commit()  # a refusal below rolls back; the planted rows must outlive it
        # The admin note reaches every real admin, and a push reaches real phones: keep both off.
        for target in ("_notify_admins_auto_approved", "PrNotification"):
            quiet = patch(f"{CONTROLLER}.{target}")
            quiet.start()
            self.addCleanup(quiet.stop)

    def tearDown(self):
        frappe.set_user(U)

    # -- planting -------------------------------------------------------------------------------
    def _plant(self, status, *, amount=20000, po=None):
        """An Online payment of a PO (`self.po` unless given) already at `status` (raw insert: no hook runs)."""
        return self.cheques.plant_payment(
            self.fx, status, project=self.project, vendor=self.vendor, document=(PO, po or self.po), amount=amount
        )

    def _line(self, payment=None, *, amount=None, po=None):
        line = {"line_type": PO_WO_LINE, "project": self.project, "record_doctype": PO, "record_name": po or self.po}
        if payment:
            line["payment_name"] = payment
        if amount is not None:
            line["amount"] = amount
        return line

    def _from_po_page(self, payment, amount=20000):
        """The one-line Cheque a PO's Request Payment in Cheque mode makes for `payment`, by the session
        user, then the move an approved payment takes once that is on disk."""
        header = parse_header({
            "bank": "ICICI Bank",
            "cheque_no": self.cheques.number(),
            "cheque_date": nowdate(),
            "amount": amount,
            "vendor": self.vendor,
            "attachment": PHOTO,
        })
        name = self.cheques.track(create_payment_cheque(header, payment, user=frappe.session.user).name)
        frappe.db.commit()
        commit_move_to_reconciliation(payment)
        return name

    def _older(self, lines, amount):
        """An Approval Pending Payment cheque the Tracker's Add Cheque made before spec #1514: several POs, a line
        with no payment yet."""
        return self.cheques.plant_cheque(
            status=PENDING, bank="ICICI Bank", cheque_no=self.cheques.number(), cheque_date=nowdate(),
            amount=amount, vendor=self.vendor, description="Advance on two POs", attachment=PHOTO, lines=lines,
        )

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
        """Load the Cheque, change what the user changed, and save the header back. The dialog sends no
        lines; `lines` sends these as well, as an older client would."""
        header, _ = self._loaded(name)
        header.update(changes)
        args = {k: v for k, v in header.items() if v is not None}
        if lines is not None:
            args["lines"] = json.dumps(lines)
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

    # -- an Approval Pending cheque: its header -----------------------------------------------------
    def test_a_pending_cheque_s_number_date_and_photo_change_and_its_payment_follows(self):
        pay = self._plant("Requested")
        name = self._from_po_page(pay)
        _, lines = self._loaded(name)
        number, date = self.cheques.number(), add_days(nowdate(), 5)

        out = self._edit(name, cheque_no=number, cheque_date=date, attachment=NEW_PHOTO)
        self.assertEqual((out["cheque"], out["status"]), (name, PENDING))
        cheque = self._cheque(name)
        self.assertEqual((cheque.cheque_no, str(cheque.cheque_date), cheque.attachment), (number, date, NEW_PHOTO))
        self.assertEqual(self._loaded(name)[1], lines)
        state = self._payment(pay)
        self.assertEqual((state.cheque, state.cheque_no, str(state.cheque_date), state.status),
                         (name, number, date, "Requested"))

    def test_what_a_pending_cheque_pays_and_to_whom_cannot_change(self):
        pay = self._plant("Requested")
        name = self._from_po_page(pay)
        reason = "can change only its number, bank, date and photo, not its"
        self._refused(f"{reason} amount", name, amount=19000)
        self._refused(f"{reason} Vendor", name, vendor=self.fx.vendor())
        self._refused(f"{reason} note", name, description="A typo fixed")

    def test_a_payment_cheque_cannot_be_moved_to_another_bank(self):
        # Only ICICI Bank's statement clears a cheque (#1516).
        name = self._from_po_page(self._plant("Requested"))
        self._refused("A Payment cheque is drawn on ICICI Bank", name, bank="Others", bank_name="HDFC Bank")
        self.assertEqual(self._cheque(name).bank, "ICICI Bank")

    # -- an Approval Pending cheque: its lines ------------------------------------------------------
    def test_a_pending_cheque_s_lines_cannot_change(self):
        pay = self._plant("Requested")
        other = self._plant("Requested", po=self.other_po)
        name = self._older([self._line(pay), self._line(amount=10000, po=self.other_po)], amount=30000)
        _, lines = self._loaded(name)

        self._refused(LINES_FIXED, name, lines=lines[:1])  # one taken off
        self._refused(LINES_FIXED, name, lines=lines + [self._line(amount=500)])  # one added
        picked = [lines[0], {**lines[1], "payment_name": other}]  # a payment picked for the open line
        self._refused(LINES_FIXED, name, lines=picked)
        self.assertEqual((self._payment(pay).mode_of_payment, self._payment(pay).cheque), ("Cheque", name))
        self.assertEqual((self._payment(other).mode_of_payment, self._payment(other).cheque), ("Online", None))

    def test_a_cheque_that_pays_several_pos_keeps_them_through_an_edit(self):
        first = self._plant("Requested")
        second = self._plant("Requested", amount=15000, po=self.other_po)
        name = self._older([self._line(first), self._line(second, po=self.other_po)], amount=35000)
        _, lines = self._loaded(name)
        number = self.cheques.number()

        self._edit(name, cheque_no=number, lines=lines)  # the same lines sent back are no change
        self.assertEqual(self._loaded(name)[1], lines)
        self.assertEqual([self._payment(p).cheque_no for p in (first, second)], [number, number])

    def test_a_payment_still_on_its_pending_cheque_cannot_go_online_by_itself(self):
        pay = self._plant("Requested")
        self._from_po_page(pay)
        doc = frappe.get_doc(PAYMENT, pay)
        doc.update({"mode_of_payment": "Online", "cheque": None})
        with self.assertRaisesRegex(frappe.ValidationError, "only once its Cheque is Cancelled"):
            doc.save(ignore_permissions=True)
        frappe.db.rollback()

    # -- Issued, Cleared or Cancelled -------------------------------------------------------------
    def test_an_issued_cleared_or_cancelled_cheque_can_change_only_its_photo(self):
        for to_status in ("Issued", "Cleared", "Cancelled"):
            name = self._from_po_page(self._plant("Approved"))
            self.assertEqual(self._cheque(name).status, "Issued")  # its payment was approved
            if to_status != "Issued":
                # Raw on purpose: clearing and cancelling are other suites'; this is only their outcome.
                # No figure is derived from a Cheque's status, so nothing needs recomputing.
                frappe.db.set_value("Cheques", name, "status", to_status)
                frappe.db.commit()
            reason = f"is {to_status}: only its photo can change"
            self._refused(reason, name, cheque_no=self.cheques.number())
            self._refused(reason, name, cheque_date=add_days(nowdate(), 1))
            self._refused(reason, name, lines=[self._line(amount=100)])

            self._edit(name, attachment=NEW_PHOTO)
            self.assertEqual((self._cheque(name).attachment, self._cheque(name).status), (NEW_PHOTO, to_status))

    def test_an_old_type_cheque_can_change_only_its_photo(self):
        """Spec #1477 (#1487): an Old-type cheque's photo may be replaced, nothing else."""
        name = self.cheques.plant_cheque(  # an Ad-hoc cheque to a typed payee, as the report made one
            status=PENDING, bank="ICICI Bank", cheque_no=self.cheques.number(), cheque_date=nowdate(),
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
        name = self._from_po_page(self._plant("Requested"))
        self._refused("photo can be replaced, not removed", name, attachment=None)

    # -- who ------------------------------------------------------------------------------------
    def test_procurement_edits_only_its_own_pending_cheques(self):
        buyer = self._user(PROCUREMENT)
        own = self._as(buyer, self._from_po_page, self._plant("Requested"))
        number = self.cheques.number()
        self._as(buyer, self._edit, own, cheque_no=number)
        self.assertEqual(self._cheque(own).cheque_no, number)

        someone_elses = self._from_po_page(self._plant("Requested"))
        with self.assertRaisesRegex(frappe.PermissionError, "only the Approval Pending cheques you created"):
            self._as(buyer, self._edit, someone_elses, cheque_no=self.cheques.number())
        frappe.db.rollback()

        issued = self._as(buyer, self._from_po_page, self._plant("Approved"))
        self.assertEqual(self._cheque(issued).status, "Issued")
        with self.assertRaisesRegex(frappe.PermissionError, "only the Approval Pending cheques you created"):
            self._as(buyer, self._edit, issued, attachment=NEW_PHOTO)
        frappe.db.rollback()

    def test_accounts_edit_anyones_cheque(self):
        accountant = self._user(ACCOUNTANT)
        buyer = self._user(PROCUREMENT)
        theirs = self._as(buyer, self._from_po_page, self._plant("Requested"))
        date = add_days(nowdate(), 2)
        self._as(accountant, self._edit, theirs, cheque_date=date)
        self.assertEqual(str(self._cheque(theirs).cheque_date), date)

    def test_editing_a_cheque_that_does_not_exist_is_refused(self):
        with self.assertRaises(frappe.DoesNotExistError):
            save_cheque(
                name="CHQ-NOPE-00000", bank="ICICI Bank", cheque_no=self.cheques.number(), cheque_date=nowdate(),
                amount=100, vendor=self.vendor, description="x", attachment=PHOTO,
            )
        frappe.db.rollback()
