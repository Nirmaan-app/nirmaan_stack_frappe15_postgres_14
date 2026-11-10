"""VRF-3a (2026-11-04) -- HVAC v58 = v57 WITH THE OUTDOOR SPLIT, THE STATED SPLIT, SET / REFNET / LOT.

Minted by `scripts/_instruments/mint_hvac_v58_vrf3a.py` (the v57 shape) from v57. The prices and the screen are proved
through the product's own pricer in `frontend/src/pages/pricing/calculatorPanelParity.test.ts` (the VRF-3a block) and
`ruleReachability.test.ts` (R-39); the code, on fixtures, in `vrf3aSplit.test.ts` / `vrf3aSet.test.ts` and test_rate_master
v3a_*. Here the asset is pinned.

What these tests protect, in plain English (01-06 file-only; 07 reads the loaded catalogue):

  01  ONLY hvac_vrf MOVED: every v57 item byte-for-byte (537); every other config byte-for-byte; on hvac_vrf only
      `list_spec` (inside it only `pricing`) and `notes` change; `calculator_only` is STILL true (owner Q1 A: removed at VRF-4).
  02  THE SPLIT (R-SPLIT (a) / (b), R-SPLIT-RULE, D-1 / D-2 / D-3 / D-8): `compose` on capacity with above_only, cost_key
      cost_supply, max_layers 6 and the largest outdoor size as its tolerance; `split` on the Outdoor Unit only, stated,
      with the D-3 condition words (each a valid pattern, each matching the owner's examples). NEGATIVE: no other config
      declares `split`, `per_set`, `lot_units` or `above_only`; the Ductable is not a split family (DUCTABLE).
  03  SET (owner 17:00 / 17:37 / 17:39 / 18:49): Set / Sets join the count class; `per_set` with its bar and the quantity
      label; `counted` on the refnet only: the three fields, +-10% or +-1, the bar and every case's sentence.
  04  LOT (owner "Refuse + review list"): Lot / complete system / LS / Job / per HP in `lot_units`, in no unit class; the
      unit refusal names Set.
  05  THE SWITCH STILL HOLDS: v58 validates; hvac_vrf NOT eligible; the eligible set is v57's; every other item-list
      request is byte-identical; no section delegates to hvac_vrf.
  06  v58 is the newest HVAC asset; the series is 1..58 with no gap; v57 stays on disk.
  07  LIVE (after the load): the active hvac_vrf config equals v58's and is not eligible; 537 active HVAC items.
"""
import copy
import json
import os
import re

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.services.boq_rate_master import config_validation, extraction, loader

V57 = "rate_master_hvac_all_v57.json"
V58 = "rate_master_hvac_all_v58.json"
VRF_KIND, CATEGORY = "hvac_vrf_item", "hvac_vrf"


def _asset_path(name):
    return os.path.join(os.path.dirname(loader.__file__), "data", name)


def _read(name):
    with open(name if os.path.isabs(name) else _asset_path(name), "r", encoding="utf-8") as fh:
        return json.load(fh)


def _norm(obj):
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), default=str)


def _stored(payload):
    return {(payload["discipline"], c["category_id"]): dict(c, discipline=payload["discipline"]) for c in payload["category_configs"]}


class TestVrf3aAssetV58(FrappeTestCase):
    ASSET = V58   # the asset under test (a vacuity run in scratch points this at a scratch copy)

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.v57 = _read(V57)
        cls.v58 = _read(cls.ASSET)
        cls.cfg = next(c for c in cls.v58["category_configs"] if c["category_id"] == CATEGORY)
        cls.cfg57 = next(c for c in cls.v57["category_configs"] if c["category_id"] == CATEGORY)
        cls.pr = cls.cfg["list_spec"]["pricing"]
        cls.pr57 = cls.cfg57["list_spec"]["pricing"]

    def test_01_only_hvac_vrf_moved_and_the_switch_stays(self):
        self.assertEqual([_norm(it) for it in self.v58["items"]], [_norm(it) for it in self.v57["items"]])
        self.assertEqual(len(self.v58["items"]), 537)
        self.assertEqual([c["category_id"] for c in self.v58["category_configs"]], [c["category_id"] for c in self.v57["category_configs"]])
        for a, b in zip(self.v57["category_configs"], self.v58["category_configs"]):
            if a["category_id"] != CATEGORY:
                self.assertEqual(_norm(a), _norm(b), a["category_id"])
        changed = sorted(k for k in set(self.cfg) | set(self.cfg57) if _norm(self.cfg.get(k)) != _norm(self.cfg57.get(k)))
        self.assertEqual(changed, ["list_spec", "notes"])
        self.assertEqual({k: v for k, v in self.cfg["list_spec"].items() if k != "pricing"},
                         {k: v for k, v in self.cfg57["list_spec"].items() if k != "pricing"})
        pchanged = sorted(k for k in set(self.pr) | set(self.pr57) if _norm(self.pr.get(k)) != _norm(self.pr57.get(k)))
        self.assertEqual(pchanged, ["compose", "lot_units", "per_set", "split", "unit_classes", "unit_refusal"])
        self.assertIs(self.cfg["calculator_only"], True)
        self.assertTrue(self.cfg["notes"].startswith(self.cfg57["notes"]))
        self.assertEqual(list(self.v58.keys()), list(self.v57.keys()))

    def test_02_the_split(self):
        caps = [it["attributes"]["capacity"] for it in self.v58["items"] if it["kind"] == VRF_KIND and it["attributes"].get("item") == "Outdoor Unit"]
        self.assertEqual(self.pr["compose"], {"attr": "capacity", "tolerance": max(caps), "max_layers": 6, "cost_key": "cost_supply", "above_only": True})
        sp = self.pr["split"]
        self.assertEqual(sp["families"], ["Outdoor Unit"])
        self.assertIs(sp["stated"], True)
        self.assertIn("{said}", sp["conditions"]["line"])
        examples = ["minimum 2 units of at least 20 HP each", "18 HP (Single module)", "30 HP (Single ODU)", "Module selection as per Site Conditions"]
        for ex in examples:
            self.assertTrue(any(re.search(w, ex, re.I) for w in sp["conditions"]["words"]), ex)
        self.assertFalse(any(re.search(w, "54 HP Outdoor Unit", re.I) for w in sp["conditions"]["words"]))
        self.assertNotIn("Ductable", sp["families"])          # DUCTABLE: "leave these unpriced. no splitting"
        for c in self.v58["category_configs"]:
            if c["category_id"] != CATEGORY:
                pr = ((c.get("list_spec") or {}).get("pricing") or {})
                for k in ("split", "per_set", "lot_units"):
                    self.assertNotIn(k, pr, c["category_id"])
                self.assertNotIn("above_only", pr.get("compose") or {}, c["category_id"])

    def test_03_set_and_the_refnet_count(self):
        self.assertEqual(self.pr["unit_classes"]["count"], self.pr57["unit_classes"]["count"] + ["Set", "Sets"])
        ps = self.pr["per_set"]
        self.assertEqual(ps["units"], ["Set", "Sets"])
        self.assertEqual(ps["qty_label"], "Pieces in one Set of this row")
        self.assertEqual(ps["bar"]["title"], "PRICED PER SET - CHECK WHAT ONE SET HOLDS.")
        self.assertIn("1 Set = 1 piece", ps["bar"]["line"])
        c = ps["counted"]
        self.assertEqual(c["families"], ["Refnet/Y-Joint"])
        self.assertEqual([o["value"] for o in c["covers"]["options"]], ["Whole system (indoor + outdoor)", "Outdoor side only", "Indoor side only"])
        self.assertEqual([x["label"] for x in c["counts"]], ["Outdoor units in this system *", "Indoor units in this system *"])
        self.assertEqual(c["covers"]["label"], "This row covers *")
        self.assertEqual(c["tolerance"], {"share": 0.1, "min": 1})
        self.assertEqual(c["bar"], "REFNETS PRICED PER SET - CHECK THE COUNT.")
        self.assertTrue(c["lines"]["rounded"].startswith("ROUNDED UP to {p} pieces in one Set."))

    def test_04_lot(self):
        lu = self.pr["lot_units"]
        self.assertEqual(lu["units"], ["Lot", "complete system", "LS", "Job", "per HP"])
        self.assertEqual(lu["bar"], "PRICED PER LOT - NOT PRICED. PRICE THIS ROW BY HAND.")
        self.assertIn("{unit}", lu["line"])
        known = {str(x).lower() for v in self.pr["unit_classes"].values() for x in v}
        self.assertEqual([u for u in lu["units"] if u.lower() in known], [])
        self.assertIn("per Nos, per Set or per Kg", self.pr["unit_refusal"])
        self.assertNotIn("VRF-3", self.pr["unit_refusal"])

    def test_05_the_switch_still_holds(self):
        loader._validate_items(self.v58["items"])
        req, elig = {}, {}
        for name, payload in (("v57", self.v57), ("v58", self.v58)):
            cfgs = _stored(payload)
            # INVERTED at VRF-4 (owner Q1 A "removed at VRF-4"; HVAC v60) by mechanical authority: BEFORE every stored config validated as is; the frozen hvac_vrf config is refused BY NAME now (pinned
            # here) and validated with the retired key stripped in memory
            for c in cfgs.values():
                if "calculator_only" in c:
                    with self.assertRaises(Exception) as cm:
                        config_validation._validate_config(c)
                    self.assertIn("Unknown top-level config key(s): calculator_only", str(cm.exception))
                    c = dict(c); c.pop("calculator_only")
                config_validation._validate_config(c)
            elig[name] = sorted(k[1] for k, c in cfgs.items() if extraction.config_is_eligible(c, cfgs))
            req[name] = {k[1]: _norm(extraction.build_items_spec(c, cfgs, "HVAC")) for k, c in cfgs.items()
                         if c.get("list_spec") and k[1] != CATEGORY}
        # INVERTED at VRF-4 (owner Q1 A "removed at VRF-4"; HVAC v60) by mechanical authority: BEFORE `assertNotIn(CATEGORY, elig["v58"])` -- the key is read by nothing, so the frozen VRF config reads eligible
        self.assertEqual(elig["v58"], elig["v57"])
        self.assertIn(CATEGORY, elig["v58"])
        self.assertEqual(req["v58"], req["v57"])
        cfgs = _stored(self.v58)
        self.assertTrue(extraction.has_runnable_pricing_rules(cfgs[("HVAC", CATEGORY)]))
        self.assertEqual([c["category_id"] for c in self.v58["category_configs"] for s in ((c.get("list_spec") or {}).get("sections") or [])
                          if isinstance(s, dict) and s.get("category_id") == CATEGORY], [])
        bad = copy.deepcopy(cfgs[("HVAC", CATEGORY)])
        bad.pop("calculator_only", None)   # VRF-4 hazard 2: else the refusal would be the retired key's, not this test's
        bad["list_spec"]["pricing"]["compose"].pop("above_only")
        with self.assertRaises(Exception) as cm:                 # NEGATIVE: a split without above_only is refused
            config_validation._validate_config(bad)
        self.assertNotIn("calculator_only", str(cm.exception))

    def test_06_v58_is_the_newest_and_v57_stays(self):
        d = os.path.dirname(_asset_path(V58))
        ns = [int(m.group(1)) for f in os.listdir(d) for m in [re.match(r"rate_master_hvac_all_v(\d+)\.json$", f)] if m]
        self.assertEqual(max(ns), 64)   # VRF-8: v64 (BEFORE: 63, VRF-7)
        # INVERTED at VRF-3b (HVAC v59; a test failing solely because it names the current HVAC asset) by mechanical authority: BEFORE `self.assertEqual(sorted(ns), list(range(1, 59)))`
        # INVERTED at VRF-4 (HVAC v60; a test failing solely because it names the current HVAC asset) by mechanical authority: BEFORE `self.assertEqual(sorted(ns), list(range(1, 60)))`
        # INVERTED at VRF-5 (HVAC v61 minted + LOADED; mechanical authority -- fails solely because it reads the current HVAC asset): BEFORE `list(range(1, 61))`
        self.assertEqual(sorted(ns), list(range(1, 65)))  # VRF-8 (HVAC v64 minted + loaded; mechanical authority): BEFORE list(range(1, 64))
        self.assertTrue(os.path.exists(_asset_path(V57)))
        self.assertFalse(os.path.exists(_asset_path("rate_master_hvac_all_v65.json")))   # VRF-8 (BEFORE: v64, VRF-7)

    def test_07_live_the_loaded_vrf_config_is_v58s(self):
        rows = frappe.get_all("BoQ Rate Category Config", filters={"discipline": "HVAC", "active": 1}, fields=["category_id", "config"])
        live = {r["category_id"]: (json.loads(r["config"]) if isinstance(r["config"], str) else r["config"]) for r in rows}
        cfg = live[CATEGORY]
        # INVERTED at VRF-4 (owner Q1 A "removed at VRF-4"; HVAC v60) by mechanical authority: BEFORE `assertIs(cfg.get("calculator_only"), True)` -- the loaded v60 config carries no switch
        self.assertNotIn("calculator_only", cfg)
        # INVERTED at VRF-3b (HVAC v59 loaded; a test failing solely because the live catalogue moved to the current asset) by
        # mechanical authority: BEFORE `self.assertEqual(_norm(cfg.get("list_spec")), _norm(self.cfg["list_spec"]))` (live == v58).
        # The live list_spec is v59's -- v58's plus `extras` (test_vrf_v59 07 pins it whole); every claim below stands.
        # INVERTED at VRF-4 (owner Q1 A "removed at VRF-4"; HVAC v60) by mechanical authority (HVAC v60 loaded): BEFORE the live list_spec was compared with v59's; it is v60's now
        # INVERTED at VRF-5 (HVAC v61 minted + LOADED; mechanical authority): BEFORE `_asset_path("rate_master_hvac_all_v60.json")` -- the live VRF config is v61's (test_vrf_v61 07 pins it whole)
        # INVERTED at VRF-6 (HVAC v62 LOADED; mechanical authority -- fails solely because it reads the live catalogue): BEFORE `_asset_path("rate_master_hvac_all_v61.json")` -- the live VRF config is v62's (test_vrf_v62 07 pins it whole)
        # INVERTED at VRF-7 (HVAC v63 LOADED; mechanical authority -- fails solely because it reads the live catalogue): BEFORE `_asset_path("rate_master_hvac_all_v62.json")` -- the live VRF config is v63's (test_vrf_v63 07 pins it whole)
        # INVERTED at VRF-8 (HVAC v64 LOADED; mechanical authority -- fails solely because it reads the live catalogue): BEFORE `_asset_path("rate_master_hvac_all_v63.json")` -- the live VRF config is v64's (test_vrf_v64 07 pins it whole)
        with open(_asset_path("rate_master_hvac_all_v64.json"), "r", encoding="utf-8") as fh:
            v59cfg = next(c for c in json.load(fh)["category_configs"] if c["category_id"] == CATEGORY)
        self.assertEqual(_norm(cfg.get("list_spec")), _norm(v59cfg["list_spec"]))
        self.assertNotEqual(_norm(cfg.get("list_spec")), _norm(self.cfg["list_spec"]))
        cfgs = {("HVAC", cid): dict(c, discipline="HVAC") for cid, c in live.items()}
        self.assertTrue(extraction.config_is_eligible(cfgs[("HVAC", CATEGORY)], cfgs))   # INVERTED at VRF-4 (owner Q1 A "removed at VRF-4"; HVAC v60) by mechanical authority: BEFORE assertFalse (live = v60, eligible)
        # INVERTED at VRF-3b (HVAC v59 LOADED; mechanical authority): BEFORE `... {"discipline": "HVAC", "active": 1}), 537)` -- + the 29 extras inputs
        # INVERTED at VRF-5 (HVAC v61 minted + LOADED; mechanical authority -- fails solely because it reads the current HVAC asset): BEFORE `... {"discipline": "HVAC", "active": 1}), 566)` -- + the 13 VRF-5 inputs
        self.assertEqual(frappe.db.count("BoQ Rate Master Item", {"discipline": "HVAC", "active": 1}), 585)  # VRF-6 (HVAC v62 minted + loaded; mechanical authority): BEFORE 579