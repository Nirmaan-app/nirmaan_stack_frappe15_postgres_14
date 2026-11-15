"""VP-3 (2026-11-13) -- HVAC v67 = v66 + THE VP-2 REVIEW RULINGS' CONFIG CHANGES on the Valve Package and the borrow-only Misc
configs (owner 2026-11-13 17:26-17:47): the model guidance for D1 / D2 / D3 / D4 / D5 / D7a / D7b / D7c in the question notes and the
C1 / C2 / C4 / C5 note and wording keys. Minted by `scripts/_instruments/mint_hvac_v67_vp3.py`; the prices and the screen are proved
through the panel's entry point by `frontend/.../vp3Config.test.ts` (and the code nets by `vp3ReviewFixes.test.ts`). Here, the asset:

  01  every item and every config byte-identical to v66 except hvac_valve_package and hvac_misc, which equal the mint's own
      transformation of v66's (`valve_config` / `misc_config`); a one-character change is not v67.
  02  the guidance reaches the model: the valve question (`build_items_spec`) carries every ruling's sentence; every other item-list
      request identical to v66's; second opinion OFF on both.
  03  VALIDATES: the validator, the cross-category checks; Valve Package eligible, Misc NOT (borrow-only); the eligible set = v66's.
  04  v67 is the newest HVAC asset; the series is 1..67 with no gap; v66 stays on disk.
  05  LIVE (after the load): the active valve / Misc configs equal v67's; 722 active HVAC items.
Run: bench --site localhost run-tests --module nirmaan_stack.api.boq.test_valve_v67
"""
import copy
import importlib.util
import json
import os
import re

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.services.boq_rate_master import config_validation, extraction, loader

V66 = "rate_master_hvac_all_v66.json"
V67 = "rate_master_hvac_all_v67.json"
VALVE, MISC = "hvac_valve_package", "hvac_misc"


def _asset_path(name):
    return os.path.join(os.path.dirname(loader.__file__), "data", name)


def _read(name):
    with open(name if os.path.isabs(name) else _asset_path(name), "r", encoding="utf-8") as fh:
        return json.load(fh)


def _mint():
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "scripts", "_instruments", "mint_hvac_v67_vp3.py")
    spec = importlib.util.spec_from_file_location("mint_hvac_v67_vp3", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _norm(obj):
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), default=str)


def _stored(payload):
    return {(payload["discipline"], c["category_id"]): dict(c, discipline=payload["discipline"]) for c in payload["category_configs"]}


class TestValveAssetV67(FrappeTestCase):
    ASSET = V67   # the asset under test (a vacuity run in scratch points this at a scratch copy)

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.v66 = _read(V66)
        cls.v67 = _read(cls.ASSET)
        cls.mint = _mint()
        cls.cfg66 = {c["category_id"]: c for c in cls.v66["category_configs"]}
        cls.cfg = {c["category_id"]: c for c in cls.v67["category_configs"]}

    def test_01_only_the_declared_changes(self):
        self.assertEqual(_norm(self.v67["items"]), _norm(self.v66["items"]))
        self.assertEqual([c["category_id"] for c in self.v67["category_configs"]], [c["category_id"] for c in self.v66["category_configs"]])
        for cid, a in self.cfg66.items():
            if cid not in (VALVE, MISC):
                self.assertEqual(_norm(a), _norm(self.cfg[cid]), cid)
        self.assertEqual(_norm(self.cfg[VALVE]), _norm(self.mint.valve_config(self.cfg66[VALVE])))
        self.assertEqual(_norm(self.cfg[MISC]), _norm(self.mint.misc_config(self.cfg66[MISC])))
        # NEGATIVE: one changed character in one note is not v67
        bad = copy.deepcopy(self.cfg[VALVE])
        bad["list_spec"]["attribute_definitions"][0]["note"] += "x"
        self.assertNotEqual(_norm(bad), _norm(self.mint.valve_config(self.cfg66[VALVE])))

    def test_02_the_guidance_reaches_the_model(self):
        cfgs, cfgs66 = _stored(self.v67), _stored(self.v66)
        q = json.dumps(extraction.build_items_spec(cfgs[("HVAC", VALVE)], cfgs, "HVAC"), ensure_ascii=False)
        q66 = json.dumps(extraction.build_items_spec(cfgs66[("HVAC", VALVE)], cfgs66, "HVAC"), ensure_ascii=False)
        for k, words in list(self.mint.GUIDANCE.items()) + [("misc item", self.mint.MISC_GUIDANCE["item"])]:
            self.assertIn(json.dumps(words.strip(), ensure_ascii=False)[1:-1], q, k)
            self.assertNotIn(json.dumps(words.strip(), ensure_ascii=False)[1:-1], q66, k)
        for phrase in ("PART of the PIBCV item", "is part of the gauge", "BALL VALVE's size", "Ball Valve when its size is 40 mm or below",
                       "TWO items: the valve and a Strainer", "is Dual Plate", "'4-20 mA'", "'portable' or 'handed over' means Supply only",
                       "('15mm\\\"') is that many mm"):
            self.assertIn(phrase, q, phrase)
        for k, c in cfgs66.items():
            if c.get("list_spec") and k[1] not in (VALVE, MISC):
                self.assertEqual(json.dumps(extraction.build_items_spec(cfgs[k], cfgs, "HVAC"), sort_keys=True),
                                 json.dumps(extraction.build_items_spec(c, cfgs66, "HVAC"), sort_keys=True), k)
        self.assertIs(self.cfg[VALVE]["list_spec"]["second_opinion"], False)
        self.assertIs(self.cfg[MISC]["list_spec"]["second_opinion"], False)

    def test_03_validates_eligible_borrow_only(self):
        stored = list(_stored(self.v67).values())
        for c in stored:
            config_validation._validate_config(c)
        self.assertEqual(config_validation.delegated_section_problems(stored, self.v67["items"]), [])
        self.assertEqual(config_validation.extras_problems(stored, self.v67["items"]), [])
        self.assertEqual(config_validation.scope_problems(stored, self.v67["items"]), [])
        cfgs, cfgs66 = _stored(self.v67), _stored(self.v66)
        self.assertTrue(extraction.config_is_eligible(cfgs[("HVAC", VALVE)], cfgs))
        self.assertFalse(extraction.config_is_eligible(cfgs[("HVAC", MISC)], cfgs))
        self.assertEqual(sorted(k[1] for k, c in cfgs.items() if extraction.config_is_eligible(c, cfgs)),
                         sorted(k[1] for k, c in cfgs66.items() if extraction.config_is_eligible(c, cfgs66)))

    def test_04_v67_is_the_newest_and_the_series_has_no_gap(self):
        data = os.path.dirname(_asset_path(V67))
        nums = sorted(int(m.group(1)) for f in os.listdir(data) for m in [re.match(r"^rate_master_hvac_all_v(\d+)\.json$", f)] if m)
        self.assertEqual(nums[-1], 74)  # DU-2 K2c (HVAC v74 minted + loaded; mechanical authority): BEFORE nums[-1] == 73; DU-2 K2b (HVAC v73 minted + loaded; mechanical authority): BEFORE nums[-1] == 72; DU-2 K2 (HVAC v72 minted + loaded; mechanical authority): BEFORE nums[-1] == 71; DU-1 Part B (HVAC v71 minted + loaded; mechanical authority): BEFORE nums[-1] == 70; DU-1 (HVAC v70 minted + loaded; mechanical authority): BEFORE nums[-1] == 69; VP-5 (HVAC v69 minted + loaded; mechanical authority): BEFORE nums[-1] == 68; VP-4 (BEFORE nums[-1] == 67)
        self.assertEqual(nums, list(range(1, 75)))  # DU-2 K2c (HVAC v74 minted + loaded; mechanical authority): BEFORE list(range(1, 74)); DU-2 K2b (HVAC v73 minted + loaded; mechanical authority): BEFORE list(range(1, 73)); DU-2 K2 (HVAC v72 minted + loaded; mechanical authority): BEFORE list(range(1, 72)); DU-1 Part B (HVAC v71 minted + loaded; mechanical authority): BEFORE list(range(1, 71)); DU-1 (HVAC v70 minted + loaded; mechanical authority): BEFORE list(range(1, 70)); VP-5 (HVAC v69 minted + loaded; mechanical authority): BEFORE list(range(1, 69)); VP-4 (BEFORE list(range(1, 68)))
        self.assertTrue(os.path.exists(_asset_path(V66)))

    def test_05_live_catalogue_is_v67(self):
        # INVERTED at VP-4 (HVAC v68 LOADED; mechanical authority): the live Valve Package / Misc configs are v68's (the VP-3 re-review
        # rulings' guidance, T2 / T3 keys; proved by test_valve_v68) and no longer v67's. BEFORE: live == v67's
        # VP-5 (HVAC v69 LOADED; mechanical authority): v69's now (proved by test_valve_v69). BEFORE: live == v68's
        # DU-1 (HVAC v70 LOADED; mechanical authority): v70's now (the declared Derivation lines; proved by test_hvac_v70_du1). BEFORE: live == v69's
        # DU-1 Part B (HVAC v71 LOADED; mechanical authority): v71's now (Misc gains the Ducting Misc-tab families + borrowers_ask_offered_only;
        # the Valve Package is unchanged; proved by test_hvac_v71_du1). BEFORE: live == v70's
        # DU-2 K2c (HVAC v74 LOADED; mechanical authority): the live Misc config is v74's (its unit-refusal wording); Valve = v71's = v74's. BEFORE: v71's
        v68 = {c["category_id"]: c for c in _read("rate_master_hvac_all_v74.json")["category_configs"]}
        for cid in (VALVE, MISC):
            row = frappe.db.sql('select config from "tabBoQ Rate Category Config" where active=1 and discipline=%s and category_id=%s', ("HVAC", cid))
            self.assertTrue(row, cid)
            live = json.loads(row[0][0]) if isinstance(row[0][0], str) else row[0][0]
            self.assertEqual(_norm(live), _norm(v68[cid]), cid)
            self.assertNotEqual(_norm(live), _norm(self.cfg[cid]), cid)
        n = frappe.db.sql('select count(*) from "tabBoQ Rate Master Item" where active=1 and discipline=%s', ("HVAC",))[0][0]
        self.assertEqual(n, 743)   # DU-1 Part B (HVAC v71 LOADED; mechanical authority): + 15 duct, 5 Misc-tab items, 1 input. BEFORE 722
