# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt
"""Unit tests for the HVAC category assets + discipline unlock (Build slice HV-1).

Pure unittest, NO frappe, runnable without a live site (mirrors test_runner_electrical):

    python -m unittest nirmaan_stack.services.boq_category.tests.test_runner_hvac

Covers: the HVAC ruleset loads + validates (every rule targets a known category),
unknown disciplines still raise, per-category positives resolve non-ABSTAIN, the
mandated collision guards land correctly (cassette ambiguity, damper->ADP, drain->piping,
double-skin->not panels, drain-pump guard, VRF-cabling->cables), and the AI voter prompt
path resolves per discipline (path-level, no API call). The fixture line strings are
illustrative SHAPES grounded in the committed HVAC corpus vocabulary; not copied verbatim.
"""
import unittest

from nirmaan_stack.services.boq_category.runner import classify_line, load_ruleset


class TestHvacAssetsWellFormed(unittest.TestCase):
    """The 16 frozen HVAC categories load; every rule targets a known category."""

    def test_frozen_category_set(self):
        cats = {c["category_id"] for c in load_ruleset("HVAC")["categories"]}
        expected = {
            "hvac_ducting", "hvac_adp", "hvac_piping", "hvac_insulation",
            "hvac_valve_package", "hvac_vav_box", "hvac_sensors", "hvac_fans",
            "hvac_chw_units", "hvac_dx_unit", "hvac_vrf", "hvac_cables",
            "hvac_ahu", "hvac_panels", "hvac_pumps", "hvac_misc",
        }
        self.assertEqual(cats, expected)
        self.assertEqual(len(cats), 16)

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
        self.assertEqual(len(hv), 16)
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


class TestAiVoterPromptResolution(unittest.TestCase):
    """HV-1 seam: the AI voter resolves its prompt file per discipline (path-level, no API)."""

    def test_hvac_prompt_path_resolves_and_reads(self):
        import os
        from nirmaan_stack.services.boq_category import ai_voter
        p = ai_voter._prompt_path("HVAC")
        self.assertTrue(p.endswith("hvac_ai_category_prompt.md"))
        self.assertTrue(os.path.exists(p))
        text = ai_voter._read_prompt("HVAC")
        self.assertIn("hvac-v1.0", text)
        self.assertIn("hvac_ducting", text)
        self.assertEqual(ai_voter._parse_prompt_version(text), "hvac-v1.0")

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
