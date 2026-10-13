# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Tests for nirmaan_stack.services.outflow_import.refund_suggestion (#1402, spec #1396 seam 3).

The rule that suggests a waiting Vendor Refund for a bank credit line. Names, accounts and references
are fabricated.
"""

import unittest
from decimal import Decimal

from nirmaan_stack.services.outflow_import.matcher import (
    BASIS_ACCOUNT_IFSC,
    BASIS_BANK_REFERENCE,
    TargetRef,
    VendorRef,
    build_vendor_index,
    resolve_vendors,
)
from nirmaan_stack.services.outflow_import.normalize import normalize_account, normalize_reference
from nirmaan_stack.services.outflow_import.refund_suggestion import (
    encode_suggestion,
    shown_suggestion,
    suggest_waiting_refunds,
)

SUNRISE = VendorRef(
    name="VEN-SUNRISE",
    vendor_name="Sunrise HVAC Pvt Ltd",
    account_number="50200011112222",
    ifsc="HDFC0001234",
)
ACME = VendorRef(
    name="VEN-ACME",
    vendor_name="Acme Ducting Works",
    account_number="0099887766",
    ifsc="ICIC0000999",
)
INDEX = build_vendor_index([SUNRISE, ACME])


class _Line:
    """A bank credit line as the rule reads it -- by attribute, like the matcher."""

    def __init__(self, amount, bank_reference_no="", bank_account="", ifsc="", beneficiary_name="",
                 direction="Credit"):
        self.amount = Decimal(str(amount))
        self.bank_reference_no = bank_reference_no
        self.normalized_reference = normalize_reference(bank_reference_no)
        self.bank_account = bank_account
        self.normalized_account = normalize_account(bank_account)
        self.ifsc = ifsc
        self.beneficiary_name = beneficiary_name
        self.direction = direction


def _waiting(name, amount, vendor, utr=""):
    return TargetRef(
        doctype="Vendor Refunds",
        name=name,
        amount=Decimal(str(amount)),
        status="Reconciliation Pending",
        vendor=vendor,
        reference=utr,
    )


def _suggest(line, waiting):
    return suggest_waiting_refunds(line, resolve_vendors(line, INDEX), waiting)


class TestAUtrTypedOnAWaitingRefund(unittest.TestCase):
    def test_one_refund_with_the_line_reference_is_suggested(self):
        line = _Line("28886", bank_reference_no="UTR123456789")
        pool = [
            _waiting("VRF-1", "28886", "VEN-SUNRISE", utr=" utr123456789 "),
            _waiting("VRF-2", "28886", "VEN-SUNRISE"),
        ]

        suggestion = _suggest(line, pool)

        self.assertEqual(suggestion.names, ("VRF-1",))
        self.assertEqual(suggestion.vendor, "VEN-SUNRISE")
        self.assertEqual(suggestion.basis, BASIS_BANK_REFERENCE)

    def test_several_refunds_with_the_line_reference_are_suggested_as_one_split(self):
        line = _Line("40000", bank_reference_no="UTR555")
        pool = [
            _waiting("VRF-2", "15000", "VEN-SUNRISE", utr="UTR555"),
            _waiting("VRF-1", "25000", "VEN-SUNRISE", utr="UTR555"),
            _waiting("VRF-3", "40000", "VEN-SUNRISE"),
        ]

        suggestion = _suggest(line, pool)

        self.assertEqual(suggestion.names, ("VRF-1", "VRF-2"))
        self.assertEqual(suggestion.basis, BASIS_BANK_REFERENCE)

    def test_refunds_of_two_vendors_sharing_the_reference_suggest_nothing(self):
        line = _Line("40000", bank_reference_no="UTR555")
        pool = [
            _waiting("VRF-1", "25000", "VEN-SUNRISE", utr="UTR555"),
            _waiting("VRF-2", "15000", "VEN-ACME", utr="UTR555"),
        ]

        self.assertIsNone(_suggest(line, pool))

    def test_a_debit_line_is_never_suggested_a_refund(self):
        line = _Line("28886", bank_reference_no="UTR123", direction="Debit")

        self.assertIsNone(_suggest(line, [_waiting("VRF-1", "28886", "VEN-SUNRISE", utr="UTR123")]))


class TestTheVendorsBankAccountAndOneRefundOfTheLinesAmount(unittest.TestCase):
    """Rule (b). No credit source carries an account or IFSC today; the rule fires when one does."""

    def _line(self, amount, **kw):
        return _Line(amount, bank_account="0050200011112222", ifsc="hdfc0001234", **kw)

    def test_one_refund_of_the_amount_within_a_rupee_is_suggested(self):
        pool = [
            _waiting("VRF-1", "28886.40", "VEN-SUNRISE"),
            _waiting("VRF-2", "12000", "VEN-SUNRISE"),
            _waiting("VRF-3", "28886", "VEN-ACME"),
        ]

        suggestion = _suggest(self._line("28886"), pool)

        self.assertEqual(suggestion.names, ("VRF-1",))
        self.assertEqual(suggestion.vendor, "VEN-SUNRISE")
        self.assertEqual(suggestion.basis, BASIS_ACCOUNT_IFSC)

    def test_two_refunds_of_the_same_amount_suggest_nothing(self):
        pool = [
            _waiting("VRF-1", "28886", "VEN-SUNRISE"),
            _waiting("VRF-2", "28886", "VEN-SUNRISE"),
        ]

        self.assertIsNone(_suggest(self._line("28886"), pool))

    def test_an_amount_more_than_a_rupee_off_suggests_nothing(self):
        self.assertIsNone(_suggest(self._line("28886"), [_waiting("VRF-1", "28888", "VEN-SUNRISE")]))

    def test_refunds_whose_amounts_add_up_to_the_line_suggest_nothing(self):
        pool = [
            _waiting("VRF-1", "18886", "VEN-SUNRISE"),
            _waiting("VRF-2", "10000", "VEN-SUNRISE"),
        ]

        self.assertIsNone(_suggest(self._line("28886"), pool))

    def test_the_account_without_its_ifsc_suggests_nothing(self):
        line = _Line("28886", bank_account="50200011112222", ifsc="SBIN0000001")

        self.assertIsNone(_suggest(line, [_waiting("VRF-1", "28886", "VEN-SUNRISE")]))

    def test_a_vendor_known_only_by_name_suggests_nothing(self):
        line = _Line("28886", beneficiary_name="SUNRISE HVAC PVT LTD")
        resolution = resolve_vendors(line, INDEX)
        self.assertEqual(resolution.best.vendor.name, "VEN-SUNRISE")  # the name DID resolve

        self.assertIsNone(
            suggest_waiting_refunds(line, resolution, [_waiting("VRF-1", "28886", "VEN-SUNRISE")])
        )

    def test_a_reference_typed_on_two_vendors_refunds_is_not_overruled_by_the_account(self):
        line = self._line("28886", bank_reference_no="UTR9")
        pool = [
            _waiting("VRF-1", "20000", "VEN-SUNRISE", utr="UTR9"),
            _waiting("VRF-2", "8886", "VEN-ACME", utr="UTR9"),
            _waiting("VRF-3", "28886", "VEN-SUNRISE"),
        ]

        self.assertIsNone(_suggest(line, pool))


def _pool_row(name, amount, vendor="VEN-SUNRISE", document_name="PO/1"):
    return {"name": name, "amount": amount, "vendor": vendor, "document_name": document_name}


class TestTheStoredSuggestionAsTheScreenShowsIt(unittest.TestCase):
    """What the run stores on the line, and what the decision dialog is handed back."""

    def _stored(self, *names, basis=BASIS_BANK_REFERENCE):
        line = _Line("2000", bank_reference_no="UTR7")
        pool = [_waiting(n, "1000", "VEN-SUNRISE", utr="UTR7") for n in names]
        return encode_suggestion(suggest_waiting_refunds(line, None, pool))

    def test_a_stored_suggestion_is_shown_with_each_refund_s_current_amount_and_po(self):
        pool = {"VRF-1": _pool_row("VRF-1", 1180.0, document_name="PO/7"), "VRF-2": _pool_row("VRF-2", 820.0)}

        self.assertEqual(
            shown_suggestion(self._stored("VRF-1", "VRF-2"), pool),
            {
                "vendor": "VEN-SUNRISE",
                "basis": BASIS_BANK_REFERENCE,
                "refunds": [
                    {"name": "VRF-1", "amount": 1180.0, "label": "PO/7"},
                    {"name": "VRF-2", "amount": 820.0, "label": "PO/1"},
                ],
            },
        )

    def test_a_group_with_one_refund_no_longer_waiting_is_not_shown(self):
        pool = {"VRF-1": _pool_row("VRF-1", 1180.0)}

        self.assertIsNone(shown_suggestion(self._stored("VRF-1", "VRF-2"), pool))

    def test_a_refund_moved_to_another_vendor_is_not_shown(self):
        pool = {"VRF-1": _pool_row("VRF-1", 1180.0, vendor="VEN-ACME")}

        self.assertIsNone(shown_suggestion(self._stored("VRF-1"), pool))

    def test_nothing_stored_and_a_malformed_value_show_nothing(self):
        pool = {"VRF-1": _pool_row("VRF-1", 1180.0)}

        self.assertIsNone(encode_suggestion(None))
        for value in (None, "", "not json", "[]", '{"vendor": "VEN-SUNRISE", "refunds": "VRF-1"}'):
            self.assertIsNone(shown_suggestion(value, pool), value)

    def test_an_already_parsed_value_is_read_too(self):
        pool = {"VRF-1": _pool_row("VRF-1", 1180.0)}
        stored = {"vendor": "VEN-SUNRISE", "basis": BASIS_ACCOUNT_IFSC, "refunds": ["VRF-1"]}

        self.assertEqual(shown_suggestion(stored, pool)["refunds"][0]["name"], "VRF-1")


if __name__ == "__main__":
    unittest.main()
