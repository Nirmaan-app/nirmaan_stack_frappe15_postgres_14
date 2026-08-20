# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt
"""Tests for `amount_invoiced` and `amount_due` on Procurement Orders / Service Requests.

Locks in the load-bearing rules that are easy to "clean up" into bugs:

  * `amount_invoiced` = SUM(Vendor Invoices) over **Approved only** -- Pending and
    Rejected are excluded, and CREDIT NOTES ARE INCLUDED (stored negative, so they
    net off). This is deliberately NOT the Pending+Approved figure the invoice
    approval tables use, nor `invoice_qty`'s counted set.
  * `amount_due` uses DIFFERENT OPERANDS PER DOCTYPE, on purpose:
        Procurement Orders  amount_invoiced - amount_paid
        Service Requests    total_amount    - amount_paid
    Harmonising them is a bug. `test_sr_amount_due_ignores_amount_invoiced` fails
    if anyone does.
  * Both are RECOMPUTED FROM SOURCE, never incremented by a delta, so a repeat call
    is a no-op and a poisoned value repairs itself.
  * The Vendor Invoices doc events fire on insert / update / delete, recompute BOTH
    parents when an invoice is re-pointed, and skip the work when a save touched no
    total-affecting field.

Fixtures use `db_insert()` to bypass controller hooks and mandatory-field validation
where we only need the fields the recompute reads. Tests that must exercise the doc
events use a real `insert()` / `save()` / `delete()`.
"""

import unittest

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import flt, nowdate

from nirmaan_stack.api.invoices._item_billing_sync import (
    recompute_document_amount_due,
    recompute_document_amount_invoiced,
)

POISON = -987654.32


def _raw(doctype, name=None, **fields):
    """Insert a row with only the given fields, skipping ALL hooks/validation."""
    d = frappe.new_doc(doctype)
    d.update(fields)
    d.name = name or frappe.generate_hash(length=12)
    d.db_insert()
    return d.name


def _get(doctype, name, field):
    return flt(frappe.db.get_value(doctype, name, field))


def _poison(doctype, name, *fields):
    """Force a wrong value in, so a handler that does nothing FAILS rather than passes."""
    for f in fields:
        frappe.db.set_value(doctype, name, f, POISON, update_modified=False)


class TestDocumentAmountFields(FrappeTestCase):
    def setUp(self):
        self.PO = _raw("Procurement Orders", total_amount=1000, amount_paid=0)
        self.PO2 = _raw("Procurement Orders", total_amount=500, amount_paid=0)
        self.SR = _raw("Service Requests", total_amount=800, amount_paid=0)

    def _vi(self, amount, status="Approved", parent=None, doctype="Procurement Orders", **kw):
        """A Vendor Invoice row WITHOUT hooks -- for testing the recompute directly."""
        return _raw(
            "Vendor Invoices",
            document_type=doctype,
            document_name=parent or self.PO,
            invoice_no="T-" + frappe.generate_hash(length=8),
            invoice_date=nowdate(),
            invoice_amount=amount,
            status=status,
            **kw,
        )

    # ------------------------------------------------------------------ amount_invoiced

    def test_sums_approved_only(self):
        self._vi(100, status="Approved")
        self._vi(250, status="Approved")
        self._vi(999, status="Pending")   # must NOT count
        self._vi(777, status="Rejected")  # must NOT count
        recompute_document_amount_invoiced("Procurement Orders", self.PO)
        self.assertAlmostEqual(_get("Procurement Orders", self.PO, "amount_invoiced"), 350)

    def test_credit_note_is_included_and_nets_off(self):
        """Credit notes are stored NEGATIVE and must net off -- NOT be filtered out."""
        self._vi(1000, status="Approved")
        self._vi(-150, status="Approved", is_credit_note=1)
        recompute_document_amount_invoiced("Procurement Orders", self.PO)
        self.assertAlmostEqual(_get("Procurement Orders", self.PO, "amount_invoiced"), 850)

    def test_no_invoices_is_zero_not_null(self):
        _poison("Procurement Orders", self.PO, "amount_invoiced")
        recompute_document_amount_invoiced("Procurement Orders", self.PO)
        self.assertAlmostEqual(_get("Procurement Orders", self.PO, "amount_invoiced"), 0)

    def test_recompute_is_from_source_not_a_delta(self):
        """Repeat calls must not accumulate, and a poisoned value must self-repair."""
        self._vi(400, status="Approved")
        for _ in range(3):
            recompute_document_amount_invoiced("Procurement Orders", self.PO)
        self.assertAlmostEqual(_get("Procurement Orders", self.PO, "amount_invoiced"), 400)
        _poison("Procurement Orders", self.PO, "amount_invoiced")
        recompute_document_amount_invoiced("Procurement Orders", self.PO)
        self.assertAlmostEqual(_get("Procurement Orders", self.PO, "amount_invoiced"), 400)

    def test_invoiced_recompute_chains_into_amount_due(self):
        frappe.db.set_value("Procurement Orders", self.PO, "amount_paid", 300,
                            update_modified=False)
        self._vi(1000, status="Approved")
        _poison("Procurement Orders", self.PO, "amount_due")
        recompute_document_amount_invoiced("Procurement Orders", self.PO)
        self.assertAlmostEqual(_get("Procurement Orders", self.PO, "amount_due"), 700)

    # ------------------------------------------------------------------ amount_due

    def test_po_amount_due_is_invoiced_minus_paid(self):
        frappe.db.set_value("Procurement Orders", self.PO, "amount_invoiced", 900,
                            update_modified=False)
        frappe.db.set_value("Procurement Orders", self.PO, "amount_paid", 250,
                            update_modified=False)
        _poison("Procurement Orders", self.PO, "amount_due")
        recompute_document_amount_due("Procurement Orders", self.PO)
        self.assertAlmostEqual(_get("Procurement Orders", self.PO, "amount_due"), 650)

    def test_sr_amount_due_ignores_amount_invoiced(self):
        """A Work Order uses total_amount - amount_paid. If someone 'harmonises' the
        two doctypes onto amount_invoiced, this fails -- which is the point."""
        frappe.db.set_value("Service Requests", self.SR, "amount_invoiced", 5,
                            update_modified=False)
        frappe.db.set_value("Service Requests", self.SR, "amount_paid", 300,
                            update_modified=False)
        _poison("Service Requests", self.SR, "amount_due")
        recompute_document_amount_due("Service Requests", self.SR)
        # total_amount 800 - paid 300 = 500 (NOT 5 - 300 = -295)
        self.assertAlmostEqual(_get("Service Requests", self.SR, "amount_due"), 500)

    def test_amount_due_goes_negative_when_overpaid(self):
        """Overpayment must read negative -- it is not clamped (that is Liabilities)."""
        frappe.db.set_value("Procurement Orders", self.PO, "amount_invoiced", 100,
                            update_modified=False)
        frappe.db.set_value("Procurement Orders", self.PO, "amount_paid", 400,
                            update_modified=False)
        recompute_document_amount_due("Procurement Orders", self.PO)
        self.assertAlmostEqual(_get("Procurement Orders", self.PO, "amount_due"), -300)

    # ------------------------------------------------------------------ guards

    def test_guards_are_silent_no_ops(self):
        for dt, dn in (
            ("Nonexistent DocType", "x"),
            ("Procurement Orders", ""),
            ("Procurement Orders", "PO-DOES-NOT-EXIST-XYZ"),
            ("Project Payments", self.PO),   # a doctype without the fields
        ):
            recompute_document_amount_due(dt, dn)
            recompute_document_amount_invoiced(dt, dn)

    # ------------------------------------------------------------------ doc events

    def _real_vi(self, amount, status="Approved", parent=None):
        """A REAL insert, so the Vendor Invoices doc_events fire."""
        d = frappe.get_doc({
            "doctype": "Vendor Invoices",
            "document_type": "Procurement Orders",
            "document_name": parent or self.PO,
            "invoice_no": "T-" + frappe.generate_hash(length=8),
            "invoice_date": nowdate(),
            "invoice_amount": amount,
            "status": status,
        })
        d.insert(ignore_permissions=True)
        return d

    def test_doc_event_on_insert_and_status_change_and_delete(self):
        vi = self._real_vi(500, status="Approved")
        self.assertAlmostEqual(_get("Procurement Orders", self.PO, "amount_invoiced"), 500)

        vi.reload(); vi.status = "Rejected"; vi.save(ignore_permissions=True)
        self.assertAlmostEqual(_get("Procurement Orders", self.PO, "amount_invoiced"), 0)

        vi.reload(); vi.status = "Approved"; vi.save(ignore_permissions=True)
        self.assertAlmostEqual(_get("Procurement Orders", self.PO, "amount_invoiced"), 500)

        vi.reload(); vi.delete(ignore_permissions=True)
        self.assertAlmostEqual(_get("Procurement Orders", self.PO, "amount_invoiced"), 0)

    def test_repointing_an_invoice_recomputes_both_parents(self):
        """The parent link is a watched field: the order it LEFT still holds a total
        that includes it, so BOTH sides must be recomputed."""
        vi = self._real_vi(300, status="Approved")
        self.assertAlmostEqual(_get("Procurement Orders", self.PO, "amount_invoiced"), 300)

        vi.reload(); vi.document_name = self.PO2; vi.save(ignore_permissions=True)
        self.assertAlmostEqual(_get("Procurement Orders", self.PO, "amount_invoiced"), 0)
        self.assertAlmostEqual(_get("Procurement Orders", self.PO2, "amount_invoiced"), 300)

    def test_non_affecting_save_skips_the_recompute(self):
        """Documented early-exit: a save touching no total-affecting field must not
        recompute. The poison surviving is the proof it was skipped."""
        vi = self._real_vi(200, status="Approved")
        _poison("Procurement Orders", self.PO, "amount_invoiced")
        vi.reload(); vi.reconciliation_status = "na"; vi.save(ignore_permissions=True)
        self.assertAlmostEqual(_get("Procurement Orders", self.PO, "amount_invoiced"), POISON)


class TestInvoiceLifecycleKeepsAmountInvoicedTrue(FrappeTestCase):
    """APPROVE / EDIT / DELETE an invoice -> `amount_invoiced` and `amount_due` follow.

    Covers the real approval endpoint, not just a hand-set status, because that is the
    path production actually takes.
    """

    def setUp(self):
        self.PO = _raw("Procurement Orders", total_amount=100000, amount_paid=1000)

    def _pending(self, amount):
        d = frappe.get_doc({
            "doctype": "Vendor Invoices",
            "document_type": "Procurement Orders",
            "document_name": self.PO,
            "invoice_no": "T-" + frappe.generate_hash(length=8),
            "invoice_date": nowdate(),
            "invoice_amount": amount,
            "status": "Pending",
        })
        d.insert(ignore_permissions=True)
        return d

    def _approve(self, invoice_name, action="Approved", reason=None):
        """Drive the real endpoint. Its frappe.db.commit() is neutralised so the
        FrappeTestCase transaction still rolls back."""
        from nirmaan_stack.api.invoices import approve_vendor_invoice as mod
        real_commit = frappe.db.commit
        frappe.db.commit = lambda *a, **k: None
        try:
            return mod.approve_vendor_invoice(invoice_name, action, reason)
        finally:
            frappe.db.commit = real_commit

    def test_pending_invoice_does_not_count_until_approved(self):
        vi = self._pending(5000)
        self.assertAlmostEqual(_get("Procurement Orders", self.PO, "amount_invoiced"), 0)
        self._approve(vi.name)
        self.assertAlmostEqual(_get("Procurement Orders", self.PO, "amount_invoiced"), 5000)

    def test_approval_endpoint_also_moves_amount_due(self):
        vi = self._pending(5000)
        _poison("Procurement Orders", self.PO, "amount_due")
        self._approve(vi.name)
        # invoiced 5000 - paid 1000
        self.assertAlmostEqual(_get("Procurement Orders", self.PO, "amount_due"), 4000)

    def test_rejection_endpoint_keeps_it_out(self):
        vi = self._pending(5000)
        self._approve(vi.name, action="Rejected", reason="test")
        self.assertAlmostEqual(_get("Procurement Orders", self.PO, "amount_invoiced"), 0)

    def test_editing_the_invoice_amount_updates_the_total(self):
        """An EDIT to invoice_amount on an already-Approved invoice must re-derive."""
        vi = self._pending(5000)
        self._approve(vi.name)
        self.assertAlmostEqual(_get("Procurement Orders", self.PO, "amount_invoiced"), 5000)

        vi.reload()
        vi.invoice_amount = 7500
        vi.save(ignore_permissions=True)
        self.assertAlmostEqual(_get("Procurement Orders", self.PO, "amount_invoiced"), 7500)
        self.assertAlmostEqual(_get("Procurement Orders", self.PO, "amount_due"), 6500)

    def test_deleting_an_approved_invoice_removes_it(self):
        vi = self._pending(5000)
        self._approve(vi.name)
        vi.reload()
        vi.delete(ignore_permissions=True)
        self.assertAlmostEqual(_get("Procurement Orders", self.PO, "amount_invoiced"), 0)
        self.assertAlmostEqual(_get("Procurement Orders", self.PO, "amount_due"), -1000)


class TestAmountPaidKeepsAmountDueTrue(FrappeTestCase):
    """The OTHER operand: Project Payments -> `amount_paid` -> `amount_due`.

    `amount_due` must move when EITHER operand moves, so these mirror the invoice
    tests from the payment side.
    """

    def setUp(self):
        # Saving a Project Payment sends REAL Firebase push notifications to REAL
        # users -- FCM is live under `bench run-tests`, and `after_insert` calls
        # PrNotification() inline. Stub the sender for the duration of the test; it is
        # a pure side effect and nothing here asserts on it.
        from nirmaan_stack.integrations.controllers import project_payments as ppc
        self._ppc = ppc
        self._real = {
            "PrNotification": ppc.PrNotification,
            "_notify_accountants_payment_ready": ppc._notify_accountants_payment_ready,
            "_notify_admins_auto_approved": ppc._notify_admins_auto_approved,
        }
        ppc.PrNotification = lambda *a, **k: None
        ppc._notify_accountants_payment_ready = lambda *a, **k: None
        ppc._notify_admins_auto_approved = lambda *a, **k: None

        # `update_parent_amount_paid` calls frappe.db.commit() inside the save. That
        # COMMITS the fixtures permanently and destroys FrappeTestCase's rollback --
        # without this stub every run leaves orphan Projects/POs/Payments behind.
        self._real_commit = frappe.db.commit
        frappe.db.commit = lambda *a, **k: None

        # tendering_status="Won" -- the Project Payments validate hook refuses to
        # create a payment against a pre-Won project stub (_tendering_guard).
        self.PROJ = _raw("Projects", project_name="T-" + frappe.generate_hash(length=6),
                         tendering_status="Won")
        self.PO = _raw("Procurement Orders", project=self.PROJ,
                       total_amount=100000, amount_invoiced=50000, amount_paid=0)
        self.PO2 = _raw("Procurement Orders", project=self.PROJ,
                        total_amount=100000, amount_invoiced=0, amount_paid=0)

    def tearDown(self):
        frappe.db.commit = self._real_commit
        for name, fn in self._real.items():
            setattr(self._ppc, name, fn)

    def _pay(self, amount, status="Paid", parent=None):
        d = frappe.get_doc({
            "doctype": "Project Payments",
            "document_type": "Procurement Orders",
            "document_name": parent or self.PO,
            "project": self.PROJ,
            "amount": amount,
            "status": status,
        })
        d.insert(ignore_permissions=True)
        return d

    def test_paid_payment_sets_amount_paid_and_due(self):
        _poison("Procurement Orders", self.PO, "amount_paid", "amount_due")
        self._pay(12000, status="Paid")
        self.assertAlmostEqual(_get("Procurement Orders", self.PO, "amount_paid"), 12000)
        # invoiced 50000 - paid 12000
        self.assertAlmostEqual(_get("Procurement Orders", self.PO, "amount_due"), 38000)

    def test_non_paid_payment_does_not_count(self):
        self._pay(9999, status="Requested")
        self.assertAlmostEqual(_get("Procurement Orders", self.PO, "amount_paid"), 0)

    def test_transition_into_paid_updates_both(self):
        p = self._pay(12000, status="Requested")
        self.assertAlmostEqual(_get("Procurement Orders", self.PO, "amount_paid"), 0)
        p.reload(); p.status = "Paid"; p.save(ignore_permissions=True)
        self.assertAlmostEqual(_get("Procurement Orders", self.PO, "amount_paid"), 12000)
        self.assertAlmostEqual(_get("Procurement Orders", self.PO, "amount_due"), 38000)

    def test_transition_out_of_paid_reverts_both(self):
        p = self._pay(12000, status="Paid")
        p.reload(); p.status = "Rejected"; p.save(ignore_permissions=True)
        self.assertAlmostEqual(_get("Procurement Orders", self.PO, "amount_paid"), 0)
        self.assertAlmostEqual(_get("Procurement Orders", self.PO, "amount_due"), 50000)

    def test_deleting_a_paid_payment_reverts_both(self):
        p = self._pay(12000, status="Paid")
        self.assertAlmostEqual(_get("Procurement Orders", self.PO, "amount_paid"), 12000)
        p.reload(); p.delete(ignore_permissions=True)
        self.assertAlmostEqual(_get("Procurement Orders", self.PO, "amount_paid"), 0)
        self.assertAlmostEqual(_get("Procurement Orders", self.PO, "amount_due"), 50000)

    # ---------------------------------------------------------------- KNOWN OPEN BUGS
    # These two are the cause of the stale `amount_paid` observed on live POs: the
    # payment controller fires ONLY on a transition into / out of 'Paid', so a Paid
    # payment that is edited or re-pointed recomputes NOTHING. Marked expectedFailure
    # so the suite stays green while the bug is open -- and reports an UNEXPECTED
    # SUCCESS the moment someone widens the watched-field set, which is the signal to
    # delete these markers.

    @unittest.expectedFailure
    def test_editing_a_paid_payment_amount_updates_amount_paid(self):
        """KNOWN BUG: amount edited while status stays 'Paid' -> no recompute."""
        p = self._pay(12000, status="Paid")
        p.reload(); p.amount = 20000; p.save(ignore_permissions=True)
        self.assertAlmostEqual(_get("Procurement Orders", self.PO, "amount_paid"), 20000)

    @unittest.expectedFailure
    def test_repointing_a_paid_payment_updates_both_parents(self):
        """KNOWN BUG: parent link changed while status stays 'Paid' -> neither the old
        nor the new PO is recomputed."""
        p = self._pay(12000, status="Paid")
        p.reload(); p.document_name = self.PO2; p.save(ignore_permissions=True)
        self.assertAlmostEqual(_get("Procurement Orders", self.PO, "amount_paid"), 0)
        self.assertAlmostEqual(_get("Procurement Orders", self.PO2, "amount_paid"), 12000)
