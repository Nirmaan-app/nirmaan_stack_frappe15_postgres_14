"""DU-1 PART B (2026-11-15) -- the Ducting config keys the slice adds, accepted in their ruled form and refused in every other, and the
question builder's section-family filter:

  `numbers[*].gauge`                  DR2 / DR3 / DR4 / DR12: the sheet-gauge axis (mm, standard thicknesses, size table, wording)
  `numbers[*].offered`                DR17 + NOTE 3: a typed_only box's dropdown values (with panel_controls dropdown_or_other)
  `families[*].convert[*].direct`     Q4 + NOTE 3: a DIRECT unit conversion (sq.ft -> sq.m) that reads no fact -- needs exactly []
  `sheet_insulation`                  DR7 / G-3: the per-sheet duct-insulation check (mode, limits, lines)
  `sections[*].area_basis`            DR5 round: a borrowed section on a per-metre row priced by area
  `scope.supply_row.uplift`           G-4: the supply-on-its-own-row case charges the uplift
  `family_alias_offered`              DR1: an alias offered in the kind list
  `no_sku_refusals`                   DR13: words that refuse a row with their own sentence
  roundup `params.mode: "half_up"`    QR-1 (c): Excel ROUND on the round per-metre pipeline

Read off the committed HVAC v71 Ducting / Misc configs. Pure: neither the validator nor the builder reads the database. Run:
bench --site localhost run-tests --module nirmaan_stack.services.boq_rate_master.test_config_validation_du1b
"""
import copy
import json
import os
import unittest

import frappe

from nirmaan_stack.services.boq_rate_master import config_validation as cv
from nirmaan_stack.services.boq_rate_master import extraction

DATA = os.path.join(os.path.dirname(__file__), "data")


def _asset(v):
    with open(os.path.join(DATA, f"rate_master_hvac_all_v{v}.json"), encoding="utf-8") as f:
        return json.load(f)


def _cfg(v, cid):
    return dict(next(c for c in _asset(v)["category_configs"] if c["category_id"] == cid), discipline="HVAC")


DUCT = "hvac_ducting"


class TestDu1bDuctingKeys(unittest.TestCase):
    def setUp(self):
        self.duct = _cfg(71, DUCT)
        self.misc = _cfg(71, "hvac_misc")

    def pr(self, c=None):
        return (c or self.duct)["list_spec"]["pricing"]

    def refuses(self, cfg, words):
        with self.assertRaises(frappe.ValidationError) as cm:
            cv._validate_config(cfg)
        self.assertIn(words, str(cm.exception))

    def mutated(self, fn, base=None):
        c = copy.deepcopy(base or self.duct)
        fn(c["list_spec"]["pricing"], c)
        return c

    def test_v71_ducting_and_misc_accepted_as_minted(self):
        cv._validate_config(copy.deepcopy(self.duct))
        cv._validate_config(copy.deepcopy(self.misc))

    def test_gauge_refused_shapes(self):
        loc = "list_spec.pricing.numbers['thickness_mm'].gauge"
        g = lambda p: p["numbers"]["thickness_mm"]["gauge"]
        self.refuses(self.mutated(lambda p, c: g(p).pop("lines")), f"{loc} needs families, mm, standard_mm, lines")
        self.refuses(self.mutated(lambda p, c: g(p).__setitem__("families", ["Not A Family"])), f"{loc}.families must be a non-empty list of priceable families")
        self.refuses(self.mutated(lambda p, c: g(p)["mm"].__setitem__("24", -1)), f"{loc}.mm must map gauge numbers to positive mm")
        self.refuses(self.mutated(lambda p, c: g(p)["standard_mm"][0].__setitem__("from", 9)), f"{loc}.standard_mm[0] must be")
        self.refuses(self.mutated(lambda p, c: g(p)["by_size"]["bands"]["Rectangular (GI)"].reverse()), "by_size.bands['Rectangular (GI)'][0] must be {max, gauge}")
        self.refuses(self.mutated(lambda p, c: g(p)["lines"].pop("thicker")), f"{loc}.lines needs exactly")

    def test_offered_refused_shapes(self):
        loc = "list_spec.pricing.numbers['dia_mm'].offered"
        d = lambda p: p["numbers"]["dia_mm"]
        self.refuses(self.mutated(lambda p, c: d(p).__setitem__("offered", [])), f"{loc} must be a non-empty list of distinct positive numbers")
        self.refuses(self.mutated(lambda p, c: d(p).__setitem__("offered", [80, 80])), f"{loc} must be a non-empty list of distinct positive numbers")
        self.refuses(self.mutated(lambda p, c: d(p).__setitem__("offered", ["80"])), f"{loc} must be a non-empty list of distinct positive numbers")
        self.refuses(self.mutated(lambda p, c: p["panel_controls"].__setitem__("dia_mm", "text")), f"{loc} needs panel_controls['dia_mm'] = 'dropdown_or_other'")

    def test_direct_conversion(self):
        conv = lambda p: p["families"]["Paint"]["convert"]["carpet_area"][0]
        self.assertIs(conv(self.pr(self.misc))["direct"], True)
        self.assertEqual(conv(self.pr(self.misc))["needs"], [])
        self.refuses(self.mutated(lambda p, c: conv(p).__setitem__("direct", False), self.misc), "direct must be exactly true")
        self.refuses(self.mutated(lambda p, c: conv(p).__setitem__("needs", ["size_mm"]), self.misc), "a direct conversion reads no fact -- its needs must be an empty list")
        # without `direct`, empty needs stays refused (the pre-DU-1 rule, test_rate_master's VCD case)
        self.refuses(self.mutated(lambda p, c: conv(p).pop("direct"), self.misc), "needs must be a non-empty list of SKU attributes")

    def test_sheet_insulation_refused_shapes(self):
        loc = "list_spec.pricing.sheet_insulation"
        si = lambda p: p["sheet_insulation"]
        self.refuses(self.mutated(lambda p, c: si(p).pop("mode")), f"{loc} needs exactly")
        self.refuses(self.mutated(lambda p, c: si(p).__setitem__("mode", "sometimes")), f"{loc}.mode must be 'doubtful_only' or 'all'")
        self.refuses(self.mutated(lambda p, c: si(p).__setitem__("low", 0.9)), f"{loc} needs 0 < low < high <= 1")
        self.refuses(self.mutated(lambda p, c: si(p).__setitem__("duct_words", "(")), f"{loc}.duct_words must be a regular expression")
        self.refuses(self.mutated(lambda p, c: si(p).__setitem__("section", "misc")), f"{loc}.section must name this config's delegated section")
        self.refuses(self.mutated(lambda p, c: si(p).__setitem__("area_units", [])), f"{loc}.area_units must be a non-empty list")
        self.refuses(self.mutated(lambda p, c: si(p)["lines"].pop("added")), f"{loc}.lines needs exactly")

    def test_area_basis_refused_shapes(self):
        sec = lambda c: next(s for s in c["list_spec"]["sections"] if s["id"] == "insulation")
        self.refuses(self.mutated(lambda p, c: sec(c).__setitem__("area_basis", {})), "must be a non-empty object")
        self.refuses(self.mutated(lambda p, c: sec(c).__setitem__("area_basis", {"volume": sec(c)["area_basis"]["length"]})), "['volume']: not a unit class of this config")
        self.refuses(self.mutated(lambda p, c: sec(c)["area_basis"]["length"].pop("missing")), "['length'] needs exactly unit, missing and options")
        self.refuses(self.mutated(lambda p, c: sec(c)["area_basis"]["length"].__setitem__("options", [])), "['length'].options must be a non-empty list")
        self.refuses(self.mutated(lambda p, c: sec(c)["area_basis"]["length"]["options"][0].pop("line")), "needs exactly needs (number readers), formula and line")

    def test_supply_row_uplift(self):
        self.assertIs(self.pr()["scope"]["supply_row"]["uplift"], True)
        self.refuses(self.mutated(lambda p, c: p["scope"]["supply_row"].__setitem__("uplift", "yes")), "supply_row needs exactly normal_note, with_row and no_row (and optionally uplift: true)")

    def test_family_alias_offered_and_no_sku_refusals(self):
        self.refuses(self.mutated(lambda p, c: p.__setitem__("family_alias_offered", ["Not An Alias"])), "family_alias_offered must list family_alias keys (each once)")
        self.refuses(self.mutated(lambda p, c: p.__setitem__("no_sku_refusals", [])), "no_sku_refusals must be a non-empty list")
        self.refuses(self.mutated(lambda p, c: p["no_sku_refusals"][0].pop("refuse")), "no_sku_refusals[0] needs exactly words and refuse")
        self.refuses(self.mutated(lambda p, c: p["no_sku_refusals"][0].__setitem__("words", [])), "no_sku_refusals[0].words must be a non-empty list of words")

    def test_borrowers_ask_offered_only(self):
        self.assertIs(self.misc["list_spec"]["borrowers_ask_offered_only"], True)
        self.refuses(self.mutated(lambda p, c: c["list_spec"].__setitem__("borrowers_ask_offered_only", "yes"), self.misc),
                     "list_spec.borrowers_ask_offered_only must be exactly true, or be omitted")

    def test_roundup_half_up(self):
        def steps(p):
            return p["families"]["Spiral / Oval (GI)"]["convert"]["length"][0]["pipelines"]["supply"]["steps"]
        half = [s for s in steps(self.pr()) if s.get("step") == "roundup" and (s.get("params") or {}).get("mode") == "half_up"]
        self.assertEqual(len(half), 1)

        def bad(p, c):
            for s in steps(p):
                if (s.get("params") or {}).get("mode") == "half_up":
                    s["params"]["mode"] = "banker"
        self.refuses(self.mutated(bad), "roundup params.mode may only be 'half_up'")


class TestDu1bSectionFamilyFilter(unittest.TestCase):
    """build_items_spec: a section declaring its families asks for those only -- the valve request is byte-identical to v70's."""

    @staticmethod
    def _cfgs(v):
        return {("HVAC", c["category_id"]): dict(c, discipline="HVAC") for c in _asset(v)["category_configs"]}

    def test_valve_request_unchanged_and_ducting_misc_asks_its_own_families(self):
        c70, c71 = self._cfgs(70), self._cfgs(71)
        for cid in ("hvac_valve_package", "hvac_adp", "hvac_insulation", "hvac_piping", "hvac_vrf"):
            self.assertEqual(json.dumps(extraction.build_items_spec(c71[("HVAC", cid)], c71, "HVAC"), sort_keys=True),
                             json.dumps(extraction.build_items_spec(c70[("HVAC", cid)], c70, "HVAC"), sort_keys=True), cid)
        spec = extraction.build_items_spec(c71[("HVAC", DUCT)], c71, "HVAC")
        misc = next(s for s in spec["sections"] if s["id"] == "misc")
        fam_attr = misc["items_spec"]["family_attribute_id"]
        item_def = next(d for d in misc["items_spec"]["attribute_definitions"] if d["id"] == fam_attr)
        offered = [v for v in item_def["values"] if v in ("Paint", "Fire Retardant Spray Paint", "Air Balancing",
                                                           "Temperature Gauge / Thermometer", "Pressure Gauge",
                                                           "Rubber Bellows / Expansion Joint", "Test Plug / Thermowell")]
        self.assertEqual(offered, ["Paint", "Fire Retardant Spray Paint", "Air Balancing"])
