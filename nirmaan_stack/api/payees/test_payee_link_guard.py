# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and Contributors
# See license.txt

"""What every save of a record with a pay-to account does, on every write path (#1423, #1436, spec
#1420, ADR-0033).

Saves `Expense Request`, `Project Expenses`, `Non Project Expenses` and `Vendors` through the
document layer, the way Desk, REST and any other code would, with no Payee endpoint in between, and
reads back what the `validate` controller (`integrations/controllers/payee_links`) did:

* a request or Project Expense naming a vendor copies the vendor's Payee into its pay-to account on
  insert (when it has none), whenever the vendor changes, and on any save while it has none; never once
  it is paid;
* the server refuses no pay-to account (Required, a vendor disagreeing, a change after payment, a
  non-Accounts change): those are screen rules (#1436);
* only the people who may set a vendor's Payee (`VENDOR_PAYEE_PROFILES`) change `Vendors.payee`.

⚠️ RUNS AGAINST THE ENV DATABASE. Payees and vendors come from `PayeeFixture`; every other row planted
here is deleted by the test's own clean-up.

Run:
  devenv.sh test --module nirmaan_stack.api.payees.test_payee_link_guard
"""

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.expense_requests.test_expense_requests import _make_user
from nirmaan_stack.api.payees.payee_fixture import PayeeFixture, delete_each
from nirmaan_stack.services.payees.guard import check_payee_links
from nirmaan_stack.services.payees.pay_to import ACCOUNT_FIELDS, PAY_TO_FIELDS

U = "Administrator"
PM_USER = "pye_guard_pm@example.com"
PM_PROFILE = "Nirmaan Project Manager Profile"
REQUEST = "Expense Request"
PE = "Project Expenses"
NPE = "Non Project Expenses"


class TestEveryWritePathKeepsThePayeeRules(FrappeTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        _make_user(PM_USER, PM_PROFILE, ("Nirmaan Project Manager",))
        cls.types = {}
        for rule, project in (("Required", 0), ("Optional", 1), ("Not asked", 1)):
            name = f"pye_guard_{rule.replace(' ', '_').lower()}_{frappe.generate_hash(length=5)}"
            doc = frappe.new_doc("Expense Type")
            doc.update({"expense_name": name, "project": project, "non_project": 1 - project,
                        "expense_category": "Uncategorized", "payee_rule": rule})
            doc.insert(ignore_permissions=True)
            cls.types[rule] = doc.name
        # Raw, like the outflow-import suites: `Projects.after_insert` builds work milestones.
        cls.project = f"TEST-PYEG-{frappe.generate_hash(length=8)}"
        frappe.db.sql(
            """INSERT INTO "tabProjects" (name, creation, modified, modified_by, owner, docstatus, idx,
                                          project_name)
               VALUES (%s, NOW(), NOW(), %s, %s, 0, 0, %s)""",
            (cls.project, U, U, cls.project),
        )
        frappe.db.commit()

    @classmethod
    def tearDownClass(cls):
        frappe.set_user(U)
        scopes = [("Expense Type", name) for name in cls.types.values()]
        scopes += [("Projects", cls.project), ("Nirmaan Users", PM_USER), ("User", PM_USER)]
        try:
            delete_each(scopes, raw={"Projects"})
        finally:
            super().tearDownClass()

    def setUp(self):
        frappe.set_user(U)
        self.payees = PayeeFixture.attach(self)
        self.planted: list[tuple[str, str]] = []
        self.addCleanup(self._purge)

    def tearDown(self):
        frappe.set_user(U)

    # -- helpers --------------------------------------------------------------------------------
    def _purge(self):
        delete_each(reversed(self.planted), raw={doctype for doctype, _ in self.planted})

    def _insert(self, values: dict) -> str:
        """Insert through the document layer (every `validate` runs); removed after the test."""
        doc = frappe.get_doc(values)
        doc.insert(ignore_permissions=True)
        self.planted.append((doc.doctype, doc.name))
        frappe.db.commit()
        return doc.name

    def _raw(self, doctype: str, values: dict) -> str:
        """A row from before these rules: inserted raw, no hook ran."""
        name = f"TEST-PYEG-{frappe.generate_hash(length=10)}"
        columns = ", ".join(f'"{c}"' for c in values)
        marks = ", ".join(["%s"] * len(values))
        frappe.db.sql(
            f"""INSERT INTO "tab{doctype}" (name, creation, modified, modified_by, owner, docstatus, idx,
                    {columns})
                VALUES (%s, NOW(), NOW(), %s, %s, 0, 0, {marks})""",
            (name, U, U, *values.values()),
        )
        self.planted.append((doctype, name))
        frappe.db.commit()
        return name

    def _request(self, rule, **values) -> dict:
        project = rule != "Required"  # the Required type here is a non-project one
        return {"doctype": REQUEST, "type": self.types[rule], "amount": 4300, "status": "Pending Approval",
                "source_data": '{"responses": {"detail": {"description": "guard test"}}}',
                **({"projects": self.project} if project else {}), **values}

    def _expense(self, doctype=NPE, **values) -> dict:
        return {"doctype": doctype, "type": self.types["Optional"], "amount": 2500, "status": "Approved",
                "description": "guard test", **({"projects": self.project} if doctype == PE else {}), **values}

    def _save_as(self, user, doctype, name, **changes):
        frappe.set_user(user)
        try:
            doc = frappe.get_doc(doctype, name)
            doc.update(changes)
            doc.save(ignore_permissions=True)
        finally:
            frappe.set_user(U)

    def _pay_to(self, doctype, name):
        return tuple(frappe.db.get_value(doctype, name, list(PAY_TO_FIELDS)))

    def _account_of(self, payee):
        return tuple(frappe.db.get_value("Payee", payee, list(ACCOUNT_FIELDS)))

    def _vendor_pair(self):
        first, second = self.payees.payee(), self.payees.payee()
        return first, self.payees.vendor(first), second, self.payees.vendor(second)

    # -- a vendor's Payee is copied on every write path ------------------------------------------
    def test_a_request_naming_a_vendor_copies_its_account(self):
        payee = self.payees.payee()
        name = self._insert(self._request("Optional", vendor=self.payees.vendor(payee)))
        self.assertEqual(self._pay_to(REQUEST, name), self._account_of(payee))

    def test_no_request_or_expense_links_a_payee(self):
        """The record holds a copy, never a link (#1438): editing or deleting the Payee can't reach it."""
        for doctype in (REQUEST, PE, NPE):
            with self.subTest(doctype=doctype):
                self.assertFalse(frappe.get_meta(doctype).has_field("payee"))

    def test_a_not_asked_request_naming_a_vendor_copies_its_account(self):
        payee = self.payees.payee()
        name = self._insert(self._request("Not asked", vendor=self.payees.vendor(payee)))
        self.assertEqual(self._pay_to(REQUEST, name), self._account_of(payee))

    def test_a_project_expense_inserted_naming_a_vendor_copies_its_account(self):
        """New expense dialogs, Bulk Import's create-expense and adjustments insert one this way."""
        payee = self.payees.payee()
        name = self._insert(self._expense(PE, vendor=self.payees.vendor(payee)))
        self.assertEqual(self._pay_to(PE, name), self._account_of(payee))

    def test_an_expense_inserted_with_its_own_account_keeps_it(self):
        """Approval inserts the request's copy: the vendor's Payee is not read again."""
        first, v1, second, _ = self._vendor_pair()
        own = dict(zip(PAY_TO_FIELDS, self._account_of(second)))
        name = self._insert(self._expense(PE, vendor=v1, **own))
        self.assertEqual(self._pay_to(PE, name), self._account_of(second))

    def test_an_unpaid_record_re_copies_when_its_vendor_changes(self):
        first, v1, second, v2 = self._vendor_pair()
        for doctype, values in ((REQUEST, self._request("Optional", vendor=v1)),
                                (PE, self._expense(PE, vendor=v1))):
            with self.subTest(doctype=doctype):
                name = self._insert(values)
                self._save_as(PM_USER, doctype, name, vendor=v2)
                self.assertEqual(self._pay_to(doctype, name), self._account_of(second))

    def test_a_vendor_with_no_payee_leaves_the_account_blank(self):
        first, v1, _, _ = self._vendor_pair()
        name = self._insert(self._expense(PE, vendor=v1))
        self._save_as(PM_USER, PE, name, vendor=self.payees.vendor())
        self.assertEqual(self._pay_to(PE, name), (None,) * 5)

    def test_an_unpaid_record_naming_a_vendor_with_a_blank_account_fills_on_save(self):
        """A record from before pay-to accounts takes its vendor's on its next save."""
        payee = self.payees.payee()
        name = self._raw(PE, {"type": self.types["Optional"], "amount": 2500, "status": "Approved",
                              "projects": self.project, "vendor": self.payees.vendor(payee)})
        self._save_as(PM_USER, PE, name, comment="re-saved")
        self.assertEqual(self._pay_to(PE, name), self._account_of(payee))

    def test_a_paid_expenses_vendor_is_corrected_and_its_account_stays(self):
        """The money already went to that account: correcting the vendor afterwards moves nothing."""
        first, v1, _, v2 = self._vendor_pair()
        for status in ("Reconciliation Pending", "Paid"):
            with self.subTest(status=status):
                own = dict(zip(PAY_TO_FIELDS, self._account_of(first)))
                name = self._raw(PE, {"type": self.types["Optional"], "amount": 2500, "status": status,
                                      "projects": self.project, "vendor": v1, **own})
                self._save_as(PM_USER, PE, name, vendor=v2)
                self.assertEqual(frappe.db.get_value(PE, name, "vendor"), v2)
                self.assertEqual(self._pay_to(PE, name), self._account_of(first))

    # -- no server refusals (screen rules, #1436) ------------------------------------------------
    def test_a_required_request_is_saved_without_an_account(self):
        name = self._insert(self._request("Required"))
        self.assertEqual(self._pay_to(REQUEST, name), (None,) * 5)

    def test_anyone_who_may_save_an_expense_changes_its_account_paid_or_not(self):
        """Accounts-only and fixed-once-paid are screen rules now: the server refuses neither."""
        account = dict(zip(PAY_TO_FIELDS, self._account_of(self.payees.payee())))
        for status in ("Approved", "Paid"):
            with self.subTest(status=status):
                name = self._raw(NPE, {"type": self.types["Optional"], "amount": 2500, "status": status})
                self._save_as(PM_USER, NPE, name, **account)
                self.assertEqual(self._pay_to(NPE, name), tuple(account.values()))

    def test_a_record_from_before_still_saves(self):
        old = self._raw(REQUEST, {"type": self.types["Required"], "amount": 4300, "status": "Pending Approval"})
        self._save_as(U, REQUEST, old, comment="re-saved")
        self.assertEqual(frappe.db.get_value(REQUEST, old, "comment"), "re-saved")

    # -- a vendor's Payee, set on the vendor -----------------------------------------------------
    def test_only_vendor_payee_profiles_change_a_vendors_payee_on_save(self):
        first, second = self.payees.payee(), self.payees.payee()
        vendor = self.payees.vendor(first)
        # The vendor's own hooks read its categories; a vendor the app makes always has the list.
        frappe.db.set_value("Vendors", vendor, "vendor_category", '{"categories": []}', update_modified=False)
        frappe.db.commit()
        with self.assertRaisesRegex(frappe.PermissionError, "set a vendor's bank account"):
            self._save_as(PM_USER, "Vendors", vendor, payee=second)
        frappe.db.rollback()
        self.assertEqual(frappe.db.get_value("Vendors", vendor, "payee"), first)

        self._save_as(U, "Vendors", vendor, payee=second)
        self.assertEqual(frappe.db.get_value("Vendors", vendor, "payee"), second)

    def test_a_vendor_is_made_without_a_payee_by_anyone_who_may_make_one(self):
        """Who may set a vendor's Payee is asked only when a Payee is set: a vendor made with none, by
        someone outside `VENDOR_PAYEE_PROFILES`, needs no such role."""
        vendor = frappe.new_doc("Vendors")
        vendor.vendor_name = "TESTPYE guard vendor"
        check_payee_links(vendor, PM_USER)

        vendor.payee = self.payees.payee()
        with self.assertRaisesRegex(frappe.PermissionError, "set a vendor's bank account"):
            check_payee_links(vendor, PM_USER)
