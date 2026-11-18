"""The BOQ Line Estimate rules (services/estimations/rules.py). Pure: no database reads or writes."""

from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.services.estimations import rules


def _normal(**over):
    row = {"item_type": "Normal", "item_id": "ITEM-000001", "item_name": "Made-up panel", "unit": "sqm",
           "category": "Made-up category", "make": "", "quantity": 10}
    row.update(over)
    return row


def _custom(**over):
    row = {"item_type": "Custom", "item_id": "", "item_name": "Made-up clip", "unit": "pkt",
           "category": "Made-up category", "make": "", "quantity": 5}
    row.update(over)
    return row


class TestLineProblem(FrappeTestCase):
    def test_a_current_line_item_is_accepted(self):
        self.assertIsNone(rules.line_problem({"node_type": "Line Item", "is_current": 1}))

    def test_a_missing_line_item_is_refused(self):
        self.assertIn("no longer exists", rules.line_problem(None))

    def test_a_heading_is_refused(self):
        self.assertIn("only be added to line items", rules.line_problem({"node_type": "Preamble", "is_current": 1}))

    def test_a_line_item_on_an_older_version_is_refused(self):
        self.assertIn("older version", rules.line_problem({"node_type": "Line Item", "is_current": 0}))


class TestBoqProblem(FrappeTestCase):
    def test_only_a_selected_boq_takes_estimates(self):
        self.assertIsNone(rules.boq_problem("Selected"))
        for status in ("Draft", "Approved", "Superseded", "", None):
            self.assertIn("only be saved on a Selected BOQ", rules.boq_problem(status), status)
        self.assertIn("This BOQ is Draft", rules.boq_problem("Draft"))


class TestProjectProblem(FrappeTestCase):
    def test_completed_and_handover_are_read_only(self):
        self.assertIn("read-only on a Completed project", rules.project_problem("Completed"))
        self.assertIn("read-only on a Handover project", rules.project_problem("Handover"))

    def test_other_statuses_are_editable(self):
        for status in ("WIP", "CEO Hold", "Halted", "Won", "", None):
            self.assertIsNone(rules.project_problem(status), status)


class TestItemRowProblem(FrappeTestCase):
    def test_a_normal_row_is_accepted(self):
        self.assertIsNone(rules.item_row_problem(_normal()))

    def test_a_custom_row_is_accepted(self):
        self.assertIsNone(rules.item_row_problem(_custom()))

    def test_an_unknown_type_is_refused(self):
        self.assertIn("Normal or Custom", rules.item_row_problem(_normal(item_type="Other")))

    def test_a_normal_row_needs_an_item(self):
        self.assertIn("Pick an item", rules.item_row_problem(_normal(item_id="")))

    def test_a_custom_row_with_an_item_id_is_refused(self):
        self.assertIn("cannot point to an Items record", rules.item_row_problem(_custom(item_id="ITEM-000001")))

    def test_a_custom_row_needs_name_unit_and_category(self):
        self.assertIn("name", rules.item_row_problem(_custom(item_name="  ")))
        self.assertIn("unit", rules.item_row_problem(_custom(unit="")))
        self.assertIn("category", rules.item_row_problem(_custom(category=None)))

    def test_zero_negative_empty_and_text_quantities_are_refused(self):
        for qty in (0, -1, None, "", "abc"):
            self.assertIn("above 0", rules.item_row_problem(_normal(quantity=qty)), qty)

    def test_infinite_and_nan_quantities_are_refused_not_a_crash(self):
        # JSON accepts Infinity and NaN; on a NOS item int(inf) used to raise OverflowError (a 500).
        for qty in (float("inf"), float("-inf"), float("nan"), "Infinity", "NaN"):
            self.assertIn("above 0", rules.item_row_problem(_normal(quantity=qty)), qty)
            self.assertIn("above 0", rules.item_row_problem(_normal(unit="NOS", quantity=qty)), qty)

    def test_decimals_are_refused_for_whole_number_units_only(self):
        self.assertIn("whole numbers", rules.item_row_problem(_normal(unit="NOS", quantity=1.5)))
        self.assertIn("whole numbers", rules.item_row_problem(_custom(unit=" set ", quantity=2.25)))
        self.assertIsNone(rules.item_row_problem(_normal(unit="NOS", quantity=3)))
        self.assertIsNone(rules.item_row_problem(_normal(unit="sqm", quantity=1.5)))


class TestReattachMatches(FrappeTestCase):
    def test_same_row_and_same_text_moves(self):
        moves, unmatched = rules.reattach_matches(
            [{"estimate": "E1", "excel_row": 15, "description": "Made-up plenum"}],
            [{"node": "N2", "excel_row": 15, "description": "Made-up plenum"}], set())
        self.assertEqual(moves, {"E1": "N2"})
        self.assertEqual(unmatched, [])

    def test_changed_text_or_row_is_listed_not_guessed(self):
        older = [{"estimate": "E1", "excel_row": 15, "description": "Made-up plenum"},
                 {"estimate": "E2", "excel_row": 16, "description": "Made-up diffuser"}]
        current = [{"node": "N1", "excel_row": 15, "description": "Made-up plenum, revised"},
                   {"node": "N2", "excel_row": 17, "description": "Made-up diffuser"}]
        moves, unmatched = rules.reattach_matches(older, current, set())
        self.assertEqual(moves, {})
        self.assertEqual([u["estimate"] for u in unmatched], ["E1", "E2"])

    def test_a_line_that_already_has_an_estimate_is_skipped(self):
        moves, unmatched = rules.reattach_matches(
            [{"estimate": "E1", "excel_row": 15, "description": "x"}],
            [{"node": "N1", "excel_row": 15, "description": "x"}], {"N1"})
        self.assertEqual(moves, {})
        self.assertEqual(len(unmatched), 1)

    def test_one_line_takes_one_estimate(self):
        older = [{"estimate": "E1", "excel_row": 15, "description": "x"},
                 {"estimate": "E2", "excel_row": 15, "description": "x"}]
        moves, unmatched = rules.reattach_matches(older, [{"node": "N1", "excel_row": 15, "description": "x"}], set())
        self.assertEqual(moves, {"E1": "N1"})
        self.assertEqual([u["estimate"] for u in unmatched], ["E2"])

    def test_the_newest_estimate_wins_a_line(self):
        # Committed twice without a Re-attach: E-v1 was left on version 1, then E-v2 was added on version 2. Both are
        # older now; the version-2 one (the user's latest work) takes the line, whatever order they arrive in.
        older = [{"estimate": "E-v1", "excel_row": 15, "description": "x", "version": 1, "modified": "2026-11-01 10:00:00"},
                 {"estimate": "E-v2", "excel_row": 15, "description": "x", "version": 2, "modified": "2026-11-05 10:00:00"},
                 {"estimate": "E-row9", "excel_row": 9, "description": "y", "version": 2, "modified": "2026-11-05 10:00:00"}]
        moves, unmatched = rules.reattach_matches(older, [{"node": "N1", "excel_row": 15, "description": "x"}], set())
        self.assertEqual(moves, {"E-v2": "N1"})
        self.assertEqual([u["estimate"] for u in unmatched], ["E-row9", "E-v1"])  # listed by Excel row

    def test_same_version_the_later_save_wins(self):
        older = [{"estimate": "A", "excel_row": 15, "description": "x", "version": 2, "modified": "2026-11-05 09:00:00"},
                 {"estimate": "B", "excel_row": 15, "description": "x", "version": 2, "modified": "2026-11-05 11:00:00"}]
        moves, _ = rules.reattach_matches(older, [{"node": "N1", "excel_row": 15, "description": "x"}], set())
        self.assertEqual(moves, {"B": "N1"})


class TestOlderStates(FrappeTestCase):
    PANEL = {"item_type": "Normal", "item_id": "ITEM-1", "make": "M", "unit": "NOS", "quantity": 4}

    def test_each_state(self):
        # Owner 2026-11-12: copied forward after every commit; each older version keeps its own as history.
        older = [
            {"estimate": "E-free", "excel_row": 2, "description": "a", "items": [self.PANEL]},
            {"estimate": "E-copied", "excel_row": 3, "description": "b", "items": [self.PANEL]},
            {"estimate": "E-edited", "excel_row": 4, "description": "c", "items": [self.PANEL]},
            {"estimate": "E-changed", "excel_row": 5, "description": "old text", "items": [self.PANEL]},
        ]
        current = [{"node": f"N{r}", "excel_row": r, "description": d} for r, d in ((2, "a"), (3, "b"), (4, "c"), (5, "new"))]
        on_line = {"N3": {"estimate": "C3", "items": [dict(self.PANEL, name="x")]},
                   "N4": {"estimate": "C4", "items": [dict(self.PANEL, quantity=9)]}}
        states = rules.older_states(older, current, on_line)
        # Its line holds an estimate (the copy, edited or not): history. Not copied yet: can_copy. Text changed: changed.
        self.assertEqual({k: v["state"] for k, v in states.items()},
                         {"E-free": "can_copy", "E-copied": "history", "E-edited": "history", "E-changed": "changed"})
        self.assertEqual((states["E-free"]["node"], states["E-copied"]["copy"]), ("N2", "C3"))
        self.assertEqual((states["E-changed"]["node"], states["E-changed"]["copy"]), (None, None))

    def test_an_older_version_replaced_by_a_newer_one_is_history_not_a_changed_line(self):
        # v1's row 15 was copied to v2, v2's to v3: on v3, v1's estimate is history (v2's stands for that line), never
        # listed as "changed". Only the newest one per row and text counts.
        older = [{"estimate": "E-v1", "excel_row": 15, "description": "x", "version": 1, "modified": "2026-11-01", "items": [self.PANEL]},
                 {"estimate": "E-v2", "excel_row": 15, "description": "x", "version": 2, "modified": "2026-11-05", "items": [self.PANEL]}]
        current = [{"node": "N15", "excel_row": 15, "description": "x"}]
        on_line = {"N15": {"estimate": "C15", "items": [self.PANEL]}}
        self.assertEqual({k: v["state"] for k, v in rules.older_states(older, current, on_line).items()},
                         {"E-v1": "history", "E-v2": "history"})
        # Not copied yet: the v2 one is copied, the v1 one stays history.
        self.assertEqual({k: v["state"] for k, v in rules.older_states(older, current, {}).items()},
                         {"E-v1": "history", "E-v2": "can_copy"})

    def test_a_settled_estimate_is_history_and_keeps_older_ones_history(self):
        # Option B: settled = dealt with (copied forward, or resolved by a person). It is history, and an older version's
        # estimate for the same line stays history too -- resolving the newest never brings an older one back.
        older = [{"estimate": "E-v1", "excel_row": 16, "description": "old text", "version": 1, "modified": "2026-11-01"},
                 {"estimate": "E-v2", "excel_row": 16, "description": "old text", "version": 2, "modified": "2026-11-05"}]
        current = [{"node": "N16", "excel_row": 16, "description": "new text"}]
        self.assertEqual({k: v["state"] for k, v in rules.older_states(older, current, {}).items()},
                         {"E-v1": "history", "E-v2": "changed"})
        older[1]["settled"] = 1
        self.assertEqual({k: v["state"] for k, v in rules.older_states(older, current, {}).items()},
                         {"E-v1": "history", "E-v2": "history"})


class TestDuplicateProblem(FrappeTestCase):
    def test_the_same_item_with_the_same_make_is_refused(self):
        problem = rules.duplicate_problem([_normal(make="Make A"), _normal(make="Make A", quantity=3)])
        self.assertIn("twice with the same make", problem)

    def test_the_same_item_with_different_makes_is_accepted(self):
        self.assertIsNone(rules.duplicate_problem([_normal(make="Make A"), _normal(make="Make B")]))

    def test_a_custom_repeat_ignores_case_and_spaces(self):
        problem = rules.duplicate_problem([_custom(item_name="Spacer Clip"), _custom(item_name="  spacer clip ", unit="PKT")])
        self.assertIn("twice", problem)

    def test_a_custom_item_in_two_units_is_accepted(self):
        self.assertIsNone(rules.duplicate_problem([_custom(unit="pkt"), _custom(unit="nos")]))

    def test_a_normal_and_a_custom_row_never_clash(self):
        self.assertIsNone(rules.duplicate_problem([_normal(item_name="Made-up clip", unit="pkt"), _custom()]))
