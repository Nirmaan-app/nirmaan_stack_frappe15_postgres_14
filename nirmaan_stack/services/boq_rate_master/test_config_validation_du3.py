"""DU-3 (2026-11-16) -- the Ducting config keys the slice changes, accepted in their ruled form and refused in every other:

  `sheet_insulation` (R1 the 90% rule + R2 which rows count; owner 16:31 / 16:33 / 16:37 / 16:38, QR-1 Q1 / Q3 / Q4 18:06): the five
      regular expressions, the preamble length, the area / running-metre units, the threshold Pricing Input and the four lines; the
      RETIRED G-3 shape (v71-v74) still validates (a historical asset stays loadable) and is never mixed with the new one;
  the threshold Pricing Input is "used by" Ducting (extras_input_ids, the twin of the Rate Master page's scopeUses) and must exist as
      a Pricing Input item (scope_problems).

Pure: the validator reads no database. The v75 block is the same as frontend/.../du3Insulation.harness.ts (SI_V75); the v75 asset test
pins the minted config equal to both. Run:
bench --site localhost run-tests --module nirmaan_stack.services.boq_rate_master.test_config_validation_du3
"""
import copy
import json
import os
import unittest

import frappe

from nirmaan_stack.services.boq_rate_master import config_validation as cv

DATA = os.path.join(os.path.dirname(__file__), "data")
DUCT = "hvac_ducting"
THRESHOLD = "ducting_insulation_coverage_threshold"

SI_V75 = {
    "category": "hvac_insulation",
    "section": "insulation",
    "duct_words": "\\bducts?\\b|ducting|ductwork",
    "insulation_words": "insulat|lining",
    "plain_heading_words": "^\\W*(?:[a-z0-9]{1,3}[.)]\\s*)?(?:thermal\\s+|acoustic\\s+)?insulation(?:\\s+works?)?\\W*$",
    "never_words": "\\bpipes?\\b|piping|\\bAHUs?\\b|air\\s*handling|plant\\s*room|machine\\s*room|equipment|chillers?\\b|refrigerant|copper",
    "surface_words": "under\\s*-?\\s*deck|\\broofs?\\b|\\bwalls?\\b|ceiling|\\bslabs?\\b|\\bfloors?\\b|partition|terrace",
    "preamble_chars": 120,
    "area_units": ["sqm", "sq.m", "sq m", "sq.mt", "sqmt", "sq.mtr", "sq mtr", "sqmtr", "sqmtrs", "sq.mtrs", "sq. m", "sq.m.", "m2", "m²",
                   "sq.mt.", "sqm.", "smt", "sq. mtr", "sqft", "sq.ft", "sq ft", "sft", "SM", "Sq mt", "Sqm/Ro"],
    "length_units": ["m", "mt", "mts", "mtr", "mtrs", "rmt", "rmtr", "rm", "r.m", "running metre", "running meter", "metre", "meter",
                     "metres", "meters", "lm", "rft"],
    "threshold_input": THRESHOLD,
    "lines": {
        "covered": "Insulation is priced separately in {rows} - not included in this row.",
        "double_count": "Possible double counting - insulation is also priced separately in {rows}. Check before quoting.",
        "ratio": "(The separate rows cover about {pct}% of the insulated duct quantity on this sheet: {ins} of {area} sq.m; threshold {threshold}%.)",
        "threshold_missing": "(The Pricing Input 'Ducting - insulation coverage threshold' is not set - set it in Pricing Inputs.)",
    },
}


def _cfg(v, cid):
    with open(os.path.join(DATA, f"rate_master_hvac_all_v{v}.json"), encoding="utf-8") as f:
        a = json.load(f)
    return dict(next(c for c in a["category_configs"] if c["category_id"] == cid), discipline="HVAC")


class TestDu3SheetInsulation(unittest.TestCase):
    def setUp(self):
        self.v74 = _cfg(74, DUCT)
        self.duct = copy.deepcopy(self.v74)
        self.duct["list_spec"]["pricing"]["sheet_insulation"] = copy.deepcopy(SI_V75)

    def refuses(self, cfg, words):
        with self.assertRaises(frappe.ValidationError) as cm:
            cv._validate_config(cfg)
        self.assertIn(words, str(cm.exception))

    def mutated(self, fn):
        c = copy.deepcopy(self.duct)
        fn(c["list_spec"]["pricing"]["sheet_insulation"])
        return c

    def test_v75_shape_accepted_and_the_retired_shape_still_validates(self):
        cv._validate_config(copy.deepcopy(self.duct))
        # the retired G-3 shape (v74 as minted) stays loadable -- a rollback
        cv._validate_config(copy.deepcopy(self.v74))

    def test_refused_shapes(self):
        loc = "list_spec.pricing.sheet_insulation"
        # a retired key mixed into the new shape (or a new key missing) -> neither shape
        self.refuses(self.mutated(lambda si: si.__setitem__("mode", "all")), f"{loc} needs exactly")
        self.refuses(self.mutated(lambda si: si.pop("threshold_input")), f"{loc} needs exactly")
        for k in ("duct_words", "insulation_words", "plain_heading_words", "never_words", "surface_words"):
            self.refuses(self.mutated(lambda si, k=k: si.__setitem__(k, "(")), f"{loc}.{k} must be a regular expression")
        for bad in (0, -5, 1.5, True, "120"):
            self.refuses(self.mutated(lambda si, b=bad: si.__setitem__("preamble_chars", b)), f"{loc}.preamble_chars must be a positive whole number")
        self.refuses(self.mutated(lambda si: si.__setitem__("length_units", [])), f"{loc}.length_units must be a non-empty list")
        self.refuses(self.mutated(lambda si: si.__setitem__("area_units", ["sqm", ""])), f"{loc}.area_units must be a non-empty list")
        self.refuses(self.mutated(lambda si: si.__setitem__("threshold_input", "")), f"{loc}.threshold_input must name a Pricing Input")
        self.refuses(self.mutated(lambda si: si["lines"].pop("ratio")), f"{loc}.lines needs exactly")
        self.refuses(self.mutated(lambda si: si["lines"].__setitem__("covered", "Insulation is priced separately.")), "must name the rows")
        self.refuses(self.mutated(lambda si: si.__setitem__("section", "misc")), f"{loc}.section must name this config's delegated section")

    def test_threshold_input_used_by_ducting_and_must_exist(self):
        self.assertIn(THRESHOLD, cv.extras_input_ids(self.duct))
        self.assertIn("ducting_install_only_uplift", cv.extras_input_ids(self.duct))
        # negative: the v74 config (retired shape) names no threshold input
        self.assertNotIn(THRESHOLD, cv.extras_input_ids(self.v74))
        upl = {"kind": "hvac_pricing_input", "attributes": {"item": "ducting_install_only_uplift"}}
        thr = {"kind": "hvac_pricing_input", "attributes": {"item": THRESHOLD}}
        self.assertEqual(cv.scope_problems([self.duct], [upl, thr]), [])
        # negative: the retired shape (v74 as minted) names no threshold, so nothing is checked for it (K1 Python set found it)
        self.assertEqual(cv.scope_problems([self.v74], [upl]), [])
        probs = cv.scope_problems([self.duct], [upl])
        self.assertEqual(len(probs), 1)
        self.assertIn(f"the threshold input '{THRESHOLD}' is not a Pricing Input item", probs[0])


if __name__ == "__main__":
    unittest.main()


def _mint():
    """the v75 mint's PURE config functions (scripts/_instruments/mint_hvac_v75_du3.py) -- the config the asset will carry"""
    import importlib.util
    p = os.path.join(os.path.dirname(__file__), "..", "..", "..", "scripts", "_instruments", "mint_hvac_v75_du3.py")
    spec = importlib.util.spec_from_file_location("mint_hvac_v75_du3", os.path.abspath(p))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


class TestDu3K1bK1cKeys(unittest.TestCase):
    """DU-3 K1b + K1c: pair_note (R3), the gauge lines (R4 / R6 / R7), paint_row (Case 8), row_refusals (Case 5), partial_insulation
    (Case 4), family_text.refuse `unless` (Case 12), when_words `rule` (R7 / Case 6) -- accepted as the mint writes them, refused in
    every other shape named here."""

    @classmethod
    def setUpClass(cls):
        cls.m = _mint()
        cls.duct = cls.m.ducting_config(_cfg(74, DUCT))
        cls.valve = cls.m.valve_config(_cfg(74, "hvac_valve_package"))

    def refuses(self, cfg, words):
        with self.assertRaises(frappe.ValidationError) as cm:
            cv._validate_config(cfg)
        self.assertIn(words, str(cm.exception))

    def mutated(self, fn, base=None):
        c = copy.deepcopy(base or self.duct)
        fn(c["list_spec"]["pricing"])
        return c

    def test_mint_configs_accepted(self):
        cv._validate_config(copy.deepcopy(self.duct))
        cv._validate_config(copy.deepcopy(self.valve))
        self.assertEqual(self.duct["list_spec"]["pricing"]["sheet_insulation"], SI_V75)

    def test_pair_note(self):
        loc = "list_spec.pricing.scope.supply_row"
        self.refuses(self.mutated(lambda p: p["scope"]["supply_row"].__setitem__("pair_note", "Installation not priced here")), "{rows}")
        self.refuses(self.mutated(lambda p: p["scope"]["supply_row"].__setitem__("extra", "x")), f"{loc} needs exactly")

    def test_gauge_lines_optional(self):
        g = lambda p: p["numbers"]["thickness_mm"]["gauge"]["lines"]
        cv._validate_config(self.mutated(lambda p: [g(p).pop(k) for k in ("bare_number", "labour_any_gauge", "own_row")]))
        self.refuses(self.mutated(lambda p: g(p).__setitem__("no_such_line", "x")), "lines needs exactly")

    def test_paint_row(self):
        loc = "list_spec.pricing.paint_row"
        self.refuses(self.mutated(lambda p: p["paint_row"].pop("tolerance")), f"{loc} needs exactly")
        self.refuses(self.mutated(lambda p: p["paint_row"].__setitem__("tolerance", 1.5)), f"{loc}.tolerance must be")
        self.refuses(self.mutated(lambda p: p["paint_row"].__setitem__("family", "Not A Misc Item")), f"{loc}.section must name")
        self.refuses(self.mutated(lambda p: p["paint_row"].__setitem__("words", "(")), f"{loc}.words must be a regular expression")
        self.refuses(self.mutated(lambda p: p["paint_row"].__setitem__("line", "priced as Paint")), "{rows}")

    def test_row_refusals_and_partial_insulation(self):
        self.refuses(self.mutated(lambda p: p.__setitem__("row_refusals", [])), "row_refusals must be a non-empty list")
        self.refuses(self.mutated(lambda p: p["row_refusals"][0].__setitem__("pattern", "(")), "pattern must be a regular expression")
        ploc = "list_spec.pricing.partial_insulation"
        self.refuses(self.mutated(lambda p: p["partial_insulation"].__setitem__("pattern", "(?<kind>acoustic) first 5 m")), f"{ploc}.pattern must name the groups kind and span")
        self.refuses(self.mutated(lambda p: p["partial_insulation"].__setitem__("line", "add by hand")), "{kind}")

    def test_family_text_refuse_unless(self):
        rf = lambda p: p["family_text"]["refuse"]
        ss = [r for r in rf(self.duct["list_spec"]["pricing"]) if r["from"] == "stainless steel"]
        self.assertEqual([("unless" in r) for r in ss], [True, False])
        # the repeat is allowed only after an entry with `unless`
        self.refuses(self.mutated(lambda p: [r.pop("unless", None) for r in rf(p)]), "is already mapped")
        self.refuses(self.mutated(lambda p: next(r for r in rf(p) if "unless" in r).__setitem__("unless", "(")), "unless must be a regular expression")

    def test_when_words_rule(self):
        ww = lambda p: p["family_when_none"]["when_words"]
        self.refuses(self.mutated(lambda p: next(w for w in ww(p) if "rule" in w).__setitem__("rule", " ")), "rule must be a non-empty sentence")
        self.refuses(self.mutated(lambda p: ww(p)[0].__setitem__("extra", 1)), "must carry exactly unit_class / words / family")

    def test_two_insulations(self):
        tloc = "list_spec.pricing.two_insulations"
        self.assertEqual(self.duct["list_spec"]["pricing"]["two_insulations"]["section"], "insulation")
        self.refuses(self.mutated(lambda p: p["two_insulations"].pop("line")), f"{tloc} must carry exactly")
        self.refuses(self.mutated(lambda p: p["two_insulations"].__setitem__("section", "nope")), f"{tloc}.section must name")
        self.refuses(self.mutated(lambda p: p["two_insulations"].__setitem__("keep_words", "(")), f"{tloc}.keep_words must be a regular expression")
        self.refuses(self.mutated(lambda p: p["two_insulations"].__setitem__("line", "add by hand")), "{t}")
