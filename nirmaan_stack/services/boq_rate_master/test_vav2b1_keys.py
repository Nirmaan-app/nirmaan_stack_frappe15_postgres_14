"""VAV-2b1 (owner rulings 2026-11-20 14:10 - 19:51; VAV-2b1 prompt R1 - R16, B8) -- THE SERVER HALF OF THE VAV-2b1 KEYS on hvac_vav_box:
`sheet_shares` (R1 / R3 / R5 - R8 / R10), `withdrawn_families` (R2 / R8), `combination_warning.heading` (R11), `band_from.lower_limit`
(R12), `own_row_check.serves.also` (R13); the five new items (the DDC Panel/ Controller SKU, the Duct Static Pressure Sensor, three Pricing
Inputs) and the cross-item checks (each input a Pricing Input item, each share SKU exactly one item).

FIXTURES, no DB writes: the VAV config and items the next mint builds (`mint_hvac_v79_vav2b1.vav_config` / `with_items` on the v78 file +
the ONE keys file frontend/.../__fixtures__/vav2b1Keys.json) -- the next file is not read, so this commits BEFORE the asset. The pricing
halves are pinned on the frontend (vav2b1Shares / vav2b1Calc / vav2b1Rules / vav2b1Block.dom).
Run: bench --site localhost run-tests --module nirmaan_stack.services.boq_rate_master.test_vav2b1_keys
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
KEYS_PATH = os.path.join(APP, "frontend", "src", "pages", "boq-wizard", "rate-helper", "__fixtures__", "vav2b1Keys.json")
VAV = "hvac_vav_box"


def _v78():
    with open(os.path.join(DATA, "rate_master_hvac_all_v78.json"), encoding="utf-8") as f:
        return json.load(f)


def _keys():
    with open(KEYS_PATH, encoding="utf-8") as f:
        return json.load(f)


def _mint():
    path = os.path.join(APP, "scripts", "_instruments", "mint_hvac_v79_vav2b1.py")
    spec = importlib.util.spec_from_file_location("mint_hvac_v79_vav2b1", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _vav():
    prev = next(c for c in _v78()["category_configs"] if c["category_id"] == VAV)
    return dict(copy.deepcopy(_mint().vav_config(prev, _keys())), discipline="HVAC")


def _items():
    return _mint().with_items(_v78()["items"], _keys())


def _refused(test, cfg, needle):
    with test.assertRaises(Exception) as cm:
        config_validation._validate_config(cfg)
    test.assertIn(needle, str(cm.exception))


def _pr(cfg):
    return cfg["list_spec"]["pricing"]


class TestVav2b1Keys(unittest.TestCase):
    def test_01_POSITIVE_the_next_vav_config_validates_and_keeps_calculator_only(self):
        cfg = _vav()
        config_validation._validate_config(cfg)
        self.assertIs(cfg.get("calculator_only"), True)
        self.assertEqual(_pr(cfg)["sheet_shares"]["count"]["blank"], "skip")   # QR-N (b), owner 2026-11-20 19:46
        self.assertEqual(_pr(cfg)["withdrawn_families"], ["BACnet over IP controller", "Differential Pressure Switch"])
        self.assertEqual(_pr(cfg)["own_row_check"]["serves"]["also"], ["VAV integrator"])

    def test_02_POSITIVE_each_new_key_can_be_left_out(self):
        for drop in ("sheet_shares", "withdrawn_families"):
            cfg = _vav(); del _pr(cfg)[drop]
            config_validation._validate_config(cfg)
        cfg = _vav(); del _pr(cfg)["combination_warning"]["heading"]; config_validation._validate_config(cfg)
        cfg = _vav(); del _pr(cfg)["band_from"]["lower_limit"]; config_validation._validate_config(cfg)
        cfg = _vav(); del _pr(cfg)["own_row_check"]["serves"]["also"]; config_validation._validate_config(cfg)

    def test_03_NEGATIVE_sheet_shares_shape(self):
        cfg = _vav(); _pr(cfg)["sheet_shares"]["count"]["blank"] = "maybe"
        _refused(self, cfg, "count.blank")
        cfg = _vav(); _pr(cfg)["sheet_shares"]["count"]["box_families"] = ["No such box"]
        _refused(self, cfg, "count.box_families")
        cfg = _vav(); _pr(cfg)["sheet_shares"]["shares"][0]["bcs_of"] = "nope"
        _refused(self, cfg, "bcs_of")
        cfg = _vav(); del _pr(cfg)["sheet_shares"]["shares"][0]["bcs_of"]
        _refused(self, cfg, "needs bcs_of")
        cfg = _vav(); _pr(cfg)["sheet_shares"]["shares"][0]["replaces"] = ["ddc"]
        _refused(self, cfg, "replaces")
        cfg = _vav(); _pr(cfg)["sheet_shares"]["shares"][1]["id"] = "ddc"
        _refused(self, cfg, "ids must be unique")
        cfg = _vav(); _pr(cfg)["sheet_shares"]["shares"][1]["parts"][0]["sku"] = {"kind": "x"}
        _refused(self, cfg, "sku needs exactly")
        cfg = _vav(); _pr(cfg)["sheet_shares"]["separate"]["extras"][0]["share"] = "nope"
        _refused(self, cfg, "must name a share")
        cfg = _vav(); _pr(cfg)["sheet_shares"]["separate"]["extras"][0]["words"] = "("
        _refused(self, cfg, "separate.extras[0].words")
        cfg = _vav(); del _pr(cfg)["sheet_shares"]["labels"]["need_vavs"]
        _refused(self, cfg, "sheet_shares.labels")
        cfg = _vav(); _pr(cfg)["sheet_shares"]["lines"]["not_added"] = "not added."
        _refused(self, cfg, "lines.not_added")
        cfg = _vav(); _pr(cfg)["sheet_shares"]["reading"]["values"].pop("ddc")
        _refused(self, cfg, "reading.values")

    def test_04_NEGATIVE_withdrawn_heading_lower_limit_also(self):
        cfg = _vav(); _pr(cfg)["withdrawn_families"] = ["No such family"]
        _refused(self, cfg, "withdrawn_families")
        cfg = _vav(); _pr(cfg)["combination_warning"]["heading"] = ""
        _refused(self, cfg, "combination_warning.heading")
        cfg = _vav(); _pr(cfg)["band_from"]["lower_limit"]["line"] = "only a lower limit"
        _refused(self, cfg, "lower_limit")
        cfg = _vav(); _pr(cfg)["band_from"]["lower_limit"]["extra"] = 1
        _refused(self, cfg, "lower_limit needs exactly")
        cfg = _vav(); _pr(cfg)["own_row_check"]["serves"]["also"] = ["no such extra"]
        _refused(self, cfg, "serves.also")

    def test_05_CROSS_ITEM_inputs_and_skus_resolve_on_the_next_items_and_not_on_v78s(self):
        stored = [dict(c, discipline="HVAC") for c in _v78()["category_configs"]]
        stored = [_vav() if c["category_id"] == VAV else c for c in stored]
        self.assertEqual(config_validation.scope_problems(stored, _items()), [])
        # NEGATIVE: on v78's items the three inputs and the two new SKUs are missing
        probs = config_validation.scope_problems(stored, _v78()["items"])
        for needle in ("vav_vavs_per_bacnet_controller", "vav_vavs_per_dp_sensor", "vav_vavs_per_ddc_panel", "DDC Panel/ Controller",
                       "Duct Static Pressure Sensor"):
            self.assertTrue(any(needle in p for p in probs), needle)

    def test_06_the_items_v78_unchanged_plus_exactly_five(self):
        prev, nxt = _v78()["items"], _items()
        new = {i["item_uid"] for i in _keys()["items"]}
        self.assertEqual(len(nxt), len(prev) + 5)
        self.assertEqual(json.dumps([i for i in nxt if i["item_uid"] not in new], sort_keys=True), json.dumps(prev, sort_keys=True))
        by = {i["item_uid"]: i for i in nxt}
        ddc = by["rmi-51319c433867"]
        self.assertEqual((ddc["attributes"]["vav_item"], ddc["rates"]["cost_supply"], ddc["rates"]["cost_install"]), ("DDC Panel/ Controller", 25000.0, 5000.0))
        dsps = by["rmi-3654468a63fc"]
        self.assertEqual((dsps["attributes"]["sensor"], dsps["rates"]["cost_supply"], dsps["rates"]["cost_install"], dsps["source"]["row"]),
                         ("Duct Static Pressure Sensor", 7650.0, 500.0, 11))
        factors = {i["attributes"]["item"]: i["rates"]["factor"] for i in nxt if i["kind"] == "hvac_pricing_input" and i["item_uid"] in new}
        self.assertEqual(factors, {"vav_vavs_per_bacnet_controller": 32.0, "vav_vavs_per_dp_sensor": 30.0, "vav_vavs_per_ddc_panel": 200.0})
        # the Differential Pressure Switch stays an item (R9: "NO item is deleted or changed")
        self.assertTrue(any(i["attributes"].get("sensor") == "Differential Pressure Switch" for i in nxt))

    def test_07_VAV_stays_out_of_the_model_and_every_request_is_unchanged(self):
        stored78 = [dict(c, discipline="HVAC") for c in _v78()["category_configs"]]
        stored79 = [_vav() if c["category_id"] == VAV else c for c in stored78]
        c78 = {("HVAC", c["category_id"]): c for c in stored78}
        c79 = {("HVAC", c["category_id"]): c for c in stored79}
        self.assertFalse(extraction.config_is_eligible(c79[("HVAC", VAV)], c79))
        for c in stored78:
            if c.get("list_spec"):
                a = json.dumps(extraction.build_items_spec(c78[("HVAC", c["category_id"])], c78, "HVAC"), sort_keys=True)
                b = json.dumps(extraction.build_items_spec(c79[("HVAC", c["category_id"])], c79, "HVAC"), sort_keys=True)
                self.assertEqual(a, b, c["category_id"])

    def test_08_every_other_v78_config_is_untouched_and_line_19s_reason_replaced(self):
        before = copy.deepcopy(_v78()["category_configs"])
        rs = [r["title"] for r in _pr(_vav())["derivation_reasons"]]
        self.assertEqual(json.dumps(before, sort_keys=True), json.dumps(_v78()["category_configs"], sort_keys=True))
        self.assertNotIn("^A BACnet over IP controller priced on its own row of the sheet is not added", rs)
        self.assertIn("^Per sheet, the first match decides which controller share", rs)
        for r in _keys()["derivation_reasons"]["new"]:
            self.assertIn(r["title"], rs)

    def test_09_the_vav_sheet_inputs_include_the_three_counts(self):
        ids = config_validation.vav_sheet_input_ids(_pr(_vav()))
        for i in ("vav_vavs_per_bacnet_controller", "vav_vavs_per_dp_sensor", "vav_vavs_per_ddc_panel"):
            self.assertIn(i, ids)
        cfg = _vav(); del _pr(cfg)["sheet_shares"]
        self.assertFalse([i for i in config_validation.vav_sheet_input_ids(_pr(cfg)) if i.startswith("vav_vavs_per")])

    def test_10_RULE4_zero_rows_validate_and_refuse_by_name(self):
        """Rule 4 (owner 2026-11-20 21:05 'a, yes' / 21:47 'a'): own_row_check.zero_rows and integrator_cabling.zero_rows."""
        cfg = _vav()
        self.assertEqual(set(_pr(cfg)["own_row_check"]["zero_rows"]), {"line", "attr_line"})
        self.assertEqual(set(_pr(cfg)["integrator_cabling"]["zero_rows"]), {"line"})
        for k in ("own_row_check", "integrator_cabling"):
            c = _vav(); del _pr(c)[k]["zero_rows"]; config_validation._validate_config(c)
        c = _vav(); _pr(c)["own_row_check"]["zero_rows"] = {"line": "x"}
        _refused(self, c, "own_row_check.zero_rows")
        c = _vav(); _pr(c)["own_row_check"]["zero_rows"]["line"] = "added here."
        _refused(self, c, "own_row_check.zero_rows")
        c = _vav(); _pr(c)["integrator_cabling"]["zero_rows"] = {"line": "{rows} zero", "extra": 1}
        _refused(self, c, "integrator_cabling.zero_rows")

