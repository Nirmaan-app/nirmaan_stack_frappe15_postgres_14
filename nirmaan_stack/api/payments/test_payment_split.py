# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Tests for partial CEO approval — splitting one Project Payment into two.

⚠️ RUNS AGAINST THE LIVE SITE DATABASE. Every Project / PO / Payment this suite touches is one it
created, tracked and purged in `tearDown` — per TEST, not per class, because every test here moves
money and a financial assertion that depends on which test ran first is worse than no assertion.
(Same reasoning as `api/outflow_import/test_settle_payment.py`, which this fixture is modelled on.)

The properties that matter, in the order they would hurt if they broke:

  1. THE SUM INVARIANT. approved + remainder == the original, on the payments AND on the PO terms.
     Break it and `services.finance.get_total_pending` quietly widens the ceiling on how much may
     still be requested against that PO — i.e. the vendor can be over-requested, with nothing on
     screen looking wrong.
  2. NOTHING IS LOST. The balance always exists as its own pending payment. The failure mode of the
     rejected "just edit the amount" design is a vendor still owed money that no document mentions.
  3. ALL OR NOTHING. Three documents move together. A late failure must not leave an orphan
     remainder payment behind — that would be money invented from a crash.
  4. THE REMAINDER NEVER AUTO-APPROVES. The sub-₹10,001 rule is for brand-new requests; letting it
     fire here would let a large payment be salami-sliced straight past the CEO gate.
  5. THE FULL-APPROVE PATH IS UNTOUCHED. `approved_amount` absent must behave exactly as before.
"""

import unittest
from contextlib import contextmanager
from unittest.mock import patch

import frappe
from frappe.utils import flt, nowdate

from nirmaan_stack.api.payments.project_payments import ceo_approve_payment
from nirmaan_stack.constants.authorized_users import CEO_AUTHORIZED_USER
from nirmaan_stack.services.payment_split import split_and_approve

PAYMENT = "Project Payments"
PO = "Procurement Orders"
TERM = "PO Payment Terms"


class PaymentSplitFixture(unittest.TestCase):
    """A Won project, a PO with one payment term, and one CEO-Pending payment linked to it.

    Fixtures are planted with RAW SQL, deliberately. Going through
    `new_doc(...).insert()` fires `after_insert`, which fans notifications out to every admin and
    calls `frappe.db.commit()` per recipient — on the live database, and inside the very
    transaction these tests exist to observe. The arrangement and the assertion must not share a
    mechanism.
    """

    PO_TOTAL = 100000.0
    PAY_AMOUNT = 100000.0

    def setUp(self):
        super().setUp()
        frappe.set_user("Administrator")
        self.projects, self.pos, self.payments, self.srs = [], [], [], []

        self.project = self._insert_project()
        self.po = self._insert_po()
        self.payment = self._insert_payment(self.PAY_AMOUNT, status="CEO Pending")
        self.term = self._insert_term(
            self.po, amount=self.PO_TOTAL, label="Advance Payment", project_payment=self.payment
        )
        frappe.db.commit()

    # ── fixture builders ────────────────────────────────────────────────────

    def _insert_project(self):
        name = f"TEST-SPLIT-PROJ-{frappe.generate_hash(length=10)}"
        frappe.db.sql(
            """INSERT INTO "tabProjects"
                   (name, creation, modified, modified_by, owner, docstatus, idx,
                    project_name, status, tendering_status)
               VALUES (%s, NOW(), NOW(), %s, %s, 0, 0, %s, 'Created', 'Won')""",
            (name, "Administrator", "Administrator", name),
        )
        self.projects.append(name)
        return name

    def _insert_po(self, total=None):
        """⚠️ THE ITEM ROW IS NOT DECORATION.

        `ProcurementOrders.validate` recomputes `total_amount` from its `items` child table on
        EVERY save — and the split saves the PO. A PO planted without items therefore has its
        total silently rewritten to 0 the first time the code under test touches it, and the next
        insert then trips `ProjectPayments.before_insert` ("cannot exceed the total amount of the
        document"). That failure looks exactly like a bug in the split.
        """
        amount = float(self.PO_TOTAL if total is None else total)
        name = f"TEST-SPLIT-PO-{frappe.generate_hash(length=10)}"
        frappe.db.sql(
            """INSERT INTO "tabProcurement Orders"
                   (name, creation, modified, modified_by, owner, docstatus, idx,
                    project, total_amount, amount, tax_amount, amount_paid, status)
               VALUES (%s, NOW(), NOW(), %s, %s, 0, 0, %s, %s, %s, 0, 0, '')""",
            (name, "Administrator", "Administrator", self.project, amount, amount),
        )
        frappe.db.sql(
            """INSERT INTO "tabPurchase Order Item"
                   (name, creation, modified, modified_by, owner, docstatus, idx,
                    parent, parenttype, parentfield,
                    item_name, unit, category, quantity, quote, amount, tax_amount, total_amount)
               VALUES (%s, NOW(), NOW(), %s, %s, 0, 1, %s, %s, 'items',
                       'Test Line', 'Nos', 'Test Category', 1, %s, %s, 0, %s)""",
            (frappe.generate_hash(length=10), "Administrator", "Administrator",
             name, PO, amount, amount, amount),
        )
        self.pos.append(name)
        return name

    def _insert_service_request(self, total):
        """A real SR row — the payment's Dynamic Link is validated on insert, so a made-up
        docname fails before the split is ever exercised."""
        name = f"TEST-SPLIT-SR-{frappe.generate_hash(length=10)}"
        frappe.db.sql(
            """INSERT INTO "tabService Requests"
                   (name, creation, modified, modified_by, owner, docstatus, idx,
                    project, total_amount, status, gst)
               VALUES (%s, NOW(), NOW(), %s, %s, 0, 0, %s, %s, 'Approved', 'false')""",
            (name, "Administrator", "Administrator", self.project, float(total)),
        )
        self.srs.append(name)
        return name

    def _insert_payment(self, amount, *, status, document_type=PO, document_name=None):
        name = f"TEST-SPLIT-PAY-{frappe.generate_hash(length=12)}"
        frappe.db.sql(
            """INSERT INTO "tabProject Payments"
                   (name, creation, modified, modified_by, owner, docstatus, idx,
                    project, amount, status, document_type, document_name, approval_date)
               VALUES (%s, NOW(), NOW(), %s, %s, 0, 0, %s, %s, %s, %s, %s, %s)""",
            (name, "Administrator", "Administrator", self.project, float(amount), status,
             document_type,
             (self.po if document_name is None else document_name) if document_type else None,
             nowdate()),
        )
        self.payments.append(name)
        return name

    def _insert_term(self, po_name, *, amount, label, project_payment, term_status="CEO Pending",
                     payment_type="Delivery against Payment", due_date=None, idx=1):
        name = frappe.generate_hash(length=10)
        frappe.db.sql(
            """INSERT INTO "tabPO Payment Terms"
                   (name, creation, modified, modified_by, owner, docstatus, idx,
                    parent, parenttype, parentfield,
                    label, amount, percentage, payment_type, due_date,
                    term_status, project_payment, project, vendor)
               VALUES (%s, NOW(), NOW(), %s, %s, 0, %s, %s, %s, 'payment_terms',
                       %s, %s, %s, %s, %s, %s, %s, %s, NULL)""",
            (name, "Administrator", "Administrator", idx, po_name, PO,
             label, float(amount), str(float(amount) / self.PO_TOTAL * 100),
             payment_type, due_date, term_status, project_payment, self.project),
        )
        return name

    # ── helpers ─────────────────────────────────────────────────────────────

    def _terms(self, po_name=None):
        return frappe.get_all(
            TERM,
            filters={"parent": po_name or self.po, "parenttype": PO},
            fields=["name", "label", "amount", "percentage", "term_status",
                    "project_payment", "payment_type", "due_date"],
            order_by="idx asc",
        )

    def _pay(self, name):
        return frappe.db.get_value(
            PAYMENT, name,
            ["amount", "status", "split_from", "ceo_approval_date", "approval_date",
             "auto_approved", "document_type", "document_name", "project", "vendor"],
            as_dict=True,
        )

    @contextmanager
    def _as_user(self, user):
        """Swap the session user for the duration of a call.

        `mock.patch("frappe.session.user", ...)` does NOT work — `frappe.session` is a
        request-local proxy with no `__dict__` for mock to read, and the failure is an obscure
        `'NoneType' object is not subscriptable`. `frappe.set_user` is no good either: it
        requires the user to exist, and the negative test needs one that does not. The gate under
        test is a plain string comparison, so a direct assignment is both sufficient and honest.
        """
        previous = frappe.session.user
        frappe.session.user = user
        try:
            yield
        finally:
            frappe.session.user = previous

    def _remainder_of(self, original):
        rows = frappe.get_all(PAYMENT, filters={"split_from": original}, pluck="name")
        self.payments.extend(n for n in rows if n not in self.payments)
        return rows

    def tearDown(self):
        # Remainder payments are minted by the code under test, so sweep by link
        # as well as by the names we planted.
        for parent in list(self.payments):
            for child in frappe.get_all(PAYMENT, filters={"split_from": parent}, pluck="name"):
                if child not in self.payments:
                    self.payments.append(child)

        if self.payments:
            frappe.db.delete("Nirmaan Notifications", {"docname": ["in", self.payments]})
            frappe.db.delete("Comment", {"reference_doctype": PAYMENT,
                                         "reference_name": ["in", self.payments]})
            frappe.db.delete("Version", {"ref_doctype": PAYMENT, "docname": ["in", self.payments]})
            frappe.db.delete(PAYMENT, {"name": ["in", self.payments]})
        if self.pos:
            frappe.db.delete(TERM, {"parent": ["in", self.pos]})
            frappe.db.delete("Purchase Order Item", {"parent": ["in", self.pos]})
            frappe.db.delete("Version", {"ref_doctype": PO, "docname": ["in", self.pos]})
            frappe.db.delete(PO, {"name": ["in", self.pos]})
        if self.srs:
            frappe.db.delete("Service Requests", {"name": ["in", self.srs]})
        if self.projects:
            frappe.db.delete("Nirmaan Notifications", {"project": ["in", self.projects]})
            frappe.db.delete("Projects", {"name": ["in", self.projects]})
        frappe.db.commit()
        frappe.set_user("Administrator")
        super().tearDown()


class TestSplitHappyPath(PaymentSplitFixture):

    def test_original_is_trimmed_and_approved(self):
        split_and_approve(self.payment, 60000)
        frappe.db.commit()

        row = self._pay(self.payment)
        self.assertEqual(flt(row.amount), 60000.0)
        self.assertEqual(row.status, "Approved")
        self.assertEqual(str(row.ceo_approval_date), nowdate())

    def test_remainder_payment_is_created_at_the_same_stage(self):
        split_and_approve(self.payment, 60000)
        frappe.db.commit()

        children = self._remainder_of(self.payment)
        self.assertEqual(len(children), 1, "exactly one remainder payment")

        rem = self._pay(children[0])
        self.assertEqual(flt(rem.amount), 40000.0)
        self.assertEqual(rem.status, "CEO Pending", "the balance stays at the stage it was at")
        self.assertEqual(rem.split_from, self.payment)
        self.assertIsNone(rem.ceo_approval_date, "the CEO has NOT approved this half")
        # The project lead's approval of this money is not undone by the CEO trimming it.
        self.assertEqual(str(rem.approval_date), nowdate())
        # Same money, same counterparty.
        self.assertEqual(rem.document_type, PO)
        self.assertEqual(rem.document_name, self.po)
        self.assertEqual(rem.project, self.project)

    def test_the_two_payments_sum_to_the_original(self):
        split_and_approve(self.payment, 33333.33)
        frappe.db.commit()

        rem = self._pay(self._remainder_of(self.payment)[0])
        total = flt(self._pay(self.payment).amount) + flt(rem.amount)
        self.assertAlmostEqual(total, self.PAY_AMOUNT, places=2)

    def test_po_gains_exactly_one_balance_term(self):
        split_and_approve(self.payment, 60000)
        frappe.db.commit()

        terms = self._terms()
        self.assertEqual(len(terms), 2)

        original, balance = terms[0], terms[1]
        self.assertEqual(flt(original.amount), 60000.0)
        self.assertEqual(original.term_status, "Approved")
        self.assertEqual(original.project_payment, self.payment)

        self.assertEqual(flt(balance.amount), 40000.0)
        self.assertEqual(balance.term_status, "CEO Pending")
        self.assertEqual(balance.label, "Advance Payment (Balance)")
        self.assertEqual(balance.project_payment, self._remainder_of(self.payment)[0])

    def test_term_amounts_still_add_up_to_the_po_total(self):
        """The PO card warns when its terms stop summing to the PO total. A split must be
        invisible to that check — this is the invariant, not a nicety."""
        before = sum(flt(t.amount) for t in self._terms())
        split_and_approve(self.payment, 71234.56)
        frappe.db.commit()
        after = sum(flt(t.amount) for t in self._terms())

        self.assertAlmostEqual(before, self.PO_TOTAL, places=2)
        self.assertAlmostEqual(after, before, places=2)

    def test_percentages_are_recomputed_on_both_rows(self):
        split_and_approve(self.payment, 25000)
        frappe.db.commit()

        original, balance = self._terms()
        self.assertAlmostEqual(float(original.percentage), 25.0, places=6)
        self.assertAlmostEqual(float(balance.percentage), 75.0, places=6)

    def test_balance_term_carries_payment_type_and_due_date(self):
        """A Credit term with no due date can never be requested — `create_project_payment`
        refuses it outright — so a blank one here would strand the balance forever."""
        pay = self._insert_payment(50000, status="CEO Pending")
        self._insert_term(self.po, amount=50000, label="Credit Leg", project_payment=pay,
                          payment_type="Credit", due_date="2026-01-31", idx=2)
        frappe.db.commit()

        split_and_approve(pay, 20000)
        frappe.db.commit()

        balance = next(t for t in self._terms() if t.label == "Credit Leg (Balance)")
        self.assertEqual(balance.payment_type, "Credit")
        self.assertEqual(str(balance.due_date), "2026-01-31")


class TestSplitGuards(PaymentSplitFixture):

    def test_amount_above_the_original_is_refused(self):
        with self.assertRaises(frappe.ValidationError):
            split_and_approve(self.payment, self.PAY_AMOUNT + 1)
        self._assert_untouched()

    def test_zero_and_negative_are_refused(self):
        for bad in (0, -5000):
            with self.subTest(amount=bad):
                with self.assertRaises(frappe.ValidationError):
                    split_and_approve(self.payment, bad)
        self._assert_untouched()

    def test_a_sub_rupee_balance_is_refused(self):
        """Not a split — approve the full amount instead. Guards against minting a
        zero-value payment and a zero-value PO term row nobody can ever action."""
        with self.assertRaises(frappe.ValidationError):
            split_and_approve(self.payment, self.PAY_AMOUNT - 0.4)
        self._assert_untouched()

    def test_a_payment_not_awaiting_the_ceo_is_refused(self):
        for status in ("Requested", "Approved", "Paid", "Rejected"):
            with self.subTest(status=status):
                frappe.db.set_value(PAYMENT, self.payment, "status", status,
                                    update_modified=False)
                frappe.db.commit()
                with self.assertRaises(frappe.ValidationError):
                    split_and_approve(self.payment, 60000)
        frappe.db.set_value(PAYMENT, self.payment, "status", "CEO Pending",
                            update_modified=False)
        frappe.db.commit()
        self._assert_untouched()

    def test_a_project_on_ceo_hold_is_refused(self):
        frappe.db.set_value("Projects", self.project, "status", "CEO Hold",
                            update_modified=False)
        frappe.db.commit()
        with self.assertRaises(frappe.ValidationError):
            split_and_approve(self.payment, 60000)
        frappe.db.set_value("Projects", self.project, "status", "Created",
                            update_modified=False)
        frappe.db.commit()
        self._assert_untouched()

    def test_a_refund_cannot_be_split_and_says_so_plainly(self):
        """⚠️ NEGATIVE PAYMENTS ARE REAL AND REACH THIS QUEUE.

        A credit raised after a negative-rate amendment is inserted with `amount < 0`
        (`create_payment_request_for_service` allows it explicitly), and the sub-threshold
        auto-approval excludes it (`0 < amount < ...`), so it ALWAYS travels
        Requested -> CEO Pending -> Approved. 127 exist on the live database.

        Splitting one is meaningless. The refusal must name that, not complain about
        "exceeding" a negative amount.
        """
        refund = self._insert_payment(-50000, status="CEO Pending")
        frappe.db.commit()

        with self.assertRaises(frappe.ValidationError) as caught:
            split_and_approve(refund, 10000)
        self.assertIn("cannot be split", str(caught.exception))

        self.assertEqual(flt(self._pay(refund).amount), -50000.0)
        self.assertEqual(self._pay(refund).status, "CEO Pending")
        self.assertEqual(self._remainder_of(refund), [])

    def test_a_refund_still_full_approves(self):
        """The half that matters most: the guard must REFUSE the split without taking the
        ordinary approval down with it."""
        refund = self._insert_payment(-50000, status="CEO Pending")
        frappe.db.commit()

        with self._as_user(CEO_AUTHORIZED_USER):
            ceo_approve_payment(refund)
        frappe.db.commit()

        row = self._pay(refund)
        self.assertEqual(row.status, "Approved")
        self.assertEqual(flt(row.amount), -50000.0, "a refund is approved in full, unaltered")
        self.assertEqual(self._remainder_of(refund), [])

    def test_a_payment_too_small_to_leave_two_halves_is_refused(self):
        tiny = self._insert_payment(1.5, status="CEO Pending")
        frappe.db.commit()

        with self.assertRaises(frappe.ValidationError) as caught:
            split_and_approve(tiny, 1)
        self.assertIn("cannot be split", str(caught.exception))
        self.assertEqual(self._remainder_of(tiny), [])

    def _assert_untouched(self):
        frappe.db.commit()
        row = self._pay(self.payment)
        self.assertEqual(flt(row.amount), self.PAY_AMOUNT)
        self.assertEqual(row.status, "CEO Pending")
        self.assertEqual(self._remainder_of(self.payment), [],
                         "a refused split must mint nothing")
        self.assertEqual(len(self._terms()), 1, "a refused split must add no PO term")


class TestSplitAtomicity(PaymentSplitFixture):

    def test_a_failure_writing_the_po_leaves_nothing_behind(self):
        """The sharpest failure mode: the remainder payment is inserted BEFORE the PO terms are
        written, so a late failure without a rollback leaves money invented from a crash."""
        with patch(
            "nirmaan_stack.services.payment_split._split_po_term",
            side_effect=RuntimeError("boom"),
        ):
            with self.assertRaises(RuntimeError):
                split_and_approve(self.payment, 60000)
        frappe.db.commit()

        row = self._pay(self.payment)
        self.assertEqual(flt(row.amount), self.PAY_AMOUNT, "original amount reverted")
        self.assertEqual(row.status, "CEO Pending", "original status reverted")
        self.assertEqual(self._remainder_of(self.payment), [], "no orphan remainder payment")
        self.assertEqual(len(self._terms()), 1, "no orphan PO term")


class TestSplitSideEffects(PaymentSplitFixture):

    def test_the_remainder_never_auto_approves(self):
        """Below the ₹10,001 new-request threshold. If that rule leaked in here, a large payment
        could be salami-sliced straight past the CEO gate."""
        split_and_approve(self.payment, 95000)
        frappe.db.commit()

        rem = self._pay(self._remainder_of(self.payment)[0])
        self.assertEqual(flt(rem.amount), 5000.0)
        self.assertEqual(rem.status, "CEO Pending")
        self.assertFalse(rem.auto_approved)
        self.assertIsNone(rem.ceo_approval_date)

    def test_no_new_payment_request_notification_for_the_remainder(self):
        """`after_insert`'s admin fan-out would both mis-describe the balance AND commit
        mid-savepoint. `flags.split_child` is what stops it."""
        split_and_approve(self.payment, 60000)
        frappe.db.commit()

        remainder = self._remainder_of(self.payment)[0]
        notes = frappe.get_all(
            "Nirmaan Notifications",
            filters={"docname": remainder, "event_id": "payment:new"},
            pluck="name",
        )
        self.assertEqual(notes, [])

    def test_the_pending_ceiling_for_the_po_is_unchanged(self):
        """`get_total_pending` feeds the "maximum you can request" check. A split that lost or
        gained a rupee would move that ceiling silently."""
        from nirmaan_stack.services.finance import get_total_pending

        src = frappe.get_doc(PO, self.po)
        before = get_total_pending(src)
        split_and_approve(self.payment, 42000)
        frappe.db.commit()
        after = get_total_pending(src)

        self.assertAlmostEqual(before, after, places=2)

    def test_saving_the_po_changes_nothing_on_the_po_but_its_terms(self):
        """⚠️ `po_doc.save()` RUNS THE PO's OWN `validate`, WHICH REWRITES PARENT FIELDS.

        It recomputes `total_amount` / `amount` / `tax_amount` from the items child table and
        re-derives `billing_status`. That is harmless ONLY while every PO's stored values already
        agree with its items — measured across all 6,879 live POs at build time: zero drift on
        the totals, zero on billing_status, zero blank `item_id`s. So the save is a genuine no-op
        outside the term rows.

        This pins it. If a future change lets a PO's stored total drift from its items, a split
        would silently rewrite that PO's value — a financial edit nobody asked for, made by an
        approval — and this test is what catches it.
        """
        before = frappe.db.get_value(
            PO, self.po, ["total_amount", "amount", "tax_amount", "billing_status"], as_dict=True
        )

        split_and_approve(self.payment, 60000)
        frappe.db.commit()

        after = frappe.db.get_value(
            PO, self.po, ["total_amount", "amount", "tax_amount", "billing_status"], as_dict=True
        )
        self.assertEqual(flt(before.total_amount), flt(after.total_amount))
        self.assertEqual(flt(before.amount), flt(after.amount))
        self.assertEqual(flt(before.tax_amount), flt(after.tax_amount))
        self.assertEqual(before.billing_status or "", after.billing_status or "")

    def test_a_remainder_can_itself_be_split(self):
        split_and_approve(self.payment, 60000)
        frappe.db.commit()
        first = self._remainder_of(self.payment)[0]

        split_and_approve(first, 25000)
        frappe.db.commit()

        second = self._remainder_of(first)[0]
        self.assertEqual(flt(self._pay(first).amount), 25000.0)
        self.assertEqual(self._pay(first).status, "Approved")
        self.assertEqual(flt(self._pay(second).amount), 15000.0)
        self.assertEqual(self._pay(second).split_from, first)

        # Three terms now, still summing to the PO total.
        terms = self._terms()
        self.assertEqual(len(terms), 3)
        self.assertAlmostEqual(sum(flt(t.amount) for t in terms), self.PO_TOTAL, places=2)
        # The label does not grow a second suffix.
        self.assertEqual(
            [t.label for t in terms],
            ["Advance Payment", "Advance Payment (Balance)", "Advance Payment (Balance)"],
        )


class TestSplitOnServiceRequests(PaymentSplitFixture):
    """SRs carry no payment terms at all, so only the payment half applies (owner ruling)."""

    def test_service_request_payment_splits_with_no_terms(self):
        sr = self._insert_service_request(total=80000)
        sr_pay = self._insert_payment(
            80000, status="CEO Pending",
            document_type="Service Requests", document_name=sr,
        )
        frappe.db.commit()

        result = split_and_approve(sr_pay, 30000)
        frappe.db.commit()

        self.assertIsNone(result["po_name"])
        self.assertIsNone(result["term_synced"])

        rem = self._pay(self._remainder_of(sr_pay)[0])
        self.assertEqual(flt(self._pay(sr_pay).amount), 30000.0)
        self.assertEqual(self._pay(sr_pay).status, "Approved")
        self.assertEqual(flt(rem.amount), 50000.0)
        self.assertEqual(rem.status, "CEO Pending")
        self.assertEqual(rem.document_type, "Service Requests")
        # The PO in this fixture is a bystander and must not have grown a row.
        self.assertEqual(len(self._terms()), 1)


class TestEndpoint(PaymentSplitFixture):

    def test_non_ceo_user_is_refused_and_nothing_is_written(self):
        frappe.set_user("Administrator")
        with self._as_user("someone-else@example.com"):
            with self.assertRaises(frappe.PermissionError):
                ceo_approve_payment(self.payment, 60000)
        frappe.db.commit()

        self.assertEqual(flt(self._pay(self.payment).amount), self.PAY_AMOUNT)
        self.assertEqual(self._pay(self.payment).status, "CEO Pending")
        self.assertEqual(self._remainder_of(self.payment), [])

    def test_absent_amount_is_the_original_full_approve(self):
        """The pre-existing path must stay byte-identical: one payment, no split, no new term."""
        with self._as_user(CEO_AUTHORIZED_USER):
            ceo_approve_payment(self.payment)
        frappe.db.commit()

        row = self._pay(self.payment)
        self.assertEqual(flt(row.amount), self.PAY_AMOUNT, "amount untouched")
        self.assertEqual(row.status, "Approved")
        self.assertIsNone(row.split_from)
        self.assertEqual(self._remainder_of(self.payment), [], "no remainder minted")
        self.assertEqual(len(self._terms()), 1, "no balance term minted")

    def test_amount_equal_to_the_full_amount_is_not_a_split(self):
        """Guards the boundary: approving 100% must not mint a zero-value remainder."""
        with self._as_user(CEO_AUTHORIZED_USER):
            ceo_approve_payment(self.payment, self.PAY_AMOUNT)
        frappe.db.commit()

        self.assertEqual(flt(self._pay(self.payment).amount), self.PAY_AMOUNT)
        self.assertEqual(self._pay(self.payment).status, "Approved")
        self.assertEqual(self._remainder_of(self.payment), [])
        self.assertEqual(len(self._terms()), 1)

    def test_partial_amount_splits_and_reports_both_halves(self):
        with self._as_user(CEO_AUTHORIZED_USER):
            # Arrives from the browser as a string.
            response = ceo_approve_payment(self.payment, "60000")
        frappe.db.commit()

        data = response["data"]
        self.assertEqual(data["approved_payment"], self.payment)
        self.assertEqual(flt(data["approved_amount"]), 60000.0)
        self.assertEqual(flt(data["remainder_amount"]), 40000.0)
        self.assertEqual(data["remainder_payment"], self._remainder_of(self.payment)[0])
        self.assertTrue(data["term_synced"])
