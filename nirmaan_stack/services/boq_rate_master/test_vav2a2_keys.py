"""VAV-2a2 (owner rulings R1 2026-11-18 22:16 / 23:53; R2 22:18 / 22:21; QR-3c (a) 2026-11-19 00:57; R3 13:31 / 13:46; R4 the mockup;
R5 / R6 18:21; R8 18:56) -- THE SERVER HALF OF THE VAV-2a2 KEYS on hvac_vav_box: `band_from` (B1 / B2 / B3), `source_tags` and
`defaults.shape` (B4), the typed boxes' `panel_controls` / `panel_notes`, `own_row_check.serves` (B8), and the Derivation reasons (B5); R7's Valve Package strings.

FIXTURES, no DB writes: the VAV config the v78 mint builds (`mint_hvac_v78_vav2a2.vav_config` on the v77 file's VAV config + the ONE keys
file frontend/.../__fixtures__/vav2a2Keys.json) -- the v78 file is not read, so this commits BEFORE the asset. The pricing halves are
pinned on the frontend (vav2a2Band / vav2a2Rules).
Run: bench --site localhost run-tests --module nirmaan_stack.services.boq_rate_master.test_vav2a2_keys
"""
import copy
import importlib.util
import json
import os
import unittest

from nirmaan_stack.services.boq_rate_master import config_validation, extraction

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")
APP = os.path.join(HERE, "..", "..", "..")
KEYS_PATH = os.path.join(APP, "frontend", "src", "pages", "boq-wizard", "rate-helper", "__fixtures__", "vav2a2Keys.json")
VAV = "hvac_vav_box"


def _v77():
    with open(os.path.join(DATA, "rate_master_hvac_all_v77.json"), encoding="utf-8") as f:
        return json.load(f)


def _keys():
    with open(KEYS_PATH, encoding="utf-8") as f:
        return json.load(f)


def _mint():
    path = os.path.join(APP, "scripts", "_instruments", "mint_hvac_v78_vav2a2.py")
    spec = importlib.util.spec_from_file_location("mint_hvac_v78_vav2a2", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _vav():
    prev = next(c for c in _v77()["category_configs"] if c["category_id"] == VAV)
    return dict(copy.deepcopy(_mint().vav_config(prev, _keys())), discipline="HVAC")


def _refused(test, cfg, needle):
    with test.assertRaises(Exception) as cm:
        config_validation._validate_config(cfg)
    test.assertIn(needle, str(cm.exception))


class TestVav2a2Keys(unittest.TestCase):
    def test_01_POSITIVE_the_v78_vav_config_validates_on_both_edge_rules(self):
        config_validation._validate_config(_vav())
        self.assertEqual(_vav()["list_spec"]["pricing"]["band_from"]["edge"], "lower")   # QR-E (a), owner 2026-11-20 00:10
        cfg = _vav(); cfg["list_spec"]["pricing"]["band_from"]["edge"] = "upper"
        config_validation._validate_config(cfg)

    def test_02_POSITIVE_each_new_key_can_be_left_out(self):
        for k in ("band_from", "source_tags"):
            cfg = _vav()
            del cfg["list_spec"]["pricing"][k]
            if k == "band_from":
                for a in ("airflow_cfm", "inlet_size"):
                    del cfg["list_spec"]["pricing"]["panel_controls"][a]
                    del cfg["list_spec"]["pricing"]["panel_notes"][a]
            config_validation._validate_config(cfg)

    def test_03_NEGATIVE_band_from_shape(self):
        cfg = _vav(); cfg["list_spec"]["pricing"]["band_from"]["edge"] = "middle"
        _refused(self, cfg, "band_from.edge")
        cfg = _vav(); cfg["list_spec"]["pricing"]["band_from"]["bands"][0]["value"] = "0-500"
        _refused(self, cfg, "band_from.bands")
        cfg = _vav(); b = cfg["list_spec"]["pricing"]["band_from"]["bands"]; b[0], b[1] = b[1], b[0]
        _refused(self, cfg, "must rise by max")
        cfg = _vav(); cfg["list_spec"]["pricing"]["band_from"]["inlet_table"][0]["band"] = "nope"
        _refused(self, cfg, "band_from.inlet_table")
        cfg = _vav(); next(d for d in cfg["list_spec"]["attribute_definitions"] if d["id"] == "airflow_cfm")["type"] = "number"
        _refused(self, cfg, "band_from.airflow_attr")
        cfg = _vav(); del cfg["list_spec"]["pricing"]["band_from"]["lines"]["above"]
        _refused(self, cfg, "band_from.lines")
        cfg = _vav(); cfg["list_spec"]["pricing"]["band_from"]["extra"] = 1
        _refused(self, cfg, "band_from needs exactly")

    def test_04_NEGATIVE_the_typed_boxes_need_their_controls_and_notes(self):
        cfg = _vav(); del cfg["list_spec"]["pricing"]["panel_controls"]["inlet_size"]
        _refused(self, cfg, "missing: inlet_size")

    def test_05_NEGATIVE_source_tags_and_serves(self):
        cfg = _vav(); cfg["list_spec"]["pricing"]["source_tags"] = {"no_such_attr": "from BoQ"}
        _refused(self, cfg, "source_tags")
        cfg = _vav(); cfg["list_spec"]["pricing"]["own_row_check"]["serves"] = {"item_first": "yes"}
        _refused(self, cfg, "serves needs item_first")
        cfg = _vav(); cfg["list_spec"]["pricing"]["own_row_check"]["serves"]["extras"] = ["no such extra"]
        _refused(self, cfg, "serves.extras")

    def test_09_B8_serves_is_the_controller_only_and_can_be_left_out(self):
        oc = _vav()["list_spec"]["pricing"]["own_row_check"]
        # QR-C2 (a), owner 2026-11-20 00:34; presence decides for the controller, 00:37 ("one controller for many VAVs")
        self.assertEqual(oc["serves"], {"item_first": True, "extras": ["BACnet over IP controller"], "presence_decides": True})
        cfg = _vav(); cfg["list_spec"]["pricing"]["own_row_check"]["serves"]["presence_decides"] = "yes"
        _refused(self, cfg, "serves.presence_decides")
        cfg = _vav(); del cfg["list_spec"]["pricing"]["own_row_check"]["serves"]
        config_validation._validate_config(cfg)

    def test_06_the_mint_keeps_calculator_only_and_vav_out_of_the_model(self):
        cfg = _vav()
        self.assertIs(cfg.get("calculator_only"), True)
        stored = [dict(c, discipline="HVAC") for c in _v77()["category_configs"]]
        stored = [cfg if c["category_id"] == VAV else c for c in stored]
        cfgs = {("HVAC", c["category_id"]): c for c in stored}
        self.assertFalse(extraction.config_is_eligible(cfg, cfgs))

    def test_07_B5_the_quantity_reason_comes_first_and_the_broad_patterns_are_narrowed(self):
        rs = _vav()["list_spec"]["pricing"]["derivation_reasons"]
        titles = [r["title"] for r in rs]
        K = _keys()["derivation_reasons"]
        self.assertLess(titles.index(K["move_first"]), titles.index("^The misc item section(?!'s quantity)"))
        self.assertNotIn("^The misc item section", titles)
        self.assertNotIn("^The sensor section", titles)
        self.assertNotIn("EDGE_REASON", json.dumps(rs))
        # NEGATIVE: v77 has the defect order
        v77 = [r["title"] for r in next(c for c in _v77()["category_configs"] if c["category_id"] == VAV)["list_spec"]["pricing"]["derivation_reasons"]]
        self.assertGreater(v77.index(K["move_first"]), v77.index("^The misc item section"))

    def test_08_every_other_v77_config_is_untouched_by_the_transformation(self):
        before = copy.deepcopy(_v77()["category_configs"])
        _vav()
        self.assertEqual(json.dumps(before, sort_keys=True), json.dumps(_v77()["category_configs"], sort_keys=True))


if __name__ == "__main__":
    unittest.main()
