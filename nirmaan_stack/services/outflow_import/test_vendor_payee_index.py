# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Tier 1 reads the vendor's Payee (#1427, spec #1420, ADR-0033).

Drives the vendor index the match run builds (`candidates.load_vendor_index`) through the matcher's
entry point (`match_row`), against Payees and vendors planted in the env database.

⚠️ RUNS AGAINST THE ENV DATABASE (fixtures commit; every row is removed after its test).
"""

import unittest
from decimal import Decimal

import frappe

from nirmaan_stack.api.payees.payee_fixture import PayeeFixture
from nirmaan_stack.services.outflow_import.candidates import load_vendor_index
from nirmaan_stack.services.outflow_import.matcher import TIER_ACCOUNT, TargetRef, match_row
from nirmaan_stack.services.outflow_import.normalize import normalize_account

AMOUNT = Decimal("48213.37")


class _Line:
    """A staged bank line as the matcher reads it: by attribute."""

    def __init__(self, account: str, ifsc: str):
        self.amount = AMOUNT
        self.beneficiary_name = ""
        self.bank_account = account
        self.normalized_account = normalize_account(account)
        self.ifsc = ifsc
        self.bank_reference_no = ""
        self.normalized_reference = ""
        self.remarks = ""


def _payment(vendor: str) -> TargetRef:
    return TargetRef(
        doctype="Project Payments", name=f"TEST-PAY-{vendor}", amount=AMOUNT, status="Approved", vendor=vendor
    )


class TestTierOneReadsTheVendorsPayee(unittest.TestCase):
    def setUp(self):
        self.payees = PayeeFixture.attach(self)

    def _vendor(self, payee=None) -> str:
        name = f"TESTPYE-VEN-{frappe.generate_hash(length=8)}"
        frappe.db.sql(
            """INSERT INTO "tabVendors" (name, creation, modified, modified_by, owner, docstatus, idx,
                                         vendor_name, payee)
               VALUES (%s, NOW(), NOW(), 'Administrator', 'Administrator', 0, 0, %s, %s)""",
            (name, f"TESTPYE Vendor {name}", payee),
        )
        frappe.db.commit()

        def _drop():
            frappe.db.delete("Vendors", {"name": name})
            frappe.db.commit()

        self.addCleanup(_drop)
        return name

    def _line_paid_to(self, payee: str) -> _Line:
        account, ifsc = frappe.db.get_value("Payee", payee, ["account_number", "ifsc"])
        return _Line(account, ifsc)

    def test_a_line_paid_to_a_shared_payee_matches_a_payment_of_either_vendor_at_tier_1(self):
        shared = self.payees.payee()
        north, south = self._vendor(shared), self._vendor(shared)
        line = self._line_paid_to(shared)
        index = load_vendor_index()

        for vendor in (north, south):
            with self.subTest(vendor=vendor):
                result = match_row(line, index, (_payment(vendor),))
                self.assertEqual(result.tier, TIER_ACCOUNT)
                self.assertEqual([g.targets[0].vendor for g in result.payment_groups], [vendor])

    def test_a_line_paid_to_a_vendors_previous_payee_does_not_reach_tier_1(self):
        previous, current = self.payees.payee(), self.payees.payee()
        vendor = self._vendor(current)
        line = self._line_paid_to(previous)

        result = match_row(line, load_vendor_index(), (_payment(vendor),))

        self.assertNotEqual(result.tier, TIER_ACCOUNT)
        self.assertEqual(result.payment_groups, ())

