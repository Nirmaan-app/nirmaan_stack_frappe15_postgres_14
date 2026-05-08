# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

import frappe
from frappe.tests.utils import FrappeTestCase

_TEST_PROJECT = "_TEST_BOQ_PROJECT_BOQS"


class TestBOQs(FrappeTestCase):
    """
    Tests for the BOQs controller (integrations/controllers/boqs.py).
    All BOQs are inserted with ignore_links=True so no real Projects record
    is needed — only the field value matters for controller logic.
    FrappeTestCase rolls back uncommitted changes in tearDown; no BOQ
    controller hook calls frappe.db.commit(), so all fixtures clean up
    automatically.
    """

    def _make_boq(self, boq_name=_TEST_PROJECT + " BoQ", project=_TEST_PROJECT):
        boq = frappe.new_doc("BOQs")
        boq.project = project
        boq.boq_name = boq_name
        boq.insert(ignore_permissions=True, ignore_links=True)
        return boq

    # ------------------------------------------------------------------ #
    # before_insert: auto-populated fields                                 #
    # ------------------------------------------------------------------ #

    def test_status_set_to_draft_on_insert(self):
        boq = self._make_boq()
        self.assertEqual(boq.status, "Draft")

    def test_uploaded_by_set_on_insert(self):
        boq = self._make_boq()
        self.assertEqual(boq.uploaded_by, frappe.session.user)

    def test_uploaded_at_set_on_insert(self):
        boq = self._make_boq()
        self.assertIsNotNone(boq.uploaded_at)

    # ------------------------------------------------------------------ #
    # before_insert: version auto-increment                                #
    # ------------------------------------------------------------------ #

    def test_version_starts_at_one(self):
        boq = self._make_boq(boq_name="Version Start Test")
        self.assertEqual(boq.version, 1)

    def test_version_auto_increments_for_same_project_and_name(self):
        boq1 = self._make_boq(boq_name="Increment Test BoQ")
        boq2 = self._make_boq(boq_name="Increment Test BoQ")
        self.assertEqual(boq1.version, 1)
        self.assertEqual(boq2.version, 2)

    def test_version_is_independent_per_boq_name(self):
        """A new boq_name on the same project starts at version 1."""
        self._make_boq(boq_name="Name A BoQ")
        boq_b = self._make_boq(boq_name="Name B BoQ")
        self.assertEqual(boq_b.version, 1)

    # ------------------------------------------------------------------ #
    # before_insert: required-field guards                                 #
    # ------------------------------------------------------------------ #

    def test_insert_requires_project(self):
        with self.assertRaises(frappe.ValidationError):
            boq = frappe.new_doc("BOQs")
            boq.project = ""
            boq.boq_name = "No Project BoQ"
            boq.insert(ignore_permissions=True, ignore_links=True)

    def test_insert_requires_boq_name(self):
        with self.assertRaises(frappe.ValidationError):
            boq = frappe.new_doc("BOQs")
            boq.project = _TEST_PROJECT
            boq.boq_name = ""
            boq.insert(ignore_permissions=True, ignore_links=True)

    # ------------------------------------------------------------------ #
    # validate: status transition guards                                   #
    # ------------------------------------------------------------------ #

    def test_cannot_manually_set_status_to_superseded(self):
        """Changing status to Superseded via save() must be blocked."""
        boq = self._make_boq(boq_name="Status Guard BoQ")
        boq.status = "Superseded"
        with self.assertRaises(frappe.ValidationError):
            boq.save(ignore_permissions=True)

    def test_cannot_reopen_a_superseded_boq(self):
        """
        Once Superseded (set directly in DB to bypass the guard), saving
        with any other status must be blocked.
        """
        boq = self._make_boq(boq_name="Reopen Guard BoQ")
        # Force Superseded via set_value so we bypass the validate guard
        frappe.db.set_value("BOQs", boq.name, "status", "Superseded")
        # In-memory boq.status is still "Draft"; save() will see old_doc as Superseded
        with self.assertRaises(frappe.ValidationError):
            boq.save(ignore_permissions=True)

    def test_draft_to_approved_is_allowed(self):
        """Draft → Approved is a valid transition; validate must not block it."""
        boq = self._make_boq(boq_name="Approved Transition BoQ")
        boq.status = "Approved"
        boq.save(ignore_permissions=True)
        self.assertEqual(boq.status, "Approved")
