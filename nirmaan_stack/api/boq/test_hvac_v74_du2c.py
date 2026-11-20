"""DU-2 K2c (2026-11-16) -- HVAC v74 = v73 + THE DERIVATION WORDING chat-Claude's read returned (CH-DU2-5 W1 / W5 / W6 / W7): Ducting
reasons, Misc's unit-refusal sentence. DISPLAY ONLY. Minted by `scripts/_instruments/mint_hvac_v74_du2c.py`.

  01  v73 IS the mint's own transformation of v72; every item and every config but hvac_ducting equal to v72's; NEGATIVE: one character.
  02  THE QUESTION: every item-list request (Ducting's included) is byte-identical to v72's; no declared line reaches the model.
  03  THE DECLARED LINES: the code rules incl. R-PIR / R-LABOUR each with a line and a reason; DR7's detail names any heading.
  04  VALIDATES; the eligible set = v72's.   05  v73 is the newest; the series 1..73 has no gap.
  06  LIVE (after the load): the active Ducting and Misc configs equal v73's; 743 active HVAC items.
Run: bench --site localhost run-tests --module nirmaan_stack.api.boq.test_hvac_v73_du2b
"""
import copy
import importlib.util
import json
import os
import re

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.services.boq_rate_master import config_validation, extraction, loader

V72 = "rate_master_hvac_all_v73.json"   # the previous asset
V73 = "rate_master_hvac_all_v74.json"   # this asset
DUCT, MISC = "hvac_ducting", "hvac_misc"
DUCT_CODE_RULES = ["DR3", "DR12", "DR4", "DR2", "DR7", "G3", "G1", "DR14", "O10", "R-NOTE-ORDER", "R-PIR", "R-LABOUR"]   # = frontend CODE_RULES


def _asset_path(name):
    return os.path.join(os.path.dirname(loader.__file__), "data", name)


def _read(name):
    with open(_asset_path(name), "r", encoding="utf-8") as fh:
        return json.load(fh)


def _mint():
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "scripts", "_instruments", "mint_hvac_v74_du2c.py")
    spec = importlib.util.spec_from_file_location("mint_hvac_v74_du2c", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _norm(obj):
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), default=str)


def _stored(payload):
    return {(payload["discipline"], c["category_id"]): dict(c, discipline=payload["discipline"]) for c in payload["category_configs"]}


class TestHvacAssetV74(FrappeTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.prev = _read(V72)
        cls.cur = _read(V73)
        cls.mint = _mint()
        cls.cfg_prev = {c["category_id"]: c for c in cls.prev["category_configs"]}
        cls.cfg = {c["category_id"]: c for c in cls.cur["category_configs"]}

    def test_01_only_the_declared_changes(self):
        final = copy.deepcopy(self.prev)
        idx = {c["category_id"]: n for n, c in enumerate(final["category_configs"])}
        final["category_configs"][idx[DUCT]] = self.mint.ducting_config(self.prev["category_configs"][idx[DUCT]])
        final["category_configs"][idx[MISC]] = self.mint.misc_config(self.prev["category_configs"][idx[MISC]])
        self.assertEqual(_norm(self.cur), _norm(final))
        self.assertEqual(_norm(self.cur["items"]), _norm(self.prev["items"]))
        for cid, a in self.cfg_prev.items():
            if cid not in (DUCT, MISC):
                self.assertEqual(_norm(a), _norm(self.cfg[cid]), cid)
        bad = copy.deepcopy(self.cur)
        {c["category_id"]: c for c in bad["category_configs"]}[MISC]["list_spec"]["pricing"]["unit_refusal"] += "x"
        self.assertNotEqual(_norm(bad), _norm(final))

    def test_02_the_question(self):
        cfgs, cfgs_prev = _stored(self.cur), _stored(self.prev)
        for k, c in cfgs_prev.items():
            if c.get("list_spec"):
                self.assertEqual(json.dumps(extraction.build_items_spec(cfgs[k], cfgs, "HVAC"), sort_keys=True),
                                 json.dumps(extraction.build_items_spec(c, cfgs_prev, "HVAC"), sort_keys=True), k)
        q = json.dumps(extraction.build_items_spec(cfgs[("HVAC", DUCT)], cfgs, "HVAC"), ensure_ascii=False)
        for r in self.cfg[DUCT]["list_spec"]["pricing"]["rule_lines"]:
            self.assertNotIn(r["title"], q, r["rule"])

    def test_03_the_declared_lines(self):
        pr = self.cfg[DUCT]["list_spec"]["pricing"]
        self.assertEqual([r["rule"] for r in pr["rule_lines"]], DUCT_CODE_RULES)
        reasons = {r.get("rule") for r in pr["derivation_reasons"] if r.get("rule")}
        self.assertTrue(set(DUCT_CODE_RULES) <= reasons)
        self.assertTrue(any(r.get("title") == "^A row the model reads as not a duct, whose words name" for r in pr["derivation_reasons"]))
        self.assertIn("priced per Nos, sq.m, sq.ft or CFM", self.cfg[MISC]["list_spec"]["pricing"]["unit_refusal"])
        self.assertIs(self.cfg[DUCT]["list_spec"]["second_opinion"], False)

    def test_04_validates_eligible(self):
        stored = list(_stored(self.cur).values())
        for c in stored:
            config_validation._validate_config(c)
        self.assertEqual(config_validation.delegated_section_problems(stored, self.cur["items"]), [])
        self.assertEqual(config_validation.scope_problems(stored, self.cur["items"]), [])
        cfgs, cfgs_prev = _stored(self.cur), _stored(self.prev)
        self.assertEqual(sorted(k[1] for k, c in cfgs.items() if extraction.config_is_eligible(c, cfgs)),
                         sorted(k[1] for k, c in cfgs_prev.items() if extraction.config_is_eligible(c, cfgs_prev)))

    def test_05_v74_is_the_newest_and_the_series_has_no_gap(self):
        data = os.path.dirname(_asset_path(V73))
        nums = sorted(int(m.group(1)) for f in os.listdir(data) for m in [re.match(r"^rate_master_hvac_all_v(\d+)\.json$", f)] if m)
        self.assertEqual(nums[-1], 78)  # VAV-2a2 K2 (HVAC v78 minted + loaded; mechanical authority): BEFORE nums[-1] == 77; VAV-2a K2 (HVAC v77 minted + loaded; mechanical authority): BEFORE nums[-1] == 76; VAV-1 K2 (HVAC v76 minted + loaded; mechanical authority): BEFORE nums[-1] == 75; DU-3 K2 (HVAC v75 minted + loaded; mechanical authority): BEFORE nums[-1] == 74; DU-2 K2c (HVAC v74 minted + loaded; mechanical authority): BEFORE nums[-1] == 73
        self.assertEqual(nums, list(range(1, 79)))  # VAV-2a2 K2 (HVAC v78 minted + loaded; mechanical authority): BEFORE list(range(1, 78)); VAV-2a K2 (HVAC v77 minted + loaded; mechanical authority): BEFORE list(range(1, 77)); VAV-1 K2 (HVAC v76 minted + loaded; mechanical authority): BEFORE list(range(1, 76)); DU-3 K2 (HVAC v75 minted + loaded; mechanical authority): BEFORE list(range(1, 75)); DU-2 K2c (HVAC v74 minted + loaded; mechanical authority): BEFORE list(range(1, 74))
        self.assertTrue(os.path.exists(_asset_path(V72)))

    def test_06_live_catalogue_is_v74(self):
        # DU-3 K2 INVERTED (HVAC v75 minted + loaded; mechanical authority): BEFORE live Ducting = v74's and 743 items; AFTER live Ducting
        # = v75's (not v74's), Misc still = v74's (v75 leaves it untouched - negative half kept), 744 items (+ the threshold Pricing Input)
        v75 = {c["category_id"]: c for c in _read("rate_master_hvac_all_v76.json")["category_configs"]}  # VAV-1 K2 (HVAC v76 LOADED; mechanical authority): the live configs are v76's (Misc + 2 families; Valve / Ducting byte-equal to v75). BEFORE v75's
        for cid in (DUCT, MISC):
            row = frappe.db.sql('select config from "tabBoQ Rate Category Config" where active=1 and discipline=%s and category_id=%s', ("HVAC", cid))
            self.assertTrue(row, cid)
            live = json.loads(row[0][0]) if isinstance(row[0][0], str) else row[0][0]
            self.assertEqual(_norm(live), _norm(v75[cid]), cid)
        # VAV-1 K2 (HVAC v76 LOADED; mechanical authority; chat-Claude ANSWER to VAV1-22): BEFORE `assertEqual(_norm(v75[MISC]), _norm(self.cfg[MISC]))`.
        # AFTER: the live (v76) Misc = v74's EXCEPT exactly the 2 VAV-borrowed families (Digital Thermostat, Transformation Pieces): with their
        # 2 `item` values and 2 family blocks taken out, every other Misc key is byte-identical; and the live Misc items = v74's 22 byte-identical
        # + exactly those 2 new items.
        new_fams = ("Digital Thermostat", "Transformation Pieces")
        live_misc = json.loads(_norm(v75[MISC]))
        self.assertNotEqual(_norm(live_misc), _norm(self.cfg[MISC]))                          # it did change ...
        d = next(x for x in live_misc["list_spec"]["attribute_definitions"] if x["id"] == "item")
        self.assertEqual([v for v in d["values"] if v in new_fams], list(new_fams))
        d["values"] = [v for v in d["values"] if v not in new_fams]
        fams = live_misc["list_spec"]["pricing"]["families"]
        self.assertEqual(sorted(f for f in fams if f in new_fams), sorted(new_fams))
        for f in new_fams:
            del fams[f]
        self.assertEqual(_norm(live_misc), _norm(self.cfg[MISC]))                             # ... by exactly the 2 families
        live_items = {r[0]: r for r in frappe.db.sql("""select item_uid, attributes, rates from "tabBoQ Rate Master Item"
                                                         where active=1 and discipline='HVAC' and kind='hvac_misc_item'""")}
        old = {it["item_uid"]: it for it in self.cur["items"] if it["kind"] == "hvac_misc_item"}
        self.assertEqual(len(old), 22)
        J = lambda v: json.loads(v) if isinstance(v, str) else v
        for uid, it in old.items():
            self.assertIn(uid, live_items)
            self.assertEqual(_norm(J(live_items[uid][1])), _norm(it["attributes"]), uid)
            self.assertEqual(_norm(J(live_items[uid][2])), _norm(it["rates"]), uid)
        added = sorted(J(live_items[u][1]).get("item") for u in set(live_items) - set(old))
        self.assertEqual(added, sorted(new_fams))
        self.assertNotEqual(_norm(v75[DUCT]), _norm(self.cfg[DUCT]))
        n = frappe.db.sql('select count(*) from "tabBoQ Rate Master Item" where active=1 and discipline=%s', ("HVAC",))[0][0]
        self.assertEqual(n, 848)  # VAV-2a K2 (HVAC v77 LOADED; mechanical authority): BEFORE 840 (+ 8 VAV-2a Pricing Inputs); VAV-1 K2 (HVAC v76 LOADED; mechanical authority): BEFORE 744 (+ 91 VAV, 2 Misc, 2 Sensors, 1 Pricing Input)
