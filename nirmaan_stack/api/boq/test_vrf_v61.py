"""VRF-5 (2026-11-06) -- HVAC v61 = v60 + THE VRF-4 REVIEW'S FIXES: ACCESSORIES AS THE UNIT'S OWN LINES WITH THE OWN-ROW
SAFEGUARD, THE CABLE-WORDS DEFAULT, SIDE BELOW THE SMALLEST TOP UNIT, THE SEVERAL-MAKES RULE, SUPPLY-ONLY / INSTALLATION-ONLY,
THE PER-HP BAR, AND THE 13 PRICING INPUTS THEY READ.

Minted by `scripts/_instruments/mint_hvac_v61_vrf5.py` (the v60 shape) from v60. The prices and the screen are proved through
the product's own pricer in `vrf5Model.test.ts`, `calculatorPanelParity.test.ts` (the VRF-5 block) and `ruleReachability.test.ts`
(R-39); the validator in test_rate_master. Here the asset is pinned.

What these tests protect, in plain English (01-06 file-only; 07 reads the loaded catalogue):

  01  ONLY hvac_vrf CHANGES, plus 13 NEW Pricing Inputs: every v60 item byte-for-byte (566) and in place; every other config
      byte-for-byte; on hvac_vrf only `list_spec` (attribute_definitions, pricing: defaults / extras / lot_units) and `notes`.
  02  THE VRF-5 KEYS, QUESTIONS AND INPUTS = THE SHARED FIXTURE (`vrf5Model.json`), byte for byte; the rest of v60 kept.
  03  THE OWNER'S RULINGS: R1 the six accessories on their roles (frame / gas / MCCB outdoor; drain pump / remote / refnet indoor);
      ANSWER 4 / 6 the defaults (MCCB 40 / 40 / 63 A FP; frame 30 / 45 / 60 Kg; gas 3 / 5 / 8 Kg; 1 per indoor unit) and an
      isolator as the default MCCB; R1 SAFEGUARD's WHERE values; R2 Side below the smallest Top; R5 the three lines; R6-R8 the
      uplift 0.5 (= 50%); the per-HP bar title; "read at VRF-4" gone; second_opinion still ON.
  04  THE QUESTIONS REACH THE MODEL: build_items_spec carries exactly the 53 questions, in order; every answer the pricer reads
      (each accessory's includes, every WHERE / wording / quantity, the scope) is a declared question the parser keeps.
  05  VALIDATES: v61 passes the validator and the cross-category check; hvac_vrf eligible; every other item-list request
      byte-identical to v60's; the 13 inputs are each read by hvac_vrf (the used-by walk counts them).
  06  v61 is the newest HVAC asset; the series is 1..61 with no gap; v60 stays on disk.
  07  LIVE (after the load): the active hvac_vrf config equals v61's; 579 active HVAC items; the 13 inputs active.
"""
import json
import os
import re

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.services.boq_rate_master import config_validation, extraction, loader

V60 = "rate_master_hvac_all_v60.json"
V61 = "rate_master_hvac_all_v61.json"
CATEGORY = "hvac_vrf"


def _asset_path(name):
    return os.path.join(os.path.dirname(loader.__file__), "data", name)


def _read(name):
    with open(name if os.path.isabs(name) else _asset_path(name), "r", encoding="utf-8") as fh:
        return json.load(fh)


def _fixture():
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "frontend", "src", "pages", "pricing",
                        "__fixtures__", "vrf5Model.json")
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def _norm(obj):
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), default=str)


def _stored(payload):
    return {(payload["discipline"], c["category_id"]): dict(c, discipline=payload["discipline"]) for c in payload["category_configs"]}


class TestVrf5AssetV61(FrappeTestCase):
    ASSET = V61   # the asset under test (a vacuity run in scratch points this at a scratch copy)

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.v60 = _read(V60)
        cls.v61 = _read(cls.ASSET)
        cls.fx = _fixture()
        cls.cfg = next(c for c in cls.v61["category_configs"] if c["category_id"] == CATEGORY)
        cls.cfg60 = next(c for c in cls.v60["category_configs"] if c["category_id"] == CATEGORY)
        cls.pr = cls.cfg["list_spec"]["pricing"]
        cls.inputs = {i["attributes"]["item"]: i for i in cls.v61["items"] if i["kind"] == "hvac_pricing_input"}

    def test_01_only_hvac_vrf_and_the_13_inputs_moved(self):
        n60 = len(self.v60["items"])
        self.assertEqual(n60, 566)
        self.assertEqual(_norm(self.v61["items"][:n60]), _norm(self.v60["items"]))
        added = self.v61["items"][n60:]
        self.assertEqual(len(added), 13)
        self.assertEqual({i["kind"] for i in added}, {"hvac_pricing_input"})
        self.assertEqual([c["category_id"] for c in self.v61["category_configs"]], [c["category_id"] for c in self.v60["category_configs"]])
        for a, b in zip(self.v60["category_configs"], self.v61["category_configs"]):
            if a["category_id"] != CATEGORY:
                self.assertEqual(_norm(a), _norm(b), a["category_id"])
        changed = sorted(k for k in set(self.cfg) | set(self.cfg60) if _norm(self.cfg.get(k)) != _norm(self.cfg60.get(k)))
        self.assertEqual(changed, ["impact_examples", "list_spec", "notes"])
        po, pn = self.cfg60["list_spec"]["pricing"], self.pr
        self.assertEqual(sorted(k for k in set(po) | set(pn) if _norm(po.get(k)) != _norm(pn.get(k))), ["defaults", "extras", "lot_units"])
        ls, ls60 = self.cfg["list_spec"], self.cfg60["list_spec"]
        self.assertEqual(sorted(k for k in set(ls) | set(ls60) if _norm(ls.get(k)) != _norm(ls60.get(k))), ["attribute_definitions", "pricing"])

    def test_02_the_keys_questions_and_inputs_equal_the_shared_fixture(self):
        fx, ex = self.fx, self.pr["extras"]
        self.assertEqual(_norm(self.cfg["impact_examples"][10:]), _norm(fx["impact_examples_add"]))
        for k in ("accessories", "safeguard", "folded", "scope"):
            self.assertEqual(_norm(ex[k]), _norm(fx[k]), k)
        for k, v in fx["extras_words"].items():
            self.assertEqual(ex["lines"][k], v, k)
        for k, v in fx["from_model_add"].items():
            self.assertEqual(_norm(ex["from_model"][k]), _norm(v), k)
        self.assertEqual(_norm(self.pr["defaults"]["discharge"]["below_smallest"]), _norm(fx["defaults_add"]["discharge"]["below_smallest"]))
        self.assertEqual(_norm(self.pr["defaults"]["brand"]["unlisted"]["several_rule"]), _norm(fx["defaults_add"]["brand"]["several_rule"]))
        qs = self.cfg["list_spec"]["attribute_definitions"]
        self.assertEqual(_norm(qs[20:]), _norm(fx["questions_add"]))
        self.assertTrue(qs[0]["note"].endswith(fx["item_note_add"]))
        for p in fx["inputs"]:
            i = self.inputs[p["item"]]
            self.assertEqual((i["attributes"]["name"], i["unit"], i["rates"]["factor"], i["attributes"]["shared_by"]), (p["name"], p["unit"], p["factor"], "vrf"))
        # NEGATIVE half: everything else of v60's hvac_vrf is kept (the 20 questions bar the item note, every other pricing key)
        q60 = self.cfg60["list_spec"]["attribute_definitions"]
        self.assertEqual(_norm([dict(q, note=None) for q in qs[:20]]), _norm([dict(q, note=None) for q in q60]))
        for k in ("roles", "band_unit", "includes", "pipe_bands", "power_bands", "copper", "insulation", "cable"):
            self.assertEqual(_norm(ex[k]), _norm(self.cfg60["list_spec"]["pricing"]["extras"][k]), k)

    def test_03_the_owners_rulings(self):
        acc = {a["id"]: a for a in self.pr["extras"]["accessories"]}
        self.assertEqual(sorted(acc), ["drain_pump", "frame", "gas", "mccb", "refnet", "remote"])                     # R1
        self.assertEqual({k for k, a in acc.items() if a["roles"] == ["outdoor"]}, {"frame", "gas", "mccb"})
        self.assertEqual({k for k, a in acc.items() if a["roles"] == ["indoor"]}, {"drain_pump", "remote", "refnet"})
        f = lambda iid: self.inputs[iid]["rates"]["factor"]
        self.assertEqual([f(f"vrf_acc_mccb_outdoor_{b}_amp") for b in ("upto_8hp", "8_to_14hp", "above_14hp")], [40, 40, 63])   # ANSWER 6
        self.assertEqual(acc["mccb"]["electrical"]["template"], "{amp}A FP MCCB")
        self.assertIn("isolator", acc["mccb"]["electrical"]["alias"]["words"])
        self.assertEqual([f(f"vrf_acc_frame_outdoor_{b}_qty") for b in ("upto_8hp", "8_to_14hp", "above_14hp")], [30, 45, 60])  # ANSWER 4
        self.assertEqual([f(f"vrf_acc_gas_outdoor_{b}_qty") for b in ("upto_8hp", "8_to_14hp", "above_14hp")], [3, 5, 8])
        self.assertEqual([f(f"vrf_acc_{k}_per_indoor") for k in ("drain_pump", "remote", "refnet")], [1, 1, 1])
        self.assertEqual(acc["remote"]["choice"]["default"], "Cordless")
        self.assertEqual([b["max"] for b in acc["frame"]["bands"]["outdoor"]], [8, 14, None])                      # = the cable bands
        sg = self.pr["extras"]["safeguard"]
        self.assertEqual(sg["row_value"], "Row")
        q = {d["id"]: d for d in self.cfg["list_spec"]["attribute_definitions"]}
        self.assertEqual(q["includes_copper_where"]["values"], ["Row", "Heading", "Note"])
        self.assertEqual(self.pr["defaults"]["discharge"]["below_smallest"]["then"], "Side")                       # R2
        self.assertIn("{n}", self.pr["defaults"]["discharge"]["below_smallest"]["rule"])
        self.assertIn("none of the stated makes", self.pr["defaults"]["brand"]["unlisted"]["several_rule"]["none_stocked"])   # R5
        self.assertEqual(f("vrf_install_only_uplift"), 0.5)                                                         # R6-R8
        self.assertEqual(self.pr["extras"]["scope"]["uplift_input"], "vrf_install_only_uplift")
        self.assertEqual(self.pr["lot_units"]["bar_by_unit"], {"per HP": "PRICED PER HP - NOT PRICED. PRICE THIS ROW BY HAND."})
        self.assertNotIn("read at VRF-4", self.pr["lot_units"]["line"])
        self.assertIn("read at VRF-4", self.cfg60["list_spec"]["pricing"]["lot_units"]["line"])                    # NEGATIVE: v60 frozen
        self.assertIs(self.cfg["list_spec"]["second_opinion"], True)
        self.assertIn("Touch Screen Central Controller", q["item"]["note"])                                         # R3
        self.assertIn("Ductable", q["item"]["note"])

    def test_04_the_questions_reach_the_model_and_survive_the_parser(self):
        cfgs = _stored(self.v61)
        spec = extraction.build_items_spec(cfgs[("HVAC", CATEGORY)], cfgs, "HVAC")
        self.assertEqual([a["id"] for a in spec["attribute_definitions"]], [d["id"] for d in self.cfg["list_spec"]["attribute_definitions"]])
        self.assertEqual(len(spec["attribute_definitions"]), 53)
        asked = {a["id"] for a in spec["attribute_definitions"]}
        fm, sg = self.pr["extras"]["from_model"], self.pr["extras"]["safeguard"]
        read = set(fm["accessory_includes"].values()) | {fm["scope"]}
        for inc, qid in list(fm["includes"].items()) + list(fm["accessory_includes"].items()):
            read |= {qid + sg["where_suffix"], qid + sg["wording_suffix"]}
            if inc in fm["accessory_includes"]:
                read.add(qid + sg["qty_suffix"])
        self.assertEqual(read - asked, set())
        drops = {"items_rows_without_list": [], "items_empty_rows": [], "items_not_objects": {}, "items_family_unrecognised": {},
                 "items_coerce_failed": {}, "items_unknown_section": {}}
        el = {"id": 7, "items": [{"attributes": {"item": {"value": "Outdoor Unit", "confidence": 0.9}, "includes_gas": {"value": "Yes", "confidence": 0.9},
                                                 "includes_gas_where": {"value": "Heading", "confidence": 0.9}, "scope": {"value": "Installation only", "confidence": 0.9},
                                                 "includes_gas_qty_as_written": {"value": "3 kg", "confidence": 0.9}, "gas_kg": {"value": "3", "confidence": 0.9}}}]}
        items = extraction.parse_item_list(el, spec, drops, 7)
        a = items[0]["attributes"]
        self.assertEqual((a["includes_gas"]["value"], a["includes_gas_where"]["value"], a["scope"]["value"], a["includes_gas_qty_as_written"]["value"]),
                         ("Yes", "Heading", "Installation only", "3 kg"))
        self.assertNotIn("gas_kg", a)                                                                               # undeclared -> dropped

    def test_05_validates_eligible_requests_unchanged_inputs_used(self):
        stored = list(_stored(self.v61).values())
        for c in stored:
            config_validation._validate_config(c)
        self.assertEqual(config_validation.delegated_section_problems(stored, self.v61["items"]), [])
        self.assertEqual(config_validation.extras_problems(stored, self.v61["items"]), [])
        cfgs, cfgs60 = _stored(self.v61), _stored(self.v60)
        self.assertTrue(extraction.config_is_eligible(cfgs[("HVAC", CATEGORY)], cfgs))
        for k, c in cfgs.items():
            if c.get("list_spec") and k[1] != CATEGORY:
                self.assertEqual(json.dumps(extraction.build_items_spec(c, cfgs, "HVAC"), sort_keys=True),
                                 json.dumps(extraction.build_items_spec(cfgs60[k], cfgs60, "HVAC"), sort_keys=True), k)
        used = set(config_validation.extras_input_ids(cfgs[("HVAC", CATEGORY)]))
        self.assertEqual({p["item"] for p in self.fx["inputs"]} - used, set())
        # NEGATIVE: v60's config reads none of them
        self.assertEqual({p["item"] for p in self.fx["inputs"]} & set(config_validation.extras_input_ids(cfgs60[("HVAC", CATEGORY)])), set())

    def test_06_v61_is_the_newest_and_the_series_has_no_gap(self):
        data = os.path.dirname(_asset_path(V61))
        nums = sorted(int(m.group(1)) for f in os.listdir(data) for m in [re.match(r"^rate_master_hvac_all_v(\d+)\.json$", f)] if m)
        self.assertEqual(nums[-1], 64)  # VRF-8 (HVAC v64 minted + loaded; mechanical authority): BEFORE nums[-1] == 63
        self.assertEqual(nums, list(range(1, 65)))  # VRF-8 (HVAC v64 minted + loaded; mechanical authority): BEFORE list(range(1, 64))
        self.assertTrue(os.path.exists(_asset_path(V60)))

    def test_07_live_catalogue_is_v61(self):
        row = frappe.db.sql('select config from "tabBoQ Rate Category Config" where active=1 and discipline=%s and category_id=%s', ("HVAC", CATEGORY))
        self.assertTrue(row)
        live = json.loads(row[0][0]) if isinstance(row[0][0], str) else row[0][0]
        # INVERTED at VRF-6 (HVAC v62 minted + LOADED; mechanical authority -- fails solely because it reads the live catalogue): BEFORE
        # `assertEqual(_norm(live), _norm(self.cfg))` (live == v61) and every one of the 13 VRF-5 inputs active. The live VRF config is v62's
        # (test_vrf_v62 07 pins it whole): v61's 53 question ids stand inside it (second opinion OFF, owner 18:52); 9 of the 13 inputs are retired by the team rule
        self.assertNotEqual(_norm(live), _norm(self.cfg))
        # INVERTED at VRF-7 (HVAC v63 minted + LOADED; mechanical authority -- fails solely because it reads the live catalogue): BEFORE
        # `assertEqual(live ids, v61's 53 ids)`. v63 (owner 2026-11-10) drops the shared length question and adds 16 (test_vrf_v63 07 pins the
        # live config whole): every other v61 question still stands in the live config, in v61's order
        self.assertEqual([q["id"] for q in live["list_spec"]["attribute_definitions"] if q["id"] in {d["id"] for d in self.cfg["list_spec"]["attribute_definitions"]}],
                         [q["id"] for q in self.cfg["list_spec"]["attribute_definitions"] if q["id"] != "extra_length_as_written"])
        # INVERTED at VRF-6 (owner 2026-11-09 18:52: "run with second opinion off ... from now onwards we will keep it off"; v62 LOADED): BEFORE
        # `assertIs(live["list_spec"]["second_opinion"], True)`
        self.assertIs(live["list_spec"]["second_opinion"], False)
        n = frappe.db.sql('select count(*) from "tabBoQ Rate Master Item" where active=1 and discipline=%s', ("HVAC",))[0][0]
        self.assertEqual(n, 585)  # VRF-6 (HVAC v62 minted + loaded; mechanical authority): BEFORE n == 579
        ids = {r[0] for r in frappe.db.sql("""select attributes::json->>'item' from "tabBoQ Rate Master Item" where active=1 and discipline='HVAC' and kind='hvac_pricing_input'""")}
        kept = {"vrf_install_only_uplift", "vrf_acc_drain_pump_per_indoor", "vrf_acc_remote_per_indoor", "vrf_acc_refnet_per_indoor"}
        self.assertEqual(kept - ids, set())
        self.assertEqual(({p["item"] for p in self.fx["inputs"]} - kept) & ids, set())
