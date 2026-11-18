"""VAV-1 (owner QR-A (a), 2026-11-19 02:57 "optiom a") -- THE TEMPORARY CALCULATOR-ONLY SWITCH, revived for hvac_vav_box ONLY and removed
by the VAV slice that makes VAV rows go live (VAV-2b). The VRF-2a pattern (92834b7e5), re-pointed.

The server's half: the validator allows `calculator_only: true` on hvac_vav_box ONLY (any other category is refused, naming the reason);
a config carrying it is NOT eligible, so `assemble_population` admits none of its rows and no Suggest run asks the model about them.
FIXTURES, no DB writes: the VAV Box config the v76 mint builds (`mint_hvac_v76_vav1.vav_config`, with and without its key) and v75's
built configs -- no v76 file is read, so this commits BEFORE the asset (owner ANSWER 3). The
calculator / BoQ-row halves are pinned on the frontend (vav1VavSurfaces.test.ts).
Run: bench --site localhost run-tests --module nirmaan_stack.services.boq_rate_master.test_calculator_only_vav1
"""
import copy
import json
import os
import unittest
from unittest import mock

from nirmaan_stack.services.boq_rate_master import config_validation, extraction

DATA = os.path.join(os.path.dirname(__file__), "data")
VAV = "hvac_vav_box"


def _cfg(v, cid):
    with open(os.path.join(DATA, f"rate_master_hvac_all_v{v}.json"), encoding="utf-8") as f:
        return copy.deepcopy(dict(next(c for c in json.load(f)["category_configs"] if c["category_id"] == cid), discipline="HVAC"))


def _mint():
    import importlib.util
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "scripts", "_instruments", "mint_hvac_v76_vav1.py")
    spec = importlib.util.spec_from_file_location("mint_hvac_v76_vav1", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _vav(key=True):
    """the VAV Box config the v76 mint builds (its pure `vav_config`), with or without the switch -- no asset file needed"""
    c = dict(_mint().vav_config("calculator_only" if key else "live"), discipline="HVAC")
    return copy.deepcopy(c)


class TestVav1CalculatorOnlySwitch(unittest.TestCase):
    # ---- the validator ----------------------------------------------------------------------------------------
    def test_01_POSITIVE_the_shipped_vav_config_carries_the_key_and_validates(self):
        self.assertIs(_vav().get("calculator_only"), True)
        config_validation._validate_config(_vav())
        config_validation._validate_config(_vav(key=False))      # and the config without it
        self.assertEqual(config_validation._CALCULATOR_ONLY_CATEGORIES, frozenset({VAV}))

    def test_02_NEGATIVE_refused_on_any_other_category_naming_the_reason(self):
        for cat in ("hvac_ducting", "hvac_valve_package", "hvac_piping", "hvac_misc"):
            cfg = _cfg(75, cat)
            config_validation._validate_config(copy.deepcopy(cfg))          # valid as shipped
            cfg["calculator_only"] = True
            with self.assertRaises(Exception) as cm:
                config_validation._validate_config(cfg)
            msg = str(cm.exception)
            self.assertIn("calculator_only is not allowed on category '%s'" % cat, msg)
            self.assertIn("temporary switch for VAV Box only", msg)
        # the Sensors config (borrow-only, also new in v76) may not carry it either
        s = dict(_mint().sensors_config(_cfg(75, "hvac_misc")), discipline="HVAC")
        s["calculator_only"] = True
        with self.assertRaises(Exception):
            config_validation._validate_config(s)

    def test_03_NEGATIVE_an_explicit_false_or_a_non_bool_is_a_key_doing_nothing(self):
        for bad in (False, "true", 1, None):
            cfg = _vav()
            cfg["calculator_only"] = bad
            with self.assertRaises(Exception) as cm:
                config_validation._validate_config(cfg)
            self.assertIn("calculator_only must be true when present", str(cm.exception))

    def test_04_NEGATIVE_refused_without_an_item_list_pricing_block(self):
        cfg = _vav()
        del cfg["list_spec"]["pricing"]["families"]
        with self.assertRaises(Exception):
            config_validation._validate_calculator_only(cfg)
        cfg["list_spec"]["pricing"]["families"] = {}
        with self.assertRaises(Exception) as cm:
            config_validation._validate_calculator_only(cfg)
        self.assertIn("calculator_only needs an item-list pricing block", str(cm.exception))

    # ---- eligibility (B3: VAV-filed rows are not sent by Suggest) ---------------------------------------------------
    def test_05_NOT_eligible_WITH_the_key_eligible_WITHOUT_it_the_rules_still_run(self):
        on, off = _vav(key=False), _vav(key=True)
        self.assertTrue(extraction.config_is_eligible(on))
        self.assertFalse(extraction.config_is_eligible(off))
        self.assertTrue(extraction.has_runnable_pricing_rules(off))       # only the switch holds it back
        self.assertFalse(extraction.config_is_eligible(off, {("HVAC", VAV): off}))

    def test_06_an_ALIAS_onto_the_calculator_only_target_is_not_eligible_either(self):
        alias = {"discipline": "HVAC", "category_id": "hvac_vav_alias", "attribute_definitions": [], "pipelines": {},
                 "alias_of": {"discipline": "HVAC", "category_id": VAV}}
        cfgs = {("HVAC", VAV): _vav(key=True), ("HVAC", "hvac_vav_alias"): alias}
        self.assertFalse(extraction.config_is_eligible(alias, cfgs))
        cfgs[("HVAC", VAV)] = _vav(key=False)
        self.assertTrue(extraction.config_is_eligible(alias, cfgs))

    def test_07_assemble_population_admits_NO_VAV_row(self):
        """The Suggest population on a fixture sheet: a VAV Box row and a Ducting row. With the key only the Ducting row is admitted;
        without it (VACUITY: the switch taken out), both are."""
        duct = _cfg(75, "hvac_ducting")
        ctx = {"committed_version": 3, "rows": [{"excel_row": 10, "description": "VAV box 750 CFM"}, {"excel_row": 11, "description": "GI duct 24G"}]}
        resolved = {10: (VAV, "HVAC"), 11: ("hvac_ducting", "HVAC")}

        def run(vav_cfg):
            cfgs = {("HVAC", VAV): vav_cfg, ("HVAC", "hvac_ducting"): duct}
            with mock.patch.object(extraction, "build_sheet_context", return_value=copy.deepcopy(ctx)), \
                    mock.patch.object(extraction, "_resolved_categories", return_value=resolved), \
                    mock.patch.object(extraction, "_rate_editable_excel_rows", return_value={10, 11}), \
                    mock.patch.object(extraction, "load_configs_with_alias_targets", return_value=cfgs):
                cv, rows = extraction.assemble_population("BOQ-FIXTURE", "VAV")
            self.assertEqual(cv, 3)
            return [(r["excel_row"], r["category_id"]) for r in rows]

        self.assertEqual(run(_vav(key=True)), [(11, "hvac_ducting")])
        self.assertEqual(run(_vav(key=False)), [(10, VAV), (11, "hvac_ducting")])

    def test_08_NEGATIVE_the_key_is_IGNORED_off_VAV_every_built_category_unchanged(self):
        """The server mirrors the client: the key counts only on hvac_vav_box. The frozen v28 Insulation config still carries FA7's retired
        key; it stays eligible, as 12d-2 pinned. A built category carrying the key (impossible past the validator) stays eligible."""
        ins28 = _cfg(28, "hvac_insulation")
        self.assertIs(ins28.get("calculator_only"), True)
        self.assertTrue(extraction.config_is_eligible(ins28))
        for cat in ("hvac_adp", "hvac_ducting", "hvac_insulation", "hvac_piping", "hvac_valve_package", "hvac_vrf"):
            c = _cfg(75, cat)          # every built category: byte-identical in v76 (test_hvac_v76_vav1 01)
            self.assertTrue(extraction.config_is_eligible(c), cat)
            c["calculator_only"] = True
            self.assertTrue(extraction.config_is_eligible(c), cat)


if __name__ == "__main__":
    unittest.main()
