"""VRF-7 (2026-11-10) -- HVAC v63 = v62 + THE VRF-6 REVIEW'S FIXES (owner rulings 2026-11-10 01:30-01:53): A STATED DISCHARGE WINS,
HEAT-PUMP WORDINGS, ARMOURED ONLY WHEN STATED, A LENGTH PER ITEM, THE CONTROL-WIRING KEYWORD RULE DROPPED, STEP-UP NOTES, THE
OWN-ROW CHECK FOR EVERY EXTRA, NOTES THAT QUOTE THE BOQ, A STATED MODULE SETUP, AN OPTIONAL REMOTE, FRESH AIR BEATS CSU, AN
INDIVIDUAL CONTROLLER, THE STARTER-PANEL AND WIRED-REMOTE NOTES.

Minted by `scripts/_instruments/mint_hvac_v63_vrf7.py` (the v62 shape) from v62. The prices and the screen are proved through the
product's own pricer in `vrf7Model.test.ts`, `calculatorPanelParity.test.ts` (the VRF-7 block) and `ruleReachability.test.ts` (R-39);
the validator here (05b) and in test_rate_master. Here the asset is pinned.

What these tests protect, in plain English (01-06 file-only; 07 reads the loaded catalogue):

  01  ONLY hvac_vrf's list_spec CHANGES: every v62 item byte-for-byte and in order (no input, no item added or retired); every other
      config byte-for-byte; on hvac_vrf only `attribute_definitions` and `pricing.extras` (accessories / from_model / lines /
      prepare / safeguard).
  02  THE VRF-7 KEYS AND QUESTION CHANGES = THE SHARED FIXTURE (`vrf7Model.json`), applied to v62 exactly as the mint does.
  03  THE OWNER'S RULINGS: the control-wiring keyword rule is gone (A4) and the shared length with it (A3); the own-row check runs
      for every extra (B7) and the notes quote the BoQ (B8); fresh air before the Ductable rule (B11); second_opinion OFF.
  04  THE QUESTIONS REACH THE MODEL: build_items_spec carries the 68 questions in order; the parser keeps the new answers
      (armoured, a per-item length, the BoQ words, the module setup).
  05  VALIDATES: v63 passes the validator and the cross-category check; hvac_vrf eligible; every other item-list request
      byte-identical to v62's; the Pricing Inputs hvac_vrf reads are v62's. 05b: every new key refused by name when malformed.
  06  v63 is the newest HVAC asset; the series is 1..63 with no gap; v62 stays on disk.
  07  LIVE (after the load): the active hvac_vrf config equals v63's; 585 active HVAC items.
"""
import copy
import json
import os
import re

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.services.boq_rate_master import config_validation, extraction, loader

V62 = "rate_master_hvac_all_v62.json"
V63 = "rate_master_hvac_all_v63.json"
CATEGORY = "hvac_vrf"
NEW_QUESTIONS = ["extra_power_armoured", "extra_comm_armoured", "extra_power_length_as_written", "extra_comm_length_as_written",
                 "extra_copper_length_as_written", "includes_copper_words", "includes_insulation_words", "includes_power_words",
                 "includes_comm_words", "includes_frame_words", "includes_gas_words", "includes_drain_pump_words", "includes_remote_words",
                 "includes_refnet_words", "includes_mccb_words", "module_setup_as_written"]


def _asset_path(name):
    return os.path.join(os.path.dirname(loader.__file__), "data", name)


def _read(name):
    with open(name if os.path.isabs(name) else _asset_path(name), "r", encoding="utf-8") as fh:
        return json.load(fh)


def _fixture():
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "frontend", "src", "pages", "pricing",
                        "__fixtures__", "vrf7Model.json")
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def _norm(obj):
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), default=str)


def _stored(payload):
    return {(payload["discipline"], c["category_id"]): dict(c, discipline=payload["discipline"]) for c in payload["category_configs"]}


def _apply(cfg62, fx):
    """The fixture applied to v62's hvac_vrf -- written here a second time on purpose (not imported from the mint), so a wrong step
    in either shows as a difference."""
    c = copy.deepcopy(cfg62)
    x = c["list_spec"]["pricing"]["extras"]
    x["prepare"].update(copy.deepcopy(fx["prepare_add"]))
    for fw in x["prepare"]["family_words"]:
        if fw["family"] in fx["family_words_unless"]:
            fw["unless"] = fx["family_words_unless"][fw["family"]]
    x["prepare"]["family_words"] = copy.deepcopy(fx["family_words_prepend"]) + x["prepare"]["family_words"]
    x["safeguard"]["lines"].update(fx["safeguard_add"]["lines"])
    for k, v in fx["safeguard_add"].items():
        if k != "lines":
            x["safeguard"][k] = copy.deepcopy(v)
    for k in fx["safeguard_drop"]:
        del x["safeguard"][k]
    for a in x["accessories"]:
        pt = fx["accessories_patch"].get(a["id"], {})
        if "step_up_note" in pt:
            a["electrical"]["match"]["step_up_note"] = pt["step_up_note"]
        if "note_words" in pt:
            a["note_words"] = copy.deepcopy(pt["note_words"])
        if "conflict" in pt:
            a["choice"]["conflict"] = copy.deepcopy(pt["conflict"])
    x["from_model"].update(copy.deepcopy(fx["from_model_add"]))
    for k in fx["from_model_drop"]:
        del x["from_model"][k]
    x["lines"].update(fx["lines_add"])
    defs = [dict(q) for q in c["list_spec"]["attribute_definitions"] if q["id"] not in fx["question_drop"]]
    for q in defs:
        if q["id"] in fx["question_notes_append"]:
            q["note"] = q.get("note", "") + fx["question_notes_append"][q["id"]]
    c["list_spec"]["attribute_definitions"] = defs + copy.deepcopy(fx["question_add"])
    c["list_spec"]["second_opinion"] = fx["second_opinion"]
    return c


class TestVrf7AssetV63(FrappeTestCase):
    ASSET = V63   # the asset under test (a vacuity run in scratch points this at a scratch copy)

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.v62 = _read(V62)
        cls.v63 = _read(cls.ASSET)
        cls.fx = _fixture()
        cls.cfg = next(c for c in cls.v63["category_configs"] if c["category_id"] == CATEGORY)
        cls.cfg62 = next(c for c in cls.v62["category_configs"] if c["category_id"] == CATEGORY)
        cls.x = cls.cfg["list_spec"]["pricing"]["extras"]

    def test_01_only_hvac_vrf_list_spec_moved(self):
        self.assertEqual(_norm(self.v63["items"]), _norm(self.v62["items"]))
        for a, b in zip(self.v62["category_configs"], self.v63["category_configs"]):
            self.assertEqual(a["category_id"], b["category_id"])
            if a["category_id"] != CATEGORY:
                self.assertEqual(_norm(a), _norm(b), a["category_id"])
        changed = sorted(k for k in set(self.cfg) | set(self.cfg62) if _norm(self.cfg.get(k)) != _norm(self.cfg62.get(k)))
        self.assertEqual(changed, ["list_spec"])
        ls, ls62 = self.cfg["list_spec"], self.cfg62["list_spec"]
        self.assertEqual(sorted(k for k in set(ls) | set(ls62) if _norm(ls.get(k)) != _norm(ls62.get(k))), ["attribute_definitions", "pricing"])
        p, p62 = ls["pricing"], ls62["pricing"]
        self.assertEqual(sorted(k for k in set(p) | set(p62) if _norm(p.get(k)) != _norm(p62.get(k))), ["extras"])
        x62 = p62["extras"]
        self.assertEqual(sorted(k for k in set(self.x) | set(x62) if _norm(self.x.get(k)) != _norm(x62.get(k))),
                         ["accessories", "from_model", "lines", "prepare", "safeguard"])

    def test_02_the_keys_and_questions_equal_the_shared_fixture(self):
        self.assertEqual(_norm(self.cfg), _norm(_apply(self.cfg62, self.fx)))
        # NEGATIVE: the fixture without one key is not v63
        fx = copy.deepcopy(self.fx)
        fx["prepare_add"].pop("stated_setup")
        self.assertNotEqual(_norm(self.cfg), _norm(_apply(self.cfg62, fx)))

    def test_03_the_owners_rulings(self):
        sg = self.x["safeguard"]
        self.assertNotIn("control_wiring", sg)                       # A4: the keyword rule is gone
        self.assertIn("control_wiring", self.cfg62["list_spec"]["pricing"]["extras"]["safeguard"])
        self.assertIs(sg["own_row_always"], True)                     # B7
        self.assertEqual(sg["words_suffix"], "_words")                # B8
        for k in ("added_q", "excluded_q", "not_added_q"):
            self.assertIn("{words}", sg["lines"][k])
            self.assertIn("{where}", sg["lines"][k])
        self.assertNotIn("length", self.x["from_model"])              # A3: no shared length
        self.assertEqual(self.x["from_model"]["length_by_item"], {"power": "extra_power_length_as_written", "comm": "extra_comm_length_as_written",
                                                                  "copper": "extra_copper_length_as_written"})
        self.assertEqual(self.x["from_model"]["armoured"], {"power": "extra_power_armoured", "comm": "extra_comm_armoured"})   # A2
        fw = self.x["prepare"]["family_words"]
        self.assertEqual(fw[0]["family"], "Single Skin Treated Fresh Air")                     # B11: fresh air first
        duct = next(f for f in fw if f["family"] == "Ductable")
        self.assertTrue(re.search(duct["unless"], "CSU type treated fresh air unit", re.I))
        self.assertEqual(set(self.x["prepare"]["discharge_words"]["words"]), {"Top", "Side"})   # A1
        self.assertTrue(re.search(self.x["prepare"]["discharge_words"]["words"]["Top"], "18 HP - Top dishcarge", re.I))
        self.assertTrue(re.search(self.x["prepare"]["heat_words"]["words"], "For Cooling or Heating or Both", re.I))   # A5
        self.assertFalse(re.search(self.x["prepare"]["heat_words"]["words"], "cooling only", re.I))
        mcb = next(a for a in self.x["accessories"] if a["id"] == "mcb")
        self.assertIn("{hp}", mcb["electrical"]["match"]["step_up_note"])                     # A6
        self.assertTrue(re.search(mcb["note_words"]["words"], "unit mounted starter panel with power disconnecting switches with fuses", re.I))  # D1
        self.assertIs(self.cfg["list_spec"]["second_opinion"], False)

    def test_04_the_questions_reach_the_model_and_survive_the_parser(self):
        cfgs = _stored(self.v63)
        spec = extraction.build_items_spec(cfgs[("HVAC", CATEGORY)], cfgs, "HVAC")
        ids = [a["id"] for a in spec["attribute_definitions"]]
        self.assertEqual(ids, [d["id"] for d in self.cfg["list_spec"]["attribute_definitions"]])
        self.assertEqual(len(ids), 68)
        self.assertEqual(ids[-16:], NEW_QUESTIONS)
        self.assertNotIn("extra_length_as_written", ids)
        sent = {a["id"]: a for a in spec["attribute_definitions"]}
        self.assertIn("fails or breaks down is NOT scope", json.dumps(sent["includes_comm"]))
        drops = {"items_rows_without_list": [], "items_empty_rows": [], "items_not_objects": {}, "items_family_unrecognised": {},
                 "items_coerce_failed": {}, "items_unknown_section": {}}
        el = {"id": 14, "items": [{"attributes": {"item": {"value": "Outdoor Unit", "confidence": 0.9},
                                                   "extra_power_armoured": {"value": "Yes", "confidence": 0.9},
                                                   "extra_power_length_as_written": {"value": "around a distance of 5m", "confidence": 0.9},
                                                   "includes_frame_words": {"value": "MS frame for ODU", "confidence": 0.9},
                                                   "module_setup_as_written": {"value": "16HP+16HP", "confidence": 0.9}}}]}
        items = extraction.parse_item_list(el, spec, drops, 14)
        a = items[0]["attributes"]
        self.assertEqual(a["extra_power_armoured"]["value"], "Yes")
        self.assertEqual(a["extra_power_length_as_written"]["value"], "around a distance of 5m")
        self.assertEqual(a["includes_frame_words"]["value"], "MS frame for ODU")
        self.assertEqual(a["module_setup_as_written"]["value"], "16HP+16HP")
        # NEGATIVE: v62's spec drops the new answers (they are not its questions)
        cfgs62 = _stored(self.v62)
        spec62 = extraction.build_items_spec(cfgs62[("HVAC", CATEGORY)], cfgs62, "HVAC")
        items62 = extraction.parse_item_list(copy.deepcopy(el), spec62, copy.deepcopy(drops), 14)
        self.assertNotIn("module_setup_as_written", items62[0]["attributes"])

    def test_05_validates_eligible_requests_unchanged_inputs_same(self):
        stored = list(_stored(self.v63).values())
        for c in stored:
            config_validation._validate_config(c)
        self.assertEqual(config_validation.delegated_section_problems(stored, self.v63["items"]), [])
        self.assertEqual(config_validation.extras_problems(stored, self.v63["items"]), [])
        cfgs, cfgs62 = _stored(self.v63), _stored(self.v62)
        self.assertTrue(extraction.config_is_eligible(cfgs[("HVAC", CATEGORY)], cfgs))
        for k, c in cfgs.items():
            if c.get("list_spec") and k[1] != CATEGORY:
                self.assertEqual(json.dumps(extraction.build_items_spec(c, cfgs, "HVAC"), sort_keys=True),
                                 json.dumps(extraction.build_items_spec(cfgs62[k], cfgs62, "HVAC"), sort_keys=True), k)
        self.assertEqual(set(config_validation.extras_input_ids(cfgs[("HVAC", CATEGORY)])),
                         set(config_validation.extras_input_ids(cfgs62[("HVAC", CATEGORY)])))

    def test_05b_every_new_key_is_refused_by_name_when_malformed(self):
        """config_validation: each VRF-7 key's shape -- a broken copy of v63's hvac_vrf is refused, naming the key (v63 validates)."""
        base = dict(self.cfg, discipline="HVAC")
        config_validation._validate_config(base)

        def refused(mut, needle, whole=False):
            c = copy.deepcopy(base)
            mut(c if whole else c["list_spec"]["pricing"])
            with self.assertRaises(frappe.ValidationError) as cm:
                config_validation._validate_config(c)
            self.assertIn(needle, str(cm.exception))

        acc = lambda p, i: next(a for a in p["extras"]["accessories"] if a["id"] == i)
        pp = lambda p: p["extras"]["prepare"]
        refused(lambda p: pp(p)["discharge_words"].update(line="no placeholders"), "discharge_words.line")
        refused(lambda p: pp(p)["discharge_words"]["words"].update(Top="(unclosed"), "discharge_words.words")
        refused(lambda p: pp(p)["heat_words"].update(families=["Not A Family"]), "heat_words.families")
        refused(lambda p: pp(p)["armour_words"]["attrs"].update(power=""), "armour_words")
        refused(lambda p: pp(p)["implied_includes"][0].update(role="both"), "implied_includes[0]")
        refused(lambda p: pp(p)["stated_setup"].update(min_each="minimum \\d+ units"), "stated_setup.min_each")
        refused(lambda p: pp(p)["family_words"][0].update(unless="(unclosed"), "family_words[0].unless")
        refused(lambda p: p["extras"]["safeguard"].update(own_row_always=False), "safeguard.own_row_always")
        refused(lambda p: p["extras"]["safeguard"]["lines"].update(added_q="{label} added"), "lines.added_q")
        refused(lambda p: acc(p, "mcb")["electrical"]["match"].update(step_up_note="no hp"), "match.step_up_note")
        refused(lambda p: acc(p, "mcb")["note_words"].update(extra=1), "note_words")
        refused(lambda p: acc(p, "remote")["choice"]["conflict"].update(line="nothing"), "choice.conflict.line")
        refused(lambda p: p["extras"]["from_model"].update(length_by_item={"pipe": "x"}), "from_model.length_by_item")
        refused(lambda p: p["extras"]["from_model"]["armoured"].update(power="no_such_question"), "no_such_question")
        refused(lambda p: p["extras"]["lines"].update(length_default="no placeholders"), "length_default")
        refused(lambda c: c["list_spec"].update(attribute_definitions=[d for d in c["list_spec"]["attribute_definitions"] if d["id"] != "includes_gas_words"]),
                "includes_gas_words", whole=True)

    def test_06_v63_is_the_newest_and_the_series_has_no_gap(self):
        data = os.path.dirname(_asset_path(V63))
        nums = sorted(int(m.group(1)) for f in os.listdir(data) for m in [re.match(r"^rate_master_hvac_all_v(\d+)\.json$", f)] if m)
        self.assertEqual(nums[-1], 65)  # VRF-9 (HVAC v65 minted + loaded; mechanical authority): BEFORE nums[-1] == 64
        self.assertEqual(nums, list(range(1, 66)))  # VRF-9 (HVAC v65 minted + loaded; mechanical authority): BEFORE list(range(1, 65))
        self.assertTrue(os.path.exists(_asset_path(V62)))

    def test_07_live_catalogue_is_v63(self):
        row = frappe.db.sql('select config from "tabBoQ Rate Category Config" where active=1 and discipline=%s and category_id=%s', ("HVAC", CATEGORY))
        self.assertTrue(row)
        live = json.loads(row[0][0]) if isinstance(row[0][0], str) else row[0][0]
        # INVERTED at VRF-8 (HVAC v64 minted + LOADED; mechanical authority -- fails solely because it reads the live catalogue): BEFORE
        # `assertEqual(_norm(live), _norm(self.cfg))` (live == v63). The live VRF config is v64's (test_vrf_v64 07 pins it whole): v63's
        # question ids stand in it in order, every v63 pricing key but `extras` / `split` is unchanged, second opinion stays OFF, 585 items
        self.assertNotEqual(_norm(live), _norm(self.cfg))
        self.assertEqual([q["id"] for q in live["list_spec"]["attribute_definitions"]], [q["id"] for q in self.cfg["list_spec"]["attribute_definitions"]])
        for k, v in self.cfg["list_spec"]["pricing"].items():
            # VRF-9 (HVAC v65 LOADED; mechanical authority): BEFORE `k not in ("extras", "split")` -- v65 also moves per_set
            # (counted.defined, S8) and lot_units (calculator_refuses, S7)
            if k not in ("extras", "split", "per_set", "lot_units"):
                self.assertEqual(_norm(live["list_spec"]["pricing"][k]), _norm(v), k)
        self.assertIs(live["list_spec"]["second_opinion"], False)
        n = frappe.db.sql('select count(*) from "tabBoQ Rate Master Item" where active=1 and discipline=%s', ("HVAC",))[0][0]
        self.assertEqual(n, 585)
