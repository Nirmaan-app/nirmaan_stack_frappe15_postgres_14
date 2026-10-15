"""Tests for the cross-asset history reads (`api/assets/history.get_asset_history`, the History table's
`get_asset_history_table` and its filter counts `get_asset_history_facets`).

Reuses the people/asset helpers and the purge of the departments suite (one purge per suite family,
CODING_STANDARDS.md § Writing tests). Nothing here commits; every row rolls back with the class.

Run: bench --site localhost run-tests --module nirmaan_stack.api.assets.test_history
"""

import json

import frappe
from frappe.model.delete_doc import get_linked_docs
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.assets.history import get_asset_history, get_asset_history_facets, get_asset_history_table
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


class _HistoryFixture(FrappeTestCase):
    """One laptop, Added and Assigned today (to the accountant, Projects -> Accounts); no tests of its own."""

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


class TestAssetHistoryRead(_HistoryFixture):
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


class TestAssetHistoryTable(_HistoryFixture):
    """The History tab's data table: filters from the column headers, sorting, paging, export (owner, 2026-10-15).

    Same fixture as the read above: this suite's laptop was Added and Assigned (to the accountant, Projects ->
    Accounts) today, both by Administrator. `search_term` keeps every call to that laptop.
    """

    def _table(self, filters=None, **kwargs):
        frappe.set_user(self.hr)
        return get_asset_history_table(
            filters=json.dumps(filters or []), search_term=self.asset, **kwargs
        )

    def _count(self, *filters):
        return self._table(list(filters))["total_count"]

    def test_only_admin_and_hr_can_read_the_table(self):
        frappe.set_user(self.pm)
        with self.assertRaises(frappe.PermissionError):
            get_asset_history_table()
        result = self._table()
        self.assertEqual(result["total_count"], 2)
        self.assertEqual([r.event for r in result["data"]], ["Assigned", "Asset Added"])  # newest first

    def test_the_header_facets(self):
        self.assertEqual(self._count(["event", "in", ["Assigned"]]), 1)
        self.assertEqual(self._count(["event", "in", ["Assigned", "Asset Added"]]), 2)
        self.assertEqual(self._count(["event", "in", ["Unassigned"]]), 0)
        self.assertEqual(self._count(["assigned_to", "in", [self.accountant]]), 1)
        self.assertEqual(self._count(["done_by", "in", ["Administrator"]]), 2)
        self.assertEqual(self._count(["department", "in", ["projects"]]), 2)  # moved from Projects; added in it
        self.assertEqual(self._count(["department", "in", ["HR"]]), 0)
        # two filters narrow together
        self.assertEqual(self._count(["event", "in", ["Assigned"]], ["department", "in", ["Accounts"]]), 1)

    def test_the_date_filter(self):
        today = frappe.utils.today()
        yesterday, tomorrow = frappe.utils.add_days(today, -1), frappe.utils.add_days(today, 1)
        cases = [
            (["done_on", "Between", [today, today]], 2),
            (["done_on", "Between", [yesterday, yesterday]], 0),
            (["done_on", ">=", today], 2),
            (["done_on", ">=", tomorrow], 0),
            (["done_on", "<=", today], 2),  # the whole last day counts
            (["done_on", "<=", yesterday], 0),
            (["done_on", "Is", today], 2),
            (["done_on", "IsNot", today], 0),
            (["done_on", "Timespan", "today"], 2),
            (["done_on", "Timespan", "yesterday"], 0),
        ]
        for date_filter, expected in cases:
            self.assertEqual(self._count(date_filter), expected, date_filter)

    def test_search_on_the_asset_id_or_name(self):
        frappe.set_user(self.hr)
        self.assertEqual(get_asset_history_table(search_term="history test LAPTOP")["total_count"], 2)

    def test_sorting_on_a_known_column_only(self):
        self.assertEqual([r.event for r in self._table(order_by="event asc")["data"]], ["Asset Added", "Assigned"])
        self.assertEqual([r.event for r in self._table(order_by="event desc")["data"]], ["Assigned", "Asset Added"])
        # anything else falls back to newest first
        for order_by in ("reason asc", "event; drop table x", "event sideways", None):
            self.assertEqual([r.event for r in self._table(order_by=order_by)["data"]], ["Assigned", "Asset Added"], order_by)

    def test_paging_and_export(self):
        page = self._table(limit_start=1, limit_page_length=1)
        self.assertEqual((page["total_count"], [r.event for r in page["data"]]), (2, ["Asset Added"]))
        self.assertEqual(len(self._table(limit_page_length=0, for_export=1)["data"]), 2)  # export: every row

    def test_a_filter_the_table_does_not_send_is_refused(self):
        for bad in (
            [["reason", "in", ["x"]]],  # a column without a header filter
            [["event", "=", "Assigned"]],  # facets are "in" a list
            [["event", "in", []]],
            [["done_on", "Timespan", "the age of dinosaurs"]],
            [["done_on", "Between", ["2026-10-01"]]],
            [["event", "in"]],
            "not json",
        ):
            frappe.set_user(self.hr)
            with self.assertRaises(frappe.ValidationError, msg=bad):
                get_asset_history_table(filters=bad if isinstance(bad, str) else json.dumps(bad), search_term=self.asset)


class TestAssetHistoryFacets(_HistoryFixture):
    """The counts beside the History table's header filter choices (owner, 2026-10-15). Same laptop as above
    (Added, then Assigned to the accountant, Projects -> Accounts); `search_term` keeps every call to it."""

    FIELDS = ("event", "assigned_to", "done_by", "department")

    def _facets(self, field, filters=None):
        frappe.set_user(self.hr)
        values = get_asset_history_facets(field, filters=json.dumps(filters or []), search_term=self.asset)["values"]
        return {v["value"]: v["count"] for v in values}

    def _count(self, *filters):
        frappe.set_user(self.hr)
        return get_asset_history_table(filters=json.dumps(list(filters)), search_term=self.asset)["total_count"]

    def test_only_admin_and_hr_and_only_the_header_filters(self):
        frappe.set_user(self.pm)
        with self.assertRaises(frappe.PermissionError):
            get_asset_history_facets("event")
        frappe.set_user(self.hr)
        for field in ("reason", "h.event", "event; drop table x"):
            with self.assertRaises(frappe.ValidationError, msg=field):
                get_asset_history_facets(field)

    def test_the_counts(self):
        self.assertEqual(self._facets("event"), {"Assigned": 1, "Asset Added": 1})
        self.assertEqual(self._facets("done_by"), {"Administrator": 2})
        self.assertEqual(self._facets("assigned_to").get(self.accountant), 1)
        # A row counts once under each department it touches: the move from Projects and the asset's Accounts now.
        self.assertEqual(self._facets("department"), {"Projects": 2, "Accounts": 2})

    def test_every_count_is_the_rows_its_filter_shows(self):
        for field in self.FIELDS:
            for value, count in self._facets(field).items():
                self.assertEqual(self._count([field, "in", [value]]), count, (field, value))

    def test_the_other_filters_narrow_the_counts_but_its_own_does_not(self):
        picked = [["event", "in", ["Assigned"]]]
        self.assertEqual(self._facets("event", picked), {"Assigned": 1, "Asset Added": 1})  # its own: still both
        self.assertEqual(self._facets("department", picked), {"Projects": 1, "Accounts": 1})
        self.assertEqual(self._facets("event", [["department", "in", ["HR"]]]), {})
        today = frappe.utils.today()
        self.assertEqual(self._facets("event", [["done_on", "Is", frappe.utils.add_days(today, -1)]]), {})


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
        frappe.delete_doc("Asset Management", returned, ignore_permissions=True, flags={"unassign_reason": "Returned – no longer needed"})
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
