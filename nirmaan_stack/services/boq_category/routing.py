# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""R3d vote-routing policy (Classifier CL-1a) -- PURE.

route_r3d(rule_result, ai_result, config) folds the rule runner's verdict and the
independent AI voter's verdict into one routing decision. This is the FIRST tracked
implementation of R3d (the recon confirmed no R3d logic existed before this slice).

Policy (design doc section 22 -- thresholds are CONFIG-DRIVEN, never hard-coded here
because R3d + prompt v1.3 are UNCERTIFIED until the Set-3 out-of-sample cycle):
  - AUTO-ACCEPT only a non-blank rule==AI consensus, EXCEPT a consensus whose rule
    band is the weak band (LOW) AND whose AI confidence sits in the weak window
    [ai_weak_low, ai_weak_high] (inclusive) -> that weak cell routes to human.
  - ALL disagreements route to human.
  - Mutual blank routes to human.
  - One-blank-one-category counts as a disagreement -> human.

A "Needs review" verdict ALWAYS carries a blank final_category_id (route-to-human is
never a category).

PURE: no DB, no Frappe, no I/O other than reading the JSON config once (lru_cache).
Unit-tested in nirmaan_stack/api/boq/wizard/test_row_category.py.
"""

import functools
import json
import os

_CONFIG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "routing_config.json")


@functools.lru_cache(maxsize=1)
def load_routing_config():
    """The R3d thresholds config (cached). Tests pass an explicit config to route_r3d to
    prove thresholds are read from config, never hard-coded in this module."""
    with open(_CONFIG_PATH, encoding="utf-8") as fh:
        return json.load(fh)


def route_r3d(rule_result, ai_result, config=None):
    """Route one row given the rule verdict and the AI verdict.

    rule_result: {"category_id": str, "band": str}  (category_id "" == abstain)
    ai_result:   {"category_id": str, "confidence": float}  (category_id "" == abstain)
    config:      the thresholds dict; defaults to load_routing_config().

    Returns {"routing": "Auto-accepted"|"Needs review", "final_category_id": str,
             "reason": str}. final_category_id is blank whenever routing is Needs review.
    """
    cfg = config if config is not None else load_routing_config()
    lo = cfg["ai_weak_low"]
    hi = cfg["ai_weak_high"]
    weak_band = cfg["weak_rule_band"]

    rc = (rule_result.get("category_id") or "").strip()
    rb = (rule_result.get("band") or "").strip()
    ac = (ai_result.get("category_id") or "").strip()
    try:
        aconf = float(ai_result.get("confidence"))
    except (TypeError, ValueError):
        aconf = 0.0

    def human(reason):
        return {"routing": "Needs review", "final_category_id": "", "reason": reason}

    # Mutual blank -> human.
    if not rc and not ac:
        return human("mutual blank -- both engines abstained")

    # One blank, one category -> disagreement -> human.
    if not rc or not ac:
        placed = rc or ac
        which = "rule" if rc else "ai"
        return human(f"one engine blank, one placed ({which}={placed}) -- disagreement")

    # Both non-blank but different -> disagreement -> human.
    if rc != ac:
        return human(f"disagreement -- rule={rc} ai={ac}")

    # Non-blank consensus. Weak cell: LOW rule band AND AI confidence in the weak window.
    if rb == weak_band and lo <= aconf <= hi:
        return human(
            f"weak consensus -- rule band {rb} and AI confidence {aconf:.2f} in [{lo}, {hi}]"
        )

    return {"routing": "Auto-accepted", "final_category_id": rc, "reason": f"consensus -- {rc}"}


# ---------------------------------------------------------------------------
# HV-7 -- the owner-signed per-discipline routing policy (v1). PURE.
#
# route_r3d above is UNTOUCHED and remains the legacy path for any discipline whose
# ruleset declares no "routing_policy" block (Electrical today).
#
# The policy VALUES are DATA, carried in the discipline's rules_<disc>.json
# "routing_policy" block -- never hard-coded here. In particular the demotion list is
# re-derived from the in-segment grid at every evaluation cycle, so it MUST stay
# config, not code.
# ---------------------------------------------------------------------------

def route_policy_v1(rule_result, ai_result, policy):
    """Route one row under the signed consensus-floor policy (HV-7).

    rule_result: {"category_id": str, "band": str}  (category_id "" == abstain)
    ai_result:   {"category_id": str, "confidence": float}
    policy:      the discipline's routing_policy block --
                 {"policy_id", "min_ai_confidence", "demoted_categories",
                  "priority_max_ai_confidence"}

    THE SIGNED SHAPE (owner 2026-07-21, from the HV-6b in-segment grid):
      AUTO-ACCEPT  iff rule and AI AGREE on the same NON-BLANK category
                   AND ai_confidence >= min_ai_confidence
                   AND that category is NOT in demoted_categories.
      REVIEW       everything else -- and a review verdict ALWAYS carries a BLANK
                   final_category_id. The votes are persisted separately; a blank
                   final is route-to-human, never a category (the blank-review
                   invariant, inherited from route_r3d).
      PRIORITY     within review: ai_confidence < priority_max_ai_confidence
                   OR both voters blank. Auto-accepted rows are never priority.

    Returns {"routing", "final_category_id", "reason", "review_priority"}.
    PURE: no DB, no Frappe, no I/O -- the caller supplies the policy dict.
    """
    floor = float(policy["min_ai_confidence"])
    demoted = set(policy.get("demoted_categories") or ())
    prio_below = float(policy["priority_max_ai_confidence"])

    rc = (rule_result.get("category_id") or "").strip()
    ac = (ai_result.get("category_id") or "").strip()
    try:
        aconf = float(ai_result.get("confidence"))
    except (TypeError, ValueError):
        aconf = 0.0

    def human(reason):
        # Priority tier: the AI is doubtful, or neither engine placed the row at all.
        priority = 1 if (aconf < prio_below or (not rc and not ac)) else 0
        return {
            "routing": "Needs review",
            "final_category_id": "",
            "reason": reason,
            "review_priority": priority,
        }

    if not rc and not ac:
        return human("mutual blank -- both engines abstained")
    if not rc or not ac:
        placed = rc or ac
        which = "rule" if rc else "ai"
        return human(f"one engine blank, one placed ({which}={placed}) -- disagreement")
    if rc != ac:
        return human(f"disagreement -- rule={rc} ai={ac}")
    if aconf < floor:
        return human(f"consensus {rc} but AI confidence {aconf:.2f} below floor {floor:.2f}")
    if rc in demoted:
        return human(f"consensus {rc} but the category is demoted to review")

    return {
        "routing": "Auto-accepted",
        "final_category_id": rc,
        "reason": f"consensus -- {rc} at AI confidence {aconf:.2f}",
        "review_priority": 0,
    }
