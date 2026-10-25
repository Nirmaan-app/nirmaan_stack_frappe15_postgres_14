"""Pure-rule tests for merging a Tendering project's BoQs into a Won project (ADR-0038). No database."""

import unittest

from nirmaan_stack.services.tendering_merge import (
    wizard_tick_refusal,
    busy_lock_label,
    busy_parse_label,
    merge_refusal,
    undo_refusal,
)


def _merge(**overrides):
    facts = dict(
        may_merge=True,
        project="STUB-1",
        tendering_status="Tendering",
        boq_count=2,
        target="WON-1",
        target_tendering_status="Won",
        target_status="WIP",
    )
    facts.update(overrides)
    return merge_refusal(**facts)


def _undo(**overrides):
    facts = dict(may_merge=True, project="STUB-1", tendering_status="Merged", blocking_revisions=[])
    facts.update(overrides)
    return undo_refusal(**facts)


class TestMergeRefusal(unittest.TestCase):
    def test_allows_a_tendering_project_into_a_running_won_project(self):
        for status in ("Won", "WIP", "Handover", "Halted", "CEO Hold", None):
            self.assertIsNone(_merge(target_status=status), status)

    def test_refuses_a_non_admin(self):
        self.assertIn("Only users who can create projects", _merge(may_merge=False))

    def test_refuses_a_project_that_is_not_tendering(self):
        for status in ("Lost", "Merged", "Won", None):
            self.assertIn("Only a Tendering project", _merge(tendering_status=status), status)

    def test_refuses_a_project_with_no_boq(self):
        self.assertIn("no BoQ to merge", _merge(boq_count=0))

    def test_refuses_a_missing_or_self_target(self):
        self.assertIn("Choose the Won project", _merge(target=None))
        self.assertIn("into itself", _merge(target="STUB-1"))
        self.assertIn("does not exist", _merge(target_tendering_status=None))

    def test_refuses_a_target_that_is_not_won(self):
        for status in ("Tendering", "Lost", "Merged"):
            self.assertIn("not a Won project", _merge(target_tendering_status=status), status)

    def test_refuses_a_completed_target_only(self):
        self.assertIn("Completed", _merge(target_status="Completed"))
        self.assertIsNone(_merge(target_status="Handover"))

    def test_refuses_a_ticked_name_that_is_not_one_of_the_projects_boqs(self):
        message = _merge(picks_outside=["BOQ-26-00999"])
        self.assertIn("Not a BoQ of project 'STUB-1': BOQ-26-00999", message)

    def test_the_merge_button_needs_a_tick_the_wizard_does_not(self):
        """Owner 2026-10-21: the button merges at least one ticked BoQ; inside the wizard a
        source may have none ticked, because the wizard checks "one overall"."""
        self.assertIn("Tick at least one BoQ to merge", _merge(require_tick=True, ticked_count=0))
        self.assertIsNone(_merge(require_tick=True, ticked_count=1))
        self.assertIsNone(_merge(require_tick=False, ticked_count=0))

    def test_refuses_a_boq_that_is_not_draft_and_names_it(self):
        """A status set by hand in Desk is refused, never silently overwritten (review finding 4)."""
        message = _merge(boqs_not_draft=["BOQ-26-00300 (Approved)", "BOQ-26-00301 (Superseded)"])
        self.assertIn("Only Draft BoQs can be merged", message)
        self.assertIn("BOQ-26-00300 (Approved), BOQ-26-00301 (Superseded)", message)


class TestUndoRefusal(unittest.TestCase):
    def test_allows_a_merged_project(self):
        self.assertIsNone(_undo())

    def test_refuses_a_non_admin(self):
        self.assertIn("Only users who can create projects", _undo(may_merge=False))

    def test_refuses_a_project_that_is_not_merged(self):
        for status in ("Tendering", "Lost", "Won", None):
            self.assertIn("is not merged", _undo(tendering_status=status), status)

    def test_names_every_blocking_revision(self):
        message = _undo(blocking_revisions=["BOQ-26-00400", "BOQ-26-00401"])
        self.assertIn("BOQ-26-00400, BOQ-26-00401 are linked as a revision", message)
        self.assertIn("split them across two projects", message)
        single = _undo(blocking_revisions=["BOQ-26-00400"])
        self.assertIn("BOQ-26-00400 is linked as a revision", single)
        self.assertIn("split it across two projects", single)

    def test_refuses_a_merged_boq_in_another_status_and_names_it(self):
        message = _undo(boqs_in_other_status=["BOQ-26-00402 (Approved)"])
        self.assertIn("only Selected or Draft BoQs can go back", message)
        self.assertIn("BOQ-26-00402 (Approved)", message)

    def test_refuses_while_a_merged_boq_is_being_edited(self):
        message = _undo(busy_boqs=["MEP — parse running"])
        self.assertIn("being edited right now: MEP — parse running", message)
        self.assertIn("Undo after they leave the page", message)


class TestBusyBoqs(unittest.TestCase):
    """D9: Merge and Undo wait while someone edits a BoQ or its parse runs."""

    def test_merge_refuses_while_a_boq_is_being_edited_and_lists_each(self):
        lines = ['MEP › sheet "Electrical" — Nived, in Configure / Review (just now)', "HVAC — parse running"]
        message = _merge(busy_boqs=lines)
        self.assertIn("being edited right now: " + "; ".join(lines), message)
        self.assertIn("Merge after they leave the page", message)

    def test_lock_label_names_the_screen_the_sheet_and_how_long_ago(self):
        self.assertEqual(
            busy_lock_label("MEP", "Electrical ", 0, "Nived", 30),
            'MEP › sheet "Electrical" — Nived, in Configure / Review (just now)',
        )
        self.assertEqual(
            busy_lock_label("MEP", "HVAC", 3, "Saima", 95),
            'MEP › sheet "HVAC" — Saima, in Pricing (1 min ago)',
        )

    def test_parse_label(self):
        self.assertEqual(busy_parse_label("MEP"), "MEP — parse running")


class TestWizardTicks(unittest.TestCase):
    """Convert / Create: at least one BoQ ticked overall when any BoQ is involved."""

    def test_refuses_when_boqs_exist_and_none_is_ticked(self):
        self.assertIn("Tick at least one BoQ", wizard_tick_refusal(boq_count=3, ticked_count=0))

    def test_one_tick_anywhere_is_enough(self):
        self.assertIsNone(wizard_tick_refusal(boq_count=3, ticked_count=1))

    def test_no_boqs_at_all_needs_no_tick(self):
        self.assertIsNone(wizard_tick_refusal(boq_count=0, ticked_count=0))
