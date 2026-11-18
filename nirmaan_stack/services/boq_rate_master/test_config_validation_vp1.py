"""VP-1 (2026-11-13) -- the keys the slice adds, accepted in their ruled form and refused in every other:

  `list_spec.pricing.scope` (N1, owner VR9 / QR-2 Q1 (a))  the scope pick on a category WITHOUT extras, + `model_attr`
  `list_spec.pricing.blank_unit_refuses` (N2, UNIT ruling)  a row with no unit refuses
  `material_text.map[].only_words` / `to_by_size` (N4, ANSWER 3)  isolation / type stated nowhere -> ball <= 40, butterfly above
  `list_spec.pricing.sheet_heading_notes` (N5, VR1)          the Piping valve-heading line (12a / 12b)
  `read_notes[].rule_line` (G4), `numbers[*].typed_dn` (G7)
  `scope_problems` / `extras_input_ids` for a pricing-level scope's uplift input

The ruled forms are read from the ONE fixture the frontend tests and the v66 mint share
(`frontend/src/pages/pricing/__fixtures__/valveModel.json`). Pure: the validator reads no database. Run:
bench --site localhost run-tests --module nirmaan_stack.services.boq_rate_master.test_config_validation_vp1
"""
import copy
import json
import os
import unittest

import frappe

from nirmaan_stack.services.boq_rate_master import config_validation as cv

APP = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
FIXTURE = os.path.join(APP, "frontend", "src", "pages", "pricing", "__fixtures__", "valveModel.json")
DATA = os.path.join(os.path.dirname(__file__), "data")


def fx():
    with open(FIXTURE, encoding="utf-8") as f:
        return json.load(f)


def valve():
    return dict(fx()["valve_config"], discipline="HVAC")


def piping_v65():
    with open(os.path.join(DATA, "rate_master_hvac_all_v65.json"), encoding="utf-8") as f:
        a = json.load(f)
    return dict(next(c for c in a["category_configs"] if c["category_id"] == "hvac_piping"), discipline="HVAC")


class TestVp1Keys(unittest.TestCase):
    def refuses(self, cfg, words):
        with self.assertRaises(frappe.ValidationError) as cm:
            cv._validate_config(cfg)
        self.assertIn(words, str(cm.exception))

    def test_01_ruled_forms_validate(self):
        f = fx()
        cv._validate_config(valve())
        cv._validate_config(dict(f["misc_config"], discipline="HVAC"))
        p = piping_v65()
        p["list_spec"]["pricing"]["sheet_heading_notes"] = f["piping_sheet_heading_notes"]
        cv._validate_config(p)

    def test_02_scope_refused_beside_extras_and_with_a_bad_model_attr(self):
        c = valve()
        c["list_spec"]["pricing"]["extras"] = {}
        self.refuses(c, "one scope per category")
        c = valve()
        c["list_spec"]["pricing"]["scope"]["model_attr"] = "no_such_question"
        self.refuses(c, "model_attr must name a choice question")
        c = valve()
        del c["list_spec"]["pricing"]["scope"]["lines"]
        self.refuses(c, "list_spec.pricing.scope needs exactly")

    def test_03_blank_unit_refuses_must_be_true(self):
        c = valve()
        c["list_spec"]["pricing"]["blank_unit_refuses"] = False
        self.refuses(c, "blank_unit_refuses must be true")

    def test_04_material_map_size_split(self):
        c = valve()
        c["list_spec"]["pricing"]["material_text"]["map"][1]["to_by_size"]["large"] = "Gate Valve"
        self.refuses(c, "to_by_size.large 'Gate Valve' is not a priceable family")
        c = valve()
        c["list_spec"]["pricing"]["material_text"]["map"][1]["to_by_size"]["attr"] = "length_m"
        self.refuses(c, "to_by_size.attr 'length_m' is not a number")
        c = valve()
        c["list_spec"]["pricing"]["material_text"]["map"][1]["only_words"] = []
        self.refuses(c, "only_words must be a non-empty list")
        c = valve()
        c["list_spec"]["pricing"]["material_text"]["map"][1]["surprise"] = 1
        self.refuses(c, "needs exactly all_of, to_by_unit_class, line and rule")

    def test_05_sheet_heading_notes(self):
        f = fx()
        p = piping_v65()
        n = copy.deepcopy(f["piping_sheet_heading_notes"])
        n[0]["with_rows"] = "no placeholder here"
        p["list_spec"]["pricing"]["sheet_heading_notes"] = n
        self.refuses(p, "{rows}")
        p = piping_v65()
        n = copy.deepcopy(f["piping_sheet_heading_notes"])
        n[0]["cap"] = 0
        p["list_spec"]["pricing"]["sheet_heading_notes"] = n
        self.refuses(p, "cap must be a positive whole number")
        p = piping_v65()
        p["list_spec"]["pricing"]["sheet_heading_notes"] = []
        self.refuses(p, "must be a non-empty list")

    def test_06_rule_line_and_typed_dn(self):
        c = valve()
        self.assertTrue(all("rule_line" in r for r in c["list_spec"]["pricing"]["read_notes"]))
        c = valve()
        c["list_spec"]["pricing"]["numbers"]["size_mm"].pop("typed_entry")
        self.refuses(c, "typed_dn must be true, on a reader with typed_entry 'one_size'")

    def test_06b_unstocked_per_item(self):
        c = valve()
        self.assertIs(c["list_spec"]["pricing"]["unstocked_materials"]["per_item"], True)
        cv._validate_config(c)
        c["list_spec"]["pricing"]["unstocked_materials"]["per_item"] = 1
        self.refuses(c, "per_item must be true, beside from_attr")
        c = valve()
        c["list_spec"]["pricing"]["unstocked_materials"].pop("from_attr")
        self.refuses(c, "per_item must be true, beside from_attr")

    def test_07_uplift_input_cross_check_and_used_by(self):
        f = fx()
        v = valve()
        self.assertEqual(cv.extras_input_ids(v), ["valve_install_only_uplift"])
        items = f["valve_items"] + [f["pricing_input"]]
        self.assertEqual(cv.scope_problems([v], items), [])
        self.assertEqual(len(cv.scope_problems([v], f["valve_items"])), 1)
        # NEGATIVE: a config without any scope reads no input; VRF's own (extras) stays with extras_input_ids' extras branch
        self.assertEqual(cv.extras_input_ids(piping_v65()), [])

    def test_08_misc_is_borrow_only_and_second_opinion_off(self):
        f = fx()
        self.assertEqual(f["misc_config"]["attribute_definitions"], [])
        self.assertIs(f["valve_config"]["list_spec"]["second_opinion"], False)
        self.assertIs(f["misc_config"]["list_spec"]["second_opinion"], False)


if __name__ == "__main__":
    unittest.main()
