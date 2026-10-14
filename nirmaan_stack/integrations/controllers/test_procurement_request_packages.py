# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Lifecycle tests: a PR's `pr_tag_list` follows its items, and the live PR Tracker reads it.

The rule itself is pinned in `services/test_pr_packages.py`; these go through the real save
path (validate -> rows written) and read the tracker endpoints, which group those rows live.

⚠️ RUNS AGAINST THE LIVE SITE DATABASE. Nothing here commits: every test rolls back in
`tearDown`, then checks that nothing of its own project survived and purges it if it did.
The PR hooks would send push and in-app notifications to real admins, and auto-approval
would move a Redis counter, so the recipient lookups and the auto-approval check are patched
for every test.

Run:  bench --site localhost run-tests --module nirmaan_stack.integrations.controllers.test_procurement_request_packages
"""

import unittest
from unittest import mock

import frappe

from nirmaan_stack.api.critical_pr_tasks.get_projects_with_pr_stats import (
    get_project_pr_packages,
    get_projects_with_critical_pr_stats,
)

CONTROLLER = "nirmaan_stack.integrations.controllers.procurement_requests"

ELEC, HVAC, FA, CHARGES = "Electrical Work", "HVAC System", "FA System", "Additional Charges"


def _category_for(package):
    return frappe.db.get_value("Category", {"work_package": package}, "name")


class PRPackagesLifecycleTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.cat = {package: _category_for(package) for package in (ELEC, HVAC, FA, CHARGES)}
        missing = [package for package, category in cls.cat.items() if not category]
        if missing:
            raise unittest.SkipTest(f"no Category mapped to {missing}")

    def setUp(self):
        super().setUp()
        frappe.set_user("Administrator")
        suffix = frappe.generate_hash(length=5).upper()
        self.project = f"TEST-PRPKG-{suffix}"
        frappe.get_doc({
            "doctype": "Projects",
            "name": self.project,
            "project_name": self.project,
            "tendering_status": "Won",
        }).db_insert()
        self._patches = mock.patch.multiple(
            CONTROLLER,
            get_admin_users=lambda *a, **k: [],
            get_allowed_lead_users=lambda *a, **k: [],
            get_allowed_procurement_users=lambda *a, **k: [],
            get_allowed_manager_users=lambda *a, **k: [],
            validate_procurement_request=lambda *a, **k: False,
        )
        self._patches.start()

    def tearDown(self):
        self._patches.stop()
        frappe.db.rollback()
        self._purge_leftovers()
        super().tearDown()

    def _purge_leftovers(self):
        """Nothing should survive the rollback; if a hook committed, remove what it left."""
        prs = frappe.get_all("Procurement Requests", filters={"project": self.project}, pluck="name")
        scopes = [
            ("PR children", lambda: [
                frappe.db.sql(f'DELETE FROM "tab{child}" WHERE parent=%s', (pr,))
                for pr in prs
                for child in ("PR Tag Child Table", "Procurement Request Item Detail")
            ]),
            ("PRs", lambda: frappe.db.sql('DELETE FROM "tabProcurement Requests" WHERE project=%s', (self.project,))),
            ("POs", lambda: [
                frappe.db.sql('DELETE FROM "tabPurchase Order Item" WHERE parent IN (SELECT name FROM "tabProcurement Orders" WHERE project=%s)', (self.project,)),
                frappe.db.sql('DELETE FROM "tabProcurement Orders" WHERE project=%s', (self.project,)),
            ]),
            ("project", lambda: frappe.db.sql('DELETE FROM "tabProjects" WHERE name=%s', (self.project,))),
        ]
        leaked = bool(prs) or frappe.db.exists("Projects", self.project)
        for label, purge in scopes if leaked else []:
            try:
                purge()
                frappe.db.commit()
            except Exception as exc:  # report, never swallow silently
                frappe.db.rollback()
                print(f"[test_procurement_request_packages] purge of {label} failed: {exc}")
        self.assertFalse(leaked, f"a hook committed test data for {self.project}")

    # --- helpers -------------------------------------------------------------------------

    def _item(self, package, status="Pending", own_package=True):
        category = self.cat[package]
        return {
            "item_id": f"TEST-ITEM-{frappe.generate_hash(length=6)}",
            "item_name": f"test item {package}",
            "unit": "Nos",
            "quantity": 1,
            "category": category,
            "procurement_package": package if own_package else "",
            "status": status,
        }

    def _new_pr(self, items, tags=None, work_package="Normal"):
        doc = frappe.get_doc({
            "doctype": "Procurement Requests",
            "project": self.project,
            "work_package": work_package,
            "order_list": items,
            "pr_tag_list": tags or [],
        })
        doc.insert(ignore_permissions=True)
        return doc

    def _reload(self, doc):
        return frappe.get_doc("Procurement Requests", doc.name)

    def _rows(self, doc):
        return [(row.tag_package, row.tag_header or "") for row in self._reload(doc).pr_tag_list]

    def _tracker(self):
        """{package: [pr names]} as the PR Tracker detail page reads it."""
        return {row["package"]: row["prs"] for row in get_project_pr_packages(self.project)}

    def _legacy_rows(self, doc, rows):
        """Replace a PR's tag rows with old-style header rows, bypassing hooks like old data."""
        frappe.db.sql('DELETE FROM "tabPR Tag Child Table" WHERE parent=%s', (doc.name,))
        for idx, (package, header) in enumerate(rows, start=1):
            frappe.get_doc({
                "doctype": "PR Tag Child Table",
                "name": frappe.generate_hash(length=10),
                "parent": doc.name,
                "parenttype": "Procurement Requests",
                "parentfield": "pr_tag_list",
                "idx": idx,
                "tag_package": package,
                "tag_header": header,
            }).db_insert()

    # --- create ----------------------------------------------------------------------------

    def test_create_writes_one_row_per_item_package(self):
        pr = self._new_pr([self._item(HVAC), self._item(ELEC), self._item(HVAC)])
        self.assertEqual(self._rows(pr), [(ELEC, ""), (HVAC, "")])
        self.assertEqual(self._tracker(), {ELEC: [pr.name], HVAC: [pr.name]})

    def test_create_replaces_client_sent_rows(self):
        header = frappe.db.get_value("PR Tag Headers", {"tag_package": ELEC}, "name")
        tags = [{"tag_package": FA}, {"tag_package": FA}]
        if header:
            tags.append({"tag_package": ELEC, "tag_header": header})
        pr = self._new_pr([self._item(HVAC)], tags=tags)
        self.assertEqual(self._rows(pr), [(HVAC, "")])

    def test_additional_charges_and_category_fallback(self):
        pr = self._new_pr([self._item(CHARGES), self._item(FA, own_package=False)])
        self.assertEqual(self._rows(pr), [(FA, "")])

    def test_custom_pr_gets_packages_from_items(self):
        pr = self._new_pr([self._item(FA)], tags=[{"tag_package": ELEC}], work_package="Custom")
        self.assertEqual(self._rows(pr), [(FA, "")])

    def test_auto_approval_second_save_keeps_the_tracker(self):
        # after_insert auto-approves and saves again; the tracker must still list the PR.
        with mock.patch(f"{CONTROLLER}.validate_procurement_request", lambda *a, **k: True):
            pr = self._new_pr([self._item(ELEC)])
        self.assertEqual(self._reload(pr).workflow_state, "Approved")
        self.assertEqual(self._rows(pr), [(ELEC, "")])
        self.assertEqual(self._tracker(), {ELEC: [pr.name]})

    # --- update ----------------------------------------------------------------------------

    def test_adding_and_removing_items_moves_packages(self):
        pr = self._new_pr([self._item(ELEC)])
        pr = self._reload(pr)
        pr.append("order_list", self._item(FA))
        pr.save(ignore_permissions=True)
        self.assertEqual(self._rows(pr), [(ELEC, ""), (FA, "")])
        self.assertIn(FA, self._tracker())

        pr = self._reload(pr)
        pr.set("order_list", [row for row in pr.order_list if row.procurement_package != FA])
        pr.save(ignore_permissions=True)
        self.assertEqual(self._rows(pr), [(ELEC, "")])
        self.assertNotIn(FA, self._tracker(), "the last PR left FA")

    def test_status_change_never_moves_packages(self):
        pr = self._reload(self._new_pr([self._item(ELEC), self._item(FA)]))
        names = [row.name for row in pr.pr_tag_list]
        for row in pr.order_list:
            row.status = "Deleted" if row.procurement_package == FA else "Approved"
        pr.save(ignore_permissions=True)
        pr = self._reload(pr)
        self.assertEqual([row.name for row in pr.pr_tag_list], names, "rows must not be rewritten")
        self.assertEqual(self._rows(pr), [(ELEC, ""), (FA, "")])

    def test_editing_an_items_package_moves_rows(self):
        pr = self._reload(self._new_pr([self._item(ELEC)]))
        pr.order_list[0].procurement_package = FA
        pr.order_list[0].category = self.cat[FA]
        pr.save(ignore_permissions=True)
        self.assertEqual(self._rows(pr), [(FA, "")])

    def test_request_that_edits_tag_rows_is_rebuilt(self):
        pr = self._reload(self._new_pr([self._item(ELEC)]))
        pr.append("pr_tag_list", {"tag_package": HVAC})
        pr.save(ignore_permissions=True)
        self.assertEqual(self._rows(pr), [(ELEC, "")])

    # --- old rows written before this change -------------------------------------------------

    def test_old_header_rows_collapse_without_rereading_items(self):
        pr = self._new_pr([self._item(FA)])
        hvac_headers = frappe.get_all("PR Tag Headers", filters={"tag_package": HVAC}, pluck="name")[:2]
        legacy = [(HVAC, h) for h in hvac_headers] + [(ELEC, None)]
        self._legacy_rows(pr, legacy)
        pr = self._reload(pr)
        pr.comment = "a save that touches no item"
        pr.save(ignore_permissions=True)
        # Items say FA, but nothing about them changed: the stored packages stay, cleaned.
        self.assertEqual(self._rows(pr), [(ELEC, ""), (HVAC, "")])

    def test_old_rows_are_rebuilt_once_items_change(self):
        pr = self._new_pr([self._item(FA)])
        self._legacy_rows(pr, [(HVAC, None), (HVAC, None)])
        pr = self._reload(pr)
        pr.append("order_list", self._item(ELEC))
        pr.save(ignore_permissions=True)
        self.assertEqual(self._rows(pr), [(ELEC, ""), (FA, "")])

    # --- live POs ------------------------------------------------------------------------

    def _live_po(self, pr, package, status="PO Approved"):
        po = f"TEST-PO-{frappe.generate_hash(length=6)}"
        frappe.get_doc({
            "doctype": "Procurement Orders",
            "name": po,
            "project": self.project,
            "procurement_request": pr.name,
            "status": status,
        }).db_insert()
        frappe.get_doc({
            "doctype": "Purchase Order Item",
            "name": frappe.generate_hash(length=10),
            "parent": po,
            "parenttype": "Procurement Orders",
            "parentfield": "items",
            "idx": 1,
            "procurement_package": package,
            "category": self.cat[package],
        }).db_insert()
        return po

    def test_a_live_po_never_keeps_a_package_the_items_dropped(self):
        # Only the PR's own items count (owner, 2026-10-14): a PO's items are never read.
        pr = self._new_pr([self._item(ELEC), self._item(FA)])
        self._live_po(pr, FA)
        pr = self._reload(pr)
        pr.set("order_list", [row for row in pr.order_list if row.procurement_package != FA])
        pr.save(ignore_permissions=True)
        self.assertEqual(self._rows(pr), [(ELEC, "")])

    def test_a_live_po_never_adds_a_package(self):
        # A merged PO holds another PR's items (here HVAC) but points to this PR: still not added.
        pr = self._new_pr([self._item(ELEC)])
        self._live_po(pr, HVAC)
        pr = self._reload(pr)
        pr.append("order_list", self._item(FA))
        pr.save(ignore_permissions=True)
        self.assertEqual(self._rows(pr), [(ELEC, ""), (FA, "")])

    # --- tracker ---------------------------------------------------------------------------

    def test_old_header_rows_show_once_per_package(self):
        pr = self._new_pr([self._item(HVAC)])
        hvac_headers = frappe.get_all("PR Tag Headers", filters={"tag_package": HVAC}, pluck="name")[:2]
        self._legacy_rows(pr, [(HVAC, h) for h in hvac_headers] + [(HVAC, None)])
        self.assertEqual(self._tracker(), {HVAC: [pr.name]})

    def test_two_prs_share_one_package(self):
        first = self._new_pr([self._item(ELEC)])
        second = self._new_pr([self._item(ELEC)])
        self.assertEqual(self._tracker()[ELEC], sorted([first.name, second.name]))

    def test_deleting_a_pr_leaves_the_tracker(self):
        keep = self._new_pr([self._item(ELEC)])
        gone = self._new_pr([self._item(ELEC), self._item(FA)])
        frappe.delete_doc("Procurement Requests", gone.name, ignore_permissions=True, force=True)
        self.assertEqual(self._tracker(), {ELEC: [keep.name]})

    def test_a_refused_delete_changes_nothing(self):
        pr = self._new_pr([self._item(ELEC)])
        self._live_po(pr, ELEC)
        with self.assertRaises(frappe.LinkExistsError):
            frappe.delete_doc("Procurement Requests", pr.name, ignore_permissions=True)
        self.assertEqual(self._tracker(), {ELEC: [pr.name]})

    def test_a_restricted_user_cannot_read_another_project(self):
        with mock.patch(
            "nirmaan_stack.api.critical_pr_tasks.get_projects_with_pr_stats._visible_projects",
            lambda: ["SOME-OTHER-PROJECT"],
        ):
            with self.assertRaises(frappe.PermissionError):
                get_project_pr_packages(self.project)

    def test_stats_never_count_more_used_than_total(self):
        self._new_pr([self._item(ELEC), self._item(FA)])
        stats = {row["project"]: row for row in get_projects_with_critical_pr_stats()}
        mine = stats[self.project]
        self.assertEqual(mine["used_packages_count"], 2)
        self.assertGreaterEqual(mine["total_enabled_packages"], mine["used_packages_count"])
        self.assertNotIn("used_headers_count", mine)


if __name__ == "__main__":
    unittest.main()
