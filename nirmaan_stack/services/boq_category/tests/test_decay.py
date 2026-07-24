# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt
"""Unit tests for D1 proximity decay (rules side) in the classification runner.

Pure unittest, NO frappe, runnable without a live site (mirrors test_runner_electrical):

    python -m unittest nirmaan_stack.services.boq_category.tests.test_decay

Decay = ancestor influence weakens with degree of separation. The feed is ROOT-FIRST
(index 0 = sheet, last element = immediate parent), so distance d = (len-1)-index: immediate
parent d=0, grandparent d=1, ... An ancestor-signal rule that matches contributes ONCE, at the
NEAREST matching ancestor, with weight * (m ** d). m = the effective rules_multiplier; the decay
path is active only for 0 < m < 1.0 (m >= 1.0 / absent / malformed => flat, byte-identical).

Fixtures use REAL electrical ancestor rules against a PROVEN-neutral line description (so only the
ancestors score), and derive expectations FROM the flat run (not hardcoded weights):
  "SOCKET OUTLETS"      -> switches_sockets (ancestor rule SS, weight 0.4)
  "FLOOR SERVICE BOXES" -> popup_boxes      (ancestor rule, weight 0.5)
Filler ancestors ("aaa"/"bbb") match no rule. m=0.5 is the sweep multiplier under test.
"""
import json
import os
import unittest

from nirmaan_stack.services.boq_category.runner import classify_line, load_ruleset

# Proven-neutral: resolves to ABSTAIN on its own (see test_runner_electrical TestAbstain), so any
# resulting category comes purely from the ancestor chain.
NEUTRAL = "Providing all labour and supervision as per general conditions"
HALF = {"rules_multiplier": 0.5}


class TestConfigSurface(unittest.TestCase):
    """load_ruleset exposes a per-discipline decay dict. Electrical carries NO decay block and
    rides the flat default (LOCKED at 1.0 by its own D2/D2b sweep). HVAC wires one EXPLICITLY
    at HV-3 -- also measured flat, but on the record rather than by default."""

    def test_electrical_decay_locked_flat(self):
        # A10 backwards-compat lock: electrical behaviour must not move. Asserted twice --
        # the resolved value AND the absence of a decay block in its asset, so an accidental
        # HVAC-style edit to rules_electrical.json fails here.
        self.assertEqual(load_ruleset("Electrical")["decay"], {"rules_multiplier": 1.0})
        rules_electrical = os.path.join(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "rules_electrical.json")
        with open(rules_electrical, encoding="utf-8") as fh:
            self.assertNotIn("decay", json.load(fh),
                             msg="electrical decay is LOCKED flat by default -- do not wire a block")

    def test_hvac_decay_wired_explicitly_and_flat(self):
        # HV-3 (2026-07-20): was `defaults flat` (no block); HVAC now carries an explicit block.
        # The measured value is still 1.0 -- the sweep found no multiplier that beats flat.
        self.assertEqual(load_ruleset("HVAC")["decay"]["rules_multiplier"], 1.0)
        self.assertEqual(load_ruleset("HVAC")["decay"]["_fit"], "PROVISIONAL-FIT")


class TestDecayMechanism(unittest.TestCase):
    """(a)-(e): the core decay math on ancestor-signal rules."""

    # (a) POSITIVE: at m=0.5 a rule matching ONLY the immediate parent (d=0) keeps full weight --
    #     identical category/score/band to the flat single-parent run.
    def test_a_immediate_parent_d0_identical_to_flat(self):
        flat = classify_line(NEUTRAL, ["FLOOR SERVICE BOXES"])
        dec = classify_line(NEUTRAL, ["FLOOR SERVICE BOXES"], decay_override=HALF)
        self.assertEqual(dec["category_id"], "popup_boxes")
        self.assertEqual(flat["category_id"], dec["category_id"])
        self.assertEqual(flat["score"], dec["score"])
        self.assertEqual(flat["band"], dec["band"])

    # (b) POSITIVE: the SAME rule matching only at d=2 contributes weight * 0.25 -> score/band drop.
    def test_b_distance_two_decays_quarter_and_drops_band(self):
        flat = classify_line(NEUTRAL, ["FLOOR SERVICE BOXES"])  # d=0 baseline, MED (0.5)
        dec = classify_line(NEUTRAL, ["FLOOR SERVICE BOXES", "aaa", "bbb"], decay_override=HALF)
        self.assertEqual(dec["category_id"], "popup_boxes")
        self.assertEqual(dec["score"], round(flat["score"] * 0.25, 6))  # 0.5 -> 0.125
        self.assertEqual(flat["band"], "MED")
        self.assertEqual(dec["band"], "LOW")

    # (c) NEAR-BEATS-FAR: a weak near signal (d=0) outscores a strong far banner (d=2) -> winner
    #     flips vs the flat run of the SAME input.
    def test_c_near_beats_far_winner_flips(self):
        inp = ["FLOOR SERVICE BOXES", "aaa", "SOCKET OUTLETS"]  # far popup(0.5) ... near ss(0.4)
        flat = classify_line(NEUTRAL, inp)
        dec = classify_line(NEUTRAL, inp, decay_override=HALF)
        self.assertEqual(flat["category_id"], "popup_boxes")       # strong far wins flat
        self.assertEqual(dec["category_id"], "switches_sockets")   # near wins under decay
        self.assertNotEqual(flat["category_id"], dec["category_id"])

    # (d) NEAREST-MATCH-ONCE: a rule matching at d=0 AND d=3 contributes ONCE at d=0 full weight.
    def test_d_nearest_match_counted_once(self):
        flat_single = classify_line(NEUTRAL, ["FLOOR SERVICE BOXES"])  # 0.5 at d=0
        dec = classify_line(
            NEUTRAL, ["FLOOR SERVICE BOXES", "aaa", "bbb", "FLOOR SERVICE BOXES"], decay_override=HALF)
        self.assertEqual(dec["category_id"], "popup_boxes")
        self.assertEqual(dec["score"], flat_single["score"])  # 0.5, NOT 0.5 + 0.5*0.5**3
        popup_fired = [f for f in dec["signals_fired"] if f["category_id"] == "popup_boxes"]
        self.assertEqual(len(popup_fired), 1)
        self.assertEqual(popup_fired[0]["ancestor_distance"], 0)
        self.assertEqual(popup_fired[0]["decayed_weight"], round(flat_single["score"], 6))

    # (e) SILENT-PARENT FALL-THROUGH: immediate parent has no signal, the signal sits at d=1 ->
    #     contributes at m**1; silent ancestors are not special-cased.
    def test_e_silent_parent_signal_at_d1(self):
        flat_single = classify_line(NEUTRAL, ["SOCKET OUTLETS"])  # 0.4 at d=0
        dec = classify_line(NEUTRAL, ["SOCKET OUTLETS", "aaa silent parent"], decay_override=HALF)
        self.assertEqual(dec["category_id"], "switches_sockets")
        self.assertEqual(dec["score"], round(flat_single["score"] * 0.5, 6))  # 0.2
        ss_fired = [f for f in dec["signals_fired"] if f["category_id"] == "switches_sockets"]
        self.assertEqual(ss_fired[0]["ancestor_distance"], 1)


class TestDecayDefaultIdentity(unittest.TestCase):
    """(f) the guarantee: None and {rules_multiplier: 1.0} both == a pinned flat run, byte-for-byte."""

    def test_f_none_and_one_identical_to_flat_ancestor_input(self):
        inp = ["FLOOR SERVICE BOXES", "SOCKET OUTLETS"]
        base = classify_line(NEUTRAL, inp)  # no kwarg
        none_ = classify_line(NEUTRAL, inp, decay_override=None)
        one = classify_line(NEUTRAL, inp, decay_override={"rules_multiplier": 1.0})
        self.assertEqual(base, none_)
        self.assertEqual(base, one)

    def test_f_identity_on_geometry_multi_ancestor_input(self):
        # a richer multi-ancestor case (ancestor + geometry override) must also be untouched
        inp = ["Floor raceways with respective Junction Box", "Raceways"]
        base = classify_line("460 x 460 x 50mm Size", inp)
        one = classify_line("460 x 460 x 50mm Size", inp, decay_override={"rules_multiplier": 1.0})
        self.assertEqual(base, one)
        self.assertEqual(base["category_id"], "junction_box_raceway")


class TestDecayMalformed(unittest.TestCase):
    """(g) NEGATIVE: malformed / out-of-range decay_override -> treated as flat, no crash."""

    def test_g_malformed_overrides_fall_back_to_flat(self):
        inp = ["FLOOR SERVICE BOXES", "SOCKET OUTLETS"]
        flat = classify_line(NEUTRAL, inp)
        for bad in ({}, {"rules_multiplier": -0.5}, {"rules_multiplier": 0},
                    {"rules_multiplier": "x"}, {"rules_multiplier": True}, {"other": 0.5}):
            with self.subTest(bad=bad):
                self.assertEqual(classify_line(NEUTRAL, inp, decay_override=bad), flat)

    def test_g_multiplier_at_or_above_one_is_flat(self):
        inp = ["FLOOR SERVICE BOXES", "aaa", "bbb"]
        flat = classify_line(NEUTRAL, inp)
        self.assertEqual(classify_line(NEUTRAL, inp, decay_override={"rules_multiplier": 1.5}), flat)


class TestDecayInheritanceFallback(unittest.TestCase):
    """(h) FALLBACK PATH: _infer_from_ancestors under decay -- inherited category still capped
    below HIGH, and decayed by distance."""

    def test_h_inherited_category_decays_and_stays_below_high(self):
        tray = "Supply of perforated hot-dip galvanised tray 300mm wide"
        flat0 = classify_line("250 x 100mm", [tray])                       # inherit at d=0 (flat)
        dec1 = classify_line("250 x 100mm", [tray, "aaa child"], decay_override=HALF)  # tray at d=1
        self.assertEqual(flat0["category_id"], "cabletray_raceway")
        self.assertEqual(dec1["category_id"], "cabletray_raceway")
        self.assertIn("inherit", dec1["reason"].lower())
        self.assertNotEqual(dec1["band"], "HIGH")          # inheritance_cap keeps it below HIGH
        self.assertGreater(dec1["score"], 0.0)             # still a positive inherited signal
        self.assertLess(dec1["score"], flat0["score"])     # decayed by distance (d=1, m=0.5)


if __name__ == "__main__":
    unittest.main()
