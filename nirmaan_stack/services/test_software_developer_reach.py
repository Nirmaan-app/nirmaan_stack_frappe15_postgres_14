# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""ADR-0051 decision 4: a Software Developer is answered exactly as an Admin, at every check that picks who may
act and who gets work or a message. Each test asks one check the same question for a made-up Admin and a made-up
developer and expects one answer, and a different one for a made-up Accountant where the check is Admin-only.

Run: DEVENV test --module nirmaan_stack.services.test_software_developer_reach
"""

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.expense_requests import access
from nirmaan_stack.api.reminders.read import _my_schedule_names
from nirmaan_stack.integrations.controllers.test_nirmaan_users import make_user, remove_user
from nirmaan_stack.integrations.Notifications.pr_notifications import get_admin_users
from nirmaan_stack.services import expense_request_routing as routing
from nirmaan_stack.services.approval_raiser import raiser_level
from nirmaan_stack.services.approval_tiers import RAISER_L1
from nirmaan_stack.services.role_profiles import (
    ACCOUNTANT_PROFILE,
    ADMIN_PROFILE,
    DEVELOPER_PROFILE,
    is_developer,
    is_nirmaan_admin,
)

ADMIN = "sdr-admin@example.com"
DEV = "sdr-dev@example.com"
ACC = "sdr-acc@example.com"
PM = "sdr-pm@example.com"
PM_PROFILE = "Nirmaan Project Manager Profile"
# Where a wrongly allowed rename would move DEV; removed in teardown too.
RENAMED = "sdr-dev-renamed@example.com"


class SoftwareDeveloperReachCase(FrappeTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        for email, profile in ((ADMIN, ADMIN_PROFILE), (DEV, DEVELOPER_PROFILE),
                               (ACC, ACCOUNTANT_PROFILE), (PM, PM_PROFILE)):
            make_user(email, profile)
        frappe.db.commit()

    @classmethod
    def tearDownClass(cls):
        for email in (ADMIN, DEV, ACC, PM, RENAMED):
            remove_user(email)
        super().tearDownClass()

    def tearDown(self):
        frappe.set_user("Administrator")
        frappe.db.rollback()
        routing.clear_cache()


class TestTheDeveloperCountsAsAdmin(SoftwareDeveloperReachCase):
    def test_the_admin_check_names_the_developer(self):
        for user, allowed in ((ADMIN, True), (DEV, True), (ACC, False)):
            with self.subTest(user=user):
                self.assertEqual(is_nirmaan_admin(user) or is_developer(user), allowed)
        self.assertFalse(is_nirmaan_admin(DEV), "is_nirmaan_admin is Admin alone; the developer is named beside it")
        self.assertFalse(is_developer(ADMIN))
        self.assertFalse(is_developer("Administrator"))

    def test_admin_push_notifications_reach_developers(self):
        names = {u["name"] for u in get_admin_users()}
        self.assertIn(ADMIN, names)
        self.assertIn(DEV, names)
        self.assertNotIn(ACC, names)

    def test_a_developers_own_expense_is_raised_at_l1(self):
        self.assertEqual(raiser_level(ADMIN), RAISER_L1)
        self.assertEqual(raiser_level(DEV), RAISER_L1)
        self.assertIsNone(raiser_level(ACC))


class TestExpenseRequestsTreatTheDeveloperAsAdmin(SoftwareDeveloperReachCase):
    def test_a_developer_reviews_a_request_of_a_type_with_no_reviewer_of_its_own(self):
        request = frappe._dict(owner=PM, type=routing.requestable_types()[0])
        for user, profile in ((ADMIN, ADMIN_PROFILE), (DEV, DEVELOPER_PROFILE)):
            with self.subTest(user=user):
                self.assertTrue(access.may_review(request, user, profile, PM_PROFILE))
        self.assertEqual(routing.types_reviewed_by(DEVELOPER_PROFILE),
                         routing.types_reviewed_by(ADMIN_PROFILE))

    def test_a_developer_sees_every_type_and_records_without_review(self):
        expense_type = routing.requestable_types()[0]
        self.assertTrue(access.can_request_type(expense_type, DEV))
        self.assertTrue(access.records_without_review(DEV))
        self.assertTrue(access.reviews_requests(DEVELOPER_PROFILE))
        self.assertEqual(access.get_permission_query_conditions(DEV), "")


class TestRenamingUsers(SoftwareDeveloperReachCase):
    def test_a_developer_passes_the_admin_gate(self):
        from nirmaan_stack.api.users import rename_user_email

        frappe.set_user(DEV)
        # Past the admin gate, the next refusal is renaming one's own email.
        with self.assertRaisesRegex(frappe.ValidationError, "your own email"):
            rename_user_email(DEV, RENAMED)

    def test_a_developer_account_cannot_be_renamed(self):
        from nirmaan_stack.api.users import rename_user_email

        frappe.set_user(ADMIN)
        with self.assertRaisesRegex(frappe.ValidationError, "Cannot rename admin users"):
            rename_user_email(DEV, RENAMED)


class TestRemindersOfTheAdminProfileReachDevelopers(SoftwareDeveloperReachCase):
    def setUp(self):
        self.schedule = frappe.get_doc({
            "doctype": "Reminder Schedule",
            "title": f"sdr reminder {frappe.generate_hash(length=6)}",
            "enabled": 1,
            "role_profiles": [{"role_profile": ADMIN_PROFILE}],
            "schedule_type": "Monthly",
            "due_day": 5,
        }).insert(ignore_permissions=True)

    def test_a_developer_sees_the_schedules_that_target_admin(self):
        self.assertIn(self.schedule.name, _my_schedule_names(ADMIN))
        self.assertIn(self.schedule.name, _my_schedule_names(DEV))
        self.assertNotIn(self.schedule.name, _my_schedule_names(ACC))

    def test_an_admin_does_not_see_a_schedule_that_targets_only_developers(self):
        """ADR-0051 widens the developer's reminders, not Admin's: Admin behaves as before (decision 7)."""
        own = frappe.get_doc({
            "doctype": "Reminder Schedule",
            "title": f"sdr dev reminder {frappe.generate_hash(length=6)}",
            "enabled": 1,
            "role_profiles": [{"role_profile": DEVELOPER_PROFILE}],
            "schedule_type": "Monthly",
            "due_day": 5,
        }).insert(ignore_permissions=True)
        self.assertIn(own.name, _my_schedule_names(DEV))
        self.assertNotIn(own.name, _my_schedule_names(ADMIN))


class TestTdsApprovalTreatsTheDeveloperAsAdmin(SoftwareDeveloperReachCase):
    """`api/tds/approve._require_admin` once held `is_nirmaan_admin` under a local alias; it must still admit the
    developer now that `is_nirmaan_admin` is Admin alone."""

    def test_a_developer_passes_the_tds_approval_gate(self):
        from nirmaan_stack.api.tds.approve import _require_admin

        for user in (ADMIN, DEV):
            with self.subTest(user=user):
                frappe.set_user(user)
                _require_admin()
        frappe.set_user(ACC)
        with self.assertRaises(frappe.PermissionError):
            _require_admin()
