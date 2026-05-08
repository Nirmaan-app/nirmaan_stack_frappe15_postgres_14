# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

import frappe
from frappe.tests.utils import FrappeTestCase

_TEST_PROJECT = "_TEST_BOQ_PROJECT_BOQS"
_TEST_PROJECT_2 = "_TEST_BOQ_PROJECT_2"


class TestBOQs(FrappeTestCase):
    """
    Tests for the BOQs controller (integrations/controllers/boqs.py).
    All BOQs are inserted with ignore_links=True so no real Projects record
    is needed — only the field value matters for controller logic.
    FrappeTestCase rolls back uncommitted changes in tearDown; no BOQ
    controller hook calls frappe.db.commit(), so all fixtures clean up
    automatically.
    """

    def _make_boq(self, boq_name=_TEST_PROJECT + " BoQ", project=_TEST_PROJECT,
                  parent_boq=None):
        boq = frappe.new_doc("BOQs")
        boq.project = project
        boq.boq_name = boq_name
        if parent_boq:
            boq.parent_boq = parent_boq
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

    # ------------------------------------------------------------------ #
    # Group A — parent_boq linkage (5 tests)                              #
    # ------------------------------------------------------------------ #

    def test_parent_boq_same_project_is_valid(self):
        """Sub-BoQ with same project as master must save without error."""
        master = self._make_boq(boq_name="Master Same Project")
        child = self._make_boq(boq_name="Child Same Project", parent_boq=master.name)
        self.assertEqual(child.parent_boq, master.name)

    def test_parent_boq_different_project_is_rejected(self):
        """Sub-BoQ whose project differs from master must be rejected."""
        master = self._make_boq(boq_name="Master Project Mismatch", project=_TEST_PROJECT)
        with self.assertRaises(frappe.ValidationError):
            self._make_boq(
                boq_name="Child Project Mismatch",
                project=_TEST_PROJECT_2,
                parent_boq=master.name,
            )

    def test_standalone_boq_no_parent_is_valid(self):
        """Phase 1 standalone path: parent_boq null must save fine."""
        boq = self._make_boq(boq_name="Standalone BoQ")
        self.assertFalse(boq.parent_boq)

    def test_circular_parent_self_link_rejected(self):
        """BoQ with parent_boq = its own name must be rejected."""
        boq = self._make_boq(boq_name="Circular Self")
        boq.parent_boq = boq.name
        with self.assertRaises(frappe.ValidationError):
            boq.save(ignore_permissions=True)

    def test_grandchild_parent_rejected(self):
        """BoQ whose parent is itself a sub-BoQ (two-level deep) must be rejected."""
        master = self._make_boq(boq_name="Master Grandchild")
        child = self._make_boq(boq_name="Child Grandchild", parent_boq=master.name)
        with self.assertRaises(frappe.ValidationError):
            self._make_boq(boq_name="Grandchild", parent_boq=child.name)

    # ------------------------------------------------------------------ #
    # Group B — area_dimensions validation (6 tests)                      #
    # ------------------------------------------------------------------ #

    def test_area_dimensions_valid_json_array(self):
        """Valid JSON array of strings must save and persist."""
        boq = self._make_boq(boq_name="Area Dims Valid")
        boq.area_dimensions = '["B1", "B3", "B6"]'
        boq.save(ignore_permissions=True)
        self.assertEqual(boq.area_dimensions, '["B1", "B3", "B6"]')

    def test_area_dimensions_null_is_valid(self):
        """Null area_dimensions (single-qty BoQ) must save without error."""
        boq = self._make_boq(boq_name="Area Dims Null")
        self.assertFalse(boq.area_dimensions)

    def test_area_dimensions_empty_list_is_valid(self):
        """'[]' is treated as no areas and must save without error."""
        boq = self._make_boq(boq_name="Area Dims Empty List")
        boq.area_dimensions = "[]"
        boq.save(ignore_permissions=True)
        self.assertEqual(boq.area_dimensions, "[]")

    def test_area_dimensions_invalid_json_rejected(self):
        """Non-JSON string must be rejected."""
        boq = self._make_boq(boq_name="Area Dims Bad JSON")
        boq.area_dimensions = "not json"
        with self.assertRaises(frappe.ValidationError):
            boq.save(ignore_permissions=True)

    def test_area_dimensions_json_object_rejected(self):
        """JSON object (not array) must be rejected."""
        boq = self._make_boq(boq_name="Area Dims Object")
        boq.area_dimensions = '{"B1": 1}'
        with self.assertRaises(frappe.ValidationError):
            boq.save(ignore_permissions=True)

    def test_area_dimensions_duplicates_and_non_strings_rejected(self):
        """Duplicate strings and non-string elements must both be rejected."""
        boq = self._make_boq(boq_name="Area Dims Bad Elements")

        boq.area_dimensions = '["B1", "B1"]'
        with self.assertRaises(frappe.ValidationError):
            boq.save(ignore_permissions=True)

        boq.area_dimensions = '["B1", 123]'
        with self.assertRaises(frappe.ValidationError):
            boq.save(ignore_permissions=True)

    # ------------------------------------------------------------------ #
    # Group C — approval cascade (6 tests)                                #
    # ------------------------------------------------------------------ #

    def test_master_approved_cascades_to_single_child(self):
        """Approving a master BoQ must cascade Draft→Approved to its child."""
        master = self._make_boq(boq_name="Cascade Master Single")
        child = self._make_boq(boq_name="Cascade Child Single", parent_boq=master.name)

        master.status = "Approved"
        master.save(ignore_permissions=True)

        child_status = frappe.db.get_value("BOQs", child.name, "status")
        self.assertEqual(child_status, "Approved")

    def test_master_approved_cascades_to_multiple_children(self):
        """Approving a master must cascade to all three Draft children."""
        master = self._make_boq(boq_name="Cascade Master Multi")
        c1 = self._make_boq(boq_name="Cascade Child Multi 1", parent_boq=master.name)
        c2 = self._make_boq(boq_name="Cascade Child Multi 2", parent_boq=master.name)
        c3 = self._make_boq(boq_name="Cascade Child Multi 3", parent_boq=master.name)

        master.status = "Approved"
        master.save(ignore_permissions=True)

        for child in (c1, c2, c3):
            self.assertEqual(
                frappe.db.get_value("BOQs", child.name, "status"),
                "Approved",
            )

    def test_approving_child_does_not_cascade_to_siblings(self):
        """Approving one child must not change sibling status."""
        master = self._make_boq(boq_name="No Sibling Cascade Master")
        c1 = self._make_boq(boq_name="No Sibling C1", parent_boq=master.name)
        c2 = self._make_boq(boq_name="No Sibling C2", parent_boq=master.name)

        c1.status = "Approved"
        c1.save(ignore_permissions=True)

        self.assertEqual(frappe.db.get_value("BOQs", c2.name, "status"), "Draft")

    def test_approving_child_does_not_cascade_to_master(self):
        """Approving a sub-BoQ must not change master status."""
        master = self._make_boq(boq_name="No Master Cascade Master")
        child = self._make_boq(boq_name="No Master Cascade Child", parent_boq=master.name)

        child.status = "Approved"
        child.save(ignore_permissions=True)

        self.assertEqual(frappe.db.get_value("BOQs", master.name, "status"), "Draft")

    def test_cascade_skips_superseded_children(self):
        """Cascade must approve Draft children but leave Superseded children untouched."""
        master = self._make_boq(boq_name="Cascade Superseded Master")
        c_superseded = self._make_boq(boq_name="Cascade Superseded Child", parent_boq=master.name)
        c_draft = self._make_boq(boq_name="Cascade Draft Child", parent_boq=master.name)

        frappe.db.set_value("BOQs", c_superseded.name, "status", "Superseded")

        master.status = "Approved"
        master.save(ignore_permissions=True)

        self.assertEqual(frappe.db.get_value("BOQs", c_superseded.name, "status"), "Superseded")
        self.assertEqual(frappe.db.get_value("BOQs", c_draft.name, "status"), "Approved")

    def test_cascade_is_idempotent(self):
        """Re-saving an already-Approved master must not raise and must not double-cascade."""
        master = self._make_boq(boq_name="Idempotent Cascade Master")
        child = self._make_boq(boq_name="Idempotent Cascade Child", parent_boq=master.name)

        master.status = "Approved"
        master.save(ignore_permissions=True)

        # Save master again — already Approved, no transition → no cascade, no error
        master.reload()
        master.save(ignore_permissions=True)

        self.assertEqual(frappe.db.get_value("BOQs", master.name, "status"), "Approved")
        self.assertEqual(frappe.db.get_value("BOQs", child.name, "status"), "Approved")
