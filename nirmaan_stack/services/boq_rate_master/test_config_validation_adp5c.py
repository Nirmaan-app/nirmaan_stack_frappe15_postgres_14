"""ADP-5c (owner 2026-10-23 12:07 / 12:08) -- the key the slice adds to `list_spec.pricing`, accepted in its ruled form
and refused in every other: `existing_work` (a row whose own text removes, refixes or shifts EXISTING work prices its
matched SKU at supply 0 and install x the entry's multiple). The cross-talk 300 x 300 default rides the existing
`number_defaults` key and is accepted on it as it stands.

Pure: the validator reads no database. Run: bench --site localhost run-tests --module
nirmaan_stack.services.boq_rate_master.test_config_validation_adp5c
"""
import copy
import json
import os
import unittest

from nirmaan_stack.services.boq_rate_master import config_validation

DATA = os.path.join(os.path.dirname(__file__), "data")

# the ruled form (owner 12:07 / 12:08): the refixing entry first, so "removing and refixing of existing" reads as it
EXISTING_WORK = [
    {"words": ["refixing of existing", "refixing existing", "re-fixing of existing", "re-fixing existing",
               "shifting of existing", "shifting existing"],
     "install_times": 2, "line": "removal and refixing of existing",
     "rule": "removal and refixing, refixing or shifting of existing work: supply 0, install 2 x the matched SKU's install (owner 2026-10-23 12:07 / 12:08)"},
    {"words": ["removing of existing", "removing existing", "removal of existing", "removal existing"],
     "install_times": 1, "line": "removal of existing",
     "rule": "removal of existing work: supply 0, install = the matched SKU's install (owner 2026-10-23 12:07)"},
]
CROSS_TALK_DEFAULT = {
    "value": 300, "families": ["cross-talk"],
    "rule": "no size stated - a cross-talk silencer is priced at 300 x 300 (owner 2026-10-23 10:14 / 12:08)",
}


def _asset(n):
    with open(os.path.join(DATA, "rate_master_hvac_all_v%d.json" % n), encoding="utf-8") as f:
        return json.load(f)


def _cfg(payload, cid):
    c = next(c for c in payload["category_configs"] if c["category_id"] == cid)
    return dict(copy.deepcopy(c), discipline=payload["discipline"])


class TestAdp5cConfigKeys(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.v52 = _asset(52)

    def _adp(self):
        c = _cfg(self.v52, "hvac_adp")
        pr = c["list_spec"]["pricing"]
        pr["existing_work"] = copy.deepcopy(EXISTING_WORK)
        pr["number_defaults"]["face_w_mm"] = copy.deepcopy(CROSS_TALK_DEFAULT)
        pr["number_defaults"]["face_h_mm"] = copy.deepcopy(CROSS_TALK_DEFAULT)
        return c

    def _refuses(self, cfg, *words):
        with self.assertRaises(Exception) as cm:
            config_validation._validate_config(cfg)
        for w in words:
            self.assertIn(w, str(cm.exception))

    # ---- positive ---------------------------------------------------------------------------------------
    def test_01_v52_and_the_ruled_forms_validate(self):
        config_validation._validate_config(_cfg(self.v52, "hvac_adp"))
        config_validation._validate_config(self._adp())

    def test_02_the_key_is_admitted_and_its_entry_keys_are_closed(self):
        self.assertIn("existing_work", config_validation._PRICING_KEYS)
        self.assertEqual(config_validation._PRICING_EXISTING_WORK_KEYS, {"words", "install_times", "line", "rule"})

    # ---- negative: every malformed shape is refused by name ----------------------------------------------
    def test_03_not_a_list_or_empty(self):
        for bad in ({}, [], "removal existing", None):
            c = self._adp()
            c["list_spec"]["pricing"]["existing_work"] = bad
            self._refuses(c, "existing_work must be a non-empty list")

    def test_04_an_entry_with_an_unknown_or_missing_key(self):
        c = self._adp()
        c["list_spec"]["pricing"]["existing_work"][0]["supply_times"] = 0
        self._refuses(c, "existing_work[0]: unknown key(s): supply_times")
        c = self._adp()
        del c["list_spec"]["pricing"]["existing_work"][1]["line"]
        self._refuses(c, "existing_work[1].line must be a non-empty string")
        c = self._adp()
        c["list_spec"]["pricing"]["existing_work"][1]["rule"] = "  "
        self._refuses(c, "existing_work[1].rule must be a non-empty string")

    def test_05_words_must_be_non_empty_phrases(self):
        for bad in ([], ["removal of existing", ""], "removal of existing", [3]):
            c = self._adp()
            c["list_spec"]["pricing"]["existing_work"][1]["words"] = bad
            self._refuses(c, "existing_work[1].words must be a non-empty list of phrases")

    def test_06_a_phrase_in_two_entries_is_refused(self):
        c = self._adp()
        c["list_spec"]["pricing"]["existing_work"][1]["words"].append("Refixing Existing")
        self._refuses(c, "existing_work[1].words repeats 'Refixing Existing', already in entry 0")

    def test_07_install_times_must_be_a_positive_number(self):
        for bad in (0, -1, "2", True, None):
            c = self._adp()
            c["list_spec"]["pricing"]["existing_work"][0]["install_times"] = bad
            self._refuses(c, "existing_work[0].install_times must be a positive number")

    def test_08_the_cross_talk_default_names_a_real_number_and_family(self):
        c = self._adp()
        c["list_spec"]["pricing"]["number_defaults"]["face_w_mm"]["families"] = ["cross talk"]
        self._refuses(c, "names 'cross talk', which is not a family of this category")


if __name__ == "__main__":
    unittest.main()
