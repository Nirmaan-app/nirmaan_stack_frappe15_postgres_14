"""VRF-8 (2026-11-10) -- HVAC v64 = v63 + THE VRF-7 REVIEW'S FIXES (owner rulings 2026-11-10 13:56-15:05): STARTER-PANEL BREAKERS,
AN UNSTOCKED STATED SETUP BY THE SPLIT RULE, "QUANTIFIED SEPARATELY" ALWAYS SAID, REMOTE NOTES FROM THIS UNIT'S OWN WORDS, THE
SUPPLY-HEADING SCOPE NOTE, SUPPORTS = MS STAND, FEEDER DISTANCE = POWER LENGTH, BREAKER (IF REQUIRED) WINS, PLUG-TOP CABLING,
INTERCONNECTIONS = CONNECTION WORK, THE NEARER HEADING WINS ON MODE, INSTALL-ONLY FOLLOWS ITS SUPPLY ROW, THE REPEATED SIZE, SEVERAL
UNIT TYPES REFUSE, EVERY EXTRA QUESTION REQUIRED (RE-ASKED ONCE), TFA + ITS OUTDOOR UNIT, THE FIRST MAKE TOO BIG, VERIFIED QUOTES.

Minted by `scripts/_instruments/mint_hvac_v64_vrf8.py` (the v63 shape) from v63. The prices and the screen are proved through the
product's own pricer in `vrf8Model.test.ts`, `calculatorPanelParity.test.ts` (the VRF-8 block) and `ruleReachability.test.ts` (R-39);
the validator here (05b) and in test_rate_master. Here the asset is pinned, and the extraction's re-ask (R-D13) is proved.

What these tests protect, in plain English (01-06 and 08 file-only; 07 reads the loaded catalogue):

  01  ONLY hvac_vrf's list_spec CHANGES: every v63 item byte-for-byte and in order; every other config byte-for-byte; on hvac_vrf
      only `attribute_definitions` and `pricing.extras` (accessories / lines / prepare / safeguard / scope) and `pricing.split`.
  02  THE VRF-8 KEYS AND QUESTION CHANGES = THE SHARED FIXTURE (`vrf8Model.json`), applied to v63 exactly as the mint does.
  03  THE OWNER'S RULINGS: the ten extra questions are REQUIRED (never left out; "None" kept for "nothing describes it"); the
      starter-panel words read "mouted"; supports / plug top / feeder / breaker (if required) / interconnections / the nearer
      heading / several unit types read the BoQ's own words; second_opinion OFF.
  04  THE QUESTIONS REACH THE MODEL: build_items_spec carries the same 68 questions with `required` on the ten; the parser keeps a
      "None" and nulls a left-out answer.
  05  VALIDATES: v64 passes the validator and the cross-category check; hvac_vrf eligible; every other item-list request
      byte-identical to v63's; the Pricing Inputs hvac_vrf reads are v63's. 05b: every new key refused by name when malformed.
  06  v64 is the newest HVAC asset; the series is 1..64 with no gap; v63 stays on disk.
  07  LIVE (after the load): the active hvac_vrf config equals v64's; 585 active HVAC items.
  08  THE RE-ASK (R-D13): a row whose reply leaves a required answer out is asked ONCE more, with the same prompt, in the same run;
      the re-read replaces the first; a config marking nothing required asks once only.
"""
import copy
import json
import os
import re
from unittest import mock

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.services.boq_rate_master import config_validation, extraction, loader

V63 = "rate_master_hvac_all_v63.json"
V64 = "rate_master_hvac_all_v64.json"
CATEGORY = "hvac_vrf"
REQUIRED = ["includes_copper", "includes_insulation", "includes_power", "includes_comm", "includes_frame", "includes_gas",
            "includes_drain_pump", "includes_remote", "includes_refnet", "includes_mccb"]


def _asset_path(name):
    return os.path.join(os.path.dirname(loader.__file__), "data", name)


def _read(name):
    with open(name if os.path.isabs(name) else _asset_path(name), "r", encoding="utf-8") as fh:
        return json.load(fh)


def _fixture():
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "frontend", "src", "pages", "pricing",
                        "__fixtures__", "vrf8Model.json")
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def _norm(obj):
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), default=str)


def _stored(payload):
    return {(payload["discipline"], c["category_id"]): dict(c, discipline=payload["discipline"]) for c in payload["category_configs"]}


def _apply(cfg63, fx):
    """The fixture applied to v63's hvac_vrf -- written here a second time on purpose (not imported from the mint), so a wrong step
    in either shows as a difference."""
    c = copy.deepcopy(cfg63)
    p = c["list_spec"]["pricing"]
    x = p["extras"]
    for k, v in fx["prepare_add"].items():
        x["prepare"][k] = copy.deepcopy(v)
    x["prepare"]["implied_includes"] = list(x["prepare"].get("implied_includes", [])) + copy.deepcopy(fx["implied_includes_add"])
    for k, v in fx["split_add"].items():
        p["split"][k] = copy.deepcopy(v)
    for k, v in fx["safeguard_add"].items():
        x["safeguard"][k] = copy.deepcopy(v)
    for k, v in fx["note_wins_add"].items():
        x["safeguard"]["note_wins"][k] = v
    for k, v in fx["scope_add"].items():
        x["scope"][k] = copy.deepcopy(v)
    for a in x["accessories"]:
        pt = fx["accessories_patch"].get(a["id"], {})
        if "note_words" in pt:
            a["note_words"] = copy.deepcopy(pt["note_words"])
        if "conflict_add" in pt:
            a["choice"]["conflict"].update(copy.deepcopy(pt["conflict_add"]))
    for k, v in fx["lines_add"].items():
        x["lines"][k] = v
    ap = fx["question_notes_append"]
    defs = []
    for q in c["list_spec"]["attribute_definitions"]:
        q = dict(q)
        if q["id"] in fx["question_required"]:
            q["required"] = True
            q["note"] = q.get("note", "") + ap["*required"]
        if q["id"].endswith("_words") and q["id"][:-6] in fx["question_required"]:
            q["note"] = q.get("note", "") + ap["*words"]
        if q["id"] in ap:
            q["note"] = q.get("note", "") + ap[q["id"]]
        defs.append(q)
    c["list_spec"]["attribute_definitions"] = defs
    c["list_spec"]["second_opinion"] = fx["second_opinion"]
    return c


class TestVrf8AssetV64(FrappeTestCase):
    ASSET = V64   # the asset under test (a vacuity run in scratch points this at a scratch copy)

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.v63 = _read(V63)
        cls.v64 = _read(cls.ASSET)
        cls.fx = _fixture()
        cls.cfg = next(c for c in cls.v64["category_configs"] if c["category_id"] == CATEGORY)
        cls.cfg63 = next(c for c in cls.v63["category_configs"] if c["category_id"] == CATEGORY)
        cls.x = cls.cfg["list_spec"]["pricing"]["extras"]

    def test_01_only_hvac_vrf_list_spec_moved(self):
        self.assertEqual(_norm(self.v64["items"]), _norm(self.v63["items"]))
        for a, b in zip(self.v63["category_configs"], self.v64["category_configs"]):
            self.assertEqual(a["category_id"], b["category_id"])
            if a["category_id"] != CATEGORY:
                self.assertEqual(_norm(a), _norm(b), a["category_id"])
        changed = sorted(k for k in set(self.cfg) | set(self.cfg63) if _norm(self.cfg.get(k)) != _norm(self.cfg63.get(k)))
        self.assertEqual(changed, ["list_spec"])
        ls, ls63 = self.cfg["list_spec"], self.cfg63["list_spec"]
        self.assertEqual(sorted(k for k in set(ls) | set(ls63) if _norm(ls.get(k)) != _norm(ls63.get(k))), ["attribute_definitions", "pricing"])
        p, p63 = ls["pricing"], ls63["pricing"]
        self.assertEqual(sorted(k for k in set(p) | set(p63) if _norm(p.get(k)) != _norm(p63.get(k))), ["extras", "split"])
        x63 = p63["extras"]
        self.assertEqual(sorted(k for k in set(self.x) | set(x63) if _norm(self.x.get(k)) != _norm(x63.get(k))),
                         ["accessories", "lines", "prepare", "safeguard", "scope"])
        self.assertEqual([q["id"] for q in ls["attribute_definitions"]], [q["id"] for q in ls63["attribute_definitions"]])

    def test_02_the_keys_and_questions_equal_the_shared_fixture(self):
        self.assertEqual(_norm(self.cfg), _norm(_apply(self.cfg63, self.fx)))
        # NEGATIVE: the fixture without one key is not v64
        fx = copy.deepcopy(self.fx)
        fx["prepare_add"].pop("several_types")
        self.assertNotEqual(_norm(self.cfg), _norm(_apply(self.cfg63, fx)))

    def test_03_the_owners_rulings(self):
        defs = {q["id"]: q for q in self.cfg["list_spec"]["attribute_definitions"]}
        for q in REQUIRED:
            self.assertIs(defs[q].get("required"), True, q)                         # R-D13
            self.assertIs(defs[q].get("allow_none"), True, q)                       # the prompt's "None" = nothing describes it
            self.assertIn("never leave it out", defs[q]["note"])
            self.assertIn("ONE exact clause", defs[q + "_words"]["note"])          # R-D14-7
        self.assertEqual(sorted(q for q, d in defs.items() if d.get("required")), sorted(REQUIRED))
        pp = self.x["prepare"]
        starter = next(i for i in pp["implied_includes"] if i["question"] == "includes_mccb")
        self.assertTrue(re.search(starter["words"], "The unit mouted starter panel shall be complete with IP-55 protection consisting of power disconnecting switches with fuses", re.I))
        self.assertIs(starter["only_blank"], True)                                 # R-W1: the model's explicit No stands
        sup = next(i for i in pp["implied_includes"] if i["question"] == "includes_frame")
        self.assertTrue(re.search(sup["words"], "The Rate shall be inclusive of R-410A refrigerant & oil pre charging, vibration isolators, supports, etc", re.I))
        self.assertTrue(re.search(sup["not_words"], "Indoor units necessary supports to be included in the costing", re.I))   # R-D2 negative
        self.assertEqual(re.search(pp["feeder_length"]["words"], "Single feeder shall be provided for all VRF ODU within 5 mtr distance from ODU", re.I).group(1), "5")
        self.assertTrue(re.search(pp["breaker_words"]["words"], "cable tray and breaker (if required) to distribute power", re.I))
        self.assertTrue(re.search(pp["breaker_words"]["ec_words"], "MCCB / MCB isolator & incoming power supply for VRV/VRF ODU unit will be in Electrical contractor scope", re.I))
        self.assertTrue(re.search(pp["connection_only"]["words"], "necessary interconnections with Power supply / earthing / Refrigerant Connections", re.I))
        self.assertTrue(re.search(pp["mode_nearest"]["cool_words"], "suitable to work on cooling mode even during peak winter season", re.I))
        self.assertTrue(re.search(pp["mode_nearest"]["heat_words"], "individual controller for cooling & heating application", re.I))
        self.assertEqual(pp["several_types"]["note_max"], 60)
        self.assertIn("several unit types under this heading", pp["several_types"]["refusal"])
        self.assertIs(self.x["safeguard"]["verified_quotes"], True)
        self.assertIn("{where}", self.x["safeguard"]["note_wins"]["line_silent"])
        self.assertEqual(self.cfg["list_spec"]["pricing"]["split"]["stated_not_stocked"]["line"].count("{total}"), 1)
        remote = next(a for a in self.x["accessories"] if a["id"] == "remote")
        self.assertEqual(remote["choice"]["conflict"]["head"], 60)
        self.assertIs(self.cfg["list_spec"]["second_opinion"], False)

    def test_04_the_questions_reach_the_model_and_survive_the_parser(self):
        cfgs = _stored(self.v64)
        spec = extraction.build_items_spec(cfgs[("HVAC", CATEGORY)], cfgs, "HVAC")
        ids = [a["id"] for a in spec["attribute_definitions"]]
        self.assertEqual(ids, [d["id"] for d in self.cfg["list_spec"]["attribute_definitions"]])
        self.assertEqual(len(ids), 68)
        sent = {a["id"]: a for a in spec["attribute_definitions"]}
        self.assertEqual(sorted(i for i, a in sent.items() if a.get("required")), sorted(REQUIRED))
        self.assertEqual(extraction.required_item_attrs(spec), [i for i in ids if i in REQUIRED])
        drops = {"items_rows_without_list": [], "items_empty_rows": [], "items_not_objects": {}, "items_family_unrecognised": {},
                 "items_coerce_failed": {}, "items_unknown_section": {}}
        el = {"id": 14, "items": [{"attributes": {"item": {"value": "Cassette", "confidence": 0.9},
                                                   "includes_remote": {"value": "None", "confidence": 0.9}}}]}
        a = extraction.parse_item_list(el, spec, drops, 14)[0]["attributes"]
        self.assertEqual(a["includes_remote"]["value"], "None")       # "None" is an answer
        self.assertIsNone(a["includes_drain_pump"]["value"])         # left out -> null (the re-ask's signal)
        # NEGATIVE: v63's spec marks nothing required
        cfgs63 = _stored(self.v63)
        self.assertEqual(extraction.required_item_attrs(extraction.build_items_spec(cfgs63[("HVAC", CATEGORY)], cfgs63, "HVAC")), [])

    def test_05_validates_eligible_requests_unchanged_inputs_same(self):
        stored = list(_stored(self.v64).values())
        for c in stored:
            config_validation._validate_config(c)
        self.assertEqual(config_validation.delegated_section_problems(stored, self.v64["items"]), [])
        self.assertEqual(config_validation.extras_problems(stored, self.v64["items"]), [])
        cfgs, cfgs63 = _stored(self.v64), _stored(self.v63)
        self.assertTrue(extraction.config_is_eligible(cfgs[("HVAC", CATEGORY)], cfgs))
        for k, c in cfgs.items():
            if c.get("list_spec") and k[1] != CATEGORY:
                self.assertEqual(json.dumps(extraction.build_items_spec(c, cfgs, "HVAC"), sort_keys=True),
                                 json.dumps(extraction.build_items_spec(cfgs63[k], cfgs63, "HVAC"), sort_keys=True), k)
        self.assertEqual(set(config_validation.extras_input_ids(cfgs[("HVAC", CATEGORY)])),
                         set(config_validation.extras_input_ids(cfgs63[("HVAC", CATEGORY)])))

    def test_05b_every_new_key_is_refused_by_name_when_malformed(self):
        """config_validation: each VRF-8 key's shape -- a broken copy of v64's hvac_vrf is refused, naming the key (v64 validates)."""
        base = dict(self.cfg, discipline="HVAC")
        config_validation._validate_config(base)

        def refused(mut, needle, whole=False):
            c = copy.deepcopy(base)
            mut(c if whole else c["list_spec"]["pricing"])
            with self.assertRaises(frappe.ValidationError) as cm:
                config_validation._validate_config(c)
            self.assertIn(needle, str(cm.exception))

        pp = lambda p: p["extras"]["prepare"]
        ii = lambda p, q: next(i for i in pp(p)["implied_includes"] if i["question"] == q)
        acc = lambda p, i: next(a for a in p["extras"]["accessories"] if a["id"] == i)
        refused(lambda p: pp(p)["feeder_length"].update(words="within \\d+ m"), "feeder_length.words")
        refused(lambda p: pp(p)["feeder_length"].update(line="no length"), "feeder_length.line")
        refused(lambda p: pp(p)["breaker_words"].update(ec_words="(unclosed"), "breaker_words.ec_words")
        refused(lambda p: pp(p)["breaker_words"].update(line_ec_only="nothing"), "breaker_words.line_ec_only")
        refused(lambda p: pp(p)["connection_only"].update(questions={}), "connection_only.questions")
        refused(lambda p: pp(p)["mode_nearest"].update(families=["Not A Family"]), "mode_nearest.families")
        refused(lambda p: pp(p)["install_follows"].update(attrs=[]), "install_follows.attrs")
        refused(lambda p: pp(p)["repeated_size"].update(words="\\d+ tr"), "repeated_size.words")
        refused(lambda p: pp(p)["several_types"].update(note_max=0), "several_types.note_max")
        refused(lambda p: pp(p)["unit_words"].update({"Not A Family": "x"}), "unit_words")
        refused(lambda p: pp(p)["missing_answers"].update(extra=1), "missing_answers")
        refused(lambda p: pp(p)["tfa_outdoor"].update(outdoor_family="Not A Family"), "tfa_outdoor.outdoor_family")
        refused(lambda p: pp(p)["first_make_close"].update(line_next="no make"), "first_make_close.line_next")
        refused(lambda p: ii(p, "includes_frame").update(only_blank=False), "only_blank")
        refused(lambda p: ii(p, "includes_frame").update(not_words="(unclosed"), "not_words")
        refused(lambda p: ii(p, "includes_power").pop("only_blank"), "implied_includes")
        refused(lambda p: p["extras"]["safeguard"].update(verified_quotes=False), "safeguard.verified_quotes")
        refused(lambda p: p["extras"]["safeguard"]["note_wins"].update(line_silent="nothing"), "note_wins.line_silent")
        refused(lambda p: p["extras"]["scope"]["supply_heading"].update(note="no placeholders"), "supply_heading.note")
        refused(lambda p: p["split"]["stated_not_stocked"].update(line="no total"), "stated_not_stocked.line")
        refused(lambda p: acc(p, "remote")["choice"]["conflict"].update(head=0), "conflict.head")
        refused(lambda p: acc(p, "remote")["choice"]["conflict"].update(pairs="(unclosed"), "conflict.pairs")
        refused(lambda p: p["extras"]["lines"].update(drain_cable_row_line="no rows"), "drain_cable_row_line")
        refused(lambda c: next(d for d in c["list_spec"]["attribute_definitions"] if d["id"] == "capacity").update(required=True),
                "capacity", whole=True)

    def test_06_v64_is_the_newest_and_the_series_has_no_gap(self):
        data = os.path.dirname(_asset_path(V64))
        nums = sorted(int(m.group(1)) for f in os.listdir(data) for m in [re.match(r"^rate_master_hvac_all_v(\d+)\.json$", f)] if m)
        self.assertEqual(nums[-1], 65)  # VRF-9 (HVAC v65 minted + loaded; mechanical authority): BEFORE nums[-1] == 64
        self.assertEqual(nums, list(range(1, 66)))  # VRF-9 (HVAC v65 minted + loaded; mechanical authority): BEFORE list(range(1, 65))
        self.assertTrue(os.path.exists(_asset_path(V63)))

    def test_07_live_catalogue_is_v64(self):
        row = frappe.db.sql('select config from "tabBoQ Rate Category Config" where active=1 and discipline=%s and category_id=%s', ("HVAC", CATEGORY))
        self.assertTrue(row)
        live = json.loads(row[0][0]) if isinstance(row[0][0], str) else row[0][0]
        # INVERTED at VRF-9 (HVAC v65 minted + LOADED; mechanical authority -- fails solely because it reads the live catalogue): BEFORE
        # `assertEqual(_norm(live), _norm(self.cfg))` (live == v64). The live VRF config is v65's (test_vrf_v65 07 pins it whole): v64's
        # questions stand in it in order with their required / allow_none flags, every v64 pricing key but `extras` / `per_set` /
        # `lot_units` is unchanged, second opinion stays OFF, 585 items
        self.assertNotEqual(_norm(live), _norm(self.cfg))
        self.assertEqual([(q["id"], q.get("required"), q.get("allow_none")) for q in live["list_spec"]["attribute_definitions"]],
                         [(q["id"], q.get("required"), q.get("allow_none")) for q in self.cfg["list_spec"]["attribute_definitions"]])
        for k, v in self.cfg["list_spec"]["pricing"].items():
            if k not in ("extras", "per_set", "lot_units"):
                self.assertEqual(_norm(live["list_spec"]["pricing"][k]), _norm(v), k)
        self.assertIs(live["list_spec"]["second_opinion"], False)
        n = frappe.db.sql('select count(*) from "tabBoQ Rate Master Item" where active=1 and discipline=%s', ("HVAC",))[0][0]
        self.assertEqual(n, 585)

    def test_08_a_left_out_required_answer_is_asked_once_more(self):
        """R-D13: rows_missing_required finds the rows whose parsed items leave a required answer out (null); run_extraction asks
        them once more with the same prompt (a `reask` capture batch) and the re-read replaces the first read."""
        req = ["includes_drain_pump", "includes_remote"]
        items_key = extraction.ITEMS_KEY
        out = {5: {items_key: [{"attributes": {"includes_drain_pump": {"value": None}, "includes_remote": {"value": "No"}}}]},
               6: {items_key: [{"attributes": {"includes_drain_pump": {"value": "None"}, "includes_remote": {"value": "Yes"}}}]},
               7: {"a": {"value": 1}}}
        rows = [{"excel_row": 5}, {"excel_row": 6}, {"excel_row": 7}]
        self.assertEqual([r["excel_row"] for r in extraction.rows_missing_required(out, rows, req)], [5])
        self.assertEqual(extraction.rows_missing_required(out, rows, []), [])    # NEGATIVE: nothing required -> nothing re-asked

        calls = []
        first = {5: {items_key: [{"attributes": {"includes_drain_pump": {"value": None}}}]}, 6: {items_key: [{"attributes": {"includes_drain_pump": {"value": "No"}}}]}}
        second = {5: {items_key: [{"attributes": {"includes_drain_pump": {"value": "Yes"}}}]}}

        def fake_batch(client, model, prompt, defs, rows_, *a, **kw):
            calls.append(([r["excel_row"] for r in rows_], bool((kw.get("capture_ctx") or {}).get("reask"))))
            return second if (kw.get("capture_ctx") or {}).get("reask") else first

        pop = [{"excel_row": 5, "category_id": CATEGORY, "discipline": "HVAC", "description": "a"},
               {"excel_row": 6, "category_id": CATEGORY, "discipline": "HVAC", "description": "b"}]
        gc = {"prompt": "P", "defs": [], "synonyms": {}, "defaults": {}, "none_guidance": None, "slot_spec": None, "resolution_rules": None,
              "rules": None, "pole_catalog": None, "code_attrs": None, "absent_rules": None, "conductor_groups": None, "paired_fill": None,
              "module_count_attrs": None, "inch_trade": None, "items_spec": {"attribute_definitions": [{"id": "includes_drain_pump", "required": True}]}}
        with mock.patch.object(extraction, "assemble_population", return_value=(3, pop)), \
                mock.patch.object(extraction, "_log_attached_notes_drift_for"), mock.patch.object(extraction, "_capture_run_header"), \
                mock.patch.object(extraction, "load_configs_with_alias_targets", return_value={}), \
                mock.patch.object(extraction, "_group_context", return_value=gc), \
                mock.patch.object(extraction, "_extract_batch", side_effect=fake_batch), \
                mock.patch("nirmaan_stack.api.boq.wizard.ai_settings.get_boq_ai_settings", return_value={"enabled": True, "model": "m"}):
            env = extraction.run_extraction("BOQ-X", "S", client=object())
        self.assertEqual(calls, [([5, 6], False), ([5], True)])
        res = {r["excel_row"]: r for r in env["results"]}
        self.assertEqual(res[5]["items"][0]["attributes"]["includes_drain_pump"]["value"], "Yes")
        self.assertEqual(res[6]["items"][0]["attributes"]["includes_drain_pump"]["value"], "No")
        # NEGATIVE: nothing required -> one call only
        calls.clear()
        gc["items_spec"] = {"attribute_definitions": [{"id": "includes_drain_pump"}]}
        with mock.patch.object(extraction, "assemble_population", return_value=(3, pop)), \
                mock.patch.object(extraction, "_log_attached_notes_drift_for"), mock.patch.object(extraction, "_capture_run_header"), \
                mock.patch.object(extraction, "load_configs_with_alias_targets", return_value={}), \
                mock.patch.object(extraction, "_group_context", return_value=gc), \
                mock.patch.object(extraction, "_extract_batch", side_effect=fake_batch), \
                mock.patch("nirmaan_stack.api.boq.wizard.ai_settings.get_boq_ai_settings", return_value={"enabled": True, "model": "m"}):
            extraction.run_extraction("BOQ-X", "S", client=object())
        self.assertEqual(calls, [([5, 6], False)])
