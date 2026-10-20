# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Clear and Cancel a cheque from the Cheque Tracker, and the detail view (#1484, spec #1477, ADR-0035).

Drives the endpoints the Clear and Cancel dialogs call (`cheque_status.clear_cheque`, `clear_cheques`,
`cancel_cheque`, `get_bank_lines`) and the detail view (`cheque_detail.get_cheque`), and reads back what
a user sees: each payment's status, payment date and PO term, the Cheque's status, dates and history, the
bank line's status, or the refusal.

⚠️ RUNS AGAINST THE ENV DATABASE (the endpoints commit). Projects, vendors, POs and payments come from
`TaxedWorkOrderFixture` / `PendingChequeCase`; every Cheque is purged by `ChequeFixture`; the planted bank
lines are purged here.
"""

import json

import frappe
from frappe.utils import add_days, flt, nowdate

from nirmaan_stack.api.cheques.cheque_detail import get_cheque
from nirmaan_stack.api.cheques.cheque_fixture import ChequeFixture
from nirmaan_stack.api.cheques.cheque_status import cancel_cheque, clear_cheque, clear_cheques, get_bank_lines
from nirmaan_stack.api.payments.test_cheque_approval import PendingChequeCase
from nirmaan_stack.services.cheques.rules import ChequeHeader, ChequeLineInput
from nirmaan_stack.services.cheques.writer import create_cheque

PAYMENT = "Project Payments"
PO = "Procurement Orders"
U = "Administrator"
RP = "Reconciliation Pending"
PHOTO = "https://storage.example.invalid/private/files/cheque-clear-test.jpg"
STATEMENT = "/private/files/test-icici-statement.xlsx"
PROCUREMENT = (
    "Nirmaan Procurement Executive Profile",
    "Nirmaan Procurement Lead Profile",
    "Nirmaan Material Procurement Executive Profile",
    "Nirmaan Service Procurement Executive Profile",
)
ACCOUNTANT = "Nirmaan Accountant Profile"


class ChequeStatusCase(PendingChequeCase):
    def setUp(self):
        super().setUp()
        # Paying a PO payment recomputes the vendor's credit, which saves the Vendor; its hook reads this.
        frappe.db.set_value("Vendors", self.vendor, "vendor_category", '{"categories": []}', update_modified=False)
        frappe.db.commit()
        self.addCleanup(ChequeFixture.purge_rows, [("Vendor Credit Ledger", {"parent": self.vendor})])

    # -- planting -------------------------------------------------------------------------------
    def _issued(self, *amounts, cheque_no=None):
        """An Issued Payment cheque: one payment per amount, already at Reconciliation Pending, so the
        cheque is issued as it is made. Returns `(cheque, payments)`."""
        payments = [self._payment(a, RP) for a in amounts]
        return self._make(payments, amounts, cheque_no=cheque_no), payments

    def _make(self, payments, amounts, *, cheque_no=None):
        rows = [
            ChequeLineInput(line_type="PO/WO Payment", project=self.project, record_doctype=PO,
                            record_name=frappe.db.get_value(PAYMENT, p, "document_name"),
                            payment_doctype=PAYMENT, payment_name=p, amount=a)
            for p, a in zip(payments, amounts)
        ]
        header = ChequeHeader(
            bank="ICICI Bank", bank_name=None, cheque_no=cheque_no or self.cheques.number(), cheque_date=nowdate(),
            amount=sum(amounts), vendor=self.vendor, payee_name=None, description=None, attachment=PHOTO,
        )
        name = self.cheques.track(create_cheque(header, user=U, made_from="PO/WO Page", lines=rows).name)
        frappe.db.commit()
        return name

    def _bank_line(self, *, reference_id, amount, direction="Debit", row_status="Mismatched"):
        """An imported ICICI statement line nobody has matched yet, staged directly."""
        batch = frappe.new_doc("Outflow Import Batch")
        batch.update({"source": "ICICI Bank Statement", "status": "In Review", "source_file": STATEMENT})
        batch.insert(ignore_permissions=True)
        row = frappe.new_doc("Outflow Import Row")
        row.update({
            "import_batch": batch.name, "source": "ICICI Bank Statement",
            "transfer_id": f"chq-{frappe.generate_hash(length=10)}", "amount": flt(amount), "direction": direction,
            "reference_id": reference_id, "settlement_reference": f"CLG/TEST VENDOR/{reference_id}",
            "added_on": f"{nowdate()} 00:00:00", "row_status": row_status,
        })
        row.insert(ignore_permissions=True)
        frappe.db.commit()
        self.addCleanup(ChequeFixture.purge_rows, [
            ("Outflow Row Match", {"import_row": row.name}),
            ("File", {"file_url": STATEMENT}),
            ("Outflow Import Row", {"name": row.name}),
            ("Outflow Import Batch", {"name": batch.name}),
        ])
        return row.name

    # -- reading --------------------------------------------------------------------------------
    def _status(self, cheque):
        return frappe.db.get_value("Cheques", cheque, "status")

    def _history(self, cheque):
        return [
            (h.from_status, h.to_status, h.changed_by, h.note)
            for h in frappe.get_all("Cheque Status History", filters={"parent": cheque, "parenttype": "Cheques"},
                                    fields=["from_status", "to_status", "changed_by", "note"], order_by="idx asc")
        ]

    def _payment_dates(self, *payments):
        return [str(frappe.db.get_value(PAYMENT, p, "payment_date") or "") for p in payments]

    def _refused(self, phrase, fn, *args, **kwargs):
        with self.assertRaisesRegex(frappe.ValidationError, phrase):
            fn(*args, **kwargs)
        frappe.db.rollback()

    def _user(self, profiles):
        for user in frappe.get_all("Nirmaan Users", filters={"role_profile": ["in", list(profiles)]}, pluck="name",
                                   limit=20):
            if user and user != U and frappe.db.exists("User", user):
                return user
        self.skipTest(f"no user with {profiles} on this site")

    def _as(self, user, fn, *args, **kwargs):
        frappe.set_user(user)
        try:
            return fn(*args, **kwargs)
        finally:
            frappe.set_user(U)


class TestClearByHand(ChequeStatusCase):
    def test_clearing_an_issued_cheque_pays_every_payment_on_the_clearance_date(self):
        cheque, (a, b) = self._issued(30000, 20000)
        frappe.db.set_value("Cheques", cheque, "issue_date", add_days(nowdate(), -5), update_modified=False)
        frappe.db.commit()
        day = add_days(nowdate(), -1)

        out = clear_cheque(cheque, day)

        self.assertEqual((out["status"], sorted(out["payments"])), ("Cleared", sorted([a, b])))
        self.assertEqual(self._statuses(a, b), ["Paid", "Paid"])
        self.assertEqual(self._payment_dates(a, b), [day, day])
        self.assertEqual(self._terms(a, b), ["Paid", "Paid"])
        doc = frappe.get_doc("Cheques", cheque)
        self.assertEqual((doc.status, str(doc.clearance_date), doc.cleared_by, doc.bank_line),
                         ("Cleared", day, "By hand", None))
        self.assertEqual(self._history(cheque)[-1], ("Issued", "Cleared", U, "Cleared by hand."))
        # Paid money counts on the PO (its Amount Paid is recounted from its Paid payments).
        po = frappe.db.get_value(PAYMENT, a, "document_name")
        self.assertEqual(flt(frappe.db.get_value(PO, po, "amount_paid")), 30000)

    def test_a_pending_cheque_is_refused_and_nothing_changes(self):
        a = self._payment(20000)
        cheque = self._cheque((a, 20000))
        self._refused("cannot be cleared: it is Approval Pending: its payments are not approved yet", clear_cheque, cheque,
                      nowdate())
        self.assertEqual((self._status(cheque), self._statuses(a)), ("Approval Pending", ["Requested"]))

    def test_a_cancelled_cheque_is_refused_and_never_goes_back(self):
        cheque, (a,) = self._issued(20000)
        cancel_cheque(cheque, "torn up")
        self._refused("cannot be cleared: it is Cancelled: its payments are Rejected", clear_cheque, cheque,
                      nowdate())
        self.assertEqual((self._status(cheque), self._statuses(a)), ("Cancelled", ["Rejected"]))

    def test_a_cleared_cheque_cannot_be_cleared_again(self):
        cheque, _ = self._issued(20000)
        clear_cheque(cheque, nowdate())
        self._refused("cannot be cleared: already Cleared", clear_cheque, cheque, nowdate())

    def test_a_clearance_date_after_today_is_refused(self):
        cheque, (a,) = self._issued(20000)
        self._refused("The clearance date cannot be after today", clear_cheque, cheque, add_days(nowdate(), 1))
        self.assertEqual(self._statuses(a), [RP])

    def test_procurement_cannot_clear_or_cancel(self):
        cheque, _ = self._issued(20000)
        user = self._user(PROCUREMENT)
        with self.assertRaises(frappe.PermissionError):
            self._as(user, clear_cheque, cheque, nowdate())
        with self.assertRaises(frappe.PermissionError):
            self._as(user, cancel_cheque, cheque, "torn up")
        with self.assertRaises(frappe.PermissionError):
            self._as(user, clear_cheques, [cheque], nowdate())
        self.assertEqual(self._status(cheque), "Issued")

    def test_an_accountant_can_clear(self):
        cheque, _ = self._issued(20000)
        user = self._user((ACCOUNTANT,))
        self._as(user, clear_cheque, cheque, nowdate(), note="ICICI statement 12 Oct")
        self.assertEqual(self._history(cheque)[-1], ("Issued", "Cleared", user, "ICICI statement 12 Oct"))

    def test_an_old_type_cheque_is_cleared_by_hand_and_pays_its_payments(self):
        a = self._payment(20000, RP)
        cheque = self.cheques.plant_cheque(
            status="Issued", bank="ICICI Bank", cheque_no=self.cheques.number(), cheque_date=nowdate(),
            amount=20000, vendor=self.vendor, attachment=PHOTO,
            lines=[{"line_type": "PO/WO Payment", "project": self.project, "record_doctype": PO,
                    "record_name": frappe.db.get_value(PAYMENT, a, "document_name"), "payment_name": a}],
        )
        frappe.db.set_value("Cheques", cheque, "old_type", 1, update_modified=False)
        frappe.db.commit()

        clear_cheque(cheque, nowdate())

        self.assertEqual((self._status(cheque), self._statuses(a)), ("Cleared", ["Paid"]))


class TestClearWithABankLine(ChequeStatusCase):
    def test_the_dialog_offers_unmatched_lines_with_the_number_whatever_the_zeros(self):
        number = f"00{frappe.generate_hash(length=6).translate(str.maketrans('abcdef', '123456'))}"
        cheque, _ = self._issued(30000, 20000, cheque_no=number)
        line = self._bank_line(reference_id=f"{number.lstrip('0')}.0", amount=50003)
        self._bank_line(reference_id=f"9{number}", amount=50000)  # another number
        self._bank_line(reference_id=number, amount=50000, direction="Credit")
        self._bank_line(reference_id=number, amount=50010)  # amount too far off

        self.assertEqual([r["name"] for r in get_bank_lines(cheque)], [line])

    def test_linking_a_line_records_it_on_the_cheque_and_its_payments(self):
        number = self.cheques.number()
        cheque, (a, b) = self._issued(30000, 20000, cheque_no=number)
        line = self._bank_line(reference_id=number, amount=50000)

        clear_cheque(cheque, nowdate(), bank_line=line)

        doc = frappe.get_doc("Cheques", cheque)
        self.assertEqual((doc.status, doc.bank_line, doc.cleared_by), ("Cleared", line, "By hand"))
        self.assertEqual(self._statuses(a, b), ["Paid", "Paid"])
        matches = frappe.get_all("Outflow Row Match", filters={"import_row": line},
                                 fields=["target_doctype", "target_name", "target_amount", "match_kind"])
        self.assertEqual(
            sorted((m.target_doctype, m.target_name, flt(m.target_amount), m.match_kind) for m in matches),
            sorted([(PAYMENT, a, 30000.0, "Settled"), (PAYMENT, b, 20000.0, "Settled")]),
        )
        for p in (a, b):
            self.assertEqual(frappe.db.get_value(PAYMENT, p, "utr"), f"CLG/TEST VENDOR/{number}")
        self.assertEqual(frappe.db.get_value("Outflow Import Row", line, "row_status"), "Settled")
        self.assertEqual(get_bank_lines(cheque), [])  # no longer unmatched
        self.assertEqual(self._history(cheque)[-1][3], f"Cleared by hand, bank line {line}.")

    def test_a_line_that_does_not_fit_is_refused_and_nothing_changes(self):
        number = self.cheques.number()
        cheque, (a,) = self._issued(20000, cheque_no=number)
        other = self._bank_line(reference_id=f"{number}9", amount=20000)

        self._refused(f"cannot be cleared with that bank line: line {other} carries cheque number", clear_cheque,
                      cheque, nowdate(), bank_line=other)

        self.assertEqual((self._status(cheque), self._statuses(a)), ("Issued", [RP]))
        self.assertEqual(frappe.db.get_value("Outflow Import Row", other, "row_status"), "Mismatched")
        self.assertFalse(frappe.db.exists("Outflow Row Match", {"import_row": other}))


class TestBulkClear(ChequeStatusCase):
    def test_bulk_clears_the_issued_and_skips_the_rest_with_reasons(self):
        (a, _), (b, _) = self._issued(10000), self._issued(15000)
        done, _ = self._issued(5000)
        clear_cheque(done, nowdate())
        pending = self._cheque((self._payment(20000), 20000))
        numbers = {c: frappe.db.get_value("Cheques", c, "cheque_no") for c in (done, pending)}

        result = clear_cheques(json.dumps([a, b, done, pending]), nowdate())

        self.assertEqual([c["cheque"] for c in result["changed"]], [a, b])
        self.assertEqual(result["skipped"], [
            {"cheque": done, "cheque_no": numbers[done], "reason": "already Cleared"},
            {"cheque": pending, "cheque_no": numbers[pending],
             "reason": "it is Approval Pending: its payments are not approved yet"},
        ])
        self.assertEqual([self._status(c) for c in (a, b, pending)], ["Cleared", "Cleared", "Approval Pending"])

    def test_the_preview_writes_nothing(self):
        cheque, (p,) = self._issued(10000)

        preview = clear_cheques([cheque], nowdate(), dry_run="true")

        self.assertEqual([c["cheque"] for c in preview["changed"]], [cheque])
        self.assertEqual((self._status(cheque), self._statuses(p)), ("Issued", [RP]))


class TestCancel(ChequeStatusCase):
    def test_cancel_rejects_every_payment_with_the_note_as_the_reason(self):
        cheque, (a, b) = self._issued(30000, 20000)

        out = cancel_cheque(cheque, "  vendor lost it  ")

        self.assertEqual((out["status"], sorted(out["rejected"])), ("Cancelled", sorted([a, b])))
        self.assertEqual(self._statuses(a, b), ["Rejected", "Rejected"])
        self.assertEqual(self._terms(a, b), ["Rejected", "Rejected"])
        for p in (a, b):
            self.assertTrue(frappe.db.exists("Comment", {"reference_doctype": PAYMENT, "reference_name": p,
                                                         "content": "Rejected: vendor lost it"}))
        self.assertEqual(self._history(cheque)[-1], ("Issued", "Cancelled", U, "vendor lost it"))
        self.assertEqual(len(frappe.get_doc("Cheques", cheque).lines), 2)  # it keeps its lines

    def test_a_pending_cheque_can_be_cancelled(self):
        a = self._payment(20000)
        cheque = self._cheque((a, 20000))
        cancel_cheque(cheque, "torn up")
        self.assertEqual((self._status(cheque), self._statuses(a)), ("Cancelled", ["Rejected"]))

    def test_cancel_needs_a_note(self):
        cheque, (a,) = self._issued(20000)
        self._refused("Write a note saying why the cheque is cancelled", cancel_cheque, cheque, "   ")
        self.assertEqual((self._status(cheque), self._statuses(a)), ("Issued", [RP]))

    def test_a_cleared_cheque_cannot_be_cancelled(self):
        cheque, (a,) = self._issued(20000)
        clear_cheque(cheque, nowdate())
        self._refused("cannot be cancelled: it is Cleared: a cleared cheque cannot be cancelled", cancel_cheque,
                      cheque, "bounced")
        self.assertEqual((self._status(cheque), self._statuses(a)), ("Cleared", ["Paid"]))


class TestDetailView(ChequeStatusCase):
    def test_the_detail_view_shows_type_dates_how_it_cleared_and_the_bank_line(self):
        number = self.cheques.number()
        cheque, (a,) = self._issued(20000, cheque_no=number)
        line = self._bank_line(reference_id=number, amount=20000)
        clear_cheque(cheque, nowdate(), bank_line=line)

        detail = get_cheque(cheque)

        self.assertEqual(
            (detail["cheque_type"], str(detail["issue_date"]), str(detail["clearance_date"]), detail["cleared_by"],
             detail["bank_line"]),
            ("Payment", nowdate(), nowdate(), "By hand", line),
        )
        self.assertEqual((detail["bank_line_detail"]["name"], flt(detail["bank_line_detail"]["amount"])), (line, 20000))
        self.assertEqual([(l["payment_name"], l["payment_status"]) for l in detail["lines"]], [(a, "Paid")])
        self.assertEqual([(h["from_status"], h["to_status"]) for h in detail["history"]],
                         [(None, "Approval Pending"), ("Approval Pending", "Issued"), ("Issued", "Cleared")])

    def test_a_project_manager_cannot_open_the_detail_view(self):
        cheque, _ = self._issued(20000)
        pm = self._user(("Nirmaan Project Manager Profile",))
        with self.assertRaises(frappe.PermissionError):
            self._as(pm, get_cheque, cheque)
