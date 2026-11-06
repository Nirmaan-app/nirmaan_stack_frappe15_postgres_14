# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""A person's own bank account (Raise Reimbursement, the profile's Payee tab) refuses a holder name that is
only numbers or names a bank (`rules.holder_name_problem`, owner 2026-11-04), on add and on edit, through
the service and through the endpoints the screens call.

NOTHING HERE IS COMMITTED. Each test runs with `frappe.db.commit` stubbed (the endpoints commit on success, so
a regression that let a bad name through still writes nothing) and rolls back when it ends. The person is a bare
`Nirmaan Users` row (`db_insert`, no hooks) that the rollback removes; IFSC lookups are answered offline.
"""

from unittest import mock

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.payees.payee_fixture import BANK, HOLDER_PREFIX, TEST_IFSC, PayeeFixture
from nirmaan_stack.api.reimbursements.bank_accounts import add_my_bank_account, edit_my_bank_account
from nirmaan_stack.services.payees.own_accounts import ADDED, add_own_account, edit_own_account, my_account
from nirmaan_stack.services.payees.rules import PAYEE_DOCTYPE, PAYEE_TYPE_USERS

ONLY_NUMBERS = "Account holder name can't be only numbers. Enter the name on the bank account."
BANK_NAME = "Account holder name can't be a bank name. Enter the person or company who owns the account."

REFUSED = [
    ("50200061234567", ONLY_NUMBERS),
    ("  1234 5678-90/ ", ONLY_NUMBERS),
    ("HDFC Bank", BANK_NAME),
    ("state bank of india", BANK_NAME),
    ("Ravi Kumar (SBI)", BANK_NAME),
    ("ICICI", BANK_NAME),
]
ACCEPTED = [f"{HOLDER_PREFIX} Ravi Kumar", f"{HOLDER_PREFIX} Bankim Rao", f"{HOLDER_PREFIX} Ram Kumar 2"]


class _OwnAccountCase(FrappeTestCase):
    def setUp(self):
        commit = mock.patch.object(frappe.db, "commit")
        commit.start()
        lookup = mock.patch("nirmaan_stack.services.payees.ifsc.fetch_ifsc", return_value=dict(BANK))
        lookup.start()
        # LIFO: roll back first, while commit is still stubbed.
        self.addCleanup(commit.stop)
        self.addCleanup(lookup.stop)
        self.addCleanup(frappe.set_user, "Administrator")
        self.addCleanup(frappe.db.rollback)
        frappe.set_user("Administrator")
        self.user = self.person()

    @staticmethod
    def person() -> str:
        """A bare Nirmaan Users row with no bank account; the test's rollback removes it."""
        email = f"testpye-holder-{frappe.generate_hash(length=8)}@example.com"
        doc = frappe.get_doc({"doctype": "Nirmaan Users", "first_name": "Testpye", "full_name": "Testpye", "email": email})
        doc.name = email
        doc.db_insert()
        return email

    def assert_refused(self, fn, message):
        with self.assertRaises(frappe.ValidationError) as caught:
            fn()
        self.assertEqual(str(caught.exception), message)

    def own_payee(self, holder: str) -> str:
        """`self.user`'s own account, made the normal way."""
        payee, outcome = add_own_account(self.user, holder, PayeeFixture.account_number(), TEST_IFSC)
        self.assertEqual(outcome, ADDED)
        return payee


class TestAddOwnAccount(_OwnAccountCase):
    def test_a_bad_holder_name_is_refused_and_nothing_is_saved(self):
        for holder, message in REFUSED:
            with self.subTest(holder=holder):
                number = PayeeFixture.account_number()
                self.assert_refused(lambda: add_own_account(self.user, holder, number, TEST_IFSC), message)
                self.assertIsNone(my_account(self.user))
                self.assertFalse(frappe.db.exists(PAYEE_DOCTYPE, {"account_number": number}))

    def test_a_real_name_is_saved_as_the_persons_users_payee(self):
        for holder in ACCEPTED:
            with self.subTest(holder=holder):
                self.user = self.person()
                payee = self.own_payee(holder)
                self.assertEqual(my_account(self.user).name, payee)
                self.assertEqual(frappe.db.get_value(PAYEE_DOCTYPE, payee, "payee_type"), PAYEE_TYPE_USERS)

    def test_the_raise_reimbursement_endpoint_refuses_a_bad_holder_name(self):
        frappe.set_user(self.user)
        for holder, message in REFUSED:
            with self.subTest(holder=holder):
                self.assert_refused(
                    lambda: add_my_bank_account(holder, PayeeFixture.account_number(), TEST_IFSC), message)
        self.assertIsNone(my_account(self.user))


class TestEditOwnAccount(_OwnAccountCase):
    def setUp(self):
        super().setUp()
        self.number = PayeeFixture.account_number()
        self.holder = f"{HOLDER_PREFIX} Ravi Kumar"
        self.payee, _outcome = add_own_account(self.user, self.holder, self.number, TEST_IFSC)

    def test_renaming_to_a_bad_holder_name_is_refused_and_the_name_is_kept(self):
        for holder, message in REFUSED:
            with self.subTest(holder=holder):
                self.assert_refused(
                    lambda: edit_own_account(self.user, self.payee, holder, self.number, TEST_IFSC), message)
                self.assertEqual(frappe.db.get_value(PAYEE_DOCTYPE, self.payee, "account_name"), self.holder)

    def test_renaming_to_a_real_name_is_saved(self):
        reply = edit_own_account(self.user, self.payee, f"{HOLDER_PREFIX} Ravi K", self.number, TEST_IFSC)
        self.assertNotIn("duplicate", reply)
        self.assertEqual(frappe.db.get_value(PAYEE_DOCTYPE, self.payee, "account_name"), f"{HOLDER_PREFIX} Ravi K")

    def test_the_profile_edit_endpoint_refuses_a_bad_holder_name(self):
        frappe.set_user(self.user)
        for holder, message in REFUSED:
            with self.subTest(holder=holder):
                self.assert_refused(
                    lambda: edit_my_bank_account(self.payee, holder, self.number, TEST_IFSC), message)
        self.assertEqual(frappe.db.get_value(PAYEE_DOCTYPE, self.payee, "account_name"), self.holder)


class TestOldBadOwnAccount(_OwnAccountCase):
    """An own account saved before the rule, with a holder name that is only numbers (20 such Payees were on
    record on 2026-11-04): it stays as it is, and its next edit must fix the name."""

    def setUp(self):
        super().setUp()
        self.number = PayeeFixture.account_number()
        doc = frappe.get_doc({"doctype": PAYEE_DOCTYPE, "account_name": self.number, "account_number": self.number,
                              "ifsc": TEST_IFSC, "normalized_account": self.number, "payee_type": PAYEE_TYPE_USERS})
        doc.set_new_name()
        doc.db_insert()  # Raw: `validate` would refuse the name, as it now does for every new save.
        self.payee = doc.name
        frappe.db.set_value("Nirmaan Users", self.user, "payee", self.payee, update_modified=False)

    def test_an_edit_keeping_the_old_bad_name_is_refused(self):
        self.assert_refused(
            lambda: edit_own_account(self.user, self.payee, self.number, self.number, TEST_IFSC), ONLY_NUMBERS)

    def test_an_edit_that_fixes_the_name_is_saved(self):
        edit_own_account(self.user, self.payee, f"{HOLDER_PREFIX} Fixed Name", self.number, TEST_IFSC)
        self.assertEqual(frappe.db.get_value(PAYEE_DOCTYPE, self.payee, "account_name"), f"{HOLDER_PREFIX} Fixed Name")
