# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt
"""Tests for the confirm box's matching estimate (DEV2-B8 S2; api/boq/rate_match.match_estimate_minutes,
match_estimate_coverage, count_rows_without_card). WAIT ESTIMATE (owner 2026-11-06 12:42 "yes"): the matching part
counts the rows that need a new spec card. Mocks only: no model call, nothing is written.

  the formula      ceil((49 + 0.40 x rows + 2.0 x rows without a valid card) / 60), at least 1 minute; the same
                   numbers as RateSuggestProgressModal.matchWaitEstimate (vitest pins the same cases)  /  the count
                   unknown (None) -> every row needs a card (the safe side)  /  a count above the rows is capped
  the proof        on the 17 stored runs (16 dev2 + production's watched run) the estimate covers >= 90 %; the watched
                   run (81 rows, 38 new cards, 143 s) is covered by the matching part alone and by the full estimate;
                   B4's 65 + 0.45 x rows (no card term) under-ran it
  the count call   login only  /  switch OFF -> {"match_enabled": False}, nothing read  /  the rows asked = the rows
                   the planner is given, de-duplicated  /  rows without a valid card = the planner's to-do rows  /  no
                   card model -> every row (safe side)  /  no rows -> 0  /  it never cards, sends or commits
"""
import json
import math
from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.boq import rate_match as RM

# (rows, rows that needed a new card, real seconds = run_at - creation) of every stored match run (DEV2-B8 P0 (d),
# s2_fit.py): the 16 dev2 runs on 2026-11-06 (BRMR-26-00001 .. -00017; -00015 / -00016 built the pool inline, a path
# B8 removed, so they count with that build taken out) + production's watched run BRMR-26-00002 on BOQ-26-00344
# (Abhishek's go-live answers, 3.11: 81 rows, 43 reused + 38 new cards, created 11:48:29, complete 11:50:52).
STORED_MATCH_RUNS = (
    (206, 206, 169.9), (206, 0, 129.4), (94, 94, 106.3), (3, 3, 26.3), (28, 28, 59.8), (28, 28, 65.2), (28, 28, 63.4),
    (280, 280, 178.2), (361, 361, 169.9), (310, 310, 201.2), (20, 0, 63.7), (206, 0, 129.0), (361, 0, 125.3),
    (89, 0, 50.3), (206, 0, 136.3), (4, 0, 17.4),
    (81, 38, 143.0),
)
WATCHED = (81, 38, 143.0)
# the cases RateSuggestProgressModal.match.dom.test.tsx pins too: (rows, rows without a card) -> minutes
PARITY = [((0, None), 1), ((1, 0), 1), ((20, 0), 1), ((20, 20), 2), ((81, 38), 3), ((81, None), 5), ((81, 0), 2),
          ((206, 0), 3), ((361, 361), 16), ((30, 999), 3)]


class TestMatchEstimate(FrappeTestCase):

    def test_the_formula_and_the_client_parity_cases(self):
        self.assertEqual([RM.match_estimate_minutes(n, c) for (n, c), _ in PARITY], [m for _, m in PARITY])
        # 81 rows, 38 new cards: 49 + 32.4 + 76 = 157.4 s -> 3 minutes
        self.assertEqual(RM.match_estimate_minutes(81, 38), 3)

    def test_the_card_term_moves_the_figure_and_no_cards_is_smaller(self):
        self.assertLess(RM.match_estimate_minutes(361, 0), RM.match_estimate_minutes(361, 361))
        self.assertEqual(RM.match_estimate_minutes(81, 0), 2)
        self.assertEqual(RM.match_estimate_minutes(81, 38), 3)

    def test_an_unknown_count_is_the_safe_side_every_row_needs_a_card(self):
        self.assertEqual(RM.match_estimate_minutes(81, None), RM.match_estimate_minutes(81, 81))
        self.assertGreaterEqual(RM.match_estimate_minutes(81, None), RM.match_estimate_minutes(81, 38))

    def test_never_zero_and_a_count_above_the_rows_is_capped(self):
        self.assertEqual(RM.match_estimate_minutes(0, 0), 1)
        self.assertEqual(RM.match_estimate_minutes(30, 999), RM.match_estimate_minutes(30, 30))
        self.assertEqual(RM.match_estimate_minutes(30, -5), RM.match_estimate_minutes(30, 0))


class TestMatchEstimateProof(FrappeTestCase):
    """THE S2 PROOF on the stored runs (the estimate's whole minutes x 60 >= the real seconds)."""

    def test_it_covers_at_least_90_percent_of_the_stored_runs(self):
        covered, n = RM.match_estimate_coverage(STORED_MATCH_RUNS)
        self.assertEqual((covered, n), (16, 17))
        self.assertGreaterEqual(covered / n, 0.9)

    def test_the_watched_production_run_is_covered_by_the_matching_part_and_the_full_estimate(self):
        rows, cards, real = WATCHED
        match_min = RM.match_estimate_minutes(rows, cards)
        self.assertGreaterEqual(match_min * 60, real)                                   # 3 min = 180 s >= 143 s
        self.assertGreaterEqual((RM.suggest_estimate_minutes(rows) + match_min) * 60, real)   # 5 + 3 = 8 min

    def test_b4s_pace_with_no_card_term_under_ran_the_watched_run(self):
        rows, _cards, real = WATCHED
        old = max(1, math.ceil((RM.PACES["match_fixed_seconds"] + rows * RM.PACES["match_seconds_per_row"]) / 60))
        self.assertLess(old * 60, real)                                                 # 101.5 s -> 2 min < 143 s

    def test_without_the_card_term_the_fit_misses_the_watched_run(self):
        no_card = dict(RM.PACES, estimate_match_seconds_per_card=0.0)
        rows, cards, real = WATCHED
        self.assertLess(RM.match_estimate_minutes(rows, cards, no_card) * 60, real)    # 81.4 s -> 2 min


class TestCountRowsWithoutCard(FrappeTestCase):

    def setUp(self):
        self.plans = []

        def plan_sheet(boq, sheet_name, model, excel_rows=None):
            self.plans.append((boq, sheet_name, model, list(excel_rows)))
            todo = [r for r in excel_rows if r % 2]                  # odd rows have no valid card
            return {"batches": [{"rows": todo[i:i + 20]} for i in range(0, len(todo), 20)],
                    "reused": [r for r in excel_rows if not r % 2], "not_in_context": []}
        self.p = [patch.object(RM, "match_enabled", return_value=True),
                  patch("nirmaan_stack.services.boq_rate_match.cards.plan_sheet", side_effect=plan_sheet),
                  patch("nirmaan_stack.api.boq.wizard.ai_settings.get_boq_match_settings",
                        return_value={"match_enabled": True, "match_card_model": "card-model-x"})]
        for p in self.p:
            p.start()

    def tearDown(self):
        for p in reversed(self.p):
            p.stop()

    def test_login_is_required(self):
        with patch.object(frappe.local, "session", frappe._dict(user="Guest")):
            with self.assertRaises(frappe.PermissionError):
                RM.count_rows_without_card("B", "S", "[1]")

    def test_switch_off_says_so_and_reads_nothing(self):
        with patch.object(RM, "match_enabled", return_value=False):
            self.assertEqual(RM.count_rows_without_card("B", "S", "[1, 2]"), {"match_enabled": False})
        self.assertEqual(self.plans, [])

    def test_the_count_is_the_planners_to_do_rows(self):
        out = RM.count_rows_without_card("B", "S ", json.dumps(list(range(1, 46))))
        self.assertEqual(out, {"match_enabled": True, "rows": 45, "rows_without_card": 23})
        self.assertEqual(self.plans, [("B", "S ", "card-model-x", list(range(1, 46)))])   # the sheet name verbatim

    def test_rows_are_de_duplicated_and_sorted(self):
        RM.count_rows_without_card("B", "S", "[5, 3, 5, 4]")
        self.assertEqual(self.plans[0][3], [3, 4, 5])

    def test_no_card_model_counts_every_row(self):
        with patch("nirmaan_stack.api.boq.wizard.ai_settings.get_boq_match_settings",
                   return_value={"match_enabled": True, "match_card_model": None}):
            out = RM.count_rows_without_card("B", "S", "[2, 4, 6]")
        self.assertEqual(out, {"match_enabled": True, "rows": 3, "rows_without_card": 3})
        self.assertEqual(self.plans, [])

    def test_no_rows_is_zero(self):
        self.assertEqual(RM.count_rows_without_card("B", "S", "[]"),
                         {"match_enabled": True, "rows": 0, "rows_without_card": 0})

    def test_it_never_cards_sends_or_commits(self):
        with patch("nirmaan_stack.services.boq_rate_match.cards.card_sheet") as cs, \
                patch("nirmaan_stack.services.boq_rate_match.call_runner.make_client") as mc, \
                patch.object(frappe.db, "commit") as cm:
            RM.count_rows_without_card("B", "S", "[1, 2, 3]")
        cs.assert_not_called()
        mc.assert_not_called()
        cm.assert_not_called()

    def test_boq_and_sheet_are_required(self):
        with self.assertRaises(frappe.ValidationError):
            RM.count_rows_without_card(None, "S", "[1]")
