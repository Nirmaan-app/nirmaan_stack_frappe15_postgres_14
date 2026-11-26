# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Add Invoice of a generated invoice's signed copy (ADR-0050 decision 1, second path).

On a GST-off Work Order, an upload whose AI-read number is a generated invoice still *Generated*, with its
amount ± ₹1, is that invoice's signed copy: linked to it, so its amount counts once, and approved by the
System when the AI found the signature box signed or stamped. Found unsigned, rules 2 and 3 judge it like any
Work Order invoice. A number already Signed or Approved is refused.
Uploads are made as a Procurement Executive, who may not approve, through the endpoint the WO page calls.

Run:  DEVENV test --module nirmaan_stack.api.service_requests.test_add_invoice_signed_copy
"""

import json
from unittest.mock import patch

import frappe
from frappe.utils import flt, today

from nirmaan_stack.api.delivery_notes.update_invoice_data import update_invoice_data
from nirmaan_stack.api.invoices import recheck_auto_approve as recheck
from nirmaan_stack.api.invoices.recheck_auto_approve import pending_queue_candidates
from nirmaan_stack.api.service_requests import generated_invoices as api
from nirmaan_stack.api.service_requests.generated_invoices import get_generated_invoices, upload_signed_copy
from nirmaan_stack.api.service_requests.test_generated_invoices import (
    ACCOUNTANT,
    GI,
    PROCUREMENT,
    SCAN,
    SignedUploadTestCase,
)
from nirmaan_stack.services.work_order_invoice_rules import reason_name


class _AddInvoiceCase(SignedUploadTestCase):
    def setUp(self):
        super().setUp()
        self.wo = self._wo()
        self.record = self._generate(self.wo, 20_000)
        self.procurement = self._on_project(self._user(PROCUREMENT))

    def _add_invoice(self, *, number=None, read=None, amount=20_000, signature="signed", ai=True):
        """Add Invoice as the WO page sends it after an AI read of `read` (the number on the file)."""
        number = number or self.record["invoice_no"]
        entities = [{"type": "invoice_id", "value": read or number, "confidence": 1.0}]
        if signature:
            entities.append({"type": "authorized_signature", "value": signature, "confidence": 1.0})
        extra = {
            "autofill_used": True,
            "autofill_extracted_invoice_no": read or number,
            "autofill_extracted_amount": str(amount),
            "autofill_all_entities_json": json.dumps(entities),
            "autofill_source_file_url": SCAN,
        } if ai else {}
        return self._as(self.procurement, update_invoice_data, docname=self.wo, isSR=True, invoice_attachment=SCAN,
                        invoice_data=json.dumps({"invoice_no": number, "date": today(), "amount": amount,
                                                 "base_amount": amount, "gst_amount": 0}), **extra)

    def _vendor_invoice(self, res):
        self.assertEqual(res["status"], 200, res)
        return frappe.db.get_value("Vendor Invoices", res["data"]["vendor_invoice_id"],
                                   ["name", "status", "approved_by", "auto_approved", "auto_approve_skip_reasons"],
                                   as_dict=True)

    def _run_daily_recheck(self, invoice_name):
        from nirmaan_stack.tasks import invoice_recheck

        with patch.object(recheck, "pending_queue_candidates", return_value=[invoice_name]), \
                patch.object(invoice_recheck, "janitor_log"):
            invoice_recheck.run_daily_recheck()
        return frappe.db.get_value("Vendor Invoices", invoice_name,
                                   ["status", "approved_by", "auto_approve_skip_reasons"], as_dict=True)


class TestASignedCopy(_AddInvoiceCase):
    def test_it_is_linked_and_approved_by_the_system(self):
        vi = self._vendor_invoice(self._add_invoice())
        self.assertEqual((vi.status, vi.approved_by, vi.auto_approved), ("Approved", "System", 1))
        record = self._stored(self.record["name"])
        self.assertEqual((record.status, self._vi(self.record["name"])), ("Approved", vi.name))
        self.assertEqual(frappe.db.get_value(GI, self.record["name"], "signed_attachment"),
                         frappe.db.get_value("Vendor Invoices", vi.name, "invoice_attachment"))

    def test_its_amount_counts_once(self):
        self._vendor_invoice(self._add_invoice())
        self.assertEqual(get_generated_invoices(self.wo)["billed"], 20_000)
        self.assertEqual(flt(frappe.db.get_value("Service Requests", self.wo, "amount_invoiced")), 20_000)

    def test_a_stamp_counts_as_signed(self):
        self.assertEqual(self._vendor_invoice(self._add_invoice(signature="stamped")).status, "Approved")

    def test_a_rupee_off_is_still_its_copy(self):
        self._vendor_invoice(self._add_invoice(amount=20_001))
        self.assertEqual(self._stored(self.record["name"]).status, "Approved")


class TestAnUnsignedCopy(_AddInvoiceCase):
    """Rule 1 needs the signature, so a copy the AI found unsigned is judged by rules 2 and 3."""

    def test_it_is_approved_by_the_system_when_amount_paid_matches(self):
        self._pay(self.wo, 20_000)  # rule 3: no Approved invoice + this ₹20,000 = Amount Paid
        vi = self._vendor_invoice(self._add_invoice(signature="not_signed"))
        self.assertEqual((vi.status, vi.approved_by, vi.auto_approved), ("Approved", "System", 1))
        self.assertEqual((self._stored(self.record["name"]).status, self._vi(self.record["name"])),
                         ("Approved", vi.name))

    def test_it_is_linked_but_left_pending_when_neither_rule_matches(self):
        vi = self._vendor_invoice(self._add_invoice(signature="not_signed"))
        names = [reason_name(t) for t in vi.auto_approve_skip_reasons.split(",")]
        self.assertEqual((vi.status, vi.auto_approved, names),
                         ("Pending", 0, ["wo_generated_copy_not_signed", "wo_total_mismatch", "wo_paid_mismatch"]))
        self.assertEqual((self._stored(self.record["name"]).status, self._vi(self.record["name"])),
                         ("Signed", vi.name))

    def test_the_accountants_are_told_it_waits(self):
        # Decision 9: told whenever a signed copy is still Pending, by either path.
        accountant = self._on_project(self._user(ACCOUNTANT))
        self._vendor_invoice(self._add_invoice(signature="not_signed"))
        self.assertTrue(frappe.db.exists("Nirmaan Notifications", {"docname": self.wo, "recipient": accountant}))

    def test_the_daily_recheck_approves_it_once_amount_paid_matches(self):
        vi = self._vendor_invoice(self._add_invoice(signature="not_signed"))
        self._pay(self.wo, 20_000)
        frappe.db.commit()
        self.assertIn(vi.name, pending_queue_candidates(work_orders=True))
        after = self._run_daily_recheck(vi.name)
        self.assertEqual((after.status, after.approved_by), ("Approved", "System"))
        self.assertEqual(self._stored(self.record["name"]).status, "Approved")

    def test_the_daily_recheck_keeps_the_unsigned_reason_while_nothing_matches(self):
        vi = self._vendor_invoice(self._add_invoice(signature="not_signed"))
        frappe.db.commit()
        after = self._run_daily_recheck(vi.name)
        self.assertEqual((after.status, reason_name(after.auto_approve_skip_reasons.split(",")[0])),
                         ("Pending", "wo_generated_copy_not_signed"))
        self.assertEqual(self._stored(self.record["name"]).status, "Signed")

    def test_no_answer_from_the_ai_is_not_signed(self):
        self.assertEqual(self._vendor_invoice(self._add_invoice(signature=None)).status, "Pending")


class TestADuplicate(_AddInvoiceCase):
    def test_a_number_already_signed_is_refused(self):
        self._vendor_invoice(self._add_invoice(signature="not_signed"))
        again = self._add_invoice()
        self.assertEqual(again["status"], 400, again)
        self.assertIn(self.record["invoice_no"], again["message"])
        self.assertEqual(frappe.db.count("Vendor Invoices", {"document_name": self.wo}), 1)

    def test_a_number_already_approved_is_refused_even_typed(self):
        self._vendor_invoice(self._add_invoice())
        again = self._add_invoice(ai=False)
        self.assertEqual(again["status"], 400, again)
        self.assertEqual(frappe.db.count("Vendor Invoices", {"document_name": self.wo}), 1)


class TestUploadSignedCopy(_AddInvoiceCase):
    """Decision 1, first path, and decision 9: Upload signed copy is trusted as signed and always approved."""

    def test_it_is_approved_by_the_system_and_its_record_moves_to_approved(self):
        row = self._as(self.procurement, upload_signed_copy, self.record["name"], SCAN)
        vi = frappe.db.get_value("Vendor Invoices", self._vi(self.record["name"]),
                                 ["status", "approved_by", "auto_approved"], as_dict=True)
        self.assertEqual((vi.status, vi.approved_by, vi.auto_approved), ("Approved", "System", 1))
        self.assertEqual((row["status"], self._stored(self.record["name"]).status), ("Approved", "Approved"))

    def test_even_ahead_of_amount_paid(self):
        # Rules 2 and 3 are not checked for a signed copy: ₹20,000 billed on a WO with nothing paid.
        self._as(self.procurement, upload_signed_copy, self.record["name"], SCAN)
        self.assertEqual(flt(frappe.db.get_value("Service Requests", self.wo, "amount_invoiced")), 20_000)

    def test_no_accountant_is_told_it_waits(self):
        self._on_project(self._user(ACCOUNTANT))
        self._as(self.procurement, upload_signed_copy, self.record["name"], SCAN)
        self.assertFalse(frappe.db.exists("Nirmaan Notifications", {"docname": self.wo}))


class TestASignedCopyFromBeforeAdr0050(_AddInvoiceCase):
    """Decisions 1 and 5: a signed copy Upload signed copy left Pending before ADR-0050 (no reason recorded) is
    approved by rule 1 on the daily re-check's first run."""

    def _old_pending_copy(self):
        """A signed copy Upload signed copy left Pending before ADR-0050: linked, no reason recorded."""
        name = self.record["name"]
        record = frappe.get_doc(GI, name)
        _, invoice = api.book_signed_copy(
            name, SCAN, {"invoice_no": record.invoice_no, "date": record.invoice_date, "amount": record.amount},
            {"invoice_base_amount": record.amount, "invoice_gst_amount": 0}, signed=False)
        frappe.db.set_value("Vendor Invoices", invoice.name, "auto_approve_skip_reasons", None)  # as #1547 left it
        frappe.db.commit()
        return invoice

    def test_the_daily_recheck_approves_it(self):
        invoice = self._old_pending_copy()
        self.assertIn(invoice.name, pending_queue_candidates(work_orders=True))
        vi = self._run_daily_recheck(invoice.name)
        self.assertEqual((vi.status, vi.approved_by), ("Approved", "System"))
        self.assertEqual(self._stored(self.record["name"]).status, "Approved")

    def test_once_the_work_order_turned_gst_on_no_rule_matching_it_waits_with_the_figures(self):
        # Rule 1 (the signature) is for a GST-off Work Order only: once the WO turned GST-on, rules 2 and 3 judge the
        # copy like any invoice on a GST-on WO. Nothing paid: neither matches.
        invoice = self._old_pending_copy()
        frappe.db.set_value("Service Requests", self.wo, "gst", "true")
        frappe.db.commit()
        vi = self._run_daily_recheck(invoice.name)
        self.assertEqual((vi.status, vi.approved_by), ("Pending", None))
        self.assertEqual([reason_name(t) for t in vi.auto_approve_skip_reasons.split(",")],
                         ["wo_total_mismatch", "wo_base_paid_mismatch"])
        self.assertEqual(self._stored(self.record["name"]).status, "Signed")

    def test_once_the_work_order_turned_gst_on_rule_3_approves_it_when_paid(self):
        invoice = self._old_pending_copy()
        frappe.db.set_value("Service Requests", self.wo, "gst", "true")
        self._pay(self.wo, 20_000)  # base paid ₹20,000 = this copy's base (a generated invoice carries no GST)
        frappe.db.commit()
        vi = self._run_daily_recheck(invoice.name)
        self.assertEqual((vi.status, vi.approved_by), ("Approved", "System"))
        self.assertEqual(self._stored(self.record["name"]).status, "Approved")


class TestWhenTheReadAsksTheSignature(_AddInvoiceCase):
    """The Add Invoice read asks about the signature only for a GST-off Work Order with a generated invoice still
    Generated (`invoice_autofill._awaits_signed_copy`); every other read is the plain invoice read."""

    def _asks(self, work_order):
        from nirmaan_stack.api.invoice_autofill import _awaits_signed_copy

        return _awaits_signed_copy(work_order)

    def test_a_gst_off_wo_with_a_generated_invoice_waiting(self):
        self.assertTrue(self._asks(self.wo))

    def test_not_once_its_generated_invoices_are_uploaded(self):
        self._vendor_invoice(self._add_invoice())
        self.assertFalse(self._asks(self.wo))

    def test_not_on_a_gst_on_wo(self):
        frappe.db.set_value("Service Requests", self.wo, "gst", "true")
        self.assertFalse(self._asks(self.wo))

    def test_not_without_a_work_order(self):
        self.assertFalse(self._asks(None))
        self.assertFalse(self._asks("PO/NOT-A-WORK-ORDER"))


class TestANormalInvoice(_AddInvoiceCase):
    def test_a_typed_number_is_not_linked(self):
        vi = self._vendor_invoice(self._add_invoice(ai=False))
        self.assertEqual(vi.status, "Pending")
        self.assertEqual(self._stored(self.record["name"]).status, "Generated")
        self.assertTrue(vi.auto_approve_skip_reasons.startswith("wo_total_mismatch:"))

    def test_another_amount_is_not_linked(self):
        self._vendor_invoice(self._add_invoice(amount=19_000))
        self.assertEqual(self._stored(self.record["name"]).status, "Generated")
