# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Moving today's vendor bank details into Payees (#1424, spec #1420, ADR-0033).

Drives the patch `patches/v3_0/move_vendor_bank_details_to_payees` on fixture vendors, scoped to them
so it never touches a real vendor, and reads back what the owner sees: each vendor's Payee, the
Payee's details, the expenses left as they were, and the patch log.

⚠️ RUNS AGAINST THE ENV DATABASE (each test commits). Every vendor and expense is inserted raw with a
TESTPYE name and deleted after the test; every Payee is purged by `PayeeFixture`.

#1432 deleted the five bank fields from the `Vendors` doctype. Frappe's migrate never drops a column,
so a site that had them still has them, and that is what the patch reads (`_vendors_without_payee`).
A site installed after the deletion has no such columns. So the grouping, linking and logging run on
every site with the patch's reader swapped for one that serves the planted bank details beside the
real vendor rows (`TestMoveVendorBankDetailsToPayees`); only the reader itself needs the old columns
(`TestThePatchReadsTheOldColumns`, skipped where they are gone).
"""

import unittest
from unittest import mock

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.payees.payee_fixture import TEST_IFSC, PayeeFixture, delete_each
from nirmaan_stack.patches.v3_0 import move_vendor_bank_details_to_payees as patch
from nirmaan_stack.patches.v3_0.move_vendor_bank_details_to_payees import (
    OLD_BANK_COLUMNS,
    move_vendor_bank_details,
    summary,
)
from nirmaan_stack.services.payees.rules import PAYEE_DOCTYPE

U = "Administrator"


class _PatchFixture(FrappeTestCase):
    def setUp(self):
        frappe.set_user(U)
        self.payees = PayeeFixture.attach(self)
        self.vendors: list[str] = []
        self.expenses: list[tuple[str, str]] = []
        #: The bank details each planted vendor has on record, as the old columns held them.
        self.bank: dict[str, dict] = {}
        self.addCleanup(self._delete_rows)

    def _delete_rows(self):
        scopes = self.expenses + [("Vendors", name) for name in self.vendors]
        delete_each(scopes, raw={doctype for doctype, _ in scopes})

    def _vendor(self, vendor_name, account_number=None, ifsc=TEST_IFSC, account_name=None,
                bank_name="Fixture Bank", bank_branch="Fixture Branch") -> str:
        name = f"TESTPYE-VEN-{frappe.generate_hash(length=8)}"
        bank = dict(zip(OLD_BANK_COLUMNS, (account_name, account_number, ifsc, bank_name, bank_branch)))
        # Into the old columns too where the site still has them (the reader test reads those).
        old = [f for f in OLD_BANK_COLUMNS if frappe.db.has_column("Vendors", f)]
        columns = "".join(f", {f}" for f in old)
        marks = "".join(", %s" for _ in old)
        frappe.db.sql(
            f"""INSERT INTO "tabVendors" (name, creation, modified, modified_by, owner, docstatus, idx,
                                          vendor_name{columns})
                VALUES (%s, NOW(), NOW(), %s, %s, 0, 0, %s{marks})""",
            (name, U, U, vendor_name, *(bank[f] for f in old)),
        )
        frappe.db.commit()
        self.vendors.append(name)
        self.bank[name] = bank
        return name

    def _expense(self, doctype, vendor) -> str:
        name = f"TESTPYE-EXP-{frappe.generate_hash(length=8)}"
        frappe.db.sql(
            f"""INSERT INTO "tab{doctype}" (name, creation, modified, modified_by, owner, docstatus, idx,
                                            vendor, amount, status)
                VALUES (%s, NOW(), NOW(), %s, %s, 0, 0, %s, %s, %s)""",
            (name, U, U, vendor, 100, "Approved"),
        )
        frappe.db.commit()
        self.expenses.append((doctype, name))
        return name

    def _run(self) -> dict:
        result = move_vendor_bank_details(vendors=self.vendors)
        frappe.db.commit()
        return result

    @staticmethod
    def _payee_of(vendor) -> str | None:
        return frappe.db.get_value("Vendors", vendor, "payee")


class TestMoveVendorBankDetailsToPayees(_PatchFixture):
    """The patch's grouping, linking and log on every site: its reader of the old columns is swapped
    for one that serves the planted bank details beside the real vendor rows (still only vendors with
    no Payee, in the patch's order), so the columns' absence after #1432 cannot skip it."""

    def setUp(self):
        super().setUp()
        reader = mock.patch.object(patch, "_vendors_without_payee", self._planted_vendors_without_payee)
        reader.start()
        self.addCleanup(reader.stop)

    def _planted_vendors_without_payee(self, vendors):
        rows = frappe.db.sql(
            """SELECT name, vendor_name FROM "tabVendors"
               WHERE COALESCE(payee, '') = '' AND name IN %(vendors)s
               ORDER BY creation, name""",
            {"vendors": tuple(vendors or ())},
            as_dict=True,
        )
        return [frappe._dict({**row, **self.bank[row.name]}) for row in rows]

    def test_vendors_sharing_an_account_and_ifsc_share_one_payee_with_the_longest_holder_name(self):
        number = self.payees.account_number()
        north = self._vendor("Kaveri North", f"00{number}", "test0pye001 ", account_name="TESTPYE Kaveri")
        south = self._vendor("Kaveri South", number[:4] + " " + number[4:], account_name="TESTPYE Kaveri Ductfab Pvt Ltd")
        alone = self._vendor("Other", self.payees.account_number(), account_name="TESTPYE Other")

        self._run()

        shared = self._payee_of(north)
        self.assertTrue(shared)
        self.assertEqual(self._payee_of(south), shared)
        self.assertNotIn(self._payee_of(alone), (None, shared))
        doc = frappe.get_doc(PAYEE_DOCTYPE, shared)
        self.assertEqual(
            (doc.account_name, doc.account_number, doc.ifsc, doc.bank_name, doc.bank_branch),
            ("TESTPYE Kaveri Ductfab Pvt Ltd", f"00{number}", TEST_IFSC, "Fixture Bank", "Fixture Branch"),
        )

    def test_a_vendor_with_no_account_number_gets_no_payee(self):
        blank = self._vendor("No account", None, account_name="TESTPYE Nobody")
        spaces = self._vendor("Spaces only", "   ", account_name="TESTPYE Nobody")

        self._run()

        self.assertIsNone(self._payee_of(blank))
        self.assertIsNone(self._payee_of(spaces))

    def test_vendor_linked_expenses_are_left_as_they_are(self):
        """An expense holds its own pay-to account, filled by the backfill patch, never a link to the
        vendor's Payee (#1438): this patch moves vendors only."""
        vendor = self._vendor("Paid vendor", self.payees.account_number(), account_name="TESTPYE Paid")
        request = self._expense("Expense Request", vendor)
        expense = self._expense("Project Expenses", vendor)
        fields = ["modified", "pay_to_account_number"]
        rows = (("Expense Request", request), ("Project Expenses", expense))
        before = [frappe.db.get_value(d, n, fields) for d, n in rows]

        result = self._run()

        self.assertTrue(self._payee_of(vendor))
        self.assertNotIn("linked_expenses", result)
        self.assertEqual([frappe.db.get_value(d, n, fields) for d, n in rows], before)

    def test_an_account_that_is_already_a_payee_is_linked_to_it_not_copied(self):
        number = self.payees.account_number()
        existing = self.payees.payee(holder="TESTPYE Already there", account_number=number)
        vendor = self._vendor("Late vendor", f"0{number}", account_name="TESTPYE A much longer holder name")

        self._run()

        self.assertEqual(self._payee_of(vendor), existing)
        self.assertEqual(frappe.db.get_value(PAYEE_DOCTYPE, existing, "account_name"), "TESTPYE Already there")

    def test_a_group_with_no_holder_name_takes_the_vendor_name_and_the_log_says_so(self):
        vendor = self._vendor("TESTPYE Nameless Traders", self.payees.account_number(), account_name="  ")

        result = self._run()

        payee = self._payee_of(vendor)
        self.assertEqual(frappe.db.get_value(PAYEE_DOCTYPE, payee, "account_name"), "TESTPYE Nameless Traders")
        self.assertTrue(any(payee in line and "vendor name" in line for line in summary(result)))

    def test_a_vendor_whose_details_cant_be_a_payee_is_skipped_and_logged(self):
        no_ifsc = self._vendor("No IFSC", self.payees.account_number(), ifsc=None, account_name="TESTPYE No IFSC")
        bad_ifsc = self._vendor("Bad IFSC", self.payees.account_number(), ifsc="NOTANIFSC", account_name="TESTPYE Bad")
        good = self._vendor("Good", self.payees.account_number(), account_name="TESTPYE Good")

        result = self._run()

        self.assertIsNone(self._payee_of(no_ifsc))
        self.assertIsNone(self._payee_of(bad_ifsc))
        self.assertTrue(self._payee_of(good))
        log = "\n".join(summary(result))
        self.assertIn(no_ifsc, log)
        self.assertIn(bad_ifsc, log)

    def test_the_log_lists_each_merged_payee_with_its_vendors(self):
        number = self.payees.account_number()
        first = self._vendor("Branch A", number, account_name="TESTPYE Branch")
        second = self._vendor("Branch B", number, account_name="TESTPYE Branch")
        self._vendor("Single", self.payees.account_number(), account_name="TESTPYE Single")

        result = self._run()

        merged = [line for line in summary(result) if self._payee_of(first) in line]
        self.assertEqual(len(merged), 1)
        self.assertIn(first, merged[0])
        self.assertIn(second, merged[0])
        self.assertEqual(len(result["merged"]), 1)

    def test_running_it_twice_changes_nothing_the_second_time(self):
        number = self.payees.account_number()
        a = self._vendor("Twice A", number, account_name="TESTPYE Twice")
        b = self._vendor("Twice B", f"0{number}", account_name="TESTPYE Twice Longer")
        self._vendor("Twice no IFSC", self.payees.account_number(), ifsc="", account_name="TESTPYE Twice")
        self._run()
        before = (
            frappe.db.count(PAYEE_DOCTYPE),
            self._payee_of(a), self._payee_of(b),
            frappe.db.get_value(PAYEE_DOCTYPE, self._payee_of(a), "modified"),
        )

        second = self._run()

        after = (
            frappe.db.count(PAYEE_DOCTYPE),
            self._payee_of(a), self._payee_of(b),
            frappe.db.get_value(PAYEE_DOCTYPE, self._payee_of(a), "modified"),
        )
        self.assertEqual(after, before)
        self.assertEqual((second["made"], second["linked_vendors"]), ([], 0))


class TestTheSiteWithoutTheOldColumns(unittest.TestCase):
    """A site installed after #1432 never had the vendors' bank columns: the patch has nothing to move
    and must say so, not fail on the missing columns."""

    def test_the_patch_moves_nothing_when_the_old_columns_are_absent(self):
        real = frappe.db.has_column
        absent = mock.patch.object(
            frappe.db, "has_column",
            side_effect=lambda doctype, column: column not in OLD_BANK_COLUMNS and real(doctype, column),
        )
        with absent, mock.patch.object(patch, "move_vendor_bank_details") as move:
            patch.execute()
        move.assert_not_called()


class TestThePatchReadsTheOldColumns(_PatchFixture):
    """The one part that needs `tabVendors`' old bank columns: the patch's own reader. Skipped on a
    site installed after #1432, which has no such columns and never runs the patch."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        if not frappe.db.has_column("Vendors", "account_number"):
            raise unittest.SkipTest("tabVendors has no old bank columns: a site installed after #1432")

    def test_the_patch_reads_each_vendors_details_from_the_old_columns(self):
        number = self.payees.account_number()
        vendor = self._vendor("Column reader", f"00{number}", account_name="TESTPYE Column Reader",
                              bank_name="Column Bank", bank_branch="Column Branch")

        self._run()

        doc = frappe.get_doc(PAYEE_DOCTYPE, self._payee_of(vendor))
        self.assertEqual(
            (doc.account_name, doc.account_number, doc.ifsc, doc.bank_name, doc.bank_branch),
            ("TESTPYE Column Reader", f"00{number}", TEST_IFSC, "Column Bank", "Column Branch"),
        )
