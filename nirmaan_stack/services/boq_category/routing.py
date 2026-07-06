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
