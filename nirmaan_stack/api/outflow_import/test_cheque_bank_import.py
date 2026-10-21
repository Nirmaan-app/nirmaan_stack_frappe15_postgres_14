# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Bulk Import Transactions clears Payment cheques (#1485, spec #1477, ADR-0035).

Each test stages a small planted ICICI statement through the import's own staging (`upload._stage_batch`,
what the upload endpoint calls after parsing) and runs the match the upload dialog runs next
(`review.match_batch`). It then reads back what a user sees: the line's status and note on the review
screen, each payment's status and payment date, the bank-match rows, and the Cheque's status, dates,
bank line and history.

⚠️ RUNS AGAINST THE ENV DATABASE (the match run commits). Cheques, payments and POs are purged by their
fixtures; each staged statement is purged here. Cheque numbers are random 9-digit numbers written with
two leading zeros on the cheque and without them on the statement.
"""

from datetime import datetime
from unittest.mock import patch

import frappe
from frappe.utils import add_days, flt, nowdate

from nirmaan_stack.api.cheques.cheque_fixture import ChequeFixture
from nirmaan_stack.api.cheques.test_cheque_status import ChequeStatusCase
from nirmaan_stack.api.outflow_import.expenses import settle_row
from nirmaan_stack.api.outflow_import.review import get_outflow_rows, match_batch
from nirmaan_stack.api.outflow_import.test_review import _stage_icici_statement
from nirmaan_stack.api.outflow_import.unreconcile import plan_of_line, unreconcile_line
from nirmaan_stack.api.payments.project_payments import update_payment_request
from nirmaan_stack.services.cheques.bank_import_rules import BANK_APPROVAL_NOTE, BANK_REVIVAL_NOTE
from nirmaan_stack.services.cheques.status import cancel

PAYMENT = "Project Payments"
NPE = "Non Project Expenses"
PHOTO = "https://storage.example.invalid/private/files/cheque-import-test.jpg"
ROW = "Outflow Import Row"
MATCH = "Outflow Row Match"
U = "Administrator"
RP = "Reconciliation Pending"


class ChequeImportCase(ChequeStatusCase):
    def setUp(self):
        super().setUp()
        self.day = nowdate()
        self.tid = f"T1485{frappe.generate_hash(length=6).upper()}"

    def _number(self) -> str:
        """A cheque number nothing else carries, as written on the cheque (with leading zeros)."""
        return "00" + str(int(frappe.generate_hash(length=10), 16))[-7:].rjust(7, "1")

    def _import(self, *lines):
        """Stage a statement of `(cheque_column, amount)` / `(cheque_column, amount, "credit")` lines and run
        the match. Returns the line names, in order."""
        planted = [
            {
                "tid": f"{self.tid}{n}", "day": datetime.strptime(self.day, "%Y-%m-%d"), "cheque": cheque,
                "narration": "CLG/TEST CHEQUE VENDOR/HSB", "amount": flt(amount),
                "credit": len(rest) > 0 and rest[0] == "credit",
            }
            for n, (cheque, amount, *rest) in enumerate(lines, start=1)
        ]
        filename = f"test-1485-{self.tid}.csv"
        batch = _stage_icici_statement(planted, filename).name
        frappe.db.commit()
        self.addCleanup(ChequeFixture.purge_rows, [
            (MATCH, {"import_batch": batch}),
            ("File", {"file_url": f"/private/files/{filename}"}),
            ("Comment", {"reference_doctype": PAYMENT, "reference_name": ["in", self.fx.payments or [""]]}),
            (ROW, {"import_batch": batch}),
            ("Outflow Import Batch", {"name": batch}),
        ])
        self.batch = batch
        match_batch(batch)
        return frappe.get_all(ROW, filters={"import_batch": batch}, order_by="transfer_id asc", pluck="name")

    # -- reading --------------------------------------------------------------------------------
    def _line(self, row):
        return frappe.db.get_value(ROW, row, ["row_status", "outcome_note"], as_dict=True)

    def _legs(self, row):
        return sorted(
            (m.target_name, m.match_basis)
            for m in frappe.get_all(MATCH, filters={"import_row": row, "match_kind": "Settled"},
                                    fields=["target_name", "match_basis"])
        )

    def _state(self, cheque):
        return frappe.db.get_value(
            "Cheques", cheque, ["status", "cleared_by", "bank_line", "cheque_date", "issue_date"], as_dict=True
        )

    def _old_type(self, number, amount, payments, expenses=()):
        """An Issued Old-type cheque (recorded before #1477) numbered `number` for `amount`, with one PO line
        per `(payment, amount)` and one Non-project Expense line per `(expense, amount)`."""
        lines = [
            {"line_type": "PO/WO Payment", "project": self.project, "record_doctype": "Procurement Orders",
             "record_name": frappe.db.get_value(PAYMENT, p, "document_name"), "payment_name": p, "amount": a}
            for p, a in payments
        ] + [{"line_type": "Non-project Expense", "payment_name": e, "amount": a} for e, a in expenses]
        cheque = self.cheques.plant_cheque(
            status="Issued", bank="ICICI Bank", cheque_no=number, cheque_date=add_days(self.day, 3), amount=amount,
            vendor=self.vendor, attachment=PHOTO, lines=lines,
        )
        frappe.db.set_value("Cheques", cheque, "old_type", 1, update_modified=False)  # what the #1478 patch flags
        frappe.db.commit()
        return cheque

    def _waiting_expense(self, amount):
        """A Non Project Expense waiting for its bank line (Reconciliation Pending)."""
        doc = frappe.new_doc(NPE)
        doc.update({"type": frappe.db.get_value("Expense Type", {"non_project": 1, "project": 0}, "name"),
                    "status": RP, "amount": amount, "description": "old-type cheque test"})
        doc.insert(ignore_permissions=True)
        # The controller sets a new row's own status; raw back to the one this test needs.
        frappe.db.set_value(NPE, doc.name, "status", RP, update_modified=False)
        frappe.db.commit()
        self.addCleanup(ChequeFixture.purge_rows, [
            ("File", {"attached_to_doctype": NPE, "attached_to_name": doc.name}),
            ("Version", {"ref_doctype": NPE, "docname": doc.name}),
            (NPE, {"name": doc.name}),
        ])
        return doc.name

    def _cleared_by_hand(self, cheque, day):
        """What a hand clear left before #1516 removed it: the cheque cleared on `day` "By hand", with no
        bank line. Cleared through a planted line, then that line is taken back off (raw: test setup)."""
        line = self._clear_by_bank(cheque, day=day)
        frappe.db.set_value("Cheques", cheque, {"cleared_by": "By hand", "bank_line": None}, update_modified=False)
        frappe.db.commit()  # before the purge, which rolls back first
        ChequeFixture.purge_rows([(MATCH, {"import_row": line}), (ROW, {"name": line})])

    def _shown(self, row):
        rows = get_outflow_rows(scope="all", batch=self.batch, limit=50)["rows"]
        return next(r for r in rows if r["name"] == row)


class TestALineClearsItsCheque(ChequeImportCase):
    def test_an_issued_cheque_is_cleared_and_every_payment_paid_and_linked_to_the_line(self):
        number = self._number()
        cheque, (a, b) = self._issued(30000, 12000, cheque_no=number)
        paper = add_days(self.day, 5)  # post-dated, so the line's day is told apart from it
        # Raw on purpose: test setup, a paper date only.
        frappe.db.set_value("Cheques", cheque, "cheque_date", paper, update_modified=False)
        frappe.db.commit()

        (row,) = self._import((number.lstrip("0"), 42000))

        self.assertEqual(self._statuses(a, b), ["Paid", "Paid"])
        self.assertEqual(self._payment_dates(a, b), [self.day, self.day])
        self.assertEqual(self._legs(row), sorted([(a, "cheque number"), (b, "cheque number")]))
        state = self._state(cheque)
        self.assertEqual(
            (state.status, state.cleared_by, state.bank_line, str(state.cheque_date)),
            ("Cleared", "Bank import", row, self.day),
        )
        self.assertEqual(self._history(cheque)[-1][:2], ("Issued", "Cleared"))
        line = self._line(row)
        self.assertEqual(line.row_status, "Settled")
        self.assertEqual(
            line.outcome_note,
            f"Cheque {number} cleared: 2 payments Reconciliation Pending → Paid, payment date "
            f"{datetime.strptime(self.day, '%Y-%m-%d').strftime('%d-%m-%Y')}.",
        )
        shown = self._shown(row)["cheque_outcome"]
        self.assertEqual(
            (shown["cheque"], shown["cheque_no"], shown["started"], shown["double_payments"]),
            (cheque, number, "Issued", []),
        )

    def test_a_pending_cheque_is_approved_by_the_import_then_cleared(self):
        number = self._number()
        a, b = self._payment(20000), self._payment(15000, "CEO Pending")
        cheque = self._make([a, b], [20000, 15000], cheque_no=number)
        frappe.db.set_value(PAYMENT, b, "approval_date", add_days(self.day, -3), update_modified=False)
        frappe.db.commit()

        (row,) = self._import((number, 35000))

        self.assertEqual(self._statuses(a, b), ["Paid", "Paid"])
        self.assertEqual(str(frappe.db.get_value(PAYMENT, a, "approval_date")), self.day)
        self.assertEqual(str(frappe.db.get_value(PAYMENT, b, "ceo_approval_date")), self.day)
        self.assertEqual(self._terms(a, b), ["Paid", "Paid"])
        history = self._history(cheque)
        self.assertEqual(history[-2], ("Approval Pending", "Issued", U, BANK_APPROVAL_NOTE))
        self.assertEqual(history[-1][:2], ("Issued", "Cleared"))
        state = self._state(cheque)
        self.assertEqual((state.status, str(state.issue_date)), ("Cleared", self.day))
        self.assertEqual(self._line(row).row_status, "Settled")
        self.assertIn("approved by bank import", self._line(row).outcome_note)
        self.assertEqual(self._shown(row)["cheque_outcome"]["started"], "Approval Pending")

    def test_a_cancelled_cheque_is_cleared_and_a_later_payment_on_its_po_is_flagged(self):
        number = self._number()
        cheque, (a,) = self._issued(25000, cheque_no=number)
        cancel(cheque, note="Vendor lost the cheque", user=U)
        frappe.db.commit()
        # The cancel happened an hour ago; the PO was then paid online.
        frappe.db.sql(
            """UPDATE "tabCheque Status History" SET changed_at = NOW() - INTERVAL '1 hour'
               WHERE parent = %s AND to_status = 'Cancelled'""", (cheque,),
        )
        po = frappe.db.get_value(PAYMENT, a, "document_name")
        online = ChequeFixture.plant_payment(self.fx, "Approved", project=self.project, vendor=self.vendor,
                                             document=("Procurement Orders", po), amount=25000)

        (row,) = self._import((number, 25000))

        self.assertEqual(self._statuses(a), ["Paid"])
        self.assertEqual(self._statuses(online), ["Approved"])
        last = self._history(cheque)[-1]
        self.assertEqual(last[:2], ("Cancelled", "Cleared"))
        self.assertIn(BANK_REVIVAL_NOTE, last[3])
        note = self._line(row).outcome_note
        self.assertIn("was cancelled, but the bank paid it: 1 payment Rejected → Paid", note)
        self.assertIn(f"Check for double payment: {po} has {online} (₹25,000, Approved)", note)
        shown = self._shown(row)["cheque_outcome"]
        self.assertEqual(shown["started"], "Cancelled")
        self.assertEqual([d["payment"] for d in shown["double_payments"]], [online])

    def test_a_cheque_cleared_by_hand_before_1516_gets_the_line_linked_and_nothing_paid_again(self):
        number = self._number()
        cheque, (a, b) = self._issued(10000, 5000, cheque_no=number)
        earlier = add_days(self.day, -2)
        self._cleared_by_hand(cheque, earlier)
        history_before = self._history(cheque)

        (row,) = self._import((number, 15000))

        self.assertEqual(self._payment_dates(a, b), [earlier, earlier])
        self.assertEqual(self._legs(row), sorted([(a, "cheque number"), (b, "cheque number")]))
        state = self._state(cheque)
        self.assertEqual((state.status, state.cleared_by, state.bank_line), ("Cleared", "By hand", row))
        self.assertEqual(str(state.cheque_date), earlier)  # linking moves no date
        self.assertEqual(self._history(cheque), history_before)
        self.assertEqual(self._line(row).row_status, "Settled")
        self.assertIn("already cleared by hand: this line is linked", self._line(row).outcome_note)
        self.assertEqual(self._shown(row)["cheque_outcome"]["started"], "Cleared")


class TestALineClearsAnOldTypeCheque(ChequeImportCase):
    """The import clears Old-type cheques too, every line paid in full (#1516, ADR-0035 Amendment A)."""

    def test_each_line_s_record_is_settled_for_its_line_amount_one_match_per_line(self):
        number = self._number()
        a, b = self._payment(30000, RP), self._payment(15000, RP)
        expense = self._waiting_expense(5000)
        cheque = self._old_type(number, 50000, [(a, 30000), (b, 15000)], [(expense, 5000)])

        (row,) = self._import((number, 50000))

        self.assertEqual(self._statuses(a, b), ["Paid", "Paid"])
        self.assertEqual(self._payment_dates(a, b), [self.day, self.day])
        self.assertEqual(self._terms(a, b), ["Paid", "Paid"])
        paid = frappe.db.get_value(NPE, expense, ["status", "payment_date"], as_dict=True)
        self.assertEqual((paid.status, str(paid.payment_date)), ("Paid", self.day))
        legs = frappe.get_all(MATCH, filters={"import_row": row, "match_kind": "Settled"},
                              fields=["target_doctype", "target_name", "target_amount"])
        self.assertEqual(
            sorted((m.target_doctype, m.target_name, flt(m.target_amount)) for m in legs),
            sorted([(PAYMENT, a, 30000.0), (PAYMENT, b, 15000.0), (NPE, expense, 5000.0)]),
        )
        self.assertEqual(self._line(row).row_status, "Settled")
        state = self._state(cheque)
        self.assertEqual(
            (state.status, state.cleared_by, state.bank_line, str(state.cheque_date)),
            ("Cleared", "Bank import", row, self.day),
        )
        self.assertEqual(self._history(cheque)[-1][:2], ("Issued", "Cleared"))

    def _paid_earlier(self, amount):
        """A payment on the cheque already marked Paid ten days ago, as the old rules let one be."""
        name = self._payment(amount, "Paid")
        frappe.db.set_value(PAYMENT, name, "payment_date", add_days(self.day, -10), update_modified=False)
        frappe.db.commit()
        return name

    def _left_at_approved(self, payment):
        """Raw back to Approved after the fixture moved it on: what a move to Reconciliation Pending that
        failed leaves (`cheque_payments.move_to_reconciliation`)."""
        frappe.db.set_value(PAYMENT, payment, "status", "Approved", update_modified=False)
        frappe.db.commit()

    def test_an_approved_payment_is_paid_and_a_paid_one_is_left_as_it_is(self):
        number = self._number()
        approved, paid = self._payment(30000, RP), self._paid_earlier(15000)
        expense = self._waiting_expense(5000)
        cheque = self._old_type(number, 50000, [(approved, 30000), (paid, 15000)], [(expense, 5000)])
        self._left_at_approved(approved)

        (row,) = self._import((number, 50000))

        self.assertEqual(self._statuses(approved, paid), ["Paid", "Paid"])
        self.assertEqual(self._payment_dates(approved, paid), [self.day, add_days(self.day, -10)])
        self.assertEqual(frappe.db.get_value(NPE, expense, "status"), "Paid")
        legs = frappe.get_all(MATCH, filters={"import_row": row, "match_kind": "Settled"},
                              fields=["target_doctype", "target_name", "target_amount"])
        # The Paid payment had no bank line yet: this one is its first.
        self.assertEqual(
            sorted((m.target_doctype, m.target_name, flt(m.target_amount)) for m in legs),
            sorted([(PAYMENT, approved, 30000.0), (PAYMENT, paid, 15000.0), (NPE, expense, 5000.0)]),
        )
        self.assertEqual(self._line(row).row_status, "Settled")
        self.assertEqual(self._state(cheque).status, "Cleared")

    def test_a_paid_expense_is_left_as_it_is(self):
        number = self._number()
        a, expense = self._payment(30000, RP), self._waiting_expense(5000)
        frappe.db.set_value(NPE, expense, "status", "Paid", update_modified=False)
        frappe.db.commit()
        cheque = self._old_type(number, 35000, [(a, 30000)], [(expense, 5000)])

        (row,) = self._import((number, 35000))

        self.assertEqual(self._statuses(a), ["Paid"])
        paid = frappe.db.get_value(NPE, expense, ["status", "payment_date"], as_dict=True)
        self.assertEqual((paid.status, paid.payment_date), ("Paid", None))
        self.assertEqual(self._legs(row), sorted([(a, "cheque number"), (expense, "cheque number")]))
        self.assertEqual(self._line(row).row_status, "Settled")
        self.assertEqual(self._state(cheque).status, "Cleared")

    def test_a_paid_payment_another_bank_line_settled_gets_no_second_match(self):
        number = self._number()
        approved, paid = self._payment(30000, RP), self._paid_earlier(20000)
        other = self._bank_line(reference_id="UTR-ELSEWHERE", amount=20000)
        frappe.db.sql(
            """INSERT INTO "tabOutflow Row Match" (name, creation, modified, modified_by, owner, docstatus, idx,
                   import_row, import_batch, transfer_id, target_doctype, target_name, target_amount, match_kind,
                   match_basis)
               SELECT %s, NOW(), NOW(), %s, %s, 0, 0, name, import_batch, transfer_id, %s, %s, 20000, 'Settled',
                      'Manual'
               FROM "tabOutflow Import Row" WHERE name = %s""",
            (frappe.generate_hash(length=12), U, U, PAYMENT, paid, other),
        )
        frappe.db.commit()
        cheque = self._old_type(number, 50000, [(approved, 30000), (paid, 20000)])
        self._left_at_approved(approved)

        (row,) = self._import((number, 50000))

        self.assertEqual(self._statuses(approved, paid), ["Paid", "Paid"])
        self.assertEqual(self._legs(row), [(approved, "cheque number")])
        # 20,000 of the line stays unexplained: the bank paid that payment twice.
        self.assertEqual(self._line(row).row_status, "Partially Allocated")
        self.assertEqual(self._state(cheque).status, "Cleared")

    def test_a_cancelled_old_type_cheque_s_rejected_payments_are_paid_and_its_history_says_so(self):
        number = self._number()
        a, b = self._payment(30000, RP), self._payment(20000, RP)
        cheque = self._old_type(number, 50000, [(a, 30000), (b, 20000)])
        cancel(cheque, note="Vendor lost the cheque", user=U)
        frappe.db.commit()
        self.assertEqual(self._statuses(a, b), ["Rejected", "Rejected"])

        (row,) = self._import((number, 50000))

        self.assertEqual(self._statuses(a, b), ["Paid", "Paid"])
        self.assertEqual(self._payment_dates(a, b), [self.day, self.day])
        self.assertEqual(self._legs(row), sorted([(a, "cheque number"), (b, "cheque number")]))
        last = self._history(cheque)[-1]
        self.assertEqual(last[:2], ("Cancelled", "Cleared"))
        self.assertIn(BANK_REVIVAL_NOTE, last[3])
        self.assertEqual(self._state(cheque).status, "Cleared")
        self.assertEqual(self._line(row).row_status, "Settled")
        self.assertIn("was cancelled, but the bank paid it", self._line(row).outcome_note)

    def test_an_issued_old_type_cheque_s_requested_payment_is_approved_by_the_import_then_paid(self):
        number = self._number()
        moved, requested = self._payment(30000, RP), self._payment(15000)
        cheque = self._old_type(number, 45000, [(moved, 30000), (requested, 15000)])
        self.assertEqual(self._statuses(requested), ["Requested"])

        (row,) = self._import((number, 45000))

        self.assertEqual(self._statuses(moved, requested), ["Paid", "Paid"])
        self.assertEqual(str(frappe.db.get_value(PAYMENT, requested, "approval_date")), self.day)
        self.assertEqual(self._legs(row), sorted([(moved, "cheque number"), (requested, "cheque number")]))
        self.assertEqual(self._history(cheque)[-1][:2], ("Issued", "Cleared"))
        self.assertEqual(self._state(cheque).status, "Cleared")
        self.assertEqual(self._line(row).row_status, "Settled")

    def test_a_payment_on_hold_refuses_the_clear_with_its_reason_and_nothing_is_settled(self):
        number = self._number()
        moved, held = self._payment(30000, RP), self._payment(20000, RP)
        cheque = self._old_type(number, 50000, [(moved, 30000), (held, 20000)])
        self._left_at_approved(held)
        # Held before cheque payments could not be (raw: test setup).
        frappe.db.set_value(PAYMENT, held, "on_hold", 1, update_modified=False)
        frappe.db.commit()

        (row,) = self._import((number, 50000))

        self.assertEqual(self._statuses(moved, held), [RP, "Approved"])
        self.assertEqual((self._state(cheque).status, self._legs(row)), ("Issued", []))
        self.assertEqual(
            self._line(row).outcome_note,
            f"Cheque {number} matches this line but could not be cleared: payment {held} is on hold, so it cannot "
            "be paid until the hold is released. Nothing was settled.",
        )

    def test_an_approval_pending_old_type_cheque_is_issued_by_the_import_then_cleared(self):
        number = self._number()
        requested = self._payment(25000)
        cheque = self._old_type(number, 25000, [(requested, 25000)])
        frappe.db.set_value("Cheques", cheque, "status", "Approval Pending", update_modified=False)  # test setup
        frappe.db.commit()

        (row,) = self._import((number, 25000))

        self.assertEqual(self._statuses(requested), ["Paid"])
        history = self._history(cheque)
        self.assertEqual(history[-2], ("Approval Pending", "Issued", U, BANK_APPROVAL_NOTE))
        self.assertEqual(history[-1][:2], ("Issued", "Cleared"))
        state = self._state(cheque)
        self.assertEqual((state.status, str(state.issue_date)), ("Cleared", self.day))
        self.assertEqual(self._shown(row)["cheque_outcome"]["started"], "Approval Pending")


class TestCancellingAnOldTypeCheque(ChequeImportCase):
    """Cancel is the way to close a cheque the import never matches (spec #1514). An Old-type cheque cancels
    as any Payment cheque does: its payments Rejected, its lines and history kept, so a bank line that
    turns up later still finds what it paid (glossary, Payment cheque)."""

    def _lines(self, cheque):
        return frappe.get_all("Cheque Line", filters={"parent": cheque, "parenttype": "Cheques"},
                              pluck="payment_name", order_by="idx asc")

    def test_cancelling_rejects_its_payments_and_keeps_every_line(self):
        number = self._number()
        a, b = self._payment(30000, RP), self._payment(15000)
        expense = self._waiting_expense(5000)
        cheque = self._old_type(number, 50000, [(a, 30000), (b, 15000)], [(expense, 5000)])

        cancel(cheque, note="Stopped at the bank", user=U)
        frappe.db.commit()

        self.assertEqual(self._statuses(a, b), ["Rejected", "Rejected"])
        self.assertEqual(self._lines(cheque), [a, b, expense])
        self.assertEqual(frappe.db.get_value(NPE, expense, "status"), RP)  # a cancel rejects payments only
        self.assertEqual(self._state(cheque).status, "Cancelled")
        self.assertEqual(self._history(cheque)[-1], ("Issued", "Cancelled", U, "Stopped at the bank"))

    def test_a_payment_rejected_on_its_own_still_drops_off_the_old_type_cheque(self):
        # #1413: outside the cheque's own cancel, a Rejected payment comes off an Old-type cheque.
        number = self._number()
        a, b = self._payment(30000, RP), self._payment(20000, RP)
        cheque = self._old_type(number, 50000, [(a, 30000), (b, 20000)])

        pay = frappe.get_doc(PAYMENT, a)
        pay.status = "Rejected"
        pay.save(ignore_permissions=True)
        frappe.db.commit()

        self.assertEqual(self._lines(cheque), [b])
        self.assertEqual(self._statuses(b), [RP])
        self.assertEqual(self._state(cheque).status, "Issued")
        self.assertIn(f"Payment {a} was Rejected, so its line was removed.", self._history(cheque)[-1][3])


class TestALineThatClearsNothing(ChequeImportCase):
    def test_the_number_with_another_amount_settles_nothing_and_shows_the_hint(self):
        number = self._number()
        cheque, (a,) = self._issued(40000, cheque_no=number)

        (row,) = self._import((number, 30000))

        self.assertEqual(self._statuses(a), [RP])
        self.assertEqual(self._state(cheque).status, "Issued")
        self.assertEqual(self._legs(row), [])
        line = self._line(row)
        self.assertEqual(line.row_status, "Mismatched")
        self.assertEqual(
            line.outcome_note,
            f"Cheque {number} found, but its amount is ₹40,000, not ₹30,000. Nothing was settled. Check the "
            "cheque, or match this line by hand.",
        )
        self.assertIsNone(self._shown(row)["cheque_outcome"])

    def test_a_security_deposit_cheque_with_the_number_is_never_matched(self):
        deposit_no = self._number()
        deposit, (a,) = self._issued(20000, cheque_no=deposit_no)
        frappe.db.set_value("Cheques", deposit, "cheque_type", "Security Deposit", update_modified=False)
        frappe.db.commit()

        (row,) = self._import((deposit_no, 20000))

        self.assertEqual(self._statuses(a), [RP])
        self.assertEqual(self._state(deposit).status, "Issued")
        self.assertEqual(
            self._line(row).outcome_note,
            f"No Payment cheque {deposit_no} on ICICI Bank. A Security Deposit cheque is never matched. Match "
            "this line by hand.",
        )

    def test_an_old_type_cheque_whose_lines_do_not_add_up_is_not_cleared(self):
        number = self._number()
        a = self._payment(20000, RP)
        cheque = self._old_type(number, 25000, [(a, 20000)])

        (row,) = self._import((number, 25000))

        self.assertEqual((self._state(cheque).status, self._statuses(a)), ("Issued", [RP]))
        self.assertEqual(self._legs(row), [])
        self.assertEqual(
            self._line(row).outcome_note,
            f"Cheque {number} matches this line but could not be cleared: its lines add up to ₹20,000, but the "
            "bank line is for ₹25,000. Nothing was settled.",
        )

    def test_a_credit_carrying_the_cheque_number_is_not_a_cheque_line(self):
        number = self._number()
        cheque, (a,) = self._issued(18000, cheque_no=number)

        (row,) = self._import((number, 18000, "credit"))

        self.assertEqual(self._statuses(a), [RP])
        self.assertEqual(self._state(cheque).status, "Issued")
        self.assertNotEqual(self._line(row).row_status, "Settled")

    def test_a_failure_rolls_the_whole_cheque_back_and_the_line_says_why(self):
        number = self._number()
        cheque, (a, b) = self._issued(9000, 6000, cheque_no=number)

        with patch("nirmaan_stack.services.cheques.status._record_bank_line",
                   side_effect=frappe.ValidationError("the bank line is locked")):
            (row,) = self._import((number, 15000))

        self.assertEqual(self._statuses(a, b), [RP, RP])
        self.assertEqual(self._state(cheque).status, "Issued")
        self.assertEqual(self._legs(row), [])
        line = self._line(row)
        self.assertEqual(line.row_status, "Mismatched")
        self.assertEqual(
            line.outcome_note,
            f"Cheque {number} matches this line but could not be cleared: the bank line is locked. Nothing was "
            "settled.",
        )

    def test_a_pending_cheque_with_a_line_still_waiting_for_its_payment_is_not_cleared(self):
        number = self._number()
        a = self._payment(10000)
        cheque = self._cheque((a, 10000), (None, 5000, frappe.db.get_value(PAYMENT, a, "document_name")))
        frappe.db.set_value("Cheques", cheque, "cheque_no", number, update_modified=False)
        frappe.db.commit()

        (row,) = self._import((number, 15000))

        self.assertEqual(self._statuses(a), ["Requested"])
        self.assertEqual(self._state(cheque).status, "Approval Pending")
        self.assertEqual(self._line(row).row_status, "Mismatched")
        self.assertIn(f"Cheque {number} matches this line but could not be cleared: Line 2", self._line(row).outcome_note)


class TestAClearedChequeStaysCleared(ChequeImportCase):
    def test_unreconciling_the_line_is_refused_and_changes_nothing(self):
        number = self._number()
        cheque, (a,) = self._issued(22000, cheque_no=number)
        (row,) = self._import((number, 22000))

        plan = plan_of_line(row)
        self.assertEqual(plan["refused_count"], 1)
        self.assertIn(f"cheque {number}, which is Cleared", plan["legs"][0]["reason"])
        with self.assertRaisesRegex(frappe.ValidationError, "which is Cleared"):
            unreconcile_line(row, "all", "wrong line", U)
        frappe.db.rollback()

        self.assertEqual(self._statuses(a), ["Paid"])
        self.assertEqual(self._line(row).row_status, "Settled")

    def test_deleting_the_line_is_refused_out_loud(self):
        number = self._number()
        self._issued(11000, cheque_no=number)
        (row,) = self._import((number, 11000))

        with self.assertRaises(frappe.LinkExistsError):
            frappe.delete_doc(ROW, row, ignore_permissions=True)
        frappe.db.rollback()
        self.assertTrue(frappe.db.exists(ROW, row))

    def test_running_the_match_again_changes_nothing(self):
        number = self._number()
        cheque, (a,) = self._issued(13000, cheque_no=number)
        (row,) = self._import((number, 13000))
        history = self._history(cheque)

        match_batch(self.batch)

        self.assertEqual(self._history(cheque), history)
        self.assertEqual(self._legs(row), [(a, "cheque number")])
        self.assertEqual(self._line(row).row_status, "Settled")


class TestAChequePaymentIsNeverPaidAlone(ChequeImportCase):
    """A Payment cheque's payments are paid by clearing the cheque, never one by one (story 45): a hand
    settle from the import's decision dialog and the payments screen's fulfil both refuse: the cheque's own
    bank line clears it (#1516)."""

    def test_settling_a_cheque_payment_from_a_bank_line_by_hand_is_refused(self):
        number = self._number()
        cheque, (a,) = self._issued(22000, cheque_no=number)
        (row,) = self._import((self._number(), 22000))  # a line naming no cheque

        with self.assertRaisesRegex(frappe.ValidationError, f"cheque {number}.*when a bank-statement line with the cheque's number"):
            settle_row(row, PAYMENT, a)
        frappe.db.rollback()

        self.assertEqual(self._statuses(a), [RP])
        self.assertEqual(self._state(cheque).status, "Issued")
        self.assertEqual(self._legs(row), [])

    def test_fulfilling_a_cheque_payment_on_the_payments_screen_is_refused(self):
        number = self._number()
        cheque, (a,) = self._issued(18000, cheque_no=number)

        with self.assertRaisesRegex(frappe.ValidationError, f"cheque {number}.*when a bank-statement line with the cheque's number"):
            update_payment_request(frappe.as_json({"action": "fulfil", "name": a, "utr": "UTR1477S2"}))
        frappe.db.rollback()

        self.assertEqual(self._statuses(a), [RP])
        self.assertEqual(self._state(cheque).status, "Issued")

    def test_clearing_the_cheque_still_pays_it(self):
        number = self._number()
        cheque, (a,) = self._issued(9000, cheque_no=number)

        self._clear_by_bank(cheque)

        self.assertEqual(self._statuses(a), ["Paid"])
