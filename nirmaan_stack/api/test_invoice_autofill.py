# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt
"""`extract_invoice_fields` surfaces the Invoice Base Amount and Invoice GST Amount
(#1336, ADR-0030) from a canned Gemini reply -- no live model call.

The model client is replaced at `GeminiExtractor._build_client`, so the reply still
runs through the real JSON parse, entity build, pick and normalisation. The amount
must keep coming from `total_amount` alone: base + GST is never used as a fallback.

`TestWorkOrderTotalCheck` covers the amount check the invoice dialog blocks on: a
Work Order file now gets the Purchase Order total cap too (#1337).

Run: bench --site localhost run-tests --module nirmaan_stack.api.test_invoice_autofill
"""

import json
from types import SimpleNamespace
from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api import invoice_autofill
from nirmaan_stack.services.extraction.gemini import GeminiExtractor

_SETTINGS = {
    "enabled": True,
    "provider": "gemini",
    "auth_mode": "API Key",
    "gemini_model": "canned-model",
    "gemini_thinking_level": "low",
    "gemini_media_resolution": "high",
    "request_timeout_seconds": 90,
}


class _FakeModels:
    def __init__(self, reply):
        self._reply = reply

    def generate_content(self, model, contents, config):
        return SimpleNamespace(text=json.dumps(self._reply), candidates=[])


def _extract(reply, attached_to_name="SR-TEST"):
    file_doc = SimpleNamespace(
        name="FILE-TEST",
        file_name="bill.pdf",
        attached_to_doctype="Service Requests",
        attached_to_name=attached_to_name,
    )
    client = SimpleNamespace(models=_FakeModels(reply))
    with patch.object(invoice_autofill, "get_file_doc_by_url", return_value=file_doc), \
            patch.object(invoice_autofill, "get_extraction_settings", return_value=_SETTINGS), \
            patch.object(invoice_autofill, "fetch_file_content", return_value=b"%PDF-canned"), \
            patch.object(GeminiExtractor, "_build_client", return_value=client):
        return invoice_autofill.extract_invoice_fields("/private/files/bill.pdf")


class TestInvoiceAutofillSplit(FrappeTestCase):
    def test_response_carries_base_and_gst_from_the_bill(self):
        out = _extract({
            "invoice_id": "INV-77",
            "invoice_date": "2026-09-01",
            "net_amount": 50000,
            "total_tax_amount": 9000,
            "total_amount": 59000,
        })
        self.assertEqual(out["base_amount"], "50000.0")
        self.assertEqual(out["gst_amount"], "9000.0")
        self.assertEqual(out["amount"], "59000.0")
        self.assertEqual(out["confidence"]["base_amount"], 1.0)
        self.assertEqual(out["confidence"]["gst_amount"], 1.0)

    def test_amount_comes_from_the_grand_total_only(self):
        """No total on the bill -> the amount stays blank; base + GST is not summed in."""
        out = _extract({
            "invoice_id": "INV-78",
            "net_amount": 50000,
            "total_tax_amount": 9000,
        })
        self.assertEqual(out["amount"], "")
        self.assertEqual(out["base_amount"], "50000.0")
        self.assertEqual(out["gst_amount"], "9000.0")

    def test_absent_split_comes_back_blank(self):
        out = _extract({"invoice_id": "INV-79", "total_amount": 1180})
        self.assertEqual(out["base_amount"], "")
        self.assertEqual(out["gst_amount"], "")
        self.assertEqual(out["amount"], "1180.0")

    def test_zero_gst_is_a_figure_not_a_blank(self):
        """A bill with no GST on it says 0 -- that is a read, and must reach the form."""
        out = _extract({"net_amount": 1000, "total_tax_amount": 0, "total_amount": 1000})
        self.assertEqual(out["gst_amount"], "0.0")


class TestWorkOrderTotalCheck(FrappeTestCase):
    """The dialog's pre-submit block reads `validation.amount`; a Work Order gets it too."""

    def setUp(self):
        wo = frappe.new_doc("Service Requests")
        wo.update({"total_amount": 11_800, "gst": "true"})
        wo.name = "TEST-WOCAP-" + frappe.generate_hash(length=10)
        wo.db_insert()  # a bare parent row: only the total is read
        frappe.get_doc({
            "doctype": "Vendor Invoices",
            "document_type": "Service Requests",
            "document_name": wo.name,
            "invoice_no": "WOCAP-" + frappe.generate_hash(length=6),
            "invoice_date": "2026-09-01",
            "invoice_amount": 6_000,
            "status": "Pending",
        }).insert(ignore_permissions=True)
        frappe.db.commit()
        self.wo = wo.name
        self.addCleanup(self._purge)

    def _purge(self):
        frappe.db.rollback()
        frappe.db.delete("Vendor Invoices", {"document_name": self.wo})
        frappe.db.delete("Service Requests", {"name": self.wo})
        frappe.db.commit()

    def test_over_the_work_order_total_is_flagged(self):
        v = _extract({"total_amount": 5_811}, attached_to_name=self.wo)["validation"]
        self.assertTrue(v["applicable"])
        self.assertEqual(v["amount"]["order_total"], 11_800)
        self.assertEqual(v["amount"]["existing_invoiced_sum"], 6_000)
        self.assertTrue(v["amount"]["would_exceed"])
        self.assertIn("exceeds Work Order total", v["amount"]["message"])
        # GSTIN cross-checks stay Purchase-Order-only.
        self.assertIsNone(v["supplier_gstin"])
        self.assertIsNone(v["receiver_gstin"])

    def test_within_total_plus_10_is_not_flagged(self):
        v = _extract({"total_amount": 5_810}, attached_to_name=self.wo)["validation"]
        self.assertFalse(v["amount"]["would_exceed"])
        self.assertIsNone(v["amount"]["message"])
