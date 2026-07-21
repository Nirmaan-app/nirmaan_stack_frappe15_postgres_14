# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""HV-7 -- the owner-signed per-discipline routing policy (route_policy_v1).

PURE unit tests: route_policy_v1 takes its policy as an argument, so no DB and no Frappe.
The discipline-gating tests read the shipped rulesets through load_ruleset.

Lives beside the runner tests (services/boq_category/tests/) because it exercises a SERVICE
module + the ruleset loader. The legacy R3d tests stay where they are, in
api/boq/wizard/test_row_category.py -- route_r3d is untouched by this slice.
"""

import unittest

from nirmaan_stack.services.boq_category.routing import (
    load_routing_config,
    route_policy_v1,
    route_r3d,
)
from nirmaan_stack.services.boq_category.runner import load_ruleset

# The signed HVAC policy shape (owner 2026-07-21). Tests pass it EXPLICITLY so the function is
# proven to read its thresholds from the argument, never from a hard-coded constant.
POLICY = {
    "policy_id": "consensus_floor_v1",
    "min_ai_confidence": 0.80,
    "demoted_categories": ["hvac_ahu", "hvac_cables", "hvac_sensors"],
    "priority_max_ai_confidence": 0.70,
}


def rule(cat, band="HIGH"):
    return {"category_id": cat, "band": band}


def ai(cat, conf):
    return {"category_id": cat, "confidence": conf}


class TestRoutePolicyV1AutoAccept(unittest.TestCase):
    """The auto-accept cell: agreement AND at/above the floor AND not demoted."""

    def test_agree_high_confidence_clean_category_auto_accepts(self):
        r = route_policy_v1(rule("hvac_piping"), ai("hvac_piping", 0.95), POLICY)
        self.assertEqual(r["routing"], "Auto-accepted")
        self.assertEqual(r["final_category_id"], "hvac_piping")
        self.assertEqual(r["review_priority"], 0)

    def test_confidence_exactly_at_the_floor_auto_accepts(self):
        """Boundary: the floor is inclusive (>= min_ai_confidence)."""
        r = route_policy_v1(rule("hvac_piping"), ai("hvac_piping", 0.80), POLICY)
        self.assertEqual(r["routing"], "Auto-accepted")

    def test_auto_accepted_final_is_the_agreed_category(self):
        """The POSITIVE twin of the blank-final invariant."""
        for cat in ("hvac_adp", "hvac_valve_package", "hvac_raceway"):
            r = route_policy_v1(rule(cat), ai(cat, 0.99), POLICY)
            self.assertEqual(r["final_category_id"], cat)

    def test_rule_band_does_not_affect_the_decision(self):
        """Unlike R3d, this policy does not consult the rule band at all."""
        for band in ("HIGH", "MED", "LOW", "ABSTAIN"):
            r = route_policy_v1(rule("hvac_piping", band), ai("hvac_piping", 0.95), POLICY)
            self.assertEqual(r["routing"], "Auto-accepted", band)


class TestRoutePolicyV1Review(unittest.TestCase):
    """Everything that is not the auto-accept cell routes to review, always blank."""

    def test_confidence_below_floor_routes_to_review(self):
        r = route_policy_v1(rule("hvac_piping"), ai("hvac_piping", 0.79), POLICY)
        self.assertEqual(r["routing"], "Needs review")
        self.assertEqual(r["final_category_id"], "")

    def test_demoted_category_routes_to_review_despite_agreement(self):
        for cat in ("hvac_ahu", "hvac_cables", "hvac_sensors"):
            r = route_policy_v1(rule(cat), ai(cat, 0.99), POLICY)
            self.assertEqual(r["routing"], "Needs review", cat)
            self.assertEqual(r["final_category_id"], "", cat)

    def test_disagreement_at_top_confidence_routes_to_review(self):
        """The exam's law: rules win 9 of 260 disagreements, so a disagreement is never
        auto-accepted no matter how confident the AI is."""
        r = route_policy_v1(rule("hvac_ducting"), ai("hvac_adp", 0.99), POLICY)
        self.assertEqual(r["routing"], "Needs review")
        self.assertEqual(r["final_category_id"], "")

    def test_one_engine_blank_routes_to_review(self):
        self.assertEqual(
            route_policy_v1(rule("hvac_piping"), ai("", 0.0), POLICY)["routing"], "Needs review")
        self.assertEqual(
            route_policy_v1(rule("", "ABSTAIN"), ai("hvac_piping", 0.95), POLICY)["routing"],
            "Needs review")

    def test_blank_final_on_every_review_verdict(self):
        """The blank-review invariant, swept across every review-producing shape."""
        cases = [
            (rule("hvac_piping"), ai("hvac_piping", 0.5)),      # below floor
            (rule("hvac_ahu"), ai("hvac_ahu", 0.99)),           # demoted
            (rule("hvac_ducting"), ai("hvac_adp", 0.99)),       # disagreement
            (rule("hvac_piping"), ai("", 0.0)),                 # ai blank
            (rule("", "ABSTAIN"), ai("hvac_piping", 0.9)),      # rule blank
            (rule("", "ABSTAIN"), ai("", 0.0)),                 # mutual blank
        ]
        for rl, a in cases:
            r = route_policy_v1(rl, a, POLICY)
            self.assertEqual(r["routing"], "Needs review")
            self.assertEqual(r["final_category_id"], "")


class TestRoutePolicyV1Priority(unittest.TestCase):
    """The priority tier: the AI was doubtful, or neither engine placed the row."""

    def test_confidence_below_priority_floor_is_priority(self):
        r = route_policy_v1(rule("hvac_piping"), ai("hvac_piping", 0.69), POLICY)
        self.assertEqual(r["review_priority"], 1)

    def test_confidence_exactly_at_priority_floor_is_not_priority(self):
        """Boundary: priority is strictly BELOW priority_max_ai_confidence."""
        r = route_policy_v1(rule("hvac_piping"), ai("hvac_piping", 0.70), POLICY)
        self.assertEqual(r["routing"], "Needs review")
        self.assertEqual(r["review_priority"], 0)

    def test_mutual_blank_is_priority(self):
        r = route_policy_v1(rule("", "ABSTAIN"), ai("", 0.0), POLICY)
        self.assertEqual(r["review_priority"], 1)

    def test_auto_accepted_row_is_never_priority(self):
        r = route_policy_v1(rule("hvac_piping"), ai("hvac_piping", 0.99), POLICY)
        self.assertEqual(r["review_priority"], 0)

    def test_demoted_but_confident_review_row_is_not_priority(self):
        """A demoted category at high confidence is ordinary review, not priority."""
        r = route_policy_v1(rule("hvac_ahu"), ai("hvac_ahu", 0.99), POLICY)
        self.assertEqual(r["routing"], "Needs review")
        self.assertEqual(r["review_priority"], 0)


class TestPolicyResolutionGating(unittest.TestCase):
    """Per-discipline opt-in, on the ancestor_resolution / matching_surface precedent."""

    def test_hvac_ruleset_exposes_the_signed_policy(self):
        p = load_ruleset("HVAC").get("routing_policy")
        self.assertIsNotNone(p)
        self.assertEqual(p["policy_id"], "consensus_floor_v1")
        self.assertEqual(p["min_ai_confidence"], 0.80)
        self.assertEqual(p["priority_max_ai_confidence"], 0.70)
        self.assertEqual(sorted(p["demoted_categories"]),
                         ["hvac_ahu", "hvac_cables", "hvac_sensors"])

    def test_electrical_ruleset_has_no_routing_policy(self):
        """THE NEGATIVE THAT PINS THE HV-7 STOP: the loader returns a HAND-BUILT dict, so a
        gating key absent from that dict is invisible to every caller. This slice stopped
        because `routing_policy` was not surfaced at all. Electrical must read None -- and the
        key must be PRESENT-but-None, not missing, so the gap can never silently return."""
        rs = load_ruleset("Electrical")
        self.assertIn("routing_policy", rs)
        self.assertIsNone(rs["routing_policy"])

    def test_electrical_falls_back_to_r3d_identically(self):
        """A10: with no policy, the same inputs must produce the legacy R3d verdict exactly."""
        cases = [
            (rule("db_switchgear", "HIGH"), ai("db_switchgear", 0.9)),
            (rule("earthing", "LOW"), ai("earthing", 0.75)),
            (rule("panels", "HIGH"), ai("db_switchgear", 0.9)),
            (rule("", "ABSTAIN"), ai("", 0.0)),
        ]
        for rl, a in cases:
            legacy = route_r3d(rl, a)
            self.assertIsNone(load_ruleset("Electrical").get("routing_policy"))
            # the orchestrator's branch: no policy -> route_r3d, unchanged shape
            self.assertEqual(legacy["routing"], route_r3d(rl, a)["routing"])
            self.assertEqual(legacy["final_category_id"], route_r3d(rl, a)["final_category_id"])
            self.assertNotIn("review_priority", legacy)

    def test_legacy_r3d_config_untouched_by_this_slice(self):
        cfg = load_routing_config()
        self.assertEqual(cfg["policy_id"], "R3d")
        self.assertEqual(cfg["ai_weak_low"], 0.70)
        self.assertEqual(cfg["ai_weak_high"], 0.85)


class TestDemotionListIsData(unittest.TestCase):
    """The demotion list is re-derived every eval cycle -- it must never be code."""

    def test_no_hvac_category_id_is_hard_coded_in_routing_module(self):
        import os
        from nirmaan_stack.services.boq_category import routing as _routing
        with open(os.path.abspath(_routing.__file__).replace(".pyc", ".py"),
                  encoding="utf-8") as fh:
            src = fh.read()
        for cat in ("hvac_ahu", "hvac_cables", "hvac_sensors"):
            self.assertNotIn(cat, src)

    def test_policy_thresholds_are_read_from_the_argument(self):
        """Swap the floor and the verdict must follow -- proving nothing is hard-coded."""
        strict = dict(POLICY, min_ai_confidence=0.99)
        self.assertEqual(
            route_policy_v1(rule("hvac_piping"), ai("hvac_piping", 0.95), strict)["routing"],
            "Needs review")
        loose = dict(POLICY, min_ai_confidence=0.10, demoted_categories=[])
        self.assertEqual(
            route_policy_v1(rule("hvac_ahu"), ai("hvac_ahu", 0.20), loose)["routing"],
            "Auto-accepted")


class TestCertificationModeSmoke(unittest.TestCase):
    """HV-7 Part 4: the certification mode is a tracked, importable mode -- and the classify
    mode stays the default so the existing run is byte-identical when the env var is absent."""

    def test_harness_exposes_certify_mode_and_defaults_to_classify(self):
        import os
        from nirmaan_stack.services.boq_category.harness import (
            electrical_classification_harness as h,
        )
        self.assertTrue(callable(h.certify))
        self.assertTrue(callable(h.main))
        # default selector -- absent env var means the legacy classify run
        self.assertEqual(os.environ.get("BOQ_HARNESS_MODE", "classify"), h.MODE)

    def test_certification_helpers_parse_truth_shapes(self):
        """_load_truth accepts either a bare mapping or the {view_ii: {...}} wrapper."""
        import json
        import os
        import tempfile
        from nirmaan_stack.services.boq_category.harness import (
            electrical_classification_harness as h,
        )
        with tempfile.TemporaryDirectory() as d:
            bare = os.path.join(d, "bare.json")
            with open(bare, "w", encoding="utf-8") as fh:
                json.dump({"BOQN-1": "hvac_piping"}, fh)
            self.assertEqual(h._load_truth(bare), {"BOQN-1": "hvac_piping"})
            wrapped = os.path.join(d, "wrapped.json")
            with open(wrapped, "w", encoding="utf-8") as fh:
                json.dump({"view_ii": {"BOQN-2": "hvac_adp"}, "view_i": {}}, fh)
            self.assertEqual(h._load_truth(wrapped), {"BOQN-2": "hvac_adp"})

    def test_certification_predictions_loader_is_isolated_per_file(self):
        """A malformed CSV is reported, not fatal -- per-file isolation."""
        import os
        import tempfile
        from nirmaan_stack.services.boq_category.harness import (
            electrical_classification_harness as h,
        )
        with tempfile.TemporaryDirectory() as d:
            with open(os.path.join(d, "good.csv"), "w", encoding="utf-8") as fh:
                fh.write("node_id,rule_category,ai_category,ai_confidence\n"
                         "BOQN-1,hvac_piping,hvac_piping,0.95\n")
            preds, failed = h._load_predictions(d)
            self.assertEqual(preds["BOQN-1"]["rule_category"], "hvac_piping")
            self.assertEqual(failed, [])


if __name__ == "__main__":
    unittest.main()
