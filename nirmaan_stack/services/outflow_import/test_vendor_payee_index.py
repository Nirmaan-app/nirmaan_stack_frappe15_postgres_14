# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Tier 1 reads the payment's own pay-to account, else the vendor's Payee (#1427, #1440, spec #1420,
ADR-0033 decision 9).

Drives the pools the match run builds (`candidates.load_vendor_index`, `candidates.load_payments_by_amount`)
through the matcher's entry point (`match_row`), against Payees, vendors and Approved payments planted
in the env database.

⚠️ RUNS AGAINST THE ENV DATABASE (fixtures commit; `PayeeFixture` removes every Payee and vendor after
its test, and each planted payment is deleted by its own cleanup).
"""

import unittest
from decimal import Decimal

import frappe

from nirmaan_stack.api.payees.payee_fixture import PayeeFixture, delete_each
from nirmaan_stack.services.outflow_import.candidates import load_payments_by_amount, load_vendor_index
from nirmaan_stack.services.outflow_import.ledgers import PAYMENT_DOCTYPE, settleable_statuses
from nirmaan_stack.services.outflow_import.matcher import TIER_ACCOUNT, TargetRef, match_row
from nirmaan_stack.services.outflow_import.normalize import normalize_account

AMOUNT = Decimal("48213.37")
APPROVED = settleable_statuses(PAYMENT_DOCTYPE)[0]


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


class TestTierOneReadsThePayToAccount(unittest.TestCase):
    def setUp(self):
        self.payees = PayeeFixture.attach(self)

    def _line_paid_to(self, payee: str) -> _Line:
        account, ifsc = frappe.db.get_value("Payee", payee, ["account_number", "ifsc"])
        return _Line(account, ifsc)

    def _plant_payment(self, vendor: str, pay_to: str | None = None) -> str:
        """An Approved payment of `vendor`, raw-inserted so no save hook fills its copy; it carries
        Payee `pay_to`'s account as its own copy, or none."""
        name = f"TEST-1440-{frappe.generate_hash(length=8)}"
        account, ifsc = (
            frappe.db.get_value("Payee", pay_to, ["account_number", "ifsc"]) if pay_to else (None, None)
        )
        frappe.db.sql(
            """INSERT INTO "tabProject Payments"
                   (name, creation, modified, modified_by, owner, docstatus, idx,
                    vendor, amount, status, pay_to_account_number, pay_to_ifsc)
               VALUES (%s, NOW(), NOW(), 'Administrator', 'Administrator', 0, 0, %s, %s, %s, %s, %s)""",
            (name, vendor, float(AMOUNT), APPROVED, account, ifsc),
        )
        frappe.db.commit()
        self.addCleanup(delete_each, [(PAYMENT_DOCTYPE, name)], raw={PAYMENT_DOCTYPE})
        return name

    def _match(self, line: _Line, planted: str):
        """The match run's tier ladder over the real pool, narrowed to the planted payment."""
        pool = tuple(t for t in load_payments_by_amount([AMOUNT]) if t.name == planted)
        return match_row(line, load_vendor_index(), pool)

    def test_a_line_paid_to_a_shared_payee_matches_a_payment_of_either_vendor_at_tier_1(self):
        shared = self.payees.payee()
        north, south = self.payees.vendor(shared), self.payees.vendor(shared)
        line = self._line_paid_to(shared)
        index = load_vendor_index()

        for vendor in (north, south):
            with self.subTest(vendor=vendor):
                result = match_row(line, index, (_payment(vendor),))
                self.assertEqual(result.tier, TIER_ACCOUNT)
                self.assertEqual([g.targets[0].vendor for g in result.payment_groups], [vendor])

    def test_a_line_paid_to_a_vendors_previous_account_matches_the_payment_raised_to_it(self):
        previous, current = self.payees.payee(), self.payees.payee()
        vendor = self.payees.vendor(current)
        planted = self._plant_payment(vendor, pay_to=previous)

        result = self._match(self._line_paid_to(previous), planted)

        self.assertEqual(result.tier, TIER_ACCOUNT)
        self.assertEqual([g.targets[0].name for g in result.payment_groups], [planted])

    def test_a_payment_with_no_copy_matches_through_its_vendors_current_payee(self):
        current = self.payees.payee()
        vendor = self.payees.vendor(current)
        planted = self._plant_payment(vendor)

        result = self._match(self._line_paid_to(current), planted)

        self.assertEqual(result.tier, TIER_ACCOUNT)
        self.assertEqual([g.targets[0].name for g in result.payment_groups], [planted])

    def test_a_payment_raised_to_the_previous_account_does_not_match_a_line_to_the_current_one(self):
        previous, current = self.payees.payee(), self.payees.payee()
        vendor = self.payees.vendor(current)
        planted = self._plant_payment(vendor, pay_to=previous)

        result = self._match(self._line_paid_to(current), planted)

        self.assertNotEqual(result.tier, TIER_ACCOUNT)
        self.assertEqual(result.payment_groups, ())
