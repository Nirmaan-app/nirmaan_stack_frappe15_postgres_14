# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt
"""The cheque photo reader (#1409, spec #1407): `extract_payment_fields(file_url, mode="cheque")`
reads bank, cheque number, date, amount and payee off a cheque photo.

Gemini is replaced at `GeminiExtractor._build_client`, so a canned reply still runs through the
real JSON parse, entity build, pick and the cheque rules. A field the model leaves null, or that
the rules cannot trust, comes back empty for the user to type.

Run: DEVENV test --module nirmaan_stack.api.test_cheque_photo_reader
"""

import json
from types import SimpleNamespace
from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api import payment_autofill
from nirmaan_stack.api.payments.taxed_work_order_fixture import TaxedWorkOrderFixture
from nirmaan_stack.services.extraction.gemini import GeminiExtractor
from nirmaan_stack.services.role_profiles import can_use_cheques

_SETTINGS = {
    "enabled": True,
    "provider": "gemini",
    "auth_mode": "API Key",
    "gemini_model": "canned-model",
    "gemini_thinking_level": "low",
    "gemini_media_resolution": "high",
    "request_timeout_seconds": 90,
}

# A cheque photo uploaded from Add Cheque is attached to nothing yet.
_UNATTACHED_PHOTO = SimpleNamespace(
    name="FILE-CHQ", file_name="cheque.jpg", attached_to_doctype=None, attached_to_name=None
)

_MICR = "⑈004521⑈ 400229012⑆ 000123⑈ 29"


class _FakeModels:
    def __init__(self, reply):
        self._reply = reply

    def generate_content(self, model, contents, config):
        return SimpleNamespace(text=json.dumps(self._reply), candidates=[])


def _read(reply):
    client = SimpleNamespace(models=_FakeModels(reply))
    with patch.object(payment_autofill, "get_file_doc_by_url", return_value=_UNATTACHED_PHOTO), \
            patch.object(payment_autofill, "get_extraction_settings", return_value=_SETTINGS), \
            patch.object(payment_autofill, "fetch_file_content", return_value=b"jpeg-canned"), \
            patch.object(GeminiExtractor, "_build_client", return_value=client):
        return payment_autofill.extract_payment_fields("/private/files/cheque.jpg", mode="cheque")


class TestChequePhotoReader(FrappeTestCase):
    def test_the_cheque_number_is_the_first_micr_group(self):
        out = _read({"micr_line": _MICR})
        self.assertEqual(out["cheque_no"], "004521")

    def test_a_misread_first_group_leaves_the_number_empty_never_a_later_group(self):
        # The first group lost two digits; the account group 000123 is six digits but is not the number.
        out = _read({"micr_line": "4521 400229012 000123 29"})
        self.assertEqual(out["cheque_no"], "")

    def test_icici_is_mapped_to_icici_bank(self):
        out = _read({"bank_name": "ICICI BANK LIMITED"})
        self.assertEqual((out["bank"], out["bank_name"]), ("ICICI Bank", ""))

    def test_any_other_bank_is_others_with_its_printed_name(self):
        out = _read({"bank_name": "  HDFC  Bank Ltd "})
        self.assertEqual((out["bank"], out["bank_name"]), ("Others", "HDFC Bank Ltd"))

    def test_unsure_fields_come_back_empty(self):
        out = _read({
            "bank_name": None, "micr_line": None, "cheque_date": None,
            "amount_in_figures": None, "payee": "null",
        })
        self.assertEqual(
            {k: out[k] for k in ("bank", "bank_name", "cheque_no", "cheque_date", "amount", "payee_name")},
            {"bank": "", "bank_name": "", "cheque_no": "", "cheque_date": "", "amount": None, "payee_name": ""},
        )

    def test_the_amount_is_the_figures_box(self):
        out = _read({"amount_in_figures": 150000, "amount_in_words": "One lakh only"})
        self.assertEqual(out["amount"], 150000.0)

    def test_the_amount_in_words_alone_is_not_read(self):
        out = _read({"amount_in_figures": None, "amount_in_words": "One lakh fifty thousand only"})
        self.assertIsNone(out["amount"])

    def test_the_date_is_read_from_the_dd_mm_yyyy_boxes(self):
        self.assertEqual(_read({"cheque_date": "12-10-2026"})["cheque_date"], "2026-10-12")
        self.assertEqual(_read({"cheque_date": "1 2 1 0 2 0 2 6"})["cheque_date"], "2026-10-12")

    def test_a_date_that_is_not_a_day_is_left_empty(self):
        self.assertEqual(_read({"cheque_date": "31-02-2026"})["cheque_date"], "")
        self.assertEqual(_read({"cheque_date": "12-10"})["cheque_date"], "")

    def test_the_payee_is_the_pay_line(self):
        out = _read({"payee": "  Sharma Steel   Traders "})
        self.assertEqual(out["payee_name"], "Sharma Steel Traders")


class TestPayeeMatchesVendor(FrappeTestCase):
    """The soft warning when the photo's payee does not look like the picked Vendor. It never blocks."""

    def setUp(self):
        fx = TaxedWorkOrderFixture.attach(self)
        self.vendor = fx.vendor()
        # Test setup on a planted row: no doc_events matter for a Vendor's display names.
        frappe.db.set_value(
            "Vendors", self.vendor, {"vendor_name": "Sharma Steel Traders", "account_name": "KRISHNA METALS"}
        )
        frappe.db.commit()

    def _match(self, payee):
        return payment_autofill.match_payee_to_vendor(payee=payee, vendor=self.vendor)["match"]

    def test_a_payee_that_looks_like_the_vendor_matches(self):
        self.assertIs(self._match("SHARMA STEEL TRADERS PVT LTD"), True)

    def test_a_payee_that_is_the_vendors_bank_account_name_matches(self):
        self.assertIs(self._match("Krishna Metals"), True)

    def test_a_different_payee_is_a_mismatch(self):
        self.assertIs(self._match("Tata Power Company"), False)

    def test_no_payee_cannot_be_checked(self):
        self.assertIsNone(self._match(""))

    def _as_user_who(self, *, may_request: bool):
        """A real user who may (or may not) request a payment, outside the cheque roles."""
        for user in frappe.get_all("Nirmaan Users", pluck="name", limit=500):
            if not frappe.db.exists("User", user) or user == "Administrator" or can_use_cheques(user):
                continue
            if bool(frappe.has_permission("Project Payments", "create", user=user)) == may_request:
                frappe.set_user(user)
                self.addCleanup(frappe.set_user, "Administrator")
                return
        self.skipTest(f"no user outside the cheque roles with may_request={may_request} on this site")

    def test_a_user_who_may_neither_request_payments_nor_use_cheques_is_refused(self):
        # The answer names the Vendor's bank account holder: only the people filling a cheque form ask.
        self._as_user_who(may_request=False)
        with self.assertRaises(frappe.PermissionError):
            self._match("Krishna Metals")

    def test_a_user_who_may_request_a_payment_is_answered(self):
        # Request Payment's Cheque mode reads the photo too, for any requester.
        self._as_user_who(may_request=True)
        self.assertIs(self._match("Krishna Metals"), True)


class TestReceiptModeStillReads(FrappeTestCase):
    def test_a_receipt_is_read_as_before_when_no_mode_is_given(self):
        client = SimpleNamespace(models=_FakeModels({"utr": "UTR 1234 5678", "payment_date": "2026-10-01"}))
        receipt = SimpleNamespace(
            name="FILE-RCPT", file_name="receipt.pdf", attached_to_doctype=None, attached_to_name=None
        )
        with patch.object(payment_autofill, "get_file_doc_by_url", return_value=receipt), \
                patch.object(payment_autofill, "get_extraction_settings", return_value=_SETTINGS), \
                patch.object(payment_autofill, "fetch_file_content", return_value=b"%PDF-canned"), \
                patch.object(GeminiExtractor, "_build_client", return_value=client):
            out = payment_autofill.extract_payment_fields("/private/files/receipt.pdf")
        self.assertEqual((out["utr"], out["payment_date"]), ("UTR12345678", "2026-10-01"))
