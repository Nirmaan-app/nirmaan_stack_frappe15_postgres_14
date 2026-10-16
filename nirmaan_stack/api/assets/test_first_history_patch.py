"""Tests for the patch that gives assets assigned before the history its first entries
(`patches/v3_0/backfill_first_asset_history`, owner 2026-10-16).

Each test builds its own "old" asset: an assignment inserted without hooks (as it was before the history),
dated in the past, with the history rows the case needs. The finder reads the whole live site, so every
check keeps to this suite's assets. Nothing here commits; every row rolls back with the class, and the
departments suite's purge removes anything left (one purge per suite family, CODING_STANDARDS.md § Writing tests).

Run: bench --site localhost run-tests --module nirmaan_stack.api.assets.test_first_history_patch
"""

from datetime import datetime
from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import get_datetime

from nirmaan_stack.nirmaan_stack.doctype.asset_management.test_asset_management import (
    CATEGORY_PREFIX,
    FAKE_FILE_URL,
    HR,
    PM,
    _make_person,
    _purge,
    ensure_departments,
)
from nirmaan_stack.patches.v3_0 import backfill_first_asset_history as backfill
from nirmaan_stack.services.asset_history import (
    ASSIGNED,
    AUDIT_REQUESTED,
    DECLARATION_SIGNED,
    UNASSIGNED,
    add_history,
)

ASSIGNED_ON = "2026-05-10"
ENTERED_ON = datetime(2026, 5, 10, 14, 49, 19)
UPLOADED_ON = datetime(2026, 5, 10, 15, 34, 34)


class TestBackfillFirstAssetHistory(FrappeTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        frappe.set_user("Administrator")
        cls.category = f"{CATEGORY_PREFIX} First History {frappe.generate_hash(length=6)}"
        cls.departments = ensure_departments("HR", "Projects")
        frappe.get_doc({"doctype": "Asset Category", "asset_category": cls.category, "category_type": "IT"}).insert(
            ignore_permissions=True
        )
        cls.hr = _make_person("fhr", HR, "HR")
        cls.holder = _make_person("fholder", PM, "Projects")
        cls.earlier = _make_person("fearlier", PM, "Projects")
        cls.people = [cls.hr, cls.holder, cls.earlier]
        cls.assets = []

    @classmethod
    def tearDownClass(cls):
        frappe.set_user("Administrator")
        _purge(cls.category, cls.assets or ["__none__"], cls.people, cls.departments)
        super().tearDownClass()

    def tearDown(self):
        frappe.set_user("Administrator")

    # -- fixtures ---------------------------------------------------------------------------------------------

    def _asset(self) -> str:
        """A new asset with no history at all, as every asset was before 12 Oct 2026."""
        name = frappe.get_doc({
            "doctype": "Asset Master", "asset_name": "First history test laptop",
            "asset_category": self.category, "department": "Projects",
        }).insert(ignore_permissions=True).name
        frappe.db.delete("Asset History", {"parent": name, "parenttype": "Asset Master"})  # drop "Asset Added"
        self.assets.append(name)
        return name

    def _old_assignment(self, asset, person=None, declaration=None, assigned_on=ASSIGNED_ON, entered_on=ENTERED_ON,
                        hold=True):
        """An Asset Management row written the old way: no hooks, so no history; made by HR on `entered_on`."""
        person = person or self.holder
        row = frappe.new_doc("Asset Management")
        row.update({
            "asset": asset, "asset_assigned_to": person, "asset_assigned_on": assigned_on,
            "asset_declaration_attachment": declaration,
            "owner": self.hr, "modified_by": self.hr, "creation": entered_on, "modified": entered_on,
        })
        row.db_insert()
        if hold:
            frappe.db.set_value("Asset Master", asset, "current_assignee", person, update_modified=False)
        return row.name

    def _form(self, uploaded_on=UPLOADED_ON, with_file=True) -> str:
        """A scanned declaration's URL; with_file: also its File record, uploaded by HR on `uploaded_on`."""
        tag = frappe.generate_hash(length=8)
        url = FAKE_FILE_URL.format(tag, tag)
        if with_file:
            file = frappe.new_doc("File")
            file.update({
                "file_name": f"{tag}.pdf", "file_url": url, "is_private": 0,
                "owner": self.hr, "modified_by": self.hr, "creation": uploaded_on, "modified": uploaded_on,
            })
            file.db_insert()
        return url

    def _history(self, asset) -> list:
        return frappe.get_all(
            "Asset History",
            filters={"parent": asset, "parenttype": "Asset Master"},
            fields=["name", "idx", "event", "assigned_to", "done_by", "done_on", "declaration", "reason"],
            order_by="idx asc",
        )

    def _found(self, asset):
        """The finder's row for `asset`, or None."""
        assets, _ = backfill.find_assets_to_backfill()
        return next((row for row in assets if row.asset == asset), None)

    def _backfill(self, asset) -> dict:
        row = self._found(asset)
        self.assertIsNotNone(row, f"{asset} should need its first history entries")
        return backfill.backfill_asset(row)

    # -- the rule ---------------------------------------------------------------------------------------------

    def test_declaration_on_file_gets_assigned_then_signed_by_the_holder(self):
        asset = self._asset()
        form = self._form()
        self._old_assignment(asset, declaration=form)
        add_history(asset, AUDIT_REQUESTED, assigned_to=self.holder, reason="Audit for 11/2026")
        before = self._history(asset)

        self.assertEqual(self._backfill(asset)["events"], [ASSIGNED, DECLARATION_SIGNED])

        rows = self._history(asset)
        self.assertEqual([r.event for r in rows], [ASSIGNED, DECLARATION_SIGNED, AUDIT_REQUESTED])
        self.assertEqual([r.idx for r in rows], [1, 2, 3])
        assigned, signed, audit = rows
        self.assertEqual((assigned.assigned_to, assigned.done_by), (self.holder, self.hr))
        self.assertEqual(get_datetime(assigned.done_on), ENTERED_ON)
        self.assertEqual(assigned.reason, backfill.BACKFILL_NOTE)
        self.assertIsNone(assigned.declaration)
        # The holder signed the paper form; HR only uploaded it, so HR is not named (owner, 2026-10-16).
        self.assertEqual((signed.assigned_to, signed.done_by), (self.holder, self.holder))
        self.assertEqual(get_datetime(signed.done_on), UPLOADED_ON)
        self.assertEqual(signed.declaration, form)
        self.assertEqual(signed.reason, backfill.BACKFILL_NOTE)
        # The row that was there only moved back; nothing in it changed.
        old = before[0]
        self.assertEqual({**audit, "idx": old.idx}, old)

    def test_pending_declaration_gets_assigned_only(self):
        asset = self._asset()
        self._old_assignment(asset)
        add_history(asset, AUDIT_REQUESTED, assigned_to=self.holder, reason="Audit for 11/2026")

        self.assertEqual(self._backfill(asset)["events"], [ASSIGNED])
        self.assertEqual([(r.idx, r.event) for r in self._history(asset)], [(1, ASSIGNED), (2, AUDIT_REQUESTED)])

    def test_declaration_already_in_the_history_gets_assigned_only(self):
        """The ASSET-TAB-013 case: signed in the app after the history started, assigned before it."""
        asset = self._asset()
        form = self._form()
        self._old_assignment(asset, declaration=form)
        add_history(asset, DECLARATION_SIGNED, assigned_to=self.holder, declaration=form)

        self.assertEqual(self._backfill(asset)["events"], [ASSIGNED])
        self.assertEqual([(r.idx, r.event) for r in self._history(asset)], [(1, ASSIGNED), (2, DECLARATION_SIGNED)])

    def test_already_assigned_in_the_history_is_left_alone(self):
        asset = self._asset()
        self._old_assignment(asset)
        add_history(asset, ASSIGNED, assigned_to=self.holder)

        self.assertIsNone(self._found(asset))

    def test_an_earlier_holders_assigned_row_does_not_count(self):
        asset = self._asset()
        add_history(asset, ASSIGNED, assigned_to=self.earlier)
        add_history(asset, UNASSIGNED, assigned_to=self.earlier, reason="Returned")
        self._old_assignment(asset)

        self.assertEqual(self._backfill(asset)["events"], [ASSIGNED])
        rows = self._history(asset)
        self.assertEqual([(r.idx, r.event, r.assigned_to) for r in rows], [
            (1, ASSIGNED, self.holder), (2, ASSIGNED, self.earlier), (3, UNASSIGNED, self.earlier),
        ])

    def test_only_the_holders_own_assignment_is_used(self):
        """A leftover row for someone else (with its own form) is not read."""
        asset = self._asset()
        self._old_assignment(asset, person=self.earlier, declaration=self._form(), hold=False,
                             entered_on=datetime(2026, 1, 5, 10, 0), assigned_on="2026-01-05")
        self._old_assignment(asset)

        row = self._found(asset)
        self.assertIsNotNone(row)
        self.assertEqual((row.holder, row.declaration, get_datetime(row.entered_on)), (self.holder, None, ENTERED_ON))
        self.assertEqual(backfill.backfill_asset(row)["events"], [ASSIGNED])

    def test_free_asset_and_holder_without_a_row_get_nothing(self):
        free = self._asset()
        self._old_assignment(free, hold=False)  # a leftover on a free asset
        no_row = self._asset()
        frappe.db.set_value("Asset Master", no_row, "current_assignee", self.holder, update_modified=False)

        assets, holders_without_row = backfill.find_assets_to_backfill()
        mine = {row.asset for row in assets}
        self.assertNotIn(free, mine)
        self.assertNotIn(no_row, mine)
        self.assertIn((no_row, self.holder), [(r.asset, r.holder) for r in holders_without_row])

    # -- the dates --------------------------------------------------------------------------------------------

    def test_form_uploaded_before_the_assignment_was_saved_comes_after_it(self):
        asset = self._asset()
        self._old_assignment(asset, declaration=self._form(uploaded_on=datetime(2026, 5, 10, 14, 40)))

        self._backfill(asset)
        assigned, signed = self._history(asset)
        self.assertEqual(get_datetime(signed.done_on), get_datetime(assigned.done_on))
        self.assertEqual((assigned.idx, signed.idx), (1, 2))

    def test_form_without_a_file_record_is_still_recorded(self):
        asset = self._asset()
        form = self._form(with_file=False)
        self._old_assignment(asset, declaration=form)

        self.assertEqual(self._backfill(asset)["events"], [ASSIGNED, DECLARATION_SIGNED])
        assigned, signed = self._history(asset)
        self.assertEqual((signed.declaration, signed.done_by), (form, self.holder))
        self.assertEqual(get_datetime(signed.done_on), get_datetime(assigned.done_on))

    def test_assignment_entered_on_a_later_day_is_dated_its_assigned_on(self):
        asset = self._asset()
        self._old_assignment(asset, assigned_on="2026-04-02", entered_on=datetime(2026, 5, 10, 14, 49))

        self._backfill(asset)
        self.assertEqual(get_datetime(self._history(asset)[0].done_on), datetime(2026, 4, 2, 0, 0))

    def test_assigned_time_rule(self):
        self.assertEqual(backfill.assigned_time("2026-05-10", "2026-05-10 14:49:19"), ENTERED_ON)
        self.assertEqual(backfill.assigned_time("2026-04-02", "2026-05-10 14:49:19"), datetime(2026, 4, 2))
        self.assertEqual(backfill.assigned_time(None, "2026-05-10 14:49:19"), ENTERED_ON)

    # -- running it -------------------------------------------------------------------------------------------

    def test_second_run_writes_nothing(self):
        asset = self._asset()
        self._old_assignment(asset, declaration=self._form())
        self._backfill(asset)

        self.assertIsNone(self._found(asset))
        self.assertEqual(len(self._history(asset)), 2)

    def test_run_rolls_back_a_dry_run_and_commits_a_real_one(self):
        asset = self._asset()
        self._old_assignment(asset)

        # commit / rollback are stubbed (nothing in a test may commit), so the first run's rows stay and the
        # second run finds the asset already done.
        for dry_run, written in ((True, [asset]), (False, [])):
            with patch.object(backfill, "find_assets_to_backfill", self._scoped_finder(asset)), \
                    patch.object(frappe.db, "commit") as commit, patch.object(frappe.db, "rollback") as rollback, \
                    patch("builtins.print"):
                report = backfill.run(dry_run=dry_run)
            self.assertEqual((rollback.called, commit.called), (dry_run, not dry_run))
            self.assertEqual([item["asset"] for item in report["written"]], written)

    def _scoped_finder(self, asset):
        """find_assets_to_backfill, kept to this one asset (the live site has others)."""
        real = backfill.find_assets_to_backfill

        def scoped():
            assets, _ = real()
            return [row for row in assets if row.asset == asset], []

        return scoped

    def test_asset_still_saves_after_the_backfill(self):
        """The append-only guard compares content, not idx, and the asset's `modified` moved."""
        asset = self._asset()
        self._old_assignment(asset, declaration=self._form())
        add_history(asset, AUDIT_REQUESTED, assigned_to=self.holder, reason="Audit for 11/2026")
        before = frappe.db.get_value("Asset Master", asset, "modified")
        row = self._found(asset)
        backfill.backfill_asset(row)
        backfill.touch_assets([asset])

        self.assertGreater(frappe.db.get_value("Asset Master", asset, "modified"), before)
        doc = frappe.get_doc("Asset Master", asset)
        self.assertEqual([r.event for r in doc.asset_history], [ASSIGNED, DECLARATION_SIGNED, AUDIT_REQUESTED])
        doc.asset_description = "Saved after the backfill"
        doc.save(ignore_permissions=True)
