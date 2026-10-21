# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and Contributors
# See license.txt

"""A Work Order's real approval date and approver (#1532, spec #1528).

Seam 1: the approval and the later saves are made as a role, the way Desk and the SPA make them
(`doc.save()` as that user), and the stored approved-on / approved-by are read back.
Seam 2: the backfill patch, on planted Work Orders and Version rows: dry run, run, second run.

Run: DEVENV test --module nirmaan_stack.nirmaan_stack.doctype.service_requests.test_work_order_approval

⚠️ RUNS AGAINST THE SITE DATABASE. Users, Work Orders and Version rows are planted by the #1529
lifecycle suite's fixtures and purged after each test.
"""

import json

import frappe
from frappe.utils import get_datetime, now_datetime

from nirmaan_stack.api.service_requests.match_gst_to_vendor import match_gst_to_vendor
from nirmaan_stack.nirmaan_stack.doctype.service_requests.test_work_order_lifecycle import (
    ACCOUNTANT,
    ADMIN,
    PROJECT_LEAD,
    PROJECT_MANAGER,
    SR,
    USERS,
    _AsRoleCase,
)
from nirmaan_stack.patches.v3_0 import backfill_work_order_approval as patch


class _ApprovalCase(_AsRoleCase):
    def _approval(self, name):
        return frappe.db.get_value(SR, name, ["approved_on", "approved_by"], as_dict=True)


class TestApprovingStampsTheWorkOrder(_ApprovalCase):
    def test_the_approver_and_the_time_of_approval_are_stored(self):
        for profile in (ADMIN, PROJECT_LEAD):
            with self.subTest(profile=profile):
                wo = self._wo()
                started = now_datetime().replace(microsecond=0)
                self._save(USERS[profile], wo, status="Approved")
                row = self._approval(wo)
                self.assertEqual(row.approved_by, USERS[profile])
                self.assertGreaterEqual(get_datetime(row.approved_on), started)

    def test_later_saves_do_not_move_it(self):
        wo = self._wo()
        self._save(USERS[PROJECT_LEAD], wo, status="Approved")
        stamped = self._approval(wo)

        # Edit terms (notes) as a Project Manager; the WO save a payment or invoice path makes, as an
        # Accountant; a save that sends other values for the two fields, as Admin.
        self._save(USERS[PROJECT_MANAGER], wo, notes={"list": ["Revised terms"]})
        self._save(USERS[ACCOUNTANT], wo)
        self._save(USERS[ADMIN], wo, approved_on="2020-01-01 00:00:00", approved_by=USERS[ADMIN])
        # Match GST to vendor (the one GST save left): the vendor registered for GST after approval.
        frappe.db.set_value("Vendors", self.vendor, "vendor_gst", "29ABCDE1234F1Z5")
        self._as(USERS[ADMIN], match_gst_to_vendor, wo)
        self.assertEqual(frappe.db.get_value(SR, wo, "gst"), "true")
        # Amend, then accept the amendment.
        self._save(USERS[PROJECT_MANAGER], wo, status="Amendment")
        self._save(USERS[ADMIN], wo, status="Approved")

        self.assertEqual(self._approval(wo), stamped)

    def test_a_rejected_work_order_has_no_approval(self):
        wo = self._wo()
        self._save(USERS[ADMIN], wo, status="Rejected")
        self.assertEqual(self._approval(wo), {"approved_on": None, "approved_by": None})


class TestBackfillPatch(_ApprovalCase):
    """Old Work Orders, planted straight into the table with no approval stored, and their history."""

    def _version(self, wo, changed, *, on, by):
        version = frappe.get_doc({
            "doctype": "Version", "ref_doctype": SR, "docname": wo,
            "data": json.dumps({"changed": changed, "added": [], "removed": [], "row_changed": []}),
        }).insert(ignore_permissions=True)
        frappe.db.set_value("Version", version.name, {"creation": on, "owner": by}, update_modified=False)

    def setUp(self):
        super().setUp()
        lead, admin = USERS[PROJECT_LEAD], USERS[ADMIN]
        # Approved, then amended and the amendment accepted: the first approval is the one.
        self.amended = self._wo("Approved")
        self._version(self.amended, [["notes", None, "x"]], on="2026-03-01 09:00:00", by=admin)
        self._version(self.amended, [["status", "Vendor Selected", "Approved"]], on="2026-03-02 10:15:00", by=lead)
        self._version(self.amended, [["status", "Approved", "Amendment"]], on="2026-04-01 08:00:00", by=admin)
        self._version(self.amended, [["status", "Amendment", "Approved"]], on="2026-04-02 08:00:00", by=admin)
        # Approved by Admin; its approver was already filled by hand, so only the date is blank.
        self.half = self._wo("Approved")
        self._version(self.half, [["status", "Vendor Selected", "Approved"]], on="2026-05-05 12:00:00", by=admin)
        frappe.db.set_value(SR, self.half, "approved_by", lead, update_modified=False)
        # Already stamped: never touched, although its history says otherwise.
        self.stamped = self._wo("Approved")
        self._version(self.stamped, [["status", "Vendor Selected", "Approved"]], on="2026-06-06 06:00:00", by=admin)
        frappe.db.set_value(
            SR, self.stamped, {"approved_on": "2026-06-07 07:00:00", "approved_by": lead}, update_modified=False
        )
        # Created straight as Approved: no history to fill from.
        self.no_history = self._wo("Approved")
        # Never approved, though its history names Approved (a rejected approval attempt's notes).
        self.pending = self._wo("Vendor Selected")
        self._version(self.pending, [["status", "Created", "Vendor Selected"]], on="2026-07-01 07:00:00", by=admin)
        self._version(self.pending, [["notes", None, "Approved by site"]], on="2026-07-02 07:00:00", by=admin)
        frappe.db.commit()
        self.scope = [self.amended, self.half, self.stamped, self.no_history, self.pending]

    def _state(self):
        return {
            name: frappe.db.get_value(SR, name, ["approved_on", "approved_by", "modified"], as_dict=True)
            for name in self.scope
        }

    def test_the_dry_run_lists_what_it_would_fill_and_writes_nothing(self):
        before = self._state()
        found = patch.preview(self.scope)
        self.assertEqual(
            {fill.work_order: fill.fields for fill in found.fills},
            {
                self.amended: {"approved_on": get_datetime("2026-03-02 10:15:00"), "approved_by": USERS[PROJECT_LEAD]},
                self.half: {"approved_on": get_datetime("2026-05-05 12:00:00")},
            },
        )
        # A Work Order never approved has nothing to fill, so it is not listed.
        self.assertEqual(found.no_history, [self.no_history])
        self.assertEqual(self._state(), before)

    def test_the_run_fills_only_blanks_from_history(self):
        before = self._state()
        patch.execute(self.scope)
        after = self._state()
        self.assertEqual(
            (after[self.amended].approved_on, after[self.amended].approved_by),
            (get_datetime("2026-03-02 10:15:00"), USERS[PROJECT_LEAD]),
        )
        self.assertEqual(
            (after[self.half].approved_on, after[self.half].approved_by),
            (get_datetime("2026-05-05 12:00:00"), USERS[PROJECT_LEAD]),
        )
        for untouched in (self.stamped, self.no_history, self.pending):
            self.assertEqual(after[untouched], before[untouched], untouched)
        # A backfill, not an edit: no `modified` moved.
        self.assertEqual({n: r.modified for n, r in after.items()}, {n: r.modified for n, r in before.items()})

    def test_a_second_run_changes_nothing(self):
        patch.execute(self.scope)
        first = self._state()
        again = patch.plan(self.scope)
        self.assertEqual(again.fills, [])
        patch.execute(self.scope)
        self.assertEqual(self._state(), first)
