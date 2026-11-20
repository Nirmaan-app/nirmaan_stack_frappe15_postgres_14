"""VP-1 (2026-11-13) -- HVAC v66 = v65 + THE VALVE PACKAGE (124 SKUs, the owner's ruled valve sheet), THE BORROW-ONLY MISC
CATEGORY (12 SKUs), THE 'Valve - installation-only uplift' PRICING INPUT (50%) AND THE PIPING N5 NOTE ENTRY.

Minted by `scripts/_instruments/mint_hvac_v66_valve.py` from v65 and the ONE fixture the frontend tests share
(`frontend/src/pages/pricing/__fixtures__/valveModel.json`). The prices and the screen are proved through the panel's entry
point by `frontend/.../vp1Valve.test.ts` on the same fixture. Here, the asset itself:

  01  every v65 item and config byte-identical, except Piping, which gains `pricing.sheet_heading_notes` only; the two new configs
      last; exactly 137 items added (124 hvac_valve_item, 12 hvac_misc_item, 1 hvac_pricing_input).
  02  the additions equal the fixture (configs by content, items by content minus `item_uid` and the fixture's `_boq`).
  03  the owner's rulings in the data: BoQ supply = ROUNDUP(BCS x 1.4) / install = ROUNDUP(BCS install x 2) on every valve SKU and
      the sheet's figures (`_boq`) on all 136; brand null; the empty 'Flow' row absent; BTU 50 / 80 as ruled; the 50% input; VRF's
      input named for VRF; second opinion OFF on both new configs.
  04  VALIDATES: the validator, the cross-category checks, the scope input check; Valve Package eligible, Misc NOT (borrow-only);
      every other item-list request identical to v65's.
  05  v66 is the newest HVAC asset; the series is 1..66 with no gap; v65 stays on disk.
  06  LIVE (after the load): the active valve / Misc / Piping configs equal v66's; 722 active HVAC items.
Run: bench --site localhost run-tests --module nirmaan_stack.api.boq.test_valve_v66
"""
import copy
import json
import math
import os
import re

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.services.boq_rate_master import config_validation, extraction, loader

V65 = "rate_master_hvac_all_v65.json"
V66 = "rate_master_hvac_all_v66.json"
VALVE, MISC, PIPING = "hvac_valve_package", "hvac_misc", "hvac_piping"


def _asset_path(name):
    return os.path.join(os.path.dirname(loader.__file__), "data", name)


def _read(name):
    with open(name if os.path.isabs(name) else _asset_path(name), "r", encoding="utf-8") as fh:
        return json.load(fh)


def _fixture():
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "frontend", "src", "pages", "pricing",
                        "__fixtures__", "valveModel.json")
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def _norm(obj):
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), default=str)


def _body(it):
    return {k: v for k, v in it.items() if k not in ("item_uid", "_boq")}


def _stored(payload):
    return {(payload["discipline"], c["category_id"]): dict(c, discipline=payload["discipline"]) for c in payload["category_configs"]}


class TestValveAssetV66(FrappeTestCase):
    ASSET = V66   # the asset under test (a vacuity run in scratch points this at a scratch copy)

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.v65 = _read(V65)
        cls.v66 = _read(cls.ASSET)
        cls.fx = _fixture()
        cls.cfg = {c["category_id"]: c for c in cls.v66["category_configs"]}
        cls.old_uids = {i["item_uid"] for i in cls.v65["items"]}
        cls.added = [i for i in cls.v66["items"] if i["item_uid"] not in cls.old_uids]

    def test_01_only_the_declared_changes(self):
        v66 = {i["item_uid"]: _norm(i) for i in self.v66["items"]}
        for i in self.v65["items"]:
            self.assertEqual(v66.get(i["item_uid"]), _norm(i), i["item_uid"])
        kinds = {}
        for i in self.added:
            kinds[i["kind"]] = kinds.get(i["kind"], 0) + 1
        self.assertEqual(kinds, {"hvac_valve_item": 124, "hvac_misc_item": 12, "hvac_pricing_input": 1})
        ids = [c["category_id"] for c in self.v66["category_configs"]]
        self.assertEqual(ids, [c["category_id"] for c in self.v65["category_configs"]] + [VALVE, MISC])
        for a in self.v65["category_configs"]:
            b = self.cfg[a["category_id"]]
            if a["category_id"] != PIPING:
                self.assertEqual(_norm(a), _norm(b), a["category_id"])
        pa, pb = copy.deepcopy(next(c for c in self.v65["category_configs"] if c["category_id"] == PIPING)), copy.deepcopy(self.cfg[PIPING])
        notes = pb["list_spec"]["pricing"].pop("sheet_heading_notes")
        self.assertEqual(_norm(pa), _norm(pb))
        self.assertEqual(notes, self.fx["piping_sheet_heading_notes"])

    def test_02_the_additions_equal_the_shared_fixture(self):
        self.assertEqual(_norm(self.cfg[VALVE]), _norm(self.fx["valve_config"]))
        self.assertEqual(_norm(self.cfg[MISC]), _norm(self.fx["misc_config"]))
        want = sorted(_norm(_body(i)) for i in self.fx["valve_items"] + self.fx["misc_items"] + [self.fx["pricing_input"]])
        self.assertEqual(sorted(_norm(_body(i)) for i in self.added), want)
        # NEGATIVE: one changed rate is not v66
        bad = copy.deepcopy(self.fx["valve_items"])
        bad[0]["rates"]["cost_supply"] += 1
        self.assertNotEqual(sorted(_norm(_body(i)) for i in bad + self.fx["misc_items"] + [self.fx["pricing_input"]]), want)

    def test_03_the_owners_rulings_in_the_data(self):
        valves = [i for i in self.added if i["kind"] == "hvac_valve_item"]
        miscs = [i for i in self.added if i["kind"] == "hvac_misc_item"]
        boq = {_norm(_body(i)): i["_boq"] for i in self.fx["valve_items"] + self.fx["misc_items"]}
        for i in valves + miscs:
            r = i["rates"]
            got = [math.ceil(round(r["cost_supply"] * (1 + r["supply_markup"]), 9)), math.ceil(round(r["cost_install"] * (1 + r["install_markup"]), 9))]
            self.assertEqual(got, boq[_norm(_body(i))], i["attributes"])
            self.assertIsNone(i["brand"])
        self.assertTrue(all(i["rates"]["supply_markup"] == 0.4 and i["rates"]["install_markup"] == 1.0 for i in valves))
        self.assertFalse(any(re.match(r"(?i)^flow", i["attributes"].get("item_name", "")) for i in miscs))
        btu = {i["attributes"]["size_mm"]: i["rates"]["cost_supply"] for i in valves if i["attributes"]["valve_type"] == "BTU Meter"}
        # owner 11-11 16:10 "BTU meter interchange the 50 mm and 80 mm price": 50 mm = 34,000, 80 mm = 60,000, 65 mm unchanged
        self.assertEqual(btu, {50.0: 34000.0, 65.0: 46000.0, 80.0: 60000.0})
        inp = [i for i in self.added if i["kind"] == "hvac_pricing_input"][0]
        self.assertEqual((inp["attributes"]["item"], inp["attributes"]["name"], inp["rates"]), ("valve_install_only_uplift", "Valve - installation-only uplift", {"factor": 0.5}))
        vrf = [i for i in self.v66["items"] if i["attributes"].get("item") == "vrf_install_only_uplift"]
        self.assertEqual(vrf[0]["attributes"]["name"], "VRF - installation-only uplift")
        self.assertIs(self.cfg[VALVE]["list_spec"]["second_opinion"], False)
        self.assertIs(self.cfg[MISC]["list_spec"]["second_opinion"], False)

    def test_04_validates_eligible_borrow_only_requests_unchanged(self):
        stored = list(_stored(self.v66).values())
        for c in stored:
            config_validation._validate_config(c)
        self.assertEqual(config_validation.delegated_section_problems(stored, self.v66["items"]), [])
        self.assertEqual(config_validation.extras_problems(stored, self.v66["items"]), [])
        self.assertEqual(config_validation.scope_problems(stored, self.v66["items"]), [])
        cfgs, cfgs65 = _stored(self.v66), _stored(self.v65)
        self.assertTrue(extraction.config_is_eligible(cfgs[("HVAC", VALVE)], cfgs))
        self.assertFalse(extraction.config_is_eligible(cfgs[("HVAC", MISC)], cfgs))
        for k, c in cfgs65.items():
            if c.get("list_spec"):
                self.assertEqual(json.dumps(extraction.build_items_spec(cfgs[k], cfgs, "HVAC"), sort_keys=True),
                                 json.dumps(extraction.build_items_spec(c, cfgs65, "HVAC"), sort_keys=True), k)

    def test_05_v66_is_the_newest_and_the_series_has_no_gap(self):
        data = os.path.dirname(_asset_path(V66))
        nums = sorted(int(m.group(1)) for f in os.listdir(data) for m in [re.match(r"^rate_master_hvac_all_v(\d+)\.json$", f)] if m)
        self.assertEqual(nums[-1], 80)  # VAV-2b1 K2 (HVAC v80 minted + loaded; mechanical authority): BEFORE nums[-1] == 79; VAV-2b1 K2 (HVAC v79 minted + loaded; mechanical authority): BEFORE nums[-1] == 78; VAV-2a2 K2 (HVAC v78 minted + loaded; mechanical authority): BEFORE nums[-1] == 77; VAV-2a K2 (HVAC v77 minted + loaded; mechanical authority): BEFORE nums[-1] == 76; VAV-1 K2 (HVAC v76 minted + loaded; mechanical authority): BEFORE nums[-1] == 75; DU-3 K2 (HVAC v75 minted + loaded; mechanical authority): BEFORE nums[-1] == 74; DU-2 K2c (HVAC v74 minted + loaded; mechanical authority): BEFORE nums[-1] == 73; DU-2 K2b (HVAC v73 minted + loaded; mechanical authority): BEFORE nums[-1] == 72; DU-2 K2 (HVAC v72 minted + loaded; mechanical authority): BEFORE nums[-1] == 71; DU-1 Part B (HVAC v71 minted + loaded; mechanical authority): BEFORE nums[-1] == 70; DU-1 (HVAC v70 minted + loaded; mechanical authority): BEFORE nums[-1] == 69; VP-5 (HVAC v69 minted + loaded; mechanical authority): BEFORE nums[-1] == 68; VP-4 (BEFORE nums[-1] == 67); VP-3 (HVAC v67 minted + loaded; mechanical authority): BEFORE nums[-1] == 66
        self.assertEqual(nums, list(range(1, 81)))  # VAV-2b1 K2 (HVAC v80 minted + loaded; mechanical authority): BEFORE list(range(1, 80)); VAV-2b1 K2 (HVAC v79 minted + loaded; mechanical authority): BEFORE list(range(1, 79)); VAV-2a2 K2 (HVAC v78 minted + loaded; mechanical authority): BEFORE list(range(1, 78)); VAV-2a K2 (HVAC v77 minted + loaded; mechanical authority): BEFORE list(range(1, 77)); VAV-1 K2 (HVAC v76 minted + loaded; mechanical authority): BEFORE list(range(1, 76)); DU-3 K2 (HVAC v75 minted + loaded; mechanical authority): BEFORE list(range(1, 75)); DU-2 K2c (HVAC v74 minted + loaded; mechanical authority): BEFORE list(range(1, 74)); DU-2 K2b (HVAC v73 minted + loaded; mechanical authority): BEFORE list(range(1, 73)); DU-2 K2 (HVAC v72 minted + loaded; mechanical authority): BEFORE list(range(1, 72)); DU-1 Part B (HVAC v71 minted + loaded; mechanical authority): BEFORE list(range(1, 71)); DU-1 (HVAC v70 minted + loaded; mechanical authority): BEFORE list(range(1, 70)); VP-5 (HVAC v69 minted + loaded; mechanical authority): BEFORE list(range(1, 69)); VP-4 (BEFORE list(range(1, 68))); VP-3 (HVAC v67 minted + loaded; mechanical authority): BEFORE list(range(1, 67))
        self.assertTrue(os.path.exists(_asset_path(V65)))

    def test_06_live_catalogue_is_v66(self):
        # INVERTED at VP-3 (HVAC v67 LOADED; mechanical authority): the live Valve Package / Misc configs are v67's (the VP-2 review
        # rulings' guidance and C1 / C2 / C4 / C5 keys, proved by test_valve_v67); Piping stays v66's. BEFORE: (VALVE, MISC, PIPING) vs v66
        # VP-4 (HVAC v68 LOADED; mechanical authority): the live Valve Package / Misc configs are v68's now (proved by test_valve_v68).
        # BEFORE: equal to v67's
        # VP-5 (HVAC v69 LOADED; mechanical authority): v69's now (proved by test_valve_v69). BEFORE: equal to v68's
        # DU-1 (HVAC v70 LOADED; mechanical authority): v70's now (the declared Derivation lines; proved by test_hvac_v70_du1). BEFORE: live == v69's
        # DU-1 Part B (HVAC v71 LOADED; mechanical authority): v71's now (Misc gains the Ducting Misc-tab families + borrowers_ask_offered_only;
        # the Valve Package is unchanged; proved by test_hvac_v71_du1). BEFORE: live == v70's
        # DU-2 K2c (HVAC v74 LOADED; mechanical authority): the live Misc config is v74's (its unit-refusal wording); Valve = v71's = v74's. BEFORE: v71's
        v67 = {c["category_id"]: c for c in _read("rate_master_hvac_all_v78.json")["category_configs"]}  # VAV-2a2 K2 (HVAC v78 LOADED; mechanical authority): the live Valve Package config is v78's (the E13 thermowell line, the two VR9 tags out; owner QR-V (a)); Misc = v76's = v78's. BEFORE v76's; VAV-1 K2 (HVAC v76 LOADED; mechanical authority): the live configs are v76's (Misc + 2 families; Valve / Ducting byte-equal to v75). BEFORE v75's; DU-3 K2 (HVAC v75 LOADED; mechanical authority): Valve gains pair_note (R3), Misc = v74's. BEFORE: v74's
        for cid in (VALVE, MISC):
            row = frappe.db.sql('select config from "tabBoQ Rate Category Config" where active=1 and discipline=%s and category_id=%s', ("HVAC", cid))
            live = json.loads(row[0][0]) if isinstance(row[0][0], str) else row[0][0]
            self.assertEqual(_norm(live), _norm(v67[cid]), cid)
            self.assertNotEqual(_norm(live), _norm(self.cfg[cid]), cid)
        for cid in (PIPING,):
            row = frappe.db.sql('select config from "tabBoQ Rate Category Config" where active=1 and discipline=%s and category_id=%s', ("HVAC", cid))
            self.assertTrue(row, cid)
            live = json.loads(row[0][0]) if isinstance(row[0][0], str) else row[0][0]
            self.assertEqual(_norm(live), _norm(self.cfg[cid]), cid)
        n = frappe.db.sql('select count(*) from "tabBoQ Rate Master Item" where active=1 and discipline=%s', ("HVAC",))[0][0]
        self.assertEqual(n, 853)   # VAV-2b1 K2 (HVAC v79 LOADED; mechanical authority): BEFORE 848 (+ the DDC Panel/ Controller, the Duct Static Pressure Sensor, 3 VAV-2b1 Pricing Inputs); VAV-2a K2 (HVAC v77 LOADED; mechanical authority): BEFORE 840 (+ 8 VAV-2a Pricing Inputs); VAV-1 K2 (HVAC v76 LOADED; mechanical authority): BEFORE 744 (+ 91 VAV, 2 Misc, 2 Sensors, 1 Pricing Input); DU-3 K2 (HVAC v75 minted + loaded; mechanical authority): + 1 Ducting input (insulation coverage threshold). BEFORE 743; DU-1 Part B (HVAC v71 LOADED; mechanical authority): + 15 duct, 5 Misc-tab items, 1 input. BEFORE 722
