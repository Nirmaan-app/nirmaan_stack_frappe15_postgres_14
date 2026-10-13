"""Receive and return (owner, 2026-10-13).

- A declaration arriving (signed or uploaded) ticks Received with that day's date.
- The holder returns their asset from their profile; it stays assigned until a manager acts.
- Approve (Admin / HR / PMO; procurement for Project assets) unassigns it with the return date.
- Reject (the same people as Approve) clears the return; the person keeps the asset.

People are bare User + Nirmaan Users rows plus the Role their profile bundles, so the doctype's delete
permission passes and the profile rules decide. Nothing commits.

Run: bench --site localhost run-tests --module nirmaan_stack.api.assets.test_returns
"""

from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import today

from nirmaan_stack.api.assets.returns import approve_return, reject_return, request_return
from nirmaan_stack.nirmaan_stack.doctype.asset_management.test_asset_management import (
    CATEGORY_PREFIX,
    FAKE_FILE_URL,
    _make_person,
    _purge,
    ensure_departments,
)


class TestReceiveAndReturn(FrappeTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        frappe.set_user("Administrator")
        cls.departments = ensure_departments("Projects")
        tag = frappe.generate_hash(length=6)
        cls.categories = {}
        for kind in ("Project", "IT"):
            name = f"{CATEGORY_PREFIX} Return {kind} {tag}"
            frappe.get_doc({"doctype": "Asset Category", "asset_category": name, "category_type": kind}).insert(
                ignore_permissions=True
            )
            cls.categories[kind] = name
        cls.holder = _make_person("holder", "Nirmaan Project Manager Profile", "Projects")
        cls.stranger = _make_person("stranger", "Nirmaan Project Manager Profile", "Projects")
        cls.hr = cls._person("hr", "Nirmaan HR Executive Profile", "Nirmaan HR Executive")
        cls.pmo = cls._person("pmo", "Nirmaan PMO Executive Profile", "Nirmaan PMO Executive")
        cls.procurement = cls._person("proc", "Nirmaan Procurement Executive Profile", "Nirmaan Procurement Executive")
        cls.people = [cls.holder, cls.stranger, cls.hr, cls.pmo, cls.procurement]
        cls.assets = []

    @classmethod
    def _person(cls, tag, profile, role):
        email = _make_person(tag, profile, "Projects")
        frappe.get_doc({
            "doctype": "Has Role", "name": frappe.generate_hash(length=10), "parent": email,
            "parenttype": "User", "parentfield": "roles", "role": role,
        }).db_insert()
        frappe.clear_cache(user=email)
        return email

    @classmethod
    def tearDownClass(cls):
        frappe.set_user("Administrator")
        frappe.db.rollback()
        frappe.db.delete("Has Role", {"parent": ["in", cls.people], "parenttype": "User"})
        frappe.db.commit()
        for category in cls.categories.values():
            _purge(category, cls.assets or ["__none__"], cls.people, cls.departments)
        super().tearDownClass()

    def setUp(self):
        self.commit = patch("frappe.db.commit")  # the endpoints commit; keep everything in the rollback
        self.commit.start()

    def tearDown(self):
        self.commit.stop()
        frappe.set_user("Administrator")

    # -- helpers --------------------------------------------------------------------------------

    def _assign(self, kind="Project", declaration=True):
        """A new asset assigned to the holder, with a declaration on file unless told otherwise."""
        frappe.set_user("Administrator")
        asset = frappe.get_doc({
            "doctype": "Asset Master", "asset_name": f"Return test {kind}",
            "asset_category": self.categories[kind], "department": "Projects",
        }).insert(ignore_permissions=True).name
        self.assets.append(asset)
        row = frappe.get_doc({
            "doctype": "Asset Management", "asset": asset, "asset_assigned_to": self.holder,
            "asset_assigned_on": frappe.utils.today(),
            "asset_declaration_attachment": FAKE_FILE_URL.format(asset, asset) if declaration else None,
        }).insert(ignore_permissions=True)
        return asset, row.name

    def _returned(self, kind="Project"):
        asset, assignment = self._assign(kind)
        frappe.set_user(self.holder)
        request_return(assignment)
        return asset, assignment

    def _row(self, assignment):
        return frappe.db.get_value(
            "Asset Management", assignment, ["received", "received_on", "returned", "returned_on"], as_dict=True
        )

    def _events(self, asset):
        return frappe.get_all("Asset History", filters={"parent": asset}, order_by="idx", pluck="event")

    # -- received -------------------------------------------------------------------------------

    def test_a_declaration_with_the_assignment_marks_it_received_today(self):
        _, assignment = self._assign()
        row = self._row(assignment)
        self.assertEqual((row.received, str(row.received_on)), (1, today()))

    def test_without_a_declaration_it_is_not_received(self):
        _, assignment = self._assign(declaration=False)
        self.assertEqual(self._row(assignment).received, 0)

    def test_an_uploaded_declaration_marks_it_received(self):
        asset, assignment = self._assign(declaration=False)
        doc = frappe.get_doc("Asset Management", assignment)
        doc.asset_declaration_attachment = FAKE_FILE_URL.format(asset, "later")
        doc.save(ignore_permissions=True)
        self.assertEqual(self._row(assignment).received, 1)

    def test_an_old_signed_assignment_is_not_dated_by_a_later_save(self):
        """Signed before the field existed: a later save (a return) must not stamp today's date on it."""
        _, assignment = self._assign()
        frappe.db.set_value("Asset Management", assignment, {"received": 0, "received_on": None})
        frappe.set_user(self.holder)
        request_return(assignment)
        self.assertEqual(self._row(assignment).received, 0)

    # -- return ---------------------------------------------------------------------------------

    def test_the_holder_returns_and_the_asset_stays_assigned(self):
        asset, assignment = self._returned()
        row = self._row(assignment)
        self.assertEqual((row.returned, str(row.returned_on)), (1, today()))
        self.assertEqual(frappe.db.get_value("Asset Master", asset, "current_assignee"), self.holder)
        self.assertEqual(self._events(asset)[-1], "Return Requested")

    def test_only_the_holder_can_return(self):
        _, assignment = self._assign()
        frappe.set_user(self.stranger)
        with self.assertRaises(frappe.PermissionError):
            request_return(assignment)
        frappe.set_user(self.hr)  # not even HR: the holder says it
        with self.assertRaises(frappe.PermissionError):
            request_return(assignment)

    def test_a_return_needs_the_declaration_first(self):
        _, assignment = self._assign(declaration=False)
        frappe.set_user(self.holder)
        with self.assertRaisesRegex(frappe.ValidationError, "Sign the declaration"):
            request_return(assignment)

    def test_a_second_return_is_refused(self):
        _, assignment = self._returned()
        with self.assertRaisesRegex(frappe.ValidationError, "already returned"):
            request_return(assignment)

    # -- approve --------------------------------------------------------------------------------

    def test_hr_approves_and_the_asset_is_free(self):
        asset, assignment = self._returned()
        frappe.set_user(self.hr)
        approve_return(assignment)
        self.assertFalse(frappe.db.exists("Asset Management", assignment))
        self.assertIsNone(frappe.db.get_value("Asset Master", asset, "current_assignee"))
        last = frappe.get_all(
            "Asset History", filters={"parent": asset}, order_by="idx desc", limit=1, fields=["event", "reason", "done_by"]
        )[0]
        self.assertEqual((last.event, last.done_by), ("Unassigned", self.hr))
        self.assertTrue(last.reason.startswith("Returned – no longer needed — returned by "))

    def test_pmo_approves(self):
        _, assignment = self._returned(kind="IT")
        frappe.set_user(self.pmo)
        approve_return(assignment)
        self.assertFalse(frappe.db.exists("Asset Management", assignment))

    def test_procurement_approves_project_returns_but_not_it(self):
        _, project_assignment = self._returned(kind="Project")
        _, it_assignment = self._returned(kind="IT")
        frappe.set_user(self.procurement)
        approve_return(project_assignment)
        self.assertFalse(frappe.db.exists("Asset Management", project_assignment))
        with self.assertRaisesRegex(frappe.PermissionError, "Project assets only"):
            approve_return(it_assignment)
        self.assertTrue(frappe.db.exists("Asset Management", it_assignment))

    def test_approve_needs_a_return(self):
        _, assignment = self._assign()
        frappe.set_user(self.hr)
        with self.assertRaisesRegex(frappe.ValidationError, "no return waiting"):
            approve_return(assignment)

    def test_someone_who_cannot_unassign_cannot_approve(self):
        _, assignment = self._returned()
        frappe.set_user(self.stranger)
        with self.assertRaises(frappe.PermissionError):
            approve_return(assignment)

    # -- reject ---------------------------------------------------------------------------------

    def test_pmo_rejects_and_the_person_keeps_the_asset(self):
        asset, assignment = self._returned()
        frappe.set_user(self.pmo)
        reject_return(assignment)
        row = self._row(assignment)
        self.assertEqual((row.returned, row.returned_on), (0, None))
        self.assertEqual(frappe.db.get_value("Asset Master", asset, "current_assignee"), self.holder)
        self.assertEqual(self._events(asset)[-1], "Return Rejected")

    def test_the_person_can_return_again_after_a_rejection(self):
        _, assignment = self._returned()
        frappe.set_user(self.hr)
        reject_return(assignment)
        frappe.set_user(self.holder)
        request_return(assignment)
        self.assertEqual(self._row(assignment).returned, 1)

    def test_procurement_rejects_project_returns_but_not_it(self):
        _, project_assignment = self._returned(kind="Project")
        _, it_assignment = self._returned(kind="IT")
        frappe.set_user(self.procurement)
        reject_return(project_assignment)
        self.assertEqual(self._row(project_assignment).returned, 0)
        with self.assertRaisesRegex(frappe.PermissionError, "Project assets only"):
            reject_return(it_assignment)
        self.assertEqual(self._row(it_assignment).returned, 1)

    def test_someone_who_cannot_unassign_cannot_reject(self):
        _, assignment = self._returned()
        frappe.set_user(self.stranger)
        with self.assertRaises(frappe.PermissionError):
            reject_return(assignment)
        self.assertEqual(self._row(assignment).returned, 1)

    def test_a_return_already_approved_elsewhere_gets_a_plain_message(self):
        _, assignment = self._returned()
        frappe.set_user(self.hr)
        approve_return(assignment)
        with self.assertRaisesRegex(frappe.ValidationError, "already approved"):
            approve_return(assignment)
