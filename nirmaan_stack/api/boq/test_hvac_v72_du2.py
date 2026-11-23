"""DU-2 K2 (2026-11-16) -- HVAC v72 = v71 + ONLY THE DUCTING CONFIG CHANGES for the owner's 23:57 row rulings (R-DUCT, R-PAINT,
R-REMOVAL, R-DOUBT, R-NOTE-ORDER), the DU-1 cert finding a (2026-11-15 23:29) and the P0 defect (the borrowed Misc question carried the
Valve Package's note). Minted by `scripts/_instruments/mint_hvac_v72_du2.py`.

  01  v72 IS the mint's own transformation of v71 (byte for byte); every item and every config but hvac_ducting equal to v71's; a
      one-character change is not v72 (NEGATIVE).
  02  THE QUESTION: every item-list request but Ducting's is byte-identical to v71's; Ducting's misc section asks its OWN family note
      (Paint / Fire Retardant / Air Balancing), the duct_type note says the ITEM decides; second_opinion FALSE on Ducting and Misc.
  03  THE DECLARED LINES: the code rules incl. R-NOTE-ORDER each with a line and a reason; the new keys present as ruled.
  04  VALIDATES: the validator, the cross-category checks; the eligible set = v71's.
  05  v72 is the newest HVAC asset; the series is 1..72 with no gap; v71 stays on disk.
  06  LIVE (after the load): the active Ducting config equals v72's, Misc equals v71's (= v72's); 743 active HVAC items; 15 duct items.
Run: bench --site localhost run-tests --module nirmaan_stack.api.boq.test_hvac_v72_du2
"""
import copy
import importlib.util
import json
import os
import re

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.services.boq_rate_master import config_validation, extraction, loader
from nirmaan_stack.services.boq_rate_master.vav2c1_undo_support import as_v81

V71 = "rate_master_hvac_all_v71.json"
V72 = "rate_master_hvac_all_v72.json"
DUCT, MISC = "hvac_ducting", "hvac_misc"
DUCT_CODE_RULES = ["DR3", "DR12", "DR4", "DR2", "DR7", "G3", "G1", "DR14", "O10", "R-NOTE-ORDER"]   # = frontend derivationCoverage.CODE_RULES


def _asset_path(name):
    return os.path.join(os.path.dirname(loader.__file__), "data", name)


def _read(name):
    with open(_asset_path(name), "r", encoding="utf-8") as fh:
        return json.load(fh)


def _mint():
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "scripts", "_instruments", "mint_hvac_v72_du2.py")
    spec = importlib.util.spec_from_file_location("mint_hvac_v72_du2", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _norm(obj):
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), default=str)


def _stored(payload):
    return {(payload["discipline"], c["category_id"]): dict(c, discipline=payload["discipline"]) for c in payload["category_configs"]}


class TestHvacAssetV72(FrappeTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.prev = _read(V71)
        cls.cur = _read(V72)
        cls.mint = _mint()
        cls.cfg_prev = {c["category_id"]: c for c in cls.prev["category_configs"]}
        cls.cfg = {c["category_id"]: c for c in cls.cur["category_configs"]}

    def test_01_only_the_declared_changes(self):
        final = copy.deepcopy(self.prev)
        idx = {c["category_id"]: n for n, c in enumerate(final["category_configs"])}
        final["category_configs"][idx[DUCT]] = self.mint.ducting_config(self.prev["category_configs"][idx[DUCT]])
        self.assertEqual(_norm(self.cur), _norm(final))
        self.assertEqual(_norm(self.cur["items"]), _norm(self.prev["items"]))
        for cid, a in self.cfg_prev.items():
            if cid != DUCT:
                self.assertEqual(_norm(a), _norm(self.cfg[cid]), cid)
        self.assertNotEqual(_norm(self.cfg_prev[DUCT]), _norm(self.cfg[DUCT]))
        self.assertEqual(sorted(self.cfg), sorted(self.cfg_prev))
        bad = copy.deepcopy(self.cur)                 # NEGATIVE: one changed character in the duct question is not v72
        cfg_bad = {c["category_id"]: c for c in bad["category_configs"]}
        cfg_bad[DUCT]["list_spec"]["attribute_definitions"][0]["note"] += "x"
        self.assertNotEqual(_norm(bad), _norm(final))

    def test_02_the_question(self):
        cfgs, cfgs_prev = _stored(self.cur), _stored(self.prev)
        for k, c in cfgs_prev.items():
            if c.get("list_spec") and k[1] != DUCT:
                self.assertEqual(json.dumps(extraction.build_items_spec(cfgs[k], cfgs, "HVAC"), sort_keys=True),
                                 json.dumps(extraction.build_items_spec(c, cfgs_prev, "HVAC"), sort_keys=True), k)
        self.assertIs(self.cfg[DUCT]["list_spec"]["second_opinion"], False)
        self.assertIs(self.cfg[MISC]["list_spec"]["second_opinion"], False)
        spec = extraction.build_items_spec(cfgs[("HVAC", DUCT)], cfgs, "HVAC")
        misc = next(s for s in spec["sections"] if s["id"] == "misc")["items_spec"]
        fam = next(d for d in misc["attribute_definitions"] if d["id"] == misc["family_attribute_id"])
        self.assertEqual([v for v in fam["values"] if v != "none of these"], ["Paint", "Fire Retardant Spray Paint", "Air Balancing"])
        self.assertTrue(fam["note"].startswith("Which Misc item THIS row buys for the ducts: Paint"))
        self.assertNotIn("thermometer", fam["note"])                     # NEGATIVE: not the Valve Package's note
        duct_q = next(d for d in spec["attribute_definitions"] if d["id"] == "duct_type")["note"]
        self.assertIn("THE ITEM OF THE ROW DECIDES", duct_q)
        self.assertIn("returns NO main item - only its Misc item", duct_q)
        q = json.dumps(spec, ensure_ascii=False)
        for r in self.cfg[DUCT]["list_spec"]["pricing"]["rule_lines"]:
            self.assertNotIn(r["title"], q, r["rule"])   # NEGATIVE: no declared line reaches the model

    def test_03_the_declared_lines(self):
        pr = self.cfg[DUCT]["list_spec"]["pricing"]
        self.assertEqual([r["rule"] for r in pr["rule_lines"]], DUCT_CODE_RULES)
        reasons = {r.get("rule") for r in pr["derivation_reasons"] if r.get("rule")}
        self.assertTrue(set(DUCT_CODE_RULES) <= reasons)
        self.assertEqual(pr["family_alias_needs"], {"Round (GI) - per metre": ["thickness_mm", "dia_mm"]})
        self.assertIn("{named}", pr["no_sku_refuse_default"])
        self.assertEqual([r["refuse"].rsplit(" under ", 1)[-1] for r in pr["no_sku_refusals"][:3]], ["Valve Package", "Piping", "VRF"])
        self.assertEqual(len(pr["text_notes"]), 3)

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

    def test_05_v72_is_the_newest_and_the_series_has_no_gap(self):
        data = os.path.dirname(_asset_path(V72))
        nums = sorted(int(m.group(1)) for f in os.listdir(data) for m in [re.match(r"^rate_master_hvac_all_v(\d+)\.json$", f)] if m)
        self.assertEqual(nums[-1], 83)  # VAV-2c2 K2 (HVAC v83 minted + loaded; mechanical authority; PIN K2-A, ANSWER 24): BEFORE nums[-1] == 82; VAV-2c1 K2 (HVAC v82 minted + loaded; mechanical authority; PIN K2-C, ANSWER 29): BEFORE nums[-1] == 81; VAV-2b2 K2 (HVAC v81 minted + loaded; mechanical authority): BEFORE nums[-1] == 80; VAV-2b1 K2 (HVAC v80 minted + loaded; mechanical authority): BEFORE nums[-1] == 79; VAV-2b1 K2 (HVAC v79 minted + loaded; mechanical authority): BEFORE nums[-1] == 78; VAV-2a2 K2 (HVAC v78 minted + loaded; mechanical authority): BEFORE nums[-1] == 77; VAV-2a K2 (HVAC v77 minted + loaded; mechanical authority): BEFORE nums[-1] == 76; VAV-1 K2 (HVAC v76 minted + loaded; mechanical authority): BEFORE nums[-1] == 75; DU-3 K2 (HVAC v75 minted + loaded; mechanical authority): BEFORE nums[-1] == 74; DU-2 K2c (HVAC v74 minted + loaded; mechanical authority): BEFORE nums[-1] == 73; DU-2 K2b (HVAC v73 minted + loaded; mechanical authority): BEFORE nums[-1] == 72
        self.assertEqual(nums, list(range(1, 84)))  # VAV-2c2 K2 (HVAC v83 minted + loaded; mechanical authority; PIN K2-A, ANSWER 24): BEFORE list(range(1, 83)); VAV-2c1 K2 (HVAC v82 minted + loaded; mechanical authority; PIN K2-C, ANSWER 29): BEFORE list(range(1, 82)); VAV-2b2 K2 (HVAC v81 minted + loaded; mechanical authority): BEFORE list(range(1, 81)); VAV-2b1 K2 (HVAC v80 minted + loaded; mechanical authority): BEFORE list(range(1, 80)); VAV-2b1 K2 (HVAC v79 minted + loaded; mechanical authority): BEFORE list(range(1, 79)); VAV-2a2 K2 (HVAC v78 minted + loaded; mechanical authority): BEFORE list(range(1, 78)); VAV-2a K2 (HVAC v77 minted + loaded; mechanical authority): BEFORE list(range(1, 77)); VAV-1 K2 (HVAC v76 minted + loaded; mechanical authority): BEFORE list(range(1, 76)); DU-3 K2 (HVAC v75 minted + loaded; mechanical authority): BEFORE list(range(1, 75)); DU-2 K2c (HVAC v74 minted + loaded; mechanical authority): BEFORE list(range(1, 74)); DU-2 K2b (HVAC v73 minted + loaded; mechanical authority): BEFORE list(range(1, 73))
        self.assertTrue(os.path.exists(_asset_path(V71)))
        self.assertFalse(os.path.exists(_asset_path("rate_master_hvac_all_v84.json")))  # VAV-2c2 K2 (HVAC v83 minted + loaded; mechanical authority; PIN K2-A, ANSWER 24): BEFORE v83 absent; VAV-2c1 K2 (HVAC v82 minted + loaded; mechanical authority; PIN K2-A, ANSWER 23): BEFORE v82 absent; VAV-2b2 K2 (HVAC v81 minted + loaded; mechanical authority): BEFORE v81 absent; VAV-2b1 K2 (HVAC v80 minted + loaded; mechanical authority): BEFORE v80 absent; VAV-2b1 K2 (HVAC v79 minted + loaded; mechanical authority): BEFORE v79 absent; VAV-2a2 K2 (HVAC v78 minted + loaded; mechanical authority): BEFORE v78 absent; VAV-2a K2 (HVAC v77 minted + loaded; mechanical authority): BEFORE v77 absent; VAV-1 K2 (HVAC v76 minted + loaded; mechanical authority): BEFORE v76 absent; DU-3 K2 (HVAC v75 minted + loaded; mechanical authority): BEFORE v75 absent; DU-2 K2c (HVAC v74 minted + loaded; mechanical authority): BEFORE v74 absent; DU-2 K2b (HVAC v73 minted + loaded; mechanical authority): BEFORE v73 absent

    # DU-3 K2 (HVAC v75 LOADED; mechanical authority): the live Ducting / Valve Package configs are v75's (R1-R9; proved by test_hvac_v75_du3). BEFORE: v74's
    def test_06_live_catalogue_is_v72(self):
        # INVERTED at DU-2 K2b (HVAC v73 LOADED; mechanical authority): the live Ducting config is v73's (v72 + the K1b declared
        # Derivation lines; proved by test_hvac_v73_du2b) and no longer v72's; Misc unchanged. BEFORE: live Ducting == v72's
        v73 = {c["category_id"]: c for c in _read("rate_master_hvac_all_v76.json")["category_configs"]}  # VAV-1 K2 (HVAC v76 LOADED; mechanical authority): the live configs are v76's (Misc + 2 families; Valve / Ducting byte-equal to v75). BEFORE v75's; DU-2 K2c (v74 LOADED): BEFORE v73's
        for cid in (DUCT, MISC):
            row = frappe.db.sql('select config from "tabBoQ Rate Category Config" where active=1 and discipline=%s and category_id=%s', ("HVAC", cid))
            self.assertTrue(row, cid)
            live = as_v81(json.loads(row[0][0]) if isinstance(row[0][0], str) else row[0][0], cid)   # VAV-2c1 K2 (HVAC v82 LOADED; PIN K2-C C2, ANSWER 29): this slice's text edits undone. BEFORE: as read
            self.assertEqual(_norm(live), _norm(v73[cid]), cid)
            # DU-2 K2c (v74 LOADED; mechanical authority): Misc's wording moved too -- both differ from this file now. BEFORE: Misc equal
            self.assertNotEqual(_norm(live), _norm(self.cfg[cid]), cid)
        n = frappe.db.sql('select count(*) from "tabBoQ Rate Master Item" where active=1 and discipline=%s', ("HVAC",))[0][0]
        self.assertEqual(n, 853)  # VAV-2b1 K2 (HVAC v79 LOADED; mechanical authority): BEFORE 848 (+ the DDC Panel/ Controller, the Duct Static Pressure Sensor, 3 VAV-2b1 Pricing Inputs); VAV-2a K2 (HVAC v77 LOADED; mechanical authority): BEFORE 840 (+ 8 VAV-2a Pricing Inputs); VAV-1 K2 (HVAC v76 LOADED; mechanical authority): BEFORE 744 (+ 91 VAV, 2 Misc, 2 Sensors, 1 Pricing Input); DU-3 K2 (HVAC v75 LOADED; mechanical authority): BEFORE 743 (+ the threshold Pricing Input)
        d = frappe.db.sql('select count(*) from "tabBoQ Rate Master Item" where active=1 and discipline=%s and kind=%s', ("HVAC", "hvac_duct_item"))[0][0]
        self.assertEqual(d, 15)
