"""DU-2 K1 (2026-11-16) -- the Ducting config keys the slice adds, accepted in their ruled form and refused in every other, and the
question builder's per-section family note:

  `family_alias_needs`       DU-1 cert finding a (owner 2026-11-15 23:29 "fix in DU 2"): the attributes an alias family reads
  `no_sku_refuse_default`    R-NOTE-ORDER (owner 2026-11-15 23:57): the re-file sentence for a non-duct no entry names
  `sections[*].family_note`  P0 defect (R-PAINT, owner 23:57): the borrower's own Misc family question -- Misc's note is the Valve
                             Package's ("a thermometer ...; a pressure gauge ...") and sent paint rows to "none of these"

Read off the committed HVAC v71 Ducting / Misc / Valve Package configs, with the keys added as the v72 mint adds them. Pure: neither the
validator nor the builder reads the database. Run:
bench --site localhost run-tests --module nirmaan_stack.services.boq_rate_master.test_config_validation_du2
"""
import copy
import json
import os
import unittest

import frappe

from nirmaan_stack.services.boq_rate_master import config_validation as cv
from nirmaan_stack.services.boq_rate_master import extraction

DATA = os.path.join(os.path.dirname(__file__), "data")
DUCT, MISC, VALVE = "hvac_ducting", "hvac_misc", "hvac_valve_package"
ROUND = "Round (GI) - per metre"
NOTE = "Which Misc item THIS row buys for the ducts: Paint (painting of ducts); answer 'none of these' for anything else."


def _asset(v):
    with open(os.path.join(DATA, f"rate_master_hvac_all_v{v}.json"), encoding="utf-8") as f:
        return json.load(f)


def _cfgs(v):
    return {c["category_id"]: dict(c, discipline="HVAC") for c in _asset(v)["category_configs"]}


class TestDu2DuctingKeys(unittest.TestCase):
    def setUp(self):
        self.all = _cfgs(71)
        d = copy.deepcopy(self.all[DUCT])
        pr = d["list_spec"]["pricing"]
        pr["family_alias_needs"] = {ROUND: ["thickness_mm", "dia_mm"]}
        pr["no_sku_refuse_default"] = "Reads as '{named}', not a duct - re-file this row under its own category"
        next(s for s in d["list_spec"]["sections"] if s["id"] == "misc")["family_note"] = NOTE
        self.duct = d

    def refuses(self, cfg, words):
        with self.assertRaises(frappe.ValidationError) as cm:
            cv._validate_config(cfg)
        self.assertIn(words, str(cm.exception))

    def mutated(self, fn):
        c = copy.deepcopy(self.duct)
        fn(c["list_spec"]["pricing"], c)
        return c

    def test_01_keys_accepted_in_their_ruled_form(self):
        cv._validate_config(copy.deepcopy(self.duct))

    def test_02_family_alias_needs_refusals(self):
        self.refuses(self.mutated(lambda p, c: p.__setitem__("family_alias_needs", {"Not an alias": ["dia_mm"]})), "is not a family_alias key")
        self.refuses(self.mutated(lambda p, c: p.__setitem__("family_alias_needs", {ROUND: ["no_such_attr"]})), "must list this config's priced attributes")
        self.refuses(self.mutated(lambda p, c: p.__setitem__("family_alias_needs", {ROUND: []})), "must list this config's priced attributes")
        self.refuses(self.mutated(lambda p, c: p.__setitem__("family_alias_needs", {})), "family_alias_needs must be a non-empty object")

    def test_03_no_sku_refuse_default_refusals(self):
        self.refuses(self.mutated(lambda p, c: p.__setitem__("no_sku_refuse_default", " ")), "no_sku_refuse_default must be a non-empty string")
        self.refuses(self.mutated(lambda p, c: p.pop("no_sku_refusals")), "no_sku_refuse_default needs no_sku_refusals")

    def test_04_family_note_refusals(self):
        def blank(p, c):
            next(s for s in c["list_spec"]["sections"] if s["id"] == "misc")["family_note"] = "  "
        self.refuses(self.mutated(blank), ".family_note must be a non-empty string")

        def on_own_section(p, c):
            next(s for s in c["list_spec"]["sections"] if "category_id" not in s)["family_note"] = NOTE
        self.refuses(self.mutated(on_own_section), "unknown key(s): family_note")

    def _misc_family_def(self, spec_):
        sec = next(s for s in spec_["sections"] if s["id"] == "misc")["items_spec"]
        fam = sec["family_attribute_id"]
        return next(d for d in sec["attribute_definitions"] if d["id"] == fam)

    def test_05_builder_pos_the_borrower_asks_with_its_own_family_note(self):
        cfgs = {("HVAC", k): v for k, v in self.all.items()}
        cfgs[("HVAC", DUCT)] = self.duct
        d = self._misc_family_def(extraction.build_items_spec(self.duct, cfgs, "HVAC"))
        self.assertEqual(d["note"], NOTE)
        self.assertEqual(d["values"], ["Paint", "Fire Retardant Spray Paint", "Air Balancing", "none of these"])

    def test_06_builder_neg_without_the_note_and_for_the_valve_package_nothing_changes(self):
        cfgs = {("HVAC", k): v for k, v in self.all.items()}
        misc_note = next(d for d in self.all[MISC]["list_spec"]["attribute_definitions"]
                         if d["id"] == self.all[MISC]["list_spec"]["family_attribute_id"])["note"].strip()
        # the asset's own Ducting config (no family_note) asks Misc's note, as before
        self.assertEqual(self._misc_family_def(extraction.build_items_spec(self.all[DUCT], cfgs, "HVAC"))["note"], misc_note)
        # the Valve Package's request is byte-identical whether or not Ducting carries the note
        before = json.dumps(extraction.build_items_spec(self.all[VALVE], cfgs, "HVAC"), sort_keys=True)
        cfgs[("HVAC", DUCT)] = self.duct
        after = json.dumps(extraction.build_items_spec(self.all[VALVE], cfgs, "HVAC"), sort_keys=True)
        self.assertEqual(before, after)
        self.assertEqual(self._misc_family_def(json.loads(after))["note"], misc_note)


if __name__ == "__main__":
    unittest.main()
