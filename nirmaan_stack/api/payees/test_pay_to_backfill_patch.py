# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Backfilling the pay-to account on records raised before it existed (#1441, spec #1420, ADR-0033).

Drives the patch `patches/v3_0/backfill_pay_to_accounts` on fixture records, scoped to them so it never
touches a real one, and reads back each record's pay-to account and the patch log.

⚠️ RUNS AGAINST THE ENV DATABASE (each test commits). Every record, bank line and match is inserted raw
with a TESTPYE name and deleted after the test; every Payee and vendor is purged by `PayeeFixture`.
"""

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.payees.payee_fixture import TEST_IFSC, PayeeFixture, delete_each
from nirmaan_stack.patches.v3_0.backfill_pay_to_accounts import backfill_pay_to_accounts, summary
from nirmaan_stack.services.payees.pay_to import PAY_TO_FIELDS

U = "Administrator"
BLANK = (None,) * len(PAY_TO_FIELDS)


class TestBackfillPayToAccounts(FrappeTestCase):
    def setUp(self):
        frappe.set_user(U)
        self.payees = PayeeFixture.attach(self)
        self.rows: list[tuple[str, str]] = []
        self.records: list[str] = []
        self.addCleanup(lambda: delete_each(self.rows, raw={doctype for doctype, _ in self.rows}))

    # -- fixtures ---------------------------------------------------------------------------------

    def _insert(self, doctype: str, prefix: str, **values) -> str:
        name = f"TESTPYE-{prefix}-{frappe.generate_hash(length=8)}"
        columns = "".join(f", {column}" for column in values)
        marks = "".join(", %s" for _ in values)
        frappe.db.sql(
            f"""INSERT INTO "tab{doctype}" (name, creation, modified, modified_by, owner, docstatus, idx{columns})
                VALUES (%s, NOW(), NOW(), %s, %s, 0, 0{marks})""",
            (name, U, U, *values.values()),
        )
        frappe.db.commit()
        self.rows.append((doctype, name))
        return name

    def _record(self, doctype: str, status: str, vendor: str | None = None, **values) -> str:
        if vendor:
            values["vendor"] = vendor
        name = self._insert(doctype, "REC", status=status, amount=100, **values)
        self.records.append(name)
        return name

    def _vendor_with_payee(self, holder: str = "TESTPYE Vendor Holder") -> tuple[str, str]:
        number = self.payees.account_number()
        payee = self.payees.payee(holder=holder, account_number=number)
        return self.payees.vendor(payee), number

    def _bank_line(self, doctype: str, record: str, added_on: str, account: str | None, ifsc: str | None,
                   beneficiary: str | None, match_kind: str = "Settled") -> str:
        row = self._insert(
            "Outflow Import Row", "ROW", transfer_id=frappe.generate_hash(length=12), added_on=added_on,
            amount=100, bank_account=account, ifsc=ifsc, beneficiary_name=beneficiary, row_status="Settled",
        )
        return self._insert(
            "Outflow Row Match", "MAT", import_row=row, transfer_id=frappe.generate_hash(length=12),
            target_doctype=doctype, target_name=record, target_amount=100, match_kind=match_kind,
        )

    def _run(self) -> dict:
        result = backfill_pay_to_accounts(records=self.records)
        frappe.db.commit()
        return result

    @staticmethod
    def _pay_to(doctype: str, name: str) -> tuple:
        return tuple(frappe.db.get_value(doctype, name, list(PAY_TO_FIELDS)))

    # -- 1. unpaid records copy their vendor's Payee ------------------------------------------------

    def test_unpaid_payments_and_vendor_linked_expenses_and_open_requests_get_the_vendors_payee(self):
        vendor, number = self._vendor_with_payee()
        payment = self._record("Project Payments", "Approved", vendor)
        expense = self._record("Project Expenses", "Requested", vendor)
        request = self._record("Expense Request", "Pending Approval", vendor)

        self._run()

        expected = ("TESTPYE Vendor Holder", number, TEST_IFSC, "Test Bank", "Test Branch")
        self.assertEqual(self._pay_to("Project Payments", payment), expected)
        self.assertEqual(self._pay_to("Project Expenses", expense), expected)
        self.assertEqual(self._pay_to("Expense Request", request), expected)

    # -- 2. paid records take the bank line they were settled by -----------------------------------

    def test_a_paid_payment_takes_its_settled_lines_account_and_with_two_lines_the_latest(self):
        vendor, _ = self._vendor_with_payee()
        payment = self._record("Project Payments", "Paid", vendor)
        self._bank_line("Project Payments", payment, "2026-03-01 10:00:00", "5020 0011-1111", "hdfc0000001", "Old Name")
        self._bank_line("Project Payments", payment, "2026-04-01 10:00:00", "0050200022222", "ICIC0000002", "Kaveri Ductfab")
        self._bank_line("Project Payments", payment, "2026-05-01 10:00:00", "77777777", "SBIN0000003", "Reversed",
                        match_kind="Reversed")

        self._run()

        self.assertEqual(
            self._pay_to("Project Payments", payment),
            ("Kaveri Ductfab", "0050200022222", "ICIC0000002", None, None),
        )

    def test_paid_expenses_take_their_settled_lines_account_and_the_ifsc_lookup_is_never_asked(self):
        expense = self._record("Project Expenses", "Reconciliation Pending")
        non_project = self._record("Non Project Expenses", "Paid")
        self._bank_line("Project Expenses", expense, "2026-04-01 10:00:00", "123456789", "hdfc0000001", "  Ravi   Kumar ")
        self._bank_line("Non Project Expenses", non_project, "2026-04-02 10:00:00", "987654321", "SBIN0000009", "Landlord")

        self._run()

        self.assertEqual(self._pay_to("Project Expenses", expense), ("Ravi Kumar", "123456789", "HDFC0000001", None, None))
        self.assertEqual(self._pay_to("Non Project Expenses", non_project), ("Landlord", "987654321", "SBIN0000009", None, None))
        self.payees.lookup_mock.assert_not_called()

    # -- 3. everything else stays blank -------------------------------------------------------------

    def test_records_with_nothing_to_copy_stay_blank(self):
        vendor, _ = self._vendor_with_payee()
        bare_vendor = self.payees.vendor(None)
        paid_unmatched = self._record("Project Payments", "Paid", vendor)
        paid_no_account = self._record("Project Expenses", "Paid", vendor)
        self._bank_line("Project Expenses", paid_no_account, "2026-04-01 10:00:00", "  ", "HDFC0000001", "No Account")
        paid_reversed_only = self._record("Non Project Expenses", "Paid")
        self._bank_line("Non Project Expenses", paid_reversed_only, "2026-04-01 10:00:00", "123456789", "HDFC0000001",
                        "Undone", match_kind="Reversed")
        unpaid_bare_vendor = self._record("Project Payments", "Approved", bare_vendor)
        unpaid_no_vendor = self._record("Non Project Expenses", "Approved")
        decided_request = self._record("Expense Request", "Approved", vendor)

        self._run()

        for doctype, name in (
            ("Project Payments", paid_unmatched), ("Project Expenses", paid_no_account),
            ("Non Project Expenses", paid_reversed_only), ("Project Payments", unpaid_bare_vendor),
            ("Non Project Expenses", unpaid_no_vendor), ("Expense Request", decided_request),
        ):
            self.assertEqual(self._pay_to(doctype, name), BLANK, f"{doctype} {name}")

    def test_a_record_that_already_has_an_account_is_left_as_it_is(self):
        vendor, _ = self._vendor_with_payee()
        own = {"pay_to_account_name": "TESTPYE Own", "pay_to_account_number": "111222333", "pay_to_ifsc": "UTIB0000001"}
        unpaid = self._record("Project Payments", "Approved", vendor, **own)
        paid = self._record("Project Payments", "Paid", vendor, **own)
        self._bank_line("Project Payments", paid, "2026-04-01 10:00:00", "444555666", "HDFC0000001", "Line Name")

        self._run()

        mine = ("TESTPYE Own", "111222333", "UTIB0000001", None, None)
        self.assertEqual(self._pay_to("Project Payments", unpaid), mine)
        self.assertEqual(self._pay_to("Project Payments", paid), mine)

    # -- 4. re-running changes nothing; the log -----------------------------------------------------

    def test_running_it_twice_changes_nothing_the_second_time(self):
        vendor, _ = self._vendor_with_payee()
        payment = self._record("Project Payments", "Approved", vendor)
        paid = self._record("Project Expenses", "Paid", vendor)
        self._bank_line("Project Expenses", paid, "2026-04-01 10:00:00", "123456789", "HDFC0000001", "Line Name")
        blank = self._record("Non Project Expenses", "Paid")
        state = lambda: [  # noqa: E731
            frappe.db.get_value(doctype, name, [*PAY_TO_FIELDS, "modified"])
            for doctype, name in (("Project Payments", payment), ("Project Expenses", paid), ("Non Project Expenses", blank))
        ]
        first = self._run()
        before = state()

        second = self._run()

        self.assertEqual(state(), before)
        self.assertEqual(sum(first["from_vendor"].values()) + sum(first["from_bank_line"].values()), 2)
        self.assertEqual(sum(second["from_vendor"].values()) + sum(second["from_bank_line"].values()), 0)

    def test_the_log_counts_each_source_and_what_stayed_blank(self):
        vendor, _ = self._vendor_with_payee()
        self._record("Project Payments", "Approved", vendor)
        self._record("Project Payments", "Approved", vendor)
        paid = self._record("Non Project Expenses", "Paid")
        self._bank_line("Non Project Expenses", paid, "2026-04-01 10:00:00", "123456789", "HDFC0000001", "Line Name")
        self._record("Project Expenses", "Paid")

        result = self._run()

        self.assertEqual(result["from_vendor"]["Project Payments"], 2)
        self.assertEqual(result["from_bank_line"]["Non Project Expenses"], 1)
        self.assertEqual(result["blank"]["Project Expenses"], 1)
        log = "\n".join(summary(result))
        self.assertIn("Project Payments: 2 from the vendor's Payee, 0 from a bank line, 0 left blank", log)
        self.assertIn("Project Expenses: 0 from the vendor's Payee, 0 from a bank line, 1 left blank", log)
