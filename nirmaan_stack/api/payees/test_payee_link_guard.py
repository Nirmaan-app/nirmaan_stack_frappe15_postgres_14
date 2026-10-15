# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and Contributors
# See license.txt

"""No screen or API can skip the Payee rules (spec #1420 review A3, ADR-0033).

Saves `Expense Request`, `Project Expenses`, `Non Project Expenses` and `Vendors` through the
document layer, the way Desk, REST and any other code would, with no Payee endpoint in between, and
reads back what the `validate` controller (`integrations/controllers/payee_links`) let through:

* a record naming a vendor is paid into that vendor's Payee (filled in when blank, any other refused);
* a request of a *Required* type carries a Payee;
* an expense's Payee is fixed once it is paid, and before that only Accounts change it;
* only the people who may set a vendor's Payee (`VENDOR_PAYEE_PROFILES`) change `Vendors.payee`.

Each rule is asked only when the save inserts the record or changes `payee`, `vendor` or the type, so
a record from before still re-saves.

⚠️ RUNS AGAINST THE ENV DATABASE. Payees and vendors come from `PayeeFixture`; every other row planted
here is deleted by the test's own clean-up.

Run:
  devenv.sh test --module nirmaan_stack.api.payees.test_payee_link_guard
"""

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.expense_requests.test_expense_requests import _make_user
from nirmaan_stack.api.payees.payee_fixture import PayeeFixture, delete_each, shown_to_client
from nirmaan_stack.services.payees.expense_rules import (
    EXPENSE_PAYEE_ROLE_PROBLEM,
    VENDOR_PAYEE_INACTIVE_PROBLEM,
)
from nirmaan_stack.services.payees.guard import check_payee_links

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

    # -- a vendor's Payee ------------------------------------------------------------------------
    def test_a_request_naming_a_vendor_cannot_be_saved_with_another_payee(self):
        vendor = self.payees.vendor(self.payees.payee())
        with self.assertRaisesRegex(frappe.ValidationError, "is paid into payee"):
            self._insert(self._request("Optional", vendor=vendor, payee=self.payees.payee()))

    def test_a_request_naming_a_vendor_is_saved_with_the_vendors_payee(self):
        payee = self.payees.payee()
        name = self._insert(self._request("Optional", vendor=self.payees.vendor(payee)))
        self.assertEqual(frappe.db.get_value(REQUEST, name, "payee"), payee)

    def test_a_not_asked_request_naming_a_vendor_carries_the_vendors_payee(self):
        payee = self.payees.payee()
        name = self._insert(self._request("Not asked", vendor=self.payees.vendor(payee),
                                          payee=self.payees.payee()))
        self.assertEqual(frappe.db.get_value(REQUEST, name, "payee"), payee)

    def test_a_project_expense_naming_a_vendor_takes_its_payee_and_no_other(self):
        payee = self.payees.payee()
        vendor = self.payees.vendor(payee)
        name = self._insert(self._expense(PE, vendor=vendor))
        self.assertEqual(frappe.db.get_value(PE, name, "payee"), payee)
        with self.assertRaisesRegex(frappe.ValidationError, "is paid into payee"):
            self._insert(self._expense(PE, vendor=vendor, payee=self.payees.payee()))

    # -- Required --------------------------------------------------------------------------------
    def test_a_required_request_cannot_be_saved_without_a_payee(self):
        with self.assertRaisesRegex(frappe.ValidationError, "needs a payee"):
            self._insert(self._request("Required"))

    def test_a_request_from_before_still_saves_when_its_payee_is_untouched(self):
        old = self._raw(REQUEST, {"type": self.types["Required"], "amount": 4300, "status": "Pending Approval"})
        self._save_as(U, REQUEST, old, comment="re-saved")
        self.assertEqual(frappe.db.get_value(REQUEST, old, "comment"), "re-saved")

    # -- an expense's Payee ----------------------------------------------------------------------
    def test_a_paid_expense_keeps_its_payee_on_every_save(self):
        first, second = self.payees.payee(), self.payees.payee()
        for status in ("Reconciliation Pending", "Paid"):
            with self.subTest(status=status):
                name = self._raw(NPE, {"type": self.types["Optional"], "amount": 2500, "status": status,
                                       "payee": first})
                with self.assertRaisesRegex(frappe.ValidationError, "already paid"):
                    self._save_as(U, NPE, name, payee=second)
                frappe.db.rollback()
                self.assertEqual(frappe.db.get_value(NPE, name, "payee"), first)

    def test_only_accounts_change_an_expenses_payee_on_save(self):
        first, second = self.payees.payee(), self.payees.payee()
        name = self._raw(NPE, {"type": self.types["Optional"], "amount": 2500, "status": "Approved",
                               "payee": first})
        with self.assertRaisesRegex(frappe.PermissionError, "change who an expense is paid to"):
            self._save_as(PM_USER, NPE, name, payee=second)
        frappe.db.rollback()
        self.assertEqual(frappe.db.get_value(NPE, name, "payee"), first)

        self._save_as(U, NPE, name, payee=second)
        self.assertEqual(frappe.db.get_value(NPE, name, "payee"), second)

    def test_anyone_who_may_edit_an_expense_still_saves_it_when_its_payee_is_untouched(self):
        payee = self.payees.payee()
        name = self._raw(NPE, {"type": self.types["Optional"], "amount": 2500, "status": "Approved",
                               "payee": payee})
        self._save_as(PM_USER, NPE, name, comment="re-saved")
        self.assertEqual(frappe.db.get_value(NPE, name, "comment"), "re-saved")

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

    # -- correcting the vendor ------------------------------------------------------------------
    def _vendor_pair(self):
        first, second = self.payees.payee(), self.payees.payee()
        return first, self.payees.vendor(first), second, self.payees.vendor(second)

    def test_a_paid_expenses_vendor_is_corrected_and_its_payee_stays(self):
        """The money already went to the old Payee: correcting the vendor afterwards moves nothing."""
        first, v1, _, v2 = self._vendor_pair()
        for status in ("Reconciliation Pending", "Paid"):
            with self.subTest(status=status):
                name = self._raw(PE, {"type": self.types["Optional"], "amount": 2500, "status": status,
                                      "projects": self.project, "vendor": v1, "payee": first})
                self._save_as(PM_USER, PE, name, vendor=v2)
                self.assertEqual(tuple(frappe.db.get_value(PE, name, ["vendor", "payee"])), (v2, first))

    def test_an_unpaid_expense_follows_its_new_vendors_payee(self):
        first, v1, second, v2 = self._vendor_pair()
        name = self._raw(PE, {"type": self.types["Optional"], "amount": 2500, "status": "Approved",
                              "projects": self.project, "vendor": v1, "payee": first})
        self._save_as(PM_USER, PE, name, vendor=v2)
        self.assertEqual(frappe.db.get_value(PE, name, "payee"), second)

    def test_clearing_the_vendor_clears_its_payee_until_paid(self):
        first, v1, _, _ = self._vendor_pair()
        request = self._raw(REQUEST, {"type": self.types["Optional"], "amount": 4300,
                                      "status": "Pending Approval", "projects": self.project,
                                      "vendor": v1, "payee": first})
        self._save_as(U, REQUEST, request, vendor=None)
        self.assertIsNone(frappe.db.get_value(REQUEST, request, "payee"))

        unpaid = self._raw(PE, {"type": self.types["Optional"], "amount": 2500, "status": "Approved",
                                "projects": self.project, "vendor": v1, "payee": first})
        self._save_as(PM_USER, PE, unpaid, vendor=None)
        self.assertIsNone(frappe.db.get_value(PE, unpaid, "payee"))

        paid = self._raw(PE, {"type": self.types["Optional"], "amount": 2500, "status": "Paid",
                              "projects": self.project, "vendor": v1, "payee": first})
        self._save_as(PM_USER, PE, paid, vendor=None)
        self.assertEqual(frappe.db.get_value(PE, paid, "payee"), first)

    def test_the_expense_payee_role_refusal_tells_the_client_why(self):
        name = self._raw(NPE, {"type": self.types["Optional"], "amount": 2500, "status": "Approved"})
        with shown_to_client() as shown, self.assertRaises(frappe.PermissionError):
            self._save_as(PM_USER, NPE, name, payee=self.payees.payee())
        frappe.db.rollback()
        self.assertIn(EXPENSE_PAYEE_ROLE_PROBLEM, shown)

    def test_clearing_the_vendor_is_no_door_to_another_payee(self):
        """Only the vendor's own Payee moves with a vendor edit; naming another stays Accounts' call."""
        first, v1, _, _ = self._vendor_pair()
        name = self._raw(PE, {"type": self.types["Optional"], "amount": 2500, "status": "Approved",
                              "projects": self.project, "vendor": v1, "payee": first})
        with self.assertRaisesRegex(frappe.PermissionError, "change who an expense is paid to"):
            self._save_as(PM_USER, PE, name, vendor=None, payee=self.payees.payee())

    # -- a vendor's Inactive Payee -------------------------------------------------------------
    def _inactive_vendor(self) -> tuple[str, str]:
        payee = self.payees.payee()
        vendor = self.payees.vendor(payee)
        frappe.db.set_value("Payee", payee, "status", "Inactive")
        frappe.db.commit()
        return payee, vendor

    def test_a_new_request_naming_a_vendor_whose_payee_is_inactive_is_refused(self):
        """Owner decision (walk bug 7e): the money would go on into an account marked Inactive."""
        _, vendor = self._inactive_vendor()
        for rule in ("Required", "Optional", "Not asked"):
            with self.subTest(rule=rule), shown_to_client() as shown:
                with self.assertRaisesRegex(frappe.ValidationError, "bank account is Inactive"):
                    self._insert(self._request(rule, vendor=vendor))
                frappe.db.rollback()
            self.assertIn(VENDOR_PAYEE_INACTIVE_PROBLEM, shown)

    def test_moving_a_request_to_a_vendor_whose_payee_is_inactive_is_refused(self):
        name = self._insert(self._request("Optional"))
        _, vendor = self._inactive_vendor()
        with self.assertRaisesRegex(frappe.ValidationError, "bank account is Inactive"):
            self._save_as(U, REQUEST, name, vendor=vendor)
        frappe.db.rollback()

    def test_a_vendors_inactive_payee_already_on_a_record_is_carried_and_never_a_new_pick(self):
        payee, vendor = self._inactive_vendor()
        sent = self._raw(REQUEST, {"type": self.types["Optional"], "amount": 4300, "status": "Pending Approval",
                                   "projects": self.project, "vendor": vendor, "payee": payee})
        self._save_as(U, REQUEST, sent, comment="re-saved")
        self.assertEqual(frappe.db.get_value(REQUEST, sent, ["comment", "payee"]), ("re-saved", payee))
        expense = self._insert(self._expense(PE, vendor=vendor))
        self.assertEqual(frappe.db.get_value(PE, expense, "payee"), payee)

    # -- Required, on a change -----------------------------------------------------------------
    def test_a_required_expense_cannot_be_left_without_its_payee(self):
        payee = self.payees.payee()
        name = self._raw(NPE, {"type": self.types["Required"], "amount": 2500, "status": "Approved",
                               "payee": payee})
        with self.assertRaisesRegex(frappe.ValidationError, "needs a payee"):
            self._save_as(U, NPE, name, payee=None)

    def test_a_required_expense_is_still_inserted_without_a_payee(self):
        """Approval of a request from before payees, and Bulk Import, insert one with none."""
        name = self._insert(self._expense(NPE, type=self.types["Required"]))
        self.assertIsNone(frappe.db.get_value(NPE, name, "payee"))
