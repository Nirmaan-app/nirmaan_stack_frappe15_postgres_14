"""DU-1 PART A (2026-11-15) -- HVAC v70 = v69 + THE VALVE PACKAGE AND MISC DECLARED DERIVATION LINES (VP-DRV FIX-1 / FIX-3; owner
2026-11-15 13:30-13:41 "we need to make sutre that the derivatrion screen captures all th erules"). Display only. Minted by
`scripts/_instruments/mint_hvac_v70_du1a.py`; the tab and its coverage are proved by `frontend/.../derivationCoverage.latest.test.ts`.
Here, the asset:

  01  every item and every config byte-identical to v69 except hvac_valve_package and hvac_misc, which equal the mint's own
      transformation of v69's (`valve_config` / `misc_config`); a one-character change is not v70.
  02  DISPLAY ONLY: every item-list request (`build_items_spec`) byte-identical to v69's -- the model's question does not move;
      second opinion OFF on both.
  03  the declared lines: one per registered valve code rule (VP-3 D1-D7c, VP-4 R1-R4 / W1 / W2 / T1, VP-5 E1-E10), Misc's T1; every
      text_notes entry carries its rule_line; the butterfly rule_line names the four sheet items; v69 had none (NEGATIVE).
  04  VALIDATES: the validator, the cross-category checks; the eligible set = v69's.
  05  v70 is the newest HVAC asset; the series is 1..70 with no gap; v69 stays on disk.
  06  LIVE (after the load): the active valve / Misc configs equal v70's; 722 active HVAC items.
Run: bench --site localhost run-tests --module nirmaan_stack.api.boq.test_hvac_v70_du1
"""
import copy
import importlib.util
import json
import os
import re

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.services.boq_rate_master import config_validation, extraction, loader

V69 = "rate_master_hvac_all_v69.json"
V70 = "rate_master_hvac_all_v70.json"
VALVE, MISC = "hvac_valve_package", "hvac_misc"
VALVE_CODE_RULES = ["D1", "D2", "D3", "D4", "D5", "D7b", "D7c", "R1", "R2", "R3", "R4", "W1", "W2",
                    "E1", "E2", "E3", "E4", "E6", "E7", "E8", "E9", "E10", "T1"]   # = frontend derivationCoverage.CODE_RULES


def _asset_path(name):
    return os.path.join(os.path.dirname(loader.__file__), "data", name)


def _read(name):
    with open(name if os.path.isabs(name) else _asset_path(name), "r", encoding="utf-8") as fh:
        return json.load(fh)


def _mint():
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "scripts", "_instruments", "mint_hvac_v70_du1a.py")
    spec = importlib.util.spec_from_file_location("mint_hvac_v70_du1a", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _norm(obj):
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), default=str)


def _stored(payload):
    return {(payload["discipline"], c["category_id"]): dict(c, discipline=payload["discipline"]) for c in payload["category_configs"]}


class TestHvacAssetV70(FrappeTestCase):
    ASSET = V70   # the asset under test (a vacuity run in scratch points this at a scratch copy)

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.prev = _read(V69)
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
        self.assertEqual(_norm(self.cfg[MISC]), _norm(self.mint.misc_config(self.cfg_prev[MISC])))
        bad = copy.deepcopy(self.cfg[VALVE])          # NEGATIVE: one changed character in one declared line is not v70
        bad["list_spec"]["pricing"]["rule_lines"][0]["title"] += "x"
        self.assertNotEqual(_norm(bad), _norm(self.mint.valve_config(self.cfg_prev[VALVE])))

    def test_02_display_only_the_question_does_not_move(self):
        cfgs, cfgs_prev = _stored(self.cur), _stored(self.prev)
        for k, c in cfgs_prev.items():
            if c.get("list_spec"):
                self.assertEqual(json.dumps(extraction.build_items_spec(cfgs[k], cfgs, "HVAC"), sort_keys=True),
                                 json.dumps(extraction.build_items_spec(c, cfgs_prev, "HVAC"), sort_keys=True), k)
        q = json.dumps(extraction.build_items_spec(cfgs[("HVAC", VALVE)], cfgs, "HVAC"), ensure_ascii=False)
        for r in self.cfg[VALVE]["list_spec"]["pricing"]["rule_lines"]:
            self.assertNotIn(r["title"], q, r["rule"])   # NEGATIVE: no declared line reaches the model
        self.assertIs(self.cfg[VALVE]["list_spec"]["second_opinion"], False)
        self.assertIs(self.cfg[MISC]["list_spec"]["second_opinion"], False)

    def test_03_the_declared_lines(self):
        vp = self.cfg[VALVE]["list_spec"]["pricing"]
        self.assertEqual([r["rule"] for r in vp["rule_lines"]], VALVE_CODE_RULES)
        self.assertTrue(all(r["title"].strip() for r in vp["rule_lines"]))
        self.assertEqual([r["rule"] for r in self.cfg[MISC]["list_spec"]["pricing"]["rule_lines"]], ["T1"])
        for cid in (VALVE, MISC):
            self.assertTrue(all(t.get("rule_line") for t in self.cfg[cid]["list_spec"]["pricing"]["text_notes"]), cid)
        bf = [r for r in vp["read_notes"] if r.get("families") == ["Butterfly Valve"]][0]
        for words in ("steel lever 25 mm", "hand lever 50-150 mm", "gear box 200-250 mm", "plain 300 mm"):
            self.assertIn(words, bf["rule_line"])
        for cid in (VALVE, MISC):   # NEGATIVE: v69 declared none
            self.assertNotIn("rule_lines", self.cfg_prev[cid]["list_spec"]["pricing"], cid)

    def test_04_validates_eligible(self):
        stored = list(_stored(self.cur).values())
        for c in stored:
            config_validation._validate_config(c)
        self.assertEqual(config_validation.delegated_section_problems(stored, self.cur["items"]), [])
        self.assertEqual(config_validation.extras_problems(stored, self.cur["items"]), [])
        self.assertEqual(config_validation.scope_problems(stored, self.cur["items"]), [])
        cfgs, cfgs_prev = _stored(self.cur), _stored(self.prev)
        self.assertEqual(sorted(k[1] for k, c in cfgs.items() if extraction.config_is_eligible(c, cfgs)),
                         sorted(k[1] for k, c in cfgs_prev.items() if extraction.config_is_eligible(c, cfgs_prev)))

    def test_05_v70_is_the_newest_and_the_series_has_no_gap(self):
        data = os.path.dirname(_asset_path(V70))
        nums = sorted(int(m.group(1)) for f in os.listdir(data) for m in [re.match(r"^rate_master_hvac_all_v(\d+)\.json$", f)] if m)
        self.assertEqual(nums[-1], 80)  # VAV-2b1 K2 (HVAC v80 minted + loaded; mechanical authority): BEFORE nums[-1] == 79; VAV-2b1 K2 (HVAC v79 minted + loaded; mechanical authority): BEFORE nums[-1] == 78; VAV-2a2 K2 (HVAC v78 minted + loaded; mechanical authority): BEFORE nums[-1] == 77; VAV-2a K2 (HVAC v77 minted + loaded; mechanical authority): BEFORE nums[-1] == 76; VAV-1 K2 (HVAC v76 minted + loaded; mechanical authority): BEFORE nums[-1] == 75; DU-3 K2 (HVAC v75 minted + loaded; mechanical authority): BEFORE nums[-1] == 74; DU-2 K2c (HVAC v74 minted + loaded; mechanical authority): BEFORE nums[-1] == 73; DU-2 K2b (HVAC v73 minted + loaded; mechanical authority): BEFORE nums[-1] == 72; DU-1 Part B (HVAC v71 minted + loaded; mechanical authority): BEFORE nums[-1] == 70  # DU-2 K2 (HVAC v72 minted + loaded; mechanical authority): BEFORE nums[-1] == 71
        self.assertEqual(nums, list(range(1, 81)))  # VAV-2b1 K2 (HVAC v80 minted + loaded; mechanical authority): BEFORE list(range(1, 80)); VAV-2b1 K2 (HVAC v79 minted + loaded; mechanical authority): BEFORE list(range(1, 79)); VAV-2a2 K2 (HVAC v78 minted + loaded; mechanical authority): BEFORE list(range(1, 78)); VAV-2a K2 (HVAC v77 minted + loaded; mechanical authority): BEFORE list(range(1, 77)); VAV-1 K2 (HVAC v76 minted + loaded; mechanical authority): BEFORE list(range(1, 76)); DU-3 K2 (HVAC v75 minted + loaded; mechanical authority): BEFORE list(range(1, 75)); DU-2 K2c (HVAC v74 minted + loaded; mechanical authority): BEFORE list(range(1, 74)); DU-2 K2b (HVAC v73 minted + loaded; mechanical authority): BEFORE list(range(1, 73)); DU-1 Part B (HVAC v71 minted + loaded; mechanical authority): BEFORE list(range(1, 71))  # DU-2 K2 (HVAC v72 minted + loaded; mechanical authority): BEFORE list(range(1, 72))
        self.assertTrue(os.path.exists(_asset_path(V69)))

    # DU-3 K2 (HVAC v75 LOADED; mechanical authority): the live Ducting / Valve Package configs are v75's (R1-R9; proved by test_hvac_v75_du3). BEFORE: v74's
    def test_06_live_catalogue_is_v70(self):
        # INVERTED at DU-1 Part B (HVAC v71 LOADED; mechanical authority): the live Valve Package config is still v70's (v71 leaves it
        # byte-equal); the live Misc config is v71's (+ the Ducting Misc-tab families). BEFORE: live == v70's for both
        # DU-2 K2c (HVAC v74 LOADED; mechanical authority): the live Misc config is v74's (its unit-refusal wording); Valve = v71's = v74's. BEFORE: v71's
        v71 = {c["category_id"]: c for c in json.load(open(_asset_path("rate_master_hvac_all_v78.json"), encoding="utf-8"))["category_configs"]}  # VAV-2a2 K2 (HVAC v78 LOADED; mechanical authority): the live Valve Package config is v78's (the E13 thermowell line, the two VR9 tags out; owner QR-V (a)); Misc = v76's = v78's. BEFORE v76's; VAV-1 K2 (HVAC v76 LOADED; mechanical authority): the live configs are v76's (Misc + 2 families; Valve / Ducting byte-equal to v75). BEFORE v75's
        for cid in (VALVE, MISC):
            row = frappe.db.sql('select config from "tabBoQ Rate Category Config" where active=1 and discipline=%s and category_id=%s', ("HVAC", cid))
            self.assertTrue(row, cid)
            live = json.loads(row[0][0]) if isinstance(row[0][0], str) else row[0][0]
            self.assertEqual(_norm(live), _norm(v71[cid]), cid)
            self.assertEqual(_norm(live) == _norm(self.cfg[cid]), False, cid)  # DU-3 K2 (HVAC v75 LOADED; mechanical authority): BEFORE cid == VALVE (v75's Valve Package carries the R3 pair_note)
        n = frappe.db.sql('select count(*) from "tabBoQ Rate Master Item" where active=1 and discipline=%s', ("HVAC",))[0][0]
        self.assertEqual(n, 853)  # VAV-2b1 K2 (HVAC v79 LOADED; mechanical authority): BEFORE 848 (+ the DDC Panel/ Controller, the Duct Static Pressure Sensor, 3 VAV-2b1 Pricing Inputs); VAV-2a K2 (HVAC v77 LOADED; mechanical authority): BEFORE 840 (+ 8 VAV-2a Pricing Inputs); VAV-1 K2 (HVAC v76 LOADED; mechanical authority): BEFORE 744 (+ 91 VAV, 2 Misc, 2 Sensors, 1 Pricing Input); DU-3 K2 (HVAC v75 LOADED; mechanical authority): BEFORE 743 (+ the threshold Pricing Input)   # DU-1 Part B (HVAC v71 LOADED; mechanical authority): + 15 duct, 5 Misc-tab items, 1 input. BEFORE 722
