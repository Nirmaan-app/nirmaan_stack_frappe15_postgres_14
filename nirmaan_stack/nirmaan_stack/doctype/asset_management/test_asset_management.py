# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt
"""Asset departments + Asset History, end to end against real rows.

Covers the assignment rules (one holder, a reason to move departments), the history rows each event
writes, the declaration file surviving an unassign, the Edit rules on an asset's department, the
append-only history, and who may set a person's department.

Nothing here commits, so every row rolls back with the class. `_purge` still runs afterwards as the
safety net CODING_STANDARDS.md § Writing tests asks for. Test people are bare User + Nirmaan Users
rows inserted with db_insert, so the User/Nirmaan Users hooks never run for them.

Run: bench --site localhost run-tests --module nirmaan_stack.nirmaan_stack.doctype.asset_management.test_asset_management
"""

from unittest.mock import patch

import frappe
from frappe.model.rename_doc import rename_doc
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.assets.assign import assign_asset, unassign_asset
from nirmaan_stack.api.users import create_user
from nirmaan_stack.patches.v3_0.remove_leftover_asset_assignments import find_leftovers, remove_leftover

CATEGORY_PREFIX = "ZZD"
HR = "Nirmaan HR Executive Profile"
PM = "Nirmaan Project Manager Profile"
ACCOUNTANT = "Nirmaan Accountant Profile"
FAKE_FILE_URL = "/api/method/frappe_gcp_attachment.controller.generate_file?key=test-dept/{}.pdf&file_name={}.pdf"


def _make_person(tag, profile, department=None):
    """A bare User + Nirmaan Users pair, inserted without hooks."""
    email = f"zzd-{tag}-{frappe.generate_hash(length=6)}@example.com"
    user = frappe.new_doc("User")
    user.update({"name": email, "email": email, "first_name": f"ZZD {tag}", "enabled": 1, "user_type": "System User"})
    user.db_insert()
    person = frappe.new_doc("Nirmaan Users")
    person.update({
        "name": email, "email": email, "first_name": f"ZZD {tag}", "full_name": f"ZZD {tag}",
        "role_profile": profile, "department": department,
    })
    person.db_insert()
    return email


def ensure_departments(*names):
    """Create the departments a suite needs if the site doesn't have them yet; return those created."""
    created = []
    for name in names:
        if not frappe.db.exists("Nirmaan Department", name):
            frappe.get_doc({"doctype": "Nirmaan Department", "department_name": name, "is_active": 1}).insert(
                ignore_permissions=True
            )
            created.append(name)
    return created


def _purge(category, assets, people, departments=()):
    """Remove anything that outlived the rollback (see module docstring)."""
    frappe.db.rollback()
    problems = []
    scopes = [
        ("Asset Management", {"asset": ["in", assets]}),
        ("Asset History", {"parent": ["in", assets], "parenttype": "Asset Master"}),
        ("File", {"file_url": ["like", "%test-dept/%"]}),
        ("Version", {"docname": ["in", assets + people]}),
        ("Asset Master", {"name": ["in", assets]}),
        ("Asset Category", {"name": category}),
        ("Series", {"name": f"ASSET-{CATEGORY_PREFIX}-"}),
        ("Nirmaan Users", {"name": ["in", people]}),
        ("User", {"name": ["in", people]}),
        ("Nirmaan Department", {"name": ["in", list(departments) or ["__none__"]]}),
    ]
    for doctype, filters in scopes:
        try:
            frappe.db.delete(doctype, filters)
            frappe.db.commit()
        except Exception as exc:  # noqa: BLE001 -- reported, never swallowed
            frappe.db.rollback()
            problems.append(f"{doctype}: {exc}")
    if problems:
        print("WARNING -- test_asset_management purge INCOMPLETE, rows left in the live DB: %s" % "; ".join(problems))
    return problems


class TestAssetDepartmentsAndHistory(FrappeTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        frappe.set_user("Administrator")
        cls.category = f"{CATEGORY_PREFIX} Dept Test {frappe.generate_hash(length=6)}"
        cls.assets = []
        cls.departments = ensure_departments("HR", "Projects", "Accounts", "Design", "Sales")
        frappe.get_doc({"doctype": "Asset Category", "asset_category": cls.category, "category_type": "IT"}).insert(
            ignore_permissions=True
        )
        cls.hr = _make_person("hr", HR, "HR")
        cls.pm = _make_person("pm", PM, "Projects")
        cls.accountant = _make_person("acc", ACCOUNTANT, "Accounts")
        cls.no_dept = _make_person("nodept", PM)
        cls.people = [cls.hr, cls.pm, cls.accountant, cls.no_dept]

    @classmethod
    def tearDownClass(cls):
        frappe.set_user("Administrator")
        _purge(cls.category, cls.assets or ["__none__"], cls.people, cls.departments)
        super().tearDownClass()

    def setUp(self):
        frappe.set_user("Administrator")
        self.asset = self._new_asset("Projects")

    def tearDown(self):
        frappe.set_user("Administrator")

    # -- helpers --------------------------------------------------------------------------------

    def _new_asset(self, department):
        asset = frappe.get_doc({
            "doctype": "Asset Master", "asset_name": "Dept test laptop",
            "asset_category": self.category, "department": department,
        }).insert(ignore_permissions=True)
        self.assets.append(asset.name)
        return asset.name

    def _assign(self, person, reason=None, asset=None, declaration=None):
        """Insert an assignment the way `assign_asset` does: the reason rides on the flags."""
        assignment = frappe.get_doc({
            "doctype": "Asset Management", "asset": asset or self.asset, "asset_assigned_to": person,
            "asset_assigned_on": frappe.utils.today(), "asset_declaration_attachment": declaration,
        })
        assignment.flags.department_change_reason = reason
        return assignment.insert(ignore_permissions=True)

    def _history(self, asset=None):
        return frappe.get_all(
            "Asset History", filters={"parent": asset or self.asset}, order_by="idx",
            fields=["event", "assigned_to", "done_by", "declaration", "from_department", "to_department", "reason"],
        )

    def _asset(self, field, asset=None):
        return frappe.db.get_value("Asset Master", asset or self.asset, field)

    # -- adding an asset ------------------------------------------------------------------------

    def test_new_asset_writes_asset_added(self):
        first = self._history()[0]
        self.assertEqual((first.event, first.to_department, first.done_by), ("Asset Added", "Projects", "Administrator"))

    def test_new_asset_needs_a_department(self):
        with self.assertRaises(frappe.ValidationError):
            frappe.get_doc({
                "doctype": "Asset Master", "asset_name": "No dept", "asset_category": self.category,
            }).insert(ignore_permissions=True)

    # -- assigning ------------------------------------------------------------------------------

    def test_same_department_assigns_without_reason(self):
        self._assign(self.pm)
        self.assertEqual(self._asset("current_assignee"), self.pm)
        self.assertEqual(self._asset("department"), "Projects")
        row = self._history()[-1]
        self.assertEqual((row.event, row.assigned_to), ("Assigned", self.pm))
        self.assertFalse(row.from_department or row.to_department or row.reason)

    def test_other_department_needs_a_reason(self):
        with self.assertRaises(frappe.ValidationError):
            self._assign(self.accountant)
        with self.assertRaises(frappe.ValidationError):
            self._assign(self.accountant, reason="too short")
        self.assertFalse(self._asset("current_assignee"))
        self.assertEqual(self._asset("department"), "Projects")

    def test_other_department_with_reason_moves_the_asset(self):
        self._assign(self.accountant, reason="  Moved to the accounts team  ")
        self.assertEqual(self._asset("department"), "Accounts")
        row = self._history()[-1]
        self.assertEqual(
            (row.event, row.from_department, row.to_department, row.reason),
            ("Assigned", "Projects", "Accounts", "Moved to the accounts team"),
        )

    def test_reason_is_dropped_when_nothing_moves(self):
        self._assign(self.pm, reason="no move happens here")
        self.assertFalse(self._history()[-1].reason)

    def test_assignment_record_has_no_reason_field(self):
        # Owner, 2026-10-12: the reason lives only in the asset's history, not on Asset Management.
        self.assertFalse(frappe.get_meta("Asset Management").has_field("department_change_reason"))

    # -- the assign endpoint --------------------------------------------------------------------

    def test_assign_endpoint_moves_department_and_logs_reason(self):
        # This suite's asset is an IT asset, which takes no project (owner, 2026-10-15): booking a Won project
        # on a Project asset is tested in api/assets/test_assign_access.
        with patch("frappe.db.commit"):  # keep everything inside this test's rollback
            result = assign_asset(
                self.asset, self.accountant, frappe.utils.today(),
                department_change_reason="Moved to the accounts team",
            )
        self.assertEqual(result["department"], "Accounts")
        self.assertEqual(self._asset("current_assignee"), self.accountant)
        row = self._history()[-1]
        self.assertEqual((row.event, row.from_department, row.to_department, row.reason),
                         ("Assigned", "Projects", "Accounts", "Moved to the accounts team"))

    def test_assign_endpoint_refuses_a_move_without_reason(self):
        with patch("frappe.db.commit"):
            with self.assertRaises(frappe.ValidationError):
                assign_asset(self.asset, self.accountant, frappe.utils.today())
        self.assertFalse(frappe.db.exists("Asset Management", {"asset": self.asset}))
        self.assertEqual(self._asset("department"), "Projects")

    def test_assign_endpoint_needs_create_permission(self):
        frappe.set_user(self.no_dept)  # a bare user with no roles
        with patch("frappe.db.commit"):
            with self.assertRaises(frappe.PermissionError):
                assign_asset(self.asset, self.pm, frappe.utils.today())

    def test_person_without_department_leaves_the_asset_where_it_is(self):
        self._assign(self.no_dept)
        self.assertEqual(self._asset("department"), "Projects")

    def test_asset_without_department_takes_the_persons_without_a_reason(self):
        frappe.db.set_value("Asset Master", self.asset, "department", None)
        self._assign(self.accountant)
        self.assertEqual(self._asset("department"), "Accounts")
        row = self._history()[-1]
        self.assertEqual((row.from_department, row.to_department), (None, "Accounts"))

    def test_second_assignment_is_refused(self):
        self._assign(self.pm)
        with self.assertRaises(frappe.ValidationError):
            self._assign(self.no_dept)
        self.assertEqual(self._asset("current_assignee"), self.pm)

    # -- declarations ---------------------------------------------------------------------------

    def test_declaration_with_the_assignment_is_logged(self):
        url = FAKE_FILE_URL.format("with-assign", "with-assign")
        self._assign(self.pm, declaration=url)
        events = [(r.event, r.declaration) for r in self._history()]
        self.assertIn(("Declaration Uploaded", url), events)
        self.assertEqual([e for e, _ in events].count("Declaration Uploaded"), 1)

    def test_declaration_uploaded_later_is_logged(self):
        assignment = self._assign(self.pm)
        url = FAKE_FILE_URL.format("later", "later")
        assignment.asset_declaration_attachment = url
        assignment.save(ignore_permissions=True)
        row = self._history()[-1]
        self.assertEqual((row.event, row.declaration, row.assigned_to), ("Declaration Uploaded", url, self.pm))

    # -- received (owner, 2026-10-13; moved here from test_returns when returns were removed) ------

    def _received(self, assignment):
        return frappe.db.get_value("Asset Management", assignment, ["received", "received_on"], as_dict=True)

    def test_a_declaration_with_the_assignment_marks_it_received_today(self):
        assignment = self._assign(self.pm, declaration=FAKE_FILE_URL.format("rcv-now", "rcv-now"))
        row = self._received(assignment.name)
        self.assertEqual((row.received, str(row.received_on)), (1, frappe.utils.today()))

    def test_without_a_declaration_it_is_not_received(self):
        assignment = self._assign(self.pm)
        self.assertEqual(self._received(assignment.name).received, 0)

    def test_an_uploaded_declaration_marks_it_received(self):
        assignment = self._assign(self.pm)
        assignment.asset_declaration_attachment = FAKE_FILE_URL.format("rcv-later", "rcv-later")
        assignment.save(ignore_permissions=True)
        self.assertEqual(self._received(assignment.name).received, 1)

    def test_an_old_signed_assignment_is_not_dated_by_a_later_save(self):
        """Signed before the field existed: a later, unrelated save must not stamp today's date on it."""
        assignment = self._assign(self.pm, declaration=FAKE_FILE_URL.format("rcv-old", "rcv-old"))
        frappe.db.set_value("Asset Management", assignment.name, {"received": 0, "received_on": None})
        frappe.get_doc("Asset Management", assignment.name).save(ignore_permissions=True)
        self.assertEqual((self._received(assignment.name).received, self._received(assignment.name).received_on), (0, None))

    # -- unassigning ----------------------------------------------------------------------------

    def test_unassign_logs_frees_the_asset_and_keeps_the_declaration_file(self):
        frappe.db.set_value("Asset Master", self.asset, {"project": None})
        assignment = self._assign(self.pm)
        url = FAKE_FILE_URL.format("keep", "keep")
        file_doc = frappe.new_doc("File")
        file_doc.update({
            "name": f"zzd-file-{frappe.generate_hash(length=8)}", "file_name": "keep.pdf", "file_url": url,
            "is_private": 1, "attached_to_doctype": "Asset Management", "attached_to_name": assignment.name,
            "attached_to_field": "asset_declaration_attachment",
        })
        file_doc.db_insert()

        frappe.delete_doc("Asset Management", assignment.name, ignore_permissions=True, flags={"unassign_reason": "Returned – no longer needed"}, delete_permanently=True)

        self.assertFalse(self._asset("current_assignee"))
        self.assertEqual(self._asset("department"), "Projects")
        row = self._history()[-1]
        self.assertEqual((row.event, row.assigned_to, row.done_by), ("Unassigned", self.pm, "Administrator"))
        moved = frappe.db.get_value("File", file_doc.name, ["attached_to_doctype", "attached_to_name"], as_dict=True)
        self.assertIsNotNone(moved, "the declaration file was deleted with the assignment")
        self.assertEqual((moved.attached_to_doctype, moved.attached_to_name), ("Asset Master", self.asset))

    def test_the_person_on_an_assignment_cannot_be_changed(self):
        """Desk / API: handing the asset over by editing the row would skip every rule and the history."""
        assignment = self._assign(self.pm)
        history_before = len(self._history())
        assignment.asset_assigned_to = self.accountant
        with self.assertRaisesRegex(frappe.ValidationError, "unassign it first"):
            assignment.save(ignore_permissions=True)
        self.assertEqual(self._asset("current_assignee"), self.pm)
        self.assertEqual(len(self._history()), history_before)

    def test_the_asset_on_an_assignment_cannot_be_changed(self):
        assignment = self._assign(self.pm)
        assignment.asset = self._new_asset("Projects")
        with self.assertRaisesRegex(frappe.ValidationError, "can't be changed"):
            assignment.save(ignore_permissions=True)

    def test_unassign_clears_the_holder_project_city_and_state(self):
        """What the Unassign buttons rely on: deleting the holder's row is the whole unassign."""
        assignment = self._assign(self.pm)
        frappe.db.set_value(
            "Asset Master", self.asset, {"project": "ZZD fake project", "asset_city": "Pune", "asset_state": "MH"}
        )
        frappe.delete_doc("Asset Management", assignment.name, ignore_permissions=True, flags={"unassign_reason": "Returned – no longer needed"}, delete_permanently=True)
        self.assertEqual(
            [self._asset(f) for f in ("current_assignee", "project", "asset_city", "asset_state")], [None] * 4
        )

    # -- unassigning says why (owner, 2026-10-13) ------------------------------------------------

    def test_unassign_needs_a_valid_reason(self):
        self._assign(self.pm)
        with self.assertRaisesRegex(frappe.ValidationError, "Choose why"):
            unassign_asset(self.asset, "")
        with self.assertRaisesRegex(frappe.ValidationError, "Choose why"):
            unassign_asset(self.asset, "aaaaaaaaaa")
        with self.assertRaisesRegex(frappe.ValidationError, "at least 10"):
            unassign_asset(self.asset, "Other", "short")
        self.assertEqual(self._asset("current_assignee"), self.pm)

    def test_unassign_keeps_the_reason_on_the_history_row(self):
        self._assign(self.pm)
        frappe.db.set_value("Asset Master", self.asset, "project", "ZZD fake project")
        unassign_asset(self.asset, "Employee left / exit", "returned on the last day")
        self.assertFalse(self._asset("current_assignee"))
        self.assertFalse(self._asset("project"))
        row = self._history()[-1]
        self.assertEqual(
            (row.event, row.assigned_to, row.reason),
            ("Unassigned", self.pm, "Employee left / exit — returned on the last day"),
        )

    def test_a_delete_without_a_reason_is_refused(self):
        """Desk / API: deleting the assignment directly carries no reason."""
        assignment = self._assign(self.pm)
        history_before = len(self._history())
        with self.assertRaisesRegex(frappe.ValidationError, "Give a reason for unassigning"):
            frappe.delete_doc("Asset Management", assignment.name, ignore_permissions=True)
        self.assertEqual(self._asset("current_assignee"), self.pm)
        self.assertEqual(len(self._history()), history_before)

    def test_a_holder_without_an_assignment_row_is_freed_with_the_reason(self):
        frappe.db.set_value("Asset Master", self.asset, "current_assignee", self.pm)  # no row
        unassign_asset(self.asset, "Lost or stolen")
        self.assertFalse(self._asset("current_assignee"))
        row = self._history()[-1]
        self.assertEqual((row.event, row.assigned_to, row.reason), ("Unassigned", self.pm, "Lost or stolen"))

    def test_unassigning_a_leftover_row_keeps_the_real_holder(self):
        self._assign(self.pm)
        leftover = self._leftover(self.no_dept)
        unassign_asset(self.asset, "Returned – no longer needed", assignment=leftover)
        self.assertFalse(frappe.db.exists("Asset Management", leftover))
        self.assertEqual(self._asset("current_assignee"), self.pm)

    def test_an_assignment_of_another_asset_is_refused(self):
        other = self._new_asset("Projects")
        row = self._assign(self.pm, asset=other).name
        with self.assertRaisesRegex(frappe.ValidationError, "not for"):
            unassign_asset(self.asset, "Lost or stolen", assignment=row)

    def test_removing_an_old_duplicate_keeps_the_real_holder(self):
        stale = self._assign(self.pm)
        # An older duplicate, as ASSET-LAP-029 has today: inserted raw, past the one-holder rule.
        current = frappe.new_doc("Asset Management")
        current.update({
            "name": f"zzd-dup-{frappe.generate_hash(length=8)}", "asset": self.asset,
            "asset_assigned_to": self.no_dept, "asset_assigned_on": frappe.utils.today(),
        })
        current.db_insert()
        frappe.db.set_value("Asset Master", self.asset, "current_assignee", self.no_dept)

        frappe.delete_doc("Asset Management", stale.name, ignore_permissions=True, flags={"unassign_reason": "Returned – no longer needed"}, delete_permanently=True)
        self.assertEqual(self._asset("current_assignee"), self.no_dept)

    def test_assign_and_unassign_tell_open_asset_pages(self):
        def asset_updates(publish):
            return [
                c for c in publish.call_args_list
                if c.args[0] == "doc_update" and c.kwargs.get("doctype") == "Asset Master"
                and c.kwargs.get("docname") == self.asset
            ]

        with patch("frappe.publish_realtime") as publish:
            assignment = self._assign(self.pm)
            self.assertTrue(asset_updates(publish), "Assign sent no update for the asset")
            publish.reset_mock()
            frappe.delete_doc("Asset Management", assignment.name, ignore_permissions=True, flags={"unassign_reason": "Returned – no longer needed"}, delete_permanently=True)
            self.assertTrue(asset_updates(publish), "Unassign sent no update for the asset")

    # -- leftover assignment rows (ASSET-LAP-029) -----------------------------------------------

    def _leftover(self, person, asset=None):
        """An old row nobody removed, inserted raw past the rules, as ASSET-LAP-029 has today."""
        row = frappe.new_doc("Asset Management")
        row.update({
            "name": f"zzd-left-{frappe.generate_hash(length=8)}", "asset": asset or self.asset,
            "asset_assigned_to": person, "asset_assigned_on": "2025-01-01",
        })
        row.db_insert()
        return row.name

    def test_leftover_row_does_not_block_a_free_asset(self):
        self._leftover(self.no_dept)
        self._assign(self.pm)
        self.assertEqual(self._asset("current_assignee"), self.pm)

    def test_the_current_holder_still_blocks_with_a_leftover_present(self):
        self._assign(self.pm)
        self._leftover(self.no_dept)
        with self.assertRaisesRegex(frappe.ValidationError, "already assigned to ZZD pm"):
            self._assign(self.accountant)

    def test_cleanup_removes_only_the_leftover_and_keeps_its_file(self):
        holder_row = self._assign(self.pm).name
        leftover = self._leftover(self.no_dept)
        url = FAKE_FILE_URL.format("leftover", "leftover")
        file_doc = frappe.new_doc("File")
        file_doc.update({
            "name": f"zzd-file-{frappe.generate_hash(length=8)}", "file_name": "leftover.pdf", "file_url": url,
            "is_private": 1, "attached_to_doctype": "Asset Management", "attached_to_name": leftover,
        })
        file_doc.db_insert()
        history_before = len(self._history())

        leftovers, _, _ = find_leftovers()
        mine = [row for row in leftovers if row.asset == self.asset]
        self.assertEqual([row.name for row in mine], [leftover])
        remove_leftover(mine[0])

        self.assertFalse(frappe.db.exists("Asset Management", leftover))
        self.assertTrue(frappe.db.exists("Asset Management", holder_row))
        self.assertEqual(self._asset("current_assignee"), self.pm)
        self.assertEqual(len(self._history()), history_before)  # setup, not an event: no history row
        moved = frappe.db.get_value("File", file_doc.name, ["attached_to_doctype", "attached_to_name"], as_dict=True)
        self.assertEqual((moved.attached_to_doctype, moved.attached_to_name), ("Asset Master", self.asset))

    def test_cleanup_removes_a_row_on_a_free_asset(self):
        # localhost today: Bhavani unassigned, Sharook's leftover still on the free asset
        row = self._leftover(self.no_dept)
        leftovers, unclear_rows, _ = find_leftovers()
        self.assertIn(row, [r.name for r in leftovers])
        self.assertNotIn(row, [r.name for r in unclear_rows])

    def test_cleanup_only_reports_a_row_when_the_holder_has_none(self):
        frappe.db.set_value("Asset Master", self.asset, "current_assignee", self.pm)  # a holder with no row
        row = self._leftover(self.no_dept)
        leftovers, unclear_rows, holders_without_row = find_leftovers()
        self.assertNotIn(row, [r.name for r in leftovers])
        self.assertIn(row, [r.name for r in unclear_rows])
        self.assertIn(self.asset, [h.asset for h in holders_without_row])

    # -- editing the asset's department ---------------------------------------------------------

    def test_never_assigned_asset_department_can_be_fixed_in_edit(self):
        doc = frappe.get_doc("Asset Master", self.asset)
        doc.department = "Design"
        doc.save(ignore_permissions=True)
        row = self._history()[-1]
        self.assertEqual((row.event, row.from_department, row.to_department), ("Department Set", "Projects", "Design"))

    def test_edit_cannot_clear_the_department(self):
        """Even on a never-assigned asset: every asset belongs to a department, as Add Asset requires."""
        doc = frappe.get_doc("Asset Master", self.asset)
        doc.department = None
        with self.assertRaisesRegex(frappe.ValidationError, "must belong to a department"):
            doc.save(ignore_permissions=True)
        self.assertEqual(self._asset("department"), "Projects")

    def test_assigned_asset_department_cannot_be_moved_in_edit(self):
        self._assign(self.pm)
        doc = frappe.get_doc("Asset Master", self.asset)
        doc.department = "Design"
        with self.assertRaises(frappe.ValidationError):
            doc.save(ignore_permissions=True)

    def test_empty_department_can_be_filled_even_after_assignment(self):
        self._assign(self.no_dept)
        frappe.db.set_value("Asset Master", self.asset, "department", None)
        doc = frappe.get_doc("Asset Master", self.asset)
        doc.department = "Sales"
        doc.save(ignore_permissions=True)
        self.assertEqual(self._asset("department"), "Sales")

    # -- the history is append-only -------------------------------------------------------------

    def test_ordinary_save_passes_with_history_present(self):
        self._assign(self.pm)
        doc = frappe.get_doc("Asset Master", self.asset)
        # Desk posts the rows back with dates as strings; that must not read as an edit.
        for row in doc.asset_history:
            row.done_on = str(row.done_on)
        doc.asset_condition = "Good"
        doc.save(ignore_permissions=True)

    def test_history_rows_cannot_be_edited_or_removed(self):
        self._assign(self.pm)
        doc = frappe.get_doc("Asset Master", self.asset)
        doc.asset_history[0].reason = "rewritten"
        with self.assertRaises(frappe.ValidationError):
            doc.save(ignore_permissions=True)

        doc = frappe.get_doc("Asset Master", self.asset)
        doc.set("asset_history", [])
        with self.assertRaises(frappe.ValidationError):
            doc.save(ignore_permissions=True)

    # -- a person's department ------------------------------------------------------------------

    def test_only_admin_or_hr_can_change_a_department(self):
        person = _make_person("self", PM, "Projects")
        self.people.append(person)
        frappe.set_user(person)
        doc = frappe.get_doc("Nirmaan Users", person)
        doc.department = "Accounts"
        with self.assertRaises(frappe.PermissionError):
            doc.save(ignore_permissions=True)

        frappe.set_user(self.hr)
        doc = frappe.get_doc("Nirmaan Users", person)
        doc.department = "Accounts"
        doc.save(ignore_permissions=True)
        self.assertEqual(frappe.db.get_value("Nirmaan Users", person, "department"), "Accounts")

    def test_a_persons_department_can_be_changed_but_not_removed(self):
        person = _make_person("keep", PM, "Projects")
        self.people.append(person)
        frappe.set_user(self.hr)
        doc = frappe.get_doc("Nirmaan Users", person)
        doc.department = None
        with self.assertRaisesRegex(frappe.ValidationError, "can't be removed"):
            doc.save(ignore_permissions=True)
        self.assertEqual(frappe.db.get_value("Nirmaan Users", person, "department"), "Projects")

    def test_first_department_fills_held_assets_and_a_later_change_moves_nothing(self):
        person = _make_person("holder", PM)
        self.people.append(person)
        frappe.db.set_value("Asset Master", self.asset, "department", None)
        self._assign(person)
        self.assertFalse(self._asset("department"))

        frappe.set_user(self.hr)
        doc = frappe.get_doc("Nirmaan Users", person)
        doc.department = "Design"
        doc.save(ignore_permissions=True)
        self.assertEqual(self._asset("department"), "Design")
        row = self._history()[-1]
        self.assertEqual(
            (row.event, row.assigned_to, row.to_department, row.done_by), ("Department Set", person, "Design", self.hr)
        )

        doc = frappe.get_doc("Nirmaan Users", person)
        doc.department = "Sales"
        doc.save(ignore_permissions=True)
        self.assertEqual(self._asset("department"), "Design")

    def test_create_user_refuses_a_department_from_non_hr_before_creating(self):
        frappe.set_user(self.pm)
        email = f"zzd-new-{frappe.generate_hash(length=6)}@example.com"
        with self.assertRaises(frappe.PermissionError):
            create_user(first_name="ZZD New", email=email, department="Projects")
        self.assertFalse(frappe.db.exists("User", email))

    # -- the department list (Nirmaan Department) -----------------------------------------------

    def _switched_off_department(self):
        name = f"ZZD Off {frappe.generate_hash(length=6)}"
        frappe.get_doc({"doctype": "Nirmaan Department", "department_name": name, "is_active": 0}).insert(
            ignore_permissions=True
        )
        self.departments.append(name)
        return name

    def test_switched_off_department_cannot_be_given(self):
        off = self._switched_off_department()
        person = _make_person("off", PM)
        self.people.append(person)
        frappe.set_user(self.hr)
        doc = frappe.get_doc("Nirmaan Users", person)
        doc.department = off
        with self.assertRaises(frappe.ValidationError):
            doc.save(ignore_permissions=True)

        frappe.set_user("Administrator")
        with self.assertRaises(frappe.ValidationError):
            frappe.get_doc({
                "doctype": "Asset Master", "asset_name": "Off dept", "asset_category": self.category, "department": off,
            }).insert(ignore_permissions=True)

    def test_unknown_department_is_refused(self):
        with self.assertRaises(frappe.ValidationError):
            frappe.get_doc({
                "doctype": "Asset Master", "asset_name": "Unknown dept", "asset_category": self.category,
                "department": "No Such Department",
            }).insert(ignore_permissions=True)

    def test_a_typed_department_name_is_tidied_before_it_names_the_record(self):
        tag = frappe.generate_hash(length=6)
        doc = frappe.get_doc(
            {"doctype": "Nirmaan Department", "department_name": f"  ZZD  Spaced   {tag} "}
        ).insert(ignore_permissions=True)
        self.departments.append(doc.name)
        self.assertEqual((doc.name, doc.department_name), (f"ZZD Spaced {tag}", f"ZZD Spaced {tag}"))

    def test_only_admin_and_hr_manage_the_department_list(self):
        name = f"ZZD New {frappe.generate_hash(length=6)}"
        frappe.set_user(self.pm)
        with self.assertRaises(frappe.PermissionError):
            frappe.get_doc({"doctype": "Nirmaan Department", "department_name": name}).insert(ignore_permissions=True)

        frappe.set_user(self.hr)
        frappe.get_doc({"doctype": "Nirmaan Department", "department_name": name}).insert(ignore_permissions=True)
        self.departments.append(name)

        frappe.set_user(self.pm)
        with self.assertRaises(frappe.PermissionError):
            rename_doc(doctype="Nirmaan Department", old=name, new=f"{name} 2", ignore_permissions=True)
        with self.assertRaises(frappe.PermissionError):
            frappe.delete_doc("Nirmaan Department", name, ignore_permissions=True)

    def test_renaming_a_department_moves_its_people_and_assets(self):
        name = f"ZZD Ren {frappe.generate_hash(length=6)}"
        frappe.get_doc({"doctype": "Nirmaan Department", "department_name": name}).insert(ignore_permissions=True)
        asset = self._new_asset(name)
        frappe.set_user(self.hr)
        new_name = rename_doc(doctype="Nirmaan Department", old=name, new=f"{name} Site", ignore_permissions=True)
        self.departments.extend([name, new_name])
        self.assertEqual(self._asset("department", asset), new_name)
        self.assertEqual(frappe.db.get_value("Nirmaan Department", new_name, "department_name"), new_name)
