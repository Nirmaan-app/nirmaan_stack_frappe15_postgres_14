"""Mark an asset Lost/Damaged and bring it back Found/Repaired (owner, 2026-10-31).

Admin and HR only; a reason of at least 10 characters; marking a held asset unassigns it at once and its open
audit ends with no result; a Lost/Damaged asset can't be assigned and owes no audit; Found/Repaired returns it
to Unassigned, to be assigned again.

The people are bare User + Nirmaan Users rows plus the Role their profile bundles (see test_assign_access), so
the doctype permissions pass and the profile rule is what decides. Nothing commits: every call runs under a
patched `frappe.db.commit`, and the class rolls back and purges its own rows.

Run: bench --site localhost run-tests --module nirmaan_stack.api.assets.test_lost_damaged
"""

import unittest
from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import getdate, today

from nirmaan_stack.api.assets.assign import assign_asset, unassign_asset
from nirmaan_stack.api.assets.lost_damaged import mark_found_repaired, mark_lost_damaged
from nirmaan_stack.nirmaan_stack.doctype.asset_management.test_asset_management import (
    CATEGORY_PREFIX,
    FAKE_FILE_URL,
    _make_person,
    _purge,
    ensure_departments,
)
from nirmaan_stack.services.asset_audit_open import due_assignments
from nirmaan_stack.services.asset_history import (
    ASSET_FOUND_REPAIRED,
    ASSET_LOST_DAMAGED,
    AUDIT_MISSED,
    UNASSIGNED,
)
from nirmaan_stack.services.asset_lost_damaged import (
    MARK,
    RECOVER,
    UNASSIGN_REASON,
    lost_damaged_refusal,
    reason_text,
)
from nirmaan_stack.services.asset_unassign import UNASSIGN_REASONS

LOST = "Stolen from the site vehicle on 29 Oct"
FOUND = "Recovered by the police, working"


class _SerializationFailure(Exception):
    """PostgreSQL's "could not serialize access due to concurrent update"."""

    pgcode = "40001"


class TestLostDamagedRules(unittest.TestCase):
    def test_a_normal_asset_may_be_marked_with_a_reason(self):
        self.assertIsNone(lost_damaged_refusal(MARK, 0, "Screen cracked, sent for repair"))

    def test_any_wording_counts_as_a_reason(self):
        # Q1 (owner, 2026-10-31): what counts as damaged is whatever the reason says.
        self.assertIsNone(lost_damaged_refusal(MARK, 0, "small dent, still not usable"))

    def test_a_short_or_blank_reason_is_refused(self):
        for reason in (None, "", "   ", "lost it", "  123456789  "):
            self.assertEqual(lost_damaged_refusal(MARK, 0, reason), "Give a reason (at least 10 characters).")
            self.assertEqual(lost_damaged_refusal(RECOVER, 1, reason), "Give a reason (at least 10 characters).")

    def test_marking_twice_is_refused(self):
        self.assertEqual(lost_damaged_refusal(MARK, 1, LOST), "This asset is already marked Lost/Damaged.")

    def test_recovering_a_normal_asset_is_refused(self):
        self.assertIn("isn't marked Lost/Damaged", lost_damaged_refusal(RECOVER, 0, FOUND))

    def test_the_reason_is_kept_on_one_line(self):
        self.assertEqual(reason_text("  Stolen\n from   site  "), "Stolen from site")

    def test_the_old_unassign_reasons_stay(self):
        # Q5 (owner, 2026-10-31): a plain unassign with these reasons still works as before.
        self.assertIn("Lost or stolen", UNASSIGN_REASONS)
        self.assertIn("Damaged – sent for repair", UNASSIGN_REASONS)


class TestLostDamaged(FrappeTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        frappe.set_user("Administrator")
        cls.departments = ensure_departments("Projects")
        tag = frappe.generate_hash(length=6)
        cls.category = f"{CATEGORY_PREFIX} Lost {tag}"
        cls.audited = f"{CATEGORY_PREFIX} Lost Audited {tag}"
        frappe.get_doc({"doctype": "Asset Category", "asset_category": cls.category, "category_type": "IT"}).insert(
            ignore_permissions=True
        )
        frappe.get_doc({
            "doctype": "Asset Category", "asset_category": cls.audited, "category_type": "Project", "audit_required": 1,
        }).insert(ignore_permissions=True)
        cls.hr = cls._person("hr", "Nirmaan HR Executive Profile", "Nirmaan HR Executive")
        cls.hr_lead = cls._person("hrlead", "Nirmaan HR Lead Profile", "Nirmaan HR Lead")
        cls.admin = cls._person("admin", "Nirmaan Admin Profile", "System Manager")  # the Role the profile bundles
        cls.pmo = cls._person("pmo", "Nirmaan PMO Executive Profile", "Nirmaan PMO Executive")
        cls.procurement = cls._person("proc", "Nirmaan Procurement Executive Profile", "Nirmaan Procurement Executive")
        cls.holder = _make_person("holder", "Nirmaan Project Manager Profile", "Projects")
        cls.other = _make_person("other", "Nirmaan Project Manager Profile", "Projects")
        cls.people = [cls.hr, cls.hr_lead, cls.admin, cls.pmo, cls.procurement, cls.holder, cls.other]
        cls.assets = []

    @classmethod
    def _person(cls, tag, profile, role):
        """A test person whose profile bundles `role`, so the doctype permissions let them through."""
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
        _purge(cls.category, cls.assets or ["__none__"], cls.people, cls.departments)
        _purge(cls.audited, ["__none__"], ["__none__"])
        super().tearDownClass()

    def setUp(self):
        self._no_commit = patch("frappe.db.commit")
        self._no_commit.start()

    def tearDown(self):
        self._no_commit.stop()
        frappe.set_user("Administrator")

    # -- helpers ------------------------------------------------------------------------------------

    def _asset(self, holder=None, category=None, declaration=False):
        """A free asset, or one held by `holder` (assigned as Administrator, with a declaration if asked)."""
        frappe.set_user("Administrator")
        asset = frappe.get_doc({
            "doctype": "Asset Master", "asset_name": "Lost/Damaged test", "asset_category": category or self.category,
            "department": "Projects",
        }).insert(ignore_permissions=True).name
        self.assets.append(asset)
        if holder:
            frappe.get_doc({
                "doctype": "Asset Management", "asset": asset, "asset_assigned_to": holder,
                "asset_assigned_on": today(),
                "asset_declaration_attachment": FAKE_FILE_URL.format(asset, asset) if declaration else None,
            }).insert(ignore_permissions=True)
        return asset

    def _state(self, asset):
        return frappe.db.get_value("Asset Master", asset, ["lost_damaged", "current_assignee"], as_dict=True)

    def _history(self, asset):
        return frappe.get_all(
            "Asset History",
            filters={"parent": asset, "parenttype": "Asset Master"},
            fields=["event", "assigned_to", "done_by", "reason"],
            order_by="idx asc",
        )

    # -- marking ------------------------------------------------------------------------------------

    def test_hr_marks_a_held_asset_and_it_is_unassigned_at_once(self):
        asset = self._asset(self.holder, declaration=True)
        frappe.db.set_value("Asset Management", {"asset": asset}, {"audit_status": "Pending", "audit_month": "11/2026"})
        frappe.set_user(self.hr)

        result = mark_lost_damaged(asset, "  Stolen from the\nsite vehicle on 29 Oct ")

        self.assertEqual(result, {"asset": asset, "had": self.holder})
        self.assertEqual(self._state(asset), {"lost_damaged": 1, "current_assignee": None})
        self.assertFalse(frappe.db.exists("Asset Management", {"asset": asset}), "the assignment (and its audit) ends")
        last_two = self._history(asset)[-2:]
        self.assertEqual(
            [(r.event, r.assigned_to, r.done_by, r.reason) for r in last_two],
            [
                (UNASSIGNED, self.holder, self.hr, UNASSIGN_REASON),
                (ASSET_LOST_DAMAGED, self.holder, self.hr, "Stolen from the site vehicle on 29 Oct"),
            ],
        )

    def test_the_open_audit_ends_with_no_result(self):
        # Q7 (owner, 2026-10-31): no Audit Missed for a holder whose asset is gone.
        asset = self._asset(self.holder, declaration=True)
        frappe.db.set_value("Asset Management", {"asset": asset}, {"audit_status": "Pending", "audit_month": "11/2026"})
        frappe.set_user(self.hr_lead)
        mark_lost_damaged(asset, LOST)
        self.assertNotIn(AUDIT_MISSED, [r.event for r in self._history(asset)])

    def test_a_free_asset_is_marked_with_nobody_named(self):
        asset = self._asset()
        frappe.set_user(self.hr_lead)
        self.assertEqual(mark_lost_damaged(asset, LOST), {"asset": asset, "had": None})
        rows = self._history(asset)
        self.assertEqual((rows[-1].event, rows[-1].assigned_to), (ASSET_LOST_DAMAGED, None))
        self.assertNotIn(UNASSIGNED, [r.event for r in rows])

    def test_admin_profile_and_administrator_may_mark(self):
        for user in (self.admin, "Administrator"):
            asset = self._asset(self.holder)
            frappe.set_user(user)
            mark_lost_damaged(asset, LOST)
            self.assertEqual(self._state(asset).lost_damaged, 1)

    def test_pmo_procurement_and_the_holder_are_refused(self):
        # Q2 (owner, 2026-10-31): only HR and Admin.
        held = self._asset(self.holder)
        for user in (self.pmo, self.procurement, self.holder):
            frappe.set_user(user)
            with self.assertRaisesRegex(frappe.PermissionError, "Only Admin or HR"):
                mark_lost_damaged(held, LOST)
        self.assertEqual(self._state(held), {"lost_damaged": 0, "current_assignee": self.holder})

        frappe.set_user(self.hr)
        lost = self._asset()
        frappe.set_user(self.hr)
        mark_lost_damaged(lost, LOST)
        for user in (self.pmo, self.procurement, self.holder):
            frappe.set_user(user)
            with self.assertRaisesRegex(frappe.PermissionError, "Only Admin or HR"):
                mark_found_repaired(lost, FOUND)
        self.assertEqual(self._state(lost).lost_damaged, 1)

    def test_a_short_reason_changes_nothing(self):
        asset = self._asset(self.holder)
        frappe.set_user(self.hr)
        with self.assertRaisesRegex(frappe.ValidationError, "at least 10 characters"):
            mark_lost_damaged(asset, "lost it")
        self.assertEqual(self._state(asset), {"lost_damaged": 0, "current_assignee": self.holder})
        self.assertTrue(frappe.db.exists("Asset Management", {"asset": asset}))

    def test_marking_twice_is_refused_and_adds_no_row(self):
        asset = self._asset()
        frappe.set_user(self.hr)
        mark_lost_damaged(asset, LOST)
        rows = len(self._history(asset))
        with self.assertRaisesRegex(frappe.ValidationError, "already marked Lost/Damaged"):
            mark_lost_damaged(asset, LOST)
        self.assertEqual(len(self._history(asset)), rows)

    def test_an_unknown_asset_is_refused(self):
        frappe.set_user(self.hr)
        with self.assertRaises(frappe.DoesNotExistError):
            mark_lost_damaged("ASSET-ZZD-NOPE", LOST)

    def test_a_simultaneous_change_gets_a_plain_message(self):
        asset = self._asset()
        frappe.set_user("Administrator")  # the role check reads nothing for Administrator
        real = frappe.db.get_value

        def lock_fails(*args, **kwargs):
            if kwargs.get("for_update"):
                raise _SerializationFailure()
            return real(*args, **kwargs)

        with patch.object(frappe.db, "get_value", side_effect=lock_fails):
            with self.assertRaisesRegex(frappe.ValidationError, "just changed by someone else"):
                mark_lost_damaged(asset, LOST)

    # -- while Lost/Damaged ----------------------------------------------------------------------------

    def test_a_lost_asset_cannot_be_assigned(self):
        asset = self._asset()
        frappe.set_user(self.hr)
        mark_lost_damaged(asset, LOST)
        for user in (self.hr, self.pmo):
            frappe.set_user(user)
            with self.assertRaisesRegex(frappe.ValidationError, "is marked Lost/Damaged. Admin or HR must mark it Found/Repaired"):
                assign_asset(asset, self.other, today())
        frappe.set_user("Administrator")
        with self.assertRaisesRegex(frappe.ValidationError, "is marked Lost/Damaged"):
            frappe.get_doc({
                "doctype": "Asset Management", "asset": asset, "asset_assigned_to": self.other,
                "asset_assigned_on": today(),
            }).insert(ignore_permissions=True)
        self.assertEqual(self._state(asset), {"lost_damaged": 1, "current_assignee": None})

    def test_a_lost_asset_cannot_be_unassigned(self):
        asset = self._asset(self.holder)
        frappe.set_user(self.hr)
        mark_lost_damaged(asset, LOST)
        with self.assertRaisesRegex(frappe.ValidationError, "not assigned to anyone"):
            unassign_asset(asset, "Returned – no longer needed")

    def test_the_flag_cannot_be_changed_by_a_save(self):
        asset = self._asset()
        frappe.set_user("Administrator")
        doc = frappe.get_doc("Asset Master", asset)
        doc.lost_damaged = 1
        with self.assertRaisesRegex(frappe.ValidationError, "Lost/Damaged can't be changed here"):
            doc.save(ignore_permissions=True)
        with self.assertRaisesRegex(frappe.ValidationError, "Lost/Damaged can't be changed here"):
            frappe.get_doc({
                "doctype": "Asset Master", "asset_name": "born lost", "asset_category": self.category,
                "department": "Projects", "lost_damaged": 1,
            }).insert(ignore_permissions=True)

    def test_a_lost_asset_can_still_be_edited(self):
        # Q8 (owner, 2026-10-31): Edit stays as today.
        asset = self._asset()
        frappe.set_user(self.hr)
        mark_lost_damaged(asset, LOST)
        frappe.set_user("Administrator")
        doc = frappe.get_doc("Asset Master", asset)
        doc.asset_serial_number = "SN-ZZD-1"
        doc.save(ignore_permissions=True)
        self.assertEqual(frappe.db.get_value("Asset Master", asset, "lost_damaged"), 1)

    def test_a_lost_asset_owes_no_audit(self):
        asset = self._asset(self.holder, category=self.audited, declaration=True)
        row = frappe.db.get_value("Asset Management", {"asset": asset}, "name")
        # The declaration opened this month's audit at once; clear it so the row is due again.
        frappe.db.set_value("Asset Management", row, {"audit_status": None, "audit_month": None})
        self.assertEqual([r.name for r in due_assignments(getdate(), assignment=row)], [row])
        # A row left behind on a Lost/Damaged asset (marking normally removes it) is still not audited.
        frappe.db.set_value("Asset Master", asset, "lost_damaged", 1)
        self.assertEqual(due_assignments(getdate(), assignment=row), [])

    # -- bringing it back -----------------------------------------------------------------------------

    def test_found_repaired_returns_it_to_unassigned_and_it_is_assigned_again(self):
        asset = self._asset(self.holder, declaration=True)
        frappe.set_user(self.hr)
        mark_lost_damaged(asset, LOST)
        frappe.set_user(self.hr_lead)
        self.assertEqual(mark_found_repaired(asset, "  Back from the\nservice centre "), {"asset": asset})

        # Q4 (owner, 2026-10-31): nobody holds it -- never handed back to the last holder.
        self.assertEqual(self._state(asset), {"lost_damaged": 0, "current_assignee": None})
        last = self._history(asset)[-1]
        self.assertEqual(
            (last.event, last.assigned_to, last.done_by, last.reason),
            (ASSET_FOUND_REPAIRED, None, self.hr_lead, "Back from the service centre"),
        )

        frappe.set_user(self.pmo)
        assign_asset(asset, self.other, today())
        self.assertEqual(self._state(asset).current_assignee, self.other)
        assignment = frappe.db.get_value("Asset Management", {"asset": asset}, ["asset_assigned_to", "received"], as_dict=True)
        self.assertEqual((assignment.asset_assigned_to, assignment.received), (self.other, 0), "a fresh declaration is owed")

    def test_found_repaired_on_a_normal_asset_is_refused(self):
        asset = self._asset(self.holder)
        frappe.set_user(self.hr)
        with self.assertRaisesRegex(frappe.ValidationError, "isn't marked Lost/Damaged"):
            mark_found_repaired(asset, FOUND)
        self.assertEqual(self._state(asset), {"lost_damaged": 0, "current_assignee": self.holder})

    def test_a_plain_unassign_with_the_old_reason_does_not_mark_it(self):
        # Q5 (owner, 2026-10-31): "Lost or stolen" stays a plain unassign.
        asset = self._asset(self.holder)
        frappe.set_user(self.pmo)
        unassign_asset(asset, "Lost or stolen")
        self.assertEqual(self._state(asset), {"lost_damaged": 0, "current_assignee": None})
