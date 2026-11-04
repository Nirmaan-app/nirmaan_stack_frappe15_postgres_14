"""VRF-2a (2026-11-03) -- HVAC v56 = v55 LESS THE TWO BLUE STAR DUCTABLES + VRF PRICES IN THE CALCULATOR.

Minted by `scripts/_instruments/mint_hvac_v56_vrf2.py` (the v47 shape) from v55. The prices themselves are proved through
the product's own pricer in `frontend/src/pages/pricing/calculatorPanelParity.test.ts` (the VRF block: every SKU's
calculator price = the sheet); here the asset, its rules and the switch are pinned.

What these tests protect, in plain English (01-08 file-only; 09 reads the loaded catalogue):

  01  THE CATALOGUE: 150 hvac_vrf_item SKUs (Blue Star 120, Daikin 30), the 4 shared Misc items, the 2 VRF Pricing Inputs;
      537 HVAC items in all. NEGATIVE: the two retired ductables (VFM-216A 18 TR, VFM-264A 22 TR; VRF sheet rows 106 /
      105) are ABSENT, and no other VRF sheet row lost its SKU.
  02  NOTHING ELSE MOVED: every other v55 item byte-for-byte; every config but hvac_vrf byte-for-byte; on hvac_vrf only
      `calculator_only`, `matching_mode`, `list_spec` and `notes` change (its definitions, kinds and pipelines {} are v55's);
      the top-level keys are v55's.
  03  THE SWITCH (owner Q1 A, temporary, removed at VRF-4): `calculator_only` is true; v56 validates; hvac_vrf's rules
      RUN but it is NOT eligible, so the eligible set is v55's; every other item-list category's extraction request is
      byte-identical; NO config delegates a section to hvac_vrf (the side door the eligibility test does not cover).
      NEGATIVE: the same config without the key WOULD be eligible (the switch is the only thing holding it back).
  04  THE RULES IN CONFIG: the 13 VRF families (the Misc four are not priced until VRF-2c); each family's facts (the
      field table); brand default Blue Star with "no brand stated - priced as Blue Star"; the team defaults (Cool Only,
      Top, Standard, FOUR-WAY) and remote Wired, each an absent_as_none default (amber, no "*"); the controller's Daikin
      -> Blue Star map with its own line; refnet one flat price per brand (no size); capacity: the next size up, below
      the smallest -> the smallest, above the largest refuses (no `compose`: "no splitting"); "none of these" refuses;
      no family_when_none (an unstated indoor type refuses).
  05  THE UNIT TABLE: ONE class, count, with "Nos" first and "Nos/Ro" among its spellings (QR-2 A). NEGATIVE: kg / kgs
      are left out until VRF-2c (QR-3 A), and Set, Sets, Lot and per HP belong to no class (they refuse until VRF-3);
      the refusal sentence.
  06  THE FIGURES: every family's supply = ROUNDUP(cost_supply x (1 + supply_markup)) and install = ROUNDUP(boq_install);
      applied to every one of the 150 SKUs they give the SHEET's BOQ SUPPLY (rounded up) and BOQ INSTALLATION -- the
      sheet table in test_vrf_v55, written from the workbook independently of both mints.
  07  THE LADDERS AFTER THE RETIREMENT: the Blue Star ductable ladder ends at 8 TR (as Daikin's does), so a ductable above
      8 TR refuses at either brand.
  08  v56 is the newest HVAC asset; the series is 1..56 with no gap; v55 stays on disk.
  09  LIVE (after the load): the active hvac_vrf config equals v56's and carries `calculator_only`, so the population the
      product assembles from it is not eligible; the two retired uids are active 0; 537 active HVAC items, 150 VRF.
"""
import copy
import json
import math
import os
import re

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.boq.test_vrf_v55 import VRF_SHEET
from nirmaan_stack.services.boq_rate_master import config_validation, extraction, loader

V55 = "rate_master_hvac_all_v55.json"
V56 = "rate_master_hvac_all_v56.json"
VRF_KIND, MISC_KIND, INPUT_KIND, CATEGORY = "hvac_vrf_item", "hvac_misc_item", "hvac_pricing_input", "hvac_vrf"
RETIRED = {"rmi-8eb521699247": ("VFM-216A", "18.0TR", 106), "rmi-8ee7b38ab8fc": ("VFM-264A", "22.0TR", 105)}
FAMILIES = ["Outdoor Unit", "Hi-Wall", "Cassette", "Floor-cum-Ceiling Mounted", "Verticool", "Concealed Split", "Ductable",
            "Packaged Unit", "Single Skin Treated Fresh Air", "Refnet/Y-Joint", "AHU Expansion Kit", "Remote Controller",
            "Touch Screen Central Controller"]
UNSIZED = {"Refnet/Y-Joint", "Remote Controller", "Touch Screen Central Controller"}


def _asset_path(name):
    return os.path.join(os.path.dirname(loader.__file__), "data", name)


def _read(name):
    with open(_asset_path(name), "r", encoding="utf-8") as fh:
        return json.load(fh)


def _norm(obj):
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), default=str)


def _roundup(x):
    return math.ceil(round(x, 9))


def _stored(payload):
    return {(payload["discipline"], c["category_id"]): dict(c, discipline=payload["discipline"]) for c in payload["category_configs"]}


class TestVrf2aAssetV56(FrappeTestCase):
    ASSET = V56   # the asset under test (a vacuity run in scratch points this at a scratch copy)

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.v55 = _read(V55)
        with open(cls.ASSET if os.path.isabs(cls.ASSET) else _asset_path(cls.ASSET), "r", encoding="utf-8") as fh:
            cls.v56 = json.load(fh)
        cls.vrf = [it for it in cls.v56["items"] if it["kind"] == VRF_KIND]
        cls.cfg = next(c for c in cls.v56["category_configs"] if c["category_id"] == CATEGORY)
        cls.cfg55 = next(c for c in cls.v55["category_configs"] if c["category_id"] == CATEGORY)
        cls.pr = cls.cfg["list_spec"]["pricing"]

    # ---- 01 ----------------------------------------------------------------------------------------------------
    def test_01_the_catalogue_150_vrf_the_two_ductables_absent(self):
        self.assertEqual(len(self.vrf), 150)
        brands = sorted({it["brand"] for it in self.vrf})
        self.assertEqual(brands, ["Blue Star", "Daikin"])
        self.assertEqual(sum(1 for it in self.vrf if it["brand"] == "Blue Star"), 120)
        self.assertEqual(sum(1 for it in self.vrf if it["brand"] == "Daikin"), 30)
        self.assertEqual(sum(1 for it in self.v56["items"] if it["kind"] == MISC_KIND), 4)
        self.assertEqual(sum(1 for it in self.v56["items"] if it["kind"] == INPUT_KIND and it["attributes"].get("shared_by") == "vrf"), 2)
        self.assertEqual(len(self.v56["items"]), 537)
        uids = {it["item_uid"] for it in self.v56["items"]}
        for uid, (model, label, row) in RETIRED.items():
            self.assertNotIn(uid, uids)
            self.assertNotIn(model, {it["attributes"].get("model") for it in self.vrf})
            self.assertNotIn(row, {it["source"]["row"] for it in self.vrf})
            # ... and v55 held exactly that ductable under that uid (the ruling names the right two)
            v55it = next(it for it in self.v55["items"] if it["item_uid"] == uid)
            self.assertEqual((v55it["brand"], v55it["attributes"]["item"], v55it["attributes"]["model"], v55it["attributes"]["capacity_label"],
                              v55it["source"]["row"]), ("Blue Star", "Ductable", model, label, row))
        self.assertEqual(sorted(it["source"]["row"] for it in self.vrf), [r for r in range(2, 154) if r not in (105, 106)])

    # ---- 02 ----------------------------------------------------------------------------------------------------
    def test_02_nothing_else_moved(self):
        self.assertEqual([_norm(it) for it in self.v56["items"]],
                         [_norm(it) for it in self.v55["items"] if it["item_uid"] not in RETIRED])
        self.assertEqual([c["category_id"] for c in self.v56["category_configs"]], [c["category_id"] for c in self.v55["category_configs"]])
        for a, b in zip(self.v55["category_configs"], self.v56["category_configs"]):
            if a["category_id"] != CATEGORY:
                self.assertEqual(_norm(a), _norm(b), a["category_id"])
        changed = sorted(k for k in set(self.cfg) | set(self.cfg55) if _norm(self.cfg.get(k)) != _norm(self.cfg55.get(k)))
        self.assertEqual(changed, ["calculator_only", "list_spec", "matching_mode", "notes"])
        self.assertEqual(self.cfg["attribute_definitions"], self.cfg55["attribute_definitions"])
        self.assertEqual((self.cfg["item_kinds"], self.cfg["pipelines"]), ([VRF_KIND, MISC_KIND], {}))
        self.assertTrue(self.cfg["notes"].startswith(self.cfg55["notes"]))
        self.assertEqual(list(self.v56.keys()), list(self.v55.keys()))
        self.assertEqual({k: v for k, v in self.v56.items() if k not in ("items", "category_configs")},
                         {k: v for k, v in self.v55.items() if k not in ("items", "category_configs")})

    # ---- 03 ----------------------------------------------------------------------------------------------------
    def test_03_the_switch_rules_run_not_eligible_no_request_moves_no_side_door(self):
        self.assertIs(self.cfg["calculator_only"], True)
        self.assertEqual(self.cfg["matching_mode"], "item_list")
        loader._validate_items(self.v56["items"])
        req, elig = {}, {}
        for name, payload in (("v55", self.v55), ("v56", self.v56)):
            cfgs = _stored(payload)
            for c in cfgs.values():
                loader._validate_one_config(c, c["category_id"])
                config_validation._validate_config(c)
            self.assertEqual(config_validation.delegated_section_problems(list(cfgs.values()), payload["items"]), [])
            elig[name] = sorted(cid for (_d, cid), c in cfgs.items() if extraction.config_is_eligible(c, cfgs))
            req[name] = {cid: json.dumps(extraction.build_items_spec(c, cfgs, payload["discipline"]), sort_keys=True)
                         for (_d, cid), c in cfgs.items() if c.get("list_spec") and cid != CATEGORY}
            # the side door: a delegated section asks its target's questions without an eligibility test
            doors = [cid for (_d, cid), c in cfgs.items() for s in ((c.get("list_spec") or {}).get("sections") or [])
                     if isinstance(s, dict) and s.get("category_id") == CATEGORY]
            self.assertEqual(doors, [], name)
        cfgs56 = _stored(self.v56)
        vrf = cfgs56[("HVAC", CATEGORY)]
        self.assertTrue(extraction.has_runnable_pricing_rules(vrf))
        self.assertFalse(extraction.config_is_eligible(vrf, cfgs56))
        self.assertNotIn(CATEGORY, elig["v56"])
        self.assertEqual(elig["v55"], elig["v56"])
        self.assertEqual(req["v55"], req["v56"])
        self.assertEqual(sorted(req["v56"]), ["hvac_adp", "hvac_insulation", "hvac_piping"])
        # NEGATIVE: without the key the same config WOULD be eligible -- the switch is what keeps VRF out of Suggest
        bare = copy.deepcopy(vrf)
        bare.pop("calculator_only")
        self.assertTrue(extraction.config_is_eligible(bare, {**cfgs56, ("HVAC", CATEGORY): bare}))

    # ---- 04 ----------------------------------------------------------------------------------------------------
    def test_04_the_rules_in_config(self):
        pr, ls = self.pr, self.cfg["list_spec"]
        self.assertEqual(pr["kind"], VRF_KIND)
        self.assertEqual(list(pr["families"]), FAMILIES)
        for misc in ("BACnet Integration Controller for VRF Units", "MS Angle Base Frame Structure", "Refrigerant Gas Filling (R-410)", "Drain Pump"):
            self.assertNotIn(misc, pr["families"])          # NEGATIVE: the Misc four price at VRF-2c
        needs = {f: (pr["families"][f]["needs"], pr["families"][f]["units"]["count"]["needs"]) for f in FAMILIES}
        self.assertEqual(needs["Outdoor Unit"], (["brand", "cooling", "discharge", "compressor"], ["capacity"]))
        self.assertEqual(needs["Cassette"], (["brand", "way"], ["capacity"]))
        self.assertEqual(needs["Remote Controller"], (["brand", "remote_type"], []))
        self.assertEqual(needs["Refnet/Y-Joint"], (["brand"], []))                     # flat: no size
        self.assertEqual(needs["Touch Screen Central Controller"], (["brand"], []))
        for f in FAMILIES:
            if f not in ("Outdoor Unit", "Cassette", "Remote Controller"):
                self.assertEqual(needs[f][0], ["brand"], f)
            self.assertEqual(needs[f][1], [] if f in UNSIZED else ["capacity"], f)
            self.assertEqual(list(pr["families"][f]["units"]), ["count"], f)
        d = pr["defaults"]
        self.assertEqual(d["brand"], {"value": "Blue Star", "rule": "no brand stated - priced as Blue Star", "absent_as_none": True})
        self.assertEqual({k: d[k]["by_family"] for k in ("cooling", "discharge", "compressor", "way", "remote_type")},
                         {"cooling": {"Outdoor Unit": "Cool Only"}, "discharge": {"Outdoor Unit": "Top"},
                          "compressor": {"Outdoor Unit": "Standard"}, "way": {"Cassette": "FOUR-WAY"},
                          "remote_type": {"Remote Controller": "Wired"}})
        self.assertTrue(all(v["absent_as_none"] is True and v["rule"] for v in d.values()))
        self.assertEqual(pr["value_map"], [{"attr": "brand", "families": ["Touch Screen Central Controller"], "from": "Daikin", "to": "Blue Star",
                                            "rule": "the central controller is Blue Star only on the sheet - a Daikin pick is priced as Blue Star (R-SMALL)",
                                            "display": "Blue Star"}])
        self.assertEqual(pr["numbers"], {"capacity": {"from": ["capacity"], "name": "capacity"}})
        self.assertEqual(pr["ladders"], ["capacity"])
        self.assertEqual(pr["size_match"], {"dp": [2, 1], "below_smallest": "smallest"})
        self.assertEqual(pr["label_attr"], "capacity_label")
        self.assertNotIn("compose", pr)              # "leave these unpriced. no splitting": above the largest refuses
        self.assertNotIn("family_when_none", pr)     # an unstated indoor type refuses
        self.assertEqual(pr["no_sku_families"], ["none of these"])
        item_def = next(x for x in ls["attribute_definitions"] if x["id"] == "item")
        self.assertEqual(item_def["values"], FAMILIES + ["none of these"])
        self.assertIs(item_def["allow_none"], True)
        self.assertEqual(pr["panel_controls"]["item"], "dropdown")
        self.assertEqual(pr["panel_controls"]["capacity"], "dropdown_or_other")
        self.assertIs(ls["second_opinion"], False)

    # ---- 05 ----------------------------------------------------------------------------------------------------
    def test_05_the_unit_table(self):
        uc = self.pr["unit_classes"]
        self.assertEqual(sorted(uc), ["count"])                 # QR-3 A: no weight class until VRF-2c
        self.assertEqual(uc["count"][0], "Nos")                 # the label reads "How many in one Nos"
        low = {s.lower() for s in uc["count"]}
        for s in ("nos", "no", "no's", "nos.", "no.", "no.s", "number", "each", "ea", "pcs", "unit", "nos/ro"):
            self.assertIn(s, low)
        self.assertEqual(self.pr["unit_words"], {"count": "Nos"})
        every = {s.lower() for v in uc.values() for s in v}
        for refused in ("set", "sets", "lot", "per hp", "rmt", "metre", "kg", "kgs"):
            self.assertNotIn(refused, every)                     # NEGATIVE: in no class -> refuses until VRF-3
        self.assertNotIn("unit_factors", self.pr)
        self.assertIn("Set, Lot and per HP wait for VRF-3", self.pr["unit_refusal"])
        self.assertIn("{unit}", self.pr["unit_refusal"])

    # ---- 06 ----------------------------------------------------------------------------------------------------
    def test_06_the_figures_every_sku_gives_the_sheet(self):
        for f in FAMILIES:
            pl = self.pr["families"][f]["units"]["count"]["pipelines"]
            sup = [(s["step"], s.get("target"), s.get("result"), s.get("formula"), (s.get("params") or {}).get("m_from_ctx")) for s in pl["supply"]["steps"]]
            ins = [(s["step"], s.get("target"), s.get("result"), s.get("formula")) for s in pl["install"]["steps"]]
            self.assertEqual(sup, [("match_master_row", None, None, None, None), ("component", "cost_supply", None, "base", None),
                                   ("sum_components", None, "bcs_supply", None, None), ("scale", "bcs_supply", "supply", "base*(1+m)", "supply_markup"),
                                   ("roundup", "supply", None, None, None)], f)
            self.assertEqual(ins, [("match_master_row", None, None, None), ("component", "boq_install", None, "base"),
                                   ("sum_components", None, "install", None), ("roundup", "install", None, None)], f)
            self.assertEqual(pl["supply"]["steps"][0]["params"], {"kind": VRF_KIND})
        sheet = {r[0]: r for r in VRF_SHEET}
        moved = 0
        for it in self.vrf:
            row = sheet[it["source"]["row"]]
            r = it["rates"]
            supply = _roundup(r["cost_supply"] * (1 + r["supply_markup"]))
            self.assertEqual(supply, math.ceil(row[11] - 1e-9), it["item_uid"])        # the sheet's BOQ SUPPLY, rounded up
            self.assertEqual(_roundup(r["boq_install"]), math.ceil(row[12] - 1e-9), it["item_uid"])
            moved += supply != row[11]
        self.assertEqual(moved, 12)        # the 12 Daikin figures the round-up moves (VRF-D0 / VRF-R2 R9)

    # ---- 07 ----------------------------------------------------------------------------------------------------
    def test_07_the_ductable_ladders_end_at_8_tr(self):
        for brand in ("Blue Star", "Daikin"):
            caps = sorted(it["attributes"]["capacity"] for it in self.vrf if it["attributes"]["item"] == "Ductable" and it["brand"] == brand)
            self.assertEqual(caps[-1], 8.0, brand)
        self.assertEqual(sorted(it["attributes"]["capacity"] for it in self.vrf if it["attributes"]["item"] == "Ductable" and it["brand"] == "Blue Star"),
                         [1.5, 2.0, 2.5, 3.0, 4.0, 5.0, 6.0, 8.0])

    # ---- 08 ----------------------------------------------------------------------------------------------------
    def test_08_v56_is_the_newest_and_v55_stays(self):
        d = os.path.dirname(_asset_path(V56))
        ns = [int(m.group(1)) for f in os.listdir(d) for m in [re.match(r"rate_master_hvac_all_v(\d+)\.json$", f)] if m]
        # INVERTED at VRF-2b (HVAC v57; a test failing solely because it names the current HVAC asset) by mechanical authority: BEFORE `self.assertEqual(max(ns), 56)`
        # INVERTED at VRF-3a (HVAC v58; a test failing solely because it names the current HVAC asset) by mechanical authority: BEFORE `self.assertEqual(max(ns), 57)`
        self.assertEqual(max(ns), 58)
        # INVERTED at VRF-2b (HVAC v57; a test failing solely because it names the current HVAC asset) by mechanical authority: BEFORE `self.assertEqual(sorted(ns), list(range(1, 57)))`
        # INVERTED at VRF-3a (HVAC v58; a test failing solely because it names the current HVAC asset) by mechanical authority: BEFORE `self.assertEqual(sorted(ns), list(range(1, 58)))`
        self.assertEqual(sorted(ns), list(range(1, 59)))
        self.assertTrue(os.path.exists(_asset_path(V55)))
        # INVERTED at VRF-2b (HVAC v57; a test failing solely because it names the current HVAC asset) by mechanical authority: BEFORE `self.assertFalse(os.path.exists(_asset_path("rate_master_hvac_all_v57.json")))`
        self.assertTrue(os.path.exists(_asset_path("rate_master_hvac_all_v57.json")))
        # INVERTED at VRF-3a (HVAC v58; a test failing solely because it names the current HVAC asset) by mechanical authority: BEFORE `self.assertFalse(os.path.exists(_asset_path("rate_master_hvac_all_v58.json")))`
        self.assertTrue(os.path.exists(_asset_path("rate_master_hvac_all_v58.json")))
        self.assertFalse(os.path.exists(_asset_path("rate_master_hvac_all_v59.json")))

    # ---- 09 LIVE ---------------------------------------------------------------------------------------------------
    def test_09_live_the_loaded_vrf_config_is_v56s_and_not_eligible(self):
        rows = frappe.get_all("BoQ Rate Category Config", filters={"discipline": "HVAC", "active": 1}, fields=["category_id", "config"])
        live = {r["category_id"]: (json.loads(r["config"]) if isinstance(r["config"], str) else r["config"]) for r in rows}
        cfg = live[CATEGORY]
        self.assertIs(cfg.get("calculator_only"), True)
        # INVERTED at VRF-2b (HVAC v57 loaded; a test failing solely because the live catalogue moved to the current asset) by
        # mechanical authority: BEFORE `self.assertEqual(_norm(cfg.get("list_spec")), _norm(self.cfg["list_spec"]))` (live == v56).
        # The live list_spec is v57's -- v56's plus the VRF-2b keys (test_vrf_v57 08 pins it whole); the claim this test makes
        # (the switch keeps the loaded VRF config out of Suggest) stands, below.
        # INVERTED again at VRF-3a (HVAC v58 loaded) by mechanical authority: BEFORE the live list_spec was compared with v57's
        # (`v57cfg = ... rate_master_hvac_all_v57.json`); it is v58's now (test_vrf_v58 07 pins it whole)
        with open(_asset_path("rate_master_hvac_all_v58.json"), "r", encoding="utf-8") as fh:
            v57cfg = next(c for c in json.load(fh)["category_configs"] if c["category_id"] == CATEGORY)
        self.assertEqual(_norm(cfg.get("list_spec")), _norm(v57cfg["list_spec"]))
        self.assertNotEqual(_norm(cfg.get("list_spec")), _norm(self.cfg["list_spec"]))
        cfgs = {("HVAC", cid): dict(c, discipline="HVAC") for cid, c in live.items()}
        self.assertFalse(extraction.config_is_eligible(cfgs[("HVAC", CATEGORY)], cfgs))
        for uid in RETIRED:
            self.assertEqual(frappe.db.count("BoQ Rate Master Item", {"item_uid": uid, "active": 1}), 0, uid)
        self.assertEqual(frappe.db.count("BoQ Rate Master Item", {"discipline": "HVAC", "active": 1}), 537)
        self.assertEqual(frappe.db.count("BoQ Rate Master Item", {"discipline": "HVAC", "active": 1, "kind": VRF_KIND}), 150)
