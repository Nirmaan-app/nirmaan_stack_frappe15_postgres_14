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
