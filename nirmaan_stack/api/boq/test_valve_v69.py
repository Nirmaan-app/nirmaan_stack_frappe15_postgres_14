"""VP-5 (2026-11-15) -- HVAC v69 = v68 + THE VP-4 ALL-ROWS REVIEW RULINGS' CONFIG CHANGES on the Valve Package and the borrow-only Misc
configs (owner 2026-11-14 22:08-22:40, E1-E11; QR-1 "a a a"): the model guidance for E1-E11 in the question notes and the Misc SCOPE
question (E11). Minted by `scripts/_instruments/mint_hvac_v69_vp5.py`; the prices and the screen are proved through the panel's entry
point by `frontend/.../vp5ReviewFixes.test.ts`. Here, the asset:

  01  every item and every config byte-identical to v68 except hvac_valve_package and hvac_misc, which equal the mint's own
      transformation of v68's (`valve_config` / `misc_config`); a one-character change is not v69.
  02  the guidance reaches the model: the valve question (`build_items_spec`) carries every ruling's sentence; every other item-list
      request identical to v68's; second opinion OFF on both.
  03  the Misc scope question: the valve's v69 scope definition byte for byte (values, note incl. E11), never in a family's
      `needs` (matching never reads it); v68's Misc had none (NEGATIVE).
  04  VALIDATES: the validator, the cross-category checks; Valve Package eligible, Misc NOT (borrow-only); the eligible set = v68's.
  05  v69 is the newest HVAC asset; the series is 1..69 with no gap; v68 stays on disk.
  06  LIVE (after the load): the active valve / Misc configs equal v69's; 722 active HVAC items.
Run: bench --site localhost run-tests --module nirmaan_stack.api.boq.test_valve_v69
"""
import copy
import importlib.util
import json
import os
import re

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.services.boq_rate_master import config_validation, extraction, loader

V68 = "rate_master_hvac_all_v68.json"
V69 = "rate_master_hvac_all_v69.json"
VALVE, MISC = "hvac_valve_package", "hvac_misc"


def _asset_path(name):
    return os.path.join(os.path.dirname(loader.__file__), "data", name)


def _read(name):
    with open(name if os.path.isabs(name) else _asset_path(name), "r", encoding="utf-8") as fh:
        return json.load(fh)


def _mint():
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "scripts", "_instruments", "mint_hvac_v69_vp5.py")
    spec = importlib.util.spec_from_file_location("mint_hvac_v69_vp5", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _norm(obj):
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), default=str)


def _stored(payload):
    return {(payload["discipline"], c["category_id"]): dict(c, discipline=payload["discipline"]) for c in payload["category_configs"]}


class TestValveAssetV69(FrappeTestCase):
    ASSET = V69   # the asset under test (a vacuity run in scratch points this at a scratch copy)

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.prev = _read(V68)
        cls.cur = _read(cls.ASSET)
        cls.mint = _mint()
        cls.cfg_prev = {c["category_id"]: c for c in cls.prev["category_configs"]}
        cls.cfg = {c["category_id"]: c for c in cls.cur["category_configs"]}

    def test_01_only_the_declared_changes(self):
        self.assertEqual(_norm(self.cur["items"]), _norm(self.prev["items"]))
        self.assertEqual([c["category_id"] for c in self.cur["category_configs"]], [c["category_id"] for c in self.prev["category_configs"]])
        for cid, a in self.cfg_prev.items():
            if cid not in (VALVE, MISC):
                self.assertEqual(_norm(a), _norm(self.cfg[cid]), cid)
        self.assertEqual(_norm(self.cfg[VALVE]), _norm(self.mint.valve_config(self.cfg_prev[VALVE])))
        self.assertEqual(_norm(self.cfg[MISC]), _norm(self.mint.misc_config(self.cfg_prev[MISC], self.cfg[VALVE])))
        bad = copy.deepcopy(self.cfg[VALVE])          # NEGATIVE: one changed character in one note is not v69
        bad["list_spec"]["attribute_definitions"][0]["note"] += "x"
        self.assertNotEqual(_norm(bad), _norm(self.mint.valve_config(self.cfg_prev[VALVE])))

    def test_02_the_guidance_reaches_the_model(self):
        cfgs, cfgs_prev = _stored(self.cur), _stored(self.prev)
        q = json.dumps(extraction.build_items_spec(cfgs[("HVAC", VALVE)], cfgs, "HVAC"), ensure_ascii=False)
        q_prev = json.dumps(extraction.build_items_spec(cfgs_prev[("HVAC", VALVE)], cfgs_prev, "HVAC"), ensure_ascii=False)
        for k, words in list(self.mint.GUIDANCE.items()) + [("misc " + k, w) for k, w in self.mint.MISC_GUIDANCE.items()]:
            self.assertIn(json.dumps(words.strip(), ensure_ascii=False)[1:-1], q, k)
            self.assertNotIn(json.dumps(words.strip(), ensure_ascii=False)[1:-1], q_prev, k)
        for phrase in ("'with and without strainer'", "'swing check' NRV", "INTEGRATED P/T test points", "pressure independent on-off",
                       "An air vent named only in the heading", "'with out valve'", "is Installation only", "differential pressure gauge",
                       "isolation valves", "gauge 'provision'"):
            self.assertIn(phrase, q, phrase)
        for k, c in cfgs_prev.items():
            if c.get("list_spec") and k[1] not in (VALVE, MISC):
                self.assertEqual(json.dumps(extraction.build_items_spec(cfgs[k], cfgs, "HVAC"), sort_keys=True),
                                 json.dumps(extraction.build_items_spec(c, cfgs_prev, "HVAC"), sort_keys=True), k)
        self.assertIs(self.cfg[VALVE]["list_spec"]["second_opinion"], False)
        self.assertIs(self.cfg[MISC]["list_spec"]["second_opinion"], False)

    def test_03_the_misc_scope_question(self):
        mdefs = self.cfg[MISC]["list_spec"]["attribute_definitions"]
        vdef = [d for d in self.cfg[VALVE]["list_spec"]["attribute_definitions"] if d["id"] == "scope"]
        mscope = [d for d in mdefs if d["id"] == "scope"]
        self.assertEqual(len(mscope), 1)
        self.assertEqual(_norm(mscope[0]), _norm(vdef[0]))
        self.assertEqual(mdefs[-1]["id"], "scope")
        self.assertIn("Installation only", mscope[0]["values"])
        for fam, spec in (self.cfg[MISC]["list_spec"].get("families") or {}).items():
            self.assertNotIn("scope", spec.get("needs") or [], fam)
        self.assertFalse([d for d in self.cfg_prev[MISC]["list_spec"]["attribute_definitions"] if d["id"] == "scope"])   # NEGATIVE: v68 had none

    def test_04_validates_eligible_borrow_only(self):
        stored = list(_stored(self.cur).values())
        for c in stored:
            config_validation._validate_config(c)
        self.assertEqual(config_validation.delegated_section_problems(stored, self.cur["items"]), [])
        self.assertEqual(config_validation.extras_problems(stored, self.cur["items"]), [])
        self.assertEqual(config_validation.scope_problems(stored, self.cur["items"]), [])
        cfgs, cfgs_prev = _stored(self.cur), _stored(self.prev)
        self.assertTrue(extraction.config_is_eligible(cfgs[("HVAC", VALVE)], cfgs))
        self.assertFalse(extraction.config_is_eligible(cfgs[("HVAC", MISC)], cfgs))
        self.assertEqual(sorted(k[1] for k, c in cfgs.items() if extraction.config_is_eligible(c, cfgs)),
                         sorted(k[1] for k, c in cfgs_prev.items() if extraction.config_is_eligible(c, cfgs_prev)))

    def test_05_v69_is_the_newest_and_the_series_has_no_gap(self):
        data = os.path.dirname(_asset_path(V69))
        nums = sorted(int(m.group(1)) for f in os.listdir(data) for m in [re.match(r"^rate_master_hvac_all_v(\d+)\.json$", f)] if m)
        self.assertEqual(nums[-1], 75)  # DU-3 K2 (HVAC v75 minted + loaded; mechanical authority): BEFORE nums[-1] == 74; DU-2 K2c (HVAC v74 minted + loaded; mechanical authority): BEFORE nums[-1] == 73; DU-2 K2b (HVAC v73 minted + loaded; mechanical authority): BEFORE nums[-1] == 72; DU-2 K2 (HVAC v72 minted + loaded; mechanical authority): BEFORE nums[-1] == 71; DU-1 Part B (HVAC v71 minted + loaded; mechanical authority): BEFORE nums[-1] == 70; DU-1 (HVAC v70 minted + loaded; mechanical authority): BEFORE nums[-1] == 69
        self.assertEqual(nums, list(range(1, 76)))  # DU-3 K2 (HVAC v75 minted + loaded; mechanical authority): BEFORE list(range(1, 75)); DU-2 K2c (HVAC v74 minted + loaded; mechanical authority): BEFORE list(range(1, 74)); DU-2 K2b (HVAC v73 minted + loaded; mechanical authority): BEFORE list(range(1, 73)); DU-2 K2 (HVAC v72 minted + loaded; mechanical authority): BEFORE list(range(1, 72)); DU-1 Part B (HVAC v71 minted + loaded; mechanical authority): BEFORE list(range(1, 71)); DU-1 (HVAC v70 minted + loaded; mechanical authority): BEFORE list(range(1, 70))
        self.assertTrue(os.path.exists(_asset_path(V68)))

    def test_06_live_catalogue_is_v69(self):
        # INVERTED at DU-1 (HVAC v70 LOADED; mechanical authority): the live Valve Package / Misc configs are v70's (v69 + the declared
        # Derivation lines; proved by test_hvac_v70_du1) and no longer v69's. BEFORE: live == v69's
        # DU-1 Part B (HVAC v71 LOADED; mechanical authority): v71's now (Misc gains the Ducting Misc-tab families + borrowers_ask_offered_only;
        # the Valve Package is unchanged; proved by test_hvac_v71_du1). BEFORE: live == v70's
        # DU-2 K2c (HVAC v74 LOADED; mechanical authority): the live Misc config is v74's (its unit-refusal wording); Valve = v71's = v74's. BEFORE: v71's
        v70 = {c["category_id"]: c for c in _read("rate_master_hvac_all_v75.json")["category_configs"]}  # DU-3 K2 (HVAC v75 LOADED; mechanical authority): Valve gains pair_note (R3), Misc = v74's. BEFORE: v74's
        for cid in (VALVE, MISC):
            row = frappe.db.sql('select config from "tabBoQ Rate Category Config" where active=1 and discipline=%s and category_id=%s', ("HVAC", cid))
            self.assertTrue(row, cid)
            live = json.loads(row[0][0]) if isinstance(row[0][0], str) else row[0][0]
            self.assertEqual(_norm(live), _norm(v70[cid]), cid)
            self.assertNotEqual(_norm(live), _norm(self.cfg[cid]), cid)
        n = frappe.db.sql('select count(*) from "tabBoQ Rate Master Item" where active=1 and discipline=%s', ("HVAC",))[0][0]
        self.assertEqual(n, 744)   # DU-3 K2 (HVAC v75 minted + loaded; mechanical authority): + 1 Ducting input (insulation coverage threshold). BEFORE 743; DU-1 Part B (HVAC v71 LOADED; mechanical authority): + 15 duct, 5 Misc-tab items, 1 input. BEFORE 722
