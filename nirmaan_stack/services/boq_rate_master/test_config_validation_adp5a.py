"""ADP-5a (owner 2026-10-22; SCOPE-5a-1, SCOPE-5a-2) -- the two keys the slice adds to `list_spec.pricing`, accepted in
their ruled form and refused in every other: `family_merge` (a spigot and its butterfly damper are ONE item, priced at the
spigot's diameter) and a default's `rule_by_family` (the curved grille's own "with" line beside the other families').

Pure: the validator reads no database. Run: bench --site localhost run-tests --module
nirmaan_stack.services.boq_rate_master.test_config_validation_adp5a
"""
import copy
import json
import os
import unittest

from nirmaan_stack.services.boq_rate_master import config_validation

DATA = os.path.join(os.path.dirname(__file__), "data")


def _asset(n):
    with open(os.path.join(DATA, "rate_master_hvac_all_v%d.json" % n), encoding="utf-8") as f:
        return json.load(f)


def _cfg(payload, cid):
    c = next(c for c in payload["category_configs"] if c["category_id"] == cid)
    return dict(copy.deepcopy(c), discipline=payload["discipline"])


class TestAdp5aConfigKeys(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.v50, cls.v51 = _asset(50), _asset(51)

    def _adp(self):
        return _cfg(self.v51, "hvac_adp")

    def _pr(self, cfg):
        return cfg["list_spec"]["pricing"]

    def _refuses(self, cfg, *words):
        with self.assertRaises(Exception) as cm:
            config_validation._validate_config(cfg)
        for w in words:
            self.assertIn(w, str(cm.exception))

    # ---- positive ---------------------------------------------------------------------------------------
    def test_01_v50_and_v51_validate(self):
        config_validation._validate_config(_cfg(self.v50, "hvac_adp"))
        config_validation._validate_config(self._adp())

    def test_02_the_ruled_forms_as_v51_carries_them(self):
        pr = self._pr(self._adp())
        self.assertEqual(pr["family_merge"], [{
            "family": "spigot", "into": "butterfly damper", "absorbs": ["butterfly damper"],
            "words": ["butterfly damper", "spigot damper", "spicot damper"], "at": "dia_mm",
            "line": "spigot with butterfly damper named -> priced as one Butterfly Damper With Spigot",
            "rule": "a spigot with a butterfly damper, or a spigot damper, is one Butterfly Damper With Spigot, priced at the spigot's diameter (owner 2026-10-22)",
        }])
        d = pr["defaults"]["damper"]
        self.assertEqual(d["by_family"]["curved grille"], "with")
        self.assertEqual({f: v for f, v in d["by_family"].items() if f != "curved grille"},
                         {f: "without" for f in ("floor grille", "linear grille", "round diffuser", "slot diffuser", "square diffuser")})
        self.assertEqual(list(d["rule_by_family"]), ["curved grille"])
        self.assertEqual(d["rule"], "R1 / slice 11 damper not mentioned (or not answered) = without")   # the others' line, unchanged

    def test_03_family_merge_with_words_only_or_absorbs_only_validates(self):
        for drop in ("words", "absorbs"):
            cfg = self._adp()
            del self._pr(cfg)["family_merge"][0][drop]
            config_validation._validate_config(cfg)
        cfg = self._adp()
        del self._pr(cfg)["family_merge"][0]["at"]   # `at` is optional
        config_validation._validate_config(cfg)

    # ---- negative: family_merge -------------------------------------------------------------------------
    def test_04_family_merge_must_be_a_non_empty_list(self):
        for bad in ([], {}, "spigot"):
            cfg = self._adp()
            self._pr(cfg)["family_merge"] = bad
            self._refuses(cfg, "family_merge must be a non-empty list")

    def test_05_an_unknown_key_is_refused_by_name(self):
        cfg = self._adp()
        self._pr(cfg)["family_merge"][0]["when"] = "always"
        self._refuses(cfg, "family_merge[0]: unknown key(s): when")

    def test_06_family_and_into_must_be_priceable_families_and_differ(self):
        cfg = self._adp()
        self._pr(cfg)["family_merge"][0]["into"] = "spigot damper"
        self._refuses(cfg, "family_merge[0].into 'spigot damper' is not a priceable family")
        cfg = self._adp()
        self._pr(cfg)["family_merge"][0]["family"] = "none of these"   # a no-SKU family is not priceable
        self._refuses(cfg, "family_merge[0].family 'none of these' is not a priceable family")
        cfg = self._adp()
        self._pr(cfg)["family_merge"][0]["into"] = "spigot"
        self._refuses(cfg, "a family cannot merge into itself")

    def test_07_it_needs_something_that_fires_it(self):
        cfg = self._adp()
        r = self._pr(cfg)["family_merge"][0]
        del r["words"], r["absorbs"]
        self._refuses(cfg, "must carry absorbs and / or words")

    def test_08_absorbs_and_words_are_checked(self):
        for bad in ([], ["no such family"], ["spigot"], "butterfly damper"):
            cfg = self._adp()
            self._pr(cfg)["family_merge"][0]["absorbs"] = bad
            self._refuses(cfg, "absorbs must be a non-empty list of priceable families other than 'spigot'")
        for bad in ([], [""], "spigot damper"):
            cfg = self._adp()
            self._pr(cfg)["family_merge"][0]["words"] = bad
            self._refuses(cfg, "words must be a non-empty list of words")

    def test_09_at_must_be_a_number_both_families_need(self):
        for bad in ("neck_mm", "no_such_number", 5):
            cfg = self._adp()
            self._pr(cfg)["family_merge"][0]["at"] = bad
            self._refuses(cfg, "at must be a number both 'spigot' and 'butterfly damper' need")

    def test_10_line_and_rule_must_be_non_empty_strings(self):
        for key in ("line", "rule", "family", "into"):
            cfg = self._adp()
            self._pr(cfg)["family_merge"][0][key] = "  "
            self._refuses(cfg, "family_merge[0].%s must be a non-empty string" % key)

    # ---- negative: rule_by_family -----------------------------------------------------------------------
    def test_11_rule_by_family_needs_by_family_and_names_only_its_families(self):
        cfg = self._adp()
        self._pr(cfg)["defaults"]["damper"]["rule_by_family"] = {"VCD": "a line"}   # not a by_family key
        self._refuses(cfg, "rule_by_family must map families of by_family to a non-empty line")
        cfg = self._adp()
        self._pr(cfg)["defaults"]["damper"]["rule_by_family"] = {"curved grille": ""}
        self._refuses(cfg, "rule_by_family must map families of by_family to a non-empty line")
        cfg = self._adp()
        self._pr(cfg)["defaults"]["damper"]["rule_by_family"] = {}
        self._refuses(cfg, "rule_by_family must map families of by_family to a non-empty line")
        # beside a single `value` (no by_family) it is refused too
        cfg = _cfg(self.v50, "hvac_adp")
        self._pr(cfg)["defaults"]["damper"]["rule_by_family"] = {"curved grille": "a line"}
        self._refuses(cfg, "rule_by_family must map families of by_family to a non-empty line")


if __name__ == "__main__":
    unittest.main()
