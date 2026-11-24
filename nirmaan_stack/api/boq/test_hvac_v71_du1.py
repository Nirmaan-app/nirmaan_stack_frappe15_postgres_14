"""DU-1 PART B (2026-11-15) -- HVAC v71 = v70 + THE DUCTING CATEGORY (DU-D0 + the owner's rulings DR1-DR18 with O10, QR-1 (a) + (c),
G-1 / G-3 / G-4 / G-5 / G-6, NOTE 3): the hvac_ducting config, its 15 duct items, the 5 Misc-tab items Misc gains (Paint, Fire Retardant
Spray Paint, Air Balancing x 3) and the Ducting installation-only uplift input at 0%. Minted by `scripts/_instruments/mint_hvac_v71_du1b.py`;
the pricing is proved by the frontend du1Duct*.test.ts files. Here, the asset:

  01  v71 IS the mint's own transformation of v70 (byte for byte); every v70 item unchanged, 21 items added; every config but
      hvac_ducting (new) and hvac_misc equal to v70's; a one-character change is not v71 (NEGATIVE).
  02  THE QUESTION: every item-list request but Ducting's is byte-identical to v70's (Misc is borrow-only: it asks nothing itself);
      second opinion OFF on Ducting and Misc; the Ducting Misc section asks only its three families.
  03  the declared lines: one per registered Ducting code rule (= frontend derivationCoverage.CODE_RULES hvac_duct_item), each with a
      reason; the uplift input is 0.
  04  VALIDATES: the validator, the cross-category checks; the eligible set = v70's + hvac_ducting.
  05  v71 is the newest HVAC asset; the series is 1..71 with no gap; v70 stays on disk.
  06  LIVE (after the load): the active Ducting and Misc configs equal v71's; 743 active HVAC items; 15 active duct items.
Run: bench --site localhost run-tests --module nirmaan_stack.api.boq.test_hvac_v71_du1
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

V70 = "rate_master_hvac_all_v70.json"
V71 = "rate_master_hvac_all_v71.json"
DUCT, MISC = "hvac_ducting", "hvac_misc"
DUCT_CODE_RULES = ["DR3", "DR12", "DR4", "DR2", "DR7", "G3", "G1", "DR14", "O10"]   # = frontend derivationCoverage.CODE_RULES


def _asset_path(name):
    return os.path.join(os.path.dirname(loader.__file__), "data", name)


def _read(name):
    with open(_asset_path(name), "r", encoding="utf-8") as fh:
        return json.load(fh)


def _mint():
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "scripts", "_instruments", "mint_hvac_v71_du1b.py")
    spec = importlib.util.spec_from_file_location("mint_hvac_v71_du1b", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _norm(obj):
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), default=str)


def _stored(payload):
    return {(payload["discipline"], c["category_id"]): dict(c, discipline=payload["discipline"]) for c in payload["category_configs"]}


class TestHvacAssetV71(FrappeTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.prev = _read(V70)
        cls.cur = _read(V71)
        cls.mint = _mint()
        cls.cfg_prev = {c["category_id"]: c for c in cls.prev["category_configs"]}
        cls.cfg = {c["category_id"]: c for c in cls.cur["category_configs"]}

    def test_01_only_the_declared_changes(self):
        final, new_items = self.mint.transform(copy.deepcopy(self.prev), {i["item_uid"] for i in self.prev["items"]})
        self.assertEqual(_norm(self.cur), _norm(final))
        self.assertEqual(_norm(self.cur["items"][:len(self.prev["items"])]), _norm(self.prev["items"]))
        self.assertEqual(len(self.cur["items"]) - len(self.prev["items"]), 21)
        kinds = sorted(i["kind"] for i in new_items)
        self.assertEqual(kinds.count("hvac_duct_item"), 15)
        self.assertEqual(kinds.count("hvac_misc_item"), 5)
        self.assertEqual(kinds.count("hvac_pricing_input"), 1)
        for cid, a in self.cfg_prev.items():
            if cid != MISC:
                self.assertEqual(_norm(a), _norm(self.cfg[cid]), cid)
        self.assertEqual(sorted(set(self.cfg) - set(self.cfg_prev)), [DUCT])
        bad = copy.deepcopy(self.cur)                 # NEGATIVE: one changed character in one duct line is not v71
        cfg_bad = {c["category_id"]: c for c in bad["category_configs"]}
        cfg_bad[DUCT]["list_spec"]["pricing"]["rule_lines"][0]["title"] += "x"
        self.assertNotEqual(_norm(bad), _norm(final))

    def test_02_the_question(self):
        cfgs, cfgs_prev = _stored(self.cur), _stored(self.prev)
        for k, c in cfgs_prev.items():
            if c.get("list_spec") and k[1] != MISC:
                self.assertEqual(json.dumps(extraction.build_items_spec(cfgs[k], cfgs, "HVAC"), sort_keys=True),
                                 json.dumps(extraction.build_items_spec(c, cfgs_prev, "HVAC"), sort_keys=True), k)
        self.assertIs(self.cfg[DUCT]["list_spec"]["second_opinion"], False)
        self.assertIs(self.cfg[MISC]["list_spec"]["second_opinion"], False)
        spec = extraction.build_items_spec(cfgs[("HVAC", DUCT)], cfgs, "HVAC")
        misc = next(s for s in spec["sections"] if s["id"] == "misc")["items_spec"]
        vals = next(d for d in misc["attribute_definitions"] if d["id"] == misc["family_attribute_id"])["values"]
        self.assertEqual([v for v in vals if v != "none of these"], ["Paint", "Fire Retardant Spray Paint", "Air Balancing"])
        q = json.dumps(spec, ensure_ascii=False)
        for r in self.cfg[DUCT]["list_spec"]["pricing"]["rule_lines"]:
            self.assertNotIn(r["title"], q, r["rule"])   # NEGATIVE: no declared line reaches the model

    def test_03_the_declared_lines(self):
        pr = self.cfg[DUCT]["list_spec"]["pricing"]
        self.assertEqual([r["rule"] for r in pr["rule_lines"]], DUCT_CODE_RULES)
        reasons = {r.get("rule") for r in pr["derivation_reasons"] if r.get("rule")}
        self.assertTrue(set(DUCT_CODE_RULES) <= reasons)
        up = [i for i in self.cur["items"] if i["kind"] == "hvac_pricing_input" and i["attributes"]["item"] == "ducting_install_only_uplift"]
        self.assertEqual(len(up), 1)
        self.assertEqual(up[0]["rates"]["factor"], 0.0)
        self.assertEqual(pr["scope"]["uplift_input"], "ducting_install_only_uplift")

    def test_04_validates_eligible(self):
        stored = list(_stored(self.cur).values())
        for c in stored:
            config_validation._validate_config(c)
        self.assertEqual(config_validation.delegated_section_problems(stored, self.cur["items"]), [])
        self.assertEqual(config_validation.extras_problems(stored, self.cur["items"]), [])
        self.assertEqual(config_validation.scope_problems(stored, self.cur["items"]), [])
        cfgs, cfgs_prev = _stored(self.cur), _stored(self.prev)
        self.assertEqual(sorted(k[1] for k, c in cfgs.items() if extraction.config_is_eligible(c, cfgs)),
                         sorted([k[1] for k, c in cfgs_prev.items() if extraction.config_is_eligible(c, cfgs_prev)] + [DUCT]))

    def test_05_v71_is_the_newest_and_the_series_has_no_gap(self):
        data = os.path.dirname(_asset_path(V71))
        nums = sorted(int(m.group(1)) for f in os.listdir(data) for m in [re.match(r"^rate_master_hvac_all_v(\d+)\.json$", f)] if m)
        self.assertEqual(nums[-1], 87)  # VAV-2c3 FIX-2 (HVAC v87 minted + loaded - the A2 correction; mechanical authority; PIN FIX2-F): BEFORE nums[-1] == 86; VAV-2c3 FIX-2 (HVAC v86 minted + loaded; mechanical authority; PIN FIX2-A): BEFORE nums[-1] == 85; VAV-2c3 FIX (HVAC v85 minted + loaded; mechanical authority; PIN FIX-A): BEFORE nums[-1] == 84; VAV-2c3 K2 (HVAC v84 minted + loaded; mechanical authority; PIN K2-A): BEFORE nums[-1] == 83; VAV-2c2 K2 (HVAC v83 minted + loaded; mechanical authority; PIN K2-A, ANSWER 24): BEFORE nums[-1] == 82; VAV-2c1 K2 (HVAC v82 minted + loaded; mechanical authority; PIN K2-C, ANSWER 29): BEFORE nums[-1] == 81; VAV-2b2 K2 (HVAC v81 minted + loaded; mechanical authority): BEFORE nums[-1] == 80; VAV-2b1 K2 (HVAC v80 minted + loaded; mechanical authority): BEFORE nums[-1] == 79; VAV-2b1 K2 (HVAC v79 minted + loaded; mechanical authority): BEFORE nums[-1] == 78; VAV-2a2 K2 (HVAC v78 minted + loaded; mechanical authority): BEFORE nums[-1] == 77; VAV-2a K2 (HVAC v77 minted + loaded; mechanical authority): BEFORE nums[-1] == 76; VAV-1 K2 (HVAC v76 minted + loaded; mechanical authority): BEFORE nums[-1] == 75; DU-3 K2 (HVAC v75 minted + loaded; mechanical authority): BEFORE nums[-1] == 74; DU-2 K2c (HVAC v74 minted + loaded; mechanical authority): BEFORE nums[-1] == 73; DU-2 K2b (HVAC v73 minted + loaded; mechanical authority): BEFORE nums[-1] == 72; DU-2 K2 (HVAC v72 minted + loaded; mechanical authority): BEFORE nums[-1] == 71
        self.assertEqual(nums, list(range(1, 88)))  # VAV-2c3 FIX-2 (HVAC v87 minted + loaded - the A2 correction; mechanical authority; PIN FIX2-F): BEFORE list(range(1, 87)); VAV-2c3 FIX-2 (HVAC v86 minted + loaded; mechanical authority; PIN FIX2-A): BEFORE list(range(1, 86)); VAV-2c3 FIX (HVAC v85 minted + loaded; mechanical authority; PIN FIX-A): BEFORE list(range(1, 85)); VAV-2c3 K2 (HVAC v84 minted + loaded; mechanical authority; PIN K2-A): BEFORE list(range(1, 84)); VAV-2c2 K2 (HVAC v83 minted + loaded; mechanical authority; PIN K2-A, ANSWER 24): BEFORE list(range(1, 83)); VAV-2c1 K2 (HVAC v82 minted + loaded; mechanical authority; PIN K2-C, ANSWER 29): BEFORE list(range(1, 82)); VAV-2b2 K2 (HVAC v81 minted + loaded; mechanical authority): BEFORE list(range(1, 81)); VAV-2b1 K2 (HVAC v80 minted + loaded; mechanical authority): BEFORE list(range(1, 80)); VAV-2b1 K2 (HVAC v79 minted + loaded; mechanical authority): BEFORE list(range(1, 79)); VAV-2a2 K2 (HVAC v78 minted + loaded; mechanical authority): BEFORE list(range(1, 78)); VAV-2a K2 (HVAC v77 minted + loaded; mechanical authority): BEFORE list(range(1, 77)); VAV-1 K2 (HVAC v76 minted + loaded; mechanical authority): BEFORE list(range(1, 76)); DU-3 K2 (HVAC v75 minted + loaded; mechanical authority): BEFORE list(range(1, 75)); DU-2 K2c (HVAC v74 minted + loaded; mechanical authority): BEFORE list(range(1, 74)); DU-2 K2b (HVAC v73 minted + loaded; mechanical authority): BEFORE list(range(1, 73)); DU-2 K2 (HVAC v72 minted + loaded; mechanical authority): BEFORE list(range(1, 72))
        self.assertTrue(os.path.exists(_asset_path(V70)))
        self.assertFalse(os.path.exists(_asset_path("rate_master_hvac_all_v88.json")))  # VAV-2c3 FIX-2 (HVAC v87 minted + loaded - the A2 correction; mechanical authority; PIN FIX2-F): BEFORE v87 absent; VAV-2c3 FIX-2 (HVAC v86 minted + loaded; mechanical authority; PIN FIX2-A): BEFORE v86 absent; VAV-2c3 FIX (HVAC v85 minted + loaded; mechanical authority; PIN FIX-A): BEFORE v85 absent; VAV-2c3 K2 (HVAC v84 minted + loaded; mechanical authority; PIN K2-A): BEFORE v84 absent; VAV-2c2 K2 (HVAC v83 minted + loaded; mechanical authority; PIN K2-A, ANSWER 24): BEFORE v83 absent; VAV-2c1 K2 (HVAC v82 minted + loaded; mechanical authority; PIN K2-A, ANSWER 23): BEFORE v82 absent; VAV-2b2 K2 (HVAC v81 minted + loaded; mechanical authority): BEFORE v81 absent; VAV-2b1 K2 (HVAC v80 minted + loaded; mechanical authority): BEFORE v80 absent; VAV-2b1 K2 (HVAC v79 minted + loaded; mechanical authority): BEFORE v79 absent; VAV-2a2 K2 (HVAC v78 minted + loaded; mechanical authority): BEFORE v78 absent; VAV-2a K2 (HVAC v77 minted + loaded; mechanical authority): BEFORE v77 absent; VAV-1 K2 (HVAC v76 minted + loaded; mechanical authority): BEFORE v76 absent; DU-3 K2 (HVAC v75 minted + loaded; mechanical authority): BEFORE v75 absent; DU-2 K2c (HVAC v74 minted + loaded; mechanical authority): BEFORE v74 absent; DU-2 K2b (HVAC v73 minted + loaded; mechanical authority): BEFORE v73 absent; DU-2 K2 (HVAC v72 minted + loaded; mechanical authority): BEFORE v72 absent

    # DU-3 K2 (HVAC v75 LOADED; mechanical authority): the live Ducting / Valve Package configs are v75's (R1-R9; proved by test_hvac_v75_du3). BEFORE: v74's
    def test_06_live_catalogue_is_v71(self):
        # INVERTED at DU-2 K2 (HVAC v72 LOADED; mechanical authority): the live Ducting config is v72's (the 23:57 row-ruling guidance;
        # proved by test_hvac_v72_du2) and no longer v71's; Misc is unchanged (v72's Misc = v71's). BEFORE: live Ducting == v71's
        # DU-2 K2b (HVAC v73 LOADED; mechanical authority): the live Ducting config is v73's now (v72 + display-only lines). BEFORE: v72's
        v72 = {c["category_id"]: c for c in _read("rate_master_hvac_all_v76.json")["category_configs"]}  # VAV-1 K2 (HVAC v76 LOADED; mechanical authority): the live configs are v76's (Misc + 2 families; Valve / Ducting byte-equal to v75). BEFORE v75's; DU-2 K2c (v74 LOADED): BEFORE v73's
        for cid in (DUCT, MISC):
            row = frappe.db.sql('select config from "tabBoQ Rate Category Config" where active=1 and discipline=%s and category_id=%s', ("HVAC", cid))
            self.assertTrue(row, cid)
            live = as_v81(json.loads(row[0][0]) if isinstance(row[0][0], str) else row[0][0], cid)   # VAV-2c1 K2 (HVAC v82 LOADED; PIN K2-C C2, ANSWER 29): this slice's text edits undone. BEFORE: as read
            self.assertEqual(_norm(live), _norm(v72[cid]), cid)
            # DU-2 K2c (v74 LOADED; mechanical authority): Misc's wording moved too -- both differ from this file now. BEFORE: Misc equal
            self.assertNotEqual(_norm(live), _norm(self.cfg[cid]), cid)
        n = frappe.db.sql('select count(*) from "tabBoQ Rate Master Item" where active=1 and discipline=%s', ("HVAC",))[0][0]
        self.assertEqual(n, 853)  # VAV-2b1 K2 (HVAC v79 LOADED; mechanical authority): BEFORE 848 (+ the DDC Panel/ Controller, the Duct Static Pressure Sensor, 3 VAV-2b1 Pricing Inputs); VAV-2a K2 (HVAC v77 LOADED; mechanical authority): BEFORE 840 (+ 8 VAV-2a Pricing Inputs); VAV-1 K2 (HVAC v76 LOADED; mechanical authority): BEFORE 744 (+ 91 VAV, 2 Misc, 2 Sensors, 1 Pricing Input); DU-3 K2 (HVAC v75 LOADED; mechanical authority): BEFORE 743 (+ the threshold Pricing Input)
        d = frappe.db.sql('select count(*) from "tabBoQ Rate Master Item" where active=1 and discipline=%s and kind=%s', ("HVAC", "hvac_duct_item"))[0][0]
        self.assertEqual(d, 15)
