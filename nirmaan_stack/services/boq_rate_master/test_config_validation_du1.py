"""DU-1 (2026-11-15) -- the display-only Derivation keys the slice adds, accepted in their ruled form and refused in every other:

  `list_spec.pricing.rule_lines`          (VP-DRV FIX-3) the tab's lines for rules written in CODE: a non-empty list of
      {rule, title[, detail]}, each a non-empty string, the rule ids unique
  `list_spec.pricing.derivation_reasons`  (owner 2026-11-15 14:33 "2 ok") a "why" per line: {why, and exactly one of rule / title},
      a title being a regular expression
  `list_spec.pricing.text_notes[].rule_line`  (FIX-1) the tab's own words for a note entry: a non-empty string

Read off the committed HVAC v69 valve config. Pure: the validator reads no database. Run:
bench --site localhost run-tests --module nirmaan_stack.services.boq_rate_master.test_config_validation_du1
"""
import copy
import json
import os
import unittest

import frappe

from nirmaan_stack.services.boq_rate_master import config_validation as cv

DATA = os.path.join(os.path.dirname(__file__), "data")


def valve_v69():
    with open(os.path.join(DATA, "rate_master_hvac_all_v69.json"), encoding="utf-8") as f:
        a = json.load(f)
    return dict(next(c for c in a["category_configs"] if c["category_id"] == "hvac_valve_package"), discipline="HVAC")


def with_pricing(**kw):
    c = copy.deepcopy(valve_v69())
    c["list_spec"]["pricing"].update(kw)
    return c


class TestDu1DerivationKeys(unittest.TestCase):
    def refuses(self, cfg, words):
        with self.assertRaises(frappe.ValidationError) as cm:
            cv._validate_config(cfg)
        self.assertIn(words, str(cm.exception))

    def test_rule_lines_ruled_form_accepted(self):
        cv._validate_config(with_pricing(rule_lines=[{"rule": "D1", "title": "A thermostat beside a PIBCV is part of it"},
                                                     {"rule": "D2", "title": "Dual plate", "detail": "over the flanged rule"}]))

    def test_rule_lines_refused_shapes(self):
        self.refuses(with_pricing(rule_lines=[]), "rule_lines must be a non-empty list")
        self.refuses(with_pricing(rule_lines=[{"rule": "D1"}]), "rule_lines[0].title must be a non-empty string")
        self.refuses(with_pricing(rule_lines=[{"rule": "D1", "title": "x", "why": "y"}]), "unknown key(s): why")
        self.refuses(with_pricing(rule_lines=[{"rule": "D1", "title": "x"}, {"rule": "D1", "title": "y"}]), "rule_lines[1].rule 'D1' is declared twice")
        self.refuses(with_pricing(rule_lines=[{"rule": "D1", "title": "x", "detail": ""}]), "rule_lines[0].detail must be a non-empty string")

    def test_derivation_reasons_ruled_form_accepted(self):
        cv._validate_config(with_pricing(derivation_reasons=[{"rule": "D1", "why": "owner D1 (owner, 2026-11-13)"},
                                                             {"title": "^The row's unit", "why": "units (owner, 2026-11-11)"}]))

    def test_derivation_reasons_refused_shapes(self):
        self.refuses(with_pricing(derivation_reasons=[{"why": "x"}]), "must carry exactly one of rule / title")
        self.refuses(with_pricing(derivation_reasons=[{"rule": "D1", "title": "x", "why": "y"}]), "must carry exactly one of rule / title")
        self.refuses(with_pricing(derivation_reasons=[{"title": "(", "why": "y"}]), "title must be a regular expression")
        self.refuses(with_pricing(derivation_reasons=[{"rule": "D1"}]), "why must be a non-empty string")

    def test_text_note_rule_line(self):
        c = copy.deepcopy(valve_v69())
        c["list_spec"]["pricing"]["text_notes"][0]["rule_line"] = "A valve row naming flanges carries the note"
        cv._validate_config(c)
        c["list_spec"]["pricing"]["text_notes"][0]["rule_line"] = " "
        self.refuses(c, "text_notes[0].rule_line must be a non-empty string")

    def test_absent_is_unchanged(self):
        cv._validate_config(valve_v69())   # v69 as committed carries none of the three


if __name__ == "__main__":
    unittest.main()
