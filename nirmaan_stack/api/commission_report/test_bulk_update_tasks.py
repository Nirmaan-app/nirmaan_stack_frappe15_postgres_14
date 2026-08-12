# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Tests for the commission-report bulk task actions.

Run:
    bench --site localhost run-tests --app nirmaan_stack \
        --module nirmaan_stack.api.commission_report.test_bulk_update_tasks

No Projects fixture is needed -- `Project Commission Report.project` is an
optional Link, so a tracker can be built from the child rows alone. That keeps
the suite clear of the legacy `generate_pwm` after_insert hook.
"""

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import getdate

from nirmaan_stack.api.commission_report import editing_lock
from nirmaan_stack.api.commission_report.bulk_update_tasks import (
    bulk_update_tasks,
    has_bulk_access,
    has_bulk_status_access,
)

CHILD_DOCTYPE = "Commission Report Task Child Table"
PARENT_DOCTYPE = "Project Commission Report"

ALL_STATUSES = [
    "Pending",
    "Rejected",
    "Pending Approval",
    "Submitted",
    "Client Accepted",
    "Not Applicable",
]


class TestBulkUpdateTasks(FrappeTestCase):
    def setUp(self):
        super().setUp()
        self.tracker = self._make_tracker(ALL_STATUSES)
        # name -> child row name, keyed by the status it was created with.
        self.rows = {
            task.task_status: task.name for task in self.tracker.commission_report_task
        }

    def tearDown(self):
        for name in getattr(self, "_trackers", []):
            frappe.delete_doc(PARENT_DOCTYPE, name, force=True, ignore_permissions=True)
        frappe.db.commit()
        super().tearDown()

    # ── fixtures ─────────────────────────────────────────────────────────
    def _make_tracker(self, statuses):
        doc = frappe.new_doc(PARENT_DOCTYPE)
        doc.project_name = f"TEST_BULK_{frappe.generate_hash(length=6)}"
        doc.status = "Assign Pending"
        doc.start_date = "2026-01-01"
        for status in statuses:
            doc.append(
                "commission_report_task",
                {
                    "commission_category": "TEST_CATEGORY",
                    "task_name": f"Task {status}",
                    "task_status": status,
                    # A Not Applicable row carries no deadline, by the same rule
                    # the action itself enforces.
                    "deadline": None if status == "Not Applicable" else "2026-06-01",
                    "task_phase": "Handover",
                    "report_type": "Field",
                    # ProjectCommissionReport.validate refuses a Client Accepted
                    # task with no report link / attachment / wizard response.
                    "file_link": "https://example.test/report.pdf"
                    if status == "Client Accepted"
                    else None,
                },
            )
        doc.insert(ignore_permissions=True)
        frappe.db.commit()

        if not hasattr(self, "_trackers"):
            self._trackers = []
        self._trackers.append(doc.name)
        return doc

    def _status_of(self, row_name):
        return frappe.db.get_value(CHILD_DOCTYPE, row_name, "task_status")

    def _deadline_of(self, row_name):
        return frappe.db.get_value(CHILD_DOCTYPE, row_name, "deadline")

    def _reason_for(self, result, row_name):
        for entry in result["skipped"]:
            if entry["name"] == row_name:
                return entry["reason"]
        return None

    # ── mark_not_applicable ──────────────────────────────────────────────
    def test_mark_not_applicable_applies_whatever_the_from_status(self):
        """NO from-status restriction (owner ruling) -- the dialog warns instead."""
        result = bulk_update_tasks(
            tracker=self.tracker.name,
            task_rows=list(self.rows.values()),
            action="mark_not_applicable",
        )

        moved = {s for s in ALL_STATUSES if s != "Not Applicable"}
        self.assertEqual(set(result["updated"]), {self.rows[s] for s in moved})
        for status in moved:
            self.assertEqual(self._status_of(self.rows[status]), "Not Applicable")

        # The ONLY decline: a row already at the target.
        already = self.rows["Not Applicable"]
        self.assertEqual(self._reason_for(result, already), "Already Not Applicable")

    def test_a_client_accepted_report_can_be_marked_not_applicable(self):
        """The deliberate cost of warning rather than refusing."""
        row = self.rows["Client Accepted"]
        bulk_update_tasks(
            tracker=self.tracker.name, task_rows=[row], action="mark_not_applicable"
        )
        self.assertEqual(self._status_of(row), "Not Applicable")
        # Only status + deadline are written; the evidence survives.
        self.assertTrue(frappe.db.get_value(CHILD_DOCTYPE, row, "file_link"))

    def test_mark_not_applicable_wipes_the_deadline(self):
        row = self.rows["Pending"]
        self.assertIsNotNone(self._deadline_of(row))

        bulk_update_tasks(
            tracker=self.tracker.name, task_rows=[row], action="mark_not_applicable"
        )
        self.assertIsNone(self._deadline_of(row))

    def test_only_an_already_at_target_row_is_declined(self):
        result = bulk_update_tasks(
            tracker=self.tracker.name,
            task_rows=[self.rows["Not Applicable"], self.rows["Submitted"]],
            action="mark_not_applicable",
        )
        self.assertEqual(result["updated"], [self.rows["Submitted"]])
        self.assertIn("Already", self._reason_for(result, self.rows["Not Applicable"]))
        self.assertIsNone(self._reason_for(result, self.rows["Submitted"]))

    # ── mark_pending ─────────────────────────────────────────────────────
    def test_mark_pending_applies_whatever_the_from_status(self):
        result = bulk_update_tasks(
            tracker=self.tracker.name,
            task_rows=list(self.rows.values()),
            action="mark_pending",
        )

        moved = {s for s in ALL_STATUSES if s != "Pending"}
        self.assertEqual(set(result["updated"]), {self.rows[s] for s in moved})
        for status in moved:
            self.assertEqual(self._status_of(self.rows[status]), "Pending")

        self.assertEqual(self._reason_for(result, self.rows["Pending"]), "Already Pending")

    def test_mark_pending_restores_a_deadline_ONLY_from_not_applicable(self):
        """A Not Applicable row lost its deadline when marked, so it is recomputed."""
        row = self.rows["Not Applicable"]
        self.assertIsNone(self._deadline_of(row))

        bulk_update_tasks(
            tracker=self.tracker.name, task_rows=[row], action="mark_pending"
        )
        self.assertIsNotNone(self._deadline_of(row))

    def test_mark_pending_never_overwrites_an_existing_deadline(self):
        """A Submitted row still HAS its deadline -- recomputing would clobber it."""
        row = self.rows["Submitted"]
        before = self._deadline_of(row)
        self.assertIsNotNone(before)

        bulk_update_tasks(
            tracker=self.tracker.name, task_rows=[row], action="mark_pending"
        )
        self.assertEqual(self._status_of(row), "Pending")
        self.assertEqual(self._deadline_of(row), before)

    def test_mark_pending_is_the_inverse_of_mark_not_applicable(self):
        row = self.rows["Pending"]
        bulk_update_tasks(
            tracker=self.tracker.name, task_rows=[row], action="mark_not_applicable"
        )
        self.assertEqual(self._status_of(row), "Not Applicable")
        self.assertIsNone(self._deadline_of(row))

        bulk_update_tasks(tracker=self.tracker.name, task_rows=[row], action="mark_pending")
        self.assertEqual(self._status_of(row), "Pending")
        self.assertIsNotNone(self._deadline_of(row))

    # ── approve / reject (the Pending Approval queue) ────────────────────
    def _make_queue_tracker(self):
        """One Field and one Vendor row, both awaiting approval."""
        doc = frappe.new_doc(PARENT_DOCTYPE)
        doc.project_name = f"TEST_QUEUE_{frappe.generate_hash(length=6)}"
        doc.start_date = "2026-01-01"
        for report_type in ("Field", "Vendor"):
            doc.append(
                "commission_report_task",
                {
                    "commission_category": "TEST_CATEGORY",
                    "task_name": f"{report_type} report",
                    "task_status": "Pending Approval",
                    "report_type": report_type,
                    "deadline": "2026-06-01",
                    # A Vendor row's evidence is its uploaded file.
                    "approval_proof": "/files/vendor.pdf" if report_type == "Vendor" else None,
                },
            )
        doc.insert(ignore_permissions=True)
        frappe.db.commit()
        self._trackers.append(doc.name)
        return doc, {t.report_type: t.name for t in doc.commission_report_task}

    def test_approve_sends_field_to_submitted_and_vendor_to_client_accepted(self):
        doc, rows = self._make_queue_tracker()
        result = bulk_update_tasks(
            tracker=doc.name, task_rows=list(rows.values()), action="approve"
        )

        self.assertEqual(set(result["updated"]), set(rows.values()))
        self.assertEqual(self._status_of(rows["Field"]), "Submitted")
        self.assertEqual(self._status_of(rows["Vendor"]), "Client Accepted")
        # The caller cannot report this as one number.
        self.assertEqual(result["updated_by_status"], {"Submitted": 1, "Client Accepted": 1})

    def test_approve_treats_a_blank_report_type_as_field(self):
        doc, rows = self._make_queue_tracker()
        frappe.db.set_value(CHILD_DOCTYPE, rows["Field"], "report_type", "")

        bulk_update_tasks(tracker=doc.name, task_rows=[rows["Field"]], action="approve")
        self.assertEqual(self._status_of(rows["Field"]), "Submitted")

    def test_approve_refuses_a_vendor_row_with_no_file(self):
        """Client Accepted is terminal -- never write it with no artifact behind it."""
        doc, rows = self._make_queue_tracker()
        frappe.db.set_value(CHILD_DOCTYPE, rows["Vendor"], "approval_proof", "")

        result = bulk_update_tasks(
            tracker=doc.name, task_rows=[rows["Vendor"]], action="approve"
        )
        self.assertEqual(result["updated"], [])
        self.assertIn("no uploaded file", self._reason_for(result, rows["Vendor"]))
        self.assertEqual(self._status_of(rows["Vendor"]), "Pending Approval")

    def test_approve_leaves_the_deadline_alone(self):
        doc, rows = self._make_queue_tracker()
        before = self._deadline_of(rows["Field"])

        bulk_update_tasks(tracker=doc.name, task_rows=[rows["Field"]], action="approve")
        self.assertEqual(self._deadline_of(rows["Field"]), before)

    def test_reject_is_uniform_across_both_types(self):
        doc, rows = self._make_queue_tracker()
        result = bulk_update_tasks(
            tracker=doc.name, task_rows=list(rows.values()), action="reject"
        )
        self.assertEqual(set(result["updated"]), set(rows.values()))
        self.assertEqual(result["updated_by_status"], {"Rejected": 2})

    def test_approval_actions_keep_a_from_status_gate(self):
        """UNLIKE the status actions -- approving a non-queued row is meaningless.

        Only the Pending Approval row moves; every other status is refused BY NAME.
        """
        result = bulk_update_tasks(
            tracker=self.tracker.name,
            task_rows=list(self.rows.values()),
            action="reject",
        )
        self.assertEqual(result["updated"], [self.rows["Pending Approval"]])
        self.assertEqual(self._status_of(self.rows["Pending Approval"]), "Rejected")

        for status in ALL_STATUSES:
            if status == "Pending Approval":
                continue
            self.assertIn(
                "Not awaiting approval", self._reason_for(result, self.rows[status]), status
            )
            self.assertEqual(self._status_of(self.rows[status]), status)

    # ── set_deadline ─────────────────────────────────────────────────────
    def test_set_deadline_applies_to_every_status_except_not_applicable(self):
        result = bulk_update_tasks(
            tracker=self.tracker.name,
            task_rows=list(self.rows.values()),
            action="set_deadline",
            deadline="2026-09-15",
        )

        expected = {self.rows[s] for s in ALL_STATUSES if s != "Not Applicable"}
        self.assertEqual(set(result["updated"]), expected)
        for row in expected:
            self.assertEqual(self._deadline_of(row), getdate("2026-09-15"))

        na_row = self.rows["Not Applicable"]
        self.assertIsNone(self._deadline_of(na_row))
        self.assertIn("no deadline", self._reason_for(result, na_row))

    def test_set_deadline_requires_a_date(self):
        with self.assertRaises(frappe.ValidationError):
            bulk_update_tasks(
                tracker=self.tracker.name,
                task_rows=[self.rows["Pending"]],
                action="set_deadline",
            )

    def test_set_deadline_rejects_an_unparseable_date(self):
        with self.assertRaises(frappe.ValidationError):
            bulk_update_tasks(
                tracker=self.tracker.name,
                task_rows=[self.rows["Pending"]],
                action="set_deadline",
                deadline="not-a-date",
            )
        # Nothing was written on the way to the error.
        self.assertEqual(self._deadline_of(self.rows["Pending"]), getdate("2026-06-01"))

    # ── request integrity ────────────────────────────────────────────────
    def test_row_from_another_tracker_is_skipped_not_written(self):
        other = self._make_tracker(["Pending"])
        foreign_row = other.commission_report_task[0].name

        result = bulk_update_tasks(
            tracker=self.tracker.name,
            task_rows=[self.rows["Pending"], foreign_row],
            action="mark_not_applicable",
        )

        self.assertEqual(result["updated"], [self.rows["Pending"]])
        self.assertIn("different commission report", self._reason_for(result, foreign_row))
        self.assertEqual(self._status_of(foreign_row), "Pending")

    def test_missing_row_is_reported_not_thrown(self):
        result = bulk_update_tasks(
            tracker=self.tracker.name,
            task_rows=[self.rows["Pending"], "does-not-exist"],
            action="mark_not_applicable",
        )
        self.assertEqual(result["updated"], [self.rows["Pending"]])
        self.assertIn("no longer exists", self._reason_for(result, "does-not-exist"))

    def test_duplicate_row_names_are_applied_once(self):
        row = self.rows["Pending"]
        result = bulk_update_tasks(
            tracker=self.tracker.name,
            task_rows=[row, row, row],
            action="mark_not_applicable",
        )
        self.assertEqual(result["updated"], [row])

    def test_json_encoded_row_list_is_accepted(self):
        """The JS client posts arrays as a JSON string."""
        result = bulk_update_tasks(
            tracker=self.tracker.name,
            task_rows=frappe.as_json([self.rows["Pending"]]),
            action="mark_not_applicable",
        )
        self.assertEqual(result["updated"], [self.rows["Pending"]])

    def test_unknown_action_throws(self):
        with self.assertRaises(frappe.ValidationError):
            bulk_update_tasks(
                tracker=self.tracker.name,
                task_rows=[self.rows["Pending"]],
                action="delete_everything",
            )
        self.assertEqual(self._status_of(self.rows["Pending"]), "Pending")

    def test_empty_selection_throws(self):
        with self.assertRaises(frappe.ValidationError):
            bulk_update_tasks(
                tracker=self.tracker.name, task_rows=[], action="mark_not_applicable"
            )

    def test_unknown_tracker_throws(self):
        with self.assertRaises(frappe.ValidationError):
            bulk_update_tasks(
                tracker="NO-SUCH-TRACKER",
                task_rows=[self.rows["Pending"]],
                action="mark_not_applicable",
            )

    # ── editing lock ─────────────────────────────────────────────────────
    def test_row_locked_by_another_user_is_skipped(self):
        row = self.rows["Pending"]
        editing_lock._set_lock(
            row,
            {"user": "someone.else@example.com", "user_name": "Someone Else", "timestamp": "x"},
        )
        self.addCleanup(editing_lock._clear_lock, row)

        result = bulk_update_tasks(
            tracker=self.tracker.name, task_rows=[row], action="mark_not_applicable"
        )
        self.assertEqual(result["updated"], [])
        self.assertIn("Someone Else", self._reason_for(result, row))
        self.assertEqual(self._status_of(row), "Pending")

    def test_own_lock_does_not_block(self):
        row = self.rows["Pending"]
        editing_lock._set_lock(
            row,
            {"user": frappe.session.user, "user_name": "Me", "timestamp": "x"},
        )
        self.addCleanup(editing_lock._clear_lock, row)

        result = bulk_update_tasks(
            tracker=self.tracker.name, task_rows=[row], action="mark_not_applicable"
        )
        self.assertEqual(result["updated"], [row])


class TestBulkAccessRule(FrappeTestCase):
    """The access rules are pure, so they need no user fixture.

    The SPLIT mirrors the Design Tracker: the dialog (and the deadline) opens for
    the edit-structure roles; a STATUS change is Admin-only.
    """

    def test_administrator_always_allowed(self):
        self.assertTrue(has_bulk_access("Administrator", None, []))
        self.assertTrue(has_bulk_status_access("Administrator", None, []))

    def test_allowed_by_role_profile(self):
        """ADMIN + PMO only (owner ruling)."""
        self.assertTrue(has_bulk_access("a@b.com", "Nirmaan Admin Profile", []))
        self.assertTrue(has_bulk_access("a@b.com", "Nirmaan PMO Executive Profile", []))

    def test_allowed_by_role(self):
        self.assertTrue(has_bulk_access("a@b.com", None, ["All", "Nirmaan Admin Profile"]))

    def test_design_lead_refused(self):
        """Narrower than the page's hasEditStructureAccess, which carries Design Lead."""
        self.assertFalse(has_bulk_access("a@b.com", "Nirmaan Design Lead Profile", []))
        self.assertFalse(has_bulk_status_access("a@b.com", "Nirmaan Design Lead Profile", []))

    def test_restricted_assignee_roles_refused(self):
        # The two roles the tracker page treats as restricted assignees.
        self.assertFalse(has_bulk_access("a@b.com", "Nirmaan Design Executive Profile", []))
        self.assertFalse(has_bulk_access("a@b.com", "Nirmaan Project Manager Profile", []))

    def test_no_profile_and_no_roles_refused(self):
        self.assertFalse(has_bulk_access("a@b.com", None, []))
        self.assertFalse(has_bulk_access("a@b.com", None, ["All", "Guest"]))

    def test_status_access_is_admin_only(self):
        """PMO may set a deadline but NOT change status."""
        self.assertTrue(has_bulk_access("a@b.com", "Nirmaan PMO Executive Profile", []))
        self.assertFalse(has_bulk_status_access("a@b.com", "Nirmaan PMO Executive Profile", []))

        self.assertTrue(has_bulk_status_access("a@b.com", "Nirmaan Admin Profile", []))
        self.assertTrue(has_bulk_status_access("a@b.com", None, ["Nirmaan Admin Profile"]))

    def test_status_access_never_wider_than_bulk_access(self):
        """Anyone who may change status may also open the dialog."""
        cases = [
            ("Administrator", None, []),
            ("a@b.com", "Nirmaan Admin Profile", []),
            ("a@b.com", "Nirmaan PMO Executive Profile", []),
            ("a@b.com", "Nirmaan Design Lead Profile", []),
            ("a@b.com", "Nirmaan Project Manager Profile", []),
            ("a@b.com", None, []),
        ]
        for user, profile, roles in cases:
            if has_bulk_status_access(user, profile, roles):
                self.assertTrue(has_bulk_access(user, profile, roles), (user, profile))
