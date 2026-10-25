# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and Contributors
# See license.txt

"""Work Order notifications fire on the move into a status, after the save commits (#1533, spec #1528).

Each test acts as a throwaway user of a real role profile and does what that user does: creates the Work
Order the way the wizard saves it, edits it the way the page and Desk save it, amends, approves, rejects,
accepts or reverts it, or finalizes it through `api/sr_finalize.finalize_sr`. Then it reads the Nirmaan
Notifications rows each recipient got (the bell), and for Finalize the realtime event sent.

Run: DEVENV test --module nirmaan_stack.nirmaan_stack.doctype.service_requests.test_work_order_notifications

⚠️ RUNS AGAINST THE SITE DATABASE. Work Orders are planted with the GST Hold fixture (`TEST-GSTH-*`); their
notifications, snapshots and the test users' project permissions are purged after each test. Push is off
in a dev env (`disable_push`), and the throwaway users have no FCM token.
"""

from collections import Counter
from unittest.mock import patch

import frappe

from nirmaan_stack.api.service_requests.amendment import revert_amendment
from nirmaan_stack.api.sr_finalize import finalize_sr
from nirmaan_stack.nirmaan_stack.doctype.service_requests.test_work_order_amendment import (
    NIRMAAN_GST,
    _AmendmentCase,
)
from nirmaan_stack.nirmaan_stack.doctype.service_requests.test_work_order_lifecycle import (
    ADMIN,
    PMO,
    PMO_ONLY_USER,
    PROJECT_LEAD,
    PROJECT_MANAGER,
    SR,
    USERS,
    _drop_user,
    _make_user,
)

#: Service Procurement Executives are a company-wide desk: never put on a project.
SERVICE_PROCUREMENT = "Nirmaan Service Procurement Executive Profile"
SPE_USER = "test-wo-notify-spe@example.com"
#: An Accountant put on another project only: the Work Order's project is not theirs.
ACCOUNTANT_ELSEWHERE = "test-wo-notify-acct-elsewhere@example.com"


class _NotificationCase(_AmendmentCase):
    patch_notifications = False

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        _make_user(SPE_USER, SERVICE_PROCUREMENT, roles=["Nirmaan Procurement Executive"])
        _make_user(ACCOUNTANT_ELSEWHERE, "Nirmaan Accountant Profile", roles=["Nirmaan Accountant"])
        frappe.db.commit()

    @classmethod
    def tearDownClass(cls):
        for email in (SPE_USER, ACCOUNTANT_ELSEWHERE):
            _drop_user(email)
        super().tearDownClass()

    def setUp(self):
        super().setUp()
        self.addCleanup(self._purge_permissions)
        self.creator = USERS[PROJECT_MANAGER]
        self.lead = USERS[PROJECT_LEAD]
        self.admin = USERS[ADMIN]
        self._put_on_project(self.lead)
        self._put_on_project(ACCOUNTANT_ELSEWHERE, project=self.fx.project(), frappe_permission=True)
        self._created_by(self.wo, self.creator)

    def _put_on_project(self, user, project=None, *, frappe_permission=False):
        """Put `user` on `project` the way the app does: its own permission row, which the lead lookups
        read, and, with `frappe_permission`, Frappe's User Permission, which scopes what the user sees."""
        project = project or self.project
        frappe.db.sql(
            """INSERT INTO "tabNirmaan User Permissions" (name, creation, modified, modified_by, owner, docstatus,
                   idx, "user", allow, for_value)
               VALUES (%s, NOW(), NOW(), 'Administrator', 'Administrator', 0, 0, %s, 'Projects', %s)""",
            (f"TEST-WONOTE-NUP-{frappe.generate_hash(length=8)}", user, project),
        )
        if frappe_permission:
            frappe.db.sql(
                """INSERT INTO "tabUser Permission" (name, creation, modified, modified_by, owner, docstatus,
                       idx, "user", allow, for_value, apply_to_all_doctypes)
                   VALUES (%s, NOW(), NOW(), 'Administrator', 'Administrator', 0, 0, %s, 'Projects', %s, 1)""",
                (f"TEST-WONOTE-UP-{frappe.generate_hash(length=8)}", user, project),
            )
        frappe.db.commit()

    def _purge_permissions(self):
        frappe.db.rollback()
        frappe.db.delete("Nirmaan User Permissions", {"name": ("like", "TEST-WONOTE-NUP-%")})
        frappe.db.delete("User Permission", {"name": ("like", "TEST-WONOTE-UP-%")})
        frappe.db.commit()

    def _created_by(self, wo, user):
        frappe.db.sql('UPDATE "tabService Requests" SET owner = %s WHERE name = %s', (user, wo))
        frappe.db.commit()

    def _bell(self, wo=None):
        """(recipient, event) -> how many notification rows the Work Order left."""
        return Counter(
            (n.recipient, n.event_id)
            for n in frappe.get_all("Nirmaan Notifications", {"docname": wo or self.wo},
                                    ["recipient", "event_id"])
        )

    def _events(self, wo=None):
        return {event for _, event in self._bell(wo)}

    def _recipients(self, event, wo=None):
        return {user for user, ev in self._bell(wo) if ev == event}

    def assertOneEach(self, event, wo=None):
        """Each recipient of `event` got it exactly once."""
        counts = [n for (_, ev), n in self._bell(wo).items() if ev == event]
        self.assertTrue(counts, f"no {event} notification")
        self.assertEqual(set(counts), {1})


class TestOnlyTheMoveNotifies(_NotificationCase):
    def test_moving_into_vendor_selected_notifies_the_lead_and_admins_once(self):
        wo = self._wo("Rejected")
        self._save(self.creator, wo, status="Vendor Selected")
        self.assertIn(self.lead, self._recipients("sr:vendorSelected", wo))
        self.assertIn(self.admin, self._recipients("sr:vendorSelected", wo))
        self.assertOneEach("sr:vendorSelected", wo)

    def test_a_new_work_order_from_the_wizard_notifies_once(self):
        def create():
            doc = frappe.get_doc({
                "doctype": SR,
                "project": self.project,
                "vendor": self.vendor,
                "status": "Vendor Selected",
                "gst": "false",
                "service_category_list": {"list": [{"name": "Test"}]},
                "work_order_items": [{"item_name": "New work", "category": "Test", "uom": "Nos",
                                      "quantity": 1, "rate": 5_000}],
            })
            doc.insert()
            self.fx.srs.append(doc.name)
            return doc.name
        wo = self._as(self.creator, create)
        self.assertIn(self.lead, self._recipients("sr:vendorSelected", wo))
        self.assertOneEach("sr:vendorSelected", wo)

    def test_saves_that_keep_vendor_selected_notify_nobody(self):
        wo = self._wo("Rejected")
        self._save(self.creator, wo, status="Vendor Selected")
        before = self._bell(wo)
        self._save(self.creator, wo, notes={"list": [{"id": "1", "note": "Terms changed"}]})
        self._save(self.creator, wo, invoice_no="INV-1")
        self._as(self.admin, self._server_gst_switch, wo)
        self.assertEqual(self._bell(wo), before)

    def test_moving_into_amendment_notifies_once_and_its_later_saves_notify_nobody(self):
        self._amend(rate=120_000)
        self.assertIn(self.lead, self._recipients("sr:amended"))
        self.assertOneEach("sr:amended")
        before = self._bell()
        self._save(self.creator, self.wo, notes={"list": [{"id": "1", "note": "Terms changed"}]})
        self._save(self.creator, self.wo, invoice_no="INV-2")
        self._amend(rate=125_000)
        self.assertEqual(self._bell(), before)

    def test_a_pmo_executive_can_amend(self):
        """The PMO Executive role writes Work Orders (#1529) but not Nirmaan Notifications; the amend's
        notices are the system's, so they do not need the amender's permission."""
        self._amend(PMO_ONLY_USER, rate=120_000)
        self.assertEqual(self._status(self.wo), "Amendment")
        self.assertIn(self.lead, self._recipients("sr:amended"))

    def test_a_save_that_is_rolled_back_leaves_no_notification(self):
        """Nothing is committed mid-save: the notices ride the save's own transaction."""
        wo = self._wo("Rejected")
        frappe.db.savepoint("before_the_save")
        self._save(self.creator, wo, status="Vendor Selected")
        self.assertTrue(self._bell(wo))
        frappe.db.rollback(save_point="before_the_save")
        self.assertEqual(self._bell(wo), Counter())
        self.assertEqual(self._status(wo), "Rejected")

    @staticmethod
    def _server_gst_switch(wo):
        """The GST flag as only the server moves it (Match GST to vendor, approval)."""
        doc = frappe.get_doc(SR, wo)
        doc.gst = "true"
        doc.flags.gst_set_from_vendor = True
        doc.save()


class TestWhoIsTold(_NotificationCase):
    def test_approval_tells_service_procurement_admins_and_the_projects_accountants(self):
        wo = self._wo("Vendor Selected")
        self._save(self.lead, wo, status="Approved")
        told = self._recipients("sr:approved", wo)
        self.assertIn(SPE_USER, told)
        self.assertIn(self.admin, told)
        self.assertNotIn(ACCOUNTANT_ELSEWHERE, told)
        self.assertOneEach("sr:approved", wo)

    def test_reject_tells_the_creator(self):
        wo = self._wo("Vendor Selected")
        self._created_by(wo, self.creator)
        self._save(self.lead, wo, status="Rejected")
        self.assertEqual(self._recipients("sr:rejected", wo), {self.creator})
        self.assertOneEach("sr:rejected", wo)

    def test_accepting_an_amendment_tells_the_creator(self):
        self._amend(rate=120_000)
        self._accept()
        self.assertEqual(self._recipients("sr:amendmentAccepted"), {self.creator})
        self.assertNotIn("sr:approved", self._events())

    def test_reverting_an_amendment_tells_the_creator(self):
        self._amend(rate=120_000)
        self._as(self.approver, revert_amendment, self.wo)
        self.assertEqual(self._recipients("sr:amendmentReverted"), {self.creator})
        self.assertNotIn("sr:amendmentAccepted", self._events())

    def test_a_creator_who_decides_is_not_told_their_own_decision(self):
        wo = self._wo("Vendor Selected")
        self._created_by(wo, self.lead)
        self._save(self.lead, wo, status="Rejected")
        self.assertNotIn("sr:rejected", self._events(wo))


class TestFinalizeSendsTheFinalizedEvent(_NotificationCase):
    def test_finalizing_publishes_sr_finalized_to_the_approval_audience(self):
        frappe.db.set_value(SR, self.wo, "project_gst", NIRMAAN_GST)
        frappe.db.commit()
        with patch("frappe.publish_realtime") as publish:
            self._as(self.admin, finalize_sr, self.wo)
        sent = {(c.kwargs.get("event"), c.kwargs.get("user")) for c in publish.call_args_list}
        self.assertIn(("sr:finalized", SPE_USER), sent)
        self.assertIn(SPE_USER, self._recipients("sr:finalized"))
        self.assertOneEach("sr:finalized")
