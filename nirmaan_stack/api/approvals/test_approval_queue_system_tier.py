# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Approve Payments: an Expense an import created reads the SYSTEM tier, at any amount (#1710, spec #1711).

DB tests: `DEVENV test --module nirmaan_stack.api.approvals.test_approval_queue_system_tier`. Paid Expenses are planted
raw -- the queue reads only their columns, and an imported Expense is born Paid with nothing to recompute -- then read
through `get_approval_queue` as the Paid tab reads it. The import marker alone decides: a Cashbook spend
(`cashbook_batch`) and a card spend (`credit_card_statement`), on either ledger, read SYSTEM above ₹50,000 and below zero; an Expense a
person raised keeps its amount's tier.
"""

import unittest

import frappe

from nirmaan_stack.api.approvals.get_approval_queue import get_approval_queue

PE = "Project Expenses"
NPE = "Non Project Expenses"


class TestTheSystemTier(unittest.TestCase):
    def setUp(self):
        frappe.set_user("Administrator")
        self.planted = []

    def tearDown(self):
        for doctype, name in self.planted:
            frappe.db.delete(doctype, {"name": name})
        frappe.db.commit()

    def _plant(self, doctype, amount, **marker):
        name = f"EXP-TEST-TIER-{frappe.generate_hash(length=8)}"
        columns = ["name", "creation", "modified", "modified_by", "owner", "docstatus", "idx", "amount", "status",
                   *marker]
        frappe.db.sql(
            f"""INSERT INTO "tab{doctype}" ({", ".join(f'"{c}"' for c in columns)})
                VALUES (%s, NOW(), NOW(), 'Administrator', 'Administrator', 0, 0, %s, 'Paid'
                        {"".join(", %s" for _ in marker)})""",
            (name, amount, *marker.values()),
        )
        frappe.db.commit()
        self.planted.append((doctype, name))
        return name

    def _tier(self, name):
        rows = get_approval_queue(filters=[["name", "=", name], ["status", "=", "Paid"]], limit_page_length=5)["data"]
        self.assertEqual([r["name"] for r in rows], [name])
        return rows[0]["tier"]

    def test_a_cashbook_spend_reads_system_at_any_amount(self):
        for doctype in (PE, NPE):
            for amount in (17_446, 75_000, -11_248):
                with self.subTest(doctype=doctype, amount=amount):
                    name = self._plant(doctype, amount, cashbook_batch="OFI-TEST-CASHBOOK")
                    self.assertEqual(self._tier(name), "system")

    def test_a_card_spend_reads_system_at_any_amount_on_either_ledger(self):
        # A card spend moved to a Won project keeps its statement link (#1761, ADR-0039 Amendment F).
        for doctype in (PE, NPE):
            for amount in (17_446, 75_000, -11_248):
                with self.subTest(doctype=doctype, amount=amount):
                    name = self._plant(doctype, amount, credit_card_statement="CCS-TEST-CARD")
                    self.assertEqual(self._tier(name), "system")

    def test_an_expense_a_person_raised_keeps_its_amounts_tier(self):
        for doctype in (PE, NPE):
            for amount, tier in ((9_000, "auto"), (17_446, "l1"), (75_000, "l1_l2"), (-11_248, "l1")):
                with self.subTest(doctype=doctype, amount=amount):
                    self.assertEqual(self._tier(self._plant(doctype, amount)), tier)
