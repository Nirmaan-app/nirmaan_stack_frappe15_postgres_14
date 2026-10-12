"""Tests for the cross-asset history read (`api/assets/history.get_asset_history`).

Reuses the people/asset helpers and the purge of the departments suite (one purge per suite family,
CODING_STANDARDS.md § Writing tests). Nothing here commits; every row rolls back with the class.

Run: bench --site localhost run-tests --module nirmaan_stack.api.assets.test_history
"""

import frappe
from frappe.model.delete_doc import get_linked_docs
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.assets.history import get_asset_history
from nirmaan_stack.nirmaan_stack.doctype.asset_management.test_asset_management import (
    ACCOUNTANT,
    CATEGORY_PREFIX,
    HR,
    PM,
    _make_person,
    _purge,
    ensure_departments,
)
from nirmaan_stack.services.asset_history import DECLARATION_SIGNED, add_history, rename_person


class TestAssetHistoryRead(FrappeTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        frappe.set_user("Administrator")
        cls.category = f"{CATEGORY_PREFIX} History Test {frappe.generate_hash(length=6)}"
        cls.departments = ensure_departments("HR", "Projects", "Accounts")
        frappe.get_doc({"doctype": "Asset Category", "asset_category": cls.category, "category_type": "IT"}).insert(
            ignore_permissions=True
        )
        cls.hr = _make_person("hhr", HR, "HR")
        cls.pm = _make_person("hpm", PM, "Projects")
        cls.accountant = _make_person("hacc", ACCOUNTANT, "Accounts")
        cls.people = [cls.hr, cls.pm, cls.accountant]

        cls.asset = frappe.get_doc({
            "doctype": "Asset Master", "asset_name": "History test laptop",
            "asset_category": cls.category, "department": "Projects",
        }).insert(ignore_permissions=True).name
        cls.assets = [cls.asset]
        assignment = frappe.get_doc({
            "doctype": "Asset Management", "asset": cls.asset, "asset_assigned_to": cls.accountant,
            "asset_assigned_on": frappe.utils.today(),
        })
        assignment.flags.department_change_reason = "Moved to the accounts team"
        assignment.insert(ignore_permissions=True)

    @classmethod
    def tearDownClass(cls):
        frappe.set_user("Administrator")
        _purge(cls.category, cls.assets, cls.people, cls.departments)
        super().tearDownClass()

    def tearDown(self):
        frappe.set_user("Administrator")

    def _mine(self, **filters):
        """The history of this suite's asset only (the live site has other assets' history too)."""
        return get_asset_history(asset=self.asset, **filters)

    def test_only_admin_and_hr_can_read(self):
        frappe.set_user(self.pm)
        with self.assertRaises(frappe.PermissionError):
            get_asset_history()
        frappe.set_user(self.hr)
        self.assertEqual(self._mine()["total"], 2)  # Asset Added + Assigned

    def test_newest_first_with_asset_details(self):
        rows = self._mine()["rows"]
        self.assertEqual([r.event for r in rows], ["Assigned", "Asset Added"])
        self.assertEqual(rows[0].asset_name, "History test laptop")
        self.assertEqual(rows[0].asset_department, "Accounts")
        self.assertEqual((rows[0].from_department, rows[0].to_department), ("Projects", "Accounts"))

    def test_filters(self):
        self.assertEqual(self._mine(event="Assigned")["total"], 1)
        self.assertEqual(self._mine(event="Unassigned")["total"], 0)
        self.assertEqual(self._mine(person=self.accountant)["total"], 1)
        self.assertEqual(self._mine(department="projects")["total"], 2)  # moved from Projects; added in it
        self.assertEqual(self._mine(department="HR")["total"], 0)
        today = frappe.utils.today()
        self.assertEqual(self._mine(from_date=today, to_date=today)["total"], 2)
        self.assertEqual(self._mine(to_date=frappe.utils.add_days(today, -1))["total"], 0)
        self.assertEqual(get_asset_history(asset="history test LAPTOP")["total"], 2)

    def test_paging(self):
        page = self._mine(start=1, page_length=1)
        self.assertEqual(page["total"], 2)
        self.assertEqual([r.event for r in page["rows"]], ["Asset Added"])


class TestHistoryNamesPeopleAsText(FrappeTestCase):
    """The history names people as plain text (owner, 2026-10-12): it never stops a person from being
    deleted, and an email rename carries over through `rename_person`."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        frappe.set_user("Administrator")
        cls.category = f"{CATEGORY_PREFIX} History People {frappe.generate_hash(length=6)}"
        cls.departments = ensure_departments("Projects")
        frappe.get_doc({"doctype": "Asset Category", "asset_category": cls.category, "category_type": "IT"}).insert(
            ignore_permissions=True
        )
        cls.former = _make_person("hfor", PM, "Projects")
        cls.holder = _make_person("hhold", PM, "Projects")
        cls.people = [cls.former, cls.holder]

        cls.asset = frappe.get_doc({
            "doctype": "Asset Master", "asset_name": "History people laptop",
            "asset_category": cls.category, "department": "Projects",
        }).insert(ignore_permissions=True).name
        cls.assets = [cls.asset]

        # The former holder was assigned the laptop, signed for it and gave it back: only the
        # history names them now, as the person and as the one who signed.
        returned = cls._assign(cls.former)
        frappe.set_user(cls.former)
        add_history(cls.asset, DECLARATION_SIGNED, assigned_to=cls.former)
        frappe.set_user("Administrator")
        frappe.delete_doc("Asset Management", returned, ignore_permissions=True)
        cls._assign(cls.holder)  # still holds it

    @classmethod
    def _assign(cls, person):
        return frappe.get_doc({
            "doctype": "Asset Management", "asset": cls.asset, "asset_assigned_to": person,
            "asset_assigned_on": frappe.utils.today(),
        }).insert(ignore_permissions=True).name

    @classmethod
    def tearDownClass(cls):
        frappe.set_user("Administrator")
        _purge(cls.category, cls.assets, cls.people, cls.departments)
        super().tearDownClass()

    def _rows(self, field, value):
        return frappe.db.count("Asset History", {"parent": self.asset, field: value})

    def _linked_assets(self, doctype, name):
        return [link["reference_docname"] for link in get_linked_docs(frappe.get_doc(doctype, name))]

    def test_history_does_not_block_deleting_a_former_holder(self):
        self.assertEqual(self._rows("assigned_to", self.former), 3)  # Assigned, Declaration Signed, Unassigned
        self.assertEqual(self._rows("done_by", self.former), 1)
        self.assertNotIn(self.asset, self._linked_assets("Nirmaan Users", self.former))
        self.assertNotIn(self.asset, self._linked_assets("User", self.former))

    def test_the_current_holder_is_still_blocked(self):
        self.assertIn(self.asset, self._linked_assets("Nirmaan Users", self.holder))

    def test_rename_moves_the_rows(self):
        renamed = f"zzd-renamed-{frappe.generate_hash(length=6)}@example.com"
        rename_person(self.former, renamed)
        self.addCleanup(rename_person, renamed, self.former)

        self.assertEqual(self._rows("assigned_to", renamed), 3)
        self.assertEqual(self._rows("done_by", renamed), 1)
        self.assertEqual(self._rows("assigned_to", self.former) + self._rows("done_by", self.former), 0)
        self.assertEqual(self._rows("assigned_to", self.holder), 1)  # someone else's row is left alone
