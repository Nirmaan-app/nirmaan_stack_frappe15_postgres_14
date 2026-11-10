"""VRF-6 (2026-11-09) -- HVAC v62 = v61 + THE VRF-5 REVIEW'S FIXES AND THE TEAM'S RULES: THE REMOTE'S TYPE, EVERY UNADDED EXTRA SAID,
THE OWN-ROW CHECK BY CATEGORY, SPLITS, CABLE FACTS PER ITEM, ACCESSORIES FOLLOW THE UNIT'S MAKE, THE FRAME / STAND ITEM, GAS KG = HP,
MCB + ELCB BY THE HP SCHEDULE, AND THE OWNER'S READING RULES.

Minted by `scripts/_instruments/mint_hvac_v62_vrf6.py` (the v61 shape) from v61. The prices and the screen are proved through the
product's own pricer in `vrf6Model.test.ts`, `calculatorPanelParity.test.ts` (the VRF-6 block) and `ruleReachability.test.ts` (R-39);
the validator in test_rate_master. Here the asset is pinned.

What these tests protect, in plain English (01-06 file-only; 07 reads the loaded catalogue):

  01  ONLY hvac_vrf CHANGES, and the items by exactly the declared rows: 9 retired Pricing Inputs out (the Kg frame / Kg gas /
      MCCB band defaults), 14 new Pricing Inputs in, ONE new Misc item ("MS frame / stand for ODU"); every other v61 item
      byte-for-byte and in order; every other config byte-for-byte; on hvac_vrf only `list_spec` (attribute_definitions; pricing:
      extras / families / split), `impact_examples` and `notes`.
  02  THE VRF-6 KEYS, QUESTION CHANGES, INPUTS AND ITEM = THE SHARED FIXTURE (`vrf6Model.json`); the rest of v61 kept.
  03  THE OWNER'S / TEAM'S RULINGS: frame 1 per outdoor module on its Nos item at 4,000 + 40% / 0; gas kg = HP (factor 1); the
      MCB + ELCB schedule 16 / 20 / 20 / 25 / 32 / 40 / 40 / 40 / 63 / 63 / 63 / 63 A for 4-5 / 6 / 8 / 10 / 12 / 14 / 16 / 18 /
      20 / 22 / 24 / 26 HP; MCB 4-pole C curve, ELCB = RCCB 300 mA 4-pole (QR-1); Cordless default with the ambiguous spellings
      first (Q-pre 1); category first (Q-pre 10); the covering single stands unless a covering pair is cheaper (QR-1 Q3 final, 19:32); second_opinion OFF.
  04  THE QUESTIONS REACH THE MODEL: build_items_spec carries the same 53 questions, in order, with the new item choice and the
      changed notes; the parser keeps the new family.
  05  VALIDATES: v62 passes the validator and the cross-category check; hvac_vrf eligible; every other item-list request
      byte-identical to v61's; the 14 inputs are read by hvac_vrf and none of the 9 retired is.
  06  v62 is the newest HVAC asset; the series is 1..62 with no gap; v61 stays on disk.
  07  LIVE (after the load): the active hvac_vrf config equals v62's; 585 active HVAC items; the 14 inputs and the new item
      active; the 9 retired inputs not active.
"""
import json
import os
import re

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.services.boq_rate_master import config_validation, extraction, loader

V61 = "rate_master_hvac_all_v61.json"
V62 = "rate_master_hvac_all_v62.json"
CATEGORY = "hvac_vrf"
FRAME = "MS frame / stand for ODU"


def _asset_path(name):
    return os.path.join(os.path.dirname(loader.__file__), "data", name)


def _read(name):
    with open(name if os.path.isabs(name) else _asset_path(name), "r", encoding="utf-8") as fh:
        return json.load(fh)


def _fixture():
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "frontend", "src", "pages", "pricing",
                        "__fixtures__", "vrf6Model.json")
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def _norm(obj):
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), default=str)


def _stored(payload):
    return {(payload["discipline"], c["category_id"]): dict(c, discipline=payload["discipline"]) for c in payload["category_configs"]}


class TestVrf6AssetV62(FrappeTestCase):
    ASSET = V62   # the asset under test (a vacuity run in scratch points this at a scratch copy)

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.v61 = _read(V61)
        cls.v62 = _read(cls.ASSET)
        cls.fx = _fixture()
        cls.cfg = next(c for c in cls.v62["category_configs"] if c["category_id"] == CATEGORY)
        cls.cfg61 = next(c for c in cls.v61["category_configs"] if c["category_id"] == CATEGORY)
        cls.pr = cls.cfg["list_spec"]["pricing"]
        cls.inputs = {i["attributes"]["item"]: i for i in cls.v62["items"] if i["kind"] == "hvac_pricing_input"}

    def test_01_only_hvac_vrf_and_the_declared_items_moved(self):
        retired = set(self.fx["retire_inputs"])
        kept61 = [i for i in self.v61["items"] if not (i["kind"] == "hvac_pricing_input" and i["attributes"]["item"] in retired)]
        self.assertEqual((len(self.v61["items"]), len(kept61)), (579, 570))
        self.assertEqual(_norm(self.v62["items"][:570]), _norm(kept61))
        added = self.v62["items"][570:]
        self.assertEqual([i["kind"] for i in added], ["hvac_pricing_input"] * 14 + ["hvac_misc_item"])
        self.assertEqual(len(self.v62["items"]), 585)
        self.assertEqual([c["category_id"] for c in self.v62["category_configs"]], [c["category_id"] for c in self.v61["category_configs"]])
        for a, b in zip(self.v61["category_configs"], self.v62["category_configs"]):
            if a["category_id"] != CATEGORY:
                self.assertEqual(_norm(a), _norm(b), a["category_id"])
        changed = sorted(k for k in set(self.cfg) | set(self.cfg61) if _norm(self.cfg.get(k)) != _norm(self.cfg61.get(k)))
        self.assertEqual(changed, ["impact_examples", "list_spec", "notes"])
        po, pn = self.cfg61["list_spec"]["pricing"], self.pr
        self.assertEqual(sorted(k for k in set(po) | set(pn) if _norm(po.get(k)) != _norm(pn.get(k))), ["extras", "families", "split"])

    def test_02_the_keys_questions_inputs_and_item_equal_the_shared_fixture(self):
        fx, ex = self.fx, self.pr["extras"]
        self.assertEqual(_norm(ex["accessories"]), _norm(fx["accessories"]))
        self.assertEqual(_norm(ex["from_model"]["accessory_includes"]), _norm(fx["accessory_includes"]))
        self.assertEqual(_norm(ex["prepare"]), _norm(fx["prepare"]))
        self.assertEqual(_norm(ex["two_capacities"]), _norm(fx["two_capacities"]))
        for k, v in fx["safeguard_add"].items():
            if k == "lines":
                for kk, vv in v.items():
                    self.assertEqual(ex["safeguard"]["lines"][kk], vv, kk)
            else:
                self.assertEqual(_norm(ex["safeguard"][k]), _norm(v), k)
        for k in fx["own_row_drop"]:
            self.assertNotIn(k, ex["safeguard"]["own_row"])
        for k, v in fx["own_row_add"].items():
            for kk, vv in v.items():
                self.assertEqual(_norm(ex["safeguard"]["own_row"][k][kk]), _norm(vv), (k, kk))
        for k, v in fx["scope_add"].items():
            self.assertEqual(_norm(ex["scope"][k]), _norm(v), k)
        for k, v in fx["split_add"].items():
            self.assertEqual(_norm(self.pr["split"][k]), _norm(v), k)
        for k, v in fx["lines_add"].items():
            self.assertEqual(ex["lines"][k], v, k)
        self.assertEqual(_norm(self.pr["families"][FRAME]), _norm(fx["families_add"][FRAME]))
        for p in fx["inputs"]:
            i = self.inputs[p["item"]]
            self.assertEqual((i["attributes"]["name"], i["unit"], i["rates"]["factor"], i["attributes"]["shared_by"]), (p["name"], p["unit"], p["factor"], "vrf"))
        for k in fx["retire_inputs"]:
            self.assertNotIn(k, self.inputs)
        new = self.v62["items"][-1]
        self.assertEqual((new["kind"], new["unit"], new["attributes"]["item"], new["rates"]), ("hvac_misc_item", "Nos", FRAME,
                         {"cost_supply": 4000.0, "supply_markup": 0.4, "cost_install": 0.0, "install_markup": 0.0}))
        # the retired inputs' examples gone; the twelve schedule examples last; every other example kept
        drop = set(fx["impact_examples_drop"])
        kept61 = [e for e in self.cfg61["impact_examples"] if e["id"] not in drop]
        self.assertEqual(_norm(self.cfg["impact_examples"]), _norm(kept61 + fx["impact_examples_add"]))
        self.assertFalse(any("mccb" in json.dumps(e) for e in self.cfg["impact_examples"]))
        # NEGATIVE half: everything else of v61's hvac_vrf is kept (every other pricing key; the questions bar the changed notes / item values)
        for k in ("roles", "band_unit", "includes", "pipe_bands", "power_bands", "copper", "insulation", "cable", "folded"):
            self.assertEqual(_norm(ex[k]), _norm(self.cfg61["list_spec"]["pricing"]["extras"][k]), k)
        q61 = {q["id"]: q for q in self.cfg61["list_spec"]["attribute_definitions"]}
        for q in self.cfg["list_spec"]["attribute_definitions"]:
            if q["id"] not in fx["question_changes"]:
                self.assertEqual(_norm(q), _norm(q61[q["id"]]), q["id"])

    def test_03_the_owners_and_teams_rulings(self):
        acc = {a["id"]: a for a in self.pr["extras"]["accessories"]}
        self.assertEqual(sorted(acc), ["drain_pump", "elcb", "frame", "gas", "mcb", "refnet", "remote"])
        self.assertEqual({k for k, a in acc.items() if a["roles"] == ["outdoor"]}, {"frame", "gas", "mcb", "elcb"})       # Q2 / Q8
        f = lambda iid: self.inputs[iid]["rates"]["factor"]
        self.assertEqual((acc["frame"]["family"], acc["frame"]["input"], f("vrf_acc_frame_per_outdoor")), (FRAME, "vrf_acc_frame_per_outdoor", 1.0))
        self.assertEqual((acc["gas"]["qty_per_size"]["input"], f("vrf_acc_gas_kg_per_hp")), ("vrf_acc_gas_kg_per_hp", 1.0))    # kg = HP
        sch = acc["mcb"]["electrical"]["schedule"]
        self.assertEqual([r["max"] for r in sch], [5, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26])
        self.assertEqual([f(r["input"]) for r in sch], [16, 20, 20, 25, 32, 40, 40, 40, 63, 63, 63, 63])
        self.assertEqual(_norm(acc["elcb"]["electrical"]["schedule"]), _norm(sch))                                      # same amps
        self.assertEqual(acc["mcb"]["electrical"]["match"]["attrs"], {"device": "MCB", "pole": "FP", "curve": "C"})        # QR-1 Q2
        self.assertEqual(acc["elcb"]["electrical"]["match"]["attrs"], {"device": "RCCB", "pole": "FP"})                   # QR-1 Q1
        self.assertIn("300", acc["elcb"]["electrical"]["match"]["name_words"])
        self.assertIn("isolator", acc["mcb"]["electrical"]["alias"]["words"])
        ch = acc["remote"]["choice"]
        self.assertEqual((ch["default"], ch["model_attr"], ch["read_notes"]), ("Cordless", "remote_type", True))          # F1 / Q-pre 1
        self.assertIn("Cordless", ch["first_words"])
        sg = self.pr["extras"]["safeguard"]
        self.assertEqual(sg["match"], "category")                                                                          # Q-pre 10
        self.assertEqual(sg["own_row"]["copper"]["categories"], ["hvac_piping"])
        self.assertEqual(self.pr["split"]["pair_first"]["mode"], "single_unless_cheaper")                                           # QR-1 Q3
        self.assertIs(self.pr["split"]["stated_times"], True)
        q = {d["id"]: d for d in self.cfg["list_spec"]["attribute_definitions"]}
        self.assertIn(FRAME, q["item"]["values"])
        self.assertEqual(q["item"]["values"][-1], "none of these")
        self.assertIn("600 x 600", q["way"]["note"])
        self.assertIn("initial charge", q["includes_gas"]["note"])
        self.assertIn("Breakers / protection", q["includes_mccb"]["note"])
        self.assertIs(self.cfg["list_spec"]["second_opinion"], False)                                        # owner 18:52, standing
        self.assertIs(self.cfg61["list_spec"]["second_opinion"], True)                                      # NEGATIVE: v61 frozen ON
        self.assertEqual(self.pr["split"]["pair_first"]["max_units"], 2)                                    # owner 19:32: pairs
        # NEGATIVE: v61 frozen -- the MCCB accessory, the Kg frame and the band gas stay there
        acc61 = {a["id"]: a for a in self.cfg61["list_spec"]["pricing"]["extras"]["accessories"]}
        self.assertEqual(acc61["mccb"]["electrical"]["template"], "{amp}A FP MCCB")
        self.assertIn("bands", acc61["gas"])

    def test_04_the_questions_reach_the_model_and_survive_the_parser(self):
        cfgs = _stored(self.v62)
        spec = extraction.build_items_spec(cfgs[("HVAC", CATEGORY)], cfgs, "HVAC")
        self.assertEqual([a["id"] for a in spec["attribute_definitions"]], [d["id"] for d in self.cfg["list_spec"]["attribute_definitions"]])
        self.assertEqual(len(spec["attribute_definitions"]), 53)
        sent = {a["id"]: a for a in spec["attribute_definitions"]}
        self.assertIn(FRAME, json.dumps(sent["item"]))
        self.assertIn("corded or cordless", json.dumps(sent["remote_type"]))
        drops = {"items_rows_without_list": [], "items_empty_rows": [], "items_not_objects": {}, "items_family_unrecognised": {},
                 "items_coerce_failed": {}, "items_unknown_section": {}}
        el = {"id": 29, "items": [{"attributes": {"item": {"value": FRAME, "confidence": 0.9}, "remote_type": {"value": "Wired", "confidence": 0.9}}}]}
        items = extraction.parse_item_list(el, spec, drops, 29)
        self.assertEqual(items[0]["attributes"]["item"]["value"], FRAME)
        # NEGATIVE: v61's spec does not know the new family
        cfgs61 = _stored(self.v61)
        spec61 = extraction.build_items_spec(cfgs61[("HVAC", CATEGORY)], cfgs61, "HVAC")
        self.assertNotIn(FRAME, json.dumps(spec61))

    def test_05_validates_eligible_requests_unchanged_inputs_used(self):
        stored = list(_stored(self.v62).values())
        for c in stored:
            config_validation._validate_config(c)
        self.assertEqual(config_validation.delegated_section_problems(stored, self.v62["items"]), [])
        self.assertEqual(config_validation.extras_problems(stored, self.v62["items"]), [])
        cfgs, cfgs61 = _stored(self.v62), _stored(self.v61)
        self.assertTrue(extraction.config_is_eligible(cfgs[("HVAC", CATEGORY)], cfgs))
        for k, c in cfgs.items():
            if c.get("list_spec") and k[1] != CATEGORY:
                self.assertEqual(json.dumps(extraction.build_items_spec(c, cfgs, "HVAC"), sort_keys=True),
                                 json.dumps(extraction.build_items_spec(cfgs61[k], cfgs61, "HVAC"), sort_keys=True), k)
        used = set(config_validation.extras_input_ids(cfgs[("HVAC", CATEGORY)]))
        self.assertEqual({p["item"] for p in self.fx["inputs"]} - used, set())
        self.assertEqual(set(self.fx["retire_inputs"]) & used, set())
        # NEGATIVE: v61's config reads none of the new inputs
        self.assertEqual({p["item"] for p in self.fx["inputs"]} & set(config_validation.extras_input_ids(cfgs61[("HVAC", CATEGORY)])), set())

    def test_05b_every_new_key_is_refused_by_name_when_malformed(self):
        """config_validation: each VRF-6 key's shape -- a broken copy of v62's hvac_vrf is refused, naming the key (and v62 itself validates)."""
        import copy as _copy
        base = dict(self.cfg, discipline="HVAC")
        config_validation._validate_config(base)

        def refused(mut, needle):
            c = _copy.deepcopy(base)
            mut(c["list_spec"]["pricing"])
            with self.assertRaises(frappe.ValidationError) as cm:
                config_validation._validate_config(c)
            self.assertIn(needle, str(cm.exception))

        acc = lambda p, i: next(a for a in p["extras"]["accessories"] if a["id"] == i)
        refused(lambda p: p["extras"]["prepare"].update(bogus=1), "extras.prepare")
        refused(lambda p: p["extras"]["prepare"]["family_words"][0].update(family="Not A Family"), "family_words[0]")
        refused(lambda p: p["extras"]["prepare"]["row_cooling"].update(line="no placeholders"), "row_cooling.line")
        refused(lambda p: p["extras"].update(two_capacities={"words": "(\\d+)", "refusal": "no capacity stated", "line": "two ({list})"}), "two_capacities.words")
        refused(lambda p: p["extras"]["lines"].update(drain_cable_words="(unclosed"), "lines.drain_cable_words")
        refused(lambda p: acc(p, "gas")["qty_per_size"].update(line="no size"), "qty_per_size.line")
        refused(lambda p: acc(p, "gas").update(input="x"), "exactly one of bands / input / qty_per_size")
        refused(lambda p: acc(p, "mcb")["electrical"]["schedule"][1].update(max=4), "electrical.schedule[1]")
        refused(lambda p: acc(p, "mcb")["electrical"]["match"].update(step_up_line="no placeholders"), "match.step_up_line")
        refused(lambda p: acc(p, "remote")["choice"]["first_words"].update(Cordless="(unclosed"), "choice.first_words")
        refused(lambda p: acc(p, "remote")["follow_unit_brand"].update(line="no brand"), "follow_unit_brand.line")
        refused(lambda p: acc(p, "drain_pump")["builtin"].update(extra=1), "builtin")
        refused(lambda p: p["extras"]["safeguard"].update(match="words"), "safeguard.match")
        refused(lambda p: p["extras"]["safeguard"]["note_wins"].update(ids=["frame_x"]), "safeguard.note_wins")
        refused(lambda p: p["extras"]["safeguard"]["own_row"]["copper"].update(category_words={"hvac_adp": ["x"]}), "own_row['copper'].category_words")
        refused(lambda p: p["extras"]["scope"]["conflict"].update(no_row="no said"), "scope.conflict.no_row")
        refused(lambda p: p["extras"]["scope"].update(install_only_normal="Supply only"), "install_only_normal")
        refused(lambda p: p["split"].update(pair_first={"mode": "sometimes", "line": "{total} {layers} {up}"}), "split.pair_first")
        refused(lambda p: p["split"].update(pair_first={"mode": "cheaper", "line": "{total} {layers} {up}", "single_line": "{total} {up} {layers}"}), "split.pair_first")
        refused(lambda p: p["split"]["pair_first"].update(single_line="no total"), "split.pair_first.single_line")
        refused(lambda p: p["split"]["pair_first"].update(max_units=1), "split.pair_first")
        refused(lambda p: p["split"].update(many_line="no n"), "split.many_line")

    def test_06_v62_is_the_newest_and_the_series_has_no_gap(self):
        data = os.path.dirname(_asset_path(V62))
        nums = sorted(int(m.group(1)) for f in os.listdir(data) for m in [re.match(r"^rate_master_hvac_all_v(\d+)\.json$", f)] if m)
        self.assertEqual(nums[-1], 64)  # VRF-8 (HVAC v64 minted + loaded; mechanical authority): BEFORE nums[-1] == 63
        self.assertEqual(nums, list(range(1, 65)))  # VRF-8 (HVAC v64 minted + loaded; mechanical authority): BEFORE list(range(1, 64))
        self.assertTrue(os.path.exists(_asset_path(V61)))

    def test_07_live_catalogue_is_v62(self):
        row = frappe.db.sql('select config from "tabBoQ Rate Category Config" where active=1 and discipline=%s and category_id=%s', ("HVAC", CATEGORY))
        self.assertTrue(row)
        live = json.loads(row[0][0]) if isinstance(row[0][0], str) else row[0][0]
        # INVERTED at VRF-7 (HVAC v63 minted + LOADED; mechanical authority -- fails solely because it reads the live catalogue): BEFORE
        # `assertEqual(_norm(live), _norm(self.cfg))` (live == v62). The live VRF config is v63's (test_vrf_v63 07 pins it whole): v62's
        # pricing keys other than `extras` stand unchanged in it, second opinion stays OFF, and no item moved (585)
        self.assertNotEqual(_norm(live), _norm(self.cfg))
        # VRF-8 (HVAC v64 LOADED; mechanical authority -- fails solely because it reads the live catalogue): BEFORE every pricing key
        # but `extras` equal to v62's. v64 adds `split.stated_not_stocked` (owner W2 / W3); every other split key and every other
        # pricing key stands unchanged
        for k, v in self.cfg["list_spec"]["pricing"].items():
            if k == "split":
                self.assertEqual(_norm({kk: vv for kk, vv in live["list_spec"]["pricing"][k].items() if kk != "stated_not_stocked"}), _norm(v), k)
            elif k != "extras":
                self.assertEqual(_norm(live["list_spec"]["pricing"][k]), _norm(v), k)
        self.assertIs(live["list_spec"]["second_opinion"], False)
        n = frappe.db.sql('select count(*) from "tabBoQ Rate Master Item" where active=1 and discipline=%s', ("HVAC",))[0][0]
        self.assertEqual(n, 585)
        ids = {r[0] for r in frappe.db.sql("""select attributes::json->>'item' from "tabBoQ Rate Master Item" where active=1 and discipline='HVAC' and kind in ('hvac_pricing_input', 'hvac_misc_item')""")}
        self.assertEqual(({p["item"] for p in self.fx["inputs"]} | {FRAME}) - ids, set())
        self.assertEqual(set(self.fx["retire_inputs"]) & ids, set())
