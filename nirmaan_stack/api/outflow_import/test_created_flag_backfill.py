# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""The back-fill of `Outflow Row Match.created_by_import` on older expense legs (#1278).

A created expense leg is marked, a hand-Linked one is left unmarked, and a second run marks nothing.
The rule itself is table-tested in `services/outflow_import/test_unreconcile.TestTheBackfillRule`; here
it runs against real records, scoped to the legs the test made.

⚠️ RUNS AGAINST THE LIVE SITE DATABASE; purged by the fixtures' tearDown.
"""

import frappe

from nirmaan_stack.api.outflow_import.expenses import settle_row
from nirmaan_stack.api.outflow_import.test_unreconcile_created import CreatedUnreconcileFixture
from nirmaan_stack.api.outflow_import.test_unreconcile_expenses import NON_PROJECT_EXPENSE
from nirmaan_stack.patches.v3_0.backfill_outflow_match_created_flag import backfill_created_flag

MATCH_DOCTYPE = "Outflow Row Match"


class TestTheCreatedFlagBackfill(CreatedUnreconcileFixture):
    def _as_before_the_flag(self, leg):
        """What a leg written before #1278 looks like. A raw write: the controller freezes the field."""
        frappe.db.set_value(MATCH_DOCTYPE, leg, "created_by_import", 0, update_modified=False)
        frappe.db.commit()

    def _flag(self, leg):
        return frappe.db.get_value(MATCH_DOCTYPE, leg, "created_by_import")

    def test_a_created_leg_is_marked_a_hand_link_is_not_and_a_rerun_marks_nothing(self):
        created_row, created = self._created_expense(NON_PROJECT_EXPENSE)
        linked_row, linked = self._linked(NON_PROJECT_EXPENSE)
        created_leg = self._leg(created_row, created)
        linked_leg = self._leg(linked_row, linked)
        self._as_before_the_flag(created_leg)

        counts = backfill_created_flag(legs=[created_leg, linked_leg])

        self.assertEqual(counts, {"created": 1, "not created": 1})
        self.assertEqual(self._flag(created_leg), 1)
        self.assertEqual(self._flag(linked_leg), 0)
        self.assertEqual(
            backfill_created_flag(legs=[created_leg, linked_leg]),
            {"created": 0, "not created": 1},
        )
        self.assertEqual(self._flag(created_leg), 1)

    def test_a_hand_link_minted_seconds_before_its_settle_still_needs_the_same_user(self):
        name = self._expense(NON_PROJECT_EXPENSE, "500")
        frappe.db.set_value(
            NON_PROJECT_EXPENSE, name, "owner", "someone-else@example.com", update_modified=False
        )
        frappe.db.delete("Version", {"ref_doctype": NON_PROJECT_EXPENSE, "docname": name})
        frappe.db.commit()
        row = self._staged_row(amount="500")
        settle_row(row=row, target_doctype=NON_PROJECT_EXPENSE, target_name=name)
        frappe.db.delete("Version", {"ref_doctype": NON_PROJECT_EXPENSE, "docname": name})
        frappe.db.commit()
        leg = self._leg(row, name)

        self.assertEqual(backfill_created_flag(legs=[leg]), {"created": 0, "not created": 1})
        self.assertEqual(self._flag(leg), 0)

    def test_an_empty_scope_reads_nothing(self):
        self.assertEqual(backfill_created_flag(legs=[]), {"created": 0, "not created": 0})
