"""VP-4 (2026-11-14) -- the key the slice adds, accepted in its ruled form and refused in every other:

  `list_spec.pricing.text_notes[].unless` (T2, owner QR-1 Q2 (a))  the flange note is not shown on an item the model read as
      flanged = No, unless the row's own words name flanges: {attr, equals[, own_words]}

Read off the committed HVAC v67 valve config (the flange note), with `unless` added as the v68 mint adds it. Pure: the validator
reads no database. Run:
bench --site localhost run-tests --module nirmaan_stack.services.boq_rate_master.test_config_validation_vp4
"""
import copy
import json
import os
import unittest

import frappe

from nirmaan_stack.services.boq_rate_master import config_validation as cv

DATA = os.path.join(os.path.dirname(__file__), "data")
RULED = {"attr": "flanged", "equals": "No", "own_words": True}


def valve_v67():
    with open(os.path.join(DATA, "rate_master_hvac_all_v67.json"), encoding="utf-8") as f:
        a = json.load(f)
    return dict(next(c for c in a["category_configs"] if c["category_id"] == "hvac_valve_package"), discipline="HVAC")


def with_unless(unless):
    c = copy.deepcopy(valve_v67())
    tn = [t for t in c["list_spec"]["pricing"]["text_notes"] if t.get("pattern") == "flang"]
    assert len(tn) == 1, len(tn)
    tn[0]["unless"] = unless
    return c


class TestVp4TextNoteUnless(unittest.TestCase):
    def refuses(self, cfg, words):
        with self.assertRaises(frappe.ValidationError) as cm:
            cv._validate_config(cfg)
        self.assertIn(words, str(cm.exception))

    def test_01_v67_and_the_ruled_unless_validate(self):
        cv._validate_config(valve_v67())                          # NEGATIVE baseline: v67 (no unless) still valid
        cv._validate_config(with_unless(dict(RULED)))             # POSITIVE: the ruled form
        cv._validate_config(with_unless({"attr": "flanged", "equals": "No"}))   # own_words is optional

    def test_02_bad_shapes_refused(self):
        self.refuses(with_unless("flanged=No"), ".unless must be {attr, equals[, own_words]}")
        self.refuses(with_unless({"attr": "flanged"}), ".unless must be")
        self.refuses(with_unless({"attr": "no_such_attr", "equals": "No"}), ".unless must be")
        self.refuses(with_unless({"attr": "flanged", "equals": " "}), ".unless must be")
        self.refuses(with_unless({"attr": "flanged", "equals": "No", "own_words": "yes"}), ".unless must be")
        self.refuses(with_unless({"attr": "flanged", "equals": "No", "extra": 1}), ".unless must be")

    def test_03_unknown_keys_still_refused(self):
        c = with_unless(dict(RULED))
        next(t for t in c["list_spec"]["pricing"]["text_notes"] if t.get("pattern") == "flang")["otherwise"] = 1
        self.refuses(c, "unknown key(s): otherwise")


if __name__ == "__main__":
    unittest.main()
