"""VRF-3b (2026-11-05) -- HVAC v59 = v58 WITH THE EXTRAS A VRF UNIT'S PRICE INCLUDES AND THEIR 29 PRICING INPUTS.

Minted by `scripts/_instruments/mint_hvac_v59_vrf3b.py` (the v58 shape) from v58. The prices and the screen are proved through
the product's own pricer in `frontend/src/pages/pricing/calculatorPanelParity.test.ts` (the VRF-3b block),
`ruleReachability.test.ts` (R-39) and `vrf3bExtras.test.ts`; the validator in test_rate_master v3b_*. Here the asset is pinned.

What these tests protect, in plain English (01-06 file-only; 07 reads the loaded catalogue):

  01  ONLY hvac_vrf AND 29 NEW PRICING INPUTS: every v58 item byte-for-byte (537); every other config byte-for-byte; on
      hvac_vrf only `list_spec` (inside it only `pricing.extras`), `impact_examples` (v58's four kept first) and `notes`
      change; `calculator_only` is STILL true (owner Q1 A: removed at VRF-4).
  02  THE EXTRAS = THE SHARED FIXTURE (`vrf3bExtras.json`), byte for byte: roles, bands, includes, targets, words; the 29
      inputs equal the fixture's (item_uid aside), each a single `factor`, kind hvac_pricing_input, shared_by vrf.
  03  THE OWNER'S NUMBERS (2026-11-05 11:30-13:59): 30 m copper and 30 m cable; pipe sizes 12.7 / 6.4, 15.9 / 9.5,
      22.2 / 15.9, 28.6 / 19.1, 34.9 / 22.2 with 19 mm insulation; power 3C x 1.5, 3C x 2.5, 4C x 6, 4C x 10, 4C x 16 and
      communication 2C x 1.5, copper unarmoured; band edges 4 TR / 8 TR and 12 / 20 HP and 8 / 14 HP.
  04  EVERY DEFAULT IS STOCKED: each pipe size is a stocked Copper size of v59's Piping; 19 mm Nitrile is stocked on the
      closest Insulation size of each; each cable spec is a stocked unarmoured copper cable of Electrical v72.
  05  THE SWITCH STILL HOLDS: v59 validates (with the cross-category extras check); hvac_vrf NOT eligible; the eligible set
      is v58's; every other item-list request is byte-identical; no other config declares `extras`.
  06  v59 is the newest HVAC asset; the series is 1..59 with no gap; v58 stays on disk.
  07  LIVE (after the load): the active hvac_vrf config equals v59's and is not eligible; 566 active HVAC items; the 29
      inputs are active.
"""
import copy
import json
import os
import re

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.services.boq_rate_master import config_validation, extraction, loader

V58 = "rate_master_hvac_all_v58.json"
V59 = "rate_master_hvac_all_v59.json"
E72 = "rate_master_electrical_all_v72.json"
CATEGORY, INPUT_KIND = "hvac_vrf", "hvac_pricing_input"


def _asset_path(name):
    return os.path.join(os.path.dirname(loader.__file__), "data", name)


def _read(name):
    with open(name if os.path.isabs(name) else _asset_path(name), "r", encoding="utf-8") as fh:
        return json.load(fh)


def _fixture():
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "frontend", "src", "pages", "pricing",
                        "__fixtures__", "vrf3bExtras.json")
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def _norm(obj):
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), default=str)


def _stored(payload):
    return {(payload["discipline"], c["category_id"]): dict(c, discipline=payload["discipline"]) for c in payload["category_configs"]}


class TestVrf3bAssetV59(FrappeTestCase):
    ASSET = V59   # the asset under test (a vacuity run in scratch points this at a scratch copy)

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.v58 = _read(V58)
        cls.v59 = _read(cls.ASSET)
        cls.fx = _fixture()
        cls.cfg = next(c for c in cls.v59["category_configs"] if c["category_id"] == CATEGORY)
        cls.cfg58 = next(c for c in cls.v58["category_configs"] if c["category_id"] == CATEGORY)
        cls.ex = cls.cfg["list_spec"]["pricing"].get("extras")
        uids58 = {i["item_uid"] for i in cls.v58["items"]}
        cls.new = [i for i in cls.v59["items"] if i["item_uid"] not in uids58]
        cls.inp = {i["attributes"]["item"]: i["rates"]["factor"] for i in cls.new}

    def test_01_only_hvac_vrf_and_29_inputs_moved_and_the_switch_stays(self):
        by_uid = {i["item_uid"]: i for i in self.v59["items"]}
        for i in self.v58["items"]:
            self.assertEqual(_norm(by_uid.get(i["item_uid"])), _norm(i), i["item_uid"])
        self.assertEqual(len(self.v59["items"]), 537 + 29)
        self.assertEqual(len(self.new), 29)
        self.assertTrue(all(i["kind"] == INPUT_KIND for i in self.new))
        self.assertEqual([i["item_uid"] for i in self.v59["items"]], sorted(i["item_uid"] for i in self.v59["items"]))
        self.assertEqual([c["category_id"] for c in self.v59["category_configs"]], [c["category_id"] for c in self.v58["category_configs"]])
        for a, b in zip(self.v58["category_configs"], self.v59["category_configs"]):
            if a["category_id"] != CATEGORY:
                self.assertEqual(_norm(a), _norm(b), a["category_id"])
        changed = sorted(k for k in set(self.cfg) | set(self.cfg58) if _norm(self.cfg.get(k)) != _norm(self.cfg58.get(k)))
        self.assertEqual(changed, ["impact_examples", "list_spec", "notes"])
        po, pn = self.cfg58["list_spec"]["pricing"], self.cfg["list_spec"]["pricing"]
        self.assertEqual(sorted(k for k in set(po) | set(pn) if _norm(po.get(k)) != _norm(pn.get(k))), ["extras"])
        self.assertEqual(self.cfg["impact_examples"][:len(self.cfg58["impact_examples"])], self.cfg58["impact_examples"])
        self.assertIs(self.cfg.get("calculator_only"), True)

    def test_02_the_extras_and_the_inputs_equal_the_shared_fixture(self):
        self.assertEqual(_norm(self.ex), _norm(self.fx["extras"]))
        self.assertEqual(_norm(self.cfg["impact_examples"][len(self.cfg58["impact_examples"]):]), _norm(self.fx["examples"]))
        strip = lambda i: {k: v for k, v in i.items() if k not in ("item_uid", "source")}
        self.assertEqual(sorted(_norm(strip(i)) for i in self.new), sorted(_norm(i) for i in self.fx["inputs"]))
        for i in self.new:
            self.assertEqual(list(i["rates"]), ["factor"])
            self.assertEqual(i["attributes"]["shared_by"], "vrf")
            self.assertTrue(re.match(r"^rmi-[0-9a-f]{12}$", i["item_uid"]), i["item_uid"])
        self.assertEqual(sorted(config_validation.extras_input_ids(dict(self.cfg, discipline="HVAC"))), sorted(self.inp))

    def test_03_the_owners_numbers(self):
        self.assertEqual(self.inp["vrf_extra_copper_length_m"], 30.0)
        self.assertEqual(self.inp["vrf_extra_cable_length_m"], 30.0)
        pipes = {"vrf_extra_pipe_indoor_upto_4tr": (12.7, 6.4), "vrf_extra_pipe_indoor_above_4tr": (15.9, 9.5),
                 "vrf_extra_pipe_outdoor_upto_12hp": (22.2, 15.9), "vrf_extra_pipe_outdoor_12_to_20hp": (28.6, 19.1),
                 "vrf_extra_pipe_outdoor_above_20hp": (34.9, 22.2)}
        for pid, (s, r) in pipes.items():
            self.assertEqual((self.inp[pid + "_supply_mm"], self.inp[pid + "_return_mm"], self.inp[pid + "_insulation_mm"]), (s, r, 19.0), pid)
        cables = {"vrf_extra_power_indoor_upto_4tr": (3, 1.5), "vrf_extra_power_indoor_4_to_8tr": (3, 2.5), "vrf_extra_power_outdoor_upto_8hp": (4, 6),
                  "vrf_extra_power_outdoor_8_to_14hp": (4, 10), "vrf_extra_power_outdoor_above_14hp": (4, 16), "vrf_extra_comm_cable": (2, 1.5)}
        for cid, (c, q) in cables.items():
            self.assertEqual((self.inp[cid + "_cores"], self.inp[cid + "_sqmm"]), (float(c), float(q)), cid)
        for i in self.new:
            if i["attributes"]["item"].endswith(("_cores", "_sqmm")):
                self.assertEqual((i["attributes"]["material"], i["attributes"]["armour"]), ("COPPER", "Unarmoured"))   # the loader canonicalises `material`
        self.assertEqual([b["max"] for b in self.ex["pipe_bands"]["indoor"]], [4, None])
        self.assertEqual([b["max"] for b in self.ex["pipe_bands"]["outdoor"]], [12, 20, None])
        self.assertEqual([b["max"] for b in self.ex["power_bands"]["indoor"]], [4, 8])
        self.assertEqual([b["max"] for b in self.ex["power_bands"]["outdoor"]], [8, 14, None])
        self.assertEqual(self.ex["band_unit"], {"indoor": "TR", "outdoor": "HP"})
        self.assertEqual(self.ex["insulation"]["attrs"], {"cladding": "No"})
        self.assertEqual(self.ex["cable"]["attrs"], {"material": "COPPER", "insulation": "UNARMOURED", "runs": "1"})

    def test_04_every_default_is_stocked(self):
        e72 = _read(E72)
        copper = {i["attributes"]["size_mm"] for i in self.v59["items"] if i["kind"] == "hvac_piping_item" and i["attributes"].get("pipe_type") == "Copper"}
        ins = {(i["attributes"].get("pipe_size_mm"), i["attributes"].get("thickness_mm")) for i in self.v59["items"]
               if i["kind"] == "hvac_insulation_item" and i["attributes"].get("item") == "Nitrile Rubber Insulation"}
        ins_sizes = sorted({p for p, _t in ins if p is not None})
        for k, v in self.inp.items():
            if k.endswith(("_supply_mm", "_return_mm")):
                self.assertIn(v, copper, k)
                closest = min(ins_sizes, key=lambda s: (abs(s - v), -s))
                self.assertIn((closest, 19.0), ins, k)
        cables = {(i["attributes"]["core"], i["attributes"]["thickness_sqmm"]) for i in e72["items"]
                  if i["kind"] == "cable" and i["attributes"].get("material") == "COPPER" and i["attributes"].get("insulation") == "UNARMOURED"}
        for k, v in self.inp.items():
            if k.endswith("_cores"):
                self.assertIn((v, self.inp[k[:-len("_cores")] + "_sqmm"]), cables, k)

    def test_05_validates_not_eligible_requests_unchanged(self):
        stored = list(_stored(self.v59).values())
        # INVERTED at VRF-4 (owner Q1 A "removed at VRF-4"; HVAC v60) by mechanical authority: BEFORE every stored config validated as is; the frozen v59 hvac_vrf config is refused BY NAME now
        for n, c in enumerate(stored):
            if "calculator_only" in c:
                with self.assertRaises(Exception) as cm:
                    config_validation._validate_config(c)
                self.assertIn("Unknown top-level config key(s): calculator_only", str(cm.exception))
                stored[n] = c = dict(c); c.pop("calculator_only")
            config_validation._validate_config(c)
        self.assertEqual(config_validation.delegated_section_problems(stored, self.v59["items"]), [])
        self.assertEqual(config_validation.extras_problems(stored, self.v59["items"]), [])
        cfgs, cfgs58 = _stored(self.v59), _stored(self.v58)
        # INVERTED at VRF-4 (owner Q1 A "removed at VRF-4"; HVAC v60) by mechanical authority: BEFORE `assertFalse(config_is_eligible(v59's VRF))` -- the key is read by nothing, so it reads eligible (as v58's)
        self.assertTrue(extraction.config_is_eligible(cfgs[("HVAC", CATEGORY)], cfgs))
        el = lambda cf: sorted(k[1] for k, c in cf.items() if extraction.config_is_eligible(c, cf))
        self.assertEqual(el(cfgs), el(cfgs58))
        for k, c in cfgs.items():
            if c.get("list_spec") and k[1] != CATEGORY:
                self.assertEqual(json.dumps(extraction.build_items_spec(c, cfgs, "HVAC"), sort_keys=True),
                                 json.dumps(extraction.build_items_spec(cfgs58[k], cfgs58, "HVAC"), sort_keys=True), k)
        self.assertEqual([k[1] for k, c in cfgs.items() if k[1] != CATEGORY and "extras" in ((c.get("list_spec") or {}).get("pricing") or {})], [])

    def test_06_v59_is_the_newest_and_the_series_has_no_gap(self):
        data = os.path.dirname(_asset_path(V59))
        nums = sorted(int(m.group(1)) for f in os.listdir(data) for m in [re.match(r"^rate_master_hvac_all_v(\d+)\.json$", f)] if m)
        # INVERTED at VRF-4 (HVAC v60; a test failing solely because it names the current HVAC asset) by mechanical authority: BEFORE `nums[-1] == 59` and `range(1, 60)`
        # INVERTED at VRF-5 (HVAC v61 minted + LOADED; mechanical authority -- fails solely because it reads the current HVAC asset): BEFORE `nums[-1] == 60` and `range(1, 61)`
        self.assertEqual(nums[-1], 64)  # VRF-8 (HVAC v64 minted + loaded; mechanical authority): BEFORE nums[-1] == 63
        self.assertEqual(nums, list(range(1, 65)))  # VRF-8 (HVAC v64 minted + loaded; mechanical authority): BEFORE list(range(1, 64))
        self.assertTrue(os.path.exists(_asset_path(V58)))

    def test_07_live_catalogue_is_v59(self):
        row = frappe.db.sql('select config from "tabBoQ Rate Category Config" where active=1 and discipline=%s and category_id=%s', ("HVAC", CATEGORY))
        self.assertTrue(row)
        live = json.loads(row[0][0]) if isinstance(row[0][0], str) else row[0][0]
        # INVERTED at VRF-4 (owner Q1 A "removed at VRF-4"; HVAC v60) by mechanical authority (HVAC v60 loaded): BEFORE `assertEqual(_norm(live), _norm(self.cfg))` (live == v59). The live VRF config is
        # v60's (test_vrf_v60 07 pins it whole): v59's extras stand inside it, the switch is gone
        self.assertNotEqual(_norm(live), _norm(self.cfg))
        self.assertNotIn("calculator_only", live)
        # INVERTED at VRF-5 (HVAC v61 LOADED; mechanical authority): BEFORE the live extras less `from_model` only -- v61's extras also carry
        # `accessories` / `safeguard` / `folded` / `scope` (VRF-5); v59's extras still stand inside them
        # INVERTED at VRF-6 (HVAC v62 LOADED; mechanical authority): BEFORE the excluded keys stopped at `scope` -- v62's extras also carry
        # `prepare` / `two_capacities` (VRF-6); v59's extras still stand inside them
        self.assertEqual(_norm({k: v for k, v in live["list_spec"]["pricing"]["extras"].items() if k not in ("from_model", "accessories", "safeguard", "folded", "scope", "prepare", "two_capacities")} | {"lines": None, "cable": None}),
                         _norm({k: v for k, v in self.ex.items()} | {"lines": None, "cable": None}))
        n = frappe.db.sql('select count(*) from "tabBoQ Rate Master Item" where active=1 and discipline=%s', ("HVAC",))[0][0]
        # INVERTED at VRF-5 (HVAC v61 minted + LOADED; mechanical authority -- fails solely because it reads the current HVAC asset): BEFORE `self.assertEqual(n, 566)` -- + the 13 VRF-5 inputs
        self.assertEqual(n, 585)  # VRF-6 (HVAC v62 minted + loaded; mechanical authority): BEFORE n == 579
        ids = {r[0] for r in frappe.db.sql('select attributes::json->>%s from "tabBoQ Rate Master Item" where active=1 and discipline=%s and kind=%s', ("item", "HVAC", INPUT_KIND))}
        self.assertTrue(set(self.inp) <= ids)
