"""VAV-2a (owner rulings 2026-11-18 23:14 - 2026-11-19 13:31; QR-S (a)) -- THE SERVER HALF OF THE VAV-2a KEYS on hvac_vav_box:
`own_row_check` (B3 / B4 / QR-C1), `integrator_cabling` (B5), `existing_boxes` (B6), `combination_warning` (B9), the sections' `qty_attr`
(B7), and the 8 VAV-2a Pricing Inputs they read.

FIXTURES, no DB writes: the VAV config the v77 mint builds (`mint_hvac_v77_vav2a.vav_config` on the v76 file's VAV config + the ONE keys file
frontend/.../__fixtures__/vav2aKeys.json) and v76's built configs -- the v77 file is not read, so this commits BEFORE the asset.
The pricing halves (each piece's positive / negative cases, vacuity) are pinned on the frontend (vav2aSheetRules / vav2aQtyWarning).
Run: bench --site localhost run-tests --module nirmaan_stack.services.boq_rate_master.test_vav2a_keys
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
KEYS_PATH = os.path.join(APP, "frontend", "src", "pages", "boq-wizard", "rate-helper", "__fixtures__", "vav2aKeys.json")
VAV = "hvac_vav_box"
INPUTS = ["vav_own_row_threshold", "vav_cabling_m_per_box", "vav_cabling_length_threshold", "vav_existing_dismantle",
          "vav_existing_dismantle_refix", "vav_existing_refix_with_dismantling", "vav_existing_refix_alone", "vav_combination_warning_share"]


def _v76():
    with open(os.path.join(DATA, "rate_master_hvac_all_v76.json"), encoding="utf-8") as f:
        return json.load(f)


def _keys():
    with open(KEYS_PATH, encoding="utf-8") as f:
        return json.load(f)


def _mint():
    path = os.path.join(APP, "scripts", "_instruments", "mint_hvac_v77_vav2a.py")
    spec = importlib.util.spec_from_file_location("mint_hvac_v77_vav2a", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _vav():
    """the VAV config the v77 mint builds (its pure `vav_config`) -- no asset file needed"""
    prev = next(c for c in _v76()["category_configs"] if c["category_id"] == VAV)
    return dict(copy.deepcopy(_mint().vav_config(prev, _keys())), discipline="HVAC")


def _refused(test, cfg, needle):
    with test.assertRaises(Exception) as cm:
        config_validation._validate_config(cfg)
    test.assertIn(needle, str(cm.exception))


class TestVav2aKeys(unittest.TestCase):
    # ---- the shipped shape ---------------------------------------------------------------------------------------
    def test_01_POSITIVE_the_v77_vav_config_validates_with_every_key_and_without_each(self):
        cfg = _vav()
        pr = cfg["list_spec"]["pricing"]
        for k in ("own_row_check", "integrator_cabling", "existing_boxes", "combination_warning"):
            self.assertIn(k, pr)
        self.assertEqual([s.get("qty_attr") for s in cfg["list_spec"]["sections"] if s.get("category_id")], ["qty_per_box", "qty_per_box"])
        self.assertIs(cfg.get("calculator_only"), True)                     # VAV rows stay "coming soon" (VAV-2b removes it)
        config_validation._validate_config(copy.deepcopy(cfg))
        for k in ("own_row_check", "integrator_cabling", "existing_boxes", "combination_warning"):
            c = copy.deepcopy(cfg)
            del c["list_spec"]["pricing"][k]
            config_validation._validate_config(c)

    def test_02_the_cabling_wording_says_BCS_cost_140_and_quoted_196(self):
        why = next(r["why"] for r in _vav()["list_spec"]["pricing"]["derivation_reasons"] if r["title"] == "^That kind's rule for that unit")
        self.assertIn("BCS cost 140 per metre, quoted 196 per metre", why)
        self.assertIn("\"the 140 per meter is BCSrate and not quoting rate\"", why)

    # ---- negatives: each key refused by name when malformed ---------------------------------------------------------
    def test_03_NEGATIVE_own_row_check_shapes(self):
        def bad(mut, needle):
            c = _vav()
            mut(c["list_spec"]["pricing"]["own_row_check"])
            _refused(self, c, needle)
        bad(lambda o: o.pop("threshold_input"), "own_row_check needs exactly")
        bad(lambda o: o.update(box_words="(unclosed"), "own_row_check.box_words is not a valid pattern")
        bad(lambda o: o["extras"][0]["target"].update(family="Not offered"), "is not offered by section 'misc'")
        bad(lambda o: o["extras"][2]["target"].update(family="No such family"), "must name a family of this config")
        bad(lambda o: o["extras"][-1]["target"].update(to="Maybe"), "must be a choice attribute of this config whose values hold from and to")
        bad(lambda o: o["lines"].update(not_added="no rows named"), "own_row_check.lines.not_added must name {rows}")
        bad(lambda o: o["extras"][0].update(colour="red"), "needs label, target and words")
        bad(lambda o: o.update(metre_units=[]), "metre_units must be a non-empty list")

    def test_04_NEGATIVE_integrator_cabling_existing_boxes_combination_qty_attr(self):
        c = _vav(); c["list_spec"]["pricing"]["integrator_cabling"]["family"] = "Cable"
        _refused(self, c, "integrator_cabling.family 'Cable' is not a family of this config")
        c = _vav(); c["list_spec"]["pricing"]["integrator_cabling"]["near_chars"] = 0
        _refused(self, c, "integrator_cabling.near_chars must be a positive whole number")
        c = _vav(); del c["list_spec"]["pricing"]["existing_boxes"]["kinds"][0]["factor_input"]
        _refused(self, c, "needs id, words, label and factor_input")
        c = _vav(); c["list_spec"]["pricing"]["existing_boxes"]["install_family"] = "VAV box install"
        _refused(self, c, "existing_boxes.install_family 'VAV box install' is not a family of this config")
        c = _vav(); c["list_spec"]["pricing"]["combination_warning"]["box_families"] = ["Box"]
        _refused(self, c, "combination_warning.box_families must be a non-empty list of this config's families")
        c = _vav(); c["list_spec"]["pricing"]["combination_warning"]["line"] = "no placeholders"
        _refused(self, c, "combination_warning.line must name {n}")
        c = _vav(); next(s for s in c["list_spec"]["sections"] if s["id"] == "misc")["qty_attr"] = "shape"
        _refused(self, c, "qty_attr must name a number attribute of this config's list_spec")

    # ---- the inputs: read by the config (born connected), and the cross-item check ---------------------------------------
    def test_05_every_new_input_is_read_by_the_vav_config(self):
        pr = _vav()["list_spec"]["pricing"]
        self.assertEqual(sorted(config_validation.vav_sheet_input_ids(pr)), sorted(INPUTS))
        self.assertEqual(sorted(config_validation.extras_input_ids(_vav())), sorted(INPUTS + ["vav_install_only_uplift"]))
        self.assertEqual(sorted(_keys()["inputs"]), sorted(INPUTS))

    def test_06_scope_problems_POSITIVE_with_the_minted_inputs_NEGATIVE_without_each(self):
        v76 = _v76()
        items = v76["items"] + _mint().input_items(_keys(), {i["item_uid"] for i in v76["items"]})
        cfgs = [dict(c, discipline="HVAC") for c in v76["category_configs"] if c["category_id"] != VAV] + [_vav()]
        self.assertEqual(config_validation.scope_problems(cfgs, items), [])
        for iid in INPUTS:
            fewer = [i for i in items if (i.get("attributes") or {}).get("item") != iid]
            probs = config_validation.scope_problems(cfgs, fewer)
            self.assertEqual(probs, ["'hvac_vav_box' VAV-2a: the input '%s' is not a Pricing Input item." % iid], iid)

    # ---- no built category moves (T3, the server half) ---------------------------------------------------------------
    def test_07_built_categories_carry_no_vav2a_key_and_read_no_new_input(self):
        for c in _v76()["category_configs"]:
            if c["category_id"] == VAV:
                continue
            pr = (c.get("list_spec") or {}).get("pricing") or {}
            self.assertEqual(config_validation.vav_sheet_input_ids(pr), [], c["category_id"])
            for k in ("own_row_check", "integrator_cabling", "existing_boxes", "combination_warning"):
                self.assertNotIn(k, pr, c["category_id"])
            self.assertFalse(any("qty_attr" in s for s in ((c.get("list_spec") or {}).get("sections") or [])), c["category_id"])

    def test_08_the_keys_do_not_make_vav_eligible_and_the_model_request_is_unchanged(self):
        v76 = _v76()
        base = {("HVAC", c["category_id"]): dict(c, discipline="HVAC") for c in v76["category_configs"]}
        new = dict(base); new[("HVAC", VAV)] = _vav()
        self.assertFalse(extraction.config_is_eligible(new[("HVAC", VAV)], new))
        for cid in ("hvac_ducting", "hvac_valve_package", "hvac_vrf", "hvac_piping", "hvac_insulation", "hvac_adp", VAV):
            self.assertEqual(json.dumps(extraction.build_items_spec(base[("HVAC", cid)], base, "HVAC"), sort_keys=True),
                             json.dumps(extraction.build_items_spec(new[("HVAC", cid)], new, "HVAC"), sort_keys=True), cid)


if __name__ == "__main__":
    unittest.main()
