# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt
"""Unit tests for the HVAC category assets + discipline unlock (Build slices HV-1, HV-3).

Pure unittest, NO frappe, runnable without a live site (mirrors test_runner_electrical):

    python -m unittest nirmaan_stack.services.boq_category.tests.test_runner_hvac

Covers: the HVAC ruleset loads + validates (every rule targets a known category),
unknown disciplines still raise, per-category positives resolve non-ABSTAIN, the
mandated collision guards land correctly (cassette ambiguity, damper->ADP, drain->piping,
double-skin->not panels, drain-pump guard, VRF-cabling->cables), and the AI voter prompt
path resolves per discipline (path-level, no API call). The fixture line strings are
illustrative SHAPES grounded in the committed HVAC corpus vocabulary; not copied verbatim.

HV-3 adds the ruleset-v1 behaviours measured against the Set-1 labels: the 17th category
hvac_raceway and its carve-out from Cables (guards both ways), the H4 insulation-as-attribute
guard (the owner's 4A ruling), the KEPT-not-amplified ADP ancestor signal, the provisional
BTU-meter rule, and the explicitly-wired HVAC decay curve.
"""
import json
import os
import unittest

from nirmaan_stack.services.boq_category.runner import classify_line, load_ruleset

# Proven-neutral line: resolves to ABSTAIN on its own (see TestHvacContract), so any resulting
# category comes purely from the ancestor chain. Same fixture idiom as test_decay.
NEUTRAL = "Providing all labour and supervision as per general conditions"


class TestHvacAssetsWellFormed(unittest.TestCase):
    """The 17 frozen HVAC categories load; every rule targets a known category."""

    def test_frozen_category_set(self):
        cats = {c["category_id"] for c in load_ruleset("HVAC")["categories"]}
        expected = {
            "hvac_ducting", "hvac_adp", "hvac_piping", "hvac_insulation",
            "hvac_valve_package", "hvac_vav_box", "hvac_sensors", "hvac_fans",
            "hvac_chw_units", "hvac_dx_unit", "hvac_vrf", "hvac_cables",
            "hvac_ahu", "hvac_panels", "hvac_pumps", "hvac_misc",
            "hvac_raceway",  # HV-3 owner ruling: trays/raceways price separately from cabling
        }
        self.assertEqual(cats, expected)
        self.assertEqual(len(cats), 17)

    def test_raceway_category_names_match_the_owner_brief(self):
        cat = next(c for c in load_ruleset("HVAC")["categories"]
                   if c["category_id"] == "hvac_raceway")
        self.assertEqual(cat["name"], "Raceway")
        self.assertEqual(cat["description"], "cable trays, raceways, and tray accessories")

    def test_every_rule_targets_a_known_category(self):
        rs = load_ruleset("HVAC")
        cats = {c["category_id"] for c in rs["categories"]}
        for rule in rs["rules"]:
            self.assertIn(rule["category_id"], cats,
                          msg=f"rule {rule.get('rule_id')} targets unknown {rule['category_id']}")
            self.assertTrue(rule.get("rule_id"))
            self.assertTrue(rule.get("source"))
            self.assertTrue(rule.get("plain"))

    def test_unknown_discipline_still_raises(self):
        with self.assertRaises(ValueError):
            load_ruleset("ELV")

    def test_hvac_and_electrical_both_load_distinct(self):
        hv = {c["category_id"] for c in load_ruleset("HVAC")["categories"]}
        el = {c["category_id"] for c in load_ruleset("Electrical")["categories"]}
        self.assertEqual(len(hv), 17)
        self.assertEqual(len(el), 15)
        self.assertEqual(hv & el, set())  # no id collision across disciplines


class TestHvacPerCategory(unittest.TestCase):
    """A representative line per (sampled) category resolves to that category, non-ABSTAIN."""

    def _c(self, desc, anc=None):
        return classify_line(desc, anc or [], discipline="HVAC")

    def test_ducting_line(self):
        r = self._c("0.63 mm (24 SWG) GSS ducting up to 750mm")
        self.assertEqual(r["category_id"], "hvac_ducting")
        self.assertNotEqual(r["band"], "ABSTAIN")

    def test_vrf_odu_line(self):
        r = self._c("36 HP VRF / VRV ODU top discharge")
        self.assertEqual(r["category_id"], "hvac_vrf")
        self.assertNotEqual(r["band"], "ABSTAIN")

    def test_valve_line(self):
        r = self._c("Supply and installation of 100 mm butterfly valve")
        self.assertEqual(r["category_id"], "hvac_valve_package")
        self.assertNotEqual(r["band"], "ABSTAIN")

    def test_ahu_line(self):
        r = self._c("Office AHU 50 TR 20000 CFM recirculating air handling unit")
        self.assertEqual(r["category_id"], "hvac_ahu")
        self.assertNotEqual(r["band"], "ABSTAIN")

    def test_insulation_line(self):
        r = self._c("50mm thick nitrile elastomeric acoustic lining insulation")
        self.assertEqual(r["category_id"], "hvac_insulation")
        self.assertNotEqual(r["band"], "ABSTAIN")

    def test_vav_line(self):
        r = self._c("Supply, installation & commissioning of VAV boxes")
        self.assertEqual(r["category_id"], "hvac_vav_box")
        self.assertNotEqual(r["band"], "ABSTAIN")


class TestHvacCollisions(unittest.TestCase):
    """The mandated collision guards: cassette ambiguity, damper, drain, panels, pump, cables."""

    def _c(self, desc, anc=None):
        return classify_line(desc, anc or [], discipline="HVAC")

    def test_bare_cassette_not_high(self):
        # no CHW / VRF / split context -> ambiguous -> must NOT be HIGH.
        r = self._c("1TR cassette unit")
        self.assertNotEqual(r["band"], "HIGH")

    def test_fire_damper_is_adp_not_ducting(self):
        r = self._c("Supply of 600x600 fire damper")
        self.assertEqual(r["category_id"], "hvac_adp")
        self.assertNotEqual(r["category_id"], "hvac_ducting")

    def test_drain_piping_is_piping(self):
        r = self._c("CPVC drain piping 40mm dia")
        self.assertEqual(r["category_id"], "hvac_piping")

    def test_double_skin_panel_not_panels(self):
        # a double-skin panel is AHU/plenum casing, never an electrical/control panel.
        r = self._c("50mm thick double skin panel for AHU plenum")
        self.assertNotEqual(r["category_id"], "hvac_panels")
        self.assertEqual(r["all_scores"].get("hvac_panels", 0.0), 0.0)

    def test_drain_pump_not_pumps(self):
        # a unit drain pump is the unit's, not a CHW pump set.
        r = self._c("1 TR hi wall unit with drain pump and drip tray")
        self.assertEqual(r["all_scores"].get("hvac_pumps", 0.0), 0.0)

    def test_vrf_cabling_is_cables(self):
        # owner rule: control cabling between ODU and IDU is Cables, not VRF.
        r = self._c("2C x 1.5 sqmm control cabling between ODU and IDU")
        self.assertEqual(r["category_id"], "hvac_cables")
        self.assertEqual(r["all_scores"].get("hvac_vrf", 0.0), 0.0)


class TestHvacContract(unittest.TestCase):
    """Output-contract invariants carried over from the shared runner."""

    def test_score_in_unit_interval(self):
        for desc in ["36 HP VRF / VRV ODU", "GSS ducting 24 SWG", "no hvac signal at all here"]:
            r = classify_line(desc, [], discipline="HVAC")
            self.assertGreaterEqual(r["score"], 0.0)
            self.assertLessEqual(r["score"], 1.0)
            for v in r["all_scores"].values():
                self.assertGreaterEqual(v, 0.0)
                self.assertLessEqual(v, 1.0)

    def test_no_signal_abstains_blank(self):
        r = classify_line("Providing all labour and supervision as per general conditions", [],
                          discipline="HVAC")
        self.assertEqual(r["category_id"], "")
        self.assertEqual(r["band"], "ABSTAIN")
        self.assertEqual(r["score"], 0.0)


class TestHvacRacewayCarveOut(unittest.TestCase):
    """HV-3 change (a): hvac_raceway owns trays/raceways; Cables is cabling only.
    Guards run BOTH ways -- a tray line never scores Cables, a unit drip tray never
    scores Raceway."""

    def _c(self, desc, anc=None):
        return classify_line(desc, anc or [], discipline="HVAC")

    def test_cable_tray_line_is_raceway_not_cables(self):
        # POSITIVE: the line contains the word 'cable', so without CBL-TRAY-EXCL the Cables
        # keyword rule would claim it. The carve-out guard must zero Cables outright.
        r = self._c("300mm wide perforated GI cable tray with cover")
        self.assertEqual(r["category_id"], "hvac_raceway")
        self.assertEqual(r["all_scores"].get("hvac_cables", 0.0), 0.0)

    def test_plain_cable_line_is_cables_not_raceway(self):
        # NEGATIVE (the other direction): a genuine conductor line stays Cables and must not
        # leak into the new category.
        r = self._c("2C x 2.5 sqmm control cable for VRF ODU to IDU")
        self.assertEqual(r["category_id"], "hvac_cables")
        self.assertEqual(r["all_scores"].get("hvac_raceway", 0.0), 0.0)

    def test_unit_drip_tray_is_not_raceway(self):
        # NEGATIVE false-friend: 'tray' in a terminal-unit line is a drip tray, not a raceway.
        r = self._c("1 TR hi wall unit with drip tray")
        self.assertEqual(r["all_scores"].get("hvac_raceway", 0.0), 0.0)
        self.assertNotEqual(r["category_id"], "hvac_raceway")

    def test_raceway_inherits_to_a_bare_size_leaf(self):
        # A bare dimension leaf under a cable-tray section inherits Raceway (the shape the
        # Set-1 corpus actually uses for tray quantities).
        r = self._c(NEUTRAL, ["CABLE TRAY AND ACCESSORIES"])
        self.assertEqual(r["category_id"], "hvac_raceway")


class TestHvacInsulationAttributeGuard(unittest.TestCase):
    """HV-3 change (b) / hypothesis H4 / the owner's 4A ruling: an insulation word that is an
    ATTRIBUTE of a pipe or valve line does not make the line Insulation."""

    def _c(self, desc, anc=None):
        return classify_line(desc, anc or [], discipline="HVAC")

    def test_insulated_pipe_is_not_insulation(self):
        # NEGATIVE: 'Insulated ... pipe' -- the pipe owns the line.
        r = self._c("Insulated MS pipe 150 NB")
        self.assertEqual(r["all_scores"].get("hvac_insulation", 0.0), 0.0)
        self.assertEqual(r["category_id"], "hvac_piping")

    def test_composite_pipe_with_insulation_is_not_insulation(self):
        # NEGATIVE: the 4A composite -- a refrigerant pipe size leaf that bundles its insulation.
        r = self._c('5/8 " dia (15.6 MM) with 13 mm insulation', ["REFRIGERANT PIPE"])
        self.assertEqual(r["all_scores"].get("hvac_insulation", 0.0), 0.0)
        self.assertEqual(r["category_id"], "hvac_piping")

    def test_insulated_valve_is_not_insulation(self):
        # NEGATIVE: the same ruling on the valve side.
        r = self._c("Insulated butterfly valve 100 mm dia")
        self.assertEqual(r["all_scores"].get("hvac_insulation", 0.0), 0.0)
        self.assertEqual(r["category_id"], "hvac_valve_package")

    def test_standalone_insulation_still_wins(self):
        # POSITIVE CONTROL: the guard must not over-fire. When insulation is the SUBJECT of the
        # line it still claims the row -- otherwise the guard would have gutted the category.
        r = self._c("50mm thick nitrile elastomeric insulation")
        self.assertEqual(r["category_id"], "hvac_insulation")
        self.assertNotEqual(r["band"], "ABSTAIN")


class TestHvacAdpAncestorSignal(unittest.TestCase):
    """HV-3 change (c) as SHIPPED: hypothesis H2 proposed DELETING the 'air distribution'
    ancestor token; the Set-1 labels reversed that, so the token is KEPT. Raising its weight
    was then measured and REJECTED (52.86% -> 50.29%), so the weight stays 0.4."""

    def test_air_distribution_ancestor_still_places_adp(self):
        # POSITIVE: the token H2 wanted deleted still does its job on a bare child.
        r = classify_line(NEUTRAL, ["AIR DISTRIBUTION SYSTEM"], discipline="HVAC")
        self.assertEqual(r["category_id"], "hvac_adp")
        self.assertNotEqual(r["band"], "ABSTAIN")

    def test_adp_ancestor_weight_not_amplified(self):
        # NEGATIVE / regression lock: ADP-ANC must stay at 0.4 so it does NOT outrank the
        # sibling 0.45 ancestors. This is the exact regression the measurement caught.
        rule = next(r for r in load_ruleset("HVAC")["rules"] if r["rule_id"] == "ADP-ANC")
        self.assertEqual(rule["weight"], 0.4)

    def test_ducting_ancestor_beats_adp_ancestor(self):
        # NEGATIVE: with both section headers present, a ducting header must still win --
        # this is the 45-row pile that raising ADP-ANC would have taken.
        r = classify_line(NEUTRAL, ["AIR DISTRIBUTION SYSTEM", "GI DUCTING WORK"], discipline="HVAC")
        self.assertEqual(r["category_id"], "hvac_ducting")


class TestHvacMeterProvisionalRule(unittest.TestCase):
    """HV-3 change (d): H1 and H7 were REFUTED, so neither proposed edit was applied. A WEAK
    provisional BTU/energy-meter -> Valve Package rule was added in H7's place."""

    def test_btu_meter_is_valve_package_and_stays_low(self):
        r = classify_line("BTU meters -Ultrasonic type with accessories", [], discipline="HVAC")
        self.assertEqual(r["category_id"], "hvac_valve_package")
        # Deliberately weak: a provisional read must stay visible for review, never assert HIGH.
        self.assertEqual(r["band"], "LOW")

    def test_no_btu_to_sensors_rule_was_added(self):
        # NEGATIVE: H7's actual proposal (meters -> Sensors) was refuted 0/31 and must be absent.
        for rule in load_ruleset("HVAC")["rules"]:
            if rule["category_id"] == "hvac_sensors":
                self.assertNotIn("btu meter", [m.lower() for m in rule.get("match", [])])

    def test_h1_duct_keywords_were_not_added(self):
        # NEGATIVE: H1 was refuted (15.6%); its proposed bare duct tokens must NOT be in DUCT-KW.
        duct_kw = next(r for r in load_ruleset("HVAC")["rules"] if r["rule_id"] == "DUCT-KW")
        for tok in ("duct", "round duct", "elliptical duct", "flexible duct"):
            self.assertNotIn(tok, duct_kw["match"])


class TestHvacDecayConfig(unittest.TestCase):
    """HV-3 Part 3: the HVAC decay curve is wired EXPLICITLY and measured FLAT."""

    _RULES = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                          "rules_hvac.json")

    def test_hvac_decay_block_is_explicit_and_flat(self):
        with open(self._RULES, encoding="utf-8") as fh:
            doc = json.load(fh)
        self.assertIn("decay", doc, msg="HV-3 wires the HVAC decay curve explicitly")
        self.assertEqual(doc["decay"]["rules_multiplier"], 1.0)
        self.assertEqual(doc["decay"]["_fit"], "PROVISIONAL-FIT")
        self.assertEqual(load_ruleset("HVAC")["decay"]["rules_multiplier"], 1.0)

    def test_hvac_near_ancestor_beats_far_under_decay(self):
        # The decay MECHANISM is live for HVAC assets even though the shipped curve is flat:
        # a far tray banner (d=2) loses to a near valves header (d=0) once a multiplier applies.
        inp = ["CABLE TRAY AND ACCESSORIES", "aaa", "VALVES"]
        flat = classify_line(NEUTRAL, inp, discipline="HVAC")
        near = classify_line(NEUTRAL, inp, discipline="HVAC",
                             decay_override={"rules_multiplier": 0.5})
        self.assertEqual(flat["category_id"], "hvac_raceway")            # far banner wins flat
        self.assertEqual(near["category_id"], "hvac_valve_package")      # near wins under decay
        self.assertNotEqual(flat["category_id"], near["category_id"])


class TestAiVoterPromptResolution(unittest.TestCase):
    """HV-1 seam: the AI voter resolves its prompt file per discipline (path-level, no API)."""

    def test_hvac_prompt_path_resolves_and_reads(self):
        import os
        from nirmaan_stack.services.boq_category import ai_voter
        p = ai_voter._prompt_path("HVAC")
        self.assertTrue(p.endswith("hvac_ai_category_prompt.md"))
        self.assertTrue(os.path.exists(p))
        text = ai_voter._read_prompt("HVAC")
        self.assertIn("hvac-v1.1", text)
        self.assertIn("hvac_ducting", text)
        self.assertIn("hvac_raceway", text)  # HV-3: the 17th category is in the AI category list
        self.assertEqual(ai_voter._parse_prompt_version(text), "hvac-v1.1")

    def test_electrical_prompt_path_unchanged(self):
        from nirmaan_stack.services.boq_category import ai_voter
        p = ai_voter._prompt_path("Electrical")
        self.assertTrue(p.endswith("electrical_ai_category_prompt.md"))
        # default arg stays Electrical (no signature break for existing callers)
        self.assertEqual(ai_voter._prompt_path(), p)

    def test_unknown_discipline_prompt_raises(self):
        from nirmaan_stack.services.boq_category import ai_voter
        with self.assertRaises(ValueError):
            ai_voter._prompt_path("ELV")


if __name__ == "__main__":
    unittest.main()
