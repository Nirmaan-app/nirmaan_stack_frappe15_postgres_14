# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.integrations.controllers.boqs import change_boq_selection, select_project_boqs

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

    def test_approved_cannot_go_back_to_draft(self):
        """The award is one-way: Approved → Draft must be blocked."""
        boq = self._make_boq(boq_name="Approved One-Way BoQ")
        boq.status = "Approved"
        boq.save(ignore_permissions=True)
        boq.status = "Draft"
        with self.assertRaises(frappe.ValidationError):
            boq.save(ignore_permissions=True)

    # parent_boq linkage tests (Group A) were removed in Phase 4 P4-FINAL when the
    # parent_boq field + its master/sub validation were retired.

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
    # Group C — approval cascade: REMOVED in Phase 4 P4-FINAL             #
    # ------------------------------------------------------------------ #
    # The master/sub approval cascade was retired with parent_boq; on_update is now a
    # no-op. The 6 cascade tests were removed along with the parent_boq linkage tests.

    # ------------------------------------------------------------------ #
    # Group D — select_project_boqs (Convert to Won, ADR-0037 D2)         #
    # ------------------------------------------------------------------ #
    # Each test gets its own project name: the class rolls back only once, at the end,
    # so BoQs from earlier tests in this class are still visible to later ones. These
    # project names exist nowhere, so the BoQs are inserted Draft (not on a Won project).

    def _award_project(self):
        return f"_TEST_AWARD_{frappe.generate_hash(length=8)}"

    def _status(self, name):
        return frappe.db.get_value("BOQs", name, "status")

    def test_select_marks_the_pick_selected_and_leaves_the_rest_draft(self):
        project = self._award_project()
        elec_v1 = self._make_boq("Electrical", project)
        elec_v2 = self._make_boq("Electrical", project)
        hvac = self._make_boq("HVAC", project)
        elsewhere = self._make_boq("Electrical", self._award_project())

        result = select_project_boqs(project, [elec_v2.name])

        self.assertEqual(self._status(elec_v2.name), "Selected")
        self.assertEqual(self._status(elec_v1.name), "Draft")
        self.assertEqual(self._status(hvac.name), "Draft")
        self.assertEqual(self._status(elsewhere.name), "Draft")
        self.assertEqual(result, {"selected": [elec_v2.name]})

    def test_select_marks_every_picked_boq(self):
        """Multi-trade projects: each picked BoQ is Selected, the unpicked stay Draft."""
        project = self._award_project()
        elec = self._make_boq("Electrical", project)
        hvac = self._make_boq("HVAC", project)
        elv = self._make_boq("ELV", project)

        result = select_project_boqs(project, [elec.name, hvac.name])

        self.assertEqual(self._status(elec.name), "Selected")
        self.assertEqual(self._status(hvac.name), "Selected")
        self.assertEqual(self._status(elv.name), "Draft")
        self.assertEqual(result["selected"], [elec.name, hvac.name])

    def test_select_ignores_a_duplicate_pick(self):
        project = self._award_project()
        elec = self._make_boq("Electrical", project)
        result = select_project_boqs(project, [elec.name, elec.name])
        self.assertEqual(result["selected"], [elec.name])
        self.assertEqual(self._status(elec.name), "Selected")

    def test_select_never_supersedes_anything(self):
        """Approved and Superseded are kept for later use and nothing here sets them (D1)."""
        project = self._award_project()
        won = self._make_boq("Electrical", project)
        draft = self._make_boq("HVAC", project)
        old = self._make_boq("ELV", project)
        frappe.db.set_value("BOQs", old.name, "status", "Superseded")

        select_project_boqs(project, [won.name])

        self.assertEqual(self._status(draft.name), "Draft")
        self.assertEqual(self._status(old.name), "Superseded")

    def test_select_requires_a_pick_when_the_project_has_boqs(self):
        project = self._award_project()
        boq = self._make_boq("Electrical", project)
        for empty in (None, []):
            with self.assertRaises(frappe.ValidationError):
                select_project_boqs(project, empty)
        self.assertEqual(self._status(boq.name), "Draft")

    def test_select_without_boqs_is_a_no_op(self):
        result = select_project_boqs(self._award_project(), [])
        self.assertEqual(result, {"selected": []})

    def test_select_rejects_a_boq_of_another_project(self):
        project = self._award_project()
        mine = self._make_boq("Electrical", project)
        foreign = self._make_boq("Electrical", self._award_project())
        with self.assertRaises(frappe.ValidationError):
            select_project_boqs(project, [foreign.name])
        self.assertEqual(self._status(mine.name), "Draft")
        self.assertEqual(self._status(foreign.name), "Draft")

    def test_one_bad_pick_writes_nothing(self):
        """Every pick is checked before any status moves, so a good pick beside a bad one stays Draft."""
        project = self._award_project()
        good = self._make_boq("Electrical", project)
        foreign = self._make_boq("HVAC", self._award_project())
        with self.assertRaises(frappe.ValidationError):
            select_project_boqs(project, [good.name, foreign.name])
        self.assertEqual(self._status(good.name), "Draft")

    def test_select_rejects_a_superseded_pick(self):
        project = self._award_project()
        boq = self._make_boq("Electrical", project)
        frappe.db.set_value("BOQs", boq.name, "status", "Superseded")
        with self.assertRaises(frappe.ValidationError):
            select_project_boqs(project, [boq.name])

    # ------------------------------------------------------------------ #
    # Group E — only an Admin adds a BoQ to a Won project                 #
    # ------------------------------------------------------------------ #
    # Reads an existing Won project and a non-admin user from the site (read-only); every
    # BoQ inserted here is uncommitted and rolled back with the class.

    def _won_project(self):
        project = frappe.get_all("Projects", filters={"tendering_status": "Won"}, pluck="name", limit=1)
        if not project:
            self.skipTest("no Won project on this site")
        return project[0]

    def _non_admin_user(self):
        user = frappe.get_all(
            "Nirmaan Users",
            filters={"role_profile": ["not in", ["Nirmaan Admin Profile", ""]], "name": ["!=", "Administrator"]},
            pluck="name",
            limit=1,
        )
        if not user:
            self.skipTest("no non-admin Nirmaan user on this site")
        return user[0]

    def test_non_admin_cannot_add_a_boq_to_a_won_project(self):
        project = self._won_project()
        frappe.set_user(self._non_admin_user())
        try:
            with self.assertRaises(frappe.PermissionError):
                self._make_boq("Won Project Upload", project)
        finally:
            frappe.set_user("Administrator")

    def test_admin_adds_a_selected_boq_to_a_won_project(self):
        """D3: a BoQ an Admin adds after Won is part of the live scope at once."""
        boq = self._make_boq("Won Project Admin Upload", self._won_project())
        self.assertEqual(boq.status, "Selected")
        self.assertEqual(self._status(boq.name), "Selected")

    def test_a_boq_added_before_won_starts_draft(self):
        boq = self._make_boq("Pre-Won Upload", self._award_project())
        self.assertEqual(boq.status, "Draft")

    def test_non_admin_can_still_add_a_boq_before_won(self):
        frappe.set_user(self._non_admin_user())
        try:
            boq = self._make_boq("Pre-Won Upload", self._award_project())
        finally:
            frappe.set_user("Administrator")
        self.assertTrue(boq.name)

    def test_superseded_by_hand_is_still_blocked_after_a_selection(self):
        project = self._award_project()
        won = self._make_boq("Electrical", project)
        select_project_boqs(project, [won.name])

        selected = frappe.get_doc("BOQs", won.name)
        selected.flags.ignore_links = True
        selected.status = "Superseded"
        with self.assertRaises(frappe.ValidationError):
            selected.save(ignore_permissions=True)

    # ------------------------------------------------------------------ #
    # Group F — change_boq_selection (Admin's Mark as Selected / Move to  #
    # Draft, ADR-0037 D4/D7)                                              #
    # ------------------------------------------------------------------ #
    # BoQs inserted on a real Won project start Selected (D3); a Draft one is made with an
    # uncommitted set_value. Nothing here commits -- the endpoint does, and is not called.

    def _won_boq(self, boq_name, status):
        boq = self._make_boq(boq_name, self._won_project())
        if status != "Selected":
            frappe.db.set_value("BOQs", boq.name, "status", status)
        return boq.name

    def test_mark_as_selected_moves_draft_boqs(self):
        project = self._won_project()
        a = self._won_boq("Mark A", "Draft")
        b = self._won_boq("Mark B", "Draft")

        result = change_boq_selection(project, [a, b], "Selected")

        self.assertEqual(result, {"status": "Selected", "boqs": [a, b]})
        self.assertEqual(self._status(a), "Selected")
        self.assertEqual(self._status(b), "Selected")

    def test_move_to_draft_moves_selected_boqs(self):
        project = self._won_project()
        a = self._won_boq("Unmark A", "Selected")

        change_boq_selection(project, [a], "Draft")

        self.assertEqual(self._status(a), "Draft")

    def test_moving_the_last_selected_boq_to_draft_is_allowed(self):
        """D7: the screen warns, the rule does not refuse."""
        project = self._won_project()
        names = frappe.get_all(
            "BOQs", filters={"project": project, "status": "Selected"}, pluck="name"
        )
        names.append(self._won_boq("Last Selected", "Selected"))

        change_boq_selection(project, names, "Draft")

        self.assertFalse(
            frappe.db.exists("BOQs", {"project": project, "status": "Selected"})
        )

    def test_a_boq_in_the_wrong_status_refuses_the_whole_batch(self):
        """Already moved, or Approved: refused by name, and the good BoQ beside it does not move."""
        project = self._won_project()
        good = self._won_boq("Batch Good", "Draft")
        for wrong in ("Selected", "Approved", "Superseded"):
            bad = self._won_boq(f"Batch {wrong}", wrong)
            with self.assertRaises(frappe.ValidationError) as ctx:
                change_boq_selection(project, [good, bad], "Selected")
            self.assertIn(bad, str(ctx.exception))
            self.assertEqual(self._status(good), "Draft")
            self.assertEqual(self._status(bad), wrong)

    def test_refuses_a_boq_of_another_project(self):
        project = self._won_project()
        foreign = self._make_boq("Foreign", self._award_project()).name
        with self.assertRaises(frappe.ValidationError):
            change_boq_selection(project, [foreign], "Selected")
        self.assertEqual(self._status(foreign), "Draft")

    def test_refuses_a_project_that_is_not_won(self):
        project = self._award_project()
        boq = self._make_boq("Not Won", project).name
        with self.assertRaises(frappe.ValidationError):
            change_boq_selection(project, [boq], "Selected")
        self.assertEqual(self._status(boq), "Draft")

    def test_refuses_an_unknown_status_and_an_empty_pick(self):
        project = self._won_project()
        boq = self._won_boq("Odd Status", "Draft")
        for status in ("Approved", "Superseded", ""):
            with self.assertRaises(frappe.ValidationError):
                change_boq_selection(project, [boq], status)
        for empty in (None, []):
            with self.assertRaises(frappe.ValidationError):
                change_boq_selection(project, empty, "Selected")
        self.assertEqual(self._status(boq), "Draft")

    def test_non_admin_cannot_change_the_selection(self):
        project = self._won_project()
        boq = self._won_boq("Non Admin Mark", "Draft")
        frappe.set_user(self._non_admin_user())
        try:
            with self.assertRaises(frappe.PermissionError):
                change_boq_selection(project, [boq], "Selected")
        finally:
            frappe.set_user("Administrator")
        self.assertEqual(self._status(boq), "Draft")
