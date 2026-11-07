# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and Contributors
# See license.txt

"""The Expense Bill record's own rules (spec #1637 review, ADR-0045): every write comes through
`services/expense_bills` with `ignore_permissions`, so Desk lets nobody but System Manager write or delete one, and
the fields the system alone writes are read-only there.

DB tests: `DEVENV test --module nirmaan_stack.nirmaan_stack.doctype.expense_bill.test_expense_bill`.
"""

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.services.expense_bills import BILL_DOCTYPE

#: The fields only the Bill check, the reading job and the approval service write.
SYSTEM_FIELDS = (
    "status", "approved_by", "approved_on", "auto_approved", "rejection_reason", "rejected_by", "rejected_on",
    "bill_check", "bill_check_reason", "read_claimed_at", "read_total", "read_invoice_no", "read_invoice_date",
    "reader_output",
)


class TestOnlyTheServicesWriteAnExpenseBill(FrappeTestCase):
    def test_only_system_manager_holds_the_delete_right(self):
        self.assertEqual(
            [perm.role for perm in frappe.get_meta(BILL_DOCTYPE).permissions if perm.delete], ["System Manager"]
        )

    def test_no_nirmaan_role_holds_the_write_right(self):
        writers = [perm.role for perm in frappe.get_meta(BILL_DOCTYPE).permissions if perm.write or perm.create]
        self.assertEqual(writers, ["System Manager"])

    def test_the_accountant_profiles_still_read_it(self):
        readers = {perm.role for perm in frappe.get_meta(BILL_DOCTYPE).permissions if perm.read}
        self.assertEqual(readers, {"System Manager", "Nirmaan Accountant", "Nirmaan Accountant Lead"})

    def test_every_field_the_system_alone_writes_is_read_only_in_desk(self):
        meta = frappe.get_meta(BILL_DOCTYPE)
        not_read_only = [field for field in SYSTEM_FIELDS if not meta.get_field(field) or not meta.get_field(field).read_only]
        self.assertEqual(not_read_only, [])

    def test_the_bill_file_is_a_plain_url_so_frappe_mints_no_file_row_for_it(self):
        # An Attach field makes Frappe attach a second File row to the Expense's stored object on insert, and
        # deleting either row deletes the object under the other (review of spec #1637).
        self.assertEqual(frappe.get_meta(BILL_DOCTYPE).get_field("bill_file").fieldtype, "Data")
